import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';

export class TextSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'text',
        label: '文本'
    };

    public searchInContent(content: string, uri: vscode.Uri, relativePath: string, query: string): SearchResultItem[] {
        const normalizedQuery = query.toLowerCase();
        const results: SearchResultItem[] = [];

        const lines = content.split(/\r?\n/);
        for (let line = 0; line < lines.length; line += 1) {
            const lineText = lines[line] ?? '';
            if (!lineText.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const preview = lineText.trim();
            results.push({
                kindId: this.kind.id,
                symbolName: preview.length > 0 ? preview : '(空行匹配)',
                preview,
                line,
                uri,
                relativePath
            });
        }

        return results;
    }
}
