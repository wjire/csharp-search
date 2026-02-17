import * as vscode from 'vscode';
import { CSharpSearchViewProvider } from './webview/CSharpSearchViewProvider';
import { ImplementationSearcher } from './search/searchers/ImplementationSearcher';
import { MemberSearcher } from './search/searchers/MemberSearcher';
import { MethodSearcher } from './search/searchers/MethodSearcher';
import { TypeSearcher } from './search/searchers/TypeSearcher';
import { SymbolSearchService } from './search/SymbolSearchService';

const FOCUS_VIEW_COMMAND = 'csharpSearch.focusView';

export function activate(context: vscode.ExtensionContext): void {
    const searchService = new SymbolSearchService([
        new TypeSearcher(),
        new MethodSearcher(),
        new MemberSearcher(),
        new ImplementationSearcher()
    ]);
    void searchService.warmup();

    const viewProvider = new CSharpSearchViewProvider(context, searchService);
    const focusViewCommand = vscode.commands.registerCommand(FOCUS_VIEW_COMMAND, async () => {
        await vscode.commands.executeCommand('workbench.view.extension.csharpSearch');
    });

    context.subscriptions.push(
        searchService,
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
