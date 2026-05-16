# Post Runtime Upgrade Roadmap

This roadmap is the tracked post-canonical execution board for work that was
repeatedly requested but intentionally deferred from the canonical
memory/conversation/context/artifact/performance sequence.

Historical root audit files such as `FRAMEWORK_GAP_ANALYSIS.md` and
`FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` can be used as background evidence, but
they are not the authority for this board. The authority is the current program:
tracked architecture docs, current source ownership, existing verifiers,
behavior tests, GUI smoke coverage, and release gates.

The previous canonical sequence and capability/tool owner reorganization are
complete. This file is the next execution board for desktop experience,
context/trace durability, generic graph resume, sub-agent runtime, multi-model
execution, plugin/MCP marketplace work, privacy sandbox hardening, and long-term
observability.

## Current Status Snapshot

Last updated: 2026-05-12.

- Canonical runtime spine: complete.
- Capability/tool owner cleanup: complete. `src/service/action_tools/tools/index.mjs`
  is now an aggregator/re-export surface only; built-in tool implementations
  live under `src/service/capabilities/tools/` or external capability
  aggregators.
- Current green gate: `npm run check:fast` passed 141/141 after PMAT-011
  project-as-chat-scope IA was added, including 1127/1127 behavior
  tests. `npm run verify:desktop-gui-smoke` passed 49/49. The previous
  `real-llm:followup-artifact --live` pass covered strict
  generated `.mjs`, Markdown, JSON, and CSV content consistency, actual file
  inspection, execution via `run_script`, same-file follow-up edits,
  topic-switch isolation, and token/cache trace evidence.
- Post-runtime board status: all tracked phases in this document are complete.
  Remaining work belongs to the separate maturity/product-gap boards or to
  future decision records that require new measured evidence.
- Primary product gaps have shifted from this post-runtime board to ongoing
  product maturity: broader manual desktop completeness acceptance,
  context/trace export polish, plugin/MCP trust presentation, sandbox
  governance evidence packs, measured multi-model execution loops, and future
  automatic sub-agent runtime delegation behind the existing gates.
- Legacy snapshot keywords retained for verifier continuity: desktop
  completeness, context/trace, plugin/MCP trust, sandbox governance,
  multi-model execution, sub-agent runtime.

## Product Maturity Board

These items are tracked after the completed post-runtime board. They must follow
the same execution discipline: inspect current code first, add a targeted test
or verifier before broad wiring, run real desktop/API acceptance when the
feature is user-facing, and do not use prompt-only patches to hide framework
gaps.

| Item | Status | Scope | Acceptance / verification |
| --- | --- | --- | --- |
| PMAT-001 Desktop product polish and manual acceptance | framework complete, evidence ongoing | Broaden daily desktop workflows beyond foundational GUI smoke: first-run recovery, empty/error states, settings, task detail, artifact preview, keyboard/a11y, cancel/resume, and common file/folder workflows. | Covered by DXR-001/DXR-002 evidence pack and daily workflow matrix. Current real GUI smoke: `npm run verify:desktop-gui-smoke` passed 49/49. New visible workflow changes still require row evidence. |
| PMAT-002 Optional network OTEL export | opt-in implemented, endpoint required | Current span taxonomy and local OTEL-shaped records stay local by default. Runtime Labs can enable network export only when the user checks consent and supplies an HTTP(S) OTLP endpoint. The service exporter sends redacted task span summaries only, with bounded queue/backpressure and timeout handling. | `src/service/observability/network-otel-exporter.mjs`, `src/shared/network-otel-config.mjs`, `node scripts/verify-network-otel-exporter.mjs`, and `tests/behavior/network-otel-exporter.test.mjs` lock the contract. No raw prompt, raw tool args, observations, or artifact content may be exported. |
| PMAT-003 Measured multi-candidate model loops | evidence-gated, not auto-enabled | Broader voting/ensemble/model-candidate loops may be added only where the final-reviewer and eval trend data show measurable benefit. No silent answer rewrite. | Feature flag, role-aware provider routing, token/latency budget, trace fields, and regression corpus proving quality gain over single answer. Price display stays off; token/cache fields are enough unless provider-owned billing evidence exists. |
| PMAT-004 Automatic sub-agent delegation enablement | evidence-gated, not auto-enabled | Use the completed sub-agent runtime contract for planner-selected delegation, context isolation, allowed tools, budget, cancellation, child reports, and UI timeline. | Feature flag plus delegation eval corpus, task timeline visibility, cancellation/budget tests, and real acceptance on multi-step tasks where delegation helps. Keep disabled until all SA-003 gates pass for the concrete task class. |
| PMAT-005 Runtime Labs user entry | active | Add a Settings > Labs surface that exposes the completed or gated capabilities without implying deferred work is enabled. | UI may enable existing safe gates (`ai.modelRoles.enabled`, `ai.reviewerLoop.enabled`) and the opt-in Network OTEL path (`observability.networkOtel.enabled`) only with explicit consent plus endpoint. Broad model voting and automatic sub-agent delegation stay visible but evidence-gated until their task-class gates pass. |
| PMAT-005 Local file/folder reality checks | active | Local filesystem answers must be grounded in fresh tool evidence. Directory listings must include folders as folders, and final answers must not infer folder absence from file-only listings or stale memory. | `list_files` exposes files, directories, and typed entries; evidence summaries preserve listed folders as shallow locator evidence. Add regressions when new file/folder workflows are found. |
| PMAT-006 Tool-surface heuristic governance | active | Tool, skill, and MCP exposure must be driven by typed TaskSpec/SemanticRouter/capability contracts. Regex may remain for structured parsing, sanitization, URLs, paths, time phrases, security filters, and narrow explicit-action gates, but not as a veto over typed runtime facts. | `tool_using` and `agentic` tool surfaces must not infer artifact writer exposure from raw user text. `node scripts/verify-tool-surface-heuristic-governance.mjs` locks this invariant. |
| PMAT-007 Project workspace separation | complete | Make project a first-class service-owned workspace instead of only a renderer/config project store. A project contains many conversations, many attached/indexed files, and project-scoped artifacts/context. Sessions remain conversation-scoped runtime work threads under a project. | `ProjectWorkspaceService`, service store `projects`/`project_files`, compatible `/projects/store`, guarded `/projects/:id/workspace`, ContextCompiler `project_scope`, `project-workspace-boundary.md`, `verify-project-workspace-service.mjs`, and behavior tests lock the contract. Renderer remains UI-only; no prompt-only project binding. |
| PMAT-008 Project workbench IA | complete | Bring the Project UI closer to Claude/ChatGPT-style workspaces: project list, project-scoped chats, project files/knowledge, and project instructions are distinct surfaces. Conversations remain independent threads under a project; project membership and files come from service-owned ProjectWorkspace, not renderer-local history. | Project page reads guarded `/projects/:id/workspace`, shows project stats/instructions/files/conversations, offers project-scoped new chat, persists project instructions through guarded `PATCH /projects/:id`, and keeps `/projects/store` as compatibility only. `verify-project-workspace-service.mjs`, renderer verifiers, behavior tests, `check:fast`, and GUI smoke cover the contract. |
| PMAT-009 Project chat IA | complete | Replace the old project-admin feel with a chat-first project workspace: projects behave like scoped chats, while the same page keeps project files, project instructions, and project conversation management visible. | Project page title is Project Chat, the main column provides a project-scoped composer that switches into Chat and submits under the selected project, conversations stay under `/projects/:id/workspace`, and the right context column owns files/instructions. Renderer remains UI-only and uses service-owned project metadata/workspace routes. |
| PMAT-010 Project UI cleanup | complete | Make the Project surface as clean as Chat: compact project rail, central thread list, right context rail, and no dashboard-like stat cards or repeated explanatory text. | Project page uses `project-clean-layout`, compact project rows, compact workspace masthead, scrollable thread list, and restrained context rail. Verifiers check the clean layout while service ownership stays unchanged. |
| PMAT-011 Project as Chat scope | complete | Align with common open-source workspace IA: project/workspace owns context and thread membership, while the full conversation composer stays in Chat. Project pages set the selected project scope, start new project chats, resume existing project chats, and manage files/instructions. | Project page exposes `projectOpenChatBtn` and `projectStartChatBtn`, removes the duplicate project composer, and routes both actions through Chat's existing project filter and conversation loader. |
| PMAT-012 Conversation files and split conversation IA | complete | Retire Files as a top-level workspace and make files/artifacts assets of the active conversation or selected project. Ordinary conversations and project conversations must be separate browsing domains, not one mixed "All conversations" list. Generated artifacts clicked in Console open the inline preview pane first, with external open/reveal as explicit secondary actions. Projects accept both individual files and folders, preserve attachment kind metadata, recursively index folders under a bounded budget, and make those indexed files available to project chats. | Follow Open WebUI-style scoped project/folder workspace and knowledge attachment patterns: project selection makes a workspace active, project files become reusable context, and normal chats stay separate. Verifiers now assert no visible `data-tab="files"` rail entry returns, Chat has a context-files entry, independent Chat filters out real project conversations while preserving legacy default-project conversations, the project picker allows files/folders, folder attachments render as folders, and artifact open handlers call the inline preview path. |
| PMAT-013 Console visual IA polish | active | Apply a LingxY-owned, Apple-inspired workbench layout instead of copying any one chat product: left global rail, compact conversation/workspace selector, main chat/work surface, and collapsible context files/details. Project is a Chat scope, not a separate duplicate chat UI; files are opened from the active conversation/project context. | First pass changes the Chat sidebar scope from the old personal/project text label to a neutral independent/project selector, removes the visible Projects rail entry, makes Files a collapsible context panel with project file/folder attach, distinguishes current-chat files from all selected-project files, and retunes the default palette to a quiet white/gray/system-blue treatment with lighter borders and less visual noise. Continue tab-by-tab polish for Tasks, Schedules, Inbox, Notes, Connectors, Settings, and Labs using the same pattern: fewer dashboard cards, clearer empty/error/loading states, keyboard/a11y smoke, and targeted verifiers before broad UI wiring. |
| PMAT-014 Global execution latency program | active | Optimize the end-to-end perceived speed of LingxY, not only one failing task. The runtime must separate UI acknowledgement from heavy context capture, run safe preflight work in parallel where side effects are not at risk, keep planner/tool surfaces typed and small, avoid redundant planner rounds after obligations are satisfied, and record timing evidence for slow phases. | Hotkeys and conversation selection must acknowledge immediately; active-window/file capture and message history may hydrate asynchronously. Typed task state, tool policy, memory lookup, context compilation, and side-effect obligations must remain the speed contract. New latency work requires targeted tests or verifiers plus `check:fast`; UI latency changes require GUI smoke or a focused renderer verifier. |
| PMAT-015 Memory model and UX maturity | active | Align memory with mainstream assistant behavior: durable saved memory, reference chat/project history, and project knowledge are separate concepts. Routine task completion summaries are not user-facing pending durable memories by default. Durable memories remain user-controllable, editable, deletable, scoped, and reversible; project knowledge and conversation history are used as context without creating approval noise. | User memory schema v2 stores routine task summaries in bounded `activityHistory`, classifies candidate quality before review, and migrates legacy pending `task_completion_summary` proposals out of the approval queue. Explicit user-created memory and high-signal typed durable candidates can still use the Review Inbox; opt-in auto-save remains explicit and only approves those high-signal candidates. Existing approved memory injection remains scoped by global/project/conversation identifiers, and activity history is never injected as durable memory. |
| PMAT-016 Desktop context and launchable selection contract | active | File selection must dominate active-window tracking. If a user selects files/folders/app shortcuts and invokes LingxY, the overlay should appear immediately and the active-window probe must not overwrite the selected resource context. Launchable resources such as `.lnk`, `.exe`, `.bat`, `.cmd`, `.appref-ms`, or shell targets are not document-analysis inputs. | Capture-and-ask shows the overlay before waiting for PowerShell/active-window capture. When selected files are present, active-window preview/tracking is suppressed for that handoff. Launch/open commands over launchable resources route through the action-tool submission path with typed `launchable_file_context`, or return a clear actionable message, never an unclassified internal file-text error. |

