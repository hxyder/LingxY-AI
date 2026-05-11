import fs from "node:fs";
import assert from "node:assert/strict";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const contract = read("scripts/gui-smoke-perf-contract.mjs");
const runner = read("scripts/run-electron-gui-smoke.mjs");
const main = read("src/desktop/tray/electron-main.mjs");
const smokeRunner = read("src/desktop/smoke/desktop-gui-smoke-runner.mjs");
const tests = read("tests/behavior/desktop-gui-perf-smoke.test.mjs");
const packageJson = read("package.json");
const manifest = read("scripts/check-manifest.mjs");
const structure = read("scripts/verify-structure.mjs");
const performancePlan = read("docs/architecture/electron-js-runtime-performance-plan.md");
const agents = read("AGENTS.md");
const spine = read("docs/architecture/agent-runtime-spine.md");

assert.match(contract, /DEFAULT_DESKTOP_GUI_SMOKE_PERF_BUDGET/,
  "desktop GUI perf contract must define default budgets");
assert.match(contract, /validateDesktopGuiSmokePerfResult/,
  "desktop GUI perf contract must validate smoke results");
assert.match(contract, /startup_ms/,
  "desktop GUI perf contract must require startup_ms");
assert.match(contract, /first_window_ready_ms/,
  "desktop GUI perf contract must require first_window_ready_ms");
assert.match(contract, /interaction_ms/,
  "desktop GUI perf contract must require interaction_ms");
assert.match(contract, /total_ms/,
  "desktop GUI perf contract must require total_ms");
assert.match(contract, /minChecks/,
  "desktop GUI perf contract must guard against tiny fake pass reports");

assert.match(runner, /validateDesktopGuiSmokePerfResult/,
  "Electron GUI smoke runner must enforce perf contract");
assert.match(runner, /readDesktopGuiSmokePerfBudget/,
  "Electron GUI smoke runner must read configurable budgets");
assert.match(contract, /LINGXY_ELECTRON_GUI_SMOKE_STARTUP_BUDGET_MS/,
  "desktop GUI perf contract must expose startup budget env override");
assert.match(runner, /summarizeDesktopGuiSmokePerf/,
  "Electron GUI smoke runner must print perf summary on success");

assert.match(main, /DESKTOP_GUI_SMOKE_PROCESS_STARTED_AT/,
  "Electron main must measure smoke timing from process start");
assert.match(smokeRunner, /buildPerfReport/,
  "desktop-gui-smoke-runner must build a structured smoke perf report");
assert.match(smokeRunner, /firstWindowReadyMs/,
  "desktop-gui-smoke-runner must report first-window readiness");
assert.match(smokeRunner, /writeDesktopGuiSmokeResult\(\{\s*ok:\s*true,\s*checks,\s*perf:/,
  "successful GUI smoke result must include perf");
assert.match(smokeRunner, /ok:\s*false[\s\S]{0,180}perf:\s*buildPerfReport\(\)/,
  "failed GUI smoke result must include partial perf for diagnostics");
// Reverse assertions: electron-main.mjs must NOT own migrated smoke
// helpers directly (Codex 2B.47 round-1: prevent parallel ownership).
assert.doesNotMatch(main, /function writeDesktopGuiSmokeResult/,
  "electron-main.mjs must NOT define writeDesktopGuiSmokeResult (moved to desktop-gui-smoke-runner.mjs)");
assert.doesNotMatch(main, /function waitForDesktopGuiSmoke/,
  "electron-main.mjs must NOT define waitForDesktopGuiSmoke (moved to desktop-gui-smoke-runner.mjs)");
assert.doesNotMatch(main, /function runDesktopGuiSmoke/,
  "electron-main.mjs must NOT define runDesktopGuiSmoke (moved to desktop-gui-smoke-runner.mjs)");
// The outer failure path calls writeDesktopGuiSmokeResult (destructured
// from the factory) so unexpected runner rejections produce a
// machine-readable LINGXY_GUI_SMOKE_RESULT payload.
assert.match(main, /runDesktopGuiSmoke\(\)\.catch\(\s*\(\s*error\s*\)\s*=>\s*\{[\s\S]{0,120}writeDesktopGuiSmokeResult\(/,
  "electron-main.mjs outer smoke catch must call writeDesktopGuiSmokeResult on unexpected rejection");
assert.match(smokeRunner, /LINGXY_GUI_SMOKE_RESULT/,
  "desktop-gui-smoke-runner must emit LINGXY_GUI_SMOKE_RESULT for smoke results");
// Codex 2B.47 round-2: runner creation must appear before the GUI smoke
// setTimeout registration. If the dynamic electron-updater import is slow
// the timer could fire while runDesktopGuiSmoke is still in TDZ.
assert.match(main, /createDesktopGuiSmokeRunner\([\s\S]*setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]{0,80}runDesktopGuiSmoke\(\)/,
  "electron-main.mjs must createDesktopGuiSmokeRunner before scheduling the GUI smoke setTimeout");
assert.match(tests, /accepts bounded smoke metrics/,
  "behavior tests must cover bounded perf pass");
assert.match(tests, /rejects missing and over-budget metrics/,
  "behavior tests must cover missing and slow perf failures");
assert.match(packageJson, /verify:desktop-gui-perf-smoke/,
  "package.json must expose desktop GUI perf smoke verifier");
assert.match(manifest, /verify-desktop-gui-perf-smoke/,
  "check manifest must include desktop GUI perf smoke verifier");
assert.match(structure, /scripts\/gui-smoke-perf-contract\.mjs/,
  "structure verifier must require desktop GUI perf contract");
assert.match(structure, /tests\/behavior\/desktop-gui-perf-smoke\.test\.mjs/,
  "structure verifier must require desktop GUI perf tests");
assert.match(performancePlan, /\| PR-08 \| Desktop GUI perf smoke \| Done \|/,
  "performance plan must mark PR-08 done");

for (const docs of [agents, spine, performancePlan]) {
  assert.match(docs, /delete(?:[\s\S]{0,40})obsolete(?:[\s\S]{0,40})code|delete the old code/,
    "upgrade guardrails must require deleting obsolete code after replacement");
  assert.match(docs, /archive area/,
    "upgrade guardrails must allow explicit archive areas only with evidence");
  assert.match(docs, /variable\/name collisions/,
    "upgrade guardrails must check variable/name collisions after replacement");
}

assert.doesNotMatch(contract, /from\s+["'][^"']*electron/,
  "perf contract helper must not import Electron APIs");
assert.doesNotMatch(contract, /from\s+["'][^"']*desktop\/renderer/,
  "perf contract helper must not import renderer code");
assert.doesNotMatch(runner, /from\s+["'][^"']*desktop\/renderer/,
  "Electron GUI smoke runner must not import renderer code");

console.log("[verify-desktop-gui-perf-smoke] desktop GUI perf smoke contract verified");
