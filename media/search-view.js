const vscode = acquireVsCodeApi();

const state = {
    activeKindId: '',
    query: '',
    matchMode: 'fuzzy',
    viewMode: 'tree',
    requestId: 0,
    searchDebounceMs: 300,
    pageSize: 100,
    kinds: [],
    texts: {},
    displayedItems: [],
    expandedNodeState: {},
    totalResults: 0,
    loadedResults: 0,
    hasMore: false,
    isLoadingMore: false,
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
const LOAD_MORE_BOTTOM_GAP_PX = 120;

let searchDebounceTimer = undefined;
let indexReadyHintTimer = undefined;

const tabsEl = document.getElementById('tabs');
const searchBoxEl = document.querySelector('.search-box');
const queryInputEl = document.getElementById('queryInput');
const clearQueryBtnEl = document.getElementById('clearQueryBtn');
const matchModeGroupEl = document.getElementById('matchModeGroup');
const fuzzyModeBtnEl = document.getElementById('fuzzyModeBtn');
const exactModeBtnEl = document.getElementById('exactModeBtn');
const viewModeToggleBtnEl = document.getElementById('viewModeToggleBtn');
const viewModeToggleIconEl = document.getElementById('viewModeToggleIcon');
const toggleExpandBtnEl = document.getElementById('toggleExpandBtn');
const toggleExpandIconEl = document.getElementById('toggleExpandIcon');
const resultListEl = document.getElementById('resultList');
const resultMetaEl = document.getElementById('resultMeta');

const persistedState = vscode.getState() || {};
if (persistedState.viewMode === 'list') {
    state.viewMode = 'list';
}

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
    state.hasMore = false;
    state.isLoadingMore = false;
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

    if (kindId === 'impl') {
        return getText('input.placeholder.impl', getText('input.placeholder', 'Enter keyword'));
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
        indexedFiles: totalFiles > 0 ? Math.min(indexedFiles, totalFiles) : indexedFiles
    };
}

