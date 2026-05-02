import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { executeKimiTask } from "../../src/service/executors/kimi/kimi-cli-executor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mockKimiCli = path.join(repoRoot, "tests", "fixtures", "mock-kimi-cli.mjs");
const mockSlowKimiCli = path.join(repoRoot, "tests", "fixtures", "mock-slow-kimi-cli.mjs");

async function withOutputDir(fn) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-kimi-executor-"));
  try {
    return await fn(outputDir);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

function createTaskPackage(outputDir, overrides = {}) {
  return {
    task_id: "kimi-jsonl-test",
    user_command: "Analyze files and create a report",
    context: {
      file_paths: ["sample-a.md", "sample-b.txt"],
      image_paths: []
    },
    output_requirements: {
      output_dir: outputDir
    },
    ...overrides
  };
}

test("Kimi JSONL executor streams task events and artifacts from subprocess stdout", async () => {
  await withOutputDir(async (outputDir) => {
    const observedEvents = [];

    const result = await executeKimiTask({
      command: process.execPath,
      args: [mockKimiCli],
      taskPackage: createTaskPackage(outputDir),
      transport: "jsonl_task_package",
      maxRuntimeSeconds: 5,
      onEvent(event) {
        observedEvents.push(event);
      }
    });

    assert.equal(result.status, "success");
    assert.equal(result.exitCode, 0);
    assert.equal(result.exitSignal, null);
    assert.deepEqual(result.events.map((event) => event.type), [
      "accepted",
      "started",
      "step_started",
      "step_finished",
      "artifact_created",
      "success"
    ]);
    assert.deepEqual(observedEvents.map((event) => event.type), result.events.map((event) => event.type));
    assert.equal(result.artifacts.length, 1);
    assert.match(result.artifacts[0].path, /report\.md$/);
    assert.match(await readFile(result.artifacts[0].path, "utf8"), /Task: kimi-jsonl-test/);
    assert.match(result.stderrPath, /kimi\.stderr\.log$/);
  });
});

test("Kimi JSONL executor reports cancellation after subprocess timeout", async () => {
  await withOutputDir(async (outputDir) => {
    const result = await executeKimiTask({
      command: process.execPath,
      args: [mockSlowKimiCli],
      taskPackage: createTaskPackage(outputDir),
      transport: "jsonl_task_package",
      maxRuntimeSeconds: 0.2
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.exitCode !== null || result.exitSignal !== null, true);
    assert.deepEqual(result.events.map((event) => event.type), ["accepted", "started"]);
    assert.equal(result.artifacts.length, 0);
    assert.match(result.stderrPath, /kimi\.stderr\.log$/);
  });
});

test("Kimi print-mode executor writes stdout log and generated artifacts", async () => {
  await withOutputDir(async (outputDir) => {
    const observedEvents = [];
    const result = await executeKimiTask({
      command: process.execPath,
      args: [mockKimiCli],
      taskPackage: createTaskPackage(outputDir, {
        user_command: "请总结这个文件，并保存为 html 文件",
        output_requirements: {
          output_dir: outputDir,
          format_id: "html"
        }
      }),
      transport: "stream_json_print",
      maxRuntimeSeconds: 5,
      onEvent(event) {
        observedEvents.push(event);
      }
    });

    assert.equal(result.status, "success");
    assert.equal(result.exitCode, 0);
    assert.equal(result.exitSignal, null);
    assert.deepEqual(observedEvents.map((event) => event.type), [
      "accepted",
      "started",
      "step_started",
      "step_finished",
      "artifact_created",
      "success"
    ]);
    assert.equal(result.artifacts.length, 1);
    assert.match(result.artifacts[0].path, /result\.html$/);
    assert.match(await readFile(result.artifacts[0].path, "utf8"), /Mock HTML Result|Mock Report/);
    assert.match(await readFile(result.stdoutPath, "utf8"), /assistant/);
    assert.match(result.stderrPath, /kimi\.stderr\.log$/);
  });
});

test("Kimi print-mode executor reports cancellation after subprocess timeout", async () => {
  await withOutputDir(async (outputDir) => {
    const result = await executeKimiTask({
      command: process.execPath,
      args: [mockSlowKimiCli],
      taskPackage: createTaskPackage(outputDir, {
        output_requirements: {
          output_dir: outputDir,
          format_id: "markdown"
        }
      }),
      transport: "stream_json_print",
      maxRuntimeSeconds: 0.2
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.exitCode !== null || result.exitSignal !== null, true);
    assert.deepEqual(result.events.map((event) => event.type), [
      "accepted",
      "started",
      "step_started"
    ]);
    assert.equal(result.artifacts.length, 0);
    assert.match(result.stderrPath, /kimi\.stderr\.log$/);
  });
});
