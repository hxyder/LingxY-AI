# P6 Phase F + Post-Tool Final Answer Synthesis Upgrade Request

## Purpose

This request combines two related framework-level fixes:

1. **Phase F: remove legacy frontend conversation-history injection and make the backend conversation store the single source of truth.**
2. **Post-tool synthesis: ensure tool results are not returned as final answers without being transformed according to the user's original goal.**

These are framework issues, not one-off feature bugs.

The implementation must avoid special-case patches. Do not solve this by hardcoding behavior for Gmail, email summaries, or any specific user phrase. The failing email-summary behavior is only a regression signal that exposed a broader runtime problem.

---

# Part 1 — Phase F: Backend-Backed Conversation Source of Truth

## Goal

The frontend should no longer construct, compress, or inject conversation history into task payloads.

The backend `conversation_messages` store should be the source of truth for:

- conversation history,
- LLM history loading,
- UI reconstruction,
- pending-offer context,
- prior assistant/tool/status lookup.

Frontend state may still exist as a UI cache, but it must not be treated as canonical conversation memory.

---

## Required Phase Split

Do not implement Phase F as one large change.

Please split it into:

```text
F1: Remove outbound legacy history injection
F2: Implement backend-backed overlay cache
F3: Move pending-offer context to backend messages
```

Each phase should be independently verifiable.

---

# F1 — Remove Outbound Legacy History Injection

## Scope

F1 should only remove legacy history from outbound task payloads.

Do not rewrite overlay cache behavior in F1.

## Required Changes

Remove these outbound legacy history paths:

- overlay must not inject `[当前对话上下文]` into `payload.text`
- overlay must not construct or send `selection_metadata.conversation_turns`
- browser submission must not build or forward `conversation_turns`
- frontend-built history blocks must not be sent to backend runtime

Keep the current UI display behavior for now.

## Important Rule

If structured backend conversation history is active, legacy frontend history must not be sent, read, or used in parallel.

There must not be two competing conversation-memory sources.

## F1 Verifiers

Add or update verifiers to prove:

- task submit payload does not contain `[当前对话上下文]`
- task submit payload does not contain `selection_metadata.conversation_turns`
- browser submission does not forward `conversation_turns`
- structured-history executor path does not receive frontend-built history blocks
- legacy history is only available through explicit fallback paths, not normal structured paths

---

# F2 — Backend-Backed Overlay Cache

## Goal

Overlay chat should be reconstructed from backend `conversation_messages`.

The frontend may keep an in-memory cache for responsiveness, but backend messages are the source of truth.

## Required Changes

### 1. Do not simply delete user-message UI append

Do not remove user-message display in a way that makes the UI feel frozen after submit.

Instead:

- remove `appendTurn("user", ...)` as a persistence or history-injection mechanism
- keep an optimistic UI message if needed
- mark optimistic messages as:
  - `pending`
  - `localOnly`
  - `client_message_id`

### 2. Pass client_message_id to backend

When submitting a task, the frontend should include a `client_message_id`.

The backend should write that ID into the corresponding `conversation_message.metadata_json`.

This allows stable reconciliation without relying on content/time heuristics.

### 3. Reconcile after backend write

After submit, the frontend should fetch:

```text
GET /conversation/{id}/messages?since={lastKnownSeq}
```

Then:

- merge by `message_id`
- reconcile pending optimistic messages by `client_message_id`
- sort by `seq`
- ensure the same user message is not displayed twice
- treat backend message as canonical once received

### 4. Rebuild UI from backend on reload

When overlay is reopened or a conversation is switched:

- fetch messages from backend
- rebuild chat UI from backend messages
- do not rebuild from localStorage conversation turns

### 5. Remove lossy conversation compression

Remove lossy compression for conversation memory.

Backend context-budget windowing is responsible for LLM prompt history selection.

However, do not remove UI-level performance protections.

Frontend should still support one or more of:

- pagination
- incremental loading
- virtualized rendering
- preview truncation for very long messages

Do not load or render unbounded long histories all at once.

## F2 Verifiers

Add or update verifiers to prove:

- after submit, UI shows a pending local message
- after backend fetch, pending message is replaced by canonical backend message
- no duplicate user message appears after reconciliation
- overlay reload reconstructs chat from backend messages
- frontend no longer uses lossy compression as conversation memory
- long conversations remain display-safe through paging/truncation/virtualization

---

# F3 — Pending-Offer Uses Backend Messages

## Goal

`pending-offer` should no longer depend on frontend-sent conversation turns.

