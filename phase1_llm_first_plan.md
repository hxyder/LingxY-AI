# Phase 1 — LLM-first execution path

Living plan for the routing/execution pipeline rework. Updated as phases land.
Each phase is a separate commit; this file is the index codex / future agents
read instead of reconstructing context from the chat log.

---

## Architecture principle

> 用户消息一来，系统马上把它交给主 LLM，让主 LLM 理解语义、决定要不要用工具、
> 怎么计划、怎么回答。其它规则只做护栏和上下文增强，不能抢主 LLM 的语义决策权，
> 也不能阻塞主 LLM 起跑。

Concretely:

- **task_created emits as fast as possible** (DB write + securityBroker only).
- **First planner LLM call kicks off with deterministic spec** — no `await` on SR,
  memory recall, or recent-artifact recall.
- **All enrichment is parallel** and patches the live task / context_packet for
  iteration ≥ 1 to read.
- **Hard safety stays in code** (security broker, schema validation, capability
  allowlist, unattended_safe high-risk gate). Soft policy lives in prompt.
- **Contracts guide planning; they are not refusal walls.** If the LLM decides a
  blocked capability is needed, it asks for the smallest user permission or
  missing detail instead of pretending the assistant has no tool.

---

## Hard constraints (locked-in design rules)

These are non-negotiable across all phases. Any future change must respect them.

1. **No retroactive failure.** SR / memory / artifact patches arriving after
   the executor has already taken an action MUST NOT cause that action to be
   reclassified as a failure.
   - Lock-in: `task.task_spec_initial` snapshot at task creation.
   - `validateSuccessContract` reads `_initial`.
   - Forward-looking validators (`validateStepGate`, `validateAnswerSynthesis`)
     read latest `task.task_spec`.

2. **Hard safety constraints don't wait for SR.**
   - Security broker, capability allowlist, unattended_safe high-risk gate,
     attachment / file boundary, explicit no-search fact signal — all live in
     deterministic layer 1+2.
   - SR can only refine: research_quality, expected_output, tool_policy mode
     (forbidden → optional → required tightening allowed forward only).

3. **Background contexts are structured, not appended to user_text.**
   - `context_packet.background_contexts: Entry[]` with explicit `kind`,
     `priority`, `origin`, `content`, `metadata`, `added_at`.
   - Producers (memory recall, recent artifact, parent task, RAG, browser
     metadata) push entries here.
   - Prompt builder renders each entry as its own `<bg kind="..." priority="...">`
     block AFTER the user turn so the LLM never confuses them with the active
     request.
   - Original user input stays at `task.user_command` (never mutated).

4. **task_spec versioning visible in audit.**
   - `task.task_spec_source: "deterministic" | "semantic_router_patched"`
   - `task.sr_patch_applied_at: ISO8601` (when patched)
   - Emitted as `sr_patch_applied` event so observability can tell the
     difference between "deterministic only" and "SR-patched mid-flight".

5. **Multi-action is single-brain.**
   - The LLM is the only authority on "which tool next" for compound intents.
   - No regex layer (`plannedOpenActions`, `hasCompoundIntent`,
     `nextPlannedOpenAction`) gates multi-step requests.
   - System prompt instructs chain-tool-calls-until-done.

6. **No regex-per-test-case patches.**
   - Goal/topic/intent classification is SR's job (its enum schema is the
     canonical taxonomy).
   - Regex stays only for **structural signals**: URL, file path/extension,
     time phrase shape, no-search fact, danger verbs, attachment presence.

7. **Final answer never exposed via internal fallback strings.**
   - Generic English synthesis/error fallback strings must never reach the user.
   - When the loop can't produce a clean final, a dedicated no-tools composer
     LLM call generates the answer.

8. **The planner sees the execution scaffold.**
   - `registry.list()` exposes tool id, description, schema, risk,
     required capabilities, policy group, and confirmation requirement.
   - The model sees the full tool inventory in prompt and calls a lightweight
     native `call_tool` interface with `{ tool, args }`.

---

## Phase status

