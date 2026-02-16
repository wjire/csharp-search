import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';
import { lang } from '../../languageManager';

interface RawMatch {
    symbolName: string;
    line: number;
    preview: string;
}

export class TypeSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'type',
        label: lang.t('search.kind.type')
    };

    public searchInContent(content: string, uri: vscode.Uri, relativePath: string, query: string): SearchResultItem[] {
        const rawMatches = this.findMatches(content, query);

        return rawMatches.map((match) => ({
            kindId: this.kind.id,
            symbolName: match.symbolName,
            preview: match.preview,
            line: match.line,
            uri,
            relativePath,
            projectName: ''
        }));
    }

    private findMatches(content: string, query: string): RawMatch[] {
        const typeRegex = /\b(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)\b/g;
        const normalizedQuery = query.toLowerCase();
        const matches: RawMatch[] = [];
        const lineBreakIndexes = this.buildLineBreakIndexes(content);

        for (const match of content.matchAll(typeRegex)) {
            const typeName = match[1] ?? '';
            if (!typeName.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const start = match.index ?? 0;
            const line = this.getLineNumber(lineBreakIndexes, start);
            const preview = (match[0] ?? '').replace(/\s+/g, ' ').trim();
            matches.push({
                symbolName: typeName,
                line,
                preview
            });
        }

        return matches;
    }

    private buildLineBreakIndexes(content: string): number[] {
        const indexes: number[] = [];

        for (let index = 0; index < content.length; index += 1) {
            if (content.charAt(index) === '\n') {
                indexes.push(index);
            }
        }

        return indexes;
    }

    private getLineNumber(lineBreakIndexes: number[], offset: number): number {
        let left = 0;
        let right = lineBreakIndexes.length;

        while (left < right) {
            const middle = left + Math.floor((right - left) / 2);
            if (lineBreakIndexes[middle] < offset) {
                left = middle + 1;
                continue;
            }

            right = middle;
        }

        return left;
    }
}
