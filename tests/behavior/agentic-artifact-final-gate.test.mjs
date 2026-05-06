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

test("agentic final gate retries prose-only artifact tasks with artifact guidance", async () => {
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
    async generate({ messages }) {
      const hasArtifactGuidance = messages.some((message) =>
        message.role === "user"
        && String(message.content ?? "").includes("[Artifact contract]")
      );
      if (!hasArtifactGuidance) {
        return { text: "Here is the report content, but no file yet.", tool_calls: [] };
      }
      const alreadyGenerated = messages.some((message) =>
        message.role === "tool"
        && String(message.content ?? "").includes("artifact_paths")
      );
      if (alreadyGenerated) {
        return { text: "The DOCX report has been generated.", tool_calls: [] };
      }
      return {
        text: "",
        tool_calls: [{
          id: "call_doc",
          name: "generate_document",
          arguments: {
            kind: "docx",
            outline: {
              title: "Report",
              sections: [{ heading: "Summary", body: "A concise report." }]
            }
          }
        }]
      };
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
    event.event_type === "contract_guidance"
    && event.payload?.source === "final_gate"
    && event.payload?.required_policy_groups?.includes("artifact_generation")
  ));
  assert.ok(auditLog.some((entry) =>
    entry.event_subtype === "tool_loop.contract_guidance"
    && entry.payload?.source === "final_gate"
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
    async generate({ messages }) {
      const hasArtifactGuidance = messages.some((message) =>
        message.role === "user"
        && String(message.content ?? "").includes("[Artifact contract]")
      );
      if (!hasArtifactGuidance) {
        return { text: "Plain text report.", tool_calls: [] };
      }
      const generated = messages.some((message) =>
        message.role === "tool"
        && String(message.content ?? "").includes("artifact_paths")
      );
      if (generated) return { text: "Generated.", tool_calls: [] };
      return {
        text: "",
        tool_calls: [{
          id: "call_doc",
          name: "generate_document",
          arguments: {
            kind: "docx",
            outline: {
              title: "Report",
              sections: [{ heading: "Summary", body: "A concise report." }]
            }
          }
        }]
      };
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
    event.event_type === "contract_guidance"
    && event.payload?.artifact_kind === "docx"
  ));
});
