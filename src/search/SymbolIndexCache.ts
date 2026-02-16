import * as vscode from 'vscode';
import { ISymbolSearcher } from './ISymbolSearcher';
import { SearchResultItem } from './types';

const textDecoder = new TextDecoder('utf-8');
const INITIAL_INDEX_BATCH_SIZE = 20;
const CONFIG_SECTION = 'csharpSearch';
const EXCLUDE_FOLDERS_KEY = 'excludeFolders';
const DEFAULT_EXCLUDED_FOLDERS = ['bin', 'obj', '.github', '.vscode'];

interface IndexedSearchResultItem extends SearchResultItem {
    symbolNameLower: string;
}

export class SymbolIndexCache implements vscode.Disposable {
    private readonly searchersByKindId: Map<string, ISymbolSearcher>;
    private readonly symbolsByKindAndFile: Map<string, Map<string, IndexedSearchResultItem[]>>;
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly configWatcher: vscode.Disposable;
    private readonly initialBuildPromise: Promise<void>;
    private updateQueue: Promise<void>;
    private excludedFolderSet: Set<string>;

    public constructor(searchers: ISymbolSearcher[]) {
        this.searchersByKindId = new Map(searchers.map((searcher) => [searcher.kind.id, searcher]));
        this.symbolsByKindAndFile = new Map();
        this.updateQueue = Promise.resolve();
        this.excludedFolderSet = this.getExcludedFolderSet();

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
    }

    public async ensureReady(): Promise<void> {
        await this.initialBuildPromise;
        await this.updateQueue;
    }

    public async search(kindId: string, query: string): Promise<SearchResultItem[]> {
        await this.ensureReady();

        const symbolsByFile = this.symbolsByKindAndFile.get(kindId);
        if (!symbolsByFile) {
            return [];
        }

        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length === 0) {
            return [];
        }

        const matched: SearchResultItem[] = [];
        for (const symbols of symbolsByFile.values()) {
            for (const symbol of symbols) {
                if (!symbol.symbolNameLower.includes(normalizedQuery)) {
                    continue;
                }

                matched.push(symbol);
                if (matched.length >= 500) {
                    return matched;
                }
            }
        }

        return matched;
    }

    private async buildInitialIndex(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.cs');

        for (let index = 0; index < files.length; index += 1) {
            await this.upsertFile(files[index]);

            if ((index + 1) % INITIAL_INDEX_BATCH_SIZE === 0) {
                await this.yieldToEventLoop();
            }
        }
    }

    private async rebuildIndex(): Promise<void> {
        for (const mapByFile of this.symbolsByKindAndFile.values()) {
            mapByFile.clear();
        }
        await this.buildInitialIndex();
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
                    .map((item) => ({
                        ...item,
                        projectName,
                        symbolNameLower: item.symbolName.toLowerCase()
                    }));
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

    private async yieldToEventLoop(): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
}
