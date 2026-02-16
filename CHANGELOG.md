# Changelog

[English](#english) | [中文](#中文)

## English

### [Unreleased]

#### Added

- Added configurable index exclusion folders via `csharpSearch.excludeFolders`.
- Added localized webview texts via host-side `languageManager`.
- Added manifest localization with `package.nls.json` and `package.nls.zh-cn.json`.

#### Changed

- Refined search result cards to a compact 3-line layout.
- Member result metadata now shows `project / ownerType` when available.
- Added keyword highlight and theme-driven semantic coloring in result list.
- Iteratively refined tab labels and icon styling.

#### Fixed

- Improved member owner-type inference when type declarations place `{` on the next line.
- Removed layout space usage when `resultMeta` is empty.

### [1.0.0] - 2026-02-16

#### Added

- Initial release of `csharp-search`.
- Dedicated Activity Bar webview for C# symbol search.
- Built-in search strategies: `TypeSearcher` and `MethodSearcher`.
- Two-level in-memory symbol index cache with file watcher updates.
- Click-to-open search results with line navigation.

## 中文

### [Unreleased]

#### 新增

- 新增可配置索引排除目录：`csharpSearch.excludeFolders`。
- 新增 Webview 文案本地化支持（通过 `languageManager` 下发）。
- 新增扩展清单本地化：`package.nls.json` / `package.nls.zh-cn.json`。

#### 变更

- 搜索结果卡片调整为紧凑三行展示。
- 成员结果第二行在可识别时显示 `项目 / 归属类型`。
- 结果列表支持关键词高亮与主题驱动语义着色。
- 标签文本与图标样式持续收敛优化。

#### 修复

- 修复成员归属类型识别在类型声明换行 `{` 场景下的漏识别问题。
- 修复空状态下 `resultMeta` 仍占布局高度的问题。

### [1.0.0] - 2026-02-16

#### 新增

- `csharp-search` 首次发布。
- 活动栏独立 Webview 搜索入口。
- 内置 `TypeSearcher` 与 `MethodSearcher`。
- 两级内存符号索引缓存与文件监听增量更新。
- 点击结果打开文件并定位行号。