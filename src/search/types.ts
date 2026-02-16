import * as vscode from 'vscode';

export type SearchMatchMode = 'fuzzy' | 'exact';

export interface SearchKindDefinition {
    id: string;
    label: string;
}

export interface SearchResultItem {
    kindId: string;
    symbolName: string;
    preview: string;
    line: number;
    uri: vscode.Uri;
    relativePath: string;
    projectName: string;
    ownerTypeName?: string;
}

export interface SerializableSearchResultItem {
    kindId: string;
    symbolName: string;
    preview: string;
    line: number;
    uri: string;
    relativePath: string;
    projectName: string;
    ownerTypeName?: string;
}