| Phase | Status | Summary |
|-------|--------|---------|
| 1.1   | done   | Map callers of understandCommand / SR preflight |
| 1.2   | done   | Extend SR schema with `interpretation` / `schedule_at` / `residual_command` / `clarification_question` |
| 1.3   | done   | Wire merged classifier into triage; router-preflight skips when stamped |
| 1.4   | done   | Delete `understand.mjs`, `maybeHandleAsPlan` |
| 1.5   | done   | Verify pass on focused suite |
| 1.6   | done   | SR truly parallel in `execute()` (fire-and-forget); `task_spec_initial` snapshot |
| 1.7   | retired | HTTP/triage fast_path bypass removed; task submission now enters the AI agent |
| 1.8   | done   | Delete `plannedOpenActions` / `hasCompoundIntent` / `nextPlannedOpenAction` |
| 1.9   | done   | System prompt rewritten: persona anchor + multi-action chaining + spec-may-upgrade |
| 1.10  | done   | Verify suite re-run after 1.6–1.9 |
| 1.11  | done   | Zero-wait start: delete 800ms wait; `background_contexts` schema; memory + recent-artifact moved to post-task fire-and-forget |
| 1.12  | done   | Validator scope split: success_contract=initial, step_gate=latest, answer_synthesis=latest |
| 1.13  | partial | Hot-path timing emits `planner_request_started`, `final_composer_started`, `phase_timing`; broader latency dashboard remains |
| 1.14  | done | No-tools final composer replaces raw tool/error fallback text |
| 1.15  | done | AI-agent default: text tasks route to tool_using; prose trap is tool-contract gated |
| 1.16  | done | Tool schemas slimmed to one native `call_tool`; full tool inventory remains visible to the model |
| 1.17  | done | Runtime task features + capability-aware provider selection; model fallback is based on capabilities, not topic regex |
| 2     | partial | Legacy decomposer/composite split is opt-in only; normal hot path stays in the main AI agent |
| 3     | pending | Retire regex tables (RULES / TAG_PATTERNS / GOAL_RULES / FORMAT_PATTERNS) — keep structural signals only |
| 4     | pending | Tool guard rework + system prompt root-fix (refusal persona drift) |

---

## Done — file map

### Phase 1.1–1.5: front-classifier merge

- `src/service/core/intent/semantic-router.mjs`
  - schema: `interpretation` / `schedule_at` / `residual_command` / `clarification_question` (optional)
  - system prompt: interpretation rules block
  - user turn: prepends `Current local time: <ISO>` so LLM grounds relative time
  - cache key: `time_bucket = floor(Date.now() / 60_000)` when `hasTimePhrase(text)` matches
  - export `interpretationOf(decision)` — returns "immediate" by default
- `src/service/core/intent/router-preflight.mjs`
  - early-return when `contextPacket.semantic_router_decision` or `_rejection` already stamped
- `src/service/core/intent/triage.mjs`
  - calls SR via `applySemanticRouterPreflight` once; branches on `interpretationOf(decision)`
  - schedule lane → `createScheduledTaskRecord` + `buildScheduleFromDecision`
  - clarify lane → `createClarifyTaskRecord`
  - returns `contextPacket` with SR stamps so context-submission's preflight is a no-op
  - `background=true` + no time phrase → skips SR entirely (executor-side preflight handles it)
- `src/service/core/intent/plan-executor.mjs`
  - exports `createScheduledTaskRecord`, `createClarifyTaskRecord`, `buildScheduleFromDecision`, `formatRunAtRelative`
  - `understandCommand` import + `maybeHandleAsPlan` removed
- `src/service/core/context-submission.mjs`
  - threads `background` to triage
  - lifts SR stamps onto contextPacket so normalizer doesn't strip them
  - `normalizeContextPacket` whitelists `semantic_router_decision`, `semantic_router_rejection`, `context_sources`
- **deleted:** `src/service/core/intent/understand.mjs`
- `scripts/verify-intent-plan.mjs` rewritten to test `triage()` with preflight stubs

### Phase 1.6–1.10: SR parallel + multi-action LLM-first

- `src/service/core/context-submission.mjs`
  - `execute()` SR call is `srPromise.then(...)` fire-and-forget (was `await`)
  - SR patcher: refreshes `task.task_spec` / `task.context_packet`, stamps `task_spec_source = "semantic_router_patched"` + `sr_patch_applied_at`, emits `sr_patch_applied` event
  - SR patcher does NOT mutate `task.executor` (loop already locked it in)
  - SR patcher does NOT touch `task.task_spec_initial`
  - fast_path bypass removed; normal submissions always enter the AI agent path
- `src/service/core/task-runtime.mjs`
  - `task.task_spec_initial = taskSpec` snapshot at `createTaskRecord`
  - `task.task_spec_source: "deterministic"` initial value
