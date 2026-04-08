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

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
