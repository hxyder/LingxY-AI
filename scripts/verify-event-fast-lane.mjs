#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskEventStream } from "../src/service/events/sse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

{
  const bus = createEventBusScaffold();
  const published = [];
  bus.subscribe((event) => published.push(event.event_type));
  bus.publish({ event_id: "1", task_id: "task", event_type: "started", payload: {} });
  bus.publish({ event_id: "2", task_id: "task", event_type: "text_delta", payload: { delta: "a" } });
  bus.publish({ event_id: "3", task_id: "task", event_type: "tool_input_delta", payload: { partial_json: "{}" } });
  bus.publish({ event_id: "4", task_id: "task", event_type: "reasoning_delta", payload: { delta: "thinking" } });
  bus.publish({ event_id: "5", task_id: "task", event_type: "success", payload: {} });

  assert.deepEqual(published, ["started", "text_delta", "tool_input_delta", "reasoning_delta", "success"]);
  assert.deepEqual(bus.snapshot().map((event) => event.event_type), ["started", "success"]);
}

{
  const bus = createEventBusScaffold();
  let replayReads = 0;
  const received = [];
  const stream = createTaskEventStream({
    taskId: "task",
    eventBus: bus,
    since: null,
    store: {
      getTaskEventsSince() {
        replayReads += 1;
        return [];
      }
    }
  });
  assert.deepEqual(stream.replay, []);
  assert.equal(replayReads, 1, "SSE stream should read replay once on subscription setup");
  const unsubscribe = stream.subscribe((event) => received.push(event.event_type));
  bus.publish({ event_id: "1", task_id: "task", event_type: "text_delta", payload: { delta: "a" } });
  bus.publish({ event_id: "2", task_id: "task", event_type: "tool_input_delta", payload: { partial_json: "{}" } });
  unsubscribe();
  assert.deepEqual(received, ["text_delta", "tool_input_delta"]);
  assert.equal(replayReads, 1, "live SSE deltas without since must not re-query durable event replay");
}

const eventBus = read("src/service/core/events/event-bus.mjs");
const eventEmitter = read("src/service/core/task-runtime/event-emitter.mjs");
const eventLog = read("src/service/core/task-runtime/event-log.mjs");
const sse = read("src/service/events/sse.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const overlayJs = read("src/desktop/renderer/overlay.js");
const livePreviewJs = read("src/desktop/renderer/live-preview.js");

assert.match(eventBus, /HIGH_FREQUENCY_EVENT_TYPES[\s\S]{0,180}"text_delta"[\s\S]{0,120}"tool_input_delta"[\s\S]{0,120}"reasoning_delta"/,
  "event bus must classify high-frequency stream events");
assert.match(eventBus, /if \(!HIGH_FREQUENCY_EVENT_TYPES\.has\(event\?\.event_type\)\)[\s\S]{0,80}events\.push\(event\)/,
  "event bus snapshot must skip high-frequency events while still publishing them");
assert.match(eventEmitter, /EPHEMERAL_EVENT_TYPES[\s\S]{0,160}"text_delta"[\s\S]{0,120}"tool_input_delta"/,
  "task event emitter must keep stream deltas ephemeral");
assert.match(eventLog, /JSONL_SKIP_EVENT_TYPES[\s\S]{0,120}"text_delta"[\s\S]{0,80}"tool_input_delta"/,
  "task event log must skip stream deltas");
assert.match(sse, /if \(since\) \{[\s\S]{0,120}store\.getTaskEventsSince\(taskId, since\)/,
  "SSE live stream must only query replay store while applying a since filter");

assert.match(consoleJs, /const pendingConsoleChatTextDeltas = new Map\(\)/,
  "console chat must queue text deltas");
assert.match(consoleJs, /requestAnimationFrame[\s\S]{0,260}flushConsoleChatTextDeltas\(\)/,
  "console chat must flush text deltas on animation frames");
assert.match(consoleJs, /frame\.event === "text_delta"[\s\S]{0,120}queueConsoleChatTextDelta\(taskId,/,
  "console chat SSE handler must queue text_delta instead of rendering immediately");
assert.match(consoleJs, /frame\.event === "inline_result"[\s\S]{0,120}flushConsoleChatTextDeltas\(taskId\)/,
  "console chat must flush queued deltas before inline_result");
assert.match(consoleJs, /frame\.event === "success" \|\| frame\.event === "partial_success"[\s\S]{0,120}flushConsoleChatTextDeltas\(taskId\)/,
  "console chat must flush queued deltas before terminal success");

assert.match(overlayJs, /pendingOverlayTextDeltaText/,
  "overlay must queue text deltas");
assert.match(overlayJs, /function scheduleOverlayFrame[\s\S]{0,160}requestAnimationFrame/,
  "overlay must centralize stream flush scheduling on animation frames");
assert.match(overlayJs, /scheduleOverlayTextDeltaFlush[\s\S]{0,180}scheduleOverlayFrame[\s\S]{0,120}flushOverlayTextDelta\(\)/,
  "overlay must flush text deltas through the animation-frame scheduler");
assert.match(overlayJs, /frame\.event === "text_delta"[\s\S]{0,360}queueOverlayTextDelta\(frameTaskId, delta\)/,
  "overlay SSE handler must queue text_delta instead of rendering immediately");
assert.match(overlayJs, /frame\.event === "inline_result"[\s\S]{0,80}flushOverlayTextDelta\(\)/,
  "overlay must flush queued deltas before inline_result");
assert.match(overlayJs, /\["success", "partial_success", "failed", "cancelled"\]\.includes\(frame\.event\)[\s\S]{0,80}flushOverlayTextDelta\(\)/,
  "overlay must flush queued deltas before terminal events");

assert.match(livePreviewJs, /const pendingPreviewDeltas = new Map\(\)/,
  "live preview must queue tool_input_delta frames");
assert.match(livePreviewJs, /requestAnimationFrame[\s\S]{0,260}flushPreviewDeltas\(\)/,
  "live preview must flush preview deltas on animation frames");
assert.match(livePreviewJs, /pendingPreviewDeltas\.set\(key, payload\)/,
  "live preview must coalesce to the latest task/tool partial_json");
assert.match(livePreviewJs, /function commit\(payload = \{\}\) \{[\s\S]{0,80}flushPreviewDeltas\(\)/,
  "live preview must flush queued deltas before commit");

console.log("event fast lane ok");