- `src/service/executors/tool_using/agent-loop.mjs`
  - deleted: `WEB_DESTINATION_ALIASES`, `openActionForLaunchTarget`, `plannedOpenActions`, `executedOpenActionKeys`, `nextPlannedOpenAction`, `allPlannedOpenActionsCompleted`
  - deleted: `hasCompoundIntent` import + the planner-selection branch that consumed it
  - deleted: `extractUrl` unused import
  - system prompt header: anchored persona ("running ON the user's machine ... NOT a web assistant ... refusing to call launch_app on the grounds that you 'cannot operate a desktop computer' is wrong")
  - system prompt new bullets:
    - "Compound requests = chain tool calls" — chain tool calls across iterations until every requested action is done
    - "Policy may refine mid-task" — initial policy is deterministic; SR may patch later iterations
  - refusal regex guard removed; tool-required prose retry is now driven by task contract / policy state
- `scripts/verify-p6-blocking-fix.mjs` Case 8 updated for fire-and-forget shape
- `scripts/verify-post-tool-final-synthesis.mjs` updated to assert single-brain multi-action

### Phase 1.11: zero-wait start + structured background_contexts

- **NEW** `src/service/core/intent/background-contexts.mjs`
  - schema documented in module header
  - exports: `appendBackgroundContext`, `pushBackgroundContextInPlace`,
    `renderBackgroundContextsBlock`, `hasBackgroundContextOfKind`, `BG_CONTEXT_KINDS`
- `src/service/core/context-submission.mjs`
  - **deleted** the pre-task `await seedSemanticMemories` and
    `await maybeSeedRecentArtifactContext` calls
  - new `computeMemoryRecallEntry({runtime, userCommand, parentTaskId})` returns
    structured entry or null (pure-compute)
  - new `computeRecentArtifactEntry(...)` same shape
  - legacy `seedSemanticMemories` / `maybeSeedRecentArtifactContext` retained as
    thin back-compat shims (still produce the legacy text+sentinel form for
    callers that haven't migrated)
  - in `execute()`: post-task patcher kicks both off in parallel, mutates
    `task.context_packet.background_contexts` via
    `pushBackgroundContextInPlace`, emits `background_context_added`
  - `task.__memoryPatchPromise` / `task.__recentArtifactPatchPromise` exposed
    (no current consumer; surface kept for future awaiters that need to block on
    a specific patch)
  - `normalizeContextPacket` whitelists `background_contexts: []`
- `src/service/core/intent/context-sources.mjs`
  - new Stage 1b: read `background_contexts[]` and set `rag_background` /
    `parent_task_context` / `editable_artifact` / `browser_page` from each
    entry's `kind`
- `src/service/executors/tool_using/agent-loop.mjs`
  - **deleted** the 800ms `Promise.race([__srPatchPromise, sleep(800)])` at
    executor entry. First planner LLM call kicks off immediately
  - imports `renderBackgroundContextsBlock`
  - per-iteration: re-renders `task.context_packet.background_contexts` and
    appends as `<bg>` block AFTER the current user turn (so post-task patches
    land on iter ≥ 1)
- `scripts/verify-rag-memory.mjs` rewritten:
  - asserts `await seedSemanticMemories` is NOT in submitContextTask
  - asserts `computeMemoryRecallEntry` + `pushBackgroundContextInPlace` ARE present
  - back-compat shim still tested via direct call

### Phase 1.12: validator scope split

- `src/service/executors/tool_using/agent-loop.mjs`
  - `validateSuccessContract` → `task.task_spec_initial ?? task.task_spec`
  - `validateStepGate` → `task.task_spec ?? task.task_spec_initial`
  - `validateAnswerSynthesis` → `task.task_spec ?? task.task_spec_initial`
- `scripts/verify-post-tool-final-synthesis.mjs` asserts each spec source

### Phase 1.14–1.15: composer + cleanup

- `src/service/executors/tool_using/agent-loop.mjs`
  - adds no-tools `composeFinalAnswer` for any non-raw tool transcript
  - replaces user-visible internal fallbacks from repeated tool calls, error-budget stop, phase gate stop, and max-iteration stop
  - keeps action-confirmation tasks as concise confirmations
  - removes refusal regex retry path; prose trap retries only when the task spec says tools/actions are required
  - renders execution-tool metadata (policy group, risk, confirmation, capabilities) in both prompt list and provider tool descriptions
  - treats forbidden policy as a permission boundary: ask the user for approval when a blocked tool is necessary
  - emits `planner_request_started`, `final_composer_started`, and composer `phase_timing`
  - removes pre-LLM deterministic tool shortcuts from the production planner; defaultPlanner remains only as no-provider fallback
  - uses a single native `call_tool` schema instead of sending every action tool schema as a separate provider tool
- `src/service/core/planning/executor-resolver.mjs`
  - deletes `routing_degraded && web=optional -> tool_using`; degraded routing is diagnostic, not executor policy
  - text tasks default to `tool_using`; image tasks still route to the multimodal AI executor
- `src/service/core/http-server.mjs`
  - removes submit-time `tryFastPath`; URL/app/copy requests enter the AI agent and use tools from the visible inventory
- `src/service/core/intent/triage.mjs`
  - removes `fast_path` lane; triage only handles schedule/clarify/DAG/single-turn flow
- `src/service/action_tools/registry.mjs`
  - `list()` includes `policy_group` and `requires_confirmation`
- `src/service/action_tools/policy-guard.mjs`
  - blocked tool observation now says the tool needs user permission under the current task contract
- `src/service/executors/fast/fast-executor.mjs`
  - removes pre-LLM `routing_degraded` refusal gate
  - removes output-claim regex guard
  - streams OpenAI-compatible provider deltas into `text_delta` events
- `src/service/core/context-submission.mjs`
  - SR/memory/artifact patch promises are non-enumerable
  - parallel context patches merge `background_contexts`, file/image paths, selection metadata, and context sources instead of overwriting
  - legacy decomposer/composite split is gated behind `runtime.featureFlags.legacyDecomposer === true`; normal submissions no longer enter the old regex/LLM split branch
- `scripts/verify-llm-first-cleanup.mjs`
  - locks the removal of the degraded-routing upgrade, refusal regex path, question-shape prose trap, and internal synthesis/error strings

---

## Pending — acceptance criteria

### Phase 1.13 — phase_timing instrumentation (DB-backed)

**Goal:** end speculation about latency. Every task carries a row of timestamps
the dashboard can chart.

**Events to emit and persist:**
- `submit_received` — http-server (or equivalent surface) receives the request
- `task_created` — task row inserted, task_created event emitted
- `executor_started` — first executor function called
- `planner_request_started` — first LLM provider request issued
- `first_token` — first text_delta from provider (or first_tool_call if non-streaming)
- `first_tool_call` — first tool_call_proposed
- `final_synthesis_started` — entering the "compose final answer" path
- `final_synthesis_completed` — final user-visible text persisted

**Schema decision:** add a `task_phase_timings` table OR extend `task_events`
with a `phase_timing_*` event_type and computed view. Lean towards **dedicated
table** because we'll query it analytically (p50/p95/p99 per phase).

**Acceptance:**
- All 8 events emit on every successful single_turn task.
- New verify script `verify-phase-timing.mjs` runs an in-memory task and asserts
  monotonic timestamps + complete coverage.
- Existing tasks without phase_timing rows don't break dashboards (graceful
  absence).