PMAT-013 update, 2026-05-13: Console Chat now uses separate in-sidebar
`会话` and `项目` tabs instead of a single ambiguous personal/project dropdown.
The Project selector appears only inside the Project tab, and Chat's Files drawer
remains the place to preview current-chat generated files and selected-project
files/folders. Settings polish continues the token-only cost policy: the visible
Budget panel is now Token Usage, the summary strip opens it directly, and the UI
does not show monthly/per-task dollar amounts. Skills GitHub install is placed at
the top of Skills Registries so adding user skills is the primary path, while
User Memory shows an explicit enabled/disabled state instead of relying on a bare
checkbox.

PMAT-013 console simplification follow-up, 2026-05-16: Console now opens into
Chat by default, because the chat/workbench surface is the simplest user
starting point while Tasks remains the execution log. Settings has a searchable
section navigator with Memory as a first-class destination, and advanced areas
start folded instead of flooding the page with configuration forms. Light mode
uses Apple-style system blue, neutral gray, green, red, and yellow status
tokens; legacy warm accent aliases map back to system blue so the Console does
not render orange/amber chrome in light mode.

PMAT-013 follow-up, 2026-05-13: Chat/project interaction must keep three
separate invariants locked. Ordinary Chat mode cannot leak a stale selected
project into the selector, empty-state copy, file drawer, or task submission.
Project mode must force-refresh service-owned project workspace files before
rendering the Files drawer, so project files/folders are available even before a
specific project conversation has generated artifacts. Conversation rows need
instant loading feedback, guarded soft-delete, and loaded user-message
previous/next navigation, while assistant final answers must remain below their
tool-call cards even if late tool events arrive. Token Usage is task
`llm_usage` aggregation first, budget fallback second, with a per-conversation
counter in the active chat header. User Memory remains review-governed:
completed task summaries are bounded activity history, not durable memory
proposals. Only explicit or typed high-signal durable candidates enter the
Review Inbox, and nothing becomes injected memory until the user approves it or
has explicitly enabled high-signal auto-approval.

PMAT-013 hotfix rule, 2026-05-14: task/conversation lists are critical
navigation surfaces and must not scan full task event logs or artifact content
before rendering. Token counters read persisted `task.usage_summary` from the
task row, and `emitLlmUsage` updates that summary at emission time. Historical
event-log aggregation belongs in task detail, diagnostics, or explicit usage
reports, never in `/tasks/summary` or first-screen conversation rendering.

PMAT-013 file/memory follow-up, 2026-05-14: generated files and attached
folders must be previewable from the Console without falling through to the
external OS app as the only path. The inline preview pane owns folder listing,
child-folder navigation, reveal actions, and a local back stack. File/folder
reads stay behind the preload `ucaShell` bridge and the preview shell client;
renderer code must not call Node filesystem APIs directly. User Memory follows
the mainstream consent pattern used by mature assistant products: memory is
enabled/disabled explicitly, generated memories remain proposal-governed by
default, and automatic approval is allowed only after a separate user opt-in.
Approved memory is scoped by global/project/conversation identifiers and injected
as typed background context only for matching project or conversation tasks.

PMAT-013 attachment/reviewer follow-up, 2026-05-14: the Files drawer and Project
files column must distinguish user-sent attachments, generated artifacts, and
durable project attachments. Project workspaces expose `message_files` collected
from message `context_summary` records so uploaded files are visible even when a
conversation has no generated artifact. Opening a file from a folder must keep a
containing-folder button in the preview header, while the back stack handles
recent preview navigation. Streaming reasoning cards stay at the bottom of the
chat surface instead of being stranded above the assistant answer. Final-answer
reviewer findings must be user-facing `Accuracy check:` warnings; raw reviewer
labels are treated as internal leakage.

PMAT-013 responsiveness/tool-flow follow-up, 2026-05-14: selecting an existing
conversation must activate the conversation shell immediately so the user can
send a follow-up while message history loads in the background. If a detail
response arrives after an optimistic user message, pending message nodes are
preserved instead of being wiped by the slower history render. Reasoning cards
collapse as soon as answer composition starts or text begins streaming, and tool
cards default to a compact one-line state unless an error needs attention.
Final composer output is guarded against model-written "search/network tool
unavailable" apologies: such claims must be reconciled against structured tool
transcript failures and available evidence, with a `final_composer_guarded_claim`
event when the deterministic transcript-based wording replaces the model text.

PMAT-013 stock/side-effect routing follow-up, 2026-05-15: scheduled market
digest task `task_f69f6c2d-b13c-46a4-aad1-db728378d778` exposed two framework
gaps after SemanticRouter timed out. First, `run_script` was visible to a task
that did not carry typed `code_execution` capability or explicit code-execution
intent, so the planner executed an unrelated spreadsheet script. Second,
deterministic scheduled-email fallback could still synthesize an email body
from no evidence when routing was degraded. The fix is framework-level and
language-neutral: code execution tools are hidden unless TaskSpec/SemanticRouter
or explicit execution intent allows them; degraded side-effect routing keeps
web/evidence tools reachable but refuses deterministic email fallback when no
tool observations exist. Do not reintroduce current-research topic regexes into
tool-surface gates.

PMAT-013 degraded side-effect safety follow-up, 2026-05-15: scheduled market
digest task `task_3326a472-b929-4dae-8009-d2a0c57dc874` showed that the prior
fix was necessary but incomplete. When SemanticRouter degraded, the broad
zero-capability tool surface still exposed unrelated `file_op` and
`vision_analyze`, allowing stale file/image context to distract the planner.
The final reviewer correctly rejected the fabricated market/email answer, but
the rejected candidate still remained the main user-visible reply. The framework
contract is now stricter: degraded side-effect tasks expose only required
side-effect tools, explicitly required tools, and permitted web-evidence tools;
unrequested image understanding, broad file operations, code execution, and
unrelated artifact/vision/file tools stay hidden until typed task facts allow
them. A final-reviewer `reject` now replaces the candidate with a deterministic
safe incomplete-result message instead of appending a warning to unsupported
claims.

PMAT-013 schedule/side-effect/performance follow-up, 2026-05-15: scheduled
market digest task `task_3733f061-b6de-4b34-b82a-4883bdea0e3b` proved a second
side-effect framework gap. The task did fetch web evidence, but action-only
handoff sent email with raw tool/account transcript content and the final answer
claimed a polished digest was sent. Email side-effect tools now have a
pre-execution content contract: research/synthesis emails must contain
synthesized user-facing content, cannot include connector/account/debug logs,
and cannot be a raw transcript join. Deterministic scheduled-email fallback must
build its body from structured evidence sources, not raw observations. Schedule
calendar views now expand recurring cron triggers across the visible week/month
instead of placing a recurring schedule only on `next_run_at`. Runtime
responsiveness work for this incident has two rules: renderer reasoning output
stays as a compact real-time process indicator unless opened, and planner skill
context is filtered by typed artifact/file relevance so unrelated local skills
do not inflate every research/email iteration.

PMAT-013 scheduled side-effect completion follow-up, 2026-05-15: scheduled
market digest task `task_e809923e-3873-4dc3-9c59-9ddfe2391a57` sent the email
but still surfaced `partial_success`. The root cause was not a user-language or
task-id issue: successful `connector_workflow_run` events can satisfy a typed
`email_send` obligation even when the nested connector did not echo
`metadata.connector_status=success`; explicit non-success metadata still blocks
satisfaction. A second performance root cause was that, after research evidence
was complete and the schedule had preauthorized `email_send`, the loop still
gave the LLM planner multiple chances to propose more research and then denied
those calls. The framework now forces preauthorized action groups into
action-only handoff immediately after non-action requirements are satisfied,
composes one side-effect body from structured evidence, validates it through the
normal side-effect content contract, sends exactly once, and returns success
without another planner round. Console task progress is rendered as one
collapsed live status card with expandable details rather than a stream of
system-message cards; final answer streaming remains reserved for user-visible
answer text.

PMAT-013 scheduled title and email-shape follow-up, 2026-05-16: live scheduled
weather and market-email tasks showed two related framework failures. Schedule
names could still be selected from `action.params.userCommand`, so whole user
prompts, tool names, URLs, and recipient strings leaked into task titles. Email
approvals could also receive a joined recipient string such as
`a@example.com和b@example.com`, making the UI display one recipient and making
edits unreliable. The fix is a typed policy, not sample-specific prompt
wording: scheduler titles are derived from schedule trigger/action/category and
side-effect contract signals, old prompt-like stored names are normalized when
listed or dispatched, and scheduled email subjects are normalized before
approval/send when a prompt-like subject is proposed. Email recipient fields use
one central extractor so account tools, connector workflow previews, and
approval overrides preserve multiple editable recipients as arrays.

