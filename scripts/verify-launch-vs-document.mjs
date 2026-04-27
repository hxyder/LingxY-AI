#!/usr/bin/env node
/**
 * verify-launch-vs-document.mjs — UCA-177 + P4-RQ I2
 *
 * Two layered guarantees this test pins down:
 *
 * 1. The original UCA-177 fix: "opening the app does not auto-create
 *    a document". A pure launch ("打开word") must not be misclassified
 *    as `generate_document`; a real document request ("生成一份word
 *    文档") must still be classified as `generate_document`.
 *
 * 2. P4-RQ I2 architecture lock-in: APP LAUNCH IS NOT A REGEX FAST
 *    PATH. Per the boundary rule in fast-path-router.mjs (lines 8-12)
 *    and the b1dc22c rationale ("fix app launch being misread as
 *    document output"), `tryFastPath` and `extractFirstTier0Action`
 *    no longer short-circuit "打开word" to a deterministic
 *    `launch_app` plan. The normal planner / tool policy /
 *    SuccessContract own the decision. `extractPureLaunchApp` stays
 *    as a BOUNDARY HELPER (it tells callers whether the *text* looks
 *    like a pure launch candidate without committing to one) but is
 *    no longer wired into the routers themselves.
 *
 *    Why the lock-in matters: the only way to satisfy this test is
 *    to keep the deliberate "let the planner decide" architecture.
 *    Re-introducing a Tier-0 launch_app branch would re-open the
 *    "打开word文档 / 打开一个docx" misclassification this commit
 *    set was created to fix. Don't fix this test by adding a new
 *    regex or by restoring the Tier-0 wiring.
 *
 * Regression refs: UCA-177 (cold-starting the app was creating
 * documents); commit b1dc22c "fix app launch being misread as
 * document output"; commit fast-path-router.mjs lines 8-12.
 */

import assert from "node:assert/strict";
import { extractPureLaunchApp, extractFirstTier0Action, tryFastPath } from "../src/service/core/router/fast-path-router.mjs";
import { classifyGoal, createTaskSpec } from "../src/service/core/task-spec.mjs";

// ── 1. extractPureLaunchApp still recognises pure launch candidates ────
//      (boundary helper — does NOT commit to launch_app on its own).
assert.equal(extractPureLaunchApp("打开word"), "word",
  "extractPureLaunchApp must match 打开word (no space) — boundary helper");
assert.equal(extractPureLaunchApp("打开 word"), "word",
  "extractPureLaunchApp must still match 打开 word (with space)");
assert.equal(extractPureLaunchApp("open chrome"), "chrome",
  "extractPureLaunchApp must handle English verbs");
assert.equal(extractPureLaunchApp("启动Excel"), "Excel",
  "extractPureLaunchApp must match 启动Excel");

// ── 2. File-oriented phrasing is NOT a pure launch (boundary). ─────────
assert.equal(extractPureLaunchApp("打开word文档"), null,
  "打开word文档 is about files, not app launch");
assert.equal(extractPureLaunchApp("打开一个docx"), null,
  "bare docx suffix is not a launch candidate");
assert.equal(extractPureLaunchApp("open the pptx"), null,
  "bare pptx suffix is not a launch candidate");

// ── 3. P4-RQ I2 lock-in: app launch is NOT a regex fast path. ──────────
//      The boundary helper above can recognise "打开word" as a launch
//      candidate, but the routers must NOT short-circuit on it. The
//      planner / tool policy / SuccessContract own the decision so the
//      "打开word文档 / 打开一个docx" misclassification this commit set
//      was created to fix cannot recur via a Tier-0 detour.
assert.equal(tryFastPath("打开word", {}), null,
  "P4-RQ I2: app launch must NOT be a Tier-0 fast path — let the planner decide");
assert.equal(tryFastPath("打开 word", {}), null,
  "P4-RQ I2: spaced launch phrasing also stays out of the fast path");
assert.equal(tryFastPath("启动Excel", {}), null,
  "P4-RQ I2: 启动X stays out of the fast path");
assert.equal(tryFastPath("open chrome", {}), null,
  "P4-RQ I2: English open X stays out of the fast path");

// File-oriented phrasings are also still null (unchanged behaviour).
assert.equal(tryFastPath("打开word文档", {}), null,
  "tryFastPath must NOT promise a fast action for 打开word文档");

// extractFirstTier0Action: today only URL opens are Tier-0; app launches
// are deliberately not. Lock that in.
assert.equal(extractFirstTier0Action("打开word"), null,
  "P4-RQ I2: extractFirstTier0Action must NOT route 打开word to launch_app");
assert.equal(extractFirstTier0Action("启动Excel"), null,
  "P4-RQ I2: extractFirstTier0Action must NOT route 启动Excel to launch_app");
assert.equal(extractFirstTier0Action("打开word文档"), null,
  "extractFirstTier0Action must reject 打开word文档 as a candidate");

// Sanity: the URL Tier-0 path is unaffected — that's still the ONLY
// short-circuit. Documents the contract that "Tier-0 today = open_url
// only".
const urlFp = tryFastPath("打开 https://example.com", {});
assert.equal(urlFp?.tool, "open_url",
  "URL Tier-0 path is preserved — only app launches are excluded from regex fast paths");
const urlFirst = extractFirstTier0Action("https://example.com");
assert.equal(urlFirst?.tool, "open_url",
  "extractFirstTier0Action still routes URLs to open_url");

// ── 4. classifyGoal() still recognises pure launches at the goal layer. ─
//      The goal classifier runs INSIDE the planner path that I2 hands the
//      task off to. Goal classification is orthogonal to the fast-path
//      decision: even though tryFastPath returns null, the planner uses
//      classifyGoal to pick the right tool. This test pins that the
//      planner-side classification is still correct.
assert.equal(classifyGoal("打开word"), "launch_and_act",
  "classifyGoal must recognise 打开word → launch_and_act inside the planner path");
assert.equal(classifyGoal("open VSCode"), "launch_and_act",
  "classifyGoal must recognise English launches too");

// ── 5. createTaskSpec() must NOT produce a document artifact for a pure
//      launch — the original UCA-177 guarantee. With I2 the route is now
//      planner → classifyGoal → launch_and_act, NOT regex Tier-0; the
//      end-state guarantee is identical (no docx artifact stamped).      ─
const launchSpec = createTaskSpec("打开word");
assert.equal(launchSpec.goal, "launch_and_act");
assert.equal(launchSpec.artifact.required, false,
  "pure launch must not claim an artifact (P4-RQ I2 lock-in)");
assert.equal(launchSpec.artifact.kind, null,
  "pure launch must not pick a doc kind");
assert.deepEqual(launchSpec.suggested_formats, [],
  "pure launch must not suggest formats");

// ── 6. But a real document ask is still classified correctly. ──────────
const docSpec = createTaskSpec("帮我生成一份word文档");
assert.equal(docSpec.goal, "generate_document",
  "生成 word 文档 must still be classified as generate_document");
assert.equal(docSpec.artifact.required, true);
assert.equal(docSpec.artifact.kind, "docx");

console.log("ok verify-launch-vs-document");
