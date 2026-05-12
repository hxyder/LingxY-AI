import assert from "node:assert/strict";
import test from "node:test";

import { submitConnectorWorkflowTask } from "../../src/service/capabilities/connectors/core/workflow-submission.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";

function createRuntime({ workflow }) {
  const enqueued = [];
  return {
    enqueued,
    store: createInMemoryStoreScaffold(),
    queue: {
      enqueue(task) {
        enqueued.push(task.task_id);
        return { accepted: true, dedupedTaskId: null };
      },
      markRunning() {},
      markFinished() {}
    },
    eventBus: {
      publish() {}
    },
    executors: [],
    connectorCatalog: {
      getWorkflow(workflowId) {
        return workflowId === workflow.id ? workflow : null;
      },
      getTool() {
        return null;
      },
      validateOutput() {
        return { ok: true, failures: [] };
      }
    }
  };
}

test("connector workflow submission declares workflow boundary context and audit", async () => {
  const workflow = {
    id: "demo.workflow.noop",
    name: "Noop workflow",
    provider: "demo",
    service: "demo.workflow",
    steps: []
  };
  const runtime = createRuntime({ workflow });

  const result = await submitConnectorWorkflowTask({
    runtime,
    workflowId: workflow.id,
    userCommand: "Run connector workflow"
  });

  assert.equal(result.task.status, "success");
  assert.equal(result.task.submission_boundary.submission_kind, "connector_workflow");
  assert.deepEqual(result.task.submission_boundary.requested_tools, ["connector_workflow_run"]);
  assert.deepEqual(result.task.submission_boundary.requested_workflows, [workflow.id]);

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.submission_kind, "connector_workflow");
  assert.deepEqual(audit.payload.requested_workflows, [workflow.id]);
});

test("connector workflow submission blocks workflow tools forbidden by task policy", async () => {
  const workflow = {
    id: "demo.workflow.web_read",
    name: "Web-read workflow",
    provider: "demo",
    service: "demo.workflow",
    steps: [
      { id: "read_web", tool: "web_search" }
    ]
  };
  const runtime = createRuntime({ workflow });

  const result = await submitConnectorWorkflowTask({
    runtime,
    workflowId: workflow.id,
    userCommand: "不要联网，运行这个工作流"
  });

  assert.equal(result.blocked, true);
  assert.equal(result.task.status, "failed");
  assert.equal(result.task.submission_boundary.decision, "block");
  assert.deepEqual(result.task.submission_boundary.requested_tools, ["connector_workflow_run", "web_search"]);
  assert.deepEqual(result.task.submission_boundary.blocked_tools.map((tool) => tool.tool_id), ["web_search"]);
  assert.deepEqual(runtime.enqueued, []);

  const created = result.taskEvents.find((event) => event.event_type === "task_created");
  assert.equal(created, undefined);

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.decision, "block");
  assert.deepEqual(audit.payload.blocked_tools.map((tool) => tool.tool_id), ["web_search"]);
});