PMAT-013 schedule/email/console framework follow-up, 2026-05-16: task
`task_8fe808c1-1088-4a41-91f8-81bca4c22a94` and the market-news schedule
exposed three framework-level flexibility bugs. First, provider/product names
such as `Google/Microsoft connector` were still classified as explicit web
search verbs, so architecture planning could be forced into irrelevant web
contracts and then downgraded to `partial_success`. Provider names are no
longer search intent by themselves; only actual search commands like
`google it` / `search for` / Chinese search verbs drive the structural search
signal. Second, scheduled research email could enter action-only handoff while
research-quality violations were still present, allowing an irrelevant market
digest to be sent and only then rejected by the final reviewer. Email side
effects now require all non-action success-contract requirements, including
research source coverage, to be satisfied before send; action obligations remain
the only pending violation allowed at the email boundary. Third, console
streaming could keep a partial text-delta bubble and append `inline_result` as a
second answer because terminal cleanup ran before finalizing the streaming
bubble. Terminal inline results now finalize the existing stream first. Schedule
rows also expose editable email-recipient slots backed by the typed
`side_effect_contract`, and paused schedule state is shown as neutral status
text rather than a prominent English pill.

PMAT-013 framework-comparison refinement, 2026-05-16: review of current
LangGraph, AutoGen, CrewAI, and OpenAI Agents SDK patterns confirmed that
LingxY should keep its own typed desktop runtime rather than importing a generic
agent graph wholesale. The borrowed invariant is recoverable guardrails:
LangGraph-style interrupts persist state and resume with corrected input;
AutoGen termination conditions stop/resume on typed events; CrewAI Flows keep
stateful event-driven steps; Agents SDK tool guardrails validate/block at the
tool boundary and tracing records guardrail/tool spans. LingxY maps this to its
existing TaskSpec + success-contract + transcript event spine: a blocked email
side effect now emits `tool_call_denied` plus structured `contract_guidance`
when prerequisite non-action evidence is missing, so the planner can return to
the evidence phase and retry the side effect only after the contract is
satisfied. This keeps flexibility in the workflow state, not in prompt wording
or sample-specific exceptions.

PMAT-014 desktop latency follow-up, 2026-05-15: hotkey capture must not trade
speed for wrong context. `capture-and-ask` starts the PowerShell capture promise
before focusing LingxY, then shows the overlay immediately while the capture
result hydrates asynchronously. The active-window feature flag is cached
locally; `/health` refresh runs after capture starts so a slow service health
request cannot make the probe capture the Electron overlay/console. If the
foreground result is still a LingxY shell window, the shell wrapper prefers the
last remembered external window or suppresses the shell preview.

PMAT-014 global latency execution plan, 2026-05-15: the speed program is now
tracked as an end-to-end runtime optimization, not a single-task micro-fix.
External framework signals reviewed for this pass: LangGraph persistence treats
threads, checkpoints, replay, and pending writes as the durable resume contract;
OpenAI Agents SDK tracing models each agent run as spans for model calls, tool
calls, handoffs, guardrails, and custom events; CrewAI production guidance keeps
long-running work async and uses structured outputs between steps; AutoGen shows
that multi-agent autonomy must stay inspectable through explicit conversation
and human-in-the-loop patterns. LingxY should borrow the contracts, not copy the
frameworks: keep its service-owned session/context/artifact spine, but make
every slow phase measurable, bounded, and independent where ordering allows.

PMAT-014 intake for current implementation step:

- Module boundaries: service/runtime task submission and conversation lifecycle
  own the hot path; SQLite/memory stores remain storage adapters; Electron main,
  renderer, tool ids, provider adapters, connector routes, artifact transforms,
  and prompt text are untouched.
- Scope: reduce task-submission acknowledgement latency for long conversations
  by reading only the recent prior-message window needed for context. This is a
  framework invariant: first-screen/task-created paths must not scan broad
  history when a bounded tail is enough.
- Out of scope: changing executor behavior, changing history selection
  semantics, adding a DB worker/queue, adding sidecars, or altering
  SemanticRouter policy.
- Contracts affected: `attachPriorBackendMessages()` may use
  `countConversationMessages()` plus bounded `getConversationMessages()` when
  available; the public `prior_messages` shape and ordering remain unchanged.
- Test gate: add a targeted behavior test proving long conversations read a
  bounded tail window, then run the conversation lifecycle test plus
  `npm run check:fast`.
- Patch check: this is not a phrase/task patch. It enforces a hot-path budget
  rule for any long conversation.

PMAT-014 next optimization slices:

1. Hot-path reads: avoid broad `conversation_messages`, `task_events`, artifact
   content, and skill inventory scans before task creation or first visible
   output. Prefer bounded tail queries, persisted summaries, and lazy detail
   hydration.
2. Parallel preflight: run safe, side-effect-free classification, context-source
   stamping, memory/file recall, and provider resolution concurrently only when
   typed obligations do not depend on each other.
3. Planner loop budget: after typed evidence and required side-effect
   obligations are satisfied, route to synthesis/action-only completion instead
   of offering extra planner rounds that can only be denied.
4. Tool surface diet: expose only typed-required tool families during degraded
   routing so planner search space stays small and unrelated local tools do not
   inflate iterations.
5. UI acknowledgement: keep hotkeys, conversation switching, and task shell
   activation immediate while history, active-window details, and large traces
   hydrate asynchronously.
6. Evidence trend: extend existing trace/eval reports with p95 timings for
   task_created, first executor event, first visible output, SemanticRouter
   patch, context compile, tool-call latency, and final synthesis.

PMAT-014 implementation notes, 2026-05-15:

- Long conversation task submission now reads a bounded prior-message tail using
  `countConversationMessages()` and `getConversationMessages({ sinceSeq,
  limit })`; it preserves the `prior_messages` contract without broad history
  reads before `task_created`.
- Planner skill context now has a shared typed relevance gate in
  `src/service/executors/shared/skill-context.mjs`. `tool_using` and `agentic`
  skip skill registry scans entirely when the task has no artifact/file
  relevance, while attached editable files and typed artifact tasks still load
  matching workflow guidance.
- SQLite task-event incremental reads are pushed into the store query for
  `getTaskEventsSince()` so SSE replay after a cursor does not decode the full
  task event log in service JS on every poll.
- Task completion history indexing now prefers already-structured
  `task.result_summary` and artifact rows before reading `task_events`; event
  logs remain a fallback only when the structured summary or artifact rows are
  missing.
- Live API sweep on 2026-05-15 used DeepSeek `deepseek-v4-flash` plus a
  connected Google account. Provider acceptance passed in 8.9s
  (`.tmp/live-provider-acceptance/report-2026-05-15-17-41-59.json`); connector
  OAuth/read acceptance passed in 7.9s with Google email/file/calendar read and
  email write capability available
  (`.tmp/connector-oauth-acceptance/report-2026-05-15-17-41-58.json`).
- Representative real tasks exposed the actual latency shape: direct Q&A
  9.3s, browser-context Q&A 1.7s, connector mail read 12.2s, and real Gmail
  send to the audit recipient 4.3s. The translation fast path initially
  returned in 0.2s but exposed a quality gap: inline commands such as
  `翻译成英文：...` were not extracting the delimited source text from
  `user_command`. The slow artifact failure was `D.npm_trends_md`: 108.7s,
  18 LLM calls, about 189k tokens, failed because deterministic artifact
  recovery treated `md` as unsupported and then let the planner loop until an
  empty `write_file` call failed.
- Deterministic artifact recovery is now a shared typed plan in
  `src/service/executors/shared/deterministic-artifact-plan.mjs`: rendered
  document/html kinds route through `generate_document`; explicit raw `.html`
  filenames plus `md`, `txt`, `csv`, and `json` route through `write_file`;
  runtime reviewer footers such as `Accuracy check:` are stripped before file
  materialization; resolved output paths are preserved when available. Both
  `tool_using` and `agentic` use the shared plan.
- After the fix, `D.npm_trends_md` passed in 15.2s with 3 LLM calls, about
  13.2k tokens, `web_search_fetch -> write_file`, and a real `.md` artifact
  without internal reviewer text
  (`scripts/real-llm-test/report-2026-05-15-17-51-54.json`). The Gmail live
  send case passed in 4.0s after the audit corpus accepted the canonical
  expanded workflow tools (`google.gmail.create_draft_preview`,
  `google.gmail.send_email`).
- Translation inline source extraction is now structural instead of
  phrase-specific: only explicit `:`/`：` delimited translation commands can
  supply source text when no context packet text/file/selection is present.
  `L.zh2en_proverb` passed the real runtime path in 0.86s with no LLM calls or
  tools and visible text `A journey of a thousand miles begins with a single
  step` (`scripts/real-llm-test/report-2026-05-15-17-57-54.json`).
- Harness quality notes: live scripts should be invoked directly with `node`
  when PowerShell/npm argument forwarding is ambiguous, and parallel runtime
  harnesses must use distinct full Windows pipe names such as
  `\\.\pipe\uca-helper-explorer-selection-<run>` to avoid false startup
  failures.

PMAT-013/014 Console streaming and link-choice follow-up, 2026-05-15: Console
chat must show live task movement before final synthesis, even when the provider
does not stream user-visible answer tokens until the final composer. The running
Console progress card now opens while the task is active, captures structured
runtime events such as `step_started`, `step_finished`, `log`, `status_changed`,
file-read progress, and cancellation requests, then folds again on terminal
events. Link clicks from overlay/Console/evidence surfaces still request
`ask:true`; the shell URL IPC now attaches the native choice dialog only to a
visible owner window and falls back to a no-owner dialog when the sender is a
hidden overlay, so the user is asked between a LingxY browser window, the system
browser, or cancel instead of silently navigating.

PMAT-014 pre-generation latency follow-up, 2026-05-15: the next speed slice
targets the time between user submit, task acceptance, and the first model/tool
progress. Intake gates: owner modules are the service store adapters and shared
executor conversation-history loader; caller boundary is executor prompt
assembly before `planner_request_started`; no-touch areas are task creation,
tool policy, artifacts, connectors, provider adapters, Electron main process,
and renderer layout outside the Console progress surface. Affected contracts are
the store conversation-message read API and the structured history loader. The
new invariant is that model-start hot paths must read a bounded tail before the
current trigger message, not scan the full conversation and filter in JS. Stores
now expose `getConversationMessagesBefore(conversation_id, { beforeSeq, limit })`
using the existing `(conversation_id, seq)` index; the shared loader requests the
last 120 prior messages before grouping turns and applying the existing token
budget. Console chat also starts the open progress card at client submission,
before `/task` returns, then appends task-created/executor progress into the
same card so the wait is visibly continuous. `fast` and `tool_using` provider
waits now emit bounded `status_changed` heartbeats after the model request has
been outstanding for 1.8s, and stop as soon as text/reasoning/tool-input deltas
arrive or the call completes; they do not synthesize answer text. This is a
framework invariant, not a phrase/task patch: long conversations stay
structurally resumable while broad history hydration remains outside the
first-model-start path, and slow provider first-token waits are observable
instead of silent.

