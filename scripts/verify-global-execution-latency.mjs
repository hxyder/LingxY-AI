#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");
const efficiencyPlan = read("docs/architecture/global-execution-efficiency-and-cleanup-plan.md");
const architectureReadme = read("docs/architecture/README.md");
const checkManifest = read("scripts/check-manifest.mjs");
const packageJson = JSON.parse(read("package.json"));
assert.match(roadmap, /PMAT-014 global latency execution plan/u,
  "roadmap must track the PMAT-014 global latency execution plan");
assert.match(roadmap, /not a single-task micro-fix/u,
  "PMAT-014 must remain an end-to-end runtime program, not a one-off patch");
assert.match(roadmap, /Long conversation task submission now reads a bounded prior-message tail/u,
  "roadmap must record the bounded prior-message tail optimization");
assert.match(roadmap, /Planner skill context now has a shared typed relevance gate/u,
  "roadmap must record the shared skill relevance gate");
assert.match(roadmap, /SQLite task-event incremental reads are pushed into the store query/u,
  "roadmap must record store-level task-event incremental reads");
assert.match(roadmap, /Task completion history indexing now prefers already-structured/u,
  "roadmap must record structured completion-history indexing before event fallback");
assert.match(roadmap, /Live API sweep on 2026-05-15/u,
  "roadmap must record the PMAT-014 live API latency sweep");
assert.match(roadmap, /Deterministic artifact recovery is now a shared typed plan/u,
  "roadmap must record shared deterministic artifact recovery planning");
assert.match(roadmap, /PMAT-014 pre-generation latency follow-up/u,
  "roadmap must record the pre-generation latency follow-up");
assert.match(roadmap, /getConversationMessagesBefore/u,
  "roadmap must record the bounded before-trigger history contract");
assert.match(roadmap, /PMAT-014 file cleanup follow-up/u,
  "roadmap must record the PMAT-014 file cleanup follow-up");
assert.match(roadmap, /global-execution-efficiency-and-cleanup-plan\.md/u,
  "roadmap must link the global execution efficiency and cleanup plan");
assert.match(roadmap, /import\/reference sweeps/u,
  "roadmap must require reference evidence before cleanup");
assert.match(roadmap, /answer-quality work instead of treating old code as stale by\s+appearance/u,
  "roadmap must keep cleanup tied to measured efficiency and quality work");

for (const required of [
  "# Global Execution Efficiency And Cleanup Plan",
  "Benchmark Signals",
  "Efficiency Program",
  "Measurement And Evidence",
  "File Cleanup Program",
  "Large File Split Discipline",
  "Current Baseline",
  "typed, measured, bounded, and inspectable",
  "not as isolated task fixes",
  "Hot paths read bounded tails",
  "Tool surfaces are selected from TaskSpec",
  "Degraded routing exposes only required side-effect tools",
  "Final answers and generated files must not contain internal retry notes",
  "File cleanup is a separate gated track",
  "Required cleanup evidence before deleting or archiving any tracked source file",
  "Import and reference sweep across `src/`, `scripts/`, `tests/`, and `docs/`",
  "Package script, public export, IPC channel, HTTP route, tool id, artifact kind",
  "`npm run check:fast` after the cleanup",
  "Do not delete or archive",
  "Legacy code that is still imported, registered, or reachable during migration",
  "Large-file cleanup starts with ownership, then extraction, then deletion",
  "Bounded prior-message reads",
  "Store-owned incremental task-event reads",
  "Shared skill-context relevance gating",
  "Shared deterministic artifact planning",
  "A fast verifier entry at `npm run verify:global-execution-latency`"
]) {
  assert(efficiencyPlan.includes(required),
    `global efficiency cleanup plan missing required text: ${required}`);
}

assert(architectureReadme.includes("[global-execution-efficiency-and-cleanup-plan.md](global-execution-efficiency-and-cleanup-plan.md)"),
  "architecture README must link the global execution efficiency and cleanup plan");
assert.equal(packageJson.scripts?.["verify:global-execution-latency"],
  "node scripts/verify-global-execution-latency.mjs",
  "package.json must expose verify:global-execution-latency");
for (const manifestCommand of [
  "node scripts/verify-global-execution-latency.mjs"
]) {
  assert(checkManifest.includes(`CHECK_COMMANDS = Object.freeze([`) && checkManifest.includes(manifestCommand),
    `check manifest must include ${manifestCommand}`);
  assert(checkManifest.includes(`FAST_CHECK_COMMANDS = Object.freeze([`) && checkManifest.includes(manifestCommand),
    `fast check manifest must include ${manifestCommand}`);
}

const conversationLifecycle = read("src/service/core/task-runtime/conversation-lifecycle.mjs");
assert.match(conversationLifecycle, /countConversationMessages/u,
  "prior-message enrichment must use conversation counts when available");
assert.match(conversationLifecycle, /sinceSeq:\s*Math\.max\(0,\s*count\s*-\s*boundedLimit\)/u,
  "prior-message enrichment must fetch a bounded tail window");
assert.doesNotMatch(conversationLifecycle, /getConversationMessages\(conversationId\);/u,
  "task-submission prior-message enrichment must not read the broad default message window");

const skillContext = read("src/service/executors/shared/skill-context.mjs");
assert.match(skillContext, /export function shouldLoadSkillContextForTask/u,
  "skill relevance gate must live in the shared skill-context module");
assert.match(skillContext, /context_packet\?\.file_paths/u,
  "skill relevance must account for typed attached file context");

