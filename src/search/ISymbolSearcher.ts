import * as vscode from 'vscode';
import { SearchKindDefinition, SearchResultItem } from './types';

export interface ISymbolSearcher {
    readonly kind: SearchKindDefinition;
    searchInContent(content: string, uri: vscode.Uri, relativePath: string, query: string): SearchResultItem[];
}
