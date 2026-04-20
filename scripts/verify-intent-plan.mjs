import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectTimeOffset, shouldRunTaskPlan } from "../src/service/core/intent/trigger.mjs";
import { maybeHandleAsPlan } from "../src/service/core/intent/plan-executor.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createSchedulerRuntime } from "../src/service/scheduler/engine.mjs";
import { createSecurityBroker } from "../src/service/security/broker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ── trigger detector ───────────────────────────────────────────────────────

{
  // Relative one-shot
  const d = detectTimeOffset("5 分钟后给我发一份美股汇总到 a@b.com");
  assert.ok(d, "relative one-shot must fire");
  assert.equal(d.trigger.type, "at");
  assert.ok(d.trigger.run_at, "trigger has run_at");
  assert.ok(d.residualCommand.includes("给我发"), `residual preserves meat, got: ${d.residualCommand}`);
  assert.ok(!d.residualCommand.includes("5 分钟后"), "residual strips the offset");
}

{
  // Absolute one-shot
  const d = detectTimeOffset("明天上午9点提醒我交报告");
  assert.ok(d, "absolute one-shot must fire");
  assert.equal(d.trigger.type, "at");
  assert.ok(d.residualCommand.includes("提醒我交报告"), `got: ${d.residualCommand}`);
}

{
  // English phrasing
  const d = detectTimeOffset("in 10 minutes send me a summary");
  assert.ok(d, "English one-shot must fire");
  assert.equal(d.trigger.type, "at");
  assert.ok(d.residualCommand.toLowerCase().includes("send me a summary"), `got: ${d.residualCommand}`);
}

{
  // Recurring must NOT fire — those are existing scheduler territory
  assert.equal(detectTimeOffset("每 5 分钟提醒我喝水"), null, "every N minutes must bypass one-shot detector");
  assert.equal(detectTimeOffset("每天早上9点汇报"), null, "daily must bypass one-shot detector");
  assert.equal(detectTimeOffset("每周一开始周会"), null, "weekly must bypass one-shot detector");
  assert.equal(detectTimeOffset("every weekday at 9am"), null, "every-weekday must bypass");
}

{
  // Plain commands shouldn't fire
  assert.equal(detectTimeOffset("打开 outlook"), null);
  assert.equal(detectTimeOffset("给 a@b.com 发封邮件"), null);
  assert.equal(detectTimeOffset(""), null);
}

{
  // shouldRunTaskPlan is the public gate — same behaviour at Week 1
  assert.equal(shouldRunTaskPlan("5 分钟后发邮件"), "time_offset");
  assert.equal(shouldRunTaskPlan("打开 outlook"), null);
}

// ── plan-executor happy path ───────────────────────────────────────────────

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

{
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "5 分钟后给我发一份美股最新消息汇总到 a@b.com",
    contextPacket: null,
    executionMode: "interactive"
  });
  assert.ok(res?.handled, "plan layer must handle time-offset command");
  assert.ok(res.schedule?.schedule_id, "schedule was created");
  assert.equal(res.schedule.trigger_type, "at");
  assert.ok(res.schedule.trigger_config.run_at, "run_at stored on schedule");
  assert.equal(res.task.status, "success");
  assert.equal(res.task.sub_status, "scheduled");
  assert.ok(res.message.includes("5 分钟后") || res.message.includes("分钟后"), `reply wording: ${res.message}`);
  // Schedule action params carry the residual userCommand so the scheduled
  // run actually knows what to do.
  const action = runtime.store.getSchedule(res.schedule.schedule_id);
  assert.ok(action.action_params?.userCommand?.includes("发一份美股最新消息汇总"), `action.userCommand: ${JSON.stringify(action.action_params)}`);
}

{
  // Non-triggered command: plan layer returns null, caller falls through.
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "打开 outlook",
    contextPacket: null,
    executionMode: "interactive"
  });
  assert.equal(res, null, "plain commands pass through to normal router");
}

{
  // User typed only the offset phrase with nothing to run → also passes
  // through so the LLM can ask for clarification.
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "5 分钟后",
    contextPacket: null,
    executionMode: "interactive"
  });
  assert.equal(res, null, "offset-only commands fall through for clarification");
}

{
  // Attachments on the original command survive into the scheduled task
  // params so the fire-time executor can still see them.
  const runtime = makeRuntime();
  const res = await maybeHandleAsPlan({
    runtime,
    userCommand: "10 分钟后把这张图片发给 a@b.com",
    contextPacket: {
      file_paths: ["C:\\temp\\photo.jpg"],
      image_paths: ["C:\\temp\\photo.jpg"]
    },
    executionMode: "interactive"
  });
  assert.ok(res?.handled);
  const action = runtime.store.getSchedule(res.schedule.schedule_id);
  assert.deepEqual(action.action_params.file_paths, ["C:\\temp\\photo.jpg"]);
  assert.deepEqual(action.action_params.image_paths, ["C:\\temp\\photo.jpg"]);
}

console.log("Intent plan layer (Week 1 — time-offset) verification passed.");