It should use backend `conversation_messages` when structured conversation data exists.

## Required Behavior

When structured conversation is available:

- read prior assistant messages from backend `conversation_messages`
- read prior tool summaries from backend `conversation_messages`
- read prior system/status messages from backend `conversation_messages`
- do not use `parent_task_summary` in parallel as another history source

When structured conversation is unavailable:

- allow legacy fallback
- `parent_task_summary` may be used only as fallback

## F3 Verifiers

Add or update verifiers to prove:

- pending-offer prefers backend messages when available
- pending-offer does not combine backend messages and `parent_task_summary` as parallel history sources
- pending-offer still works in legacy fallback cases

---

# Part 2 — Post-Tool Final Answer Synthesis

## Problem

The runtime can currently complete a tool call and then expose the tool result or tool trace as if it were the final user-facing answer.

That is incorrect.

Tool execution produces intermediate observations. A task is not complete until the system synthesizes a final answer that satisfies the user's original request.

Core rule:

```text
TOOL_DONE is not TASK_DONE.
```

---

## Required Framework Fix

This must be solved as a shared runtime/executor layer.

Do not implement this as a tool-specific or phrase-specific patch.

Do not add logic like:

```js
if (toolName === "account_list_emails") ...
```

Do not add logic like:

```js
if (userRequest.includes("总结邮件")) ...
```

The fix should be general:

```text
tool_result
→ normalized observation
→ final_answer_composer
→ completeness_check
→ assistant final answer
```

---

## Required Runtime Flow

Current invalid flow:

```text
User request
→ route / plan
→ tool call
→ tool result
→ return tool result as final answer
```

Required flow:

```text
User request
→ route / plan
→ tool call
→ observation normalization
→ final answer synthesis
→ final answer completeness check
→ user-facing final answer
```

The runtime state machine should distinguish:

```text
PLANNING
TOOL_RUNNING
TOOL_DONE
SYNTHESIZING_FINAL
FINAL_CHECK
DONE
```

Do not allow:

```text
TOOL_DONE → DONE
```

unless the user explicitly requested raw results.

---

## User Goal Preservation

The task runtime must preserve the original user goal across tool execution.

The final composer should receive at least:

```ts
type FinalAnswerComposerInput = {
  userRequest: string;
  userGoal: string;
  expectedOutput:
    | "summary"
    | "list"
    | "table"
    | "comparison"
    | "recommendation"
    | "action_items"
    | "draft"
    | "analysis"
    | "answer"
    | "raw_results";

  toolResults: Array<{
    toolName: string;
    normalizedObservation: unknown;
    summary?: string;
    metadata?: object;
  }>;

  conversationContext?: object;
  executorType?: string;
  allowRawToolDump?: boolean;
};
```

The task frame or runtime context should preserve:

```json
{
  "user_request": "...",
  "user_goal": "...",
  "expected_output": "summary|list|table|comparison|recommendation|action_items|draft|analysis|answer|raw_results",
  "tools_used": [],
  "tool_results": [],
  "final_answer_required": true
}
```

---

## Final Answer Composer

Create or refactor a shared module such as:

```text
src/service/executors/shared/final-answer-composer.mjs
```

If an equivalent module already exists, upgrade it instead of duplicating responsibility.

## Composer Responsibility

The composer should transform tool observations into the output requested by the user.

It should not merely reprint tool observations.

## Composer Prompt

Use a general prompt similar to this:

```text
You are composing the final user-facing answer.

Original user request:
{{userRequest}}

User goal:
{{userGoal}}

Expected output:
{{expectedOutput}}

Tool results / observations:
{{toolResults}}

Conversation context:
{{conversationContext}}

Rules:
- Do not merely repeat raw tool results.
- Transform the tool results into the output the user asked for.
- If the user asked for a summary, summarize and group information.
- If the user asked for action items, extract what needs attention.
- If the user asked for a comparison, compare across relevant criteria.
- If the user asked for a recommendation, rank options and explain why.
- If the user asked for analysis, synthesize patterns and implications.
- If the user asked for a draft, produce the draft.
- Only output raw results if expectedOutput is raw_results or allowRawToolDump is true.
- Mention uncertainty or missing data when relevant.
- Return only the final answer for the user.
```

---

## Completeness Checker

Add a lightweight final-answer completeness checker.

It may be deterministic, LLM-based, or hybrid, but it must be generic.

Suggested shape:

