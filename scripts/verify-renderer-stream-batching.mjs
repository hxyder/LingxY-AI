import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function assertIncludes(source, relativePath, snippets) {
  for (const snippet of snippets) {
    assert.ok(
      source.includes(snippet),
      `${relativePath} must include streaming batching guard: ${snippet}`,
    );
  }
}

function assertNotMatches(source, relativePath, pattern, message) {
  assert.equal(
    pattern.test(source),
    false,
    `${relativePath}: ${message}`,
  );
}

function extractBranch(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing branch marker: ${marker}`);
  const nextElse = source.indexOf("} else if", start + marker.length);
  const nextPlain = source.indexOf("\n  if (frame.event", start + marker.length);
  const candidates = [nextElse, nextPlain].filter((idx) => idx > start);
  const end = candidates.length ? Math.min(...candidates) : Math.min(source.length, start + 700);
  return source.slice(start, end);
}

const consoleJs = read("src/desktop/renderer/console.js");
const overlayJs = read("src/desktop/renderer/overlay.js");
const selectedTaskStream = read("src/desktop/renderer/console-task-event-stream.mjs");
const livePreview = read("src/desktop/renderer/live-preview.js");
const previewStreaming = read("src/desktop/renderer/preview/streaming.js");
const previewWindow = read("src/desktop/renderer/preview-window.js");

assertIncludes(consoleJs, "src/desktop/renderer/console.js", [
  "const pendingConsoleChatTextDeltas = new Map();",
  "function queueConsoleChatTextDelta",
  "function flushConsoleChatTextDeltas",
  "let pendingConsoleChatThinkingDelta = \"\";",
  "function queueConsoleChatThinkingDelta",
  "function flushConsoleChatThinkingDelta",
  "requestAnimationFrame",
  "async runTextDeltaLoad",
  "progress_before_streaming"
]);

const consoleTextBranch = extractBranch(consoleJs, "frame.event === \"text_delta\"");
assert.match(consoleTextBranch, /queueConsoleChatTextDelta\(taskId,/);
assertNotMatches(
  consoleTextBranch,
  "src/desktop/renderer/console.js",
  /appendConsoleChatTextDelta\(/,
  "text_delta handler must queue text instead of mutating DOM per frame",
);

const consoleReasoningBranch = extractBranch(consoleJs, "frame.event === \"reasoning_delta\"");
assert.match(consoleReasoningBranch, /queueConsoleChatThinkingDelta\(/);
assertNotMatches(
  consoleReasoningBranch,
  "src/desktop/renderer/console.js",
  /appendConsoleChatThinkingDelta\(/,
  "reasoning_delta handler must queue thinking text instead of mutating DOM per frame",
);

assertIncludes(overlayJs, "src/desktop/renderer/overlay.js", [
  "let pendingOverlayTextDeltaText = \"\";",
  "function queueOverlayTextDelta",
  "function flushOverlayTextDelta",
  "let pendingOverlayThinkingDeltaText = \"\";",
  "function queueOverlayThinkingDelta",
  "function flushOverlayThinkingDelta",
  "function scheduleOverlayFrame",
  "async runTextDeltaLoad"
]);

const overlayTextBranch = extractBranch(overlayJs, "frame.event === \"text_delta\"");
assert.match(overlayTextBranch, /queueOverlayTextDelta\(frameTaskId,/);
assertNotMatches(
  overlayTextBranch,
  "src/desktop/renderer/overlay.js",
  /applyOverlayTextDelta\(/,
  "text_delta handler must queue text instead of mutating DOM per frame",
);

const overlayReasoningBranch = extractBranch(overlayJs, "frame.event === \"reasoning_delta\"");
assert.match(overlayReasoningBranch, /queueOverlayThinkingDelta\(/);
assertNotMatches(
  overlayReasoningBranch,
  "src/desktop/renderer/overlay.js",
  /appendThinkingDelta\(/,
  "reasoning_delta handler must queue thinking text instead of mutating DOM per frame",
);

assertIncludes(selectedTaskStream, "src/desktop/renderer/console-task-event-stream.mjs", [
  "let pendingSelectedTaskEvents = [];",
  "function queueSelectedTaskEventFrame",
  "function flushSelectedTaskEventBatch",
  "requestAnimationFrame",
  "queueSelectedTaskEventFrame(event);"
]);
assertNotMatches(
  selectedTaskStream,
  "src/desktop/renderer/console-task-event-stream.mjs",
  /onEvent\(event\)\s*\{\s*void handleSelectedTaskEventFrame\(event\);/s,
  "selected task SSE events must be frame-batched before detail rendering",
);

assertIncludes(livePreview, "src/desktop/renderer/live-preview.js", [
  "const pendingPreviewDeltas = new Map();",
  "function schedulePreviewDeltaFlush",
  "function flushPreviewDeltas",
  "requestAnimationFrame",
  "pendingPreviewDeltas.set(key, payload);"
]);

assertIncludes(previewStreaming, "src/desktop/renderer/preview/streaming.js", [
  "const STREAM_DEBOUNCE_MS = 150;",
  "const pendingRenders = new WeakMap();",
  "function scheduleRender",
  "setTimeout("
]);

assertIncludes(previewWindow, "src/desktop/renderer/preview-window.js", [
  "async runToolInputDeltaLoad",
  "uca:preview-window-delta"
]);

for (const [relativePath, source] of [
  ["src/desktop/renderer/console.js", consoleJs],
  ["src/desktop/renderer/overlay.js", overlayJs],
  ["src/desktop/renderer/live-preview.js", livePreview],
  ["src/desktop/renderer/preview-window.js", previewWindow]
]) {
  assertNotMatches(
    source,
    relativePath,
    /\.(?:textContent|innerHTML)\s*\+=/,
    "streaming renderers must not append directly to DOM string properties",
  );
}

console.log("[verify-renderer-stream-batching] renderer streaming batching guards verified");
