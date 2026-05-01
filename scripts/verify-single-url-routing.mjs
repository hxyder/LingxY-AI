#!/usr/bin/env node
/**
 * UCA-077 P4-RQ E2: single-URL resolver bypass fix.
 *
 * Pre-fix bug:
 *   "总结这个 URL: https://example.com/a" → web=forbidden because
 *   source-scope's assumption-kind "这篇/这个" pronoun matched,
 *   resolver step 3 short-circuited to forbidden, validator's
 *   single_lookup profile was unreachable. The user pasted a URL
 *   they wanted us to read; the resolver locked us out.
 *
 * Fix design (framework-level, not patch):
 *   The chain now distinguishes source-scope by SignalKind:
 *     0a. explicit_no_search / local_only_constraint → forbidden
 *     2a. explicit_single_url      → required (URL anchor wins
 *                                    over pronoun/local-input ambiguity)
 *     2b. local input without URL/search intent → forbidden fallback
 *   Combined with research_quality=single_lookup (D1) and
 *   required_policy_groups stamping (applyHardenedRules pushes
 *   external_web_read when mode=required).
 *
 * Asserts:
 *   1. Single-URL Chinese phrasings route to web=required +
 *      research_quality.profile=single_lookup + required_policy_groups
 *      includes external_web_read.
 *   2. Single-URL English phrasings same.
 *   3. URL adjacency to summarise verb (URL placed AFTER pronoun)
 *      also routes correctly.
 *   4. local input plus an explicit inline URL routes to required; the URL is
 *      an external source the user named, not a topic regex.
 *   5. Pronoun-only ("总结这段代码") with no URL STILL forbids —
 *      assumption-kind local catches at step 2c.
 *   6. Validator: single_lookup task with 1 fetch_url_content
 *      result → satisfied=true.
 *   7. Validator: required_policy_groups includes external_web_read
 *      so the existing "any tool in group succeeded" check fires.
 *
 * Run: node scripts/verify-single-url-routing.mjs
 */

import assert from "node:assert/strict";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { validateSuccessContract } from "../src/service/core/policy/success-contract-validator.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

// ── Routing: single-URL phrasings → web=required + single_lookup ────
const SINGLE_URL_CHINESE = [
  "总结这个 URL: https://example.com/a",
  "总结这篇文章 https://example.com/a",
  "只基于这篇文章 https://example.com/a",
  "分析这个网页 https://nature.com/x",
  "看看这一篇 https://nature.com/x"
];

const SINGLE_URL_ENGLISH = [
  "summarize this URL https://example.com/a",
  "summarise this article https://nature.com/x",
  "read this page https://example.com/y",
  "based only on this article https://example.com/z"
];

for (const text of SINGLE_URL_CHINESE) {
  it(`routing: Chinese "${text.slice(0, 32)}..." → required + single_lookup + reqGroups`, () => {
    const spec = createTaskSpec(text, {}, {});
    assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required",
      `expected web=required; got ${spec.tool_policy?.policy_groups?.external_web_read?.mode}`);
    assert.equal(spec.research_quality?.profile, "single_lookup",
      `expected single_lookup; got ${spec.research_quality?.profile}`);
    assert.ok(spec.success_contract?.required_policy_groups?.includes("external_web_read"),
      `expected external_web_read in required_policy_groups; got ${JSON.stringify(spec.success_contract?.required_policy_groups)}`);
  });
}

for (const text of SINGLE_URL_ENGLISH) {
  it(`routing: English "${text.slice(0, 40)}..." → required + single_lookup + reqGroups`, () => {
    const spec = createTaskSpec(text, {}, {});
    assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
    assert.equal(spec.research_quality?.profile, "single_lookup");
    assert.ok(spec.success_contract?.required_policy_groups?.includes("external_web_read"));
  });
}

// ── Boundary: local input + explicit URL still fetches the URL ──────
it("boundary: file_text anchor + URL phrasing in command → required (URL wins)", () => {
  const spec = createTaskSpec("总结这个 URL: https://example.com", {
    file_paths: ["e:\\some\\local\\file.docx"]
  }, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required",
    "explicit inline URL must be fetchable even when local files are attached");
});

it("boundary: real_selection anchor + URL phrasing → required (URL wins)", () => {
  // Selection text genuinely distinct from command — real_selection fact.
  const spec = createTaskSpec("总结这个 URL: https://example.com", {
    text: "function foo() { return 'pasted code, not the URL'; }"
  }, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required",
    "explicit inline URL must be fetchable even when selected text exists");
});

// ── Boundary: assumption pronoun WITHOUT URL → STILL forbidden ──────
it("boundary: '总结这段代码' (pronoun, no URL) → forbidden (step 2c)", () => {
  const spec = createTaskSpec("总结这段代码", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
});

it("boundary: 'summarize this code' (pronoun, no URL) → forbidden", () => {
  const spec = createTaskSpec("summarize this code please", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden");
});

// ── Boundary: explicit_no_search overrides single-URL ───────────────
it("boundary: explicit_no_search beats explicit_single_url (E1 priority preserved)", () => {
  const spec = createTaskSpec("不要联网，总结这个 URL: https://example.com/a", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "forbidden",
    "explicit_no_search must beat single-URL routing");
});

// ── Validator: single_lookup completion satisfies the contract ──────
it("validator: single_lookup task + 1 fetch_url_content hit → satisfied", () => {
  const spec = createTaskSpec("总结这个 URL: https://example.com/a", {}, {});
  const transcript = [{
    type: "tool_result", tool: "fetch_url_content", success: true,
    observation: "x".repeat(500),
    metadata: { url: "https://example.com/a" }
  }];
  const out = validateSuccessContract(spec, transcript);
  assert.equal(out.satisfied, true,
    `expected satisfied; violations=${JSON.stringify(out.violations)}`);
});

it("validator: single_lookup task + ZERO web tools called → required_not_called", () => {
  const spec = createTaskSpec("总结这个 URL: https://example.com/a", {}, {});
  const out = validateSuccessContract(spec, []);
  assert.equal(out.satisfied, false);
  const kinds = out.violations.map((v) => v.kind);
  assert.ok(kinds.includes("external_web_read_required_not_called"),
    `expected required_not_called; got ${JSON.stringify(kinds)}`);
});

// ── Generalization smoke: variant phrasings without per-case patches ─
it("generalization: novel single-URL phrasings catch via existing patterns (no new regex)", () => {
  // These are phrasings I did NOT add patterns for, but the existing
  // explicit_single_url patterns + URL_VERB_ADJACENCY catch them.
  for (const text of [
    "帮我看看这个 URL https://example.com/x",  // 看看 verb in URL_VERB_ADJACENCY
    "读一下 https://nature.com/article",       // 读一下 + URL adjacency
    "概括这篇 https://blog.example.com/post"   // 概括 + URL adjacency
  ]) {
    const spec = createTaskSpec(text, {}, {});
    const mode = spec.tool_policy?.policy_groups?.external_web_read?.mode;
    assert.equal(mode, "required", `expected required for "${text}"; got ${mode}`);
    assert.equal(spec.research_quality?.profile, "single_lookup");
  }
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
