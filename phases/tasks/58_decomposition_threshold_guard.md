# UCA-058 — 分解阈值守卫（Decomposition Threshold Guard）

**Status**: todo  
**Priority**: P0  
**Depends on**: UCA-056, UCA-051  
**Branch**: `task/uca-058-decomposition-guard`

## 目标

阻止 decomposer 对单意图任务进行不必要的拆分，把"分解"从默认行为改为例外行为。

## 问题根因

`decomposeUserCommand()` 对所有输入都默认走 LLM decomposition 路径。没有在分解前判断：
- 这个任务属于哪个 goal family（QA/翻译/生成类不应拆）
- 多个语义段是否真的相互独立（"打开outlook写邮件" = 一个意图的顺序步骤，不是两个独立任务）
- LLM decomposer 本身也没有被约束"QA 类禁止拆分"

实测问题：
- "帮我列个出差清单" → 拆成 3 个任务（纯 QA，一句话回答即可）
- "打开outlook，帮我写一封请假邮件" → 拆成多任务（一个复合动作）
- "把那个文件找出来" → 拆成 3 个任务（应该先追问，不是拆分）

## 关键修改

### `src/service/core/router/decomposer.mjs`

1. 在 `decomposeUserCommand()` 最前面加 `shouldDecompose()` 守卫：

```js
// goal families that must NEVER be decomposed
const NO_DECOMPOSE_GOALS = new Set([
  "qa",
  "translate",
  "search_and_answer",
  "schedule_or_notify",
  "multimodal_analyze"
]);

function shouldDecompose(taskSpec, userCommand) {
  // Rule 1: goal family ban list
  if (taskSpec?.goal && NO_DECOMPOSE_GOALS.has(taskSpec.goal)) {
    return { decompose: false, reason: "goal_no_split" };
  }

  // Rule 2: ambiguous / missing-referent commands should be clarified, not split
  const AMBIGUITY_PATTERNS = /那个|这个|它|上次|之前|the file|that one/i;
  if (AMBIGUITY_PATTERNS.test(userCommand)) {
    return { decompose: false, reason: "needs_clarification_first" };
  }

  // Rule 3: compound action = sequential steps within one intent
  // "打开X + 在X里做Y" is one intent, not two independent tasks
  const SEQUENTIAL_COMPOUND = /打开(.+)[，,]\s*(帮我|写|发|查|搜)/i;
  if (SEQUENTIAL_COMPOUND.test(userCommand)) {
    return { decompose: false, reason: "sequential_compound" };
  }

  // Rule 4: only decompose when there are 2+ genuinely independent goals
  // (default: let LLM decomposer decide, but with system prompt constraint)
  return { decompose: true, reason: "multi_goal_candidate" };
}
```

2. 修改 LLM decomposer 的 system prompt，加入强制约束：

```js
const decomposerSystemConstraints = [
  "RULES:",
  "1. If the request is a single question, list, explanation, or translation → return exactly ONE subtask.",
  "2. Only split when there are 2+ genuinely INDEPENDENT goals (different tools, different targets).",
  "3. 'Open app X and do Y in it' = ONE sequential compound task, NOT two subtasks.",
  "4. If the request is ambiguous (missing file name, missing person, etc.) → return ONE subtask with the original command unchanged.",
  "5. Never split scheduling/reminder requests.",
].join("\n");
```

3. 增加后置验证：若 LLM 返回 N 个 subtask 但原文本只有一个句子且 goal 为 qa/translate，强制截断为 1 个

### `src/service/core/task-spec.mjs`

- `NO_DECOMPOSE_GOALS` 导出为常量，供 decomposer 和 intent-router 共用

## 验证

`verify-service-core.mjs` 新增场景：
- "帮我列个出差清单" → `subtasks.length === 1`（不拆分）
- "翻译这段文字" → `subtasks.length === 1`
- "打开outlook，帮我写一封请假邮件" → `subtasks.length === 1`，reason = `sequential_compound`
- "搜索最新AI新闻，然后发给张总" → `subtasks.length === 2`（真正的两个独立目标）
- "把那个文件找出来" → `decompose: false`，reason = `needs_clarification_first`
