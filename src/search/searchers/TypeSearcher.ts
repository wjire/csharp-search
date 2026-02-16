import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';

interface RawMatch {
    symbolName: string;
    line: number;
    preview: string;
}

export class TypeSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'type',
        label: '类型'
    };

    public searchInContent(content: string, uri: vscode.Uri, relativePath: string, query: string): SearchResultItem[] {
        const rawMatches = this.findMatches(content, query);

        return rawMatches.map((match) => ({
            kindId: this.kind.id,
            symbolName: match.symbolName,
            preview: match.preview,
            line: match.line,
            uri,
            relativePath
        }));
    }

    private findMatches(content: string, query: string): RawMatch[] {
        const typeRegex = /\b(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)\b/g;
        const normalizedQuery = query.toLowerCase();
        const matches: RawMatch[] = [];

        for (const match of content.matchAll(typeRegex)) {
            const typeName = match[1] ?? '';
            if (!typeName.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const start = match.index ?? 0;
            const line = this.getLineNumber(content, start);
            const preview = (match[0] ?? '').replace(/\s+/g, ' ').trim();
            matches.push({
                symbolName: typeName,
                line,
                preview
            });
        }

        return matches;
    }

    private getLineNumber(content: string, offset: number): number {
        let line = 0;
        for (let index = 0; index < offset; index += 1) {
            if (content.charAt(index) === '\n') {
                line += 1;
            }
        }

        return line;
    }
}
