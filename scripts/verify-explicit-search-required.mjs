#!/usr/bin/env node
/**
 * UCA-077 P4-RQ E5: explicit_search promoted to required
 * (structural hard signal symmetry).
 *
 * Pre-E5: resolver step 3 was `explicit_search → optional`,
 * waiting for SR to upgrade.
 *
 * Post-E5: `explicit_search → required`. The user's directive:
 * "explicit_search 是结构性 hard signal, 应该升级到
 * external_search=required, 而不是只 optional 后等 SR".
 *
 * Asserts the promotion AND the boundary-preservation invariants:
 *   1. "查一下 X" / "search for X" with no context → required.
 *   2. "查一下我的文件" + file_paths attached → optional without SR,
 *      because neutral search + local input is a mixed-intent question.
 *   3. "查一下 X，不要联网" → forbidden (step 0a explicit_no_search
 *      wins over step 3).
 *   4. "搜索这个 URL: https://..." → required via step 2b
 *      (single-URL + inline URL), not step 3 — both yield
 *      required so the outcome is the same; this lock-in just
 *      verifies step 2b still fires first when applicable.
 *   5. "查一下网上的 X" → required via step 1 explicit_external,
 *      not step 3 — same outcome, different path. Lock-in for
 *      step priority.
 *   6. createTaskSpec end-to-end: required_policy_groups includes
 *      external_web_read for the no-context "查一下" case (since
 *      applyHardenedRules pushes it when mode=required).
 *
 * Run: node scripts/verify-explicit-search-required.mjs
 */

import assert from "node:assert/strict";

import { resolveDeterministicPolicy } from "../src/service/core/policy/tool-policy-resolver.mjs";
import { extractAllSignals } from "../src/service/core/intent/signals/index.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";

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

function modeFor(text, contextPacket = {}) {
  const { signals } = extractAllSignals(text, contextPacket);
  const policy = resolveDeterministicPolicy({ signals, contextPacket, text });
  return policy.web_search_fetch.mode;
}

// ── Promotion ────────────────────────────────────────────────────────
it("E5: '查一下 X' (no context) → required", () => {
  assert.equal(modeFor("查一下最近的 AI 论文"), "required");
});
it("E5: 'search for X' (no context) → required", () => {
  assert.equal(modeFor("search for the latest framework benchmarks"), "required");
});
it("E5: '搜索 / google / 查询' verbs all promote to required", () => {
  for (const text of [
    "搜索一下相关文档",
    "google 这个 API",
    "查询一下背景信息",
    "搜一下相关案例"
  ]) {
    assert.equal(modeFor(text), "required", `expected required for "${text}"`);
  }
});

// ── Boundary preservation ────────────────────────────────────────────
it("boundary: explicit_search + file_paths → optional without SR (mixed local/search)", () => {
  const mode = modeFor("查一下我的文件里写了什么", { file_paths: ["a.docx"] });
  assert.equal(mode, "optional",
    "neutral search over local input must defer to SR/planner instead of fake-forbidden");
});
it("boundary: explicit_search + image_paths → optional without SR (mixed local/search)", () => {
  const mode = modeFor("查一下这张图片里有什么", { image_paths: ["a.png"] });
  assert.equal(mode, "optional");
});
it("boundary: explicit_search + explicit_no_search → forbidden (step 0a wins)", () => {
  const mode = modeFor("查一下这个，但不要联网");
  assert.equal(mode, "forbidden",
    "explicit_no_search at step 0a must beat explicit_search at step 3");
});
it("boundary: '总结这个 URL: …' → required via step 2b (explicit_single_url owns summarise verbs)", () => {
  // Step 2b (explicit_single_url) recognises summarise-class verbs
  // (总结/概括/分析/阅读/读一下/看看 + EN summarise/read), NOT
  // search verbs. That separation is intentional: "搜索 + URL"
  // means "search ABOUT this URL"; "总结 + URL" means "summarise
  // THE URL". Both end at web=required but via different paths.
  const text = "总结这个 URL: https://example.com/article";
  const { signals } = extractAllSignals(text, {});
  const policy = resolveDeterministicPolicy({ signals, contextPacket: {}, text });
  assert.equal(policy.web_search_fetch.mode, "required");
  assert.match(policy.web_search_fetch.reason, /single specific URL\/article|fetch_url_content/i,
    `expected step-2b reason; got "${policy.web_search_fetch.reason}"`);
});

it("boundary: '搜索 + URL' → required via step 3 (search verb path; explicit_single_url verb list excludes 搜索)", () => {
  // explicit_single_url deliberately doesn't match 搜索/search
  // verbs — those go through step 3's explicit_search promotion.
  // Outcome is required either way; this lock-in documents the
  // verb-list separation so a future "add 搜索 to single_url
  // verbs" change makes a deliberate decision rather than a
  // silent expansion.
  const text = "搜索这个 URL: https://example.com/article";
  const { signals } = extractAllSignals(text, {});
  const policy = resolveDeterministicPolicy({ signals, contextPacket: {}, text });
  assert.equal(policy.web_search_fetch.mode, "required");
  assert.match(policy.web_search_fetch.reason, /explicit search verb|structural hard signal/i,
    `expected step-3 reason; got "${policy.web_search_fetch.reason}"`);
});
it("boundary: explicit_search + explicit_external → required via step 1 (same outcome)", () => {
  const { signals } = extractAllSignals("查一下网上最近的开源项目", {});
  const policy = resolveDeterministicPolicy({
    signals, contextPacket: {}, text: "查一下网上最近的开源项目"
  });
  assert.equal(policy.web_search_fetch.mode, "required");
  assert.match(policy.web_search_fetch.reason, /online\/external|explicitly asked/i);
});

// ── End-to-end: required_policy_groups stamping ─────────────────────
it("E5 end-to-end: createTaskSpec for '查一下 X' includes external_web_read in required_policy_groups", () => {
  const spec = createTaskSpec("查一下最近的 AI 论文", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
  assert.ok(
    Array.isArray(spec.success_contract?.required_policy_groups)
    && spec.success_contract.required_policy_groups.includes("external_web_read"),
    `expected external_web_read in required_policy_groups; got ${JSON.stringify(spec.success_contract?.required_policy_groups)}`
  );
});

it("E5 end-to-end: 'search for X' in English same shape as Chinese", () => {
  const spec = createTaskSpec("search for the latest AI benchmarks", {}, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "required");
});

it("E5 end-to-end: '查一下我的文件' + file_paths is optional when SR is absent", () => {
  const spec = createTaskSpec("查一下我的文件里写了什么", {
    file_paths: ["a.docx"]
  }, {});
  assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, "optional");
  assert.equal(spec.routing_status, "sr_not_invoked");
  // Don't assert exact executor — this check only locks the mixed-intent
  // policy boundary.
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
