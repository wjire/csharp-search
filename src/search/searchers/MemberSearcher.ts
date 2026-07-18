import * as vscode from 'vscode';
import { lang } from '../../languageManager';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';

interface RawMatch {
    symbolName: string;
    line: number;
    preview: string;
}

export class MemberSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'member',
        label: lang.t('search.kind.member')
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
        const memberRegex = /\b(?:public|private|protected|internal|static|readonly|required|volatile|new|unsafe)\b[^\n{};]*?\b([A-Za-z_]\w*)\s*(?:\{\s*(?:get|set|init)|=>|;)/g;
        const normalizedQuery = query.toLowerCase();
        const matches: RawMatch[] = [];
        const lineBreakIndexes = this.buildLineBreakIndexes(content);

        for (const match of content.matchAll(memberRegex)) {
            const memberName = match[1] ?? '';
            if (!memberName.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const start = match.index ?? 0;
            const line = this.getLineNumber(lineBreakIndexes, start);
            const preview = (match[0] ?? '').replace(/\s+/g, ' ').trim();
            matches.push({
                symbolName: memberName,
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
