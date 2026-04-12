# UCA-063 — 工具调用兜底守卫（Tool Call Fallback Guard）

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-054, UCA-058  
**Branch**: `task/uca-063-tool-call-fallback-guard`

## 目标

彻底消除"AI 明明有工具却说'我无法操作你的电脑'"的问题。当 executor 有可用工具、goal 是执行类但 AI 回了拒绝文本时，强制重试并注入工具调用指令。

## 问题根因

实测："打开 Outlook，帮我写一封请假邮件" → AI 回复了手动操作步骤说明。

根因链：
1. `extractLaunchAppName("打开outlook，帮我写一封请假邮件")` 可能对复合句匹配失败
2. 退回到 LLM planner，但 LLM 没有被强制约束"launch_and_act goal 必须调工具"
3. LLM 用了系统提示中训练数据的偏好，说"我无法操作你的电脑"

## 关键修改

### `src/service/executors/tool_using/agent-loop.mjs`

#### 1. 拒绝文本检测

```js
const REFUSAL_PATTERNS = [
  /我无法.{0,10}(直接|帮你)?操作/,
  /I (cannot|can't|am unable to).{0,20}(operate|control|access|open)/i,
  /无法直接.{0,10}(为你|帮你)/,
  /需要你.{0,10}手动/,
  /请你.{0,10}(手动|自行|自己)/,
];

function isRefusalText(text) {
  return REFUSAL_PATTERNS.some(p => p.test(text));
}
```

#### 2. 兜底重试逻辑

```js
// runToolAgentLoop 结束后的后置检查
const isActionGoal = ["launch_and_act", "open_or_reveal_file", "transform_existing_file"]
  .includes(task.task_spec?.goal);
const noToolsUsed = !result.transcript.some(e => e.type === "tool_result");

if (isActionGoal && noToolsUsed && isRefusalText(result.final_text ?? "")) {
  // 强制重新调用：注入强制工具使用的 system 消息，最多重试 1 次
  const retryResult = await runToolAgentLoop({
    task,
    runtime,
    maxIterations: 4,
    planner: forcedToolPlanner  // 见下方
  });
  return retryResult;
}
```

#### 3. `forcedToolPlanner`

```js
async function forcedToolPlanner({ task, transcript, tools }) {
  // 第一轮：强制调用与 goal 匹配的工具，不经过 LLM
  if (transcript.length === 0) {
    // launch_and_act → 直接用 extractLaunchAppName + compose_email
    const appName = extractLaunchAppName(task.user_command)
      ?? extractAppFromContext(task.context_packet);
    if (appName) {
      return { type: "tool_call", tool: "launch_app", args: { app: appName } };
    }
  }
  // 后续轮次：走正常 LLM planner，但在 system 里注入强制指令
  return llmPlanner({ task, transcript, tools, forceTool: true });
}
```

#### 4. `llmPlanner` 增加 `forceTool` 参数

当 `forceTool=true` 时，在 system prompt 顶部加：
```
CRITICAL: You MUST call a tool in your next response. 
Saying "I cannot operate your computer" is FORBIDDEN.
You have tools available. Use them.
```

### `src/service/core/router/intent-router.mjs`

- `extractLaunchAppName` 增加对复合句的支持：
```js
// "打开outlook，帮我写邮件" → "outlook"
const COMPOUND_LAUNCH = /(?:打开|启动|运行|open|launch|start)\s*([^\s，,。.]+)/i;
```

## 验证

- "打开 Outlook" → `launch_app` 被调用，Outlook 打开
- "打开 Outlook，帮我写一封请假邮件" → `launch_app` 被调用，然后 `compose_email`
- "打开微信" → `launch_app({app: "微信"})` 被调用
- AI 第一次回了"我无法操作" → 触发强制重试 → 重试后调用了工具
- 重试后仍失败 → 返回 `partial_success`，提示用户工具调用未成功
