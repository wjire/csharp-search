import * as vscode from 'vscode';
import { SymbolSearchService } from '../search/SymbolSearchService';
import { SerializableSearchResultItem } from '../search/types';
import { WebviewContentBuilder } from './WebviewContentBuilder';
import { lang } from '../languageManager';

interface SearchMessage {
    type: 'search';
    kindId: string;
    query: string;
    requestId: string;
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

export class CSharpSearchViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'csharpSearch.mainView';

    private readonly context: vscode.ExtensionContext;
    private readonly searchService: SymbolSearchService;
    private readonly contentBuilder: WebviewContentBuilder;

    public constructor(context: vscode.ExtensionContext, searchService: SymbolSearchService) {
        this.context = context;
        this.searchService = searchService;
        this.contentBuilder = new WebviewContentBuilder(context);
    }

    public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

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

    private postInitMessage(webview: vscode.Webview): void {
        const kinds = this.searchService.getKinds();
        webview.postMessage({
            type: 'init',
            kinds,
            activeKindId: kinds[0]?.id ?? '',
            texts: lang.getWebViewTexts()
        });
    }

    private async handleSearch(message: SearchMessage, webview: vscode.Webview): Promise<void> {
        const results = await this.searchService.search(message.kindId, message.query);
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
