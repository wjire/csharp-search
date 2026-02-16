const vscode = acquireVsCodeApi();

const state = {
    activeKindId: '',
    query: '',
    requestId: 0,
    kinds: [],
    texts: {}
};

const tabsEl = document.getElementById('tabs');
const searchBoxEl = document.querySelector('.search-box');
const queryInputEl = document.getElementById('queryInput');
const clearQueryBtnEl = document.getElementById('clearQueryBtn');
const resultListEl = document.getElementById('resultList');
const resultMetaEl = document.getElementById('resultMeta');

const kindIcons = {
    type: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.8"/><circle cx="13" cy="8" r="1.8"/><circle cx="13" cy="16" r="1.8"/><path d="M7.8 12H11.2"/><path d="M11.2 12L12.4 9.2"/><path d="M11.2 12L12.4 14.8"/></svg>',
    member: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 19 8v8l-7 4-7-4V8z"/><path d="M12 12v8"/><path d="M5 8l7 4 7-4"/></svg>'
};

function createKindIcon(kindId) {
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.innerHTML = kindIcons[kindId] ?? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
    return icon;
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

function renderTabs() {
    tabsEl.innerHTML = '';

    state.kinds.forEach((kind) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tab-btn${kind.id === state.activeKindId ? ' active' : ''}`;

        const icon = createKindIcon(kind.id);
        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = getKindLabel(kind);

        button.appendChild(icon);
        button.appendChild(label);

        button.addEventListener('click', () => {
            state.activeKindId = kind.id;
            renderTabs();
            triggerSearch();
        });
        tabsEl.appendChild(button);
    });
}

function triggerSearch() {
    state.query = queryInputEl.value.trim();
    updateClearButtonVisibility();
    const currentRequestId = String(++state.requestId);

    if (!state.activeKindId || !state.query) {
        resultListEl.innerHTML = '';
        resultMetaEl.textContent = '';
        return;
    }

    resultMetaEl.textContent = getText('meta.searching', 'Searching...');
    vscode.postMessage({
        type: 'search',
        kindId: state.activeKindId,
        query: state.query,
        requestId: currentRequestId
    });
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
        if (item.kindId === 'type' || item.kindId === 'member') {
            li.classList.add(`result-item--${item.kindId}`);
        }

        const name = document.createElement('div');
        name.className = 'result-name';
        applyHighlightedText(name, item.symbolName, state.query);

        const meta = document.createElement('div');
        meta.className = 'result-meta-line';
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

    if (item.kindId === 'member') {
        const project = item.projectName || extractWorkspaceName(item.relativePath);
        const ownerType = (item.ownerTypeName || '').trim();
        return ownerType ? `${project} / ${ownerType}` : project;
    }

    return `${item.relativePath}:${item.line + 1}`;
}

function buildDetailText(item) {
    if (item.kindId === 'type' || item.kindId === 'member') {
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
    triggerSearch();
});

clearQueryBtnEl?.addEventListener('click', () => {
    queryInputEl.value = '';
    triggerSearch();
    queryInputEl.focus();
});

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'init') {
        state.kinds = Array.isArray(message.kinds) ? message.kinds : [];
        state.activeKindId = message.activeKindId || state.kinds[0]?.id || '';
        state.texts = message.texts && typeof message.texts === 'object' ? message.texts : {};
        queryInputEl.placeholder = getText('input.placeholder', 'Enter keyword');
        const clearInputText = getText('input.clear', 'Clear input');
        clearQueryBtnEl?.setAttribute('aria-label', clearInputText);
        clearQueryBtnEl?.setAttribute('title', clearInputText);
        updateClearButtonVisibility();
        renderTabs();
        return;
    }

    if (message.type === 'searchResults') {
        renderResults(Array.isArray(message.items) ? message.items : []);
    }
});

vscode.postMessage({
    type: 'ready'
});
