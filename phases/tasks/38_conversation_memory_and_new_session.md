# Task UCA-038 — Overlay 对话记忆、压缩、新会话按钮与话题自动切换

## 1. 任务目标

让 Overlay 从"一次性输入器"升级为能记住多轮追问的小型对话器。每次用户追问时 LLM 看到完整的对话历史；超过阈值时自动压缩；用户可以点「新会话」按钮或让系统自动检测话题切换来重置记忆；关闭 overlay 不会丢失对话，下次重开自动恢复。

## 2. 前置依赖

- 上一个任务：UCA-030（overlay session timeline）、UCA-036（Apple overlay rework）、UCA-037（priorResult handoff）
- 必须已有的产物：overlay 气泡会话层、pendingCapture、`buildHistoryBlock` 可注入的 submitTask
- 不能同时修改的区域：service 端 context_packet schema、task 执行器主干

## 3. 实施范围

- 负责模块：conversationState 数据模型、持久化、压缩、新会话按钮、话题自动切换逻辑
- 允许改动文件/目录：`src/desktop/renderer/overlay.js`、`src/desktop/renderer/overlay.html`、`scripts/verify-browser-extension.mjs`、`scripts/verify-overlay-composer.mjs`
- 明确不做：会话历史列表 UI（侧边栏、恢复历史会话）—— 见 UCA-041

## 4. 交付产物

- `conversationState` 统一数据模型
- `ensureConversation / appendTurn / compressIfNeeded / persistConversation / restoreConversation / startNewConversation / buildHistoryBlock / seedCaptureMatches` 一组 helper
- Toolbar "➕ 新会话" 按钮
- 话题自动切换：applyShellHandoff 和 clipboardBtn 检测 seedCaptureMatches，不一致时自动 startNewConversation
- localStorage 持久化 key `uca.overlay.conversation.v1`

## 5. 验证方式

- `node scripts/verify-overlay-composer.mjs`（断言 conversationState / ensureConversation / appendTurn / compressIfNeeded / persistConversation / restoreConversation / newSessionBtn 都在 overlay.js 里）
- `node scripts/verify-browser-extension.mjs`
- 手动：追问同一话题 N 轮 → 看 LLM 记得之前说的
- 手动：超过 12 轮 → 看到 `[…压缩了 N 轮早先的对话…]` placeholder
- 手动：关闭 overlay → 重开 → restoreConversation 恢复（注意：当前只恢复 state，不重新渲染气泡，见遗留问题）
- 手动：切换话题（新选区 / 新剪贴板）→ 自动提示"已开启新会话"

## 6. Git 执行方式

- 分支名：`task/uca-038-conversation-memory`
- Commit 格式：`UCA-038: add conversation memory with compression and new-session button`
- 合并条件：多轮追问能看到历史；压缩生效；新会话按钮可点；话题切换能自动识别

## 7. 完成后必须更新本文件

- 列出压缩策略（保留前 N + 后 M 轮）
- 列出 context text 硬上限
- 列出持久化 schema 版本

## 8. 对下一个任务的交接

- 下一个任务：UCA-041（会话历史列表 UI）在此基础上增加多会话管理
- 本任务新增了什么：单一持久化会话 + 记忆压缩 + 新会话按钮 + 话题切换
- 下一个任务直接可复用什么：conversationState schema、persistConversation key
- 还没解决的问题：多会话列表、会话标题生成、会话搜索

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：把气泡渲染从提交分支里抽成 conversation render pipeline。`appendTurn` 只负责数据写入，`renderConversationFromState(conversationState)` 负责从 state 重建气泡；`handleUserSend` 必须先渲染 user turn，再提交任务，不能依赖 `conversationPhase` 的临时状态判断。
- 当前代码对齐点：`src/desktop/renderer/overlay.js` 已有 `conversationState`、`appendTurn`、`persistConversation`、`restoreConversation` 和 `startNewConversation`；缺口是恢复后没有把 `turns` 重新绘制，以及新会话后 `addBubble("user", ...)` 可能被 phase 分支跳过。UCA-041 的 v3 projects schema 应复用同一 `renderConversationFromState`，不要另写一套历史渲染逻辑。
- 可能需要生成的文件：不需要新增运行时代码文件；需要扩展 `scripts/verify-overlay-composer.mjs`，覆盖 `renderConversationFromState`、新会话后 user bubble、关闭/重开后气泡恢复。

