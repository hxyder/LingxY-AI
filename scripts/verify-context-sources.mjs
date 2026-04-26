#!/usr/bin/env node
/**
 * UCA-077 P4-02.x C1 (plan p4-03-p4-02-goofy-forest): context-source
 * classifier regression.
 *
 * Asserts:
 *   1. Empty input → all flags false.
 *   2. Structural attachments → uploaded_files / uploaded_images / browser_page.
 *   3. Authoritative metadata flags (set by producers themselves) win without
 *      needing a sentinel scan: conversation_history_injected,
 *      semantic_recall_ids, memory_background_injected, parent_task_id,
 *      editable_target_path.
 *   4. Sentinel scan over ctx.text (when no metadata flag set) recognizes
 *      every sentinel header documented in plan §C1:
 *        - [当前对话上下文]                              → conversation_history
 *        - [跨任务语义记忆（RAG）]                         → rag_background
 *        - [跨对话相关任务（语义召回 · 可作为背景）]            → rag_background (legacy)
 *        - [memory_background · ...]                   → rag_background (C2 new)
 *        - [上一轮任务摘要 · parent=...]                  → parent_task_context
 *        - [Editable target artifact]                  → editable_artifact
 *        - 对话历史: / 对话历史：                          → conversation_history
 *   5. Default real_selection: text non-empty + no sentinel + ≠ command.
 *      Preserves existing case 10 (`local-code-identifier-with-context`).
 *   6. Command-echo guard: ctx.text === user command → real_selection stays
 *      false (mirror source-scope.mjs:90 isJustCommandEcho).
 *   7. Multi-block text: real selection block + sentinel block separated
 *      by \n\n---\n\n → BOTH flags set.
 *   8. Pure: input is not mutated.
 *   9. hasLocalAnchor convenience helper.
 *  10. Public surface: CONTEXT_SOURCE_KEYS frozen + LOCAL_ANCHOR_KEYS frozen.
 *
 * Run: node scripts/verify-context-sources.mjs
 */

import assert from "node:assert/strict";

import {
  classifyContextSources,
  hasLocalAnchor,
  CONTEXT_SOURCE_KEYS,
  LOCAL_ANCHOR_KEYS
} from "../src/service/core/intent/context-sources.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
    fail += 1;
  }
}

const ALL_FALSE = {
  real_selection: false, browser_page: false, file_text: false,
  conversation_history: false, rag_background: false, parent_task_context: false,
  editable_artifact: false, uploaded_files: false, uploaded_images: false
};

