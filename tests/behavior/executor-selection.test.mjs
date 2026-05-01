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

test("executor registry remains an availability registry with explicit fallback behavior", () => {
  const fast = { id: "fast" };
  const toolUsing = { id: "tool_using" };
  const registry = createExecutorRegistry([fast, toolUsing]);

  assert.equal(registry.get("tool_using"), toolUsing);
  assert.equal(registry.pick({ preferredId: "tool_using" }), toolUsing);
  assert.equal(registry.pick({ privacyLevel: "local_only" }), fast);
  assert.equal(registry.pick({ preferredId: "missing", privacyLevel: "cloud_ok" }), fast);
});
