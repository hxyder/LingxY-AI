# Retired: intent-router RULE 0 / 2 / 4 / 5 and "default → fast"

- **Retired at**: 2026-04-20 (commit UCA-087)
- **File**: `src/service/core/router/intent-router.mjs`
- **Why**: regex-as-classifier caused real user regressions.

## Removed

### RULE 0 — vision keyword → multi_modal

```js
{ patterns: [/(图片|image|截图|screenshot|\bocr\b)/i],
  intent: "describe_image",
  executor: "multi_modal" }
```

**Failure observed**: `task_0093fed1` "打开桌面所有图片" — command has no
image attachment; regex matched on "图片" anyway → multi_modal executor
answered "No images to analyze." and exited.

**Replaced by**: submission paths that actually have attachments
(`submitImageTask`) set `executorOverride: "multi_modal"` directly. Commands
that merely *mention* the word image but don't attach one now default to
`tool_using`, where agent-loop's system prompt says:

> Fan out enumerations. When the user says "all / every / each <something>",
> start with an enumeration tool (list_files / glob_files /
> account_list_emails / account_list_files), read the result, then call the
> per-item action for each result in subsequent iterations.

So "打开桌面所有图片" is handled by the LLM calling list_files(desktop,
*.jpg|*.png|…) → open_file per result.

### RULES 2 / 4 / 5 — summarize / rewrite / explain → fast

```js
{ patterns: [/(总结|摘要|\bsummarize\b|\bsummary\b)/i], executor: "fast" }
{ patterns: [/(改写|润色|\brewrite\b|\bpolish\b)/i],     executor: "fast" }
{ patterns: [/(解释|\bexplain\b)/i],                    executor: "fast" }
```

**Failure observed**: these routed anything with the keyword to `fast` (a
chat-only executor with no tools). "总结桌面上的 report.pdf" would land in
fast and fail because the LLM can't call `file_read`.

**Replaced by**: all three routes now go to `tool_using`. If the command is
pure inline content processing ("总结这段：<pasted text>"), agent-loop's
LLM just returns `{final: "<summary>"}` without calling any tool — same
result as fast. If it needs tools, they're available.

### Default (no rule matched) → fast

```js
const suggested_executor = … : "fast";
```

**Failure observed**: `task_18c16ede` "明天下午1点在日历里新建任务" matched
no RULE, classifier returned goal=general → default = fast → fast has no
`account_create_event` tool → LLM hallucinated "已为您在明天下午1点创建日历
任务。请确认是否需要添加任务标题…" without any tool call (see
task_events payload: no `tool_call_*` events).

**Also observed**: `task_c5de2c8a` "发美股汇总" — this was the scheduled
residual from a "5 分钟后发美股汇总" command. Scheduler triggered on time
→ submitContextTask → routeIntent("发美股汇总") → no match → default fast
→ fake "好的，美股汇总将在5分钟后发出" text. The scheduling layer worked
correctly; the routing destroyed the delivery.

**Replaced by**: default is now `tool_using`. agent-loop's LLM sees the
resource block (current time, connected accounts incl. their capabilities,
attached files) and picks the right tool — `account_create_event` for
calendar work, `web_search_fetch` + `account_send_email` for "send stock
summary", etc. Trivial Q&A ("你好") still works because agent-loop simply
returns `{final:"..."}` when no tool is appropriate.

## Verification

- `scripts/verify-intent-plan.mjs` covers the single-brain plan-executor
- `scripts/verify-agentic-planner.mjs` covers the agent-loop prompt
- Manual smoke tests after this change:
  - `task_0093fed1` replay → should now call list_files + open_file
  - `task_18c16ede` replay → should now call account_create_event
  - `task_c5de2c8a` replay (scheduled residual) → should search + draft
    email via connector_workflow_run
