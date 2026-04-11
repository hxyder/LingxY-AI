import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-kimi-runtime");

// Isolate the provider resolver from the real user config — this test
// targets the *boot-time fallback* path. Without isolation, the user's
// runtime.json (which may route file_analysis to DeepSeek etc.) would cause
// resolveCodeCliRuntimeForTask to return null, short-circuiting the Kimi
// runtime we are trying to exercise here. See UCA-049.
await mkdir(runtimeDir, { recursive: true });
const isolatedConfigPath = path.join(runtimeDir, "empty-runtime.json");
await writeFile(isolatedConfigPath, "{}", "utf8");
process.env.UCA_CONFIG_PATH = isolatedConfigPath;

const { createArtifactStore } = await import("../src/service/store/artifact-store.mjs");
const { createEventBusScaffold } = await import("../src/service/core/events/event-bus.mjs");
const { createInMemoryStoreScaffold } = await import("../src/service/core/store/memory-store.mjs");
const { createTaskQueueScaffold } = await import("../src/service/core/queue/task-queue.mjs");
const { submitFileTask } = await import("../src/service/core/file-submission.mjs");
const { getKimiRuntimeStatus, resolveKimiRuntime } = await import("../src/service/ai/code_cli/kimi/runtime.mjs");

const sampleNote = path.join(repoRoot, "tests", "fixtures", "sample-note.md");

const status = getKimiRuntimeStatus();
if (!status.available || !status.configured) {
  console.log(`Real Kimi runtime verification skipped: ${status.detail}`);
  process.exit(0);
}

const kimiRuntime = resolveKimiRuntime();
assert.ok(kimiRuntime, "Kimi runtime should resolve when status is available.");

// Clean the artifact subdirs *without* touching the isolated config file.
const artifactScratch = path.join(runtimeDir, "artifacts");
await rm(artifactScratch, { recursive: true, force: true });
await mkdir(artifactScratch, { recursive: true });

const runtime = {
  store: createInMemoryStoreScaffold(),
  eventBus: createEventBusScaffold(),
  queue: createTaskQueueScaffold(),
  artifactStore: createArtifactStore({ baseDir: artifactScratch }),
  kimiRuntime
};

const result = await submitFileTask({
  filePaths: [sampleNote],
  userCommand: "Read the selected markdown file and return a concise markdown report with the first heading and one summary sentence.",
  captureMode: "shell_menu",
  sourceApp: "explorer.exe",
  runtime
});

if (result.task.status !== "success" && result.stderrPath) {
  const stdoutPath = path.join(path.dirname(result.stderrPath), "kimi.stdout.log");
  const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
  const stderr = await readFile(result.stderrPath, "utf8").catch(() => "");
  const combinedOutput = `${stdout}\n${stderr}`;
  if (combinedOutput.includes("LLM not set")) {
    console.log("Real Kimi runtime verification skipped: Kimi CLI is installed but no LLM is configured.");
    process.exit(0);
  }
  if (/usage limit|quota|billing cycle|access_terminated/i.test(combinedOutput)) {
    console.log("Real Kimi runtime verification skipped: Kimi CLI account quota is exhausted.");
    process.exit(0);
  }
}

assert.equal(result.task.status, "success");
assert.equal(result.artifacts.length, 1);
await access(result.artifacts[0].path);
const report = await readFile(result.artifacts[0].path, "utf8");
assert.match(report, /Sample Note/i);
assert.ok(runtime.store.taskEvents.some((event) => event.event_type === "artifact_created"));

console.log(`Real Kimi runtime verification passed with ${status.command} (${status.version ?? "unknown"}).`);
