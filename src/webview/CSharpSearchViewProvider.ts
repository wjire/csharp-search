import * as vscode from 'vscode';
import { SymbolSearchService } from '../search/SymbolSearchService';
import { SearchMatchMode, SerializableSearchResultItem } from '../search/types';
import { WebviewContentBuilder } from './WebviewContentBuilder';
import { lang } from '../languageManager';

const CONFIG_SECTION = 'csharpSearch';
const SEARCH_DEBOUNCE_MS_KEY = 'searchDebounceMs';
const DEFAULT_SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_DEBOUNCE_MS = 0;
const MAX_SEARCH_DEBOUNCE_MS = 1000;

interface SearchMessage {
    type: 'search';
    kindId: string;
    query: string;
    requestId: string;
    matchMode?: SearchMatchMode;
}

interface OpenResultMessage {
    type: 'openResult';
    uri: string;
    line: number;
}

interface ReadyMessage {
    type: 'ready';
}

type IncomingMessage = SearchMessage | OpenResultMessage | ReadyMessage;

export class CSharpSearchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewType = 'csharpSearch.mainView';

    private readonly context: vscode.ExtensionContext;
    private readonly searchService: SymbolSearchService;
    private readonly contentBuilder: WebviewContentBuilder;
    private readonly configWatcher: vscode.Disposable;
    private currentWebview: vscode.Webview | undefined;

    public constructor(context: vscode.ExtensionContext, searchService: SymbolSearchService) {
        this.context = context;
        this.searchService = searchService;
        this.contentBuilder = new WebviewContentBuilder(context);
        this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration(`${CONFIG_SECTION}.${SEARCH_DEBOUNCE_MS_KEY}`)) {
                return;
            }

            this.postRuntimeConfigUpdate();
        });
    }

    public dispose(): void {
        this.configWatcher.dispose();
    }

    public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
        this.currentWebview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
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
            searchDebounceMs: this.getSearchDebounceMs()
        });
    }

    private postInitMessage(webview: vscode.Webview): void {
        const kinds = this.searchService.getKinds();
        webview.postMessage({
            type: 'init',
            kinds,
            activeKindId: kinds[0]?.id ?? '',
            texts: lang.getWebViewTexts(),
            searchDebounceMs: this.getSearchDebounceMs()
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

    private async handleSearch(message: SearchMessage, webview: vscode.Webview): Promise<void> {
        const matchMode: SearchMatchMode = message.matchMode === 'exact' ? 'exact' : 'fuzzy';
        const results = await this.searchService.search(message.kindId, message.query, matchMode);
        const serializableResults: SerializableSearchResultItem[] = this.searchService.toSerializable(results);

        webview.postMessage({
            type: 'searchResults',
            requestId: message.requestId,
            kindId: message.kindId,
            items: serializableResults
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