function getIndexingMetaText() {
    const { indexedFiles, totalFiles } = state.indexStatus;
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

function triggerSearch() {
    clearIndexReadyHintTimer();

    state.query = queryInputEl.value.trim();
    updateClearButtonVisibility();

    if (!state.activeKindId || !state.query) {
        resultListEl.innerHTML = '';
        resetPagingState();
        resultMetaEl.textContent = '';
        return;
    }

    if (!state.indexStatus.isReady) {
        resultMetaEl.textContent = getIndexingMetaText();
        return;
    }

    const currentRequestId = String(++state.requestId);
    resetPagingState();

    resultMetaEl.textContent = getText('meta.searching', 'Searching...');
    vscode.postMessage({
        type: 'search',
        kindId: state.activeKindId,
        query: state.query,
        matchMode: state.matchMode,
        requestId: currentRequestId
    });
}

function setMatchMode(matchMode) {
    state.matchMode = matchMode === 'exact' ? 'exact' : 'fuzzy';
    fuzzyModeBtnEl?.classList.toggle('active', state.matchMode === 'fuzzy');
    exactModeBtnEl?.classList.toggle('active', state.matchMode === 'exact');
}

function setViewMode(viewMode, persist = true) {
    state.viewMode = viewMode === 'list' ? 'list' : 'tree';

    if (viewModeToggleBtnEl && viewModeToggleIconEl) {
        if (state.viewMode === 'tree') {
            viewModeToggleIconEl.className = 'codicon codicon-list-tree';
            const title = getText('view.list', 'List View');
            viewModeToggleBtnEl.setAttribute('title', title);
            viewModeToggleBtnEl.setAttribute('aria-label', title);
        } else {
            viewModeToggleIconEl.className = 'codicon codicon-list-flat';
            const title = getText('view.tree', 'Tree View');
            viewModeToggleBtnEl.setAttribute('title', title);
            viewModeToggleBtnEl.setAttribute('aria-label', title);
        }
    }

    if (persist) {
        const previousState = vscode.getState() || {};
        vscode.setState({
            ...previousState,
            viewMode: state.viewMode
        });
    }

    updateExpandToggleButton();
}

function updateExpandToggleButton() {
    if (!toggleExpandBtnEl || !toggleExpandIconEl) {
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

    if (state.viewMode === 'tree') {
        const root = buildResultTree(state.displayedItems);
        return root.folders.size > 0 || root.files.size > 0;
    }

    const groups = buildListFileGroups(state.displayedItems);
    return groups.length > 0;
}

function areAllCollapsibleNodesExpanded() {
    if (!state.displayedItems.length) {
        return false;
    }

    if (state.viewMode === 'list') {
        const groups = buildListFileGroups(state.displayedItems);
        if (!groups.length) {
            return false;
        }

        for (const group of groups) {
            if (!isNodeExpanded('list-file', group.filePath)) {
                return false;
            }
        }

        return true;
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

    if (state.viewMode === 'list') {
        const groups = buildListFileGroups(state.displayedItems);
        groups.forEach((group) => {
            setNodeExpanded('list-file', group.filePath, expanded);
        });
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

function createCountBadge(count) {
    const badge = document.createElement('span');
    badge.className = 'result-tree-count';
    badge.textContent = String(count);
    return badge;
}

function createResultSymbolElement(item) {
    const li = document.createElement('li');
    li.className = 'result-symbol-item';

    const detail = document.createElement('span');
    detail.className = 'result-symbol-detail';
    applyHighlightedText(detail, buildDetailText(item), state.query);

    li.appendChild(detail);

    li.addEventListener('click', () => {
        vscode.postMessage({
            type: 'openResult',
            uri: item.uri,
            line: item.line
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

    const icon = document.createElement('span');
    icon.className = 'result-tree-icon result-tree-icon--folder';
    icon.textContent = '📁';
    left.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'result-tree-label';
    label.textContent = folderNode.name;
    left.appendChild(label);

    row.appendChild(left);
    row.appendChild(createCountBadge(folderNode.count));
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

    const icon = document.createElement('span');
    icon.className = 'result-tree-icon result-tree-icon--file';
    icon.textContent = 'C#';
    left.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'result-tree-label';
    label.textContent = fileNode.name;
    left.appendChild(label);

    row.appendChild(left);
    row.appendChild(createCountBadge(fileNode.count));
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
    if (state.loadedResults <= 0) {
        resultMetaEl.textContent = getText('meta.noResults', 'No results found');
        return;
    }

    if (state.totalResults > state.loadedResults) {
        resultMetaEl.textContent = formatText(
            getText('meta.resultCountProgress', '{0}/{1} results'),
            state.loadedResults,
            state.totalResults
        );
        return;
    }

    resultMetaEl.textContent = formatText(getText('meta.resultCount', '{0} results'), state.loadedResults);
}

function renderResults() {
    resultListEl.innerHTML = '';
    resultListEl.classList.toggle('mode-list', state.viewMode === 'list');

    if (!state.displayedItems.length) {
        resultMetaEl.textContent = getText('meta.noResults', 'No results found');
        updateExpandToggleButton();
        return;
    }

    if (state.viewMode === 'list') {
        renderListResults();
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

function renderListResults() {
    const groups = buildListFileGroups(state.displayedItems);
    groups.forEach((group) => {
        resultListEl.appendChild(createListFileGroupElement(group));
    });
}

function buildListFileGroups(items) {
    const groupMap = new Map();

    items.forEach((item) => {
        const normalizedPath = normalizeRelativePath(item.relativePath);
        const filePath = normalizedPath || item.relativePath || '';

        if (!groupMap.has(filePath)) {
            groupMap.set(filePath, {
                filePath,
                fileName: filePath.split('/').filter(Boolean).pop() || filePath,
                matches: []
            });
        }

        groupMap.get(filePath).matches.push(item);
    });

    const groups = Array.from(groupMap.values());
    groups.sort((a, b) => a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }));
    groups.forEach((group) => {
        group.matches.sort((a, b) => {
            if (a.line !== b.line) {
                return a.line - b.line;
            }

            return (a.symbolName || '').localeCompare(b.symbolName || '', undefined, { sensitivity: 'base' });
        });
    });

    return groups;
}

function createListFileGroupElement(group) {
    const li = document.createElement('li');
    li.className = 'result-list-file-group';
    const expanded = isNodeExpanded('list-file', group.filePath);

    const fileRow = document.createElement('div');
    fileRow.className = 'result-list-file-row';

    const left = document.createElement('div');
    left.className = 'result-list-main';

    left.appendChild(createDisclosure(expanded));

    const icon = document.createElement('span');
    icon.className = 'result-symbol-icon';
    icon.textContent = 'C#';

    const name = document.createElement('span');
    name.className = 'result-list-file-name';
    name.textContent = group.fileName;

    left.appendChild(icon);
    left.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'result-list-file-meta';
    meta.textContent = group.filePath;

    const count = createCountBadge(group.matches.length);
    count.classList.add('result-list-file-count');

    fileRow.appendChild(left);
    fileRow.appendChild(meta);
    fileRow.appendChild(count);

    const symbols = document.createElement('ul');
    symbols.className = 'result-list-symbols';
    symbols.hidden = !expanded;

    group.matches.forEach((item) => {
        symbols.appendChild(createListSymbolElement(item));
    });

    fileRow.addEventListener('click', () => {
        const nextExpanded = !symbols.hidden;
        symbols.hidden = nextExpanded;
        setNodeExpanded('list-file', group.filePath, !nextExpanded);
        const disclosure = fileRow.querySelector('.result-tree-disclosure');
        updateDisclosureIcon(disclosure, !nextExpanded);
    });

    li.appendChild(fileRow);
    li.appendChild(symbols);
    return li;
}

function createListSymbolElement(item) {
    const li = document.createElement('li');
    li.className = 'result-list-symbol-item';

    const detail = document.createElement('span');
    detail.className = 'result-list-symbol-detail';
    applyHighlightedText(detail, buildDetailText(item), state.query);

    li.appendChild(detail);

    li.addEventListener('click', () => {
        vscode.postMessage({
            type: 'openResult',
            uri: item.uri,
            line: item.line
        });
    });

    return li;
}

function requestLoadMore() {
    if (state.isLoadingMore || !state.hasMore || !state.query || !state.activeKindId || !state.indexStatus.isReady) {
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

    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const fullHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    if (scrollY + viewportHeight >= fullHeight - LOAD_MORE_BOTTOM_GAP_PX) {
        requestLoadMore();
    }
}

function applyHighlightedText(targetEl, text, query) {
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
            mark.className = 'result-highlight';
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

function buildMetaText(item) {
    if (item.kindId === 'type') {
        return item.projectName || extractWorkspaceName(item.relativePath);
    }

    if (item.kindId === 'method' || item.kindId === 'member' || item.kindId === 'impl') {
        const project = item.projectName || extractWorkspaceName(item.relativePath);
        const ownerType = (item.ownerTypeName || '').trim();
        return ownerType ? `${project} / ${ownerType}` : project;
    }

    return `${item.relativePath}:${item.line + 1}`;
}

function buildDetailText(item) {
    return item.preview;
}

function extractWorkspaceName(relativePath) {
    if (typeof relativePath !== 'string') {
        return '';
    }

    const normalized = relativePath.replace(/\\/g, '/').trim();
    if (!normalized) {
        return '';
    }

    const segments = normalized.split('/');
    return segments[0] || '';
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

viewModeToggleBtnEl?.addEventListener('click', () => {
    const nextViewMode = state.viewMode === 'tree' ? 'list' : 'tree';
    setViewMode(nextViewMode);
    renderResults();
    updateResultMeta();
});

toggleExpandBtnEl?.addEventListener('click', () => {
    if (!hasCollapsibleNodes()) {
        return;
    }

    const shouldCollapse = areAllCollapsibleNodesExpanded();
    setAllNodesExpanded(!shouldCollapse);
    renderResults();
});

window.addEventListener('scroll', () => {
    tryLoadMoreIfNeeded();
});

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'init') {
        state.kinds = Array.isArray(message.kinds) ? message.kinds : [];
        state.activeKindId = message.activeKindId || state.kinds[0]?.id || '';
        state.texts = message.texts && typeof message.texts === 'object' ? message.texts : {};
        state.searchDebounceMs = normalizeSearchDebounceMs(message.searchDebounceMs);
        state.pageSize = normalizePageSize(message.pageSize);
        state.indexStatus = normalizeIndexStatus(message.indexStatus);
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
        setViewMode(state.viewMode, false);
        updateExpandToggleButton();
        updateClearButtonVisibility();
        renderTabs();
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
            state.expandedNodeState = {};
            state.displayedItems = items;
            state.loadedResults = items.length;
            state.hasMore = message.hasMore === true;
            state.isLoadingMore = false;
            renderResults();
            updateResultMeta();
            setTimeout(() => {
                tryLoadMoreIfNeeded();
            }, 0);
            return;
        }

        state.displayedItems = state.displayedItems.concat(items);
        state.loadedResults += items.length;
        state.hasMore = message.hasMore === true;
        state.isLoadingMore = false;
        renderResults();
        updateResultMeta();
        setTimeout(() => {
            tryLoadMoreIfNeeded();
        }, 0);
        return;
    }

    if (message.type === 'configUpdated') {
        state.searchDebounceMs = normalizeSearchDebounceMs(message.searchDebounceMs);
        state.pageSize = normalizePageSize(message.pageSize);
        return;
    }

    if (message.type === 'indexStatusUpdated') {
        const previousReady = state.indexStatus.isReady;
        state.indexStatus = normalizeIndexStatus(message.status);

        if (!state.indexStatus.isReady) {
            clearIndexReadyHintTimer();
            resultMetaEl.textContent = getIndexingMetaText();
            return;
        }

        if (!previousReady && queryInputEl.value.trim().length === 0) {
            showIndexReadyHint();
        }

        if (!previousReady && queryInputEl.value.trim().length > 0) {
            triggerSearch();
        }
    }
});

vscode.postMessage({
    type: 'ready'
});
