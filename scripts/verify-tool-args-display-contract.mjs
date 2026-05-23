import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderTimelineEntry } from "../src/desktop/renderer/console-task-timeline.mjs";
import {
  formatToolArgsPreview,
  formatToolDisplayName
} from "../src/desktop/renderer/tool-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const scheduleArgs = {
  name: "提醒备份审计报告",
  description: "明晚8点提醒用户备份审计报告",
  trigger: {
    natural_language: "2026-05-08 20:00 美国东部时间"
  },
  action: {
    type: "task",
    target: "提醒备份",
    params: {
      userCommand: "现在是晚上8点，提醒我备份审计报告"
    }
  }
};

const preview = formatToolArgsPreview("create_scheduled_task", scheduleArgs);
assert.match(preview, /Task · 提醒备份审计报告/);
assert.match(preview, /Time · 2026-05-08 20:00 美国东部时间/);
assert.match(preview, /Action · 提醒备份/);
assert.doesNotMatch(preview, /"userCommand"|"\w+":|\{|\}/);
assert.equal(formatToolDisplayName("Create Scheduled Task"), "Create scheduled task");

const html = renderTimelineEntry({
  event_type: "tool_call_started",
  ts: "2026-05-08T12:00:00.000Z",
  payload: {
    tool_id: "create_scheduled_task",
    args: scheduleArgs
  }
});
assert.match(html, /Args summary/);
assert.match(html, /提醒备份审计报告/);
assert.doesNotMatch(html, /Create Scheduled Task\s*\{/);
assert.doesNotMatch(html, /"name"|"trigger"|"action"|"userCommand"/);
assert.doesNotMatch(html, /<pre class="mono"[^>]*>\s*\{/);

const fallbackHtml = renderTimelineEntry({
  event_type: "tool_call_started",
  ts: "2026-05-08T12:00:00.000Z",
  payload: {
    tool_id: "unknown_private_tool",
    args: {
      account: "private@example.com",
      nested: { secret: "do-not-render" }
    }
  }
});
assert.match(fallbackHtml, /Args collapsed/);
assert.doesNotMatch(fallbackHtml, /private@example\.com|do-not-render|"nested"|\{/);

const timelineSource = readFileSync(
  path.join(root, "src/desktop/renderer/console-task-timeline.mjs"),
  "utf8"
);
assert.doesNotMatch(timelineSource, /JSON\.stringify\(payload\.args/);

console.log("tool args display contract ok");
