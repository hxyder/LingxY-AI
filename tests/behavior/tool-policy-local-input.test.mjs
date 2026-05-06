import assert from "node:assert/strict";
import test from "node:test";

import { createTaskSpec } from "../../src/service/core/task-spec.mjs";
import { extractAllSignals } from "../../src/service/core/intent/signals/index.mjs";
import { shouldConsultSemanticRouter } from "../../src/service/core/policy/tool-policy-resolver.mjs";

function externalSearchDecision(reason = "external evidence is required") {
  return {
    source_scope: "external_world",
    web_policy: "required",
    output_kind: "conversation",
    artifact_required: false,
    executor: "tool_using",
    research_depth: "multi_source",
    confidence: 0.86,
    reason
  };
}

function localFileDecision(reason = "the search object is the attached file") {
  return {
    source_scope: "uploaded_files",
    web_policy: "forbidden",
    output_kind: "conversation",
    artifact_required: false,
    executor: "tool_using",
    research_depth: "unknown",
    confidence: 0.84,
    reason
  };
}

test("attached local input + explicit search can be upgraded by SemanticRouter", () => {
  const spec = createTaskSpec("结合这份材料搜索外部机会", {
    file_paths: ["material.pdf"],
    semantic_router_decision: externalSearchDecision("attached material is local evidence; answering requires external search")
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
  assert.equal(spec.suggested_executor, "tool_using");
  assert.ok(spec.success_contract?.required_policy_groups?.includes("external_web_read"));
});

test("neutral search over attached files consults SR instead of deterministic source_scope lock", () => {
  const text = "结合这份材料搜索外部机会";
  const contextPacket = { file_paths: ["material.pdf"] };
  const { signals } = extractAllSignals(text, contextPacket);

  assert.equal(signals.source_scope?.hint?.value, "uploaded_files");
  assert.equal(signals.explicit_search?.matched, true);
  assert.equal(shouldConsultSemanticRouter({ signals, contextPacket, text }), true);
});

test("SR can keep an explicit-search file query local", () => {
  const spec = createTaskSpec("查一下我的文件里写了什么", {
    file_paths: ["a.docx"],
    semantic_router_decision: localFileDecision()
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.match(spec.tool_policy?.web_search_fetch?.reason ?? "", /Semantic router|attached file|uploaded_files/i);
});

test("neutral search over attached files without SR falls back to optional, not fake-forbidden", () => {
  const spec = createTaskSpec("查一下我的文件里写了什么", {
    file_paths: ["a.docx"]
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "optional");
  assert.equal(spec.routing_status, "sr_not_invoked");
  assert.equal(spec.routing_degraded, true);
});

test("local-only constraint beats SR external upgrade", () => {
  const spec = createTaskSpec("仅基于这份文件搜索并总结", {
    file_paths: ["a.docx"],
    semantic_router_decision: externalSearchDecision("model attempted an external upgrade")
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.match(spec.tool_policy?.web_search_fetch?.reason ?? "", /local-only|仅基于|only/i);
});

test("plain attached-file summary remains deterministic local", () => {
  const text = "总结这份文档";
  const contextPacket = { file_paths: ["a.docx"] };
  const { signals } = extractAllSignals(text, contextPacket);
  const spec = createTaskSpec(text, contextPacket, {});

  assert.equal(shouldConsultSemanticRouter({ signals, contextPacket, text }), false);
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.equal(spec.routing_degraded, false);
  assert.equal(spec.artifact.required, false);
  assert.ok(!spec.required_steps.includes("generate_artifact"));
  assert.ok(spec.success_contract.required_policy_groups.includes("local_file_text_read"));
});

test("selected URL text requires exact-source reading without broad-search opt-in", () => {
  const spec = createTaskSpec("分析一下这个链接", {
    source_type: "text_selection",
    text: "https://news.example.org/story/123"
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
  assert.match(spec.tool_policy?.web_search_fetch?.reason ?? "", /exact-source reading is required/i);
});

test("selected paragraph that only contains a URL stays local by default", () => {
  const spec = createTaskSpec("解释这段话", {
    source_type: "text_selection",
    text: "See https://news.example.org/story/123 for details."
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.match(spec.tool_policy?.web_search_fetch?.reason ?? "", /anchored to/i);
});

test("selected URL context still respects explicit no-search", () => {
  const spec = createTaskSpec("不要联网，分析一下这个链接", {
    source_type: "text_selection",
    text: "https://news.example.org/story/123"
  }, {});

  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
  assert.match(spec.tool_policy?.web_search_fetch?.reason ?? "", /forbade web browsing|不联网/i);
});

test("attached local input search does not inherit output artifact from the input file type", () => {
  const spec = createTaskSpec("结合这份材料搜索外部机会", {
    file_paths: ["material.docx"]
  }, {});

  assert.equal(spec.artifact.required, false);
  assert.equal(spec.artifact.kind, null);
  assert.ok(!spec.required_steps.includes("generate_artifact"));
});

test("attached editable file still becomes an artifact when the user asks to modify it", () => {
  const spec = createTaskSpec("帮我修改这份文档", {
    file_paths: ["draft.docx"]
  }, {});

  assert.equal(spec.goal, "transform_existing_file");
  assert.equal(spec.artifact.required, true);
  assert.equal(spec.artifact.kind, "docx");
});
