import * as vscode from 'vscode';
import { ISymbolSearcher } from './ISymbolSearcher';
import { IndexStatus, SearchMatchMode, SearchQueryResult, SearchResultItem } from './types';

const textDecoder = new TextDecoder('utf-8');
const INITIAL_INDEX_BATCH_SIZE = 20;
const CONFIG_SECTION = 'csharpSearch';
const EXCLUDE_FOLDERS_KEY = 'excludeFolders';
const MAX_RESULTS_KEY = 'maxResults';
const DEFAULT_EXCLUDED_FOLDERS = ['bin', 'obj', '.github', '.vscode'];
const DEFAULT_MAX_RESULTS = 500;
const MIN_MAX_RESULTS = 50;
const MAX_MAX_RESULTS = 1000;

interface IndexedSearchResultItem extends SearchResultItem {
    symbolNameLower: string;
}

export class SymbolIndexCache implements vscode.Disposable {
    private readonly searchersByKindId: Map<string, ISymbolSearcher>;
    private readonly symbolsByKindAndFile: Map<string, Map<string, IndexedSearchResultItem[]>>;
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly configWatcher: vscode.Disposable;
    private readonly indexStatusEmitter: vscode.EventEmitter<IndexStatus>;
    private readonly initialBuildPromise: Promise<void>;
    private updateQueue: Promise<void>;
    private excludedFolderSet: Set<string>;
    private indexStatus: IndexStatus;

    public constructor(searchers: ISymbolSearcher[]) {
        this.searchersByKindId = new Map(searchers.map((searcher) => [searcher.kind.id, searcher]));
        this.symbolsByKindAndFile = new Map();
        this.updateQueue = Promise.resolve();
        this.excludedFolderSet = this.getExcludedFolderSet();
        this.indexStatusEmitter = new vscode.EventEmitter<IndexStatus>();
        this.indexStatus = {
            isReady: false,
            isIndexing: false,
            totalFiles: 0,
            indexedFiles: 0
        };

        for (const searcher of searchers) {
            this.symbolsByKindAndFile.set(searcher.kind.id, new Map());
        }

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.cs');
        this.watcher.onDidCreate((uri) => {
            this.enqueueUpdate(async () => {
                await this.upsertFile(uri);
            });
        });
        this.watcher.onDidChange((uri) => {
            this.enqueueUpdate(async () => {
                await this.upsertFile(uri);
            });
        });
        this.watcher.onDidDelete((uri) => {
            this.enqueueUpdate(async () => {
                this.removeFile(uri);
            });
        });

        this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration(`${CONFIG_SECTION}.${EXCLUDE_FOLDERS_KEY}`)) {
                return;
            }