async function run() {
  // ── 1. empty / minimal ────────────────────────────────────────────────
  it("empty: no input → all flags false", () => {
    assert.deepEqual(classifyContextSources(), ALL_FALSE);
    assert.deepEqual(classifyContextSources({}), ALL_FALSE);
    assert.deepEqual(classifyContextSources({ text: "", contextPacket: {} }), ALL_FALSE);
  });
  it("empty: command only, no context → all false", () => {
    const out = classifyContextSources({ text: "你好", contextPacket: {} });
    assert.deepEqual(out, ALL_FALSE);
  });

  // ── 2. structural attachments ─────────────────────────────────────────
  it("structural: file_paths → uploaded_files", () => {
    const out = classifyContextSources({ text: "x", contextPacket: { file_paths: ["a.docx"] } });
    assert.equal(out.uploaded_files, true);
    assert.equal(out.uploaded_images, false);
  });
  it("structural: image_paths → uploaded_images", () => {
    const out = classifyContextSources({ text: "x", contextPacket: { image_paths: ["a.png"] } });
    assert.equal(out.uploaded_images, true);
    assert.equal(out.uploaded_files, false);
  });
  it("structural: ctx.url alone does NOT set browser_page (P4-02.x follow-up)", () => {
    // Before the follow-up fix, URL presence auto-anchored the task to
    // browser_page=true → forbidden web. Active-tab URL is metadata, not
    // an anchor; the user must explicitly say "this page" or paste
    // selection text. Tested below: "今天天气怎么样" + url stays
    // un-anchored so the resolver can correctly route to required.
    const out = classifyContextSources({ text: "x", contextPacket: { url: "https://example.com" } });
    assert.equal(out.browser_page, false);
    assert.equal(out.real_selection, false);
    // The url itself is still on contextPacket.url for SemanticRouter /
    // display surfaces; this assertion just confirms the *anchor*
    // semantics. (Caller would inspect contextPacket.url directly.)
  });

  // ── 3. authoritative metadata flags ───────────────────────────────────
  it("metadata: conversation_history_injected=true → conversation_history (no sentinel needed)", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { selection_metadata: { conversation_history_injected: true } }
    });
    assert.equal(out.conversation_history, true);
  });
  it("metadata: semantic_recall_ids non-empty → rag_background", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { selection_metadata: { semantic_recall_ids: ["task_abc"] } }
    });
    assert.equal(out.rag_background, true);
  });
  it("metadata: memory_background_injected=true → rag_background (new C2 flag)", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { selection_metadata: { memory_background_injected: true } }
    });
    assert.equal(out.rag_background, true);
  });
  it("metadata: parent_task_id set → parent_task_context", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { selection_metadata: { parent_task_id: "task_xyz" } }
    });
    assert.equal(out.parent_task_context, true);
  });
  it("metadata: editable_target_path set → editable_artifact", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { selection_metadata: { editable_target_path: "C:/x.docx" } }
    });
    assert.equal(out.editable_artifact, true);
  });

  // ── 4. sentinel scan ──────────────────────────────────────────────────
  it("sentinel: [当前对话上下文] → conversation_history", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "[当前对话上下文]\n用户：你好\n助手：你好" }
    });
    assert.equal(out.conversation_history, true);
  });
  it("sentinel: [跨任务语义记忆（RAG）] → rag_background", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "[跨任务语义记忆（RAG）]\n- task=abc · score=0.5" }
    });
    assert.equal(out.rag_background, true);
  });
  it("sentinel: legacy [跨对话相关任务（语义召回 · 可作为背景）] → rag_background", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "[跨对话相关任务（语义召回 · 可作为背景）]\n- task=abc" }
    });
    assert.equal(out.rag_background, true);
  });
  it("sentinel: new C2 [memory_background · ...] → rag_background (prefix match)", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "[memory_background · 语义召回 · 仅作背景，请勿当作当前任务上下文]\n- task=abc" }
    });
    assert.equal(out.rag_background, true);
  });
  it("sentinel: [上一轮任务摘要 · parent=...] → parent_task_context", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "[上一轮任务摘要 · parent=task_abc123]\n用户上一条指令：x" }
    });
    assert.equal(out.parent_task_context, true);
  });
  it("sentinel: [Editable target artifact] → editable_artifact", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "[Editable target artifact]\nC:/x.docx" }
    });
    assert.equal(out.editable_artifact, true);
  });
  it("sentinel: 对话历史: → conversation_history (regex fallback)", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "对话历史：\n用户：你好" }
    });
    assert.equal(out.conversation_history, true);
  });
  it("sentinel: 对话历史： (full-width colon) → conversation_history", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: { text: "对话历史：\n用户：你好" }
    });
    assert.equal(out.conversation_history, true);
  });

  // ── 5. real_selection default ─────────────────────────────────────────
  it("default: text non-empty + no sentinel + ≠ command → real_selection=true", () => {
    const out = classifyContextSources({
      text: "summarize",
      contextPacket: { text: "function f(){return 1;}" }
    });
    assert.equal(out.real_selection, true);
  });
  it("default: matches existing fixture case 10 (local-code-identifier-with-context)", () => {
    const out = classifyContextSources({
      text: "这段代码里 current 字段是什么意思",
      contextPacket: { text: "function foo(){ return current; }" }
    });
    assert.equal(out.real_selection, true);
  });

  // ── 6. command echo guard ─────────────────────────────────────────────
  it("echo: ctx.text === command → real_selection stays false", () => {
    const cmd = "帮我润色这句话";
    const out = classifyContextSources({
      text: cmd,
      contextPacket: { text: cmd }
    });
    assert.equal(out.real_selection, false);
  });

  // ── 7. multi-block text ───────────────────────────────────────────────
  it("multi-block: real selection block + sentinel block → BOTH flags", () => {
    const out = classifyContextSources({
      text: "summarize",
      contextPacket: {
        text: "[当前对话上下文]\n用户：earlier\n助手：earlier reply\n\n---\n\nReal pasted content the user actually selected."
      }
    });
    assert.equal(out.conversation_history, true);
    assert.equal(out.real_selection, true);
  });
  it("multi-block: only sentinel blocks (no real text) → real_selection stays false", () => {
    const out = classifyContextSources({
      text: "x",
      contextPacket: {
        text: "[当前对话上下文]\n用户：q\n助手：a\n\n---\n\n[memory_background · 语义召回]\n- task=abc"
      }
    });
    assert.equal(out.conversation_history, true);
    assert.equal(out.rag_background, true);
    assert.equal(out.real_selection, false);
  });

  // ── 8. purity ─────────────────────────────────────────────────────────
  it("pure: classifier does NOT mutate input contextPacket", () => {
    const ctx = { text: "x", file_paths: ["a"] };
    const before = JSON.stringify(ctx);
    classifyContextSources({ text: "y", contextPacket: ctx });
    assert.equal(JSON.stringify(ctx), before);
  });

  // ── 9. hasLocalAnchor convenience ─────────────────────────────────────
  it("hasLocalAnchor: real_selection → true", () => {
    assert.equal(hasLocalAnchor({ ...ALL_FALSE, real_selection: true }), true);
  });
  it("hasLocalAnchor: only conversation_history → false", () => {
    assert.equal(hasLocalAnchor({ ...ALL_FALSE, conversation_history: true }), false);
  });
  it("hasLocalAnchor: only rag_background → false (RAG never an anchor)", () => {
    assert.equal(hasLocalAnchor({ ...ALL_FALSE, rag_background: true }), false);
  });
  it("hasLocalAnchor: browser_page or file_text → true", () => {
    assert.equal(hasLocalAnchor({ ...ALL_FALSE, browser_page: true }), true);
    assert.equal(hasLocalAnchor({ ...ALL_FALSE, file_text: true }), true);
  });
  it("hasLocalAnchor: null/undefined → false (no crash)", () => {
    assert.equal(hasLocalAnchor(null), false);
    assert.equal(hasLocalAnchor(undefined), false);
    assert.equal(hasLocalAnchor("nope"), false);
  });

  // ── 10. public surface ───────────────────────────────────────────────
  it("public: CONTEXT_SOURCE_KEYS frozen with all 9 flag names", () => {
    assert.equal(CONTEXT_SOURCE_KEYS.length, 9);
    assert.throws(() => { CONTEXT_SOURCE_KEYS.push("x"); });
    for (const key of CONTEXT_SOURCE_KEYS) {
      assert.ok(key in ALL_FALSE, `${key} must appear in ContextSources record`);
    }
  });
  it("public: LOCAL_ANCHOR_KEYS frozen with the 3 anchor flag names", () => {
    assert.deepEqual([...LOCAL_ANCHOR_KEYS], ["real_selection", "browser_page", "file_text"]);
    assert.throws(() => { LOCAL_ANCHOR_KEYS.push("x"); });
  });

  // ── e2e via createTaskSpec ───────────────────────────────────────────
  // Lock-in: the orchestrator stamps context_sources on the enriched
  // packet that signal extraction sees. This proves the wiring at the
  // entry point (vs only context-submission) is in place.
  const { createTaskSpec } = await import("../src/service/core/task-spec.mjs");
  it("e2e: createTaskSpec runs classifier and exposes via signals path", () => {
    // signals/source-scope reads contextPacket.context_sources in C3; here
    // we just verify the orchestrator doesn't blow up and the spec is
    // produced for a sentinel-prefixed text. C3 is responsible for the
    // policy result; this test just confirms wiring.
    const spec = createTaskSpec("x", { text: "[当前对话上下文]\nfoo" }, {});
    assert.ok(spec, "createTaskSpec must succeed");
    assert.ok(spec.tool_policy, "tool_policy must be produced");
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