## 9. 执行记录

- 状态：in_progress
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：
- 实际新增内容：
  - **conversationState 数据模型**（[overlay.js](../../src/desktop/renderer/overlay.js)）：
    ```
    { id, seedCapture, seedCommand, turns: [{role, content, ts, compressed?}], startedAt, updatedAt }
    ```
  - **helper 函数**：
    - `newConversationId()` —— 基于时间戳 + 随机段生成
    - `ensureConversation(seedCapture, seedCommand)` —— 懒初始化
    - `appendTurn(role, content)` —— 记录一轮，触发压缩和持久化
    - `compressIfNeeded()` —— 超过 `COMPRESS_TURN_LIMIT=12` 轮时保留前 `COMPRESS_KEEP_START=2` + 后 `COMPRESS_KEEP_END=6`，中间合并为 "[…压缩了 N 轮早先的对话以节省上下文…]" placeholder
    - `persistConversation()` / `restoreConversation()` —— localStorage key `uca.overlay.conversation.v1`，异常时静默 fail
    - `startNewConversation()` —— 清空 state + 清空气泡 + showWelcome
    - `buildHistoryBlock(excludeLast)` —— 渲染 turns 为 "用户：xxx\n\n助手：yyy" 文本
    - `seedCaptureMatches(newText)` —— 比较新 text 前 200 字符与 seedCapture.text 的一致性
  - **submitTask 注入历史**：走 `pendingCapture?.capture || conversationState?.seedCapture` 分支时，调用 `buildHistoryBlock(false)` 把完整对话历史折叠进 `capture.text`，硬上限 `MAX_CAPTURE_TEXT_CHARS=8000`
  - **handleUserSend 记录用户 turn**：提交前 `ensureConversation()` + `appendTurn("user", text)`
  - **refreshActiveTask 记录助手 turn**：
    - 普通 inline_result 成功时 `appendTurn("assistant", finalText)`
    - 有 artifact 的任务完成时记录 `生成了文件 {filename}\n\n{previewText}`，方便后续追问
  - **新会话按钮**（[overlay.html](../../src/desktop/renderer/overlay.html)）：Quick toolbar 最左加 `➕ 新会话`，点击 → `startNewConversation()` + 系统提示
  - **话题自动切换**：
    - `applyShellHandoff` 收到 capture 时调用 `seedCaptureMatches(newText)`，不一致 → `startNewConversation()` + "检测到新的上下文，已开启新会话"
    - `clipboardBtn` 同样判断
  - **close 不清空**：`closeBtn` 只 `clearBubbles() + hideWindow`，保留 conversationState；下次 onShellReady 时 `restoreConversation()` 从 localStorage 恢复
  - **priorResult 路径**：applyShellHandoff 看到 `payload.priorResult` 时 `startNewConversation()` + 连续 `appendTurn("user", priorPrompt)` + `appendTurn("assistant", priorResult)` —— 把 UCA-037 带来的前一轮 Q+A 接入对话记忆
- 验证结果：
  - `node scripts/verify-overlay-composer.mjs` 通过
  - `node scripts/verify-browser-extension.mjs` 通过（断言改为 conversationState 系列）
  - 手动 smoke：连续追问能保持上下文，压缩阈值触发，新会话按钮工作
- 遗留问题：
  - **[已知缺陷]** 用户反馈：新建会话后，发送的用户消息在 UI 上看不到（气泡不绘制）。提交链路似乎继续运行但 `addBubble("user", text)` 没触发；需要定位 `handleUserSend` 里 `conversationPhase === "idle"` 判定是否在新会话后被跳过
  - **[已知缺陷]** 用户反馈：关闭 Overlay 后，之前的会话气泡看不到了。当前 `restoreConversation()` 只恢复内存 state，没有在 `onShellReady` 时遍历 `conversationState.turns` 重新调用 `addBubble` 绘制气泡；需要补一个 `renderConversationFromState()` 并在 init 调用
  - **[已知限制]** 多会话列表 UI 尚未实现 —— 当前只有一个全局 conversation；见 UCA-041
- 交接给下一个任务：
  - UCA-041 升级 storage schema 到 v3（projects + conversations + currentProjectId/currentConversationId）+ 增加侧边栏列表 UI
  - `appendTurn` / `persistConversation` 接口保持向下兼容
