import * as vscode from 'vscode';
import { CSharpSearchViewProvider } from './webview/CSharpSearchViewProvider';
import { MethodSearcher } from './search/searchers/MethodSearcher';
import { TypeSearcher } from './search/searchers/TypeSearcher';
import { SymbolSearchService } from './search/SymbolSearchService';

export function activate(context: vscode.ExtensionContext): void {
    const searchService = new SymbolSearchService([
        new TypeSearcher(),
        new MethodSearcher()
    ]);
    void searchService.warmup();

    const viewProvider = new CSharpSearchViewProvider(context, searchService);

    context.subscriptions.push(
        searchService,
        vscode.window.registerWebviewViewProvider(CSharpSearchViewProvider.viewType, viewProvider)
    );
}

export function deactivate(): void {
    // no-op
}
