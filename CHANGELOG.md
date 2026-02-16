# Changelog | 更新日志

记录 C# API Console 的所有重要更新。  
All notable changes to this project will be documented in this file.

---

## [1.0.14] - 2026-02-15

### 中文

#### Added

- Body 的 JSON 区域新增可折叠树视图，支持节点点击折叠/展开
- Response 的 JSON 响应新增可折叠树视图，支持折叠全部与展开全部

### English

#### Added

- Added a collapsible tree view for Body JSON area with node-level expand/collapse
- Added a collapsible tree view for JSON responses with Fold All / Expand All actions

## [1.0.13] - 2026-02-15

### 中文

#### Changed

- 新增请求超时配置（默认 30s）
- 增加大响应保护（阈值降级渲染 + 行号渲染上限，可配置）
- 请求历史增加 Body 大小上限（默认 32KB，超限不保存 Body）

### English

#### Changed

- Added configurable request timeout (default 30s)
- Added large-response protection (threshold fallback rendering + max line-number limit, configurable)
- Added request-history body size cap (default 32KB; body is not stored when exceeded)

## [1.0.12] - 2026-02-15

### 中文

#### Added

- Body(JSON) 新增格式化按钮

### English

#### Added

- Added a format button for Body (JSON)

## [1.0.11] - 2026-02-15

### 中文

#### Added

- 新增按接口维度的请求历史记录，支持快速回填与清空

### English

#### Added

- Added per-endpoint request history with quick restore and clear actions

## [1.0.10] - 2026-02-15

### 中文

#### Changed

- 优化扩展打包, 减少打包体积，提升稳定性与一致性

### English

#### Changed

- Optimized extension packaging to reduce package size and improve stability and consistency

## [1.0.9] - 2026-02-14

### 中文

#### Fixed

- 修复 1.0.8 中语言被误写死为英语的问题

### English

#### Fixed

- Fixed an issue introduced in 1.0.8 where the language was mistakenly hardcoded to English

## [1.0.8] - 2026-02-14

### 中文

#### Added

- 新增 FormData Body 模式（位于 JSON 与 Binary 之间）
- 新增 FormData 字段编辑器，支持 Text/File 混合

### English

#### Added

- Added FormData body mode between JSON and Binary
- Added FormData field editor with mixed Text/File support

## [1.0.7] - 2026-02-14

### 中文

#### Added

- 新增一键启动调试按钮（位于 Send 左侧）

### English

#### Added

- Added one-click debug start button (left of Send)

## [1.0.6] - 2026-02-14

### 中文

#### Added

- Body 模式支持 JSON 与 Binary
- Binary 支持本地文件发送

#### Changed

- Binary 默认优先 multipart/form-data，415 时回退 raw binary

### English

#### Added

- Added JSON and Binary body modes
- Added local file sending in Binary mode

#### Changed

- Binary sends multipart/form-data first, then falls back to raw binary on 415

## [1.0.5] - 2026-02-13

### 中文

#### Added

- Query 标签新增快速输入框，支持直接粘贴查询字符串

#### Changed

- 发送请求时优先使用快速输入框参数

### English

#### Added

- Added quick query input in Query tab for pasted query strings

#### Changed

- Query text input now takes priority when sending requests

## [1.0.4] - 2026-02-13

### 中文

#### Changed

- 优化 CodeLens 排序，API Test 始终显示在官方 References 右侧

### English

#### Changed

- Improved CodeLens ordering so API Test appears to the right of official References

---

## [1.0.3] - 2026-02-13

### 中文

#### Added

- 支持 launchSettings.json 注释行过滤

#### Changed

- 重构 API Console 布局为“顶部请求栏 + 下方双栏”
- 优化 Base URL 管理弹窗交互（仅按钮关闭）

#### Fixed

- 改进资源释放，面板关闭时清理更稳定

### English

#### Added

- Added launchSettings.json comment-line filtering

#### Changed

- Refactored API Console layout to top request bar + bottom split panels
- Improved Base URL modal interaction with button-only close

#### Fixed

- Improved resource cleanup stability when the panel closes

---

## [1.0.2] - 2026-02-12

### 中文

#### Added

- 新增 Base URL 管理（增删改）
- 支持多环境 Base URL 快速切换
- 配置持久化到 .vscode/csharp-api-console-config.json

#### Changed

- 优化发送状态反馈与紧凑布局体验

### English

#### Added

- Added Base URL management (add/edit/delete)
- Added quick environment switching via Base URLs
- Added persisted config in .vscode/csharp-api-console-config.json

#### Changed

- Improved sending-state feedback and compact layout

---

## [1.0.1] - 2026-02-12

### 中文

#### Fixed

- 修复可空泛型返回类型识别（如 Task<long?>、Task<Person?>）

### English

#### Fixed

- Fixed nullable generic return type parsing (e.g., Task<long?>, Task<Person?>)

---

## [1.0.0] - 2026-02-11

### 中文

#### Added

- 首次正式发布，提供 ASP.NET Core API 测试能力
- 新增 CodeLens 一键测试入口与多标签测试面板
- 新增智能端点识别与 launchSettings 自动 Base URL
- 新增 Auth / Headers / Query / Body 配置与格式化响应

#### Changed

- 引入两层缓存、防抖与延迟加载以优化性能

### English

#### Added

- Initial stable release for ASP.NET Core API testing
- Added CodeLens test entry and multi-tab test panels
- Added smart endpoint detection and auto Base URL from launchSettings
- Added Auth / Headers / Query / Body configuration and formatted response

#### Changed

- Introduced two-layer cache, debounce, and lazy loading for performance

---

## 反馈 | Feedback

如有问题或建议，欢迎访问：  
For issues or suggestions, please visit:

**GitHub**: https://github.com/wjire/csharp-api-console/issues
**Gitee** : https://gitee.com/dankit/csharp-api-console/issues