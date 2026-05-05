import assert from "node:assert/strict";
import test from "node:test";

import { createTaskSpec } from "../../src/service/core/task-spec.mjs";
import { resolveExecutor } from "../../src/service/core/planning/executor-resolver.mjs";
import { createExecutorRegistry } from "../../src/service/executors/registry.mjs";

const BASE_TOOL_POLICY = Object.freeze({
  web_search_fetch: { mode: "forbidden" },
  policy_groups: {
    external_web_read: { mode: "forbidden" }
  }
});

test("executor resolver treats route suggestions as evidence, not authority", () => {
  const taskSpec = {
    goal: "qa",
    artifact: { required: false },
    connector_domain: false
  };

  const decision = resolveExecutor({
    taskSpec,
    toolPolicy: BASE_TOOL_POLICY,
    routeSuggestion: "fast"
  });

  assert.equal(decision.executor, "tool_using");
  assert.match(decision.reason, /AI-agent default/);
  assert.ok(decision.evidence.some((item) => item.source === "route-suggestion" && item.matched === "fast"));
  assert.ok(decision.rejected.some((item) => item.candidate === "fast" && /suggested/.test(item.reason)));
});

test("executor resolver routes image context to multi_modal", () => {
  const taskSpec = {
    goal: "analyze_image",
    artifact: { required: false },
    connector_domain: false
  };

  const decision = resolveExecutor({
    taskSpec,
    toolPolicy: BASE_TOOL_POLICY,
    contextPacket: { image_paths: ["fixture.png"] },
    routeSuggestion: "fast"
  });

  assert.equal(decision.executor, "multi_modal");
  assert.match(decision.reason, /Image attachments/);
  assert.ok(decision.rejected.some((item) => item.candidate === "fast"));
});

test("executor resolver routes image plus required external search to tool_using", () => {
  const taskSpec = {
    goal: "multimodal_analyze",
    artifact: { required: false },
    connector_domain: false,
    success_contract: {
      required_policy_groups: ["external_web_read"]
    }
  };
  const toolPolicy = {
    web_search_fetch: { mode: "required" },
    policy_groups: {
      external_web_read: { mode: "required" }
    }
  };

  const decision = resolveExecutor({
    taskSpec,
    toolPolicy,
    contextPacket: { image_paths: ["product.png"] },
    routeSuggestion: "multi_modal"
  });

  assert.equal(decision.executor, "tool_using");
  assert.match(decision.reason, /Image attachments.*external_web_read/);
  assert.ok(decision.rejected.some((item) => item.candidate === "multi_modal"));
});

test("executor resolver gives image context priority even when an artifact is required", () => {
  const taskSpec = {
    goal: "generate_document",
    artifact: { required: true, formats: ["docx"] },
    connector_domain: false
  };

  const decision = resolveExecutor({
    taskSpec,
    toolPolicy: BASE_TOOL_POLICY,
    contextPacket: { image_paths: ["diagram.png"] },
    routeSuggestion: "agentic"
  });

  assert.equal(decision.executor, "multi_modal");
  assert.ok(decision.rejected.some((item) => item.candidate === "agentic"));
});

test("executor resolver routes pure translation to translate executor", () => {
  const taskSpec = {
    goal: "translate",
    artifact: { required: false },
    connector_domain: false
  };

  const decision = resolveExecutor({
    taskSpec,
    toolPolicy: BASE_TOOL_POLICY,
    contextPacket: {
      source_type: "text_selection",
      text: "Hello from a selected paragraph."
    },
    routeSuggestion: "tool_using"
  });

  assert.equal(decision.executor, "translate");
  assert.match(decision.reason, /dedicated translate executor/);
  assert.ok(decision.rejected.some((item) => item.candidate === "tool_using"));
});

test("createTaskSpec keeps selected text translation on the translate fast path", () => {
  const spec = createTaskSpec("请翻译这段网页内容", {
    source_type: "text_selection",
    text: "Hello from a selected paragraph.",
    url: "https://example.com/article"
  });

  assert.equal(spec.goal, "translate");
  assert.equal(spec.suggested_executor, "translate");
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
});

test("executor resolver fails loudly when the selected executor is unavailable", () => {
  assert.throws(
    () => resolveExecutor({
      taskSpec: {
        goal: "qa",
        artifact: { required: false },
        connector_domain: false
      },
      toolPolicy: BASE_TOOL_POLICY,
      runtimeCapabilities: new Set(["fast"])
    }),
    /tool_using.*runtime does not advertise/
  );
});

test("createTaskSpec records executor-selection behavior in the decision trace", () => {
  const spec = createTaskSpec("识别这张图里的内容", {
    image_paths: ["fixture.png"]
  }, {
    suggested_executor: "fast"
  });

  assert.equal(spec.suggested_executor, "multi_modal");
  assert.equal(spec.executor_decision?.executor, "multi_modal");
  assert.ok(spec.decision_trace.some((entry) => entry.stage === "executor-selection"));
});

test("createTaskSpec keeps plain image understanding conversational, not artifact-only", () => {
  const spec = createTaskSpec("识别这张图里的内容", {
    image_paths: ["fixture.png"]
  });

  assert.equal(spec.goal, "multimodal_analyze");
  assert.equal(spec.artifact.required, false);
  assert.equal(spec.suggested_executor, "multi_modal");
});

test("createTaskSpec composes image plus neutral search with tool loop even before SR", () => {
  const spec = createTaskSpec("看看这张图，帮我搜索同款价格", {
    image_paths: ["product.png"]
  });

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "optional");
  assert.equal(spec.suggested_executor, "tool_using");
  assert.equal(spec.artifact.required, false);
});

test("createTaskSpec treats compact Chinese search verb as structural search", () => {
  const spec = createTaskSpec("看看这张图，帮我搜同款价格", {
    image_paths: ["product.png"]
  });

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "optional");
  assert.equal(spec.suggested_executor, "tool_using");
});

test("createTaskSpec treats html as a first-class generated artifact format", () => {
  const spec = createTaskSpec("生成一个 HTML 报告");

  assert.equal(spec.artifact.required, true);
  assert.equal(spec.artifact.kind, "html");
  assert.equal(spec.suggested_executor, "tool_using");
});

test("createTaskSpec composes image understanding with external search tools", () => {
  const spec = createTaskSpec("结合这张产品图搜索外部竞品", {
    image_paths: ["product.png"],
    semantic_router_decision: {
      source_scope: "external_world",
      web_policy: "required",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      needed_capabilities: ["image_understanding", "external_web_read"],
      required_policy_groups: ["external_web_read"],
      confidence: 0.86,
      reason: "image-grounded external research"
    }
  }, {
    suggested_executor: "multi_modal"
  });

  assert.equal(spec.suggested_executor, "tool_using");
  assert.equal(spec.executor_decision?.executor, "tool_using");
  assert.ok(spec.success_contract.required_policy_groups.includes("external_web_read"));
});

test("executor registry remains an availability registry with explicit fallback behavior", () => {
  const fast = { id: "fast" };
  const toolUsing = { id: "tool_using" };
  const registry = createExecutorRegistry([fast, toolUsing]);

  assert.equal(registry.get("tool_using"), toolUsing);
  assert.equal(registry.pick({ preferredId: "tool_using" }), toolUsing);
  assert.equal(registry.pick({ privacyLevel: "local_only" }), fast);
  assert.equal(registry.pick({ preferredId: "missing", privacyLevel: "cloud_ok" }), fast);
});
