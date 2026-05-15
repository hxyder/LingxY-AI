import test from "node:test";
import assert from "node:assert/strict";

import {
  filterToolsForTask,
  neededCapabilitiesOf,
  shouldRenderWorkflowHint
} from "../../src/service/executors/tool_using/tool-surface.mjs";

const tools = [
  { id: "web_search_fetch", policy_group: "external_web_read" },
  { id: "fetch_url_content", policy_group: "external_web_read" },
  { id: "vision_analyze" },
  { id: "file_op" },
  { id: "generate_document" },
  { id: "write_file" },
  { id: "run_script" },
  { id: "resolve_output_path" },
  { id: "register_artifact" },
  { id: "verify_file_exists" },
  { id: "open_file" },
  { id: "reveal_in_explorer" },
  { id: "launch_app" },
  { id: "create_scheduled_task" },
  { id: "account_send_email" },
  { id: "connector_workflow_run" },
  { id: "connector_plugin_manage" },
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

  assert.deepEqual(visible.sort(), ["vision_analyze", "web_search_fetch", "fetch_url_content"].sort());
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
  assert.ok(!filterToolsForTask(tools, neutralTask).some((tool) => tool.id === "vision_analyze"));
  assert.ok(!filterToolsForTask(tools, neutralTask).some((tool) => tool.id === "file_op"));
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

  assert.deepEqual(visible.sort(), [
    "connector_plugin_manage",
    "draft_capability",
    "save_capability_draft"
  ].sort());
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
  // B2-a (b): verify_file_exists is in the tool-surface artifact set
  // (LLM needs it for task-spec.required_steps verification) even
  // though POLICY_GROUPS.artifact_generation excludes it (verifier,
  // not no-side-effect producer). The two sets are intentionally
  // distinct — see src/service/executors/tool_using/tool-surface.mjs
  // ARTIFACT_TOOL_IDS comment.
  assert.ok(visible.includes("verify_file_exists"));
  assert.ok(!visible.includes("launch_app"));
});

test("agent tool surface preserves artifact writers for typed artifact contracts", () => {
  const task = {
    user_command: "读取会议纪要，提取 owner、goal、follow-up。",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {
      artifact: { required: true, kind: "md" },
      success_contract: { artifact_created: true }
    }
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(visible.includes("write_file"));
  assert.ok(visible.includes("generate_document"));
  assert.ok(visible.includes("resolve_output_path"));
});

test("typed artifact_generation capability is not vetoed by live text heuristics", () => {
  const task = {
    user_command: "继续处理这个",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["artifact_generation"],
        artifact_required: true,
        expected_output: "artifact"
      }
    },
    task_spec: {
      artifact: { required: true, kind: "xlsx" },
      success_contract: { artifact_created: true, artifact_registered: true }
    }
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(visible.includes("generate_document"));
  assert.ok(visible.includes("write_file"));
  assert.ok(visible.includes("register_artifact"));
});

test("agent tool surface does not infer artifact writers from raw text without TaskSpec", () => {
  const task = {
    user_command: "读取附件并生成 markdown 报告文件。",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(!visible.includes("write_file"));
  assert.ok(!visible.includes("generate_document"));
  assert.ok(!visible.includes("resolve_output_path"));
});

test("agent tool surface preserves run_script for explicit execution over generated file context", () => {
  const task = {
    user_command: "继续：用 Node.js 执行一段脚本读取上一个生成的 HTML 文件，确认内容包含标记。",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["artifact_generation"]
      }
    },
    task_spec: {
      artifact: { required: true, kind: "html" },
      success_contract: { artifact_created: true }
    }
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(visible.includes("generate_document"));
  assert.ok(visible.includes("run_script"));
});

test("agent tool surface keeps connector-scoped searches out of generic web search", () => {
  const task = {
    user_command: "搜索云盘里文件名包含 audit 的文档，只列出名称。",
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: []
      }
    },
    task_spec: {}
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(!visible.includes("web_search_fetch"));
  assert.ok(visible.includes("connector_workflow_run"));
});

test("agent tool surface keeps web research available for scheduled research email tasks", () => {
  const task = {
    user_command: "收集美股市场最新汇总信息（包括主要股指表现、涨跌板块、重要新闻等），整理后发送邮件到 a@example.com",
    context_packet: {
      selection_metadata: {
        scheduled_task_fire: true,
        side_effect_authorization: {
          kind: "scheduled_fire",
          decision: "preauthorized",
          groups: ["email_send"]
        }
      },
      semantic_router_rejection: {
        kind: "rejection",
        code: "timeout"
      }
    },
    task_spec: {
      goal: "search_and_answer",
      connector_domain: true,
      routing_degraded: true,
      tool_policy: {
        policy_groups: {
          external_web_read: { mode: "optional" }
        },
        web_search_fetch: { mode: "optional" },
        fetch_url_content: { mode: "optional" }
      },
      success_contract: {
        required_policy_groups: ["email_send"]
      }
    }
  };

  const visible = filterToolsForTask(tools, task).map((tool) => tool.id);

  assert.ok(visible.includes("web_search_fetch"));
  assert.ok(visible.includes("fetch_url_content"));
  assert.ok(visible.includes("account_send_email"));
  assert.ok(visible.includes("connector_workflow_run"));
  assert.ok(!visible.includes("create_scheduled_task"));
  assert.ok(!visible.includes("vision_analyze"));
  assert.ok(!visible.includes("file_op"));
  assert.ok(!visible.includes("run_script"));
});

test("agent tool surface hides run_script unless code execution is explicitly required", () => {
  const visible = filterToolsForTask(tools, {
    user_command: "收集最新市场信息并发送邮件到 a@example.com",
    task_spec: {
      success_contract: { required_policy_groups: ["email_send"] }
    }
  }).map((tool) => tool.id);

  assert.ok(!visible.includes("run_script"));

  const explicit = filterToolsForTask(tools, {
    user_command: "用 Node.js 执行脚本检查生成文件。",
    task_spec: {
      success_contract: { required_policy_groups: [] }
    }
  }).map((tool) => tool.id);

  assert.ok(explicit.includes("run_script"));
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
  assert.ok(visible.includes("connector_plugin_manage"));
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
  assert.ok(visible.includes("connector_plugin_manage"));
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
