import { availableParallelism, cpus } from 'os';
import { setTimeout as delay } from 'timers/promises';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { ISymbolSearcher } from './ISymbolSearcher';
import { IndexStatus, SearchMatchMode, SearchQueryResult, SearchResultItem } from './types';

const textDecoder = new TextDecoder('utf-8');
const INITIAL_INDEX_BATCH_SIZE = 40;
const INITIAL_INDEX_MIN_CONCURRENCY = 2;
const INITIAL_INDEX_MAX_CONCURRENCY = 12;
const CONFIG_SECTION = 'csharpSearch';
const EXCLUDE_FOLDERS_KEY = 'excludeFolders';
const MAX_RESULTS_KEY = 'maxResults';
const UPDATE_DEBOUNCE_MS_KEY = 'updateDebounceMs';
const PERSIST_DEBOUNCE_MS_KEY = 'persistDebounceMs';
const DEFAULT_EXCLUDED_FOLDERS = ['bin', 'obj', '.git', '.github', '.vscode'];
const DEFAULT_MAX_RESULTS = 500;
const MIN_MAX_RESULTS = 50;
const MAX_MAX_RESULTS = 1000;
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_UPDATE_DEBOUNCE_MS = 900;
const MIN_UPDATE_DEBOUNCE_MS = 0;
const MAX_UPDATE_DEBOUNCE_MS = 5000;
const DEFAULT_PERSIST_DEBOUNCE_MS = 1200;
const MIN_PERSIST_DEBOUNCE_MS = 0;
const MAX_PERSIST_DEBOUNCE_MS = 10000;
const SEARCH_RULES_VERSION = '2026-07-18-method-search-v2';

interface SymbolIndexCacheOptions {
    cacheFileUri?: vscode.Uri;
    extensionVersion?: string;
    workspaceKey?: string;
}

interface IndexedSearchResultItem extends SearchResultItem {
    symbolNameLower: string;
    searchTextLower: string;
}

interface PersistedIndexedSearchResultItem {
    kindId: string;
    symbolName: string;
    searchText?: string;
    preview: string;
    line: number;
    uri: string;
    relativePath: string;
    projectName: string;
    ownerTypeName?: string;
    symbolNameLower: string;
    searchTextLower: string;
}

interface PersistedIndexCache {
    schemaVersion: number;
    extensionVersion: string;
    workspaceKey: string;
    validationKey: string;
    savedAt: number;
    totalFiles: number;
    indexedFiles: number;
    byKind: Record<string, Record<string, PersistedIndexedSearchResultItem[]>>;
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
    private readonly cacheFileUri: vscode.Uri | undefined;
    private readonly extensionVersion: string;
    private readonly workspaceKey: string;
    private updateTimer: NodeJS.Timeout | undefined;
    private persistTimer: NodeJS.Timeout | undefined;
    private readonly pendingUpsertUris: Set<string>;
    private readonly pendingDeleteUris: Set<string>;

