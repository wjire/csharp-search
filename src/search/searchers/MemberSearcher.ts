import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';
import { lang } from '../../languageManager';

interface RawMatch {
    symbolName: string;
    line: number;
    preview: string;
    ownerTypeName?: string;
}

interface TypeScope {
    name: string;
    start: number;
    end: number;
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
            projectName: '',
            ownerTypeName: match.ownerTypeName
        }));
    }

    private findMatches(content: string, query: string): RawMatch[] {
        const memberRegex = /\b(?:public|private|protected|internal|static|readonly|required|volatile|new|unsafe)\b[^\n{};]*?\b([A-Za-z_]\w*)\s*(?:\{\s*(?:get|set|init)|=>|;)/g;
        const normalizedQuery = query.toLowerCase();
        const matches: RawMatch[] = [];
        const typeScopes = this.getTypeScopes(content);
        const lineBreakIndexes = this.buildLineBreakIndexes(content);

        for (const match of content.matchAll(memberRegex)) {
            const memberName = match[1] ?? '';
            if (!memberName.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            const start = match.index ?? 0;
            const line = this.getLineNumber(lineBreakIndexes, start);
            const preview = (match[0] ?? '').replace(/\s+/g, ' ').trim();
            const ownerTypeName = this.getInnermostTypeName(typeScopes, start);
            matches.push({
                symbolName: memberName,
                line,
                preview,
                ownerTypeName
            });
        }

        return matches;
    }

    private getTypeScopes(content: string): TypeScope[] {
        const typeRegex = /\b(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)\b/g;
        const scopes: TypeScope[] = [];

        for (const match of content.matchAll(typeRegex)) {
            const typeName = match[1] ?? '';
            const declarationStart = match.index ?? 0;
            const declarationEnd = declarationStart + (match[0]?.length ?? 0);
            const openBraceIndex = this.findNextTypeBodyOpenBrace(content, declarationEnd);
            if (openBraceIndex < 0) {
                continue;
            }

            const closeBraceIndex = this.findMatchingCloseBrace(content, openBraceIndex);
            if (closeBraceIndex <= openBraceIndex) {
                continue;
            }

            scopes.push({
                name: typeName,
                start: declarationStart,
                end: closeBraceIndex
            });
        }

        return scopes;
    }

    private findNextTypeBodyOpenBrace(content: string, startIndex: number): number {
        const lookaheadLimit = Math.min(content.length, startIndex + 1500);
        for (let index = startIndex; index < lookaheadLimit; index += 1) {
            const currentChar = content.charAt(index);
            if (currentChar === '{') {
                return index;
            }

            if (currentChar === ';') {
                return -1;
            }
        }

        return -1;
    }

    private findMatchingCloseBrace(content: string, openBraceIndex: number): number {
        let braceDepth = 0;
        for (let index = openBraceIndex; index < content.length; index += 1) {
            const currentChar = content.charAt(index);
            if (currentChar === '{') {
                braceDepth += 1;
                continue;
            }

            if (currentChar === '}') {
                braceDepth -= 1;
                if (braceDepth === 0) {
                    return index;
                }
            }
        }

        return -1;
    }

    private getInnermostTypeName(typeScopes: TypeScope[], position: number): string | undefined {
        const containingScopes = typeScopes.filter((scope) => scope.start <= position && position <= scope.end);
        if (!containingScopes.length) {
            return undefined;
        }

        containingScopes.sort((left, right) => (left.end - left.start) - (right.end - right.start));
        return containingScopes[0].name;
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
