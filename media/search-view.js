const vscode = acquireVsCodeApi();

const state = {
    activeKindId: '',
    query: '',
    matchMode: 'fuzzy',
    requestId: 0,
    lastCompletedRequestId: '',
    lastCompletedQuery: '',
    lastCompletedKindId: '',
    lastCompletedMatchMode: 'fuzzy',
    workspaceSupported: true,
    searchDebounceMs: 300,
    pageSize: 100,
    resultTreeIcons: {
        fileIconDataUri: '',
        folderIconDataUri: '',
        folderExpandedIconDataUri: ''
    },
    kinds: [],
    texts: {},
    displayedItems: [],
    expandedNodeState: {},
    totalResults: 0,
    loadedResults: 0,
    isTruncated: false,
    maxResults: 0,
    hasMore: false,
    isLoadingMore: false,
    isPreparingGlobalToggle: false,
    pendingGlobalExpandState: undefined,
    selectedResultKey: '',
    selectedItem: undefined,
    indexStatus: {
        isReady: false,
        isIndexing: true,
        totalFiles: 0,
        indexedFiles: 0
    }
};

const MIN_SEARCH_DEBOUNCE_MS = 0;
const MAX_SEARCH_DEBOUNCE_MS = 1000;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;
const INDEX_READY_HINT_MS = 1500;
const INDEXING_SEARCH_REFRESH_MS = 180;
const LOAD_MORE_BOTTOM_GAP_PX = 120;

let searchDebounceTimer = undefined;
let indexReadyHintTimer = undefined;
let indexingSearchRefreshTimer = undefined;
let lastIndexingSearchRefreshAt = 0;

const tabsEl = document.getElementById('tabs');
const searchBoxEl = document.querySelector('.search-box');
const queryInputEl = document.getElementById('queryInput');
const clearQueryBtnEl = document.getElementById('clearQueryBtn');
const matchModeGroupEl = document.getElementById('matchModeGroup');
const fuzzyModeBtnEl = document.getElementById('fuzzyModeBtn');
const exactModeBtnEl = document.getElementById('exactModeBtn');
const toggleExpandBtnEl = document.getElementById('toggleExpandBtn');
const toggleExpandIconEl = document.getElementById('toggleExpandIcon');
const resultsScrollEl = document.getElementById('resultsScroll');
const resultListEl = document.getElementById('resultList');
const resultMetaEl = document.getElementById('resultMeta');
const resultsPaneTitleEl = document.getElementById('resultsPaneTitle');

function getKindLabel(kind) {
    return kind?.label ?? '';
}

