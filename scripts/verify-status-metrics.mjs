import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskDetailViewModel } from "../src/desktop/console/task-detail/view-model.mjs";
import { buildConsoleFiltersViewModel } from "../src/desktop/console/filters/view-model.mjs";
import { createConsoleViewModel } from "../src/desktop/console/view-model.mjs";
import { submitBrowserTask } from "../src/service/core/browser-submission.mjs";
import { submitFileTask } from "../src/service/core/file-submission.mjs";
import { submitImageTask } from "../src/service/core/image-submission.mjs";
import { cancelTask } from "../src/service/core/task-runtime.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskEventStream, encodeSseFrame } from "../src/service/events/sse.mjs";
import { classifyFailure } from "../src/service/failures/classifier.mjs";
import { createMetricsRegistry } from "../src/service/metrics/registry.mjs";
import { retryTask } from "../src/service/retry/retry-manager.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createFastExecutorScaffold } from "../src/service/executors/fast/fast-executor.mjs";
import { createMultiModalExecutorScaffold } from "../src/service/executors/multi_modal/multi-modal-executor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-status-metrics");
const failingCli = path.join(repoRoot, "tests", "fixtures", "mock-failing-kimi-cli.mjs");
const slowCli = path.join(repoRoot, "tests", "fixtures", "mock-slow-kimi-cli.mjs");
const sampleNote = path.join(repoRoot, "tests", "fixtures", "sample-note.md");
const sampleImage = path.join(runtimeDir, "sample-capture.png");

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
await mkdir(path.dirname(sampleImage), { recursive: true });
await writeFile(sampleImage, "placeholder image bytes", "utf8");

function createRuntime(name, extras = {}) {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(runtimeDir, name) }),
    executors: [createFastExecutorScaffold(), createMultiModalExecutorScaffold()],
    ...extras
  };
  runtime.metrics = createMetricsRegistry({
    store: runtime.store,
    queue: runtime.queue
  });
  return runtime;
}

async function waitForTaskStatus(runtime, expectedStatus, timeoutMs = 500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const matched = runtime.store.listTasks().find((task) => task.status === expectedStatus);
    if (matched) {
      return matched;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

const baseRuntime = createRuntime("base");

const browserResult = await submitBrowserTask({
  capture: {
    sourceType: "text_selection",
    browser: "chrome.exe",
    url: "https://example.com",
    pageTitle: "Example",
    text: "phase two browser selection"
  },
  userCommand: "请总结这段网页内容",
  runtime: baseRuntime
});

assert.equal(browserResult.task.status, "success");

const browserRetryResult = await retryTask({
  taskId: browserResult.task.task_id,
  runtime: baseRuntime,
  mode: "retry_same"
});
assert.equal(browserRetryResult.task.parent_task_id, browserResult.task.task_id);
assert.equal(browserRetryResult.task.retry_count, 1);

const imageResult = await submitImageTask({
  imagePaths: [sampleImage],
  userCommand: "请分析这张截图",
  source: "screenshot",
  runtime: baseRuntime
});
assert.equal(imageResult.task.status, "success");

const imageRetryResult = await retryTask({
  taskId: imageResult.task.task_id,
  runtime: baseRuntime,
  mode: "retry_same"
});
assert.equal(imageRetryResult.task.parent_task_id, imageResult.task.task_id);

const failingRuntime = createRuntime("failing", {
  kimiRuntime: {
    command: process.execPath,
    args: [failingCli],
    env: process.env,
    maxRuntimeSeconds: 5
  }
});

const failedFileResult = await submitFileTask({
  filePaths: [sampleNote],
  userCommand: "分析这些文件并生成详细报告",
  runtime: failingRuntime
});

assert.equal(failedFileResult.task.status, "failed");
assert.equal(failedFileResult.task.failure_category, "cli_execution_error");
assert.equal(Boolean(failedFileResult.task.failure_user_message), true);

const slowRuntime = createRuntime("slow", {
  kimiRuntime: {
    command: process.execPath,
    args: [slowCli],
    env: process.env,
    maxRuntimeSeconds: 5
  }
});

const slowPromise = submitFileTask({
  filePaths: [sampleNote],
  userCommand: "分析这些文件并生成详细报告",
  runtime: slowRuntime
});
const runningTask = await waitForTaskStatus(slowRuntime, "running", 1000);
assert.ok(runningTask);
await cancelTask({
  runtime: slowRuntime,
  taskId: runningTask.task_id
});
const cancelledResult = await slowPromise;
assert.equal(cancelledResult.task.status, "cancelled");

const stream = createTaskEventStream({
  store: baseRuntime.store,
  eventBus: baseRuntime.eventBus,
  taskId: browserResult.task.task_id,
  since: null
});
assert.ok(stream.replay.length >= 2);
assert.match(encodeSseFrame(stream.replay[0]), /^id: /);

const metrics = baseRuntime.metrics.snapshot();
assert.equal(metrics.task_total >= 2, true);
assert.equal(typeof metrics.failure_rate, "number");
assert.match(baseRuntime.metrics.renderPrometheus(), /uca_queue_depth/);

const consoleVm = createConsoleViewModel();
assert.ok(consoleVm.summaryCards.includes("today_success"));
const detailVm = buildTaskDetailViewModel(
  browserResult.task,
  baseRuntime.store.getTaskEvents(browserResult.task.task_id),
  []
);
assert.ok(detailVm.timeline.length >= 2);
const filtersVm = buildConsoleFiltersViewModel(baseRuntime.store.listTasks());
assert.ok(filtersVm.status.includes("success"));

const timeoutFailure = classifyFailure({
  code: "ETIMEDOUT",
  message: "timeout while waiting for model"
});
assert.equal(timeoutFailure.category, "timeout");

console.log("Status, retry, cancellation, and metrics verification passed.");
