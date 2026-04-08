import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { submitCommand } from "../uca-cli/src/submit.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { submitFileTask } from "../src/service/core/file-submission.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-file-kimi");
const sampleNote = path.join(repoRoot, "tests", "fixtures", "sample-note.md");
const sampleText = path.join(repoRoot, "tests", "fixtures", "sample-text.txt");
const mockCli = path.join(repoRoot, "tests", "fixtures", "mock-kimi-cli.mjs");

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });

const runtime = {
  store: createInMemoryStoreScaffold(),
  eventBus: createEventBusScaffold(),
  queue: createTaskQueueScaffold(),
  artifactStore: createArtifactStore({ baseDir: runtimeDir }),
  kimiRuntime: {
    command: process.execPath,
    args: [mockCli],
    env: process.env,
    maxRuntimeSeconds: 30
  }
};

const transport = {
  async submitContextAndTask(payload) {
    return submitFileTask({
      filePaths: payload.task.filePaths,
      userCommand: payload.task.userCommand,
      captureMode: payload.source.captureMode,
      sourceApp: payload.source.sourceApp,
      runtime
    });
  }
};

const result = await submitCommand(
  [
    "submit",
    "--files",
    sampleNote,
    sampleText,
    "--command",
    "分析这些文件并生成详细报告",
    "--batch-key",
    "verify-file-kimi"
  ],
  transport
);

assert.equal(result.accepted, true);
assert.equal(result.mode, "file_group");
assert.equal(result.response.task.executor, "kimi");
assert.equal(result.response.task.context_packet.source_type, "file_group");
assert.equal(result.response.task.status, "success");
assert.equal(result.response.artifacts.length, 1);
assert.match(result.response.artifacts[0].path, /report\.md$/);
assert.ok(runtime.store.taskEvents.some((event) => event.event_type === "artifact_created"));

console.log("File entry and Kimi bridge verification passed.");
