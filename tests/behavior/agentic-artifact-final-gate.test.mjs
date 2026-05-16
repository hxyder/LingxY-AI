import assert from "node:assert/strict";
import test from "node:test";

import { runAgenticPlanner } from "../../src/service/executors/agentic/planner.mjs";

function makeArtifactTask() {
  return {
    task_id: "task_agentic_artifact_final_gate",
    user_command: "Create a docx report.",
    task_spec: {
      goal: "generate_document",
      artifact: { required: true, kind: "docx" },
      success_contract: {
        artifact_created: true,
        required_policy_groups: [],
        required_tool_names: []
      }
    }
  };
}

function makeCurrentSpecMissingArtifactTask() {
  const task = makeArtifactTask();
  return {
    ...task,
    task_spec: {
      goal: "qa",
      synthesis: { expected_output: "direct_answer" }
    },
    task_spec_initial: task.task_spec
  };
}

function makeRegistry(tool) {
  return {
    list() {
      return [tool];
    },
    get(id) {
      return id === tool.id ? tool : null;
    }
  };
}

test("agentic final gate materializes prose-only artifact tasks before final answer", async () => {
  const calls = [];
  const events = [];
  const auditLog = [];
  const tool = {
    id: "generate_document",
    name: "Generate Document",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        outline: { type: "object" }
      }
    },
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: "DOCX generated.",
        artifact_paths: ["E:/linxiDoc/task_agentic_artifact_final_gate/result.docx"],
        metadata: {
          path: "E:/linxiDoc/task_agentic_artifact_final_gate/result.docx",
          artifact_paths: ["E:/linxiDoc/task_agentic_artifact_final_gate/result.docx"]
        }
      };
    }
  };
  const adapter = {
    supportsStreaming: false,
    async generate() {
      return { text: "Here is the report content, but no file yet.", tool_calls: [] };
    }
  };

  const result = await runAgenticPlanner({
    task: makeArtifactTask(),
    runtime: {
      actionToolRegistry: makeRegistry(tool),
      store: {
        appendAuditLog(entry) {
          auditLog.push(entry);
        }
      },
      toolContext: {}
    },
    adapterOverride: adapter,
    onEvent(event) {
      events.push(event);
    },
    maxIterations: 4
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "docx");
  assert.deepEqual(result.artifactPaths, ["E:/linxiDoc/task_agentic_artifact_final_gate/result.docx"]);
  assert.ok(events.some((event) =>
    event.event_type === "tool_call_proposed"
    && event.payload?.tool_id === "generate_document"
    && event.payload?.source === "agentic_deterministic_artifact_obligation"
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool.call"
    && entry.payload?.source === "agentic_deterministic_artifact_obligation"
  ));
});

test("agentic final gate uses the initial artifact contract when current spec is incomplete", async () => {
  const events = [];
  const tool = {
    id: "generate_document",
    name: "Generate Document",
    risk_level: "low",
    requires_confirmation: false,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        outline: { type: "object" }
      }
    },
    async execute() {
      return {
        success: true,
        observation: "DOCX generated.",
        artifact_paths: ["E:/linxiDoc/task_agentic_initial_contract/result.docx"],
        metadata: { path: "E:/linxiDoc/task_agentic_initial_contract/result.docx" }
      };
    }
  };
  const adapter = {
    supportsStreaming: false,
    async generate() {
      return { text: "Plain text report.", tool_calls: [] };
    }
  };

  const result = await runAgenticPlanner({
    task: makeCurrentSpecMissingArtifactTask(),
    runtime: {
      actionToolRegistry: makeRegistry(tool),
      store: { appendAuditLog() {} },
      toolContext: {}
    },
    adapterOverride: adapter,
    onEvent(event) {
      events.push(event);
    },
    maxIterations: 4
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.artifactPaths, ["E:/linxiDoc/task_agentic_initial_contract/result.docx"]);
  assert.ok(events.some((event) =>
    event.event_type === "tool_call_proposed"
    && event.payload?.tool_id === "generate_document"
    && event.payload?.args?.kind === "docx"
  ));
});

test("agentic final gate materializes markdown artifacts with write_file", async () => {
  const calls = [];
  const events = [];
  const tool = {
    id: "write_file",
    name: "Write File",
    risk_level: "medium",
    requires_confirmation: false,
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string" }
      }
    },
    async execute(args) {
      calls.push(args);
      return {
        success: true,
        observation: "Markdown generated.",
        artifact_paths: [`E:/linxiDoc/task_agentic_markdown/${args.filename}`],
        metadata: { path: `E:/linxiDoc/task_agentic_markdown/${args.filename}` }
      };
    }
  };
  const adapter = {
    supportsStreaming: false,
    async generate() {
      return {
        text: "# Markdown Report\n\n- evidence\n\nAccuracy check: internal reviewer note",
        tool_calls: []
      };
    }
  };

  const result = await runAgenticPlanner({
    task: {
      task_id: "task_agentic_markdown",
      title: "markdown",
      user_command: "整理成 markdown",
      task_spec: {
        goal: "generate_document",
        artifact: { required: true, kind: "md" },
        success_contract: {
          artifact_created: true,
          required_policy_groups: [],
          required_tool_names: []
        }
      }
    },
    runtime: {
      actionToolRegistry: makeRegistry(tool),
      store: { appendAuditLog() {} },
      toolContext: {}
    },
    adapterOverride: adapter,
    onEvent(event) {
      events.push(event);
    },
    maxIterations: 4
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, "markdown.md");
  assert.match(calls[0].content, /Markdown Report/);
  assert.doesNotMatch(calls[0].content, /Accuracy check/u);
  assert.deepEqual(result.artifactPaths, ["E:/linxiDoc/task_agentic_markdown/markdown.md"]);
  assert.ok(events.some((event) =>
    event.event_type === "tool_call_proposed"
    && event.payload?.tool_id === "write_file"
    && event.payload?.source === "agentic_deterministic_artifact_obligation"
  ));
});
