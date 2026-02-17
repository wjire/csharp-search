const vscode = acquireVsCodeApi();

const state = {
    activeKindId: '',
    query: '',
    matchMode: 'fuzzy',
    requestId: 0,
    searchDebounceMs: 300,
    kinds: [],
    texts: {},
    indexStatus: {
        isReady: false,
        isIndexing: true,
        totalFiles: 0,
        indexedFiles: 0
    }
};

const MIN_SEARCH_DEBOUNCE_MS = 0;
const MAX_SEARCH_DEBOUNCE_MS = 1000;
const INDEX_READY_HINT_MS = 1500;

let searchDebounceTimer = undefined;
let indexReadyHintTimer = undefined;

const tabsEl = document.getElementById('tabs');
const searchBoxEl = document.querySelector('.search-box');
const queryInputEl = document.getElementById('queryInput');
const clearQueryBtnEl = document.getElementById('clearQueryBtn');
const matchModeGroupEl = document.getElementById('matchModeGroup');
const fuzzyModeBtnEl = document.getElementById('fuzzyModeBtn');
const exactModeBtnEl = document.getElementById('exactModeBtn');
const resultListEl = document.getElementById('resultList');
const resultMetaEl = document.getElementById('resultMeta');

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
        resultMetaEl.textContent = '';
        return;
    }

    if (!state.indexStatus.isReady) {
        resultMetaEl.textContent = getIndexingMetaText();
        return;
    }

    const currentRequestId = String(++state.requestId);

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

function updateClearButtonVisibility() {
    if (!searchBoxEl) {
        return;
    }

    const hasValue = queryInputEl.value.trim().length > 0;
    searchBoxEl.classList.toggle('has-value', hasValue);
}

function renderResults(items) {
    resultListEl.innerHTML = '';

    if (!items.length) {
        resultMetaEl.textContent = getText('meta.noResults', 'No results found');
        return;
    }

    resultMetaEl.textContent = formatText(getText('meta.resultCount', '{0} results'), items.length);

    items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'result-item';
        if (item.kindId === 'type' || item.kindId === 'method' || item.kindId === 'member' || item.kindId === 'impl') {
            li.classList.add(`result-item--${item.kindId}`);
        }

        const name = document.createElement('div');
        name.className = 'result-name';
        applyHighlightedText(name, item.symbolName, state.query);

        const meta = document.createElement('div');
        meta.className = 'result-meta-line';
        if (item.kindId === 'impl') {
            meta.classList.add('result-meta-line--impl');
        }
        applyHighlightedText(meta, buildMetaText(item), state.query);

        const detail = document.createElement('div');
        detail.className = 'result-detail-line';
        applyHighlightedText(detail, buildDetailText(item), state.query);

        li.appendChild(name);
        li.appendChild(meta);
        li.appendChild(detail);

        li.addEventListener('click', () => {
            vscode.postMessage({
                type: 'openResult',
                uri: item.uri,
                line: item.line
            });
        });

        resultListEl.appendChild(li);
    });
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
    if (item.kindId === 'type' || item.kindId === 'method' || item.kindId === 'member' || item.kindId === 'impl') {
        return item.preview;
    }

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

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'init') {
        state.kinds = Array.isArray(message.kinds) ? message.kinds : [];
        state.activeKindId = message.activeKindId || state.kinds[0]?.id || '';
        state.texts = message.texts && typeof message.texts === 'object' ? message.texts : {};
        state.searchDebounceMs = normalizeSearchDebounceMs(message.searchDebounceMs);
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

        renderResults(Array.isArray(message.items) ? message.items : []);
        return;
    }

    if (message.type === 'configUpdated') {
        state.searchDebounceMs = normalizeSearchDebounceMs(message.searchDebounceMs);
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