### Phase 1.14 — No-tools final composer

**Goal:** no internal English fallback string ever reaches the user.

**Mechanism:**
- After agent loop ends (any status), if `validateAnswerSynthesis` reports
  violations OR `final_text` is empty / equals an internal fallback marker,
  dispatch a dedicated LLM call:
  - messages: `[system, user_question_summary, transcript_summary]`
  - **`tools: []`** (no tool use allowed — model must compose)
  - max_tokens: 1024
  - read latest `task.task_spec.synthesis.expected_output` to shape prompt
- Replace the agent-loop's `MAX_SYNTHESIS_RETRIES = 1` with a 2-step pipeline:
  - retry 1: same prompt with synthesis hint (existing behavior)
  - retry 2 (last resort): no-tools composer
- Delete generic synthesis failure strings from the user-facing path.
  Worst-case fallback becomes the last successful `tool_result.observation`
  prefixed with a Chinese "我完成了 X，因为 Y 没有更多结果" line.

**Acceptance:**
- grep for generic synthesis fallback strings returns zero hits in runtime code.
- Verify script asserts: when transcript has tool successes but the LLM returned
  empty final, composer fires and produces non-empty final.
- User-facing string is always the user's language.

### Phase 2 — Delete LLM decomposer

- `src/service/core/router/decomposer.mjs` removed
- `src/service/core/composite-submission.mjs` removed (or feature-flag-gated for
  explicit DAG only)
- All callers (`context-submission`, `browser-submission`, etc.) drop the
  decomposition branch
- Multi-step requests handled by main agent loop (already supported via Phase
  1.8 multi-action prompt guidance)
- Verify scripts updated/deleted

### Phase 3 — Retire regex tables

- `src/service/core/router/intent-router.mjs`:
  - **delete** `RULES`, `TAG_PATTERNS`, `FORMAT_PATTERNS`
  - keep only structural extraction (URL, file extension)
- `src/service/core/task-spec.mjs`:
  - **delete** the duplicate `FORMAT_PATTERNS`
  - `GOAL_RULES` heavily slimmed: keep only `translate`, `multimodal_analyze`,
    `schedule_or_notify` patterns that depend on structural signals
  - delegate `qa` / `search_and_answer` / `analyze_and_report` /
    `generate_document` decisions to SR's enum
