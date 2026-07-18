import * as vscode from 'vscode';

/**
 * 语言类型
 */
type Language = 'zh-cn' | 'en';

/**
 * 文本键类型
 */
type TextKey = keyof typeof TEXT_MAP['zh-cn'];

/**
 * 中英文文本映射
 */
const TEXT_MAP = {
    'zh-cn': {
        'search.kind.type': '类型',
        'search.kind.method': '方法',
        'search.kind.member': '成员',
        'search.kind.text': '文本',
        'search.match.emptyLine': '(空行匹配)',
        'webview.input.placeholder': '输入关键字',
        'webview.input.placeholder.type': '输入类型名',
        'webview.input.placeholder.method': '输入方法名',
        'webview.input.placeholder.member': '输入字段或属性名',
        'webview.input.clear': '清空输入',
        'webview.match.modeLabel': '匹配模式',
        'webview.match.fuzzy': '模糊',
        'webview.match.exact': '精确',
        'webview.view.modeLabel': '视图模式',
        'webview.view.tree': '树视图',
        'webview.view.list': '列表视图',
        'webview.view.collapseAll': '全部折叠',
        'webview.view.expandAll': '全部展开',
        'webview.view.loadingAll': '正在加载全部结果...',
        'webview.meta.searching': '搜索中...',
        'webview.meta.loadingAllProgress': '正在加载全部结果 ({0}/{1})...',
        'webview.meta.indexing': '正在建立索引，请稍候...',
        'webview.meta.indexingProgress': '正在建立索引 ({0}/{1})',
        'webview.meta.firstIndexing': '该工作区正在首次创建索引，可能稍慢，请耐心等待...',
        'webview.meta.firstIndexingProgress': '该工作区正在首次创建索引 ({0}/{1})，可能较慢，请耐心等待...',
        'webview.meta.indexingPartialResultCount': '已找到 {0} 条结果，索引仍在继续 ({1}/{2})',
        'webview.meta.indexingPartialResultCountLimited': '已找到 {0} 条结果（已达上限 {1}），索引仍在继续 ({2}/{3})',
        'webview.meta.indexReady': '索引已完成',
        'webview.meta.unsupportedWorkspace': '当前工作区不是 .NET 项目，未启动索引。',
        'webview.meta.noResults': '未找到结果',
        'webview.meta.resultCount': '共 {0} 条结果',
        'webview.meta.resultCountProgress': '已加载 {0}/{1} 条结果',
        'webview.meta.resultCountLimited': '已达结果上限（{0}）',
        'webview.meta.resultCountProgressLimited': '已加载 {0}/{1} 条结果（已达结果上限 {2}）',
        'webview.results.title': '搜索结果',
        'webview.preview.title': '代码预览',
        'webview.preview.empty': '从左侧选择一个结果以预览代码。',
        'webview.preview.loading': '正在加载代码预览...',
        'webview.preview.open': '打开文件',
        'webview.preview.location': '第 {0} 行'
    },
    'en': {
        'search.kind.type': 'Type',
        'search.kind.method': 'Method',
        'search.kind.member': 'Member',
        'search.kind.text': 'Text',
        'search.match.emptyLine': '(Empty line match)',
        'webview.input.placeholder': 'Enter keyword',
        'webview.input.placeholder.type': 'Type name',
        'webview.input.placeholder.method': 'Method name',
        'webview.input.placeholder.member': 'Field or property name',
        'webview.input.clear': 'Clear input',
        'webview.match.modeLabel': 'Match mode',
        'webview.match.fuzzy': 'Fuzzy',
        'webview.match.exact': 'Exact',
        'webview.view.modeLabel': 'View mode',
        'webview.view.tree': 'Tree View',
        'webview.view.list': 'List View',
        'webview.view.collapseAll': 'Collapse All',
        'webview.view.expandAll': 'Expand All',
        'webview.view.loadingAll': 'Loading all results...',
        'webview.meta.searching': 'Searching...',
        'webview.meta.loadingAllProgress': 'Loading all results ({0}/{1})...',
        'webview.meta.indexing': 'Building index, please wait...',
        'webview.meta.indexingProgress': 'Building index ({0}/{1})',
        'webview.meta.firstIndexing': 'This workspace is building its first index. It may take longer, please wait...',
        'webview.meta.firstIndexingProgress': 'This workspace is building its first index ({0}/{1}). First run may take longer, please wait...',
        'webview.meta.indexingPartialResultCount': '{0} results found, indexing continues ({1}/{2})',
        'webview.meta.indexingPartialResultCountLimited': '{0} results found (limit {1} reached), indexing continues ({2}/{3})',
        'webview.meta.indexReady': 'Index is ready',
        'webview.meta.unsupportedWorkspace': 'Current workspace is not a .NET project. Indexing is not started.',
        'webview.meta.noResults': 'No results found',
        'webview.meta.resultCount': '{0} results',
        'webview.meta.resultCountProgress': '{0}/{1} results loaded',
        'webview.meta.resultCountLimited': 'Reached result limit ({0})',
        'webview.meta.resultCountProgressLimited': '{0}/{1} results loaded (limit {2} reached)',
        'webview.results.title': 'Search Results',
        'webview.preview.title': 'Code Preview',
        'webview.preview.empty': 'Select a result on the left to preview code.',
        'webview.preview.loading': 'Loading code preview...',
        'webview.preview.open': 'Open File',
        'webview.preview.location': 'Line {0}'
    }
};

/**
 * 语言管理器
 * 根据 VSCode 语言环境自动选择中文或英文
 */
export class LanguageManager {
    private static instance: LanguageManager;
    private currentLanguage: Language;

    private constructor() {
        // 获取 VSCode 语言环境
        const vscodeLanguage = vscode.env.language.toLowerCase();

        // 判断是否为中文环境
        this.currentLanguage = vscodeLanguage.startsWith('zh') ? 'zh-cn' : 'en';
        // this.currentLanguage = 'en';
    }

    /**
     * 获取单例实例
     */
    public static getInstance(): LanguageManager {
        if (!LanguageManager.instance) {
            LanguageManager.instance = new LanguageManager();
        }
        return LanguageManager.instance;
    }

    /**
     * 获取当前语言
     */
    public getCurrentLanguage(): Language {
        return this.currentLanguage;
    }

    /**
     * 获取文本
     * @param key 文本键
     * @param args 格式化参数（替换 {0}, {1}, ...）
     */
    public getText(key: TextKey, ...args: any[]): string {
        let text = TEXT_MAP[this.currentLanguage][key] || key;

        // 替换占位符 {0}, {1}, ...
        args.forEach((arg, index) => {
            text = text.replace(`{${index}}`, String(arg));
        });

        return text;
    }

    /**
     * 简写方法：快速获取文本
     */
    public t(key: TextKey, ...args: any[]): string {
        return this.getText(key, ...args);
    }

    /**
     * 获取所有 webview 相关的文本（用于传递给前端）
     */
    public getWebViewTexts(): Record<string, string> {
        const texts: Record<string, string> = {};
        const allKeys = Object.keys(TEXT_MAP[this.currentLanguage]) as TextKey[];

        // 只提取 webview 相关的文本
        allKeys.forEach(key => {
            if (key.startsWith('webview.')) {
                // 移除 webview. 前缀作为键
                const shortKey = key.replace('webview.', '');
                texts[shortKey] = TEXT_MAP[this.currentLanguage][key];
            }
        });

        return texts;
    }
}

/**
 * 导出单例实例
 */
export const lang = LanguageManager.getInstance();
