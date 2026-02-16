# csharp-search

专为 C# 项目优化的搜索扩展，在 VS Code 左侧活动栏提供独立入口。

## 当前功能

- 左侧活动栏新增 `C# Search` 入口。
- 入口内使用单个 `WebviewView`，顶部 Tab 支持 `方法` / `类型` 切换。
- 下方输入关键字后，扩展端按当前 Tab 搜索工作区所有 `.cs` 文件。
- 点击结果可跳转到对应文件与行号。

## 架构说明

- 搜索策略接口：`src/search/ISymbolSearcher.ts`
- 搜索服务编排：`src/search/SymbolSearchService.ts`
- 默认策略实现：
	- `src/search/searchers/MethodSearcher.ts`
	- `src/search/searchers/TypeSearcher.ts`
- Webview 前端三文件分离：
	- `media/search-view.html`
	- `media/search-view.css`
	- `media/search-view.js`

## 扩展更多搜索类别

1. 新建一个实现 `ISymbolSearcher` 的搜索器类。
2. 在 `src/extension.ts` 中将该类注册到 `SymbolSearchService` 构造函数。
3. Webview 会自动收到新的 `kind` 并渲染为新 Tab，无需改前端结构。

## 开发

- 安装依赖：`npm install`
- 编译：`npm run compile`
- 调试运行：按 `F5` 启动 Extension Development Host
