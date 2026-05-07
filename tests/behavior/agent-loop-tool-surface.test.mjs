import test from "node:test";
import assert from "node:assert/strict";

import {
  filterToolsForTask,
  neededCapabilitiesOf,
  shouldRenderWorkflowHint
} from "../../src/service/executors/tool_using/tool-surface.mjs";

const tools = [
  { id: "web_search_fetch", policy_group: "external_web_read" },
  { id: "vision_analyze" },
  { id: "generate_document" },
  { id: "write_file" },
  { id: "register_artifact" },
  { id: "verify_file_exists" },
  { id: "open_file" },
  { id: "reveal_in_explorer" },
  { id: "launch_app" },
  { id: "create_scheduled_task" },
  { id: "account_send_email" },
  { id: "connector_workflow_run" },
  { id: "draft_capability" },
  { id: "save_capability_draft" }
];

test("agent tool surface composes image understanding with external web tools", () => {
  const task = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["image_understanding", "external_web_read"]
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.deepEqual(visible.sort(), ["vision_analyze", "web_search_fetch"].sort());
  assert.deepEqual(neededCapabilitiesOf(task), ["image_understanding", "external_web_read"]);
});

test("agent tool surface hides direct file open tools unless the task requires them", () => {
  const neutralTask = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {}
  };
  const openTask = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {
      goal: "open_or_reveal_file"
    }
  };

  assert.ok(!filterToolsForTask(tools, neutralTask).some((tool) => tool.id === "open_file"));
  assert.ok(filterToolsForTask(tools, openTask).some((tool) => tool.id === "open_file"));
});

test("agent tool surface hides schedule registry tools inside scheduled fires", () => {
  const task = {
    context_packet: {
      selection_metadata: {
        scheduled_task_fire: true
      },
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(!visible.includes("create_scheduled_task"));
  assert.ok(visible.includes("launch_app"));
});

test("agent tool surface exposes capability tools when capability_management is needed", () => {
  const task = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["capability_management"]
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.deepEqual(visible.sort(), ["draft_capability", "save_capability_draft"].sort());
});

test("agent tool surface preserves required action tools even when capabilities focus on research", () => {
  const task = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["external_web_read"]
      }
    },
    task_spec: {
      success_contract: {
        required_policy_groups: ["external_web_read", "email_send"]
      }
    }
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(visible.includes("web_search_fetch"));
  assert.ok(visible.includes("account_send_email"));
  assert.ok(visible.includes("connector_workflow_run"));
  assert.ok(!visible.includes("launch_app"));
});

test("agent tool surface preserves artifact tools when artifact is required", () => {
  const task = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["external_web_read"]
      }
    },
    task_spec: {
      artifact: { required: true, kind: "docx" },
      success_contract: {
        artifact_created: true
      }
    }
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(visible.includes("web_search_fetch"));
  assert.ok(visible.includes("generate_document"));
  assert.ok(visible.includes("write_file"));
  assert.ok(visible.includes("register_artifact"));
  // B2-a (b) round-1 codex: verify_file_exists is a verifier, not a
  // producer. Tasks that need to *verify* an artifact still get it
  // via the file_read capability, not artifact_generation.
  assert.ok(!visible.includes("launch_app"));
});

test("capability_management still hides direct file open tools when not required", () => {
  const task = {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["capability_management"]
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(!visible.includes("open_file"));
  assert.ok(!visible.includes("reveal_in_explorer"));
});

test("capability_management still hides schedule registry tools inside scheduled fires", () => {
  const task = {
    context_packet: {
      selection_metadata: { scheduled_task_fire: true },
      semantic_router_decision: {
        needed_capabilities: ["capability_management"]
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(!visible.includes("create_scheduled_task"));
  assert.ok(visible.includes("draft_capability"));
});

test("agent workflow hint follows connector capabilities and intent tags", () => {
  assert.equal(shouldRenderWorkflowHint({
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["email_calendar_action"]
      }
    },
    task_spec: {}
  }), true);

  assert.equal(shouldRenderWorkflowHint({
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {
      intent_tags: ["connector"]
    }
  }), true);
});
