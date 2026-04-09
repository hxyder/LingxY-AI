import assert from "node:assert/strict";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { submitFileTask } from "../src/service/core/file-submission.mjs";
import { getKimiRuntimeStatus, resolveKimiRuntime } from "../src/service/ai/code_cli/kimi/runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-kimi-runtime");
const sampleNote = path.join(repoRoot, "tests", "fixtures", "sample-note.md");

const status = getKimiRuntimeStatus();
if (!status.available || !status.configured) {
  console.log(`Real Kimi runtime verification skipped: ${status.detail}`);
  process.exit(0);
}

const kimiRuntime = resolveKimiRuntime();
assert.ok(kimiRuntime, "Kimi runtime should resolve when status is available.");

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });

const runtime = {
  store: createInMemoryStoreScaffold(),
  eventBus: createEventBusScaffold(),
  queue: createTaskQueueScaffold(),
  artifactStore: createArtifactStore({ baseDir: runtimeDir }),
  kimiRuntime
};

const result = await submitFileTask({
  filePaths: [sampleNote],
  userCommand: "Read the selected markdown file and return a concise markdown report with the first heading and one summary sentence.",
  captureMode: "shell_menu",
  sourceApp: "explorer.exe",
  runtime
});

assert.equal(result.task.status, "success");
assert.equal(result.artifacts.length, 1);
await access(result.artifacts[0].path);
const report = await readFile(result.artifacts[0].path, "utf8");
assert.match(report, /Sample Note/i);
assert.ok(runtime.store.taskEvents.some((event) => event.event_type === "artifact_created"));

console.log(`Real Kimi runtime verification passed with ${status.command} (${status.version ?? "unknown"}).`);
