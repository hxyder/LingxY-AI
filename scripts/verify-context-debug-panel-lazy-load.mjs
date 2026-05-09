import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path) {
  assert.ok(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, "utf8");
}

const html = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const detailRenderer = read("src/desktop/renderer/console-task-detail.mjs");
const css = read("src/desktop/renderer/shared-tasks.css");
const tests = read("tests/behavior/context-debug-panel.test.mjs");
const docs = read("docs/architecture/agent-runtime-spine.md");
const performance = read("docs/architecture/electron-js-runtime-performance-plan.md");

assert.match(html, /id="taskContextDebugPanel"/, "task detail must include context debug panel shell");
assert.match(html, /id="taskContextDebugBody"/, "task detail must include lazy context debug body");

assert.match(detailRenderer, /buildContextDebugPanelView/, "renderer helper must build compact context debug view");
assert.match(detailRenderer, /renderContextDebugPanel/, "renderer helper must render compact context debug panel");
assert.match(detailRenderer, /selectedLimit/, "context debug selected list must be bounded");
assert.match(detailRenderer, /omittedLimit/, "context debug omitted list must be bounded");
assert.match(detailRenderer, /data-context-debug-copy="1"/, "full context JSON must be copy-triggered");
assert.doesNotMatch(detailRenderer, /data-context-debug-json/, "full context JSON must not be embedded in DOM attributes");

assert.match(consoleJs, /renderContextDebugPanel/, "console must use shared context debug renderer");
assert.match(consoleJs, /copySelectedTaskContextDebugJson/, "console must lazy-copy full context JSON on demand");
assert.match(consoleJs, /JSON\.stringify\(compiledContext,\s*null,\s*2\)/,
  "full context JSON must be serialized only from the click handler");
assert.match(consoleJs, /data-context-debug-more/, "console must support bounded paging for large context lists");
assert.doesNotMatch(consoleJs, /data-context-debug-json/, "console must not store full context JSON in DOM attributes");

assert.match(css, /context-debug-panel/, "context debug panel must have bounded renderer styles");
assert.match(css, /overflow-wrap:\s*anywhere/, "context debug rows must not overflow narrow panels");

assert.match(tests, /keeps full JSON out of the DOM/, "tests must cover lazy JSON behavior");
assert.match(tests, /session, resolver, artifact, selected, and omitted/, "tests must cover debug summary content");

assert.match(docs, /UX-001[\s\S]{0,80}\| Done \|/, "docs must mark UX-001 done");
assert.match(docs, /Context debug panel/, "docs must describe context debug panel");
assert.match(docs, /Copy JSON/, "docs must describe copy-only full JSON");
assert.match(performance, /Context debug panel[\s\S]{0,260}lazy/i,
  "performance plan must record lazy context debug behavior");

console.log("[verify-context-debug-panel-lazy-load] context debug panel lazy loading verified");
