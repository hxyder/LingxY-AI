import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasTimePhrase,
  shouldRunTaskPlan
} from "../src/service/core/intent/trigger.mjs";
import { triage } from "../src/service/core/intent/triage.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createSchedulerRuntime } from "../src/service/scheduler/engine.mjs";
import { createSecurityBroker } from "../src/service/security/broker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function makeRuntime() {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-intent-plan") }),
    actionToolRegistry: { list: () => [], get: () => null, call: async () => ({ success: false }) },
    toolContext: {},
    configStore: { load: () => ({}), save: () => ({}), patch: (p) => p }
  };
  runtime.securityBroker = createSecurityBroker({ runtime, config: {} });
  runtime.scheduler = createSchedulerRuntime({ runtime });
  return runtime;
}

// Front-classifier merge: triage now drives schedule/clarify/immediate
// off the SR `interpretation` field. These stubs simulate the SR
// preflight: they return an enriched contextPacket with
// `semantic_router_decision` stamped — the same shape applySemanticRouterPreflight
// returns in production after a real LLM call.
const preflightUnavailable = async ({ contextPacket }) => contextPacket ?? {};

function preflightDecision(decision) {
  return async ({ contextPacket }) => ({
    ...(contextPacket ?? {}),
    semantic_router_decision: decision
  });
}

const baseImmediate = {
  source_scope: "external_world",
  web_policy: "optional",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "single_lookup",
  primary_intent: "automation",
  domain: "general",
  user_goal: "act on user request",
  expected_output: "direct_answer",
  needs_external_info: false,
  needs_current_information: false,
  needs_user_files: false,
  needs_tool_use: true,
  needed_capabilities: ["desktop_action"],
  source_mode: "no_external",
  complexity: "low",
  risk_level: "low",
  confidence: 0.9,
  rationale_summary: "stub",
  reason: "stub"
};

const stubSchedule = (runAtMs, residual) => preflightDecision({
  ...baseImmediate,
  interpretation: "schedule",
  schedule_at: new Date(Date.now() + runAtMs).toISOString(),
  residual_command: residual
});
const stubImmediate = preflightDecision({ ...baseImmediate, interpretation: "immediate" });
const stubClarify = (question) => preflightDecision({
  ...baseImmediate,
  interpretation: "needs_clarification",
  clarification_question: question
});

// ── Trigger is only a cheap detector. It does NOT decide meaning. ──────────

assert.equal(hasTimePhrase("5 分钟后发邮件"), true);
assert.equal(
  hasTimePhrase("打开outlook，在日历里新建一个30分钟的任务，标题叫吃饭。时间在明天下午1点"),
  true,
  "task_829f8d61 regression: detector sees time phrase and defers to LLM"
);
assert.equal(hasTimePhrase("明天下午1点在日历里加一个30分钟的吃饭"), true);
assert.equal(hasTimePhrase("in 10 minutes send me a summary"), true);
assert.equal(hasTimePhrase("打开 outlook"), false);
assert.equal(hasTimePhrase("每天早上9点汇报"), false, "recurring bypasses one-shot trigger");
assert.equal(hasTimePhrase("每 5 分钟提醒我喝水"), false);
assert.equal(hasTimePhrase("every weekday at 9am"), false);
assert.equal(hasTimePhrase(""), false);
assert.equal(shouldRunTaskPlan("5 分钟后发邮件"), "time_phrase");
assert.equal(shouldRunTaskPlan("打开 outlook"), null);

// ── SR unavailable → fall through to single_turn (no schedule, no clarify) ─
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "5 分钟后给我发一份美股汇总到 a@b.com",
    contextPacket: null,
    executionMode: "interactive",
    preflight: preflightUnavailable
  });
  assert.equal(res.lane, "single_turn", "no-SR: triage must not regex-schedule");
  assert.equal(runtime.store.listSchedules().length, 0);
}

// ── task_829f8d61 regression — complex command must NOT become a schedule
//    when SR can't be reached. Core sanity check for "don't regex-classify".
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "打开outlook，在日历里新建一个30分钟的任务，标题叫吃饭。时间在明天下午1点",
    contextPacket: null,
    executionMode: "interactive",
    preflight: preflightUnavailable
  });
  assert.equal(res.lane, "single_turn", "calendar-event command must NEVER be regex-scheduled");
  assert.equal(runtime.store.listSchedules().length, 0);
}

