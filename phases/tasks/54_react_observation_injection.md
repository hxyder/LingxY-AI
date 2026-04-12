# UCA-054 — Tool Observation Injection + ReAct 修复

**Status**: done  
**Priority**: P1  
**Depends on**: UCA-051, UCA-049  
**Branch**: `task/uca-054-react-observation`

## 目标

确保 tool_using executor 的 tool 返回值（observation）正确注入回下一轮 prompt，AI 真正"看到"工具结果，而不是忽略结果直接给出幻觉答案。

## 问题根因

当前 `tool_using/agent-loop.mjs` 中，tool call 执行后结果可能没有作为 `role: "tool"` message 追加到 messages 数组。下一轮 LLM call 看不到工具结果，直接凭记忆回答（导致搜索结果看不到最新内容、文件操作"伪成功"等问题）。

## ReAct 三段结构（参考 DeerFlow）

```
[Round N]
  Thought:   LLM 分析当前状态，决定下一步
  Action:    LLM 发出 tool_call（工具名 + 参数）
  Observation: tool 执行结果，以 role:"tool" 注入回 messages

[Round N+1]
  Thought:   LLM 看到 Observation 后继续推理
  ...
```

## 关键修改文件

### `src/service/core/executor/tool_using/agent-loop.mjs`

**Before（可能的问题代码）**：
```js
const toolResult = await executeTool(call);
// observation 可能没有追加到 messages
const nextResponse = await llm.chat(messages); // LLM 看不到 toolResult
```

**After（修复）**：
```js
const toolResult = await executeTool(call);

// 1. 将 observation 追加到 messages（必须！）
messages.push({
  role: "tool",
  tool_call_id: call.id,
  content: JSON.stringify(toolResult)
});

// 2. 如果工具失败，在 system 层面标注
if (!toolResult.success) {
  messages.push({
    role: "system",
    content: `[UCA] Tool "${call.function.name}" failed: ${toolResult.error}. Do NOT claim success.`
  });
}

// 3. 继续下一轮 LLM call（LLM 现在能看到 observation）
const nextResponse = await llm.chat(messages);
```

**其他修改**：
- Max iterations 从 5 提升到 8（与 agentic executor 对齐）
- 当 intent 含 `search` tag 时，在 system prompt 中强制说明"必须先调用 web_search_fetch"
- 每轮 iteration 记录 tool call log，便于调试

### `src/service/core/executor/agentic/planner.mjs`

- 确认 observation 已正确传递（验证当前实现，如有缺陷同样修复）
- 增加 observation 完整性检查：确认每个 tool_call_id 都有对应的 tool message

## 验证

新建 `scripts/verify-tool-observation.mjs`：
- 场景 1：调用 `web_search_fetch` → observation 出现在后续 prompt → 最终回答包含搜索结果中的关键词
- 场景 2：tool 返回 `success: false` → LLM 不能说"已完成" → 结果为 `partial_success`
- 场景 3：连续 3 个 tool call → 每个 observation 都注入 → 第 3 个 LLM call 能看到前两个结果