PMAT-014 visible-output follow-up, 2026-05-15: a later Console report exposed
two adjacent runtime-boundary issues. First, the tool executor's prose-trap
retry note was user-shaped Chinese text, so an LLM could mirror it into the
final answer ("no tool needed / plain-text final answer"). The retry note is
now marked as an internal planning retry and final tool-loop results pass
through a user-visible final-text sanitizer that strips internal retry
preambles and audits the change before answer-quality validation. Second,
Console subscription setup no longer closes the submission progress card; live
reasoning and file-generation deltas also append throttled progress lines so
provider waiting, planning, and generation remain visible before final text
arrives. The tool planner now emits the first `waiting_for_planner_first_output`
status immediately when the provider request is sent, then continues with
bounded heartbeats, because real API evidence showed timer-only heartbeats can
be missed by the user's perceived wait even when the task event stream is
healthy. This preserves the existing Electron/renderer structure and keeps
console rendering changes inside the progress surface.

PMAT-014 file cleanup follow-up, 2026-05-16: file cleanup is now part of the
global execution-efficiency program rather than an ad hoc deletion pass. The
tracked execution board is
`docs/architecture/global-execution-efficiency-and-cleanup-plan.md`; the
machine-checkable cleanup contract is
`docs/architecture/file-cleanup-evidence-pack.md` with the verifier
`npm run verify:file-cleanup-evidence-pack`. Cleanup is split into local
generated output, historical evidence, old reachable
implementation paths, and large mixed-responsibility files. Tracked source files
may be deleted or archived only after import/reference sweeps, package script
and public export checks, IPC/HTTP/tool/artifact/provider/storage sweeps where
relevant, replacement verifier coverage, rollback or archive path, and
`npm run check:fast`. This keeps cleanup tied to measurable latency, token,
redundancy, and answer-quality work instead of treating old code as stale by
appearance.

PMAT-005 investigation note, 2026-05-12: task
`task_b039b848-19ac-4833-8ffb-1e02b0151aa5` answered that Desktop had no
`杂项` folder even though the real Desktop contained it. The task log showed
two framework issues: a PowerShell `run_script` directory listing returned
mojibake for Chinese names, and `list_files` listed only files, not
directories. The fix is framework-level: `list_files` now returns typed
`entries`, `files`, and `directories`, and evidence summaries preserve listed
directories as shallow locator evidence.

## Open-Source Framework Comparison Refresh

Reviewed on 2026-05-12 against current official docs for OpenTelemetry OTLP,
LangGraph persistence, OpenAI Agents SDK tracing/guardrails, CrewAI Flows, n8n
executions/redaction, and MCP authorization.

| Area | External reference signal | LingxY state | Remaining gap / next action |
| --- | --- | --- | --- |
| OTLP export | OpenTelemetry defines OTLP endpoint, HTTP(S) URL components, timeout/retry expectations, and JSON/protobuf trace request semantics. | Network OTEL is now opt-in through Runtime Labs with explicit consent, HTTP(S) endpoint sanitization, summary-only redaction, bounded queue, timeout, fail-soft task-event wiring, and `verify-network-otel-exporter.mjs`. | Add a later backend decision record only if users need vendor presets, custom headers, compression, or collector auth. Header secrets must go through secure config storage and redaction preview first. |
| Trace privacy | n8n documents execution data redaction that hides input/output while preserving metadata. | Network export omits raw prompt/tool args/observations/artifact/final answer and sends span metadata only. | Add a UI preview of the exact redacted export payload before first network enablement if users request stronger trust affordances. |
| Checkpoints and replay | LangGraph uses checkpoints for human-in-the-loop, memory, time travel, fault tolerance, and resume. | Runtime graph checkpoints, approval resume, session compaction, and task timeline are verifier-locked. | Product gap: a user-facing graph replay/fork debugger is still not as visual as mature graph frameworks. Track as future UX work, not runtime correctness work. |
| Guardrails | OpenAI Agents SDK separates input, output, and tool guardrails, with tool guardrails applying around each function tool invocation. | LingxY has submission policy, permission modes, tool schemas, approval gates, success contracts, and heuristic-governance verifiers. | Product gap: expose per-tool guardrail decisions in task detail, especially denied/edited args and policy group satisfaction, so users can debug why an action did or did not run. |
| Multi-agent/flows | CrewAI Flows and AutoGen-style systems emphasize explicit multi-step/multi-agent orchestration, state, visualization, and resumable long-running workflows. | Sub-agent runtime contract, child timeline summaries, and SA-003 enablement audit exist; automatic delegation remains evidence-gated. | Keep automatic delegation disabled until a concrete task class beats the single-agent baseline. Add visual flow/child-run presentation before broad enablement. |
| Executions and retries | n8n separates manual vs production executions, lists execution history, and supports retrying failed runs. | Console task list/detail, inline retry, cancellation, and release evidence exist. | Product gap: add a clearer execution-history view with retry-from-original-context versus retry-current-context choices for failed task families. |
| MCP authorization | MCP authorization requires OAuth best practices, resource/audience binding, HTTPS/localhost redirects, PKCE, and token-storage discipline for HTTP transports. | MCP governance policy, trust previews, local-only skill boundaries, and marketplace distribution policy are in place. | Audit external MCP OAuth wiring against the 2025-06-18 authorization spec before enabling broader remote MCP discovery or marketplace installs. |

Comparison conclusion: the current runtime spine is close to mature frameworks on
typed traces, persistence, approvals, memory, and local capability governance.
The remaining meaningful gaps are mostly user-facing debuggability, visual
workflow/replay UX, external MCP/OAuth hardening, and optional OTLP vendor
integration polish. None require prompt-only patches or a second runtime stack.

## Source Map

| Area | Current program evidence | Current state |
| --- | --- | --- |
| True sub-agent runtime | `runtime-graph-*` verifiers exist; `docs/architecture/sub-agent-runtime-contract.md` defines the service contract; `src/shared/sub-agent-timeline-summary.mjs` defines the UI trace summary. | SA-001 and SA-002 are complete for contracts, timeline visibility, and eval corpus; a later maturity board may enable automatic planner delegation behind the existing feature gate. |
| Multi-model execution | `verify-model-role-routing.mjs` exists; real planner/executor call sites now use role-aware provider resolution behind an explicit feature flag. `verify-final-answer-reviewer-loop.mjs` locks the optional reviewer pass. | MM-001 is complete for planner/executor binding and measurement fields; MM-002 is complete for the feature-flagged final-answer reviewer pass. Broader voting/ensemble loops remain out of scope until measured need exists. |
| Generic HITL graph resume | `verify-approval-resume-state.mjs`, connector workflow resume, runtime graph checkpoints. | GX-003 is complete for generic agent tool approvals resuming on the original task; connector workflow resume remains intact. |
| Desktop/GUI completion | `verify:desktop-gui-smoke`, `verify-desktop-gui-perf-smoke`, desktop README/inventories, window/IPC split docs, `docs/architecture/window-session-state-machine.md`, `verify-window-session-state-machine.mjs`, `docs/architecture/desktop-ipc-boundaries.md`, `verify-desktop-ipc-boundaries.mjs`. | DX-001 through DX-005 plus VX-001/VX-002 are complete for window ownership, IPC boundaries, keyboard/a11y smoke, first-run recovery, preview screenshot-diff, checked-in voice fixtures, and opt-in hardware smoke. Future work should focus on product polish and broader manual acceptance, not missing foundational contracts. |
| Timeline/trace/export | `verify-task-trace-timeline.mjs`, `verify-context-debug-panel-lazy-load.mjs`, llm usage verifiers, `verify-eval-trend-store.mjs`, `verify-task-span-taxonomy.mjs`, and `verify-network-otel-exporter.mjs`. | OQ-001 and OQ-002 are complete for trend storage, stable span names, local OTEL-shaped export records, and an opt-in network OTEL exporter. Network export remains off by default and requires Runtime Labs consent plus HTTP(S) endpoint configuration. |
| Memory governance next pass | `verify-memory-governance.mjs`, `verify-user-memory-profile.mjs`, context compiler tests, and `scripts/real-llm-test/run-context-memory-cache-acceptance.mjs`. | Editable memory, proposal approval/rejection, review history, undo, project scoping, and opt-in real API context/follow-up/token/cache acceptance are covered. Future work should improve automatic proposal quality, not reopen the storage contract. |
| SQLite write queue / DB worker | `docs/architecture/sqlite-write-path-budget.md`, `verify-sqlite-write-path-budget.mjs`, `verify-session-context-artifact-write-budget.mjs`, and `verify-context-trace-budget.mjs`. | RT-001 through RT-003 are complete. Current decision is direct service-owned SQLite writes with WAL and budget guards; no DB worker or write queue is introduced without new measured evidence. |
| Permission/mode model | `verify-permission-mode-model.mjs`, privacy sandbox policy, approvals, and runtime submission boundaries. | RT-004 is complete for the permission/mode contract. Future UI polish can improve presentation, but this board no longer has an unresolved mode-framework gap. |
| Sidecar decision record | `docs/architecture/sidecar-decision-record.md`, `src/service/security/isolation-decision-records.mjs`, and `verify-sandbox-decision-records.mjs`. | SH-001 and SH-002 are complete for current isolation decisions and mandatory sidecar decision template; no new sidecars are introduced. |
| Optional git checkpoint mode | `lingxy_codex_ready_agent_runtime_upgrade_plan.md` section 3.9; `FUNCTION_AUDIT_AND_UPGRADE_PLAN.md` FW-018 | Complete for opt-in metadata: file reversibility remains default, while `ctx.reversibility.gitCheckpoint.enabled` can create a non-worktree git checkpoint ref for project rollback. |
| Plugin/MCP marketplace | `skill/mcp/connector` surface contracts, plugin registry verifier, connector boundary docs, `docs/architecture/marketplace-trust-model.md`, and marketplace distribution policy tests. | PM-001 through PM-003 are complete for trust previews, isolated external MCP governance, signatures/share/archive metadata, and non-discoverable plugin archives. Broader marketplace UI is product polish, not an open trust-framework item in this board. |
| Privacy/sandbox hardening | `verify-privacy-sandbox-policy.mjs`, security broker/audit log owners, MCP install sandbox owner, OS sandbox decision records, and `security-policy-trace-export.md`. | SH-001 through SH-003 are complete. OS-level sandbox/codesign execution remains a future decision-record item only when new measured evidence justifies it. |
| Task/conversation/project IA migration | Conversation/session/context services, current codebase audit, renderer/runtime client verifiers, follow-up resolver tests, and live artifact acceptance. | IA invariants and contracts are complete for this board. Follow-up binding, topic isolation, context visibility, artifact lineage, and renderer runtime client boundaries are verifier-locked. |

## Tracking Register