            this.enqueueUpdate(async () => {
                this.excludedFolderSet = this.getExcludedFolderSet();
                await this.rebuildIndex();
            });
        });

        this.initialBuildPromise = this.rebuildIndex();
    }

    public dispose(): void {
        this.watcher.dispose();
        this.configWatcher.dispose();
        this.indexStatusEmitter.dispose();
    }

    public get onDidChangeIndexStatus(): vscode.Event<IndexStatus> {
        return this.indexStatusEmitter.event;
    }

    public getIndexStatus(): IndexStatus {
        return this.indexStatus;
    }

    public async ensureReady(): Promise<void> {
        await this.initialBuildPromise;
        await this.updateQueue;
    }

    public async search(kindId: string, query: string, matchMode: SearchMatchMode = 'fuzzy'): Promise<SearchQueryResult> {
        await this.ensureReady();

        const symbolsByFile = this.symbolsByKindAndFile.get(kindId);
        if (!symbolsByFile) {
            return {
                items: [],
                isTruncated: false,
                maxResults: this.getMaxResults()
            };
        }

        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length === 0) {
            return {
                items: [],
                isTruncated: false,
                maxResults: this.getMaxResults()
            };
        }
        const maxResults = this.getMaxResults();

        const matched: SearchResultItem[] = [];
        for (const symbols of symbolsByFile.values()) {
            for (const symbol of symbols) {
                const symbolNameLower = symbol.symbolName.toLowerCase();
                const searchText = (symbol.searchText ?? '').toLowerCase();
                const isMatched = matchMode === 'exact'
                    ? this.isExactMatched(symbolNameLower, searchText, normalizedQuery)
                    : (symbolNameLower.includes(normalizedQuery) || searchText.includes(normalizedQuery));

                if (!isMatched) {
                    continue;
                }

                matched.push(symbol);
                if (matched.length >= maxResults) {
                    return {
                        items: matched,
                        isTruncated: true,
                        maxResults
                    };
                }
            }
        }

        return {
            items: matched,
            isTruncated: false,
            maxResults
        };
    }

    private isExactMatched(symbolNameLower: string, searchTextLower: string, queryLower: string): boolean {
        if (symbolNameLower === queryLower) {
            return true;
        }

        if (!searchTextLower) {
            return false;
        }

        const tokens = searchTextLower
            .split(/[\s,]+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0);

        return tokens.includes(queryLower);
    }

    private async buildInitialIndex(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.cs');
        const totalFiles = files.length;

        this.updateIndexStatus({
            isReady: false,
            isIndexing: true,
            totalFiles,
            indexedFiles: 0
        });

        for (let index = 0; index < files.length; index += 1) {
            await this.upsertFile(files[index]);

            const indexedFiles = index + 1;
            if (indexedFiles === totalFiles || indexedFiles % INITIAL_INDEX_BATCH_SIZE === 0) {
                this.updateIndexStatus({
                    isReady: false,
                    isIndexing: true,
                    totalFiles,
                    indexedFiles
                });
            }

            if (indexedFiles % INITIAL_INDEX_BATCH_SIZE === 0) {
                await this.yieldToEventLoop();
            }
        }

        this.updateIndexStatus({
            isReady: true,
            isIndexing: false,
            totalFiles,
            indexedFiles: totalFiles
        });
    }

    private async rebuildIndex(): Promise<void> {
        for (const mapByFile of this.symbolsByKindAndFile.values()) {
            mapByFile.clear();
        }
        await this.buildInitialIndex();
    }

    private updateIndexStatus(status: IndexStatus): void {
        this.indexStatus = status;
        this.indexStatusEmitter.fire(status);
    }

    private async upsertFile(uri: vscode.Uri): Promise<void> {
        if (this.isIgnoredUri(uri)) {
            this.removeFile(uri);
            return;
        }

        try {
            const fileBuffer = await vscode.workspace.fs.readFile(uri);
            const content = textDecoder.decode(fileBuffer);
            const relativePath = vscode.workspace.asRelativePath(uri);
            const projectName = vscode.workspace.getWorkspaceFolder(uri)?.name ?? '';
            const uriKey = uri.toString();
            const byKind = new Map<string, IndexedSearchResultItem[]>();

            for (const searcher of this.searchersByKindId.values()) {
                const symbols = searcher
                    .searchInContent(content, uri, relativePath, '')
                    .map((item) => {
                        const searchSource = item.searchText ?? item.symbolName.toLowerCase();
                        return {
                            ...item,
                            projectName,
                            symbolNameLower: searchSource
                        };
                    });
                byKind.set(searcher.kind.id, symbols);
            }

            this.removeFile(uri);

            for (const [kindId, symbols] of byKind.entries()) {
                const symbolsByFile = this.symbolsByKindAndFile.get(kindId);
                if (!symbolsByFile) {
                    continue;
                }

                symbolsByFile.set(uriKey, symbols);
            }
        } catch {
            this.removeFile(uri);
        }
    }

    private removeFile(uri: vscode.Uri): void {
        const uriKey = uri.toString();
        for (const symbolsByFile of this.symbolsByKindAndFile.values()) {
            symbolsByFile.delete(uriKey);
        }
    }

    private enqueueUpdate(task: () => Promise<void>): void {
        this.updateQueue = this.updateQueue
            .then(task)
            .catch(() => undefined);
    }

    private isIgnoredUri(uri: vscode.Uri): boolean {
        const relativePath = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
        const segments = relativePath.split('/').map((segment) => segment.trim().toLowerCase()).filter((segment) => segment.length > 0);
        return segments.some((segment) => this.excludedFolderSet.has(segment));
    }

    private getExcludedFolderSet(): Set<string> {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredFolders = configuration.get<string[]>(EXCLUDE_FOLDERS_KEY, DEFAULT_EXCLUDED_FOLDERS);
        const normalized = configuredFolders
            .map((folder) => folder.trim().toLowerCase())
            .filter((folder) => folder.length > 0);

        return new Set(normalized);
    }

    private getMaxResults(): number {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredValue = configuration.get<number>(MAX_RESULTS_KEY, DEFAULT_MAX_RESULTS);

        if (typeof configuredValue !== 'number' || Number.isNaN(configuredValue)) {
            return DEFAULT_MAX_RESULTS;
        }

        return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.round(configuredValue)));
    }

    private async yieldToEventLoop(): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
}
