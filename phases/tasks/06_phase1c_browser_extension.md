# Task UCA-006 — Phase 1c 浏览器扩展与 Native Messaging

## 1. 任务目标

让网页文本选区、链接和图片能从浏览器直接进入 UCA。

## 2. 前置依赖

- 上一个任务：UCA-004
- 必须已有的产物：service API、ContextPacket 基础协议
- 不能同时修改的区域：Explorer/file helper

## 3. 实施范围

- 负责模块：MV3 扩展、content script、background、Native Messaging Host
- 允许改动文件/目录：`browser_ext/`, `uca-native-host/`, `src/service/`
- 明确不做：跨应用浮标

## 4. 交付产物

- 浏览器扩展
- 右键菜单
- Native Messaging Host
- text_selection / link / image / webpage ContextPacket

## 5. 验证方式

- 扩展加载通过
- Native Messaging 通信成功
- Puppeteer / E2E 跑通选区到任务

## 6. Git 执行方式

- 分支名：`task/uca-006-phase1c-browser-extension`
- Commit 格式：`UCA-006: add browser extension pipeline`
- 合并条件：Chrome / Edge 最少各完成一次 happy path

## 7. 完成后必须更新本文件

- 写明扩展权限
- 写明 Native Host 注册方式
- 记录兼容站点与已知例外

## 8. 对下一个任务的交接

- 下一个任务：UCA-007、UCA-011
- 本任务新增了什么：浏览器捕获与网页上下文
- 下一个任务直接可复用什么：extension source types、native host 链路
- 还没解决的问题：浮标策略和状态视图还不完整

## 9. 执行记录

- 状态：in_progress
- 执行分支：`task/uca-006-phase1c-browser-extension`
- 开始日期：2026-04-08
- 完成日期：
- 实际新增内容：
  - 新增 `browser_ext/manifest.json`、background/content script/popup/shadow UI 结构
  - 新增 `uca-native-host/`，完成 Native Messaging framing、request handler、注册 manifest builder
  - 新增 `src/service/core/browser-submission.mjs`，接入 `text_selection` / `link` / `image` / `webpage` context
  - 新增浏览器 runtime 文档：扩展安装说明与 Native Messaging 协议说明
  - 新增 `scripts/verify-browser-extension.mjs`，覆盖 manifest、Native Host framing、browser capture happy path
- 扩展权限：
  - `activeTab`
  - `contextMenus`
  - `nativeMessaging`
  - `scripting`
  - `storage`
  - `host_permissions: <all_urls>`
- Native Host 注册方式：
  - 当前使用 `com.uca.host`
  - 注册 manifest 的构造函数位于 `uca-native-host/registry-manifest.mjs`
  - Chrome / Edge 用户级注册说明见 `docs/runtime/install_extension.md`
- 兼容站点与已知例外：
  - 默认目标是 Chrome / Edge 的常规网页内容
  - 图片流程当前只创建 `unsupported` 任务，不做 OCR
  - Shadow DOM 浮标仅是骨架，复杂 SPA 的重定位和滚动修正仍待 Phase 3/后续补完
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - `node scripts/verify-desktop-shell.mjs` 通过
  - `node scripts/verify-service-core.mjs` 通过
  - `node scripts/verify-file-kimi.mjs` 通过
  - `node scripts/verify-browser-extension.mjs` 通过
- 遗留问题：
  - 还没有真实 Chrome / Edge unpacked 安装验证与实际 Native Host 注册表写入
  - `link` 抓取仍是 placeholder，没有接 `readability`
  - popup 还没有打开主控制台的真实跳转协议
  - content script 还没有处理复杂滚动、选区折叠和站点黑名单
- 交接给下一个任务：
  - `UCA-007` 可直接复用 browser task 事件流和 `unsupported` 状态来补状态机、失败分类、取消重试
  - `UCA-011` 可直接扩展 `browser_ext/content_script/selection-cache.js` 与 `shadow_ui/floating-chip.js` 做跟随浮标和浏览器内状态呈现
