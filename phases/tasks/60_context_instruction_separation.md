# UCA-060 — 上下文与指令分离（Context vs Instruction Separation）

**Status**: todo  
**Priority**: P0  
**Depends on**: UCA-047, UCA-051  
**Branch**: `task/uca-060-context-instruction-separation`

## 目标

严格区分"用户的指令"和"捕获的上下文背景"，防止快捷键在输入框为空时把窗口内容当成查询词发送出去。

## 问题根因

实测：用户按快捷键呼出 overlay → 直接点发送（没有输入任何文字）→ AI 搜索了"process the current context"。

原因：`context_packet.text`（当前活动窗口捕获的文字内容）在 `user_command` 为空时被 `intent-router` 当作查询词使用，而活动窗口恰好是某个技术文档页面。

### 根本混淆点

```
user_command   = 用户在 overlay 输入框里打的字 ← 这才是"要做什么"
context_packet = 当前窗口/选中文字/文件内容    ← 这只是"操作的对象"
```

两者不能互换。`user_command` 为空时，不能用 `context_packet.text` 填充它。

## 关键修改

### `src/desktop/renderer/overlay.js`

```js
// 发送前验证：输入框必须有内容
function handleSubmit() {
  const userText = inputEl.value.trim();

  if (!userText) {
    // 不静默发送，显示提示
    showPlaceholderHint("请先输入你想让 UCA 做什么…");
    inputEl.focus();
    return;
  }

  sendTask({ userCommand: userText, contextPacket: capturedContext });
}
```

### `src/service/core/http-server.mjs` — `/task` endpoint

```js
// 服务端双重保障：user_command 缺失时拒绝请求
if (!body.user_command || !body.user_command.trim()) {
  return res.status(400).json({
    ok: false,
    error: "missing_user_command",
    message: "请输入你的问题或指令"
  });
}
```

### `src/service/core/router/intent-router.mjs`

- 移除所有 `userCommand ?? contextPacket?.text` 的 fallback 逻辑
- `user_command` 只能来自用户输入，context_packet 只作为辅助信息传给 executor

### `src/desktop/tray/active-window-context.mjs`

- 快捷键触发时，预览捕获到的上下文内容，在 overlay 里显示"已捕获上下文：[xxx]（可删除）"
- 让用户明确知道 AI 会看到哪些背景信息，避免意外

### 快捷键行为修改（`src/desktop/tray/electron-main.mjs`）

```
之前：快捷键 → 捕获上下文 → 呼出 overlay（用户可能直接发送）
之后：快捷键 → 捕获上下文 → 呼出 overlay → 输入框获得焦点 → 等待用户输入 → 发送
```

输入框默认为空，context 作为可见标签显示在输入框下方，用户可以点 × 移除。

## 验证

- 快捷键呼出 overlay → 不输入直接发送 → 显示提示"请先输入问题"，不发送请求
- 快捷键呼出 overlay → 输入"明天天气" → 发送 → AI 搜索天气，不搜索当前窗口内容
- context_packet 有内容时 → overlay 显示上下文预览标签
- 服务端收到空 user_command → 返回 400 错误，不创建任务
