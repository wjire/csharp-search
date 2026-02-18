import * as vscode from 'vscode';
import { SymbolSearchService } from '../search/SymbolSearchService';
import { IndexStatus, SearchKindDefinition, SearchMatchMode, SerializableSearchResultItem } from '../search/types';
import { WebviewContentBuilder } from './WebviewContentBuilder';
import { lang } from '../languageManager';
import { ImplementationSearcher } from '../search/searchers/ImplementationSearcher';
import { MemberSearcher } from '../search/searchers/MemberSearcher';
import { MethodSearcher } from '../search/searchers/MethodSearcher';
import { TypeSearcher } from '../search/searchers/TypeSearcher';

const CONFIG_SECTION = 'csharpSearch';
const SEARCH_DEBOUNCE_MS_KEY = 'searchDebounceMs';
const PAGE_SIZE_KEY = 'pageSize';
const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 100;
const MIN_SEARCH_DEBOUNCE_MS = 0;
const MAX_SEARCH_DEBOUNCE_MS = 1000;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;
const DOTNET_PROJECT_GLOB = '**/*.{sln,csproj,fsproj,vbproj}';
const DOTNET_HINT_GLOB = '**/{global.json,Directory.Build.props,Directory.Build.targets}';
const CSHARP_FILE_GLOB = '**/*.cs';
const DOTNET_SEARCH_EXCLUDE_GLOB = '**/{bin,obj,node_modules,.git,.vs,.vscode}/**';
const CSHARP_FILE_HINT_LIMIT = 20;

const EMPTY_INDEX_STATUS: IndexStatus = {
    isReady: false,
    isIndexing: false,
    totalFiles: 0,
    indexedFiles: 0
};

interface SearchMessage {
    type: 'search';
    kindId: string;
    query: string;
    requestId: string;
    previousRequestId?: string;
    previousQuery?: string;
    matchMode?: SearchMatchMode;
}

interface LoadMoreMessage {
    type: 'loadMore';
    requestId: string;
    offset: number;
}

interface OpenResultMessage {
    type: 'openResult';
    uri: string;
    line: number;
}

interface ReadyMessage {
    type: 'ready';
}

type IncomingMessage = SearchMessage | LoadMoreMessage | OpenResultMessage | ReadyMessage;

