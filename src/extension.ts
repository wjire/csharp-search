import * as vscode from 'vscode';
import { CSharpSearchViewProvider } from './webview/CSharpSearchViewProvider';

const FOCUS_VIEW_COMMAND = 'csharpSearch.focusView';

export function activate(context: vscode.ExtensionContext): void {
    const viewProvider = new CSharpSearchViewProvider(context);
    const focusViewCommand = vscode.commands.registerCommand(FOCUS_VIEW_COMMAND, async () => {
        await vscode.commands.executeCommand('workbench.view.extension.csharpSearch');
    });

    context.subscriptions.push(
        viewProvider,
        vscode.window.registerWebviewViewProvider(CSharpSearchViewProvider.viewType, viewProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }),
        focusViewCommand
    );
}

export function deactivate(): void {
    // no-op
}