    public constructor(searchers: ISymbolSearcher[], options?: SymbolIndexCacheOptions) {
        this.searchersByKindId = new Map(searchers.map((searcher) => [searcher.kind.id, searcher]));
        this.symbolsByKindAndFile = new Map();
        this.updateQueue = Promise.resolve();
        this.excludedFolderSet = this.getExcludedFolderSet();
        this.cacheFileUri = options?.cacheFileUri;
        this.extensionVersion = typeof options?.extensionVersion === 'string' ? options.extensionVersion : '0.0.0';
        this.workspaceKey = typeof options?.workspaceKey === 'string' ? options.workspaceKey : '';
        this.updateTimer = undefined;
        this.persistTimer = undefined;
        this.pendingUpsertUris = new Set();
        this.pendingDeleteUris = new Set();
        this.indexStatusEmitter = new vscode.EventEmitter<IndexStatus>();
        this.indexStatus = {
            isReady: false,
            isIndexing: false,
            totalFiles: 0,
            indexedFiles: 0,
            isFreshBuild: false
        };

        for (const searcher of searchers) {
            this.symbolsByKindAndFile.set(searcher.kind.id, new Map());
        }

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.cs');
        this.watcher.onDidCreate((uri) => {
            this.scheduleDebouncedUpsert(uri);
        });
        this.watcher.onDidChange((uri) => {
            this.scheduleDebouncedUpsert(uri);
        });
        this.watcher.onDidDelete((uri) => {
            this.scheduleDebouncedDelete(uri);
        });

        this.configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            const affectsExcludeFolders = event.affectsConfiguration(`${CONFIG_SECTION}.${EXCLUDE_FOLDERS_KEY}`);
            const affectsUpdateDebounce = event.affectsConfiguration(`${CONFIG_SECTION}.${UPDATE_DEBOUNCE_MS_KEY}`);
            const affectsPersistDebounce = event.affectsConfiguration(`${CONFIG_SECTION}.${PERSIST_DEBOUNCE_MS_KEY}`);

            if (!affectsExcludeFolders && !affectsUpdateDebounce && !affectsPersistDebounce) {
                return;
            }

            if (affectsExcludeFolders) {
                this.enqueueUpdate(async () => {
                    this.excludedFolderSet = this.getExcludedFolderSet();
                    await this.rebuildIndex();
                    this.schedulePersist();
                });
                return;
            }

            if (affectsUpdateDebounce && this.updateTimer && (this.pendingUpsertUris.size > 0 || this.pendingDeleteUris.size > 0)) {
                this.scheduleDebouncedUpdateFlush();
            }

            if (affectsPersistDebounce && this.persistTimer) {
                this.schedulePersist();
            }
        });

        this.initialBuildPromise = this.initializeIndex();
    }

    public dispose(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
        }

        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
        }

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
                const isMatched = matchMode === 'exact'
                    ? this.isExactMatched(symbol.symbolNameLower, symbol.searchTextLower, normalizedQuery)
                    : (symbol.symbolNameLower.includes(normalizedQuery) || symbol.searchTextLower.includes(normalizedQuery));

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

    private async initializeIndex(): Promise<void> {
        const restored = await this.tryLoadFromCache();
        if (restored) {
            return;
        }

        await this.rebuildIndex(true);
    }

    private async buildInitialIndex(isFreshBuild: boolean): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.cs', this.getFindFilesExcludeGlob());
        const totalFiles = files.length;

        this.updateIndexStatus({
            isReady: false,
            isIndexing: true,
            totalFiles,
            indexedFiles: 0,
            isFreshBuild
        });

        for (let index = 0; index < files.length; index += INITIAL_INDEX_BATCH_SIZE) {
            const batch = files.slice(index, index + INITIAL_INDEX_BATCH_SIZE);
            await this.upsertFiles(batch);

            const indexedFiles = Math.min(totalFiles, index + batch.length);
            this.updateIndexStatus({
                isReady: false,
                isIndexing: true,
                totalFiles,
                indexedFiles,
                isFreshBuild
            });

            if (indexedFiles < totalFiles) {
                await this.yieldToEventLoop();
            }
        }

        this.updateIndexStatus({
            isReady: true,
            isIndexing: false,
            totalFiles,
            indexedFiles: totalFiles,
            isFreshBuild: false
        });
    }

    private async rebuildIndex(isFreshBuild: boolean = false): Promise<void> {
        for (const mapByFile of this.symbolsByKindAndFile.values()) {
            mapByFile.clear();
        }
        await this.buildInitialIndex(isFreshBuild);
        this.schedulePersist();
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
                        return {
                            ...item,
                            projectName,
                            symbolNameLower: item.symbolName.toLowerCase(),
                            searchTextLower: (item.searchText ?? '').toLowerCase()
                        };
                    });
                byKind.set(searcher.kind.id, symbols);
            }

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

    private async upsertFiles(uris: readonly vscode.Uri[]): Promise<void> {
        const workerCount = Math.min(this.getInitialIndexConcurrency(), uris.length);
        if (workerCount <= 0) {
            return;
        }

        let nextIndex = 0;
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (nextIndex < uris.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                const uri = uris[currentIndex];
                if (uri) {
                    await this.upsertFile(uri);
                }
            }
        }));
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

    private scheduleDebouncedUpsert(uri: vscode.Uri): void {
        const uriKey = uri.toString();
        this.pendingDeleteUris.delete(uriKey);
        this.pendingUpsertUris.add(uriKey);
        this.scheduleDebouncedUpdateFlush();
    }

    private scheduleDebouncedDelete(uri: vscode.Uri): void {
        const uriKey = uri.toString();
        this.pendingUpsertUris.delete(uriKey);
        this.pendingDeleteUris.add(uriKey);
        this.scheduleDebouncedUpdateFlush();
    }

    private scheduleDebouncedUpdateFlush(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        const debounceMs = this.getUpdateDebounceMs();
        this.updateTimer = setTimeout(() => {
            this.updateTimer = undefined;
            this.flushPendingFileUpdates();
        }, debounceMs);
    }

    private flushPendingFileUpdates(): void {
        if (!this.pendingUpsertUris.size && !this.pendingDeleteUris.size) {
            return;
        }

        const deleteUris = Array.from(this.pendingDeleteUris.values());
        const upsertUris = Array.from(this.pendingUpsertUris.values());
        this.pendingDeleteUris.clear();
        this.pendingUpsertUris.clear();

        this.enqueueUpdate(async () => {
            for (const uriText of deleteUris) {
                this.removeFile(vscode.Uri.parse(uriText));
            }

            const upsertParsedUris = upsertUris.map((uriText) => vscode.Uri.parse(uriText));
            await this.upsertFiles(upsertParsedUris);
            this.schedulePersist();
        });
    }

    private schedulePersist(): void {
        if (!this.cacheFileUri) {
            return;
        }

        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
        }

        const debounceMs = this.getPersistDebounceMs();
        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            void this.persistCacheToDisk();
        }, debounceMs);
    }

    private async tryLoadFromCache(): Promise<boolean> {
        if (!this.cacheFileUri) {
            return false;
        }

        try {
            const content = await vscode.workspace.fs.readFile(this.cacheFileUri);
            const parsed = JSON.parse(textDecoder.decode(content)) as PersistedIndexCache;
            if (!this.isCacheValid(parsed)) {
                return false;
            }

            this.restoreFromCache(parsed);
            return true;
        } catch {
            return false;
        }
    }

    private isCacheValid(data: PersistedIndexCache | undefined): boolean {
        if (!data || typeof data !== 'object') {
            return false;
        }

        if (data.schemaVersion !== CACHE_SCHEMA_VERSION) {
            return false;
        }

        if (data.extensionVersion !== this.extensionVersion) {
            return false;
        }

        if (data.workspaceKey !== this.workspaceKey) {
            return false;
        }

        if (data.validationKey !== this.getValidationKey()) {
            return false;
        }

        return typeof data.byKind === 'object' && data.byKind !== null;
    }

    private restoreFromCache(data: PersistedIndexCache): void {
        for (const mapByFile of this.symbolsByKindAndFile.values()) {
            mapByFile.clear();
        }

        const byKind = data.byKind ?? {};
        for (const [kindId, symbolsByFileObject] of Object.entries(byKind)) {
            const symbolsByFile = this.symbolsByKindAndFile.get(kindId);
            if (!symbolsByFile || !symbolsByFileObject || typeof symbolsByFileObject !== 'object') {
                continue;
            }

            for (const [uriKey, items] of Object.entries(symbolsByFileObject)) {
                if (!Array.isArray(items)) {
                    continue;
                }

                const restoredItems: IndexedSearchResultItem[] = [];
                for (const item of items) {
                    if (!item || typeof item !== 'object' || typeof item.uri !== 'string') {
                        continue;
                    }

                    try {
                        restoredItems.push({
                            kindId: item.kindId,
                            symbolName: item.symbolName,
                            searchText: item.searchText,
                            preview: item.preview,
                            line: Number.isFinite(item.line) ? Math.max(0, Math.round(item.line)) : 0,
                            uri: vscode.Uri.parse(item.uri),
                            relativePath: item.relativePath,
                            projectName: item.projectName,
                            ownerTypeName: item.ownerTypeName,
                            symbolNameLower: item.symbolNameLower,
                            searchTextLower: item.searchTextLower
                        });
                    } catch {
                        // Skip malformed entries.
                    }
                }

                symbolsByFile.set(uriKey, restoredItems);
            }
        }

        const totalFiles = Number.isFinite(data.totalFiles) ? Math.max(0, Math.round(data.totalFiles)) : this.countIndexedFiles();
        const indexedFiles = Number.isFinite(data.indexedFiles)
            ? Math.max(0, Math.min(totalFiles || Number.MAX_SAFE_INTEGER, Math.round(data.indexedFiles)))
            : totalFiles;

        this.updateIndexStatus({
            isReady: true,
            isIndexing: false,
            totalFiles,
            indexedFiles
        });
    }

    private countIndexedFiles(): number {
        const firstKindMap = this.symbolsByKindAndFile.values().next().value as Map<string, IndexedSearchResultItem[]> | undefined;
        return firstKindMap ? firstKindMap.size : 0;
    }

    private getValidationKey(): string {
        return `${this.stableKeyFromSet(this.excludedFolderSet)}|rules:${SEARCH_RULES_VERSION}`;
    }

    private stableKeyFromSet(values: Set<string>): string {
        return Array.from(values.values()).sort().join('|');
    }

    private async persistCacheToDisk(): Promise<void> {
        if (!this.cacheFileUri) {
            return;
        }

        try {
            const parentUri = this.getParentUri(this.cacheFileUri);
            await vscode.workspace.fs.createDirectory(parentUri);

            const payload: PersistedIndexCache = {
                schemaVersion: CACHE_SCHEMA_VERSION,
                extensionVersion: this.extensionVersion,
                workspaceKey: this.workspaceKey,
                validationKey: this.getValidationKey(),
                savedAt: Date.now(),
                totalFiles: this.indexStatus.totalFiles,
                indexedFiles: this.indexStatus.indexedFiles,
                byKind: this.serializeByKind()
            };

            const tempUri = this.cacheFileUri.with({ path: `${this.cacheFileUri.path}.tmp` });
            await vscode.workspace.fs.writeFile(tempUri, Buffer.from(JSON.stringify(payload), 'utf8'));
            await vscode.workspace.fs.rename(tempUri, this.cacheFileUri, { overwrite: true });
        } catch {
            // Ignore persistence failures to avoid blocking search flow.
        }
    }

    private getParentUri(fileUri: vscode.Uri): vscode.Uri {
        const path = fileUri.path;
        const separatorIndex = path.lastIndexOf('/');
        const parentPath = separatorIndex > 0 ? path.slice(0, separatorIndex) : '/';
        return fileUri.with({ path: parentPath });
    }

    private serializeByKind(): Record<string, Record<string, PersistedIndexedSearchResultItem[]>> {
        const result: Record<string, Record<string, PersistedIndexedSearchResultItem[]>> = {};

        for (const [kindId, symbolsByFile] of this.symbolsByKindAndFile.entries()) {
            const byFile: Record<string, PersistedIndexedSearchResultItem[]> = {};
            for (const [uriKey, symbols] of symbolsByFile.entries()) {
                byFile[uriKey] = symbols.map((symbol) => ({
                    kindId: symbol.kindId,
                    symbolName: symbol.symbolName,
                    searchText: symbol.searchText,
                    preview: symbol.preview,
                    line: symbol.line,
                    uri: symbol.uri.toString(),
                    relativePath: symbol.relativePath,
                    projectName: symbol.projectName,
                    ownerTypeName: symbol.ownerTypeName,
                    symbolNameLower: symbol.symbolNameLower,
                    searchTextLower: symbol.searchTextLower
                }));
            }

            result[kindId] = byFile;
        }

        return result;
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

    private getFindFilesExcludeGlob(): string | undefined {
        const folders = Array.from(this.excludedFolderSet.values());
        if (!folders.length) {
            return undefined;
        }

        const escapedFolders = folders.map((folder) => folder.replace(/[{}\\,]/g, '\\$&'));
        return `**/{${escapedFolders.join(',')}}/**`;
    }

    private getMaxResults(): number {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredValue = configuration.get<number>(MAX_RESULTS_KEY, DEFAULT_MAX_RESULTS);

        if (typeof configuredValue !== 'number' || Number.isNaN(configuredValue)) {
            return DEFAULT_MAX_RESULTS;
        }

        return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.round(configuredValue)));
    }

    private getUpdateDebounceMs(): number {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredValue = configuration.get<number>(UPDATE_DEBOUNCE_MS_KEY, DEFAULT_UPDATE_DEBOUNCE_MS);

        if (typeof configuredValue !== 'number' || Number.isNaN(configuredValue)) {
            return DEFAULT_UPDATE_DEBOUNCE_MS;
        }

        return Math.min(MAX_UPDATE_DEBOUNCE_MS, Math.max(MIN_UPDATE_DEBOUNCE_MS, Math.round(configuredValue)));
    }

    private getPersistDebounceMs(): number {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredValue = configuration.get<number>(PERSIST_DEBOUNCE_MS_KEY, DEFAULT_PERSIST_DEBOUNCE_MS);

        if (typeof configuredValue !== 'number' || Number.isNaN(configuredValue)) {
            return DEFAULT_PERSIST_DEBOUNCE_MS;
        }

        return Math.min(MAX_PERSIST_DEBOUNCE_MS, Math.max(MIN_PERSIST_DEBOUNCE_MS, Math.round(configuredValue)));
    }

    private getInitialIndexConcurrency(): number {
        const parallelism = typeof availableParallelism === 'function'
            ? availableParallelism()
            : cpus().length;

        if (!Number.isFinite(parallelism) || parallelism <= 0) {
            return INITIAL_INDEX_MIN_CONCURRENCY;
        }

        const tuned = Math.round(parallelism * 0.75);
        return Math.min(INITIAL_INDEX_MAX_CONCURRENCY, Math.max(INITIAL_INDEX_MIN_CONCURRENCY, tuned));
    }

    private async yieldToEventLoop(): Promise<void> {
        await delay(0);
    }
}
