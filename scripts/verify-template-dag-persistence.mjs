import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";
import { createConsoleRuntimeClient } from "../src/desktop/console/runtime-client.mjs";
import { runDagGraph } from "../src/service/dag/scheduler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-template-dag-persistence", crypto.randomUUID());

const initialPipeName = `\\\\.\\pipe\\uca-helper-template-dag-${crypto.randomUUID()}`;
const resumedPipeName = `\\\\.\\pipe\\uca-helper-template-dag-${crypto.randomUUID()}`;

const graph = {
  nodes: [
    { id: "extract", target: "browser.capture" },
    { id: "analyze", target: "kimi_cli" },
    { id: "report", target: "fast" }
  ],
  edges: [
    { from: "extract", to: "analyze" },
    { from: "analyze", to: "report" }
  ]
};

const runtime = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: initialPipeName
});

const listening = await runtime.start();

let failedExecutionId = null;

try {
  const client = createConsoleRuntimeClient(listening.baseUrl);

  const saveResult = await client.saveTemplate({
    schema_version: "1.0",
    id: "user.persisted.template",
    name: "Persisted Template",
    version: "1.0.0",
    steps: [
      {
        id: "extract",
        kind: "executor",
        target: "browser.capture"
      },
      {
        id: "summarize",
        kind: "executor",
        target: "kimi_cli"
      }
    ]
  }, "verify-template-dag-persistence");
  assert.equal(saveResult.ok, true);

  const budgetResult = await client.updateBudget({
    monthly_usd_limit: 88,
    warn_at_percent: 70
  });
  assert.equal(budgetResult.budget.limits.monthly_usd_limit, 88);

  runtime.runtime.platform.embeddingStore.add({
    id: "history-persisted-task",
    text: "模板持久化与 DAG 恢复验证样本",
    metadata: {
      summary: "平台增强验证",
      created_at: "2026-04-08T15:00:00.000Z"
    }
  });

  const failed = await runDagGraph({
    graph,
    checkpointStore: runtime.runtime.platform.dagCheckpointStore,
    async executeNode(node) {
      if (node.id === "analyze") {
        throw new Error("intentional_failure");
      }
      return {
        nodeId: node.id
      };
    }
  });
  assert.equal(failed.status, "failed");
  failedExecutionId = failed.execution_id;
} finally {
  await runtime.stop();
}

const restarted = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: resumedPipeName
});

const resumedListening = await restarted.start();

try {
  const client = createConsoleRuntimeClient(resumedListening.baseUrl);
  const templates = await client.getTemplates();
  assert.equal(templates.templates.some((template) => template.id === "user.persisted.template"), true);

  const exported = await client.exportTemplate("user.persisted.template");
  assert.equal(exported.raw.includes("\"user.persisted.template\""), true);

  const history = await client.searchHistory("DAG 恢复验证", 3);
  assert.equal(history.results.some((record) => record.id === "history-persisted-task"), true);

  const budget = await client.getBudget();
  assert.equal(budget.budget.limits.monthly_usd_limit, 88);
  assert.equal(budget.budget.limits.warn_at_percent, 70);

  const executions = await client.getDagExecutions();
  assert.equal(executions.executions.some((execution) => execution.execution_id === failedExecutionId), true);

  const resumed = await client.resumeDagExecution(failedExecutionId);
  assert.equal(resumed.execution.status, "success");
  assert.equal(resumed.execution.statuses.report, "success");

  const resumedExecution = await client.getDagExecution(failedExecutionId);
  assert.equal(resumedExecution.execution.status, "success");

  console.log("Template, history, and DAG persistence verification passed.");
} finally {
  await restarted.stop();
}
