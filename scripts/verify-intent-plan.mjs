import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasTimePhrase,
  shouldRunTaskPlan
} from "../src/service/core/intent/trigger.mjs";
import { maybeHandleAsPlan } from "../src/service/core/intent/plan-executor.mjs";
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

const stubUnavailable = async () => null;
const stubSchedule = (runAtMs, residual) => async () => ({
  interpretation: "schedule",
  schedule_at: new Date(Date.now() + runAtMs).toISOString(),
  residual_command: residual
});
const stubImmediate = async () => ({ interpretation: "immediate" });
const stubClarify = (question) => async () => ({
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

// ── LLM unavailable → fall through, no schedule created ────────────────────
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "5 分钟后给我发一份美股汇总到 a@b.com",
    contextPacket: null,
    executionMode: "interactive",
    understand: stubUnavailable
  });
  assert.equal(res, null, "no-LLM: plan layer must not regex-schedule");
  assert.equal(runtime.store.listSchedules().length, 0);
}

// ── task_829f8d61 regression — complex command must NOT become a schedule
//    when the LLM can't be reached. This is the core sanity check for "don't
//    regex-classify".
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "打开outlook，在日历里新建一个30分钟的任务，标题叫吃饭。时间在明天下午1点",
    contextPacket: null,
    executionMode: "interactive",
    understand: stubUnavailable
  });
  assert.equal(res, null, "calendar-event command must NEVER be regex-scheduled");
  assert.equal(runtime.store.listSchedules().length, 0);
}

// ── Non-trigger commands bypass the plan path entirely ─────────────────────
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "打开 outlook",
    contextPacket: null,
    executionMode: "interactive",
    understand: stubUnavailable
  });
  assert.equal(res, null);
}

// ── LLM says "schedule" → schedule created, residual carried through ──────
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "5 分钟后给我发一份美股汇总到 a@b.com",
    contextPacket: null,
    executionMode: "interactive",
    understand: stubSchedule(5 * 60 * 1000, "搜美股最新消息汇总并用 Gmail 发给 a@b.com")
  });
  assert.ok(res?.handled, "schedule interpretation must create a schedule");
  assert.equal(res.schedule.trigger_type, "at");
  const stored = runtime.store.getSchedule(res.schedule.schedule_id);
  assert.ok(stored.action_params.userCommand.includes("美股"), "residual carried through");
  assert.equal(res.task.sub_status, "scheduled");
}

// ── LLM says "immediate" → plan layer falls through (task_829f8d61 fix) ────
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "打开outlook，在日历里新建一个30分钟的任务，标题叫吃饭。时间在明天下午1点",
    contextPacket: null,
    executionMode: "interactive",
    understand: stubImmediate
  });
  assert.equal(res, null, "immediate interpretation must fall through to normal executor");
  assert.equal(runtime.store.listSchedules().length, 0, "no schedule created for event-time-as-data");
}

// ── LLM asks for clarification → rendered as a task record with question ──
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "5 分钟后帮我在outlook的日历里新建一个任务",
    contextPacket: null,
    executionMode: "interactive",
    understand: stubClarify("请问你想把任务加到哪个日历？")
  });
  assert.ok(res?.handled);
  assert.equal(res.task.sub_status, "clarify");
  assert.ok(res.message.includes("哪个日历"), `clarification surfaced: ${res.message}`);
}

// ── Attachments survive into the scheduled-run params ─────────────────────
{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "10 分钟后把这张图发给 a@b.com",
    contextPacket: {
      file_paths: ["C:\\temp\\photo.jpg"],
      image_paths: ["C:\\temp\\photo.jpg"]
    },
    executionMode: "interactive",
    understand: stubSchedule(10 * 60 * 1000, "把这张图发给 a@b.com")
  });
  assert.ok(res?.handled);
  const stored = runtime.store.getSchedule(res.schedule.schedule_id);
  assert.deepEqual(stored.action_params.file_paths, ["C:\\temp\\photo.jpg"]);
}

console.log("Intent plan layer (Week 1-revised — trigger only detects, LLM decides) verification passed.");