// ── SR says "schedule" → schedule created, residual carried through ──────
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "5 分钟后给我发一份美股汇总到 a@b.com",
    contextPacket: null,
    executionMode: "interactive",
    preflight: stubSchedule(5 * 60 * 1000, "搜美股最新消息汇总并用 Gmail 发给 a@b.com")
  });
  assert.equal(res.lane, "schedule", "schedule interpretation must create a schedule");
  assert.equal(res.schedule.trigger_type, "at");
  const stored = runtime.store.getSchedule(res.schedule.schedule_id);
  assert.ok(stored.action_params.userCommand.includes("美股"), "residual carried through");
  assert.equal(res.task.sub_status, "scheduled");
}

// ── SR says "immediate" → triage falls through to single_turn ─────────────
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "打开outlook，在日历里新建一个30分钟的任务，标题叫吃饭。时间在明天下午1点",
    contextPacket: null,
    executionMode: "interactive",
    preflight: stubImmediate
  });
  assert.equal(res.lane, "single_turn", "immediate interpretation must fall through to normal executor");
  assert.equal(runtime.store.listSchedules().length, 0, "no schedule created for event-time-as-data");
}

// ── SR asks for clarification → rendered as a clarify task ────────────────
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "5 分钟后帮我在outlook的日历里新建一个任务",
    contextPacket: null,
    executionMode: "interactive",
    preflight: stubClarify("请问你想把任务加到哪个日历？")
  });
  assert.equal(res.lane, "clarify");
  assert.equal(res.task.sub_status, "clarify");
  assert.ok(res.message.includes("哪个日历"), `clarification surfaced: ${res.message}`);
}

// ── Attachments survive into the scheduled-run params ─────────────────────
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "10 分钟后把这张图发给 a@b.com",
    contextPacket: {
      file_paths: ["C:\\temp\\photo.jpg"],
      image_paths: ["C:\\temp\\photo.jpg"]
    },
    executionMode: "interactive",
    preflight: stubSchedule(10 * 60 * 1000, "把这张图发给 a@b.com")
  });
  assert.equal(res.lane, "schedule");
  const stored = runtime.store.getSchedule(res.schedule.schedule_id);
  assert.deepEqual(stored.action_params.file_paths, ["C:\\temp\\photo.jpg"]);
}

// ── single_turn carries the enriched packet so context-submission's
//    preflight short-circuits. Without this, the front-classifier merge
//    regresses to two LLM calls again.
{
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "请帮我整理这段文字",
    contextPacket: { text: "hello world" },
    executionMode: "interactive",
    preflight: stubImmediate
  });
  assert.equal(res.lane, "single_turn");
  assert.ok(res.contextPacket?.semantic_router_decision,
    "single_turn lane must surface the SR decision so downstream preflight can skip");
}

// ── Background mode: when there's no time phrase, triage MUST NOT call SR.
//    Background submissions (overlay/console chat) need task_created emitted
//    fast; the SR call is deferred to execute(). A regression here is what
//    made Phase 1's first cut feel slower than baseline.
{
  let preflightCalled = 0;
  const trackedPreflight = async ({ contextPacket }) => {
    preflightCalled += 1;
    return { ...(contextPacket ?? {}), semantic_router_decision: { ...baseImmediate, interpretation: "immediate" } };
  };
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "请帮我整理这段文字",
    contextPacket: { text: "hello world" },
    executionMode: "interactive",
    background: true,
    preflight: trackedPreflight
  });
  assert.equal(res.lane, "single_turn", "background non-time command must default to single_turn");
  assert.equal(preflightCalled, 0, "background non-time command must NOT call SR preflight");
  assert.equal(res.contextPacket?.semantic_router_decision, undefined,
    "background fast-exit packet must not carry SR decision (executor will run preflight in execute())");
}

// ── Background mode: time-phrase commands STILL run SR — schedule
//    detection is worth the latency since the alternative is mis-routing
//    "5 分钟后..." to single_turn and acting on it now.
{
  let preflightCalled = 0;
  const trackedPreflight = async ({ contextPacket }) => {
    preflightCalled += 1;
    return {
      ...(contextPacket ?? {}),
      semantic_router_decision: {
        ...baseImmediate,
        interpretation: "schedule",
        schedule_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        residual_command: "发美股汇总到 a@b.com"
      }
    };
  };
  const runtime = makeRuntime();
  const res = await triage({
    runtime,
    userCommand: "5 分钟后给我发一份美股汇总到 a@b.com",
    contextPacket: null,
    executionMode: "interactive",
    background: true,
    preflight: trackedPreflight
  });
  assert.equal(preflightCalled, 1, "background + time phrase must still consult SR");
  assert.equal(res.lane, "schedule");
}

console.log("Intent triage (front-classifier merge) verification passed.");
