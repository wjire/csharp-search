import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';

interface RawMatch {
    symbolName: string;
    line: number;
    preview: string;
}

export class MethodSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'member',
        label: '成员'
    };

    public searchInDocument(document: vscode.TextDocument, query: string): SearchResultItem[] {
        const rawMatches = this.findMatches(document.getText(), query);

        return rawMatches.map((match) => ({
            kindId: this.kind.id,
            symbolName: match.symbolName,
            preview: match.preview,
            line: match.line,
            uri: document.uri,
            relativePath: vscode.workspace.asRelativePath(document.uri)
        }));
    }

    private findMatches(content: string, query: string): RawMatch[] {
        const memberRegex = /\b(?:public|private|protected|internal|static|virtual|override|sealed|partial|async|extern|new|unsafe|readonly|required|abstract)\b[^\n;{}]*?\b([A-Za-z_]\w*)\s*(?:\([^;{}]*\)\s*(?:\{|=>)|\{\s*(?:get|set|init)|=>|;)/g;
        const normalizedQuery = query.toLowerCase();
        const matches: RawMatch[] = [];

        for (const match of content.matchAll(memberRegex)) {
            const memberName = match[1] ?? '';
            if (!memberName.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const start = match.index ?? 0;
            const line = this.getLineNumber(content, start);
            const preview = (match[0] ?? '').replace(/\s+/g, ' ').trim();
            matches.push({
                symbolName: memberName,
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
