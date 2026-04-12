# UCA-059 — 歧义检测 + 对话追问（Clarify-Before-Act）

**Status**: todo  
**Priority**: P0  
**Depends on**: UCA-058, UCA-051  
**Branch**: `task/uca-059-clarification-dialog`

## 目标

当用户输入存在歧义或缺少必要信息时，AI 在对话框里直接追问，暂停执行直到用户补充。不再把"需要追问"的情况错误地拆分为多个任务。

参考框架：LangGraph `human-in-the-loop` conditional edge、AutoGen `human proxy` pattern。

## 问题根因

系统没有"歧义检测 → 追问"的流程节点。所有输入直接进入  
`intent-router → decomposer → executor` 流水线，即使输入明显缺少关键信息。

实测问题：
- "把那个文件找出来" → 应该问"哪个文件？"，实际拆成 3 个任务
- "帮我发邮件" → 应该问"发给谁？"，实际直接执行并失败
- "打开它" → 完全不知道"它"是什么，但仍然尝试执行

## 歧义触发条件

```js
const AMBIGUITY_RULES = [
  // 指代词：缺少具体引用对象
  { pattern: /那个|这个|它(?!们)|上次|之前|the\s+file|that\s+one/i,
    question: "你指的是哪个文件/内容？" },

  // 缺少收件人
  { pattern: /发(一封)?邮件|send.*(an?\s+)?email/i,
    missingField: "to",
    check: (cmd) => !/(给|to|@)/.test(cmd),
    question: "请问邮件发给谁？" },

  // 缺少提醒内容
  { pattern: /提醒我|remind me/i,
    check: (cmd) => cmd.split(/\s+/).length < 4,
    question: "提醒你什么内容？什么时间？" },

  // 文件操作缺少路径
  { pattern: /打开(这个|那个)?文件|open.*file/i,
    check: (cmd) => !/(\.|\/)/.test(cmd),
    question: "请问是哪个文件？可以告诉我文件名或路径吗？" },
];
```

## 关键修改

### 新建 `src/service/core/clarifier.mjs`

```js
export function detectAmbiguity(userCommand, taskSpec) {
  for (const rule of AMBIGUITY_RULES) {
    if (!rule.pattern.test(userCommand)) continue;
    if (rule.check && !rule.check(userCommand)) continue;
    return {
      needsClarification: true,
      question: rule.question,
      missingField: rule.missingField ?? null
    };
  }
  return { needsClarification: false };
}
```

### `src/service/core/router/intent-router.mjs`

在 `routeIntent()` 返回后，调用方（http-server 的 `/task` endpoint）检查 `detectAmbiguity()`：

```js
const clarification = detectAmbiguity(userCommand, taskSpec);
if (clarification.needsClarification) {
  // 不创建 task，直接返回 clarification 消息
  return res.json({
    ok: true,
    type: "clarification_needed",
    question: clarification.question,
    original_command: userCommand
  });
}
```

### `src/service/core/http-server.mjs`

- `/task` endpoint：先过 clarifier，若需追问直接返回 `clarification_needed` 响应
- `/task/clarify` endpoint（新增）：接收用户对追问的回复，合并原始 command + 补充信息，重新提交任务

### `src/desktop/renderer/overlay.js`

- 收到 `clarification_needed` 响应时，在对话框渲染一条追问气泡（与普通回复气泡视觉相同）
- 追问气泡下方显示输入框（预填用户已输入的内容），用户补充后提交到 `/task/clarify`
- 追问等待期间显示"等待你的补充…"状态

## 状态流

```
用户输入 → 歧义检测 → 有歧义?
                         ↓ 是
              对话框显示追问气泡 → 用户回复 → 合并输入 → 正常执行
                         ↓ 否
                       正常执行
```

## 验证

- "把那个文件找出来" → 返回 `clarification_needed`，overlay 显示追问气泡
- "帮我发邮件" → 追问"发给谁？"
- "提醒我" → 追问"提醒什么内容？什么时间？"
- "帮我搜索最新新闻" → 不触发追问（信息完整）
- 用户回复追问后 → 任务正常执行
