# Task UCA-030 — Overlay 会话时间线与跟进任务

## 1. 任务目标

把当前 Overlay 从一次性输入器继续升级成可持续跟进的小会话器：能看最近轮次、基于结果继续追问、快速切回上一个任务。

## 2. 前置依赖

- 上一个任务：UCA-027、UCA-028、UCA-029
- 必须已有的产物：气泡式 Overlay、结果摘要预览、任务状态刷新链
- 不能同时修改的区域：任务生命周期与事件模型主干

## 3. 实施范围

- 负责模块：Overlay 时间线、最近任务切换、继续追问 UX、小型结果中心
- 允许改动文件/目录：`src/desktop/renderer/`, `src/service/core/`, `phases/tasks/`
- 明确不做：完整多会话聊天系统、远程协同

## 4. 交付产物

- Overlay 会话时间线
- 上一个任务结果继续追问
- 最近任务小型结果中心
- 对应验证脚本更新

## 5. 验证方式

- 连续两轮追问 smoke test
- 最近任务切换 smoke test
- `npm run check`

## 6. Git 执行方式

- 分支名：`task/uca-030-overlay-session`
- Commit 格式：`UCA-030: add overlay session timeline`
- 合并条件：Overlay 可连续处理多轮任务且不丢上下文

## 7. 完成后必须更新本文件

- 写明时间线范围与会话保留策略
- 写明多轮追问已知限制
- 写明如何交接给控制台历史中心

## 8. 对下一个任务的交接

- 下一个任务：多模态结果中心与历史资产管理
- 本任务新增了什么：轻量会话时间线与 follow-up UX
- 下一个任务直接可复用什么：Overlay 会话模型、最近任务摘要
- 还没解决的问题：跨会话检索、持久会话策略

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-10
- 完成日期：2026-04-11
- 实际新增内容：
  - Overlay 会话时间线（气泡流）、最近任务列表、载入最近任务回填上下文、基于结果继续追问的 follow-up 记录
  - 多轮追问：每次用户提交时，完整的对话历史被折叠进 `capture.text` 发给 LLM，模型能看到之前说过什么（详细实现见 UCA-038）
  - 从内联结果框 → Overlay 的 handoff 会携带 `priorResult` / `priorUserCommand`，应用 handoff 时自动把前一轮 Q+A 以气泡渲染，并进入"持久会话"模式（不自动消失）
- 验证结果：`node scripts/verify-overlay-composer.mjs`、`node scripts/verify-browser-extension.mjs`、`npm run check` 通过
- 遗留问题：
  - 会话历史面板（侧边栏列出多个历史会话供用户点击恢复）尚未实现 —— 见 UCA-041
  - **[已知缺陷]** 用户反馈：新建会话后，发送的用户消息在 UI 上看不到（气泡没绘制），但提交链路似乎继续运行；需要定位 `handleUserSend` 在新会话下的 `addBubble("user", ...)` 路径
  - **[已知缺陷]** 用户反馈：关闭 Overlay 后，之前的对话气泡看不到了；虽然 conversationState 已持久化到 localStorage，但 `restoreConversation()` 恢复时没有把 turns 重新渲染成 bubble；需要在 init 阶段遍历 `conversationState.turns` 调用 `addBubble`
  - **[已知缺陷]** 用户反馈：AI 说"已启动应用"但实际没启动 —— 出现在 tool_using 路径；可能是 `launch_app` 返回 success 但实际 Start-Process 是空回退，或 LLM 在工具调用失败后没如实汇报；需要让 LLM 汇报严格绑定在 tool 返回的 `success` 字段
- 交接给下一个任务：UCA-038 把 sessionEntries 泛化为统一 `conversationState`；UCA-031 复用本任务的 artifact 气泡继续做结果中心
