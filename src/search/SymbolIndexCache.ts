import * as vscode from 'vscode';
import { ISymbolSearcher } from './ISymbolSearcher';
import { SearchResultItem } from './types';

const textDecoder = new TextDecoder('utf-8');
const INITIAL_INDEX_BATCH_SIZE = 20;

export class SymbolIndexCache implements vscode.Disposable {
    private readonly searchersByKindId: Map<string, ISymbolSearcher>;
    private readonly symbolsByFile: Map<string, Map<string, SearchResultItem[]>>;
    private readonly symbolsByKind: Map<string, SearchResultItem[]>;
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly initialBuildPromise: Promise<void>;
    private updateQueue: Promise<void>;

    public constructor(searchers: ISymbolSearcher[]) {
        this.searchersByKindId = new Map(searchers.map((searcher) => [searcher.kind.id, searcher]));
        this.symbolsByFile = new Map();
        this.symbolsByKind = new Map();
        this.updateQueue = Promise.resolve();

        for (const searcher of searchers) {
            this.symbolsByKind.set(searcher.kind.id, []);
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

        this.initialBuildPromise = this.buildInitialIndex();
    }

    public dispose(): void {
        this.watcher.dispose();
    }

    public async ensureReady(): Promise<void> {
        await this.initialBuildPromise;
        await this.updateQueue;
    }

    public async search(kindId: string, query: string): Promise<SearchResultItem[]> {
        await this.ensureReady();

        const allSymbols = this.symbolsByKind.get(kindId);
        if (!allSymbols) {
            return [];
        }

        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length === 0) {
            return [];
        }

        const matched = allSymbols.filter((item) => item.symbolName.toLowerCase().includes(normalizedQuery));
        return matched.slice(0, 500);
    }

    private async buildInitialIndex(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.cs', '**/{bin,obj}/**');

        for (let index = 0; index < files.length; index += 1) {
            await this.upsertFile(files[index]);

            if ((index + 1) % INITIAL_INDEX_BATCH_SIZE === 0) {
                await this.yieldToEventLoop();
            }
        }
    }

    private async upsertFile(uri: vscode.Uri): Promise<void> {
        if (this.isIgnoredUri(uri)) {
            return;
        }

        this.removeFile(uri);

        try {
            const fileBuffer = await vscode.workspace.fs.readFile(uri);
            const content = textDecoder.decode(fileBuffer);
            const relativePath = vscode.workspace.asRelativePath(uri);
            const uriKey = uri.toString();
            const byKind = new Map<string, SearchResultItem[]>();

            for (const searcher of this.searchersByKindId.values()) {
                const symbols = searcher.searchInContent(content, uri, relativePath, '');
                byKind.set(searcher.kind.id, symbols);
            }

            this.symbolsByFile.set(uriKey, byKind);

            for (const [kindId, symbols] of byKind.entries()) {
                const existing = this.symbolsByKind.get(kindId) ?? [];
                this.symbolsByKind.set(kindId, existing.concat(symbols));
            }
        } catch {
            this.removeFile(uri);
        }
    }

    private removeFile(uri: vscode.Uri): void {
        const uriKey = uri.toString();
        this.symbolsByFile.delete(uriKey);

        for (const [kindId, symbols] of this.symbolsByKind.entries()) {
            const filtered = symbols.filter((item) => item.uri.toString() !== uriKey);
            this.symbolsByKind.set(kindId, filtered);
        }
    }

    private enqueueUpdate(task: () => Promise<void>): void {
        this.updateQueue = this.updateQueue
            .then(task)
            .catch(() => undefined);
    }

    private isIgnoredUri(uri: vscode.Uri): boolean {
        const relativePath = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
        return relativePath.includes('/bin/') || relativePath.includes('/obj/');
    }

    private async yieldToEventLoop(): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
}
