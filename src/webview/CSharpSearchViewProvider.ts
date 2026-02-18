import * as vscode from 'vscode';
import { SymbolSearchService } from '../search/SymbolSearchService';
import { IndexStatus, SearchMatchMode, SerializableSearchResultItem } from '../search/types';
import { WebviewContentBuilder } from './WebviewContentBuilder';
import { lang } from '../languageManager';

const CONFIG_SECTION = 'csharpSearch';
const SEARCH_DEBOUNCE_MS_KEY = 'searchDebounceMs';
const PAGE_SIZE_KEY = 'pageSize';
const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 100;
const MIN_SEARCH_DEBOUNCE_MS = 0;
const MAX_SEARCH_DEBOUNCE_MS = 1000;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

interface SearchMessage {
    type: 'search';
    kindId: string;
    query: string;
    requestId: string;
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
    private readonly searchService: SymbolSearchService;
    private readonly contentBuilder: WebviewContentBuilder;
    private readonly configWatcher: vscode.Disposable;
    private readonly indexStatusSubscription: vscode.Disposable;
    private currentWebview: vscode.Webview | undefined;
    private cachedSearchResults: {
        requestId: string;
        items: SerializableSearchResultItem[];
        isTruncated: boolean;
        maxResults: number;
    } | undefined;

    public constructor(context: vscode.ExtensionContext, searchService: SymbolSearchService) {
        this.context = context;
        this.searchService = searchService;
        this.contentBuilder = new WebviewContentBuilder(context);
        this.cachedSearchResults = undefined;
        this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                !event.affectsConfiguration(`${CONFIG_SECTION}.${SEARCH_DEBOUNCE_MS_KEY}`)
                && !event.affectsConfiguration(`${CONFIG_SECTION}.${PAGE_SIZE_KEY}`)
            ) {
                return;
            }

            this.postRuntimeConfigUpdate();
        });
        this.indexStatusSubscription = this.searchService.onDidChangeIndexStatus((status) => {
            this.postIndexStatusUpdate(status);
        });
    }

    public dispose(): void {
        this.configWatcher.dispose();
        this.indexStatusSubscription.dispose();
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
                this.postInitMessage(webviewView.webview);
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
        this.postInitMessage(webviewView.webview);

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

    private postInitMessage(webview: vscode.Webview): void {
        const kinds = this.searchService.getKinds();
        webview.postMessage({
            type: 'init',
            kinds,
            activeKindId: kinds[0]?.id ?? '',
            texts: lang.getWebViewTexts(),
            searchDebounceMs: this.getSearchDebounceMs(),
            pageSize: this.getPageSize(),
            indexStatus: this.searchService.getIndexStatus()
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
        const matchMode: SearchMatchMode = message.matchMode === 'exact' ? 'exact' : 'fuzzy';
        const searchResult = await this.searchService.search(message.kindId, message.query, matchMode);
        const serializableResults: SerializableSearchResultItem[] = this.searchService.toSerializable(searchResult.items);
        const pageSize = this.getPageSize();
        const pageItems = serializableResults.slice(0, pageSize);
        this.cachedSearchResults = {
            requestId: message.requestId,
            items: serializableResults,
            isTruncated: searchResult.isTruncated,
            maxResults: searchResult.maxResults
        };

        webview.postMessage({
            type: 'searchResults',
            requestId: message.requestId,
            kindId: message.kindId,
            items: pageItems,
            total: serializableResults.length,
            hasMore: serializableResults.length > pageItems.length,
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
}
