# Changelog

[English](#english) | [中文](#中文)

## English

### [1.0.11] - 2026-02-23

#### Fixed

- Fixed missing toolbar/disclosure icons in installed builds by moving `@vscode/codicons` to runtime dependencies, ensuring Webview codicon assets are packaged in VSIX.

### [1.0.10] - 2026-02-18

#### Changed

- Fixed header toolbar button sizing: `Tree/List` and `Expand/Collapse` buttons now use the same control height as `Fuzzy/Exact` for consistent single-line alignment.

### [1.0.9] - 2026-02-18

#### Changed

- Added workspace type guard for indexing startup: non-.NET workspaces now show an unsupported hint and do not start indexing.
- Search service/index initialization is now lazy and starts only when a .NET workspace is detected after opening the view.

### [1.0.8] - 2026-02-18

#### Changed

- Improved search-response metadata to explicitly indicate when query results hit the configured `maxResults` limit.
- Updated result meta text to show capped-result status (for example, `Reached result limit (500)`) to avoid confusion with full-result paging.
- Added incremental search for prefix expansion: fast filtering from previous results, with background full-index correction when previous results are capped by `maxResults`.

### [1.0.7] - 2026-02-17

#### Changed

- Improved overall search view UX and visual consistency.
- Improved result interaction behavior for expand/collapse and paging scenarios.

### [1.0.6] - 2026-02-17

#### Added

- Added result view toolbar with single-toggle buttons for `Tree/List` and `Expand/Collapse All`.
- Added list-mode grouped layout: `file (.cs)` row with expandable matched entries.

#### Changed

- Refactored search result UI to support compact hierarchical rendering in both `Tree` and `List` modes.

### [1.0.5] - 2026-02-17

#### Added

- Added paginated result loading with infinite scroll in the search view.
- Added configurable page size setting: `csharpSearch.pageSize` (default `100`, range `20-500`).

#### Changed

- Search result meta now shows progressive loaded count while more pages exist (for example, `120/500 results loaded`).
- Search header area is now sticky, keeping tabs/input/match mode/result count visible while scrolling.
- Updated clear-input icon style in the search box.

### [1.0.4] - 2026-02-17

#### Added

- Added indexing status/progress in the search view, visible immediately after opening the panel.
- Added a short `Index is ready` hint after initial indexing completes.
- Added configurable result limit setting: `csharpSearch.maxResults` (default `500`, range `50-1000`).

#### Changed

- During initial indexing, search requests are deferred and automatically executed once the index is ready.
- Activation is now explicitly bound to `onView:csharpSearch.mainView` (activates when the panel is first opened).

### [1.0.3] - 2026-02-17

#### Changed

- Search kinds are now split into `Type`, `Method`, `Member`, and `Impl`.
- `Method` focuses on methods/constructors.
- `Member` focuses on fields/properties.
- `Impl` supports searching by implementation type name and interface/base type name.

### [1.0.2] - 2026-02-16

#### Added

- Added configurable search debounce setting: `csharpSearch.searchDebounceMs` (default `300`, range `0-1000`).

#### Changed

- Frontend now drops stale `searchResults` responses by `requestId` to avoid old results overriding new input.
- Search index now stores precomputed lowercase symbol names to reduce repeated lowercase conversions at query time.
- Index storage switched to per-kind/per-file buckets for more precise incremental add/remove updates.
- Optimized line-number calculation in `TypeSearcher` and `MethodSearcher` using prebuilt line-break indexes with binary search.
- Added exact/fuzzy match mode toggle in search view and wired it to backend matching behavior.

### [1.0.1] - 2026-02-16

#### Added

- Added command and default shortcut to focus C# Search view: `Ctrl+T` (`Cmd+T` on macOS), aligned with Visual Studio.

### [1.0.0] - 2026-02-16

#### Added

- Initial release of `csharp-search`.
- Dedicated Activity Bar webview for C# symbol search.
- Built-in search strategies: `TypeSearcher` and `MethodSearcher`.
- Two-level in-memory symbol index cache with file watcher updates.
- Click-to-open search results with line navigation.

## 中文

### [1.0.11] - 2026-02-23

#### 修复

- 修复安装版图标不可见问题：将 `@vscode/codicons` 调整为运行时依赖，确保 Webview 的 codicon 资源会被打入 VSIX，从而恢复工具栏与折叠图标显示。

### [1.0.10] - 2026-02-18

#### 变更

- 修复头部工具栏按钮尺寸：`树形/列表` 与 `展开/折叠` 按钮高度与 `模糊/精确` 统一，保持同一行视觉对齐一致。

### [1.0.9] - 2026-02-18

#### 变更

- 新增工作区类型守卫：非 .NET 工作区进入视图时仅提示“当前工作区不是 .NET 项目，未启动索引”，不触发索引构建。
- 搜索服务与索引初始化改为懒加载：仅在进入视图且判定为 .NET 工作区后才启动。

### [1.0.8] - 2026-02-18

#### 变更

- 改进搜索结果元数据：当命中 `maxResults` 上限时会明确标记。
- 结果状态文案新增“已达结果上限（例如 `已达结果上限（500）`）”，避免与全量分页混淆。
- 新增前缀扩展增量搜索：先基于上一轮结果快速筛选；若上一轮命中 `maxResults` 上限，再后台执行全索引校正。

### [1.0.7] - 2026-02-17

#### 变更

- 进一步优化搜索视图整体体验与视觉一致性。
- 优化展开/折叠与分页联动场景下的交互体验。

### [1.0.6] - 2026-02-17

#### 新增

- 新增结果工具栏：`树形/列表` 单按钮切换、`全部展开/全部折叠` 单按钮切换。
- 新增列表模式分组展示：按 `.cs` 文件分组，并支持文件层展开/折叠命中项。

#### 变更

- 搜索结果 UI 重构为更紧凑的层级展示，树形与列表两种模式可切换。

### [1.0.5] - 2026-02-17

#### 新增

- 搜索结果支持滚动分页加载（无限滚动）。
- 新增分页条数配置：`csharpSearch.pageSize`（默认 `100`，范围 `20-500`）。

#### 变更

- 在有后续分页时，结果状态显示“已加载/总数”（例如 `已加载 120/500 条结果`）。
- 搜索头部区域改为置顶，滚动时仍可看到标签、输入框、匹配模式和结果数量。
- 输入框清空图标样式更新。

### [1.0.4] - 2026-02-17

#### 新增

- 搜索面板打开后即可看到索引状态/进度，无需先输入关键字。
- 首次索引完成后新增短暂“索引已完成”提示。
- 新增可配置结果上限：`csharpSearch.maxResults`（默认 `500`，范围 `50-1000`）。

#### 变更

- 首次索引期间会延迟搜索请求，索引就绪后自动发起搜索。
- 激活时机显式绑定为 `onView:csharpSearch.mainView`（首次打开面板时激活）。

### [1.0.3] - 2026-02-17

#### 变更

- 搜索类别调整为 `类型`、`方法`、`成员`、`实现` 四类。
- `方法` 专注方法/构造函数。
- `成员` 专注字段/属性。
- `实现` 检索支持按实现类名及接口/基类名称查询。

### [1.0.2] - 2026-02-16

#### 新增

- 新增可配置搜索防抖项：`csharpSearch.searchDebounceMs`（默认 `300`，范围 `0-1000`）。

#### 变更

- 前端按 `requestId` 丢弃过期 `searchResults`，避免旧结果覆盖新输入。
- 索引阶段预计算符号小写名称，减少查询时重复小写转换开销。
- 索引存储调整为按 kind/文件分桶，增量增删更精准。
- `TypeSearcher` 与 `MethodSearcher` 的行号计算改为“预建换行索引 + 二分查找”，降低多命中场景的计算开销。
- 搜索视图新增精确/模糊匹配切换。

### [1.0.1] - 2026-02-16

#### 新增

- 新增聚焦 C# Search 视图的命令与默认快捷键：`Ctrl+T`（macOS 为 `Cmd+T`），与 Visual Studio 保持一致。

### [1.0.0] - 2026-02-16

#### 新增

- `csharp-search` 首次发布。
- 活动栏独立 Webview 搜索入口。
- 内置 `TypeSearcher` 与 `MethodSearcher`。
- 两级内存符号索引缓存与文件监听增量更新。
- 点击结果打开文件并定位行号。