function getText(key, fallback) {
    const value = state.texts?.[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function formatText(template, ...args) {
    let text = template;
    args.forEach((arg, index) => {
        text = text.replace(`{${index}}`, String(arg));
    });
    return text;
}

function resetPagingState() {
    state.displayedItems = [];
    state.totalResults = 0;
    state.loadedResults = 0;
    state.isTruncated = false;
    state.maxResults = 0;
    state.hasMore = false;
    state.isLoadingMore = false;
    state.isPreparingGlobalToggle = false;
    state.pendingGlobalExpandState = undefined;
    state.selectedResultKey = '';
    state.selectedItem = undefined;
}

function clearPendingGlobalToggle() {
    state.isPreparingGlobalToggle = false;
    state.pendingGlobalExpandState = undefined;
}

function renderTabs() {
    tabsEl.innerHTML = '';

    state.kinds.forEach((kind) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tab-btn${kind.id === state.activeKindId ? ' active' : ''}`;

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = getKindLabel(kind);

        button.appendChild(label);

        button.addEventListener('click', () => {
            state.activeKindId = kind.id;
            renderTabs();
            updateInputPlaceholder();
            triggerSearch();
        });
        tabsEl.appendChild(button);
    });
}

function getPlaceholderByKind(kindId) {
    if (kindId === 'type') {
        return getText('input.placeholder.type', getText('input.placeholder', 'Enter keyword'));
    }

    if (kindId === 'method') {
        return getText('input.placeholder.method', getText('input.placeholder', 'Enter keyword'));
    }

    if (kindId === 'member') {
        return getText('input.placeholder.member', getText('input.placeholder', 'Enter keyword'));
    }

    return getText('input.placeholder', 'Enter keyword');
}

function updateInputPlaceholder() {
    queryInputEl.placeholder = getPlaceholderByKind(state.activeKindId);
}

function normalizeIndexStatus(status) {
    if (!status || typeof status !== 'object') {
        return {
            isReady: false,
            isIndexing: true,
            totalFiles: 0,
            indexedFiles: 0
        };
    }

    const totalFiles = Number.isFinite(status.totalFiles) ? Math.max(0, Math.round(status.totalFiles)) : 0;
    const indexedFiles = Number.isFinite(status.indexedFiles)
        ? Math.max(0, Math.min(totalFiles || Number.MAX_SAFE_INTEGER, Math.round(status.indexedFiles)))
        : 0;

    return {
        isReady: status.isReady === true,
        isIndexing: status.isIndexing === true,
        totalFiles,
        indexedFiles: totalFiles > 0 ? Math.min(indexedFiles, totalFiles) : indexedFiles,
        isFreshBuild: status.isFreshBuild === true
    };
}

function normalizeResultTreeIcons(icons) {
    if (!icons || typeof icons !== 'object') {
        return {
            fileIconDataUri: '',
            folderIconDataUri: '',
            folderExpandedIconDataUri: ''
        };
    }

    return {
        fileIconDataUri: typeof icons.fileIconDataUri === 'string' ? icons.fileIconDataUri : '',
        folderIconDataUri: typeof icons.folderIconDataUri === 'string' ? icons.folderIconDataUri : '',
        folderExpandedIconDataUri: typeof icons.folderExpandedIconDataUri === 'string' ? icons.folderExpandedIconDataUri : ''
    };
}

function createTreeIconSpan(className) {
    const icon = document.createElement('span');
    icon.className = className;
    return icon;
}

function createImageIcon(className, dataUri, fallbackText) {
    const icon = createTreeIconSpan(className);
    if (typeof dataUri === 'string' && dataUri.length > 0) {
        icon.classList.add('result-tree-icon--image');
        icon.style.backgroundImage = `url(${dataUri})`;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }

    icon.textContent = fallbackText;
    return icon;
}

function getIndexingMetaText() {
    const { indexedFiles, totalFiles, isFreshBuild } = state.indexStatus;

    if (isFreshBuild) {
        if (totalFiles > 0) {
            return formatText(
                getText('meta.firstIndexingProgress', 'This workspace is building its first index ({0}/{1}). First run may take longer, please wait...'),
                indexedFiles,
                totalFiles
            );
        }

        return getText('meta.firstIndexing', 'This workspace is building its first index. It may take longer, please wait...');
    }

    if (totalFiles > 0) {
        return formatText(
            getText('meta.indexingProgress', 'Building index ({0}/{1}), search will run automatically'),
            indexedFiles,
            totalFiles
        );
    }

    return getText('meta.indexing', 'Building index, please wait...');
}

function clearIndexReadyHintTimer() {
    if (!indexReadyHintTimer) {
        return;
    }

    clearTimeout(indexReadyHintTimer);
    indexReadyHintTimer = undefined;
}

function clearIndexingSearchRefreshTimer() {
    if (!indexingSearchRefreshTimer) {
        return;
    }

    clearTimeout(indexingSearchRefreshTimer);
    indexingSearchRefreshTimer = undefined;
}

function showIndexReadyHint() {
    clearIndexReadyHintTimer();

    const hintText = getText('meta.indexReady', 'Index is ready');
    resultMetaEl.textContent = hintText;

    indexReadyHintTimer = setTimeout(() => {
        indexReadyHintTimer = undefined;
        if (resultMetaEl.textContent === hintText) {
            resultMetaEl.textContent = '';
        }
    }, INDEX_READY_HINT_MS);
}

function scheduleIndexingSearchRefresh() {
    if (!state.workspaceSupported || !state.activeKindId || queryInputEl.value.trim().length === 0) {
        return;
    }

    const now = Date.now();
    const elapsed = now - lastIndexingSearchRefreshAt;
    if (elapsed >= INDEXING_SEARCH_REFRESH_MS) {
        lastIndexingSearchRefreshAt = now;
        triggerSearch({ preserveResults: true });
        return;
    }

    if (indexingSearchRefreshTimer) {
        return;
    }

    indexingSearchRefreshTimer = setTimeout(() => {
        indexingSearchRefreshTimer = undefined;
        lastIndexingSearchRefreshAt = Date.now();
        triggerSearch({ preserveResults: true });
    }, Math.max(16, INDEXING_SEARCH_REFRESH_MS - elapsed));
}

function triggerSearch(options = {}) {
    const preserveResults = options.preserveResults === true;

    clearIndexReadyHintTimer();
    clearIndexingSearchRefreshTimer();

    if (!state.workspaceSupported) {
        renderUnsupportedWorkspaceHint();
        return;
    }

    state.query = queryInputEl.value.trim();
    updateClearButtonVisibility();

    if (!state.activeKindId || !state.query) {
        resultListEl.innerHTML = '';
        resetPagingState();
        resultMetaEl.textContent = '';
        return;
    }

    const currentRequestId = String(++state.requestId);
    if (!preserveResults) {
        resetPagingState();
    }

    resultMetaEl.textContent = state.indexStatus.isReady
        ? getText('meta.searching', 'Searching...')
        : getIndexingMetaText();
    lastIndexingSearchRefreshAt = Date.now();
    vscode.postMessage({
        type: 'search',
        kindId: state.activeKindId,
        query: state.query,
        matchMode: state.matchMode,
        previousRequestId: state.lastCompletedRequestId,
        previousQuery: state.lastCompletedQuery,
        requestId: currentRequestId
    });
}

function setMatchMode(matchMode) {
    state.matchMode = matchMode === 'exact' ? 'exact' : 'fuzzy';
    fuzzyModeBtnEl?.classList.toggle('active', state.matchMode === 'fuzzy');
    exactModeBtnEl?.classList.toggle('active', state.matchMode === 'exact');
}

function updateExpandToggleButton() {
    if (!toggleExpandBtnEl || !toggleExpandIconEl) {
        return;
    }

    if (state.isPreparingGlobalToggle) {
        toggleExpandBtnEl.disabled = true;
        toggleExpandIconEl.className = 'codicon codicon-loading codicon-modifier-spin';
        const title = getText('view.loadingAll', 'Loading all results...');
        toggleExpandBtnEl.setAttribute('title', title);
        toggleExpandBtnEl.setAttribute('aria-label', title);
        return;
    }

    const hasNodes = hasCollapsibleNodes();
    toggleExpandBtnEl.disabled = !hasNodes;

    const shouldCollapse = areAllCollapsibleNodesExpanded();
    if (shouldCollapse) {
        toggleExpandIconEl.className = 'codicon codicon-collapse-all';
        const title = getText('view.collapseAll', 'Collapse All');
        toggleExpandBtnEl.setAttribute('title', title);
        toggleExpandBtnEl.setAttribute('aria-label', title);
        return;
    }

    toggleExpandIconEl.className = 'codicon codicon-expand-all';
    const title = getText('view.expandAll', 'Expand All');
    toggleExpandBtnEl.setAttribute('title', title);
    toggleExpandBtnEl.setAttribute('aria-label', title);
}

function hasCollapsibleNodes() {
    if (!state.displayedItems.length) {
        return false;
    }

    const root = buildResultTree(state.displayedItems);
    return root.folders.size > 0 || root.files.size > 0;
}

function areAllCollapsibleNodesExpanded() {
    if (!state.displayedItems.length) {
        return false;
    }

    const root = buildResultTree(state.displayedItems);
    const stack = [root];

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
            continue;
        }

        if (node.folders) {
            const folders = Array.from(node.folders.values());
            for (const folder of folders) {
                if (!isNodeExpanded('folder', folder.path)) {
                    return false;
                }
                stack.push(folder);
            }
        }

        if (node.files) {
            const files = Array.from(node.files.values());
            for (const file of files) {
                if (!isNodeExpanded('file', file.path)) {
                    return false;
                }
            }
        }
    }

    return true;
}

function setAllNodesExpanded(expanded) {
    if (!state.displayedItems.length) {
        return;
    }

    const root = buildResultTree(state.displayedItems);
    const stack = [root];

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
            continue;
        }

        if (node.folders) {
            const folders = Array.from(node.folders.values());
            for (const folder of folders) {
                setNodeExpanded('folder', folder.path, expanded);
                stack.push(folder);
            }
        }

        if (node.files) {
            const files = Array.from(node.files.values());
            for (const file of files) {
                setNodeExpanded('file', file.path, expanded);
            }
        }
    }
}

function continuePendingGlobalToggleIfNeeded() {
    if (!state.isPreparingGlobalToggle || typeof state.pendingGlobalExpandState !== 'boolean') {
        return;
    }

    if (state.hasMore) {
        requestLoadMore();
        return;
    }

    const targetExpanded = state.pendingGlobalExpandState;
    clearPendingGlobalToggle();
    setAllNodesExpanded(targetExpanded);
    renderResults();
    updateResultMeta();
}

function scheduleSearch() {
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }

    searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = undefined;
        triggerSearch();
    }, state.searchDebounceMs);
}

function normalizeSearchDebounceMs(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 300;
    }

    const rounded = Math.round(value);
    return Math.min(MAX_SEARCH_DEBOUNCE_MS, Math.max(MIN_SEARCH_DEBOUNCE_MS, rounded));
}

function normalizePageSize(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 100;
    }

    const rounded = Math.round(value);
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, rounded));
}

function updateClearButtonVisibility() {
    if (!searchBoxEl) {
        return;
    }

    const hasValue = queryInputEl.value.trim().length > 0;
    searchBoxEl.classList.toggle('has-value', hasValue);
}

function applyWorkspaceSupportState() {
    const unsupported = !state.workspaceSupported;
    queryInputEl.disabled = unsupported;

    if (clearQueryBtnEl) {
        clearQueryBtnEl.disabled = unsupported;
    }

    if (fuzzyModeBtnEl) {
        fuzzyModeBtnEl.disabled = unsupported;
    }

    if (exactModeBtnEl) {
        exactModeBtnEl.disabled = unsupported;
    }

    if (toggleExpandBtnEl) {
        toggleExpandBtnEl.disabled = unsupported;
    }
}

function renderUnsupportedWorkspaceHint() {
    resultListEl.innerHTML = '';
    resetPagingState();

    const item = document.createElement('li');
    item.className = 'unsupported-workspace-item';

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-warning unsupported-workspace-icon';
    item.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'unsupported-workspace-text';
    text.textContent = getText('meta.unsupportedWorkspace', 'Current workspace is not a .NET project. Indexing is not started.');
    item.appendChild(text);

    resultListEl.appendChild(item);
    resultMetaEl.textContent = '';
    updateExpandToggleButton();
}

function buildResultTree(items) {
    const root = {
        folders: new Map(),
        files: new Map(),
        count: 0
    };

    items.forEach((item) => {
        const normalizedPath = normalizeRelativePath(item.relativePath);
        const segments = normalizedPath.split('/').filter(Boolean);
        if (!segments.length) {
            return;
        }

        root.count += 1;

        const fileName = segments[segments.length - 1];
        const folderSegments = segments.slice(0, -1);

        let current = root;
        let currentPath = '';
        folderSegments.forEach((segment) => {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;

            if (!current.folders.has(segment)) {
                current.folders.set(segment, {
                    name: segment,
                    path: currentPath,
                    folders: new Map(),
                    files: new Map(),
                    count: 0
                });
            }

            const folderNode = current.folders.get(segment);
            folderNode.count += 1;
            current = folderNode;
        });

        const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
        if (!current.files.has(fileName)) {
            current.files.set(fileName, {
                name: fileName,
                path: filePath,
                count: 0,
                matches: []
            });
        }

        const fileNode = current.files.get(fileName);
        fileNode.count += 1;
        fileNode.matches.push(item);
    });

    return root;
}

function normalizeRelativePath(relativePath) {
    if (typeof relativePath !== 'string') {
        return '';
    }

    return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function compareByName(a, b) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function getNodeKey(nodeType, path) {
    return `${nodeType}:${path}`;
}

function isNodeExpanded(nodeType, path) {
    const key = getNodeKey(nodeType, path);
    if (!(key in state.expandedNodeState)) {
        state.expandedNodeState[key] = true;
    }

    return state.expandedNodeState[key] === true;
}

function setNodeExpanded(nodeType, path, expanded) {
    state.expandedNodeState[getNodeKey(nodeType, path)] = expanded === true;
}

function createResultSymbolElement(item) {
    const li = document.createElement('li');
    li.className = 'result-symbol-item';
    const itemKey = getResultItemKey(item);
    li.classList.toggle('active', state.selectedResultKey === itemKey);

    const detail = document.createElement('span');
    detail.className = 'result-symbol-detail';
    applyHighlightedText(detail, buildDetailText(item), state.query);

    li.appendChild(detail);

    li.addEventListener('click', () => {
        selectResultItem(item);
        renderResults();
    });

    li.addEventListener('dblclick', () => {
        vscode.postMessage({
            type: 'openResult',
            uri: item.uri,
            line: item.line,
            preview: false,
            preserveFocus: false,
            openToSide: true
        });
    });

    return li;
}

function createDisclosure(expanded) {
    const disclosure = document.createElement('span');
    disclosure.className = `result-tree-disclosure codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`;
    return disclosure;
}

function updateDisclosureIcon(disclosure, expanded) {
    if (!disclosure) {
        return;
    }

    disclosure.classList.toggle('codicon-chevron-down', expanded);
    disclosure.classList.toggle('codicon-chevron-right', !expanded);
}

function createFolderElement(folderNode) {
    const li = document.createElement('li');
    li.className = 'result-tree-folder';

    const expanded = isNodeExpanded('folder', folderNode.path);

    const row = document.createElement('div');
    row.className = 'result-tree-row result-tree-row--folder';

    const left = document.createElement('div');
    left.className = 'result-tree-left';

    left.appendChild(createDisclosure(expanded));

    const folderIconDataUri = expanded && state.resultTreeIcons.folderExpandedIconDataUri
        ? state.resultTreeIcons.folderExpandedIconDataUri
        : state.resultTreeIcons.folderIconDataUri;
    const icon = createImageIcon('result-tree-icon result-tree-icon--folder', folderIconDataUri, '📁');
    left.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'result-tree-label';
    label.textContent = folderNode.name;
    left.appendChild(label);

    row.appendChild(left);
    li.appendChild(row);

    const children = document.createElement('ul');
    children.className = 'result-tree-children';
    children.hidden = !expanded;

    const folders = Array.from(folderNode.folders.values()).sort(compareByName);
    const files = Array.from(folderNode.files.values()).sort(compareByName);

    folders.forEach((subFolder) => {
        children.appendChild(createFolderElement(subFolder));
    });

    files.forEach((fileNode) => {
        children.appendChild(createFileElement(fileNode));
    });

    row.addEventListener('click', () => {
        const nextExpanded = !children.hidden;
        children.hidden = nextExpanded;
        setNodeExpanded('folder', folderNode.path, !nextExpanded);
        const disclosure = row.querySelector('.result-tree-disclosure');
        updateDisclosureIcon(disclosure, !nextExpanded);
        const nextIconDataUri = !nextExpanded && state.resultTreeIcons.folderExpandedIconDataUri
            ? state.resultTreeIcons.folderExpandedIconDataUri
            : state.resultTreeIcons.folderIconDataUri;
        if (icon.classList.contains('result-tree-icon--image') && nextIconDataUri) {
            icon.style.backgroundImage = `url(${nextIconDataUri})`;
        }
    });

    li.appendChild(children);
    return li;
}

function createFileElement(fileNode) {
    const li = document.createElement('li');
    li.className = 'result-tree-file';

    const expanded = isNodeExpanded('file', fileNode.path);

    const row = document.createElement('div');
    row.className = 'result-tree-row result-tree-row--file';

    const left = document.createElement('div');
    left.className = 'result-tree-left';
    left.appendChild(createDisclosure(expanded));

    const icon = createImageIcon('result-tree-icon result-tree-icon--file', state.resultTreeIcons.fileIconDataUri, 'C#');
    left.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'result-tree-label';
    label.textContent = fileNode.name;
    left.appendChild(label);

    row.appendChild(left);
    li.appendChild(row);

    const symbols = document.createElement('ul');
    symbols.className = 'result-tree-symbols';
    symbols.hidden = !expanded;

    fileNode.matches.forEach((item) => {
        symbols.appendChild(createResultSymbolElement(item));
    });

    row.addEventListener('click', () => {
        const nextExpanded = !symbols.hidden;
        symbols.hidden = nextExpanded;
        setNodeExpanded('file', fileNode.path, !nextExpanded);
        const disclosure = row.querySelector('.result-tree-disclosure');
        updateDisclosureIcon(disclosure, !nextExpanded);
    });

    li.appendChild(symbols);
    return li;
}

function updateResultMeta() {
    if (state.isPreparingGlobalToggle) {
        const total = Math.max(state.totalResults, state.loadedResults);
        if (total > 0) {
            resultMetaEl.textContent = formatText(
                getText('meta.loadingAllProgress', 'Loading all results ({0}/{1})...'),
                state.loadedResults,
                total
            );
        } else {
            resultMetaEl.textContent = getText('view.loadingAll', 'Loading all results...');
        }
        return;
    }

    if (!state.indexStatus.isReady && state.indexStatus.isIndexing) {
        if (state.loadedResults > 0 && state.query) {
            if (state.isTruncated) {
                const limit = state.maxResults > 0 ? state.maxResults : state.loadedResults;
                resultMetaEl.textContent = formatText(
                    getText('meta.indexingPartialResultCountLimited', '{0} results found (limit {1} reached), indexing continues ({2}/{3})'),
                    state.loadedResults,
                    limit,
                    state.indexStatus.indexedFiles,
                    state.indexStatus.totalFiles
                );
                return;
            }

            resultMetaEl.textContent = formatText(
                getText('meta.indexingPartialResultCount', '{0} results found, indexing continues ({1}/{2})'),
                state.loadedResults,
                state.indexStatus.indexedFiles,
                state.indexStatus.totalFiles
            );
            return;
        }

        resultMetaEl.textContent = getIndexingMetaText();
        return;
    }

    if (!state.indexStatus.isReady && state.query && state.loadedResults > 0) {
        if (state.isTruncated) {
            const limit = state.maxResults > 0 ? state.maxResults : state.loadedResults;
            resultMetaEl.textContent = formatText(
                getText('meta.indexingPartialResultCountLimited', '{0} results found (limit {1} reached), indexing continues ({2}/{3})'),
                state.loadedResults,
                limit,
                state.indexStatus.indexedFiles,
                state.indexStatus.totalFiles
            );
            return;
        }

        resultMetaEl.textContent = formatText(
            getText('meta.indexingPartialResultCount', '{0} results found, indexing continues ({1}/{2})'),
            state.loadedResults,
            state.indexStatus.indexedFiles,
            state.indexStatus.totalFiles
        );
        return;
    }

    if (state.loadedResults <= 0) {
        if (!state.indexStatus.isReady && state.query) {
            resultMetaEl.textContent = getIndexingMetaText();
            return;
        }

        resultMetaEl.textContent = getText('meta.noResults', 'No results found');
        return;
    }

    if (state.totalResults > state.loadedResults) {
        if (state.isTruncated) {
            const limit = state.maxResults > 0 ? state.maxResults : state.totalResults;
            resultMetaEl.textContent = formatText(
                getText('meta.resultCountProgressLimited', '{0}/{1} results loaded (limit {2} reached)'),
                state.loadedResults,
                state.totalResults,
                limit
            );
            return;
        }

        resultMetaEl.textContent = formatText(
            getText('meta.resultCountProgress', '{0}/{1} results'),
            state.loadedResults,
            state.totalResults
        );
        return;
    }

    if (state.isTruncated) {
        const limit = state.maxResults > 0 ? state.maxResults : state.totalResults;
        resultMetaEl.textContent = formatText(
            getText('meta.resultCountLimited', 'Reached result limit ({0})'),
            limit
        );
        return;
    }

    resultMetaEl.textContent = formatText(getText('meta.resultCount', '{0} results'), state.loadedResults);
}

function renderResults() {
    resultListEl.innerHTML = '';

    if (!state.displayedItems.length) {
        updateResultMeta();
        updateExpandToggleButton();
        return;
    }

    const root = buildResultTree(state.displayedItems);
    const folders = Array.from(root.folders.values()).sort(compareByName);
    const files = Array.from(root.files.values()).sort(compareByName);

    folders.forEach((folderNode) => {
        resultListEl.appendChild(createFolderElement(folderNode));
    });

    files.forEach((fileNode) => {
        resultListEl.appendChild(createFileElement(fileNode));
    });

    updateExpandToggleButton();
}

function requestLoadMore() {
    if (state.isLoadingMore || !state.hasMore || !state.query || !state.activeKindId) {
        return;
    }

    state.isLoadingMore = true;
    vscode.postMessage({
        type: 'loadMore',
        requestId: String(state.requestId),
        offset: state.loadedResults
    });
}

function tryLoadMoreIfNeeded() {
    if (!state.hasMore || state.isLoadingMore) {
        return;
    }

    const scrollContainer = resultsScrollEl;
    if (!scrollContainer) {
        return;
    }

    const scrollY = scrollContainer.scrollTop;
    const viewportHeight = scrollContainer.clientHeight;
    const fullHeight = scrollContainer.scrollHeight;
    if (scrollY + viewportHeight >= fullHeight - LOAD_MORE_BOTTOM_GAP_PX) {
        requestLoadMore();
    }
}

function applyHighlightedText(targetEl, text, query, highlightClass = 'result-highlight') {
    const normalizedText = typeof text === 'string' ? text : '';
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    targetEl.textContent = '';

    if (!normalizedQuery) {
        targetEl.textContent = normalizedText;
        return;
    }

    const escapedQuery = escapeRegExp(normalizedQuery);
    if (!escapedQuery) {
        targetEl.textContent = normalizedText;
        return;
    }

    const regex = new RegExp(`(${escapedQuery})`, 'ig');
    const parts = normalizedText.split(regex);

    parts.forEach((part) => {
        if (!part) {
            return;
        }

        if (part.toLowerCase() === normalizedQuery.toLowerCase()) {
            const mark = document.createElement('span');
            mark.className = highlightClass;
            mark.textContent = part;
            targetEl.appendChild(mark);
            return;
        }

        targetEl.appendChild(document.createTextNode(part));
    });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDetailText(item) {
    return item.preview;
}

function getResultItemKey(item) {
    return `${item.uri}:${item.line}:${item.preview}`;
}

function selectResultItem(item) {
    state.selectedItem = item;
    state.selectedResultKey = getResultItemKey(item);
    vscode.postMessage({
        type: 'openResult',
        uri: item.uri,
        line: item.line,
        preview: true,
        preserveFocus: true,
        openToSide: true
    });
}

queryInputEl.addEventListener('input', () => {
    scheduleSearch();
});

clearQueryBtnEl?.addEventListener('click', () => {
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = undefined;
    }

    queryInputEl.value = '';
    triggerSearch();
    queryInputEl.focus();
});

matchModeGroupEl?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const mode = target.getAttribute('data-mode');
    if (mode !== 'fuzzy' && mode !== 'exact') {
        return;
    }

    if (state.matchMode === mode) {
        return;
    }

    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = undefined;
    }

    setMatchMode(mode);
    triggerSearch();
});

toggleExpandBtnEl?.addEventListener('click', () => {
    if (!hasCollapsibleNodes()) {
        return;
    }

    const shouldCollapse = areAllCollapsibleNodesExpanded();
    const targetExpanded = !shouldCollapse;

    if (state.hasMore) {
        state.isPreparingGlobalToggle = true;
        state.pendingGlobalExpandState = targetExpanded;
        updateExpandToggleButton();
        updateResultMeta();
        requestLoadMore();
        return;
    }

    setAllNodesExpanded(targetExpanded);
    renderResults();
});

resultsScrollEl?.addEventListener('scroll', () => {
    tryLoadMoreIfNeeded();
});

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'init') {
        state.workspaceSupported = message.workspaceSupported !== false;
        state.kinds = Array.isArray(message.kinds) ? message.kinds : [];
        state.activeKindId = message.activeKindId || state.kinds[0]?.id || '';
        state.texts = message.texts && typeof message.texts === 'object' ? message.texts : {};
        state.searchDebounceMs = normalizeSearchDebounceMs(message.searchDebounceMs);
        state.pageSize = normalizePageSize(message.pageSize);
        state.resultTreeIcons = normalizeResultTreeIcons(message.resultTreeIcons);
        state.indexStatus = normalizeIndexStatus(message.indexStatus);
        resultsPaneTitleEl.textContent = getText('results.title', 'Search Results');
        updateInputPlaceholder();
        const clearInputText = getText('input.clear', 'Clear input');
        clearQueryBtnEl?.setAttribute('aria-label', clearInputText);
        clearQueryBtnEl?.setAttribute('title', clearInputText);
        const matchModeLabel = getText('match.modeLabel', 'Match mode');
        matchModeGroupEl?.setAttribute('aria-label', matchModeLabel);
        if (fuzzyModeBtnEl) {
            fuzzyModeBtnEl.textContent = getText('match.fuzzy', 'Fuzzy');
            fuzzyModeBtnEl.setAttribute('title', getText('match.fuzzy', 'Fuzzy'));
        }
        if (exactModeBtnEl) {
            exactModeBtnEl.textContent = getText('match.exact', 'Exact');
            exactModeBtnEl.setAttribute('title', getText('match.exact', 'Exact'));
        }
        setMatchMode(state.matchMode);
        updateExpandToggleButton();
        updateClearButtonVisibility();
        applyWorkspaceSupportState();
        renderTabs();
        if (!state.workspaceSupported) {
            renderUnsupportedWorkspaceHint();
            return;
        }
        if (!state.indexStatus.isReady) {
            resultMetaEl.textContent = getIndexingMetaText();
        }
        return;
    }

    if (message.type === 'searchResults') {
        if (message.requestId !== String(state.requestId)) {
            return;
        }

        const append = message.append === true;
        const items = Array.isArray(message.items) ? message.items : [];
        state.totalResults = Number.isFinite(message.total) ? Math.max(0, Math.round(message.total)) : items.length;

        if (!append) {
            clearPendingGlobalToggle();
            state.expandedNodeState = {};
            state.displayedItems = items;
            state.loadedResults = items.length;
            state.isTruncated = message.isTruncated === true;
            state.maxResults = Number.isFinite(message.maxResults) ? Math.max(0, Math.round(message.maxResults)) : 0;
            state.hasMore = message.hasMore === true;
            state.isLoadingMore = false;
            state.lastCompletedRequestId = String(message.requestId ?? '');
            state.lastCompletedQuery = state.query;
            state.lastCompletedKindId = state.activeKindId;
            state.lastCompletedMatchMode = state.matchMode;
            renderResults();
            updateResultMeta();
            continuePendingGlobalToggleIfNeeded();
            setTimeout(() => {
                tryLoadMoreIfNeeded();
            }, 0);
            return;
        }

        state.displayedItems = state.displayedItems.concat(items);
        state.loadedResults += items.length;
        state.isTruncated = message.isTruncated === true;
        state.maxResults = Number.isFinite(message.maxResults) ? Math.max(0, Math.round(message.maxResults)) : state.maxResults;
        state.hasMore = message.hasMore === true;
        state.isLoadingMore = false;
        renderResults();
        updateResultMeta();
        continuePendingGlobalToggleIfNeeded();
        setTimeout(() => {
            tryLoadMoreIfNeeded();
        }, 0);
        return;
    }

    if (message.type === 'configUpdated') {
        state.searchDebounceMs = normalizeSearchDebounceMs(message.searchDebounceMs);
        state.pageSize = normalizePageSize(message.pageSize);
        state.resultTreeIcons = normalizeResultTreeIcons(message.resultTreeIcons);
        renderResults();
        return;
    }

    if (message.type === 'indexStatusUpdated') {
        if (!state.workspaceSupported) {
            return;
        }

        const previousReady = state.indexStatus.isReady;
        state.indexStatus = normalizeIndexStatus(message.status);

        if (!state.indexStatus.isReady) {
            clearIndexReadyHintTimer();
            if (queryInputEl.value.trim().length > 0) {
                scheduleIndexingSearchRefresh();
            }

            updateResultMeta();
            return;
        }

        if (!previousReady && queryInputEl.value.trim().length === 0) {
            showIndexReadyHint();
        }

        if (!previousReady && queryInputEl.value.trim().length > 0) {
            triggerSearch({ preserveResults: true });
        }
    }
});

vscode.postMessage({
    type: 'ready'
});