| Phase | Status | Tracking rule |
| --- | --- | --- |
| PX-001 Roadmap/status hygiene | complete | This roadmap is linked from architecture docs and guarded by `verify-post-runtime-roadmap.mjs`. |
| RT-001 to RT-004 Runtime persistence/context/mode | complete | RT-001, RT-002, RT-003, and RT-004 are complete with direct-write/compact-trace/mode-contract verifiers. |
| DX-001 Desktop WindowSession | complete | Window owner state, preview stale-delta rejection, popup owner tracking, and GUI smoke coverage are locked by `verify-window-session-state-machine.mjs`. |
| DX-002 Desktop IPC boundary | complete | `electron-main.mjs` is locked as lifecycle/composition only; 112 IPC registrations live under `src/desktop/main/ipc/` and are guarded against duplicates and large handlers. |
| DX-003 Renderer runtime client consolidation | complete | Console and Overlay runtime mutations are routed through shared renderer clients and locked by `verify-renderer-runtime-client-consolidation.mjs`. |
| DX-004 Keyboard/a11y GUI pass | complete | Real Electron smoke now drives Overlay task-list keyboard navigation, Console Settings/Schedules keyboard paths, and approval popup keyboard reject. |
| DX-005 Desktop first-run/i18n/preview fidelity | complete | First-run provider recovery and generate_document preview screenshot-diff are covered by real Electron GUI smoke and verifier contracts. |
| VX-001 Voice fixture corpus | complete | Checked-in WAV corpus now backs transcription and KWS metrics; optional private fixture directory is documented for larger local samples. |
| VX-002 Hardware permission smoke | complete | Opt-in Electron GUI smoke can record from local microphone hardware with actionable diagnostics; default checks stay hardware-free. |
| GX-003 Generic graph resume | complete | Generic agent tool approvals now resume on the original task through same-task graph resume; connector workflow resume remains intact. |
| RV-001 Optional git checkpoint mode | complete | Opt-in git checkpoint metadata is implemented under `src/service/capabilities/tools/git-checkpoint-mode.mjs`; default file reversibility remains unchanged. |
| SA-001 Sub-agent runtime contract | complete | Service-owned child-run contract now covers feature-flag gating, planner-selected delegation, context isolation, allowed tools, budget, cancellation, and structured child reports. |
| SA-002 Sub-agent UI/evals | complete | Parent task detail now renders child runs from task detail children and `sub_agent_report` events; delegation eval corpus guards when to delegate and when not to. |
| MM-001 Model role call-site binding | complete | `resolveProviderForModelRole` binds planner/executor call sites only when model role routing is explicitly enabled and records role fields in `llm_usage`. |
| MM-002 Reviewer/voting loops | complete | Feature-flagged final-answer reviewer pass runs only for high-risk artifact/connector/research tasks, binds to the `reviewer` role, records trace/usage, and cannot silently rewrite output. |
| PM-001 Marketplace trust model | complete | Skills, connector plugins, and MCP statuses now expose shared `trustPreview` metadata with trusted/local-only/third-party/unsigned/disabled/deleted flags. |
| PM-002 External MCP governance | complete | External MCP must use isolated token stores, is blocked from reusing LingxY OAuth/account token refs, and remains catalog-only with confirmation required by default. |
| PM-003 Plugin/skill/MCP marketplace | complete | Marketplace distribution policy normalizes signature/share/archive metadata, plugin uninstall archives recoverably, and archived plugins are not discoverable as runnable catalog entries. |
| SH-001 OS sandbox decision records | complete | File operations, external commands, browser automation, OCR, audio daemons, and MCP install sandbox have explicit isolation decisions, rollback paths, and user recovery contracts. |
| SH-002 Sidecar decision record template | complete | New native helpers, daemons, OS sandboxes, or sidecars require a measured decision record and cannot be justified as a general business-logic rewrite. |
| SH-003 Audit export and policy trace | complete | Runtime and diagnostic bundles include redacted policy trace summaries for blocked decisions, approvals, and policy task events without raw tool args or context text. |
| OQ-001 Eval trend store | complete | Real-LLM corpus reports append compact JSONL trend records and compare against the previous run without storing raw commands or reports. |
| OQ-002 Observability span taxonomy | complete | Shared task span taxonomy and local OTEL-shaped export records are verifier-locked without network export or hot-path overhead. |
| CM-001 Context, memory, follow-up, and cache acceptance | complete | `real-llm:context-memory-cache` is an opt-in real API harness for approved user memory, project memory, follow-up parent binding, and token/cache traces. It backs up and restores user memory, redacts evidence, and records token/cache fields only; price is not displayed. |
| FA-001 Follow-up artifact generation and execution acceptance | complete | `real-llm:followup-artifact` runs `scripts/real-llm-test/run-followup-artifact-acceptance.mjs`, an opt-in real API harness for generated artifact content, artifact-based follow-up generation, generated artifact validation through `run_script`, strict generated `.mjs`, Markdown, JSON, and CSV content consistency, same-file Markdown follow-up edits, same-conversation topic switch isolation, and new-topic follow-up isolation. The live harness now fails if a generated file is only claimed in prose, if no real file exists, if requested multi-format artifacts are missing, or if actual file content does not contain the requested marker. |

## Execution Rules

- Do not reopen the completed runtime spine as if it were unfinished.
- Every PR must name module boundaries, forbidden modification areas, interface
  contracts, tests/verifiers, and old-code retirement or archive decisions.
- Do not introduce true sub-agents, sidecars, OS sandboxes, or marketplace trust
  flows without a measured contract and rollback path.
- Prefer additive migrations and feature flags until a replacement path is
  verified; once verified, replace old call sites and delete or archive obsolete
  code in the same PR or in a named cleanup PR with a blocking verifier.
- Do not put heavy work in Electron main process or renderer.

## Program-Grounded Triage

These items are not accepted merely because an older plan suggested them. Each
candidate must be checked against the current program first:

- Current event streaming already keeps `text_delta`, `tool_input_delta`,
  `reasoning_delta`, and `tool_planner_decision` out of durable event storage,
  so a DB queue is not automatically required for high-frequency token streams.
- Artifact extraction already has a service-owned background lane, so the next
  risk is write-path durability/backpressure, not parser CPU in Electron.
- SQLite currently uses `better-sqlite3` inside the service store. That is
  acceptable until a measured hot path or broad state growth proves queueing or
  a DB worker is needed.
- `execution_mode`, approval gates, and privacy sandbox policy already exist.
  The missing part is a coherent user-visible mode contract, not a rewrite of
  every approval.
- File-level reversibility checkpoints already exist. Git checkpoints are
  optional project-level recovery, not a replacement.

Decision standard:

- If the current code already has a safe framework path, keep it and add a
  verifier rather than replacing it.
- If the current code has partial coverage, add a scoped completion PR.
- If the current code has no measured problem, add a decision record or audit
  gate instead of implementation.

## Phase A: Roadmap And Status Hygiene

### PX-001: Make This Roadmap The Post-Canonical Board

Scope:

- Link this document from architecture docs and future status summaries.
- Add a verifier that catches stale "Current next step" claims in canonical docs.
- Keep root ignored audit files as historical context unless they are explicitly
  promoted into tracked docs.

Acceptance:

- New sessions can identify the completed canonical runtime sequence and the
  post-runtime roadmap without reading ignored root files.
- No implementation behavior changes.

Verification:

- `node scripts/verify-structure.mjs`
- New roadmap verifier if this phase edits status automation.

## Phase B: Runtime Persistence, Trace Budgets, And Mode Model

### RT-001: SQLite Write-Path Audit And Queue Decision

Status: complete as of 2026-05-11.

Scope:

- Audit all SQLite/store write paths for tasks, events, session items,
  artifact extracts, artifact lineage, context traces, memory proposals,
  graph checkpoints, schedules, approvals, and eval/perf metadata.
- Define priority classes: critical control writes, normal runtime writes,
  low-priority trace/eval writes, and background maintenance writes.
- Decide, from measured or structural evidence, whether to keep direct service
  writes, add a service-owned write queue, or move a subset to a DB worker.
- Keep Electron main process and renderer out of DB batching.

Acceptance:

- The audit identifies which writes are already safe, which writes are on hot
  paths, and which writes are optional diagnostics.
- Critical task lifecycle, terminal state, approval-required, and checkpoint
  writes remain durable enough for recovery.
- High-volume or diagnostic writes do not block streaming or UI.
- If a queue is not implemented, the verifier records why direct writes remain
  acceptable for the current program.
- If a queue is implemented, snapshots expose depth, age, flush latency,
  dropped low-priority writes, and last error.

Decision:

- See `docs/architecture/sqlite-write-path-budget.md`.
- Current decision is to keep direct service-owned SQLite writes.
- Rationale: write ownership is concentrated in the service store, WAL is
  enabled, Electron desktop code does not own SQLite, and high-frequency stream
  events are already excluded from SQLite task-event persistence.
- No queue or DB worker is implemented in RT-001. RT-002 may revisit this only
  with measured evidence or a specific write-budget enforcement gap.

Verification:

- `node scripts/verify-sqlite-write-path-budget.mjs`
- Behavior tests for priority ordering, flush failure, shutdown drain, and
  low-priority backpressure only if a queue is implemented.
- `npm run check:fast`

### RT-002: Session/Context/Artifact Write Budget Enforcement

Status: complete as of 2026-05-11.

Scope:

- Apply the RT-001 decision to non-critical `session_items`, context traces,
  memory proposal records, artifact extracts, artifact lineage, and eval/perf
  metadata.
- Keep user-message/task-anchor writes critical or immediately durable when they
  are needed for follow-up correctness.

Acceptance:

- Conversation/session continuity remains correct under queued writes.
- ContextCompiler can read required durable state without depending on delayed
  diagnostic writes.
- Artifact transform success does not report before required lineage/contract
  writes are durable or explicitly recoverable.
- If direct writes remain, tests prove they are not on high-frequency stream
  paths and stay within budget.

Verification:

- Existing session/context/artifact behavior tests.
- `node scripts/verify-session-context-artifact-write-budget.mjs`
- New write-queue integration tests for session and artifact paths only if a
  later phase implements a queue.
- `npm run check:fast`

### RT-003: Context Trace Persistence And Budget Audit

Status: complete as of 2026-05-11.

Scope:

- Reconcile the older `context_compile_traces` plan with the current compact
  compiled-context/debug-panel implementation.
- Decide whether a persistent trace table is still required, or whether current
  task metadata plus lazy JSON export is the canonical trace storage.
- Enforce `context_compile_ms` and `context_trace_size_bytes` budgets in the
  chosen contract.

Acceptance:

- There is one canonical context trace storage/export path.
- Full traces remain opt-in and do not render by default.
- Stale older trace surfaces are deleted or archived after replacement.

Decision:

- See `docs/architecture/context-trace-budget.md`.
- Current decision: compact task metadata is the canonical context trace storage
  for the current program.
