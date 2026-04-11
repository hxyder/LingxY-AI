# Task UCA-037 — 浏览器扩展网页内联结果框 + runQuickAction + open-in-dialog with priorResult

## 1. 任务目标

用户在网页选中文字后，点击浮动 chip 的「翻译 / 总结 / 解释」时，直接在网页上显示结果卡片 —— 不需要跳到桌面 Overlay。完成后用户可以点"在对话框打开"把结果连同原文带回 Overlay 做持续追问。

## 2. 前置依赖

- 上一个任务：UCA-011（browser overlay polish）、UCA-029（unified capture entrypoints）、UCA-034（free translation）、UCA-036（Apple overlay tokens）
- 必须已有的产物：content_script floating chip、service-worker 消息路由、http-server `/task` 端点
- 不能同时修改的区域：扩展 manifest 权限、native messaging 协议

## 3. 实施范围

- 负责模块：content_script 内联结果框、service-worker 轮询后端、Overlay 侧的 priorResult handoff 渲染
- 允许改动文件/目录：`browser_ext/content_script/`、`browser_ext/background/`、`src/service/core/http-server.mjs`、`src/desktop/renderer/overlay.js`、`scripts/verify-browser-extension.mjs`
- 明确不做：扩展 manifest v3 → v2 回退、新建 popup 窗口

## 4. 交付产物

- `showInlineResultFrame({action, rect, previewText, doc})`：Shadow DOM 隔离的 Apple 风格浮动卡片
- `runQuickAction({action, selectionState}, fetchImpl)`：service-worker 端的 POST + 轮询 helper
- `uca.runtime.runQuickAction` 消息路由
- `uca.overlay.openWithResult` 消息 + `priorResult` / `priorUserCommand` 透传
- writeOverlayHandoff 写入 handoff JSON 时带上 priorResult/priorUserCommand
- overlay.applyShellHandoff 渲染前一轮 Q+A 为气泡

## 5. 验证方式

- `node scripts/verify-browser-extension.mjs`（断言：selection-cache 包含 `showInlineResultFrame` / `uca.runtime.runQuickAction` / `uca.overlay.openWithResult`；service-worker 包含 `runQuickAction` 导出；buildOverlayHandoffRequest 接受 `priorResult`）
- 手动：浏览器选中英文 → 浮动 chip → 翻译 → 看到 in-page 译文卡片 → 点"在对话框打开" → Overlay 展开前一轮 Q+A → 输入追问 → 得到延续回答
- 手动：不同段落连续翻译 → 每次都能拿到对应内容（见遗留问题）

## 6. Git 执行方式

- 分支名：`task/uca-037-browser-inline-result`
- Commit 格式：`UCA-037: in-page result frame + open-in-dialog with priorResult`
- 合并条件：在页面上点翻译/总结/解释能直接看到结果；"在对话框打开"能把结果带到 Overlay 并继续追问

## 7. 完成后必须更新本文件

- 列出 in-page frame 的定位策略与边界
- 列出 runQuickAction 的轮询节奏与超时
- 列出扩展缓存问题与重新加载指引

## 8. 对下一个任务的交接

- 下一个任务：UCA-038（对话记忆）—— 在 Overlay 里消费 priorResult 做多轮追问
- 本任务新增了什么：in-page Shadow DOM 结果卡片 + priorResult 链路
- 下一个任务直接可复用什么：`openWithResult` 消息格式、`buildOverlayHandoffRequest({priorResult})` 的可选参数
- 还没解决的问题：网页内连续触发翻译时缓存 bug（见遗留问题）

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：把浏览器选区交互改成"selection snapshot + request id"模型。每次点击 quick action 时冻结 `{text, url, title, rect, fingerprint, createdAt}`，`runQuickAction`、inline frame、`openWithResult` 都只传递这个不可变 snapshot；结果返回时按 `requestId` 更新对应 frame，避免读取全局 mutable selection state 或旧 frame 闭包。
- 当前代码对齐点：`browser_ext/content_script/selection-cache.js` 已有 `showInlineResultFrame` 和 chip 分流，`browser_ext/background/service-worker.js` 已有 `runQuickAction` 与 `buildOverlayHandoffRequest({ priorResult })`；需要统一 message payload，把 `selectionState` 改为 snapshot 结构，并让 service-worker 的轮询结果带回 `requestId/fingerprint`。UCA-040 已修好 service core dedupe，不再把后端去重当成此问题的处理点。
- 可能需要生成的文件：不需要新增运行时代码文件；需要扩展 `scripts/verify-browser-extension.mjs` 的连续选区场景 fixture，并可增加一份 `.tmp` mocked fetch 记录用于断言 A 段/B 段不会串结果。

