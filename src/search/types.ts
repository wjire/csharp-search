import * as vscode from 'vscode';

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
}

export interface SerializableSearchResultItem {
    kindId: string;
    symbolName: string;
    preview: string;
    line: number;
    uri: string;
    relativePath: string;
}