- Do not add `context_compile_traces` in RT-003.
- Keep full candidate traces debug-only and full compiled context JSON copy-only
  in the Context Debug Panel.

Verification:

- `node scripts/verify-context-compiler-v1.mjs`
- `node scripts/verify-context-debug-panel-lazy-load.mjs`
- `node scripts/verify-context-trace-budget.mjs`
- `npm run check:fast`

### RT-004: Permission And Mode Model

Status: complete as of 2026-05-12.

Scope:

- Map existing `execution_mode`, approval policy, privacy sandbox policy, and
  tool risk tiers into user-visible modes.
- Show the active mode in Overlay and Console.
- Make mode affect tool surface and approval threshold through the existing
  policy layer, not prompt wording.

Acceptance:

- Users can understand whether the current task is interactive,
  approval-required, unattended-safe, local-only, or dry-run-like.
- Mode changes are persisted, audited, and visible in task trace.
- Existing approval and privacy sandbox checks still pass.

Verification:

- `node scripts/verify-privacy-sandbox-policy.mjs`
- `node scripts/verify-approval-task-bridge.mjs`
- `node scripts/verify-permission-mode-model.mjs`
- `npm run verify:desktop-gui-smoke`
- `npm run check:fast`

Decision:

- See `docs/architecture/permission-mode-model.md`.
- `src/shared/permission-mode-model.mjs` is the shared contract for
  execution mode, approval threshold, privacy sandbox summary, and
  user-visible mode labels.
- The service persists `permission_mode_contract` on task selection metadata
  and mirrors it into `task_created` trace payloads.
- Console task detail and Overlay active-task surfaces render the shared
  contract instead of inferring approval behavior locally.

## Phase C: Desktop Experience Completion

### DX-001: WindowSession State Machine

Status: complete as of 2026-05-12.

Scope:

- Define a typed `WindowSession` state model for Overlay, Console, Preview,
  PopupCard, Dock, and LinkBrowser ownership.
- Track active conversation, active task, preview binding, popup owner,
  background/system task ownership, and stale-stream rejection in one contract.
- Keep state orchestration in desktop/service boundary modules, not scattered
  across renderer globals.

Acceptance:

- A new conversation cannot inherit another conversation's active task, stream,
  popup, or preview binding.
- Preview and popup windows reject deltas/actions from non-owned tasks.
- Scheduled/background/system tasks have explicit owner states.
- Existing GUI smoke names continue to pass.

Verification:

- `npm run verify:desktop-gui-smoke`
- `node scripts/verify-window-session-state-machine.mjs`
- Behavior tests for state transitions and stale-event rejection.

Decision:

- See `docs/architecture/window-session-state-machine.md`.
- `src/desktop/shared/window-session-state.mjs` is the shared desktop owner
  contract for managed windows, task/conversation owners, preview bindings,
  popup-card owners, background/system task ownership, and stale event records.
- Electron shell creates one `WindowSession` and injects it into preview and
  popup managers; preview delta/commit IPC returns stale-owner rejection
  decisions instead of always reporting success.
- This phase intentionally does not split more IPC handlers; DX-002 owns that
  boundary work.

### DX-002: Electron Main IPC Boundary Split

Status: complete as of 2026-05-12.

Scope:

- Split `src/desktop/tray/electron-main.mjs` IPC groups into small modules under
  `src/desktop/main/ipc/` without changing public IPC channel names.
- Move request normalization into typed desktop service-client helpers.
- Add a verifier that blocks large new IPC handlers and duplicate channel
  registration.

Acceptance:

- `electron-main.mjs` owns lifecycle composition, not broad business logic.
- IPC channel registrations are discoverable, unique, and actor-aware.
- Old inline handler blocks are deleted after module extraction, not duplicated.

Verification:

- `npm run verify:main-process-blocking`
- `node scripts/verify-desktop-shell.mjs`
- `node scripts/verify-desktop-ipc-boundaries.mjs`

Decision:

- See `docs/architecture/desktop-ipc-boundaries.md`.
- Current code already has the physical IPC split: `electron-main.mjs` imports
  and composes `src/desktop/main/ipc/register-*.mjs` modules and has no inline
  `ipcMain.handle/on` registrations.
- DX-002 adds the missing framework lock: no inline handler regression in
  `electron-main.mjs`, no duplicate channel registration, no direct
  `src/service/**` imports from IPC modules, and no oversized handler bodies.
- No IPC channel names, HTTP routes, storage schema, tool ids, artifact kinds,
  or provider ids changed in this phase.

### DX-003: Renderer Runtime Client Consolidation

Status: complete as of 2026-05-12.

Scope:

- Move direct renderer `fetch` mutations into typed runtime clients for Console,
  Overlay, and panel modules.
- Keep UI state in renderers; keep runtime semantics in service/client modules.
- Do not add a heavy frontend framework rewrite.
- Completed first consolidation slice covers task submission/clarification,
  conversation creation/model overrides, user-memory mutations, MCP/skill
  preflight, MCP install planning, and DAG preview.

Acceptance:

- Console/Overlay no longer each own ad hoc copies of runtime mutation logic.
- Service routes used by UI have a shared client contract and tests.
- Old duplicated request helpers are removed or archived after replacement.
- Page scripts call `runtime-submission-client`,
  `runtime-user-memory-client`, and `runtime-preflight-client`; those clients
  own the runtime mutation endpoints.

Verification:

- `node scripts/verify-desktop-renderer.mjs`
- `node scripts/verify-console-runtime-client.mjs`
- `node scripts/verify-renderer-runtime-client-consolidation.mjs`
- New client contract behavior tests.

### DX-004: Keyboard-Only And A11y GUI Pass

Status: complete as of 2026-05-12.

Scope:

- Cover Settings, provider setup, approval cards, popup cards, branch controls,
  task detail, and schedule forms.
- Add real GUI smoke hooks for tab order, focus restore, Escape behavior, and
  visible labels.
- Completed slice covers Overlay task-list open/filter/Escape with native
  keyboard input, Console Settings and Schedules rail activation with visible
  labels, and approval popup reject by keyboard. Existing smoke still covers
  branch controls and task-detail/approval surfaces.

Acceptance:

- Core desktop workflows are usable with keyboard only.
- Approval/deny flows preserve focus and expose accessible names.
- Regressions fail a verifier before release.

Verification:

- `node scripts/verify-a11y-keyboard-contract.mjs`
- `npm run verify:desktop-gui-smoke`
- `node scripts/verify-user-interaction-smoke.mjs`

### DX-005: First-Run, i18n, And Preview Fidelity Completion

Status: complete as of 2026-05-12.

Scope:

- Add first-run GUI smoke for provider setup and missing-key recovery.
- Continue zh-CN/en-US extraction for Settings, task surfaces, approvals, and
  connector pages.
- Add richer incremental binary draft previews and screenshot-diff checks for
  generated document previews.
- Completed slice adds real Console first-run provider recovery coverage,
  keeps provider setup recovery copy on shared i18n contracts, and adds a real
  Preview window screenshot-diff over initial and incremental
  `generate_document` drafts.

Acceptance:

- First-run path is validated in real Electron.
- Major visible strings touched by this phase use shared i18n lookup.
- Preview draft and committed preview stay visually coherent.

Verification:

- `node scripts/verify-i18n-onboarding.mjs`
- `npm run verify:desktop-gui-smoke`
- `node scripts/verify-preview-screenshot-diff.mjs`
- `node scripts/verify-user-interaction-smoke.mjs`

## Phase D: Voice And Real Desktop Hardware

### VX-001: Real Audio Fixture And KWS Corpus

Status: complete as of 2026-05-12.

Scope:

- Add checked-in small audio fixtures for transcription and KWS, or a documented
  optional private fixture path for larger samples.
- Measure WER, empty-rate, final-chunk rate, wake false-positive, and wake
  false-negative rates.
- Completed slice adds a checked-in WAV corpus under `tests/fixtures/audio/`,
  locks hashes and PCM metadata through
  `src/service/audio/audio-fixture-corpus.mjs`, and allows larger local fixture
  directories through `LINGXY_REAL_AUDIO_FIXTURE_DIR`.

Acceptance:

- Voice quality is proven by real audio samples, not only synthetic text and
  MediaRecorder renderer paths.
- KWS near-misses and custom wake profiles remain guarded.
- Default CI remains deterministic and does not require microphone hardware,
  local Whisper, or Sherpa model downloads.

Verification:

- `node scripts/verify-voice-fixture-testbed.mjs`
- `node scripts/verify-real-audio-kws-fixtures.mjs`

### VX-002: Optional Hardware Permission Smoke

Status: complete as of 2026-05-12.

Scope:

- Add an opt-in local smoke that records from real mic hardware only when an
  explicit env flag is set.
- Keep CI deterministic by default.
- Completed slice adds `npm run verify:desktop-audio-hardware-smoke`, gated by
  `LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1`, and reuses the real Electron GUI
  smoke harness to request microphone permission and record a short
  MediaRecorder sample from hardware.

Acceptance:

- Hardware permission/capture failures produce actionable diagnostics.
- The default check suite does not hang or require hardware.
- Default `npm run check:fast` locks the opt-in contract only; hardware capture
  remains an explicit local diagnostic.

Verification:

- `node scripts/verify-desktop-audio-hardware-smoke-contract.mjs`
- `npm run verify:desktop-audio-hardware-smoke`
- `LINGXY_DESKTOP_AUDIO_HARDWARE_SMOKE=1 npm run verify:desktop-audio-hardware-smoke`

## Phase E: Generic Graph Resume, Reversibility, And True Sub-Agents

### GX-003: Generic Agent/Tool Graph Resume

Status: complete as of 2026-05-12.

Scope:

- Replace bridge-copy terminalization for generic approval pauses with same-run
  executor continuation.
- Use existing runtime graph checkpoints and approval resume metadata.
- Keep connector workflow resume behavior intact.
- Completed slice adds `src/service/scheduler/approval-graph-resume.mjs` for
  generic `agent_tool_call` approvals, emits `approval_resume_started`,
  executes the approved tool against the original task, terminalizes that task
  with `same_task_resume` events, and skips the compatibility bridge for this
  path.

Acceptance:

- Approval interruption, approval resume, rejection, retry, and cancellation
  resume the original task execution graph where possible.
- No duplicate bridge task is required for generic agent/tool runs.
- Existing approval GUI smoke still passes.
- Connector workflow approval resume remains on its existing same-task workflow
  path.

Verification:

- `node scripts/verify-approval-resume-state.mjs`
- `npm run verify:desktop-gui-smoke`
- `node --test tests/behavior/approval-resume-state.test.mjs`
- `node --test tests/behavior/task-runtime-services.test.mjs`

