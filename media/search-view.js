const vscode = acquireVsCodeApi();

const state = {
    activeKindId: '',
    query: '',
    requestId: 0,
    kinds: []
};

const tabsEl = document.getElementById('tabs');
const queryInputEl = document.getElementById('queryInput');
const resultListEl = document.getElementById('resultList');
const resultMetaEl = document.getElementById('resultMeta');

const kindIcons = {
    type: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9"/><path d="M4 7.5 12 12l8-4.5"/></svg>',
    member: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M8 16V8"/><path d="M6 8h4"/><path d="M6 12h3.5"/><path d="M14 16V8"/><path d="M12 8h4"/></svg>'
};

const kindLabelHints = {
    type: '类型(t:)',
    member: '成员(m:)',
    text: '文本(x:)'
};

function createKindIcon(kindId) {
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.innerHTML = kindIcons[kindId] ?? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
    return icon;
}

function getKindLabel(kind) {
    return kindLabelHints[kind.id] ?? kind.label;
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
    const currentRequestId = String(++state.requestId);

    if (!state.activeKindId || !state.query) {
        resultListEl.innerHTML = '';
        resultMetaEl.textContent = '请输入关键字开始搜索';
        return;
    }

    resultMetaEl.textContent = '搜索中...';
    vscode.postMessage({
        type: 'search',
        kindId: state.activeKindId,
        query: state.query,
        requestId: currentRequestId
    });
}

function renderResults(items) {
    resultListEl.innerHTML = '';

    if (!items.length) {
        resultMetaEl.textContent = '未找到结果';
        return;
    }

    resultMetaEl.textContent = `共 ${items.length} 条结果`;

    items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'result-item';

        const name = document.createElement('div');
        name.className = 'result-name';
        name.textContent = item.symbolName;

        const path = document.createElement('div');
        path.className = 'result-path';
        path.textContent = `${item.relativePath}:${item.line + 1}`;

        const preview = document.createElement('div');
        preview.className = 'result-preview';
        preview.textContent = item.preview;

        li.appendChild(name);
        li.appendChild(path);
        li.appendChild(preview);

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

queryInputEl.addEventListener('input', () => {
    triggerSearch();
});

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'init') {
        state.kinds = Array.isArray(message.kinds) ? message.kinds : [];
        state.activeKindId = message.activeKindId || state.kinds[0]?.id || '';
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
