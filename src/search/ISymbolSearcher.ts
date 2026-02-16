import * as vscode from 'vscode';
import { SearchKindDefinition, SearchResultItem } from './types';

export interface ISymbolSearcher {
    readonly kind: SearchKindDefinition;
    searchInDocument(document: vscode.TextDocument, query: string): SearchResultItem[];
}