- Signals folder retains only structural detectors:
  - `explicit-no-search`, `explicit-search`, `time-phrase`,
    `source-scope` (file/image present), `explicit-external` (network verb)
- Delete topic-hint regex (weather/news/finance) — SR's domain enum replaces it

### Phase 4 — Tool guard rework + system prompt root-fix

- Tool guard split:
  - **code layer**: schema validation, capability allowlist, unattended_safe
    high-risk block, security broker — non-bypassable
  - **prompt layer**: tool_policy block becomes prose with explanation (already
    drafted via `renderToolPolicyForPrompt`)
- System prompt persona section reworked so refusal regex becomes unnecessary:
  - explicit grounded statement of WHERE the model is running (this machine)
  - tool capability summary explicitly lists "starts native applications",
    "navigates the user's browser", "writes files to disk"
- After this lands, refusal regex shims should remain deleted; prompt and task
  contract state drive the retry behavior.

---

## Open questions

1. **`phase_timing` storage shape.** Dedicated table vs `task_events` rows?
   Lean: dedicated table (`task_phase_timings`) with one row per task, columns
   per phase, NULL when phase didn't happen. Query patterns for the dashboard
   are analytic, not event-stream.

2. **Final composer prompt.** Open: how aggressive should the system prompt
   be about "you must produce a final answer; don't ask another question"?
   Trade-off: aggressive prompt may produce confidently wrong answers when
   tools genuinely failed. Mitigation: include tool failure summary in prompt
   so model can honestly say "X didn't work, here's what I did manage".

3. **Background context priority semantics.** Right now `priority: "weak"` (parent
   task) and `priority: "background"` (memory recall, recent artifact) are
   informational. Eventually the prompt builder should render them differently
   (weak = "you can use this if asked"; background = "for recall only"). For
   1.11 we render them identically; revisit during Phase 4 prompt tuning.

4. **Backup back-compat shims.** `seedSemanticMemories` and
   `maybeSeedRecentArtifactContext` are kept as thin wrappers around the new
   compute helpers. Once all external callers (verify scripts, alternate
   submission paths) migrate to the structured-entry contract, the shims can
   delete. Likely Phase 3 territory.

---

## How to verify a change

The focused verify suite that should pass after every phase:

```
node scripts/verify-intent-plan.mjs
node scripts/verify-semantic-router.mjs
node scripts/verify-sr-hard-fact-skip.mjs
node scripts/verify-routing-policy.mjs
node scripts/verify-routing-status.mjs
node scripts/verify-executor-selection.mjs
node scripts/verify-context-sources.mjs
node scripts/verify-resolver-merge.mjs
node scripts/verify-p6-blocking-fix.mjs
node scripts/verify-post-tool-final-synthesis.mjs
node scripts/verify-rag-digest.mjs
node scripts/verify-rag-memory.mjs
node scripts/verify-tool-policy-guard.mjs
node scripts/verify-explicit-no-search.mjs
node scripts/verify-topic-hint-surfacing.mjs
node scripts/verify-research-quality.mjs
node scripts/verify-success-contract-groups.mjs
node scripts/verify-runbook-engine.mjs
node scripts/verify-scheduler-residual.mjs
```

`npm run check` runs the full ~80-script CI suite. Should be clean before any
PR merges to main.

Known baseline-only issues:
- `verify-action-tools` — flaky on baseline (confirmed via `git stash`)
- `verify-follow-up-routing` — 1 fail on baseline

---

## Manual smoke matrix

After any phase that affects the agent loop, hit these manually:

| Input | Expected lane | Expected behavior |
|---|---|---|
| `打开 outlook` | single_turn → tool_using | LLM calls launch_app immediately; no refusal |
| `5 分钟后给我发美股汇总到 a@b.com` | schedule | "已安排 5 分钟后执行：..." bubble |
| `5 分钟后帮我在 outlook 的日历里新建一个任务` | clarify | clarification question rendered |
| `今天有什么 AI 新闻` | single_turn | tool_using calls web_search_fetch (deterministic + SR enrichment) |
| `打开 outlook，在日历里新建一个 30 分钟的吃饭任务，时间在明天下午1点` | single_turn | NOT mis-routed to schedule (regression check) |
| `打开 outlook 然后写邮件给 X` | single_turn | first launch_app, then connector_workflow_run for email |
| `今天天气怎么样` | single_turn | tool_using; first prompt out fast (no SR wait); SR patches expected_output to summary on iter ≥ 1 |