const toolUsing = read("src/service/executors/tool_using/agent-loop.mjs");
const toolUsingGate = toolUsing.indexOf("shouldLoadSkillContextForTask(task)");
const toolUsingList = toolUsing.indexOf("skillRegistries?.listSkills");
assert.ok(toolUsingGate >= 0 && toolUsingList >= 0 && toolUsingGate < toolUsingList,
  "tool_using planner must gate skill registry scans by shared typed relevance");
assert.match(toolUsing, /function startPlannerModelWaitHeartbeat/u,
  "tool_using planner must surface long provider waits as progress, not a silent gap");
assert.match(toolUsing, /waiting_for_planner_first_output/u,
  "tool_using planner heartbeat must distinguish first-output wait");
assert.match(toolUsing, /emitImmediately:\s*true/u,
  "tool_using planner must surface model-wait status immediately when the request is sent");
assert.match(toolUsing, /stopPlannerHeartbeatOnDelta\(plannerHeartbeat\)/u,
  "tool_using planner heartbeat must stop once the provider streams or returns");

const agentic = read("src/service/executors/agentic/planner.mjs");
const agenticGate = agentic.indexOf("shouldLoadSkillContextForTask(task)");
const agenticList = agentic.indexOf("skillRegistries?.listSkills");
assert.ok(agenticGate >= 0 && agenticList >= 0 && agenticGate < agenticList,
  "agentic planner must gate skill registry scans by shared typed relevance");

const deterministicArtifactPlan = read("src/service/executors/shared/deterministic-artifact-plan.mjs");
assert.match(deterministicArtifactPlan, /TEXT_FILE_KINDS = new Set\(\["md", "txt", "csv", "json"\]\)/u,
  "shared deterministic artifact plan must route ad-hoc text artifact kinds");
assert.match(deterministicArtifactPlan, /toolId: "write_file"/u,
  "shared deterministic artifact plan must materialize text artifacts through write_file");
assert.match(deterministicArtifactPlan, /Accuracy check:/u,
  "shared deterministic artifact plan must strip runtime reviewer footers before writing artifacts");
assert.match(toolUsing, /buildDeterministicArtifactPlan/u,
  "tool_using deterministic artifact recovery must use the shared artifact plan");
assert.match(agentic, /buildDeterministicArtifactPlan/u,
  "agentic deterministic artifact recovery must use the shared artifact plan");

const sqliteSchema = read("src/service/core/store/sqlite-schema.mjs");
assert.match(sqliteSchema, /idx_task_events_task_ts/u,
  "SQLite schema must index task-event incremental reads by task and timestamp");

const sqliteStore = read("src/service/core/store/sqlite-store.mjs");
assert.match(sqliteStore, /getEventsForTaskSince:\s*db\.prepare/u,
  "SQLite store must own an incremental task-event query");
assert.match(sqliteStore, /ROW_NUMBER\(\) OVER \(ORDER BY ts ASC, event_id ASC\)/u,
  "incremental task-event query must preserve stable task-event ordering");
assert.doesNotMatch(sqliteStore, /getTaskEventsSince\(taskId,\s*since\)\s*\{[\s\S]{0,180}const events = this\.getTaskEvents\(taskId\)/u,
  "SQLite getTaskEventsSince must not decode the full event log before slicing");
assert.match(sqliteStore, /listMessagesBefore:\s*db\.prepare/u,
  "SQLite store must expose a before-trigger conversation-message query");
assert.match(sqliteStore, /getConversationMessagesBefore\(conversation_id,\s*\{\s*beforeSeq/u,
  "SQLite store must publish getConversationMessagesBefore");

const historyLoader = read("src/service/executors/shared/conversation-history-loader.mjs");
assert.match(historyLoader, /STRUCTURED_HISTORY_TAIL_MESSAGE_LIMIT\s*=\s*120/u,
  "structured history loader must use a bounded tail limit");
assert.match(historyLoader, /export function loadPriorMessagesBeforeTrigger/u,
  "structured history loader must centralize before-trigger history reads");
assert.match(historyLoader, /getConversationMessagesBefore\(conversationId/u,
  "structured history loader must prefer the before-trigger store contract");
assert.doesNotMatch(historyLoader, /getConversationMessages\(conversationId\)\s*\?\?\s*\[\]/u,
  "structured history loader must not broad-read the whole conversation before model start");

const consoleRenderer = read("src/desktop/renderer/console.js");
assert.match(consoleRenderer, /event:\s*"submission_received"[\s\S]{0,120}已收到请求，正在创建任务/u,
  "Console chat must open progress at client submission before /task returns");
assert.match(consoleRenderer, /event:\s*"task_created"[\s\S]{0,160}任务已创建，正在执行/u,
  "Console chat must continue the same progress surface after task creation");
assert.match(consoleRenderer, /appendConsoleChatLiveProgress\(taskId,\s*"reasoning_delta"/u,
  "Console chat must convert live reasoning deltas into visible progress");

const taskLifecycle = read("src/service/core/task-runtime/task-lifecycle.mjs");
assert.match(taskLifecycle, /let answerText = typeof task\.result_summary === "string"/u,
  "history indexing must prefer task.result_summary before event-log fallback");
assert.match(taskLifecycle, /if \(\(!answerText \|\| artifactPaths\.length === 0\) && runtime\?\.store\?\.getTaskEvents\)/u,
  "history indexing must read task events only as a missing-structured-data fallback");

console.log("[global-execution-latency] PMAT-014 latency guardrails verified");
