import * as vscode from 'vscode';
import { ISymbolSearcher } from './ISymbolSearcher';
import { SymbolIndexCache } from './SymbolIndexCache';
import { IndexStatus, SearchKindDefinition, SearchMatchMode, SearchQueryResult, SearchResultItem, SerializableSearchResultItem } from './types';

export class SymbolSearchService implements vscode.Disposable {
    private readonly searchersByKindId: Map<string, ISymbolSearcher>;
    private readonly symbolIndexCache: SymbolIndexCache;

    public constructor(searchers: ISymbolSearcher[]) {
        this.searchersByKindId = new Map(searchers.map((searcher) => [searcher.kind.id, searcher]));
        this.symbolIndexCache = new SymbolIndexCache(searchers);
    }

    public dispose(): void {
        this.symbolIndexCache.dispose();
    }

    public async warmup(): Promise<void> {
        await this.symbolIndexCache.ensureReady();
    }

    public get onDidChangeIndexStatus(): vscode.Event<IndexStatus> {
        return this.symbolIndexCache.onDidChangeIndexStatus;
    }

    public getIndexStatus(): IndexStatus {
        return this.symbolIndexCache.getIndexStatus();
    }

    public getKinds(): SearchKindDefinition[] {
        return Array.from(this.searchersByKindId.values()).map((searcher) => searcher.kind);
    }

    public async search(kindId: string, query: string, matchMode: SearchMatchMode = 'fuzzy'): Promise<SearchQueryResult> {
        if (!this.searchersByKindId.has(kindId)) {
            return {
                items: [],
                isTruncated: false,
                maxResults: 0
            };
        }

        return this.symbolIndexCache.search(kindId, query, matchMode);
    }

    public toSerializable(items: SearchResultItem[]): SerializableSearchResultItem[] {
        return items.map((item) => ({
            kindId: item.kindId,
            symbolName: item.symbolName,
            searchText: item.searchText,
            preview: item.preview,
            line: item.line,
            uri: item.uri.toString(),
            relativePath: item.relativePath,
            projectName: item.projectName,
            ownerTypeName: item.ownerTypeName
        }));
    }
}
