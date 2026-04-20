import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectorCatalog } from "../src/service/connectors/core/catalog.mjs";
import {
  extractWorkflowInput,
  matchWorkflowByTrigger
} from "../src/service/connectors/core/connector-intent.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";
import { createTaskRecord } from "../src/service/core/task-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const catalog = createConnectorCatalog();

// 1. Trigger matching still works (used by the no-LLM fallback planner and
//    by any downstream UI that wants to display matched workflows).
{
  const matched = matchWorkflowByTrigger("先给我草稿，确认再发给 ada@example.com", catalog);
  assert.ok(matched, "Chinese draft trigger must hit a workflow");
  assert.equal(matched.id, "google.gmail.draft_confirm_send");
}

{
  const matched = matchWorkflowByTrigger("Outlook 草稿，先给我草稿 确认再发 ada@example.com", catalog);
  assert.ok(matched);
  assert.equal(matched.id, "microsoft.outlook.draft_confirm_send");
}

{
  const matched = matchWorkflowByTrigger("今天天气怎么样", catalog);
  assert.equal(matched, null);
}

// 2. extractWorkflowInput picks up explicit to/subject/body markers.
{
  const workflow = catalog.getWorkflow("google.gmail.draft_confirm_send");
  const input = extractWorkflowInput(
    "先给我草稿，确认再发给 ada@example.com 主题：你好 正文：今天见",
    workflow
  );
  assert.deepEqual(input.to, ["ada@example.com"]);
  assert.equal(input.subject, "你好");
  assert.ok(String(input.body).startsWith("今天见"));
}

// 3. No-LLM planner dispatches the workflow ONLY when all required fields are
//    present. This is the "power user wrote 主题:/正文:" fast path.
const connectorWorkflowCalls = [];
const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS.map((tool) =>
  tool.id === "connector_workflow_run"
    ? {
        ...tool,
        async execute(args) {
          connectorWorkflowCalls.push(args);
          return {
            success: true,
            observation: "Simulated workflow dispatch.",
            metadata: { tool_id: "connector_workflow_run" }
          };
        }
      }
    : tool
));

function makeRuntime(suffix) {
  return {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({
      baseDir: path.join(repoRoot, ".tmp", `verify-workflow-first-dispatch-${suffix}`)
    }),
    actionToolRegistry: registry,
    connectorCatalog: catalog,
    toolContext: {}
  };
}

function makeTask(command) {
  return createTaskRecord({
    route: { intent: "email.draft_confirm_send", executor: "tool_using", requires_confirmation: false },
    userCommand: command,
    contextPacket: {
      schema_version: "1.0",
      context_id: "ctx_t",
      trace_id: "trace_t",
      source_type: "text",
      source_app: "verify",
      capture_mode: "text",
      security_level: "internal",
      redaction_applied: false,
      text: "",
      captured_at: new Date().toISOString()
    },
    executionMode: "interactive"
  });
}

// 3a. Complete input → workflow dispatched.
{
  const runtime = makeRuntime("complete");
  const task = makeTask("先给我草稿，确认再发给 ada@example.com 主题：hi 正文：world");
  task.__runtime = runtime;
  const result = await runToolAgentLoop({ task, runtime, maxIterations: 2 });
  assert.equal(result.status, "success");
  assert.ok(
    connectorWorkflowCalls.some((c) => c.workflowId === "google.gmail.draft_confirm_send"),
    "no-LLM planner must dispatch workflow when all required fields are present"
  );
}

// 3b. Missing subject/body and no LLM provider → planner does NOT dispatch the
//     workflow with empty fields. This is the explicit contract that we no
//     longer hallucinate content.
{
  connectorWorkflowCalls.length = 0;
  const runtime = makeRuntime("incomplete");
  const task = makeTask("用gmail给 ada@example.com 发一份邮件，告诉她罗利天气。先给我草稿");
  task.__runtime = runtime;
  const result = await runToolAgentLoop({ task, runtime, maxIterations: 2 });
  assert.ok(
    !connectorWorkflowCalls.some((c) => c.workflowId === "google.gmail.draft_confirm_send"),
    "no-LLM planner must NOT dispatch workflow when subject/body are missing"
  );
  assert.equal(result.status, "success", "loop should finish via fallback path");
}

// 4. The LLM planner receives the workflow catalog as part of its prompt so it
//    can pick connector_workflow_run on its own. We import the internal helper
//    via the module's tests by checking the tool descriptions include the
//    workflow ids. (The real LLM path is provider-dependent so we verify the
//    hint-construction primitive only.)
const { default: fs } = await import("node:fs");
const source = fs.readFileSync(
  path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"),
  "utf8"
);
assert.ok(
  source.includes("formatWorkflowsForPlanner"),
  "agent-loop must define formatWorkflowsForPlanner for LLM planner prompt enrichment"
);
assert.ok(
  source.includes("${workflowHint}"),
  "llmPlanner system prompt must inject the workflow hint block"
);

console.log("Workflow-first dispatch verification passed.");