### RV-001: Optional Git Checkpoint Mode

Status: complete as of 2026-05-12.

Scope:

- Evaluate optional git-backed project checkpoints for file mutation tasks.
- Keep existing file-level reversibility checkpoints as the default.
- Require a project opt-in and clear rollback behavior before running git
  commands.
- Implemented opt-in only through `ctx.reversibility.gitCheckpoint.enabled`
  or `ctx.gitCheckpoint.enabled`; product behavior remains file-checkpoint
  based unless a caller explicitly enables the git mode.
- `src/service/capabilities/tools/git-checkpoint-mode.mjs` uses
  `git stash create` plus `git update-ref` to record a `stash_create_ref`
  checkpoint without mutating the worktree.

Acceptance:

- Git checkpoint mode never mutates repositories without explicit opt-in.
- Restore behavior is understandable and recoverable.
- File-level reversibility remains available when git is absent or disabled.
- Temporary-repository behavior coverage proves the default mode is off,
  opt-in preserves `git status --short`, anchors the checkpoint ref, and
  exposes a `restore_hint`.

Verification:

- `node scripts/verify-file-reversibility-checkpoint.mjs`
- `node --test tests/behavior/file-reversibility-checkpoint.test.mjs`

### SA-001: Sub-Agent Runtime Contract

Status: complete as of 2026-05-12.

Scope:

- Add a service-owned child-run contract: parent task id, child task id,
  assigned scope, isolated compiled context, allowed tools, budget, cancellation
  token, and result report.
- Start with explicit planner-selected delegation only behind a feature flag.
- Do not add unmanaged recursive agents or prompt-only delegation.
- Implemented in `src/service/core/subagents/sub-agent-runtime-contract.mjs`
  and wired as `runtime.subAgentRuntime` by runtime services.
- Architecture contract is documented in
  `docs/architecture/sub-agent-runtime-contract.md`.

Acceptance:

- Child agents cannot escape assigned tool surface, budget, task scope, or
  context scope.
- Parent task receives structured child reports and can synthesize them.
- Cancellation propagates parent -> child.
- The contract is disabled by default and rejects non-`planner_selected`
  delegation.
- No IPC channel names, HTTP routes, storage schema, tool ids, artifact kinds,
  provider ids, or model routing behavior changed.

Verification:

- `node scripts/verify-sub-agent-runtime-contract.mjs`
- `node --test tests/behavior/sub-agent-runtime-contract.test.mjs`
- Behavior tests cover disabled default, planner-selected gating, context
  isolation, tool-surface escape rejection, budget exhaustion, cancellation
  propagation, structured child reports, and runtime service wiring.

### SA-002: Sub-Agent UI, Trace, And Eval Coverage

Status: complete as of 2026-05-12.

Scope:

- Show child runs under the parent task timeline.
- Add evals for when delegation should and should not happen.
- Record per-child token/timing/tool metrics.
- Implemented shared summary in `src/shared/sub-agent-timeline-summary.mjs`.
- Console task detail renders `renderSubAgentTimelinePanel` from task detail
  `children` plus `sub_agent_report` events.
- Added `src/service/core/evals/sub-agent-delegation-corpus.mjs` to cover
  delegation-positive and delegation-negative cases.

Acceptance:

- Users can inspect what each child agent did and why.
- Delegation does not hide failures or inflate success claims.
- The UI panel does not dump raw event JSON.
- The eval corpus catches wrong delegation, unsafe tool surfaces, and forbidden
  context exposure.

Verification:

- New sub-agent eval corpus.
- `node scripts/verify-task-trace-timeline.mjs`
- `node scripts/verify-sub-agent-ui-evals.mjs`
- `node --test tests/behavior/sub-agent-timeline-evals.test.mjs`

## Phase F: Multi-Model Execution

### MM-001: Bind Model Roles To Real Call Sites

Status: complete as of 2026-05-12.

Scope:

- Use existing planner/executor/reviewer role config in actual LLM call sites.
- Start with planner/executor split for low-risk task classes.
- Record role decisions and token/timing deltas.
- Implemented `resolveProviderForModelRole` in
  `src/service/executors/shared/provider-resolver.mjs`.
- Bound `tool_using` planner and `agentic` planner to the `planner` role.
- Bound `tool_using` final composer to the `executor` role.
- `llm_usage` now includes model-role fields only when the role-aware provider
  descriptor carries them, preserving default descriptor compatibility.

Acceptance:

- Role routing changes behavior only behind a feature flag or per-task config.
- Reports can compare single-model vs role-routed runs.
- Default provider descriptors remain unchanged while role routing is disabled.

Verification:

- `node scripts/verify-model-role-routing.mjs`
- `node --test tests/behavior/model-role-routing.test.mjs`
- Related checks: `node scripts/verify-provider-routing.mjs`,
  `node scripts/verify-llm-usage-emission.mjs`, and
  `node scripts/verify-real-llm-token-metrics.mjs`.

### MM-002: Reviewer And Voting Loops

Status: complete as of 2026-05-12 for the final-answer reviewer pass. Broader
multi-candidate voting stays out of scope until measured evidence shows the
single reviewer pass is not enough.

Scope:

- Add optional reviewer pass for high-risk artifact, connector, or research
  tasks.
- Add strict budget and latency gates.
- Implemented a final-answer reviewer pass in
  `src/service/executors/tool_using/final-reviewer.mjs`.
- The pass is disabled by default and requires `reviewer_loop.enabled: true`
  from task metadata or runtime config.
- The pass binds provider calls to `resolveProviderForModelRole("reviewer",
  "reviewer", ...)` and emits `llm_usage` at
  `tool_using.final_reviewer`.
- The pass only runs when the risk profile includes artifact-required,
  connector/side-effect, research-quality, or multi-source analysis signals,
  unless explicitly configured with `mode: "always"`.
- Candidate and transcript character budgets plus a timeout gate prevent the
  reviewer from turning finalization into an unbounded second agent loop.

Acceptance:

- Reviewer cannot silently rewrite outcomes without trace evidence.
- Reviewer failures degrade gracefully.
- Reviewer `revise` or `reject` verdicts keep the candidate answer and append a
  user-facing `Accuracy check:` warning instead of leaking raw reviewer notes or
  silently replacing user-visible content.
- Reviewer start/completion/skip events expose risk reasons, duration, verdict,
  and whether a visible note was applied.

Verification:

- `node scripts/verify-final-answer-reviewer-loop.mjs`
- `node --test tests/behavior/agent-loop-final-composer.test.mjs`
- Real-LLM comparison report for targeted cases remains useful as an opt-in
  quality exercise before introducing broader multi-candidate voting.

## Phase G: Plugin, Skill, MCP Marketplace

### PM-001: Marketplace Trust Model

Status: complete as of 2026-05-12.

Scope:

- Define trusted, local-only, third-party, unsigned, disabled, and deleted states
  for skills/plugins/MCP entries.
- Add trust preview before enable/install.
- Preserve existing local-only and recoverable delete behavior.
- Implemented shared marketplace trust helpers in
  `src/service/capabilities/marketplace/trust-model.mjs`.
- Skill registry, GitHub skill staging, MCP status, and connector plugin
  registry entries now expose additive `trustPreview` metadata.
- Connector plugin registry now exposes `previewInstall()` so install UX can
  show trust state before copying plugin files.

Acceptance:

- Users can understand origin, permissions, tool surfaces, and risks before
  enabling a plugin/skill/MCP server.
- Duplicate or replaced plugin code is disabled/removed, not left as parallel
  active paths.
- Existing install, enable, route, tool id, provider id, storage schema, IPC
  channel, and HTTP route behavior remains unchanged.

Verification:

- `node scripts/verify-skill-local-only-boundary.mjs`
- `node scripts/verify-marketplace-trust-model.mjs`
- `node --test tests/behavior/marketplace-trust-model.test.mjs`

### PM-002: External MCP Governance

Status: complete as of 2026-05-12.

Scope:

- Decide whether external MCP servers may reuse OAuth tokens or must maintain
  isolated token stores.
- Keep external MCP optional and disabled by default.
- Route MCP tools through connector catalog policy, not raw agent tools.
- Decision: external MCP servers must maintain isolated token stores and must
  not reuse LingxY OAuth/account token refs.
- Implemented `src/service/capabilities/mcp/governance.mjs`.
- MCP status and registry listing now include governance metadata and mark
  forbidden shared-token refs as `governance_blocked`.
- External MCP catalog discovery skips governance-blocked servers before
  connecting to them.

Acceptance:

- External MCP tools retain confirmation, timeline, security broker, and audit
  behavior.
- Token sharing rules are explicit and testable.
- External MCP catalog entries remain `source: "external_mcp"` with
  confirmation required by default.

Verification:

- `docs/task-runtime/MCP_INTEGRATION.md`
- `node scripts/verify-mcp-governance-policy.mjs`
- `node --test tests/behavior/mcp-governance.test.mjs`

### PM-003: Sharing, Signatures, And Archive Cleanup

Status: complete as of 2026-05-12.

Scope:

- Add signing/trust metadata for shareable skills/plugins if distribution is
  enabled.
- Move replaced or deleted local installs into recoverable archive only when
  necessary; otherwise delete obsolete code.
- Implemented marketplace distribution policy in
  `src/service/capabilities/marketplace/distribution-policy.mjs`.
- Plugin preview/install/list/uninstall records now expose normalized
  `distribution.signature`, `distribution.shareable`, and
  `distribution.archive` metadata.
- Raw signature metadata remains `unverified`; only verifier-marked
  `verified: true` signatures clear unsigned third-party warnings.
- Plugin uninstall now moves installed third-party plugins into
  `<plugins>/.archive/` and removes them from active plugin roots.

Acceptance:

- No stale plugin/skill references remain after replacement.
- Archive entries are not active or discoverable as runnable tools.
- Archived plugin entries do not remain visible through `pluginRootsProvider()`
  or connector catalog reload.
- Distribution metadata is additive and does not change IPC channels, HTTP
  routes, tool ids, provider ids, or storage schema.

Verification:

- `node scripts/verify-marketplace-distribution-policy.mjs`
- `node --test tests/behavior/marketplace-distribution-policy.test.mjs`
- `node scripts/verify-plugin-registry.mjs`

## Phase H: Privacy, Sandbox, Sidecars, And Release Hardening

### SH-001: OS-Level Sandbox Decision Records

Status: complete as of 2026-05-12.

Scope:

- For file operations, external commands, browser automation, OCR, and optional
  sidecars, decide which need process isolation.
- Require measured risk/benefit before native sidecars or OS sandboxing.
- Implemented current decision inventory in
  `src/service/security/isolation-decision-records.mjs`.