## 9. 执行记录

- 状态：in_progress
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：
- 实际新增内容：
  - **content_script `showInlineResultFrame`**（[selection-cache.js](../../browser_ext/content_script/selection-cache.js)）：
    - Shadow DOM 隔离（`all: initial` 不被宿主 CSS 污染）
    - Apple-style frosted glass 卡片，`backdrop-filter: blur(28px) saturate(180%)`，圆角 18px
    - Header：UCA badge + 选区预览 + 关闭按钮
    - Body：loading → spinner；ready → 结果文本；error → 红色消息
    - Actions：复制 / 在对话框打开
    - 自动定位：选区下方 8px，溢出边界时翻转到上方/左侧
    - Esc 关闭、60 秒自动关闭
  - **chip 点击分流**：translate/summarize/explain → 显示内联结果框 + 发 `uca.runtime.runQuickAction`；其他 action → 原有 `uca.overlay.captureSelection` 回退
  - **service-worker `runQuickAction`**（[service-worker.js](../../browser_ext/background/service-worker.js)）：
    - POST `http://127.0.0.1:4310/task` with `{capture, userCommand}`
    - 从 submit 响应同步提取 inline_result（translate executor 是同步的）
    - 否则每 600ms 轮询 `/task/:id`，最多 30 秒
    - 返回 `{ok, taskId, text, status}`
  - **buildOverlayHandoffRequest 扩展**：接受 `priorResult` 参数，注入 `payload.priorResult` + `payload.priorUserCommand`（从 action 推出）
  - **`uca.overlay.openWithResult` 消息**：service-worker 收到后构造 handoff 请求，走 `dispatchOverlayHandoff`
  - **writeOverlayHandoff**（[http-server.mjs](../../src/service/core/http-server.mjs)）：透传 priorResult / priorUserCommand 到 prompt-handoff JSON
  - **Overlay applyShellHandoff**：检测到 `priorResult` 时 `startNewConversation()` + `ensureConversation()` + `appendTurn("user", priorPrompt)` + `appendTurn("assistant", priorResult)`，`markUserEngaged()` 取消 auto-hide，渲染原选区预览气泡 + 前一轮回复气泡 + 系统提示
  - **诊断日志**：chip 点击时 `console.info("[UCA] inline result frame path", action)`，方便用户在 DevTools 确认新代码是否加载
- 验证结果：
  - `node scripts/verify-browser-extension.mjs` 通过（新断言：`showInlineResultFrame` / `uca.runtime.runQuickAction` / `uca.overlay.openWithResult` / `priorResult: resultText` / `conversationState` 等）
  - 手动 mocked-fetch smoke：POST body 含 `priorResult: '[zh] 你好世界'` + `priorUserCommand: '请翻译这段网页内容'`，response `accepted: true`
- 遗留问题：
  - **[已知缺陷]** 用户反馈：对不同段落连续触发翻译时，第二次翻译显示的仍是上一段内容。UCA-040 的 dedupe 修复只解决了后端去重缓存返回空的问题，这个 bug 涉及浮动 chip 的 selection state 或 in-page frame 闭包捕获，需进一步定位
  - 扩展更新需要手动 `chrome://extensions` → Reload + 刷新页面；已在代码里加诊断 console.info 帮助用户确认
  - Shadow DOM 卡片不支持富文本（Markdown/HTML 渲染），只显示纯文本
- 交接给下一个任务：
  - UCA-038 在 Overlay 侧直接消费 `priorResult` 做多轮追问
  - `runQuickAction` 可以作为"无需打开 Overlay 就能跑后台任务"的通用入口，后续其他网页内一键 action 都走这条路
