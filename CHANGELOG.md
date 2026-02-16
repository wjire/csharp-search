# Changelog

[English](#english) | [中文](#中文)

## English

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