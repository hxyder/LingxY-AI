#!/usr/bin/env node
/**
 * verify-launch-vs-document.mjs — UCA-177
 *
 * Locks in the fix for "opening the app auto-creates a document":
 *   - "打开word"          → pure app launch (no file format detected)
 *   - "打开Excel"          → pure app launch
 *   - "打开word文档"        → NOT a launch; NOT a document generation either
 *                            (classifies as qa / open_or_reveal_file at worst).
 *   - "生成一份word文档"    → still correctly classified as generate_document.
 *
 * Regression ref: user reported that cold-starting the app was "creating
 * documents" because "打开 word" was being read as an intent to generate
 * a docx artifact. The fix landed across fast-path-router.mjs,
 * intent-router.mjs, and task-spec.mjs — this script keeps them honest.
 */

import assert from "node:assert/strict";
import { extractPureLaunchApp, extractFirstTier0Action, tryFastPath } from "../src/service/core/router/fast-path-router.mjs";
import { classifyGoal, createTaskSpec } from "../src/service/core/task-spec.mjs";

// ── 1. Pure launches: "打开word" (no space) matches now that \s+ → \s*. ──
assert.equal(extractPureLaunchApp("打开word"), "word",
  "extractPureLaunchApp must match 打开word (no space)");
assert.equal(extractPureLaunchApp("打开 word"), "word",
  "extractPureLaunchApp must still match 打开 word (with space)");
assert.equal(extractPureLaunchApp("open chrome"), "chrome",
  "extractPureLaunchApp must handle English verbs");
assert.equal(extractPureLaunchApp("启动Excel"), "Excel",
  "extractPureLaunchApp must match 启动Excel");

// ── 2. File-oriented phrasing is NOT an app launch. ────────────────────
assert.equal(extractPureLaunchApp("打开word文档"), null,
  "打开word文档 is about files, not app launch");
assert.equal(extractPureLaunchApp("打开一个docx"), null,
  "bare docx suffix is not a launch candidate");
assert.equal(extractPureLaunchApp("open the pptx"), null,
  "bare pptx suffix is not a launch candidate");

// ── 3. Fast-path + first-action agree with the guard. ──────────────────
const fp = tryFastPath("打开word", {});
assert.ok(fp, "tryFastPath must return a plan for 打开word");
assert.equal(fp.tool, "launch_app");
assert.equal(fp.args.app, "word");

assert.equal(tryFastPath("打开word文档", {}), null,
  "tryFastPath must NOT promise a fast action for 打开word文档");

const firstAct = extractFirstTier0Action("打开word");
assert.equal(firstAct?.tool, "launch_app",
  "extractFirstTier0Action routes 打开word to launch_app");
assert.equal(extractFirstTier0Action("打开word文档"), null,
  "extractFirstTier0Action must reject 打开word文档 as a candidate");

// ── 4. classifyGoal() short-circuits pure launches. ────────────────────
assert.equal(classifyGoal("打开word"), "launch_and_act",
  "classifyGoal must short-circuit 打开word → launch_and_act");
assert.equal(classifyGoal("open VSCode"), "launch_and_act",
  "classifyGoal must short-circuit English launches too");

// ── 5. createTaskSpec() must NOT produce a document artifact for a pure
// launch — the entire point of the fix.                                 ──
const launchSpec = createTaskSpec("打开word");
assert.equal(launchSpec.goal, "launch_and_act");
assert.equal(launchSpec.artifact.required, false,
  "pure launch must not claim an artifact");
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
