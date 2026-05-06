import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { submitContextTask } from "../../src/service/core/context-submission.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createArtifactStore } from "../../src/service/store/artifact-store.mjs";

function createRuntime({ artifactRoot, executors, actionToolRegistry = null }) {
  return {
    store: createInMemoryStoreScaffold(),
    queue: {
      enqueue() { return { accepted: true, dedupedTaskId: null }; },
      markRunning() {},
      markFinished() {}
    },
    eventBus: {
      publish() {}
    },
    artifactStore: createArtifactStore({ baseDir: artifactRoot }),
    actionToolRegistry,
    executors
  };
}

async function withTempRuntime(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "linxi-artifact-fallback-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("context submission synthesizes requested html artifact from fast inline text", async () => {
  await withTempRuntime(async (artifactRoot) => {
    const runtime = createRuntime({
      artifactRoot,
      executors: [{
        id: "fast",
        async *execute() {
          yield { event_type: "inline_result", payload: { text: "# Report\n\nFast executor draft." } };
          yield { event_type: "success", payload: { text: "# Report\n\nFast executor draft." } };
        }
      }]
    });

    const { task, artifacts, taskEvents } = await submitContextTask({
      runtime,
      userCommand: "生成一个 html 文件，总结这段内容",
      executionMode: "interactive",
      executorOverride: "fast",
      skipPlanLayer: true,
      contextPacket: {
        source_type: "text",
        source_app: "uca.test",
        capture_mode: "manual",
        text: "Captured context",
        semantic_router_rejection: { kind: "skip", reason: "artifact fallback unit test" }
      }
    });

    assert.equal(task.status, "success");
    const htmlArtifact = artifacts.find((artifact) => artifact.path.endsWith(".html"));
    assert.ok(htmlArtifact);
    assert.equal(htmlArtifact.mime_type, "text/html");
    assert.ok(taskEvents.some((event) =>
      event.event_type === "artifact_created"
      && event.payload?.path === htmlArtifact.path
    ));
    const html = await readFile(htmlArtifact.path, "utf8");
    assert.match(html, /Fast executor draft/);
  });
});

test("context submission does not text-fallback when capable tool_using skips generation tool", async () => {
  await withTempRuntime(async (artifactRoot) => {
    const runtime = createRuntime({
      artifactRoot,
      actionToolRegistry: createActionToolRegistry([{
        id: "generate_document",
        name: "generate_document",
        description: "Generate a document",
        parameters: {},
        execute() {
          throw new Error("should not be called by this test");
        }
      }]),
      executors: [{
        id: "tool_using",
        async *execute() {
          yield { event_type: "inline_result", payload: { text: "# Report\n\nPlanner forgot to call the tool." } };
          yield { event_type: "success", payload: { text: "# Report\n\nPlanner forgot to call the tool." } };
        }
      }, {
        id: "fast",
        async *execute() {
          yield { event_type: "success", payload: { text: "fallback should not run" } };
        }
      }]
    });

    const { task, artifacts } = await submitContextTask({
      runtime,
      userCommand: "生成一个 html 文件，总结这段内容",
      executionMode: "interactive",
      executorOverride: "tool_using",
      skipPlanLayer: true,
      contextPacket: {
        source_type: "text",
        source_app: "uca.test",
        capture_mode: "manual",
        text: "Captured context",
        semantic_router_rejection: { kind: "skip", reason: "artifact fallback unit test" }
      }
    });

    assert.equal(task.status, "failed");
    assert.equal(task.failure_category, "missing_artifact");
    assert.deepEqual(artifacts, []);
  });
});
