import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';

export class TextSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'text',
        label: '文本'
    };

    public searchInDocument(document: vscode.TextDocument, query: string): SearchResultItem[] {
        const normalizedQuery = query.toLowerCase();
        const results: SearchResultItem[] = [];

        for (let line = 0; line < document.lineCount; line += 1) {
            const lineText = document.lineAt(line).text;
            if (!lineText.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const preview = lineText.trim();
            results.push({
                kindId: this.kind.id,
                symbolName: preview.length > 0 ? preview : '(空行匹配)',
                preview,
                line,
                uri: document.uri,
                relativePath: vscode.workspace.asRelativePath(document.uri)
            });
        }

        return results;
    }
}
