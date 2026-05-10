#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collectLlmUsageSummary } from "../src/shared/llm-usage-summary.mjs";
import { buildTaskDetailViewModel } from "../src/desktop/console/task-detail/view-model.mjs";
import {
  renderLlmUsagePanel,
  renderTaskKvGrid
} from "../src/desktop/renderer/console-task-detail.mjs";

const usageEvents = [
  {
    event_id: "evt_usage_1",
    ts: "2026-05-08T01:00:00.000Z",
    event_type: "llm_usage",
    payload: {
      call_site: "tool_using.planner",
      iteration: 1,
      provider_id: "deepseek",
      provider_name: "DeepSeek",
      model: "deepseek-v4-flash",
      stream: true,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        prompt_cache_hit_tokens: 70,
        prompt_cache_miss_tokens: 30
      },
      prompt_segments_estimate: {
        estimator: "default_chars_div_4",
        total_estimated_tokens: 95,
        segments: [
          { name: "system", estimated_tokens: 60 },
          { name: "current", estimated_tokens: 20 },
          { name: "tool_schemas", estimated_tokens: 15 }
        ]
      }
    }
  },
  {
    event_id: "evt_usage_2",
    ts: "2026-05-08T01:00:01.000Z",
    event_type: "llm_usage",
    payload: {
      call_site: "tool_using.final_composer",
      provider_id: "deepseek",
      model: "deepseek-v4-flash",
      usage: {
        input_tokens: 40,
        output_tokens: 10,
        cache_read_input_tokens: 25
      },
      prompt_segments_estimate: {
        estimator: "default_chars_div_4",
        segments: [
          { name: "system", estimated_tokens: 12 },
          { name: "current", estimated_tokens: 18 }
        ]
      }
    }
  }
];

{
  const summary = collectLlmUsageSummary(usageEvents);
  assert.equal(summary.call_count, 2);
  assert.equal(summary.totals.input_tokens, 140);
  assert.equal(summary.totals.output_tokens, 30);
  assert.equal(summary.totals.total_tokens, 170);
  assert.equal(summary.cache.hit_tokens, 70);
  assert.equal(summary.cache.miss_tokens, 30);
  assert.equal(summary.cache.read_input_tokens, 25);
  assert.deepEqual(
    summary.prompt_segments_estimate.segments.map((segment) => [segment.name, segment.estimated_tokens]),
    [["system", 72], ["current", 38], ["tool_schemas", 15]]
  );
}

{
  const vm = buildTaskDetailViewModel(
    {
      task_id: "task_usage_ui",
      status: "success",
      executor: "tool_using",
      context_packet: {}
    },
    usageEvents,
    []
  );
  assert.equal(vm.llmUsage.call_count, 2);
  assert.equal(vm.llmUsage.totals.total_tokens, 170);
}

{
  const html = renderLlmUsagePanel(usageEvents);
  assert.match(html, /LLM usage/);
  assert.match(html, /170 \(140 in \/ 30 out\)/);
  assert.match(html, /hit 70/);
  assert.match(html, /read 25/);
  assert.match(html, /tool_using\.planner/);
  assert.match(html, /system/);
  assert.match(html, /tool_schemas/);
  assert.equal(renderLlmUsagePanel([]), "");
}

{
  const consoleJs = readFileSync(new URL("../src/desktop/renderer/console.js", import.meta.url), "utf8");
  const overlayJs = readFileSync(new URL("../src/desktop/renderer/overlay.js", import.meta.url), "utf8");
  const smokeRunner = readFileSync(new URL("../src/desktop/tray/desktop-gui-smoke-runner.mjs", import.meta.url), "utf8");
  const sharedCss = readFileSync(new URL("../src/desktop/renderer/shared-tasks.css", import.meta.url), "utf8");
  assert.match(consoleJs, /renderLlmUsagePanel\(detail\.events \?\? \[\]\)/);
  assert.match(consoleJs, /\$\{llmUsageBlock\}/);
  assert.match(overlayJs, /collectLlmUsageSummary/);
  assert.match(overlayJs, /function renderOverlayLlmUsageTimeline\(frame\)/);
  assert.match(overlayJs, /event === "llm_usage"[\s\S]{0,120}renderOverlayLlmUsageTimeline\(frame\)/);
  assert.match(overlayJs, /runLlmUsageTimeline/);
  assert.match(smokeRunner, /overlay_llm_usage_timeline/);
  assert.match(sharedCss, /\.llm-usage-panel/);
  assert.match(sharedCss, /\.llm-segment-row/);
  assert.equal(renderTaskKvGrid({ tokens: "10" }).includes(">Tokens<"), true);
}

console.log("Task LLM usage UI verification passed.");
