import * as vscode from 'vscode';
import { ISymbolSearcher } from './ISymbolSearcher';
import { SearchKindDefinition, SearchResultItem, SerializableSearchResultItem } from './types';

export class SymbolSearchService {
    private readonly searchersByKindId: Map<string, ISymbolSearcher>;

    public constructor(searchers: ISymbolSearcher[]) {
        this.searchersByKindId = new Map(searchers.map((searcher) => [searcher.kind.id, searcher]));
    }

    public getKinds(): SearchKindDefinition[] {
        return Array.from(this.searchersByKindId.values()).map((searcher) => searcher.kind);
    }

    public async search(kindId: string, query: string): Promise<SearchResultItem[]> {
        const normalizedQuery = query.trim();
        if (normalizedQuery.length === 0) {
            return [];
        }

        const searcher = this.searchersByKindId.get(kindId);
        if (!searcher) {
            return [];
        }

        const files = await vscode.workspace.findFiles('**/*.cs', '**/{bin,obj}/**');
        const allResults: SearchResultItem[] = [];

        for (const fileUri of files) {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const results = searcher.searchInDocument(document, normalizedQuery);
            allResults.push(...results);
        }

        return allResults.slice(0, 500);
    }

    public toSerializable(items: SearchResultItem[]): SerializableSearchResultItem[] {
        return items.map((item) => ({
            kindId: item.kindId,
            symbolName: item.symbolName,
            preview: item.preview,
            line: item.line,
            uri: item.uri.toString(),
            relativePath: item.relativePath
        }));
    }
}