- Added `docs/architecture/os-sandbox-decision-records.md`.
- Covered file operations, external commands, browser automation, OCR
  extractors, audio daemons, and MCP install sandbox.

Acceptance:

- High-risk actions have explicit isolation decisions, rollback paths, and user
  recovery behavior.
- No whole-app language rewrite.
- No new OS sandbox or native sidecar is introduced by this phase.

Verification:

- `node scripts/verify-privacy-sandbox-policy.mjs`
- `node scripts/verify-sandbox-decision-records.mjs`
- `node --test tests/behavior/isolation-decision-records.test.mjs`

### SH-002: Sidecar Decision Record Template

Status: complete as of 2026-05-12.

Scope:

- Add `docs/architecture/sidecar-decision-record.md`.
- Require a measured bottleneck, why worker/child process is insufficient,
  serialization/cancellation boundary, failure behavior, packaging impact, and
  rollback path.
- Explicitly prohibit sidecars as a general business-logic rewrite.
- Added service validator for required sidecar decision fields in
  `src/service/security/isolation-decision-records.mjs`.

Acceptance:

- No Rust/Go/Python/native sidecar can be introduced without filling the record
  and passing the verifier.
- Sidecar decisions distinguish performance isolation from security isolation.
- Required fields include measured bottleneck, worker insufficiency,
  serialization/cancellation boundaries, failure behavior, packaging impact,
  rollback path, user recovery, and explicit business-logic rewrite prohibition.

Verification:

- `node scripts/verify-sandbox-decision-records.mjs`
- `node --test tests/behavior/isolation-decision-records.test.mjs`

### SH-003: Audit Export And Policy Trace

Status: complete as of 2026-05-12.

Scope:

- Export privacy/security decisions, blocked capabilities, approvals, and tool
  risk decisions as a user-readable audit bundle.
- Implemented `src/service/security/policy-trace-export.mjs`.
- Runtime export and diagnostic bundles now include redacted `policyTrace`.
- Added `docs/architecture/security-policy-trace-export.md`.

Acceptance:

- Users can inspect what was blocked, allowed, approved, and why.
- Export does not leak secrets.
- Policy trace excludes raw tool arguments, raw context text, secret store
  values, OAuth tokens, cookies, authorization headers, passwords, and API keys.

Verification:

- `node scripts/verify-policy-trace-export.mjs`
- `node --test tests/behavior/policy-trace-export.test.mjs`

## Phase I: Observability And Quality Trends

### OQ-001: Eval Trend Store

Status: complete as of 2026-05-12.

Scope:

- Persist deterministic eval metrics across runs.
- Add trend comparisons for pass rate, blocked rate, token usage, latency, and
  top failure classes.
- Implemented `scripts/real-llm-test/trend-store.mjs`.
- `scripts/real-llm-test/run-corpus.mjs` now appends compact
  `eval-trends.jsonl` records and renders a `## Trend` report section with
  previous-run deltas.

Acceptance:

- A regression can be identified across commits without reading raw reports.
- Trend rows contain only deterministic summary metrics and top classes, not raw
  user commands, raw task reports, or final answer text.

Verification:

- `node scripts/verify-eval-quality-metrics.mjs`
- `node scripts/verify-eval-trend-store.mjs`
- `node --test tests/behavior/eval-trend-store.test.mjs`

### OQ-002: Span Taxonomy And Optional OTEL Export

Status: complete as of 2026-05-12; Network OTEL export opt-in completed as of
2026-05-12.

Scope:

- Define stable span names for routing, context, memory, graph nodes, tool calls,
  model calls, artifacts, approvals, desktop UI, and connectors.
- Add optional OTEL/export shape after local trace taxonomy stabilizes.
- Implemented `src/shared/task-span-taxonomy.mjs` as the shared phase/span name
  contract consumed by `src/shared/task-trace-summary.mjs`.
- Added a local `buildTaskSpanExport()` shape named `local_otel_span_v1`; this
  is a deterministic export shape only and does not send network telemetry.
- Added `src/shared/network-otel-config.mjs` and
  `src/service/observability/network-otel-exporter.mjs` as the service-owned
  network export path. Runtime Labs can enable it only when the user explicitly
  consents and configures an HTTP(S) OTLP trace endpoint.

Acceptance:

- Local trace remains useful without OTEL.
- Optional export does not add hot-path overhead.
- Network export is off by default, fail-soft, bounded by queue size, batched,
  and timeout guarded.
- Exported payloads contain redacted span summaries only: task id, phase, kind,
  status, label, span timing, service metadata, and no raw prompts, raw tool
  args, observations, artifact content, or final answer text.
- Span names are stable (`tool.call`, `model.call`, `artifact.event`,
  `approval.decision`, `planning.decision`, `recovery.event`,
  `runtime.lifecycle`) and verifier-locked.

Verification:

- `node scripts/verify-task-trace-timeline.mjs`
- `node scripts/verify-task-span-taxonomy.mjs`
- `node scripts/verify-network-otel-exporter.mjs`
- `node --test tests/behavior/task-span-taxonomy.test.mjs`
- `node --test tests/behavior/network-otel-exporter.test.mjs`

### OQ-003: User-Visible Planner Boundary And Current-Events Quality Gate

Status: complete as of 2026-05-12.

Trigger:

- Real run `task_c6c8b3cf-7e99-4dfb-b3c9-404547cfbf11` showed planner
  narration and raw `{"tool":"...","args":...}` protocol leaking into the
  assistant bubble while researching Raleigh events.
- The same run reached `max_iterations_reached`, had `claim_density=0`, lacked
  concrete event names/dates, and still emitted `success`.

Scope:

- Planner streaming is internal. `tool_using.planner` and `agentic.planner`
  planner deltas now emit on `reasoning_delta`, not user-visible `text_delta`.
- Renderer keeps a defense-in-depth sanitizer for embedded raw tool protocol
  JSON if any future provider path leaks it.
- `fetch_url_content` now emits content-quality metadata for boilerplate/menu
  dominated pages and marks low-quality extraction as not usable evidence.
- Success-contract substance checks reject `fetch_url_content` hits whose
  content-quality metadata says the returned page was not usable.
- Final-answer quality now has a deterministic current/local-events gate:
  after web research, recent/local event answers must provide concrete dated
  event items with time/location evidence, or downgrade to `partial_success`
  / ask for missing location before spending tool calls.
- Agentic finalization uses the same final-answer quality gate.

Acceptance:

- Planner prose/tool JSON cannot appear as assistant-visible progress.
- Menu/cookie/event-template pages do not satisfy a required external web read.
- Recent local-events tasks cannot be marked `success` when the final answer
  admits that no concrete event names/dates were found.

Verification:

- `node --test tests/behavior/success-contract-validation-spec.test.mjs tests/behavior/browser-web-tools.test.mjs tests/behavior/renderer-evidence-tool-display.test.mjs`
- `npm run check:fast`

### OQ-004: Typed Artifact Contract Tool Surface

Status: complete as of 2026-05-12.

Trigger:

- Real run `task_5b3df475-c556-485b-8392-ecb45e57ef5b` asked to turn the
  active context into an Excel artifact.
- TaskSpec and SemanticRouter correctly marked `artifact.required=true`,
  `artifact.kind=xlsx`, and `needed_capabilities=["artifact_generation"]`.
- The tool surface then re-filtered artifact tools through a live-text
  heuristic, so `generate_document` and `run_script` were hidden and planner
  calls were denied as `tool_not_available_for_task`.

Framework rule:

- Structured runtime facts win over text heuristics. TaskSpec,
  SemanticRouter `needed_capabilities`, and success contracts may expose a tool
  family. A regex over the user utterance must never veto that typed contract.
- Text heuristics may remain in intent parsing and TaskSpec construction when
  structured signals are absent or degraded, but executor tool surfaces must not
  infer artifact-write permission directly from raw text.
- Do not fix this class by adding individual words such as `excel` to a
  regex. The invariant is typed capability/contract precedence.
- This is a multilingual framework rule: adding Chinese or English keywords is
  not sufficient. Artifact intent belongs in TaskSpec/SemanticRouter typed
  fields, not in executor-local natural-language regex.

Scope:

- `tool_using` and `agentic` tool-surface artifact visibility now checks typed
  artifact requirements and typed artifact capabilities instead of
  unstructured-text artifact keyword fallbacks.
- Artifact-generation capability, artifact-required SemanticRouter decisions,
  output `artifact`, and `success_contract.artifact_created` all preserve the
  artifact writer surface.
- The old artifact-request text regex and `taskTextExplicitlyAsksForArtifact`
  gate are removed from executor tool surfaces.

Acceptance:

- Artifact-required tasks cannot hide `generate_document`, `write_file`, or
  related artifact tools merely because the live text is short, deictic, or
  lacks a file keyword.
- Hallucinated direct file-open tools remain hidden unless explicitly required.
- Regex remains acceptable for structured parsing/security/explicit-action
  detection, but not for artifact tool-family authorization at executor surface
  time.

Verification:

- `node --test tests/behavior/agent-loop-tool-surface.test.mjs`
- `node --test tests/behavior/agentic-tool-surface.test.mjs`
- `node --test tests/behavior/agent-loop-sequencing.test.mjs`
- `node scripts/verify-tool-surface-heuristic-governance.mjs`

## Recommended PR Order

1. PX-001: tracked roadmap/status hygiene.
2. RT-001: SQLite write-path audit and queue decision.
3. RT-002: session/context/artifact write budget enforcement.
4. RT-003: context trace persistence and budget audit.
5. RT-004: permission and mode model.
6. DX-001: WindowSession state machine.
7. DX-002: Electron main IPC boundary split.
8. DX-003: renderer runtime client consolidation.
9. DX-004: keyboard-only/a11y GUI pass.
10. DX-005: first-run/i18n/preview fidelity completion.
11. VX-001: real audio/KWS fixtures.
12. GX-003: generic graph resume.
13. RV-001: optional git checkpoint mode.
14. SA-001: sub-agent runtime contract.
15. SA-002: sub-agent UI/evals.
16. MM-001: bind model roles to call sites.
17. MM-002: reviewer/voting loops.
18. PM-001: marketplace trust model.
19. PM-002: external MCP governance.
20. PM-003: sharing/signatures/archive cleanup.
21. SH-001: OS sandbox decision records.
22. SH-002: sidecar decision record template.
23. SH-003: audit export and policy trace.
24. OQ-001: eval trend store.
25. OQ-002: span taxonomy and optional OTEL export.
26. OQ-003: user-visible planner boundary and current-events quality gate.
27. OQ-004: typed artifact contract tool surface.

This order intentionally completes desktop state and observability before true
sub-agents and multi-model collaboration. Sub-agents multiply failures if window
ownership, graph resume, cancellation, budgets, and traces are not already
strict.