```ts
type FinalAnswerCheckInput = {
  userRequest: string;
  userGoal: string;
  expectedOutput: string;
  finalAnswer: string;
  toolResults: unknown[];
};

type FinalAnswerCheckResult = {
  satisfiesUserGoal: boolean;
  isRawToolDump: boolean;
  missingTransformation: boolean;
  shouldRegenerate: boolean;
  reason: string;
};
```

## Checker Requirements

The checker should fail answers when:

- user requested a summary, but answer is only a raw list
- user requested action items, but answer only lists records
- user requested comparison, but answer does not compare
- user requested recommendation, but answer only lists options
- user requested analysis, but answer only dumps fetched data
- answer contains tool-trace phrasing as final response without synthesis

If the check fails, regenerate the final answer once with the failure reason.

Example retry instruction:

```text
The previous answer failed the final answer check because it repeated tool observations instead of satisfying the user's requested output. Rewrite it as the requested output.
```

---

## Raw Results Exception

Raw tool results may be returned only when the user explicitly requests them.

Examples of allowed intent:

```text
list raw results
show all records
display the original items
return the tool output
```

When raw results are allowed, set:

```ts
allowRawToolDump = true
```

or:

```ts
expectedOutput = "raw_results"
```

Do not infer raw-result permission merely because a tool returned structured data.

---

## UI / Trace Separation

Tool trace and final answer must be separate.

The UI may show trace or notes such as:

```text
Tool called
Tool returned N records
```

But the final answer area must contain the synthesized answer.

A trace note is not a final answer.

The assistant outcome stored in `conversation_messages` should be the synthesized final answer, not a raw tool observation.

`tool_summary` should remain a sanitized historical summary, not the final user answer.

---

# Regression Case

Use this as a regression case only. Do not write special runtime logic for it.

User request:

```text
总结一下我今天的邮件
```

Observed issue:

- the system called the email-list tool correctly
- the system received email records correctly
- the response only listed records
- the user had to follow up before receiving a real summary

Expected framework behavior:

- tool may be called
- raw records are treated as observations
- final answer composer produces a synthesized summary
- user does not need to ask again
- the final answer is stored as the assistant outcome

---

# Required Verifiers

Add framework-level verifiers.

Do not only add a verifier for the email case.

Minimum required verifier categories:

```text
verify:post-tool-final-synthesis
verify:final-answer-completeness
verify:tool-result-not-final-answer
verify:raw-results-exception
verify:trace-answer-separation
```

They should prove:

- tool result is not final answer by default
- composer transforms tool results according to `expected_output`
- checker catches raw dumps when synthesis is required
- raw list exception still works when explicitly requested
- final assistant outcome is synthesized answer
- trace/note is not treated as final answer

---

# Integration With Phase F

Phase F and post-tool synthesis are related but should remain separate concerns.

Phase F controls where conversation history comes from.

Post-tool synthesis controls how tool observations become final answers.

Do not mix them into one tangled change.

Recommended order:

```text
F1: remove outbound legacy history injection
Post-tool synthesis framework fix
F2: backend-backed overlay cache
F3: pending-offer backend messages
```

If implementation risk is high, complete F1 first, then add post-tool synthesis, then proceed to F2/F3.

---

# Non-Goals

Do not modify unrelated logic.

Do not change:

- executor prompt history loading, unless required to pass the final-answer composer context
- planner decision policy
- tool calling policy
- model/provider selection
- task decomposition behavior
- conversation schema, unless a small metadata field is required for `client_message_id`

Do not introduce special cases for one tool or one phrase.

---

# Definition of Done

This upgrade is complete only when:

1. F1 removes outbound legacy history injection.
2. F2 uses backend messages as overlay source of truth while preserving responsive UI through optimistic cache and reconciliation.
3. F3 moves pending-offer context lookup to backend messages with legacy fallback only.
4. Tool observations are no longer returned as final answers by default.
5. A shared final-answer composer exists or an existing equivalent module is upgraded.
6. A completeness checker prevents obvious raw dumps when synthesis is required.
7. Raw-results requests still return raw/list outputs when explicitly requested.
8. Tool trace/note is separated from the final user-facing answer.
9. Synthesized final answers are written to `conversation_messages` as assistant outcomes.
10. The regression case passes without any Gmail/email-specific runtime patch.
11. Existing verifiers remain green.
12. New framework-level verifiers pass.

---

# Final Instruction

Please implement this as a framework upgrade.

Do not patch around the regression case.

The key principle is:

```text
Frontend history is not canonical memory.
Tool output is not final answer.
Backend messages are the source of truth.
Final answer synthesis is required before DONE.
```
