# UCA-061 — 执行过程透明化（Execution Transparency）

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-054, UCA-032  
**Branch**: `task/uca-061-execution-transparency`

## 目标

在对话框里实时显示 AI 正在执行哪些操作，让用户看到完整的执行流程，而不只是最终结果。

参考框架：OpenDevin 实时操作流、ChatGPT "Searching the web..."、Perplexity 的步骤展示。

## 问题根因

目前 `tool_call_proposed` / `tool_call_completed` / `step_started` 事件只写入 `runtime.store`，没有推送到 overlay 的对话流里。用户看到的只有"Done."——完全不知道 AI 中间做了什么。

实测：控制台里显示了 3 个任务且内容一样，但对话框里什么都看不到。

## 关键修改

### `src/service/core/task-runtime.mjs`

在 `emitTaskEvent()` 里增加 `conversation_step` 事件转发：

```js
const CONVERSATION_VISIBLE_EVENTS = new Set([
  "step_started", "tool_call_proposed", "tool_call_completed",
  "status_changed", "failed", "cancelled"
]);

export function emitTaskEvent({ runtime, taskId, eventType, payload }) {
  const record = { ... }; // 现有逻辑

  // 额外推送到对话流
  if (CONVERSATION_VISIBLE_EVENTS.has(eventType)) {
    const stepMessage = formatStepMessage(eventType, payload);
    if (stepMessage) {
      runtime.eventBus.publish({
        event_type: "conversation_step",
        task_id: taskId,
        step_label: stepMessage,
        ts: nowIso()
      });
    }
  }
}

function formatStepMessage(eventType, payload) {
  if (eventType === "tool_call_proposed") {
    return `正在调用：${TOOL_LABELS[payload.tool_id] ?? payload.tool_id}…`;
  }
  if (eventType === "tool_call_completed") {
    const ok = payload.success !== false;
    return `${TOOL_LABELS[payload.tool_id] ?? payload.tool_id} ${ok ? "✓" : "✗ 失败"}`;
  }
  if (eventType === "step_started") {
    return `${STEP_LABELS[payload.step] ?? payload.step}…`;
  }
  return null;
}

const TOOL_LABELS = {
  launch_app: "启动应用",
  web_search_fetch: "搜索网络",
  compose_email: "撰写邮件",
  open_file: "打开文件",
  write_file: "写入文件",
  verify_file_exists: "验证文件",
  find_recent_files: "查找文件",
  notify: "发送通知",
  copy_to_clipboard: "复制到剪贴板",
};

const STEP_LABELS = {
  tool_planner: "规划操作步骤",
  llm_generate: "生成内容",
  composite_running: "并行执行子任务",
};
```

### `src/desktop/renderer/overlay.js`

订阅 `conversation_step` 事件，在对话流里插入进度条目：

```js
runtime.on("conversation_step", (event) => {
  if (event.task_id !== currentTaskId) return;

  // 在当前消息气泡下方插入步骤行（折叠式，小字灰色）
  appendStepLine({
    label: event.step_label,
    ts: event.ts,
    taskId: event.task_id
  });
});
```

**UI 设计**：
- 步骤行在最终回复出现后自动折叠为"查看执行详情 ▾"
- 点击展开显示完整步骤列表（类似 ChatGPT 的 "Show work"）
- 正在进行的步骤显示旋转图标，已完成显示 ✓，失败显示 ✗

### `src/desktop/renderer/console.js`

- 任务详情面板增加"执行步骤"tab，显示完整 transcript（工具名、参数、观测结果）
- 子任务内容不同时高亮显示差异（解决"3个任务内容一样"问题）

## 步骤显示效果（对话框里）

```
用户：打开 Outlook，帮我写一封请假邮件

AI：[正在执行]
  ▸ 启动应用… ✓
  ▸ 撰写邮件…
  ─────────────────
  已为你草拟了请假邮件并在 Outlook 中打开。主题：请假申请...
  [查看执行详情 ▾]
```

## 验证

- 发送"打开 Outlook" → 对话框里显示"启动应用… ✓"
- 发送搜索请求 → 对话框显示"搜索网络… ✓"
- 工具失败时 → 显示"✗ 失败"（不显示"Done."假成功）
- 任务完成后步骤列表自动折叠
