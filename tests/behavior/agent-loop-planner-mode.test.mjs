import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLeanChatSystemPrompt,
  renderRequiredContractForPlanner,
  shouldRetryProseTrap,
  shouldUseLeanChatMode,
  taskRequiresToolUse
} from "../../src/service/executors/tool_using/planner-mode.mjs";

test("agent planner mode uses lean chat only for no-tool QA turns", () => {
  const leanTask = {
    user_command: "继续刚才的角色扮演",
    context_packet: {
      semantic_router_decision: {
        needs_tool_use: false,
        artifact_required: false,
        web_policy: "forbidden",
        source_mode: "provided_context",
        primary_intent: "conversation",
        needed_capabilities: ["none"]
      }
    },
    task_spec: {
      goal: "qa",
      contract: { mode: "qa" },
      tool_policy: {
        web_search_fetch: { mode: "forbidden" }
      }
    }
  };

  assert.equal(taskRequiresToolUse(leanTask), false);
  assert.equal(shouldUseLeanChatMode(leanTask), true);
});

test("agent planner mode refuses lean chat when tools or attachments are required", () => {
  assert.equal(shouldUseLeanChatMode({
    context_packet: {
      semantic_router_decision: {
        needs_tool_use: false,
        source_mode: "provided_context",
        needed_capabilities: ["none"]
      }
    },
    task_spec: {
      artifact: { required: true }
    }
  }), false);

  assert.equal(shouldUseLeanChatMode({
    context_packet: {
      file_paths: ["E:/linxi/resume.pdf"],
      semantic_router_decision: {
        needs_tool_use: false,
        source_mode: "provided_context",
        needed_capabilities: ["none"]
      }
    },
    task_spec: {
      goal: "qa",
      contract: { mode: "qa" }
    }
  }), false);

  assert.equal(taskRequiresToolUse({
    task_spec: {
      success_contract: {
        required_policy_groups: ["email_send"]
      }
    }
  }), true);
});

test("agent planner mode renders required contract members for prompt evidence", () => {
  const block = renderRequiredContractForPlanner({
    task_spec: {
      success_contract: {
        required_tool_names: ["account_send_email"],
        required_policy_groups: ["email_send", "local_file_text_read"]
      }
    }
  });

  assert.match(block, /required_tools: account_send_email/);
  assert.match(block, /email_send/);
  assert.match(block, /any of: .*account_send_email/);
  assert.match(block, /local_file_text_read/);
  assert.match(block, /any of: .*read_file_text.*read_folder_text/);
  assert.doesNotMatch(block, /search_file_content/);
});

test("agent planner mode renders artifact contract for required file outputs", () => {
  const block = renderRequiredContractForPlanner({
    task_spec: {
      artifact: { required: true, kind: "docx" },
      constraints: { must_verify_artifact: true },
      success_contract: {
        artifact_created: true,
        artifact_registered: true,
        required_tool_names: [],
        required_policy_groups: []
      }
    }
  });

  assert.match(block, /artifact_required: true/);
  assert.match(block, /artifact_kind: docx/);
  assert.match(block, /artifact_tools: .*generate_document/);
  assert.match(block, /must_verify_artifact: true/);
});

test("agent lean chat prompt preserves roleplay and phantom attachment rules", () => {
  const prompt = buildLeanChatSystemPrompt({
    task: {
      task_spec: {
        synthesis: { expected_output: "direct_answer" }
      }
    },
    synthesisBlock: "\n\nSynthesis guidance."
  });

  assert.match(prompt, /conversation history establishes a roleplay\/persona/);
  assert.match(prompt, /Phantom-attachment rule/);
  assert.match(prompt, /Expected output: direct_answer/);
  assert.match(prompt, /Synthesis guidance/);
});

test("agent prose-trap retry only fires before any tool result", () => {
  const task = {
    user_command: "打开计算器",
    task_spec: {
      goal: "launch_and_act"
    }
  };

  assert.equal(shouldRetryProseTrap({ task, prose: "I cannot do that.", transcript: [] }), true);
  assert.equal(shouldRetryProseTrap({
    task,
    prose: "I cannot do that.",
    transcript: [{ type: "tool_result", tool: "launch_app", success: false }]
  }), false);
});
