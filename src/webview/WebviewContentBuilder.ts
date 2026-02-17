import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export class WebviewContentBuilder {
    private readonly context: vscode.ExtensionContext;

    public constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public async build(webview: vscode.Webview): Promise<string> {
        const templatePath = path.join(this.context.extensionPath, 'media', 'search-view.html');
        const htmlTemplate = await fs.readFile(templatePath, 'utf-8');

        const nonce = this.getNonce();
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'search-view.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'search-view.js'));
        const codiconCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );

        return htmlTemplate
            .replace(/\{\{cspSource\}\}/g, webview.cspSource)
            .replace(/\{\{nonce\}\}/g, nonce)
            .replace(/\{\{codiconCssUri\}\}/g, codiconCssUri.toString())
            .replace(/\{\{cssUri\}\}/g, cssUri.toString())
            .replace(/\{\{jsUri\}\}/g, jsUri.toString());
    }

    private getNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i += 1) {
            nonce += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        return nonce;
    }
}
