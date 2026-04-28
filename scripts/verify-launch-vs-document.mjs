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
 * 2. P4-RQ I2 architecture lock-in: app launch is not a regex fast path.
 *    `extractPureLaunchApp` is only boundary evidence for the LLM-first
 *    pipeline. The retired fast-path exports must stay deleted.
 *
 * Regression refs: UCA-177 (cold-starting the app was creating
 * documents); commit b1dc22c "fix app launch being misread as
 * document output"; commit fast-path-router.mjs lines 8-12.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractPureLaunchApp } from "../src/service/core/router/fast-path-router.mjs";
import { classifyGoal, createTaskSpec } from "../src/service/core/task-spec.mjs";
import { routeIntent } from "../src/service/core/router/intent-router.mjs";
import { detectRequestedOutputFormatForTask } from "../src/service/executors/kimi/output-format.mjs";
import { shouldConsultSemanticRouter } from "../src/service/core/policy/tool-policy-resolver.mjs";

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

// ── 3. P4-RQ I2 lock-in: retired fast-path exports stay gone. ─────────
const launchHelperSource = readFileSync(new URL("../src/service/core/router/fast-path-router.mjs", import.meta.url), "utf8");
assert.ok(!/export function tryFastPath|export function extractFirstTier0Action|export function hasCompoundIntent/.test(launchHelperSource),
  "retired fast-path exports must not come back");

// ── 4. classifyGoal() still recognises pure launches at the goal layer. ─
//      The goal classifier runs INSIDE the planner path that I2 hands the
//      task off to. Goal classification is orthogonal to the fast-path
//      removal: the planner still uses classifyGoal to pick the right tool.
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

for (const command of ["打开ppt", "打开excel", "打开outlook"]) {
  const route = routeIntent(command);
  const spec = createTaskSpec(command, {}, route);
  assert.equal(spec.goal, "launch_and_act",
    `${command} must be a launch action, not a connector/file-generation request`);
  assert.equal(spec.connector_domain, false,
    `${command} must not activate connector-domain routing just because the app name is Outlook/Gmail-like`);
  assert.equal(spec.routing_status, "ok_deterministic",
    `${command} is a narrow side-effect hard signal; SR outage must not degrade routing`);
  assert.equal(spec.artifact.required, false,
    `${command} must not require a generated artifact`);
  assert.deepEqual(spec.suggested_formats, [],
    `${command} must not suggest pptx/xlsx/docx formats`);
  const requested = detectRequestedOutputFormatForTask({ user_command: command, task_spec: spec });
  assert.equal(requested.id, "conversational",
    `${command} must not trigger fallback artifact creation`);
  assert.equal(shouldConsultSemanticRouter({ signals: {}, contextPacket: {}, text: command }), false,
    `${command} must not wait for SR before executing a pure app launch`);
}

// ── 6. But a real document ask is still classified correctly. ──────────
const docSpec = createTaskSpec("帮我生成一份word文档");
assert.equal(docSpec.goal, "generate_document",
  "生成 word 文档 must still be classified as generate_document");
assert.equal(docSpec.artifact.required, true);
assert.equal(docSpec.artifact.kind, "docx");

console.log("ok verify-launch-vs-document");
