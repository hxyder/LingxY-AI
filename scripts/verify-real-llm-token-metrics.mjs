#!/usr/bin/env node
import assert from "node:assert/strict";

import { collectTokenMetrics } from "./real-llm-test/token-metrics.mjs";

let pass = 0;
function ok(label) {
  pass += 1;
  process.stdout.write(`PASS  ${label}\n`);
}

{
  const metrics = collectTokenMetrics([
    {
      event_type: "legacy_usage",
      payload: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }
    },
    {
      event_type: "llm_usage",
      payload: {
        call_site: "tool_using.planner",
        iteration: 1,
        provider_id: "deepseek",
        model: "deepseek-v4-flash",
        stream: true,
        prompt_segments_estimate: {
          estimator: "default_chars_div_4",
          total_estimated_tokens: 12,
          segments: [{ name: "system", estimated_tokens: 8 }, { name: "current", estimated_tokens: 4 }]
        },
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 7,
          prompt_cache_miss_tokens: 3
        }
      }
    }
  ]);
  assert.equal(metrics.token_usage_source, "llm_usage");
  assert.equal(metrics.token_usage.input_tokens, 10);
  assert.equal(metrics.token_usage.output_tokens, 5);
  assert.equal(metrics.token_usage.total_tokens, 15);
  assert.equal(metrics.token_usage.cache_hit_tokens, 7);
  assert.equal(metrics.token_usage.cache_miss_tokens, 3);
  assert.equal(metrics.llm_usage_call_count, 1);
  assert.equal(metrics.llm_usage_calls[0].call_site, "tool_using.planner");
  assert.equal(metrics.llm_usage_calls[0].prompt_segments_estimate.total_estimated_tokens, 12);
  assert.deepEqual(metrics.llm_usage_calls[0].prompt_estimate_calibration, {
    actual_input_tokens: 10,
    estimated_input_tokens: 12,
    delta_tokens: 2,
    estimate_to_actual_ratio: 1.2,
    absolute_error_pct: 0.2
  });
  assert.deepEqual(metrics.prompt_estimate_calibration, {
    call_count: 1,
    actual_input_tokens: 10,
    estimated_input_tokens: 12,
    delta_tokens: 2,
    estimate_to_actual_ratio: 1.2,
    absolute_error_pct: 0.2
  });
  ok("llm_usage events win over legacy usage payloads");
}

{
  const metrics = collectTokenMetrics([
    {
      event_type: "planner_result",
      payload: {
        token_usage: {
          prompt_tokens: 11,
          completion_tokens: 4
        }
      }
    }
  ]);
  assert.equal(metrics.token_usage_source, "legacy_event_payload");
  assert.equal(metrics.token_usage.input_tokens, 11);
  assert.equal(metrics.token_usage.output_tokens, 4);
  assert.equal(metrics.token_usage.total_tokens, 15);
  assert.equal(metrics.llm_usage_call_count, 0);
  assert.deepEqual(metrics.llm_usage_calls, []);
  ok("legacy payloads remain a fallback for older reports");
}

{
  const metrics = collectTokenMetrics([
    { event_type: "log", payload: { message: "hello" } },
    { event_type: "llm_usage", payload: { usage: { input_tokens: -1, output_tokens: 0 } } }
  ]);
  assert.equal(metrics.token_usage, null);
  assert.equal(metrics.token_usage_source, null);
  assert.equal(metrics.llm_usage_call_count, 0);
  assert.equal(metrics.prompt_estimate_calibration, null);
  ok("empty or invalid usage is ignored");
}

{
  const metrics = collectTokenMetrics([
    {
      event_type: "llm_usage",
      payload: {
        usage: { input_tokens: 100, output_tokens: 10 },
        prompt_segments_estimate: {
          segments: [
            { name: "system", estimated_tokens: 60 },
            { name: "current", estimated_tokens: 20 }
          ]
        }
      }
    },
    {
      event_type: "llm_usage",
      payload: {
        usage: { input_tokens: 50, output_tokens: 5 },
        prompt_segments_estimate: { total_estimated_tokens: 70, segments: [] }
      }
    }
  ]);
  assert.deepEqual(metrics.prompt_estimate_calibration, {
    call_count: 2,
    actual_input_tokens: 150,
    estimated_input_tokens: 150,
    delta_tokens: 0,
    estimate_to_actual_ratio: 1,
    absolute_error_pct: 0
  });
  ok("prompt segment estimates are calibrated against provider input tokens");
}

process.stdout.write(`\n${pass} pass / 0 fail\n`);
