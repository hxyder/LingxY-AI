import test from "node:test";
import assert from "node:assert/strict";

import {
  awaitDeferredSemanticRouterPatchForPlanner
} from "../../src/service/executors/tool_using/agent-loop.mjs";
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

test("agent planner waits for deferred semantic-router patch before no-tool mode selection", async () => {
  const events = [];
  const task = {
    user_command: "重新说一遍",
    context_packet: {},
    task_spec: {
      goal: "qa",
      contract: { mode: "qa" },
      routing_degraded: true,
      tool_policy: {
        web_search_fetch: { mode: "optional" }
      },
      success_contract: { required_policy_groups: [] }
    }
  };
  Object.defineProperty(task, "__srPatchPromise", {
    enumerable: false,
    value: Promise.resolve().then(() => {
      task.context_packet.semantic_router_decision = {
        needs_tool_use: false,
        artifact_required: false,
        web_policy: "forbidden",
        source_mode: "provided_context",
        primary_intent: "qa",
        needed_capabilities: ["none"]
      };
      task.task_spec = {
        ...task.task_spec,
        routing_degraded: false,
        tool_policy: { web_search_fetch: { mode: "forbidden" } }
      };
      task.sr_patch_applied_at = new Date().toISOString();
      return task.task_spec;
    })
  });

  assert.equal(shouldUseLeanChatMode(task), false);
  const waited = await awaitDeferredSemanticRouterPatchForPlanner({
    task,
    iteration: 0,
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload })
    }
  });
  assert.equal(waited, true);
  assert.equal(shouldUseLeanChatMode(task), true);
  assert.ok(events.some((event) => event.event_type === "planner_waiting_for_semantic_router"));
  assert.ok(events.some((event) => event.event_type === "planner_semantic_router_ready"));
});

test("agent planner does not block indefinitely on slow deferred semantic-router patch", async () => {
  const previous = process.env.LINGXY_SR_PATCH_PLANNER_WAIT_MS;
  process.env.LINGXY_SR_PATCH_PLANNER_WAIT_MS = "5";
  try {
    const events = [];
    const task = {
      user_command: "最近有什么要上映的新电影吗",
      context_packet: {},
      task_spec: {
        goal: "qa",
        contract: { mode: "qa" },
        routing_degraded: true,
        tool_policy: {
          web_search_fetch: { mode: "optional" }
        },
        success_contract: { required_policy_groups: [] }
      }
    };
    Object.defineProperty(task, "__srPatchPromise", {
      enumerable: false,
      value: new Promise((resolve) => setTimeout(() => resolve({
        ...task.task_spec,
        routing_degraded: false,
        tool_policy: { web_search_fetch: { mode: "required" } }
      }), 40))
    });

    const started = Date.now();
    const waited = await awaitDeferredSemanticRouterPatchForPlanner({
      task,
      iteration: 0,
      runtime: {
        emitTaskEvent: (event_type, payload) => events.push({ event_type, payload })
      }
    });

    assert.equal(waited, false);
    assert.ok(Date.now() - started < 150);
    assert.ok(events.some((event) =>
      event.event_type === "planner_semantic_router_deferred"
      && event.payload?.reason === "wait_budget_exceeded"
    ));
  } finally {
    if (previous === undefined) delete process.env.LINGXY_SR_PATCH_PLANNER_WAIT_MS;
    else process.env.LINGXY_SR_PATCH_PLANNER_WAIT_MS = previous;
  }
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
  // B2-a (b): artifact_tools list contains producers only; the verify
  // step is surfaced separately so the LLM doesn't conflate verifier
  // with producer.
  assert.match(block, /artifact_verify_tool: verify_file_exists/);
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
