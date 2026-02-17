import * as vscode from 'vscode';
import { ISymbolSearcher } from '../ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem } from '../types';
import { lang } from '../../languageManager';

interface RawMatch {
    symbolName: string;
    searchText: string;
    line: number;
    preview: string;
    ownerTypeName?: string;
}

export class ImplementationSearcher implements ISymbolSearcher {
    public readonly kind: SearchKindDefinition = {
        id: 'impl',
        label: lang.t('search.kind.impl')
    };

    public searchInContent(content: string, uri: vscode.Uri, relativePath: string, query: string): SearchResultItem[] {
        const rawMatches = this.findMatches(content, query);

        return rawMatches.map((match) => ({
            kindId: this.kind.id,
            symbolName: match.symbolName,
            searchText: match.searchText,
            preview: match.preview,
            line: match.line,
            uri,
            relativePath,
            projectName: '',
            ownerTypeName: match.ownerTypeName
        }));
    }

    private findMatches(content: string, query: string): RawMatch[] {
        const declarationRegex = /\b(class|record|struct)\s+([A-Za-z_]\w*)\b/g;
        const normalizedQuery = query.toLowerCase();
        const matches: RawMatch[] = [];
        const lineBreakIndexes = this.buildLineBreakIndexes(content);

        for (const match of content.matchAll(declarationRegex)) {
            const declarationKind = match[1] ?? '';
            const implementationTypeName = match[2] ?? '';
            const declarationStart = match.index ?? 0;
            const declarationEnd = declarationStart + (match[0]?.length ?? 0);
            const openBraceIndex = this.findNextTypeBodyOpenBrace(content, declarationEnd);
            if (openBraceIndex < 0) {
                continue;
            }

            const colonIndex = content.indexOf(':', declarationEnd);
            if (colonIndex < 0 || colonIndex > openBraceIndex) {
                continue;
            }

            const inheritanceText = content.slice(colonIndex + 1, openBraceIndex).trim();
            if (!inheritanceText) {
                continue;
            }

            const targets = this.parseInheritanceTargets(inheritanceText);
            if (!targets.length) {
                continue;
            }

            const line = this.getLineNumber(lineBreakIndexes, declarationStart);
            const preview = `${declarationKind} ${implementationTypeName} : ${inheritanceText}`
                .replace(/\s+/g, ' ')
                .trim();

            const searchableText = `${implementationTypeName} ${targets.join(' ')}`.toLowerCase();
            if (normalizedQuery && !searchableText.includes(normalizedQuery)) {
                continue;
            }

            matches.push({
                symbolName: implementationTypeName,
                searchText: searchableText,
                line,
                preview,
                ownerTypeName: targets.join(', ')
            });
        }

        return matches;
    }

    private parseInheritanceTargets(inheritanceText: string): string[] {
        const targets = new Set<string>();

        for (const rawToken of inheritanceText.split(',')) {
            const token = rawToken.trim();
            if (!token || token.startsWith('where ')) {
                continue;
            }

            const normalizedToken = token
                .replace(/^global::/, '')
                .replace(/<[^>]*>/g, '')
                .replace(/\?/g, '')
                .trim();

            const simpleName = normalizedToken.split('.').pop()?.trim() ?? '';
            if (!simpleName) {
                continue;
            }

            targets.add(simpleName);
        }

        return Array.from(targets);
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