export class CSharpSearchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewType = 'csharpSearch.mainView';

    private readonly context: vscode.ExtensionContext;
    private readonly contentBuilder: WebviewContentBuilder;
    private readonly configWatcher: vscode.Disposable;
    private indexStatusSubscription: vscode.Disposable | undefined;
    private currentWebview: vscode.Webview | undefined;
    private latestSearchSequence: number;
    private searchService: SymbolSearchService | undefined;
    private isDotNetWorkspaceCached: boolean | undefined;
    private dotNetCheckPromise: Promise<boolean> | undefined;
    private cachedSearchResults: {
        requestId: string;
        kindId: string;
        query: string;
        matchMode: SearchMatchMode;
        items: SerializableSearchResultItem[];
        isTruncated: boolean;
        maxResults: number;
    } | undefined;

    public constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.contentBuilder = new WebviewContentBuilder(context);
        this.cachedSearchResults = undefined;
        this.latestSearchSequence = 0;
        this.searchService = undefined;
        this.indexStatusSubscription = undefined;
        this.isDotNetWorkspaceCached = undefined;
        this.dotNetCheckPromise = undefined;
        this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                !event.affectsConfiguration(`${CONFIG_SECTION}.${SEARCH_DEBOUNCE_MS_KEY}`)
                && !event.affectsConfiguration(`${CONFIG_SECTION}.${PAGE_SIZE_KEY}`)
            ) {
                return;
            }

            this.postRuntimeConfigUpdate();
        });
    }

    public dispose(): void {
        this.configWatcher.dispose();
        this.indexStatusSubscription?.dispose();
        this.searchService?.dispose();
    }

    public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
        this.currentWebview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
            ]
        };

        webviewView.onDidDispose(() => {
            if (this.currentWebview === webviewView.webview) {
                this.currentWebview = undefined;
            }
        });

        webviewView.webview.onDidReceiveMessage(async (message: IncomingMessage) => {
            if (message.type === 'ready') {
                await this.postInitMessage(webviewView.webview);
                return;
            }

            if (message.type === 'search') {
                await this.handleSearch(message, webviewView.webview);
                return;
            }

            if (message.type === 'loadMore') {
                this.handleLoadMore(message, webviewView.webview);
                return;
            }

            if (message.type === 'openResult') {
                await this.handleOpenResult(message);
            }
        });

        webviewView.webview.html = await this.contentBuilder.build(webviewView.webview);
        await this.postInitMessage(webviewView.webview);

    }

    private postRuntimeConfigUpdate(): void {
        if (!this.currentWebview) {
            return;
        }

        this.currentWebview.postMessage({
            type: 'configUpdated',
            searchDebounceMs: this.getSearchDebounceMs(),
            pageSize: this.getPageSize()
        });
    }

    private postIndexStatusUpdate(status: IndexStatus): void {
        if (!this.currentWebview) {
            return;
        }

        this.currentWebview.postMessage({
            type: 'indexStatusUpdated',
            status
        });
    }

    private async postInitMessage(webview: vscode.Webview): Promise<void> {
        const workspaceSupported = await this.isDotNetWorkspace();
        let kinds: SearchKindDefinition[] = [];
        let indexStatus: IndexStatus = EMPTY_INDEX_STATUS;

        if (workspaceSupported) {
            const searchService = await this.ensureSearchService();
            kinds = searchService.getKinds();
            indexStatus = searchService.getIndexStatus();
        }

        webview.postMessage({
            type: 'init',
            kinds,
            activeKindId: kinds[0]?.id ?? '',
            texts: lang.getWebViewTexts(),
            searchDebounceMs: this.getSearchDebounceMs(),
            pageSize: this.getPageSize(),
            indexStatus,
            workspaceSupported
        });
    }

    private getSearchDebounceMs(): number {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredValue = configuration.get<number>(SEARCH_DEBOUNCE_MS_KEY, DEFAULT_SEARCH_DEBOUNCE_MS);

        if (typeof configuredValue !== 'number' || Number.isNaN(configuredValue)) {
            return DEFAULT_SEARCH_DEBOUNCE_MS;
        }

        return Math.min(MAX_SEARCH_DEBOUNCE_MS, Math.max(MIN_SEARCH_DEBOUNCE_MS, Math.round(configuredValue)));
    }

    private getPageSize(): number {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredValue = configuration.get<number>(PAGE_SIZE_KEY, DEFAULT_PAGE_SIZE);

        if (typeof configuredValue !== 'number' || Number.isNaN(configuredValue)) {
            return DEFAULT_PAGE_SIZE;
        }

        return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(configuredValue)));
    }

    private async handleSearch(message: SearchMessage, webview: vscode.Webview): Promise<void> {
        const currentSequence = Number.isFinite(Number(message.requestId))
            ? Math.max(0, Math.round(Number(message.requestId)))
            : this.latestSearchSequence + 1;
        this.latestSearchSequence = Math.max(this.latestSearchSequence, currentSequence);

        const workspaceSupported = await this.isDotNetWorkspace();
        if (!workspaceSupported) {
            webview.postMessage({
                type: 'searchResults',
                requestId: message.requestId,
                kindId: message.kindId,
                items: [],
                total: 0,
                hasMore: false,
                isTruncated: false,
                maxResults: 0,
                append: false
            });
            return;
        }

        const searchService = await this.ensureSearchService();
        const matchMode: SearchMatchMode = message.matchMode === 'exact' ? 'exact' : 'fuzzy';

        const previousRequestId = typeof message.previousRequestId === 'string' ? message.previousRequestId : '';
        const previousQuery = typeof message.previousQuery === 'string' ? message.previousQuery : '';
        const cached = this.cachedSearchResults;
        const canUseIncremental = cached
            && previousRequestId.length > 0
            && previousQuery.length > 0
            && previousRequestId === cached.requestId
            && previousQuery === cached.query
            && cached.kindId === message.kindId
            && cached.matchMode === matchMode
            && message.query.length > previousQuery.length
            && message.query.toLowerCase().startsWith(previousQuery.toLowerCase());

        if (canUseIncremental) {
            const filteredItems = this.filterSerializableItems(cached.items, message.query, matchMode);
            this.cachedSearchResults = {
                requestId: message.requestId,
                kindId: message.kindId,
                query: message.query,
                matchMode,
                items: filteredItems,
                isTruncated: cached.isTruncated,
                maxResults: cached.maxResults
            };

            this.postSearchResults(webview, {
                requestId: message.requestId,
                kindId: message.kindId,
                items: filteredItems,
                isTruncated: cached.isTruncated,
                maxResults: cached.maxResults,
                append: false
            });

            if (!cached.isTruncated) {
                return;
            }

            const fullSearchResult = await searchService.search(message.kindId, message.query, matchMode);
            const fullItems = searchService.toSerializable(fullSearchResult.items);

            if (this.isStaleSearchRequest(message.requestId)) {
                return;
            }

            this.cachedSearchResults = {
                requestId: message.requestId,
                kindId: message.kindId,
                query: message.query,
                matchMode,
                items: fullItems,
                isTruncated: fullSearchResult.isTruncated,
                maxResults: fullSearchResult.maxResults
            };

            this.postSearchResults(webview, {
                requestId: message.requestId,
                kindId: message.kindId,
                items: fullItems,
                isTruncated: fullSearchResult.isTruncated,
                maxResults: fullSearchResult.maxResults,
                append: false
            });

            return;
        }

        const searchResult = await searchService.search(message.kindId, message.query, matchMode);
        if (this.isStaleSearchRequest(message.requestId)) {
            return;
        }

        const serializableResults: SerializableSearchResultItem[] = searchService.toSerializable(searchResult.items);
        this.cachedSearchResults = {
            requestId: message.requestId,
            kindId: message.kindId,
            query: message.query,
            matchMode,
            items: serializableResults,
            isTruncated: searchResult.isTruncated,
            maxResults: searchResult.maxResults
        };

        this.postSearchResults(webview, {
            requestId: message.requestId,
            kindId: message.kindId,
            items: serializableResults,
            isTruncated: searchResult.isTruncated,
            maxResults: searchResult.maxResults,
            append: false
        });
    }

    private handleLoadMore(message: LoadMoreMessage, webview: vscode.Webview): void {
        const cached = this.cachedSearchResults;
        if (!cached || cached.requestId !== message.requestId) {
            return;
        }

        const pageSize = this.getPageSize();
        const parsedOffset = Number.isFinite(message.offset) ? Math.round(message.offset) : 0;
        const offset = Math.max(0, parsedOffset);
        const pageItems = cached.items.slice(offset, offset + pageSize);
        const loadedCount = offset + pageItems.length;

        webview.postMessage({
            type: 'searchResults',
            requestId: message.requestId,
            items: pageItems,
            total: cached.items.length,
            hasMore: loadedCount < cached.items.length,
            isTruncated: cached.isTruncated,
            maxResults: cached.maxResults,
            append: true
        });
    }

    private async handleOpenResult(message: OpenResultMessage): Promise<void> {
        const uri = vscode.Uri.parse(message.uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: true });
        const position = new vscode.Position(message.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }

    private postSearchResults(
        webview: vscode.Webview,
        payload: {
            requestId: string;
            kindId: string;
            items: SerializableSearchResultItem[];
            isTruncated: boolean;
            maxResults: number;
            append: boolean;
        }
    ): void {
        const pageSize = this.getPageSize();
        const pageItems = payload.items.slice(0, pageSize);

        webview.postMessage({
            type: 'searchResults',
            requestId: payload.requestId,
            kindId: payload.kindId,
            items: pageItems,
            total: payload.items.length,
            hasMore: payload.items.length > pageItems.length,
            isTruncated: payload.isTruncated,
            maxResults: payload.maxResults,
            append: payload.append
        });
    }

    private filterSerializableItems(
        sourceItems: SerializableSearchResultItem[],
        query: string,
        matchMode: SearchMatchMode
    ): SerializableSearchResultItem[] {
        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length === 0) {
            return [];
        }

        return sourceItems.filter((item) => {
            const symbolNameLower = (item.symbolName ?? '').toLowerCase();
            const searchTextLower = (item.searchText ?? '').toLowerCase();

            if (matchMode === 'exact') {
                if (symbolNameLower === normalizedQuery) {
                    return true;
                }

                if (!searchTextLower) {
                    return false;
                }

                const tokens = searchTextLower
                    .split(/[\s,]+/)
                    .map((token) => token.trim())
                    .filter((token) => token.length > 0);

                return tokens.includes(normalizedQuery);
            }

            return symbolNameLower.includes(normalizedQuery) || searchTextLower.includes(normalizedQuery);
        });
    }

    private isStaleSearchRequest(requestId: string): boolean {
        const sequence = Number(requestId);
        if (!Number.isFinite(sequence)) {
            return false;
        }

        return Math.round(sequence) < this.latestSearchSequence;
    }

    private async ensureSearchService(): Promise<SymbolSearchService> {
        if (this.searchService) {
            return this.searchService;
        }

        this.searchService = new SymbolSearchService([
            new TypeSearcher(),
            new MethodSearcher(),
            new MemberSearcher(),
            new ImplementationSearcher()
        ]);
        this.indexStatusSubscription?.dispose();
        this.indexStatusSubscription = this.searchService.onDidChangeIndexStatus((status) => {
            this.postIndexStatusUpdate(status);
        });

        void this.searchService.warmup();
        return this.searchService;
    }

    private async isDotNetWorkspace(): Promise<boolean> {
        if (typeof this.isDotNetWorkspaceCached === 'boolean') {
            return this.isDotNetWorkspaceCached;
        }

        if (this.dotNetCheckPromise) {
            return this.dotNetCheckPromise;
        }

        this.dotNetCheckPromise = (async () => {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                this.isDotNetWorkspaceCached = false;
                return false;
            }

            const projectFiles = await vscode.workspace.findFiles(DOTNET_PROJECT_GLOB, DOTNET_SEARCH_EXCLUDE_GLOB, 1);
            if (projectFiles.length > 0) {
                this.isDotNetWorkspaceCached = true;
                return true;
            }

            const dotnetHints = await vscode.workspace.findFiles(DOTNET_HINT_GLOB, DOTNET_SEARCH_EXCLUDE_GLOB, 1);
            if (dotnetHints.length > 0) {
                this.isDotNetWorkspaceCached = true;
                return true;
            }

            const csharpFiles = await vscode.workspace.findFiles(CSHARP_FILE_GLOB, DOTNET_SEARCH_EXCLUDE_GLOB, CSHARP_FILE_HINT_LIMIT);
            const supported = csharpFiles.length > 0;
            this.isDotNetWorkspaceCached = supported;
            return supported;
        })();

        try {
            return await this.dotNetCheckPromise;
        } finally {
            this.dotNetCheckPromise = undefined;
        }
    }
}
