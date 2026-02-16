# Changelog

[English](#english) | [中文](#中文)

## English

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