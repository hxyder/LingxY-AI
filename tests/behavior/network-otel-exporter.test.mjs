import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNetworkOtelRequestBody,
  createNetworkOtelExporter
} from "../../src/service/observability/network-otel-exporter.mjs";
import {
  normalizeNetworkOtelConfig,
  sanitizeNetworkOtelEndpoint
} from "../../src/shared/network-otel-config.mjs";

function makeStore() {
  return {
    getTaskEvents(taskId) {
      if (taskId !== "task_otel") return [];
      return [
        { ts: "2026-05-12T10:00:00.000Z", event_type: "tool_call_started", payload: { tool_id: "read_file", tool_call_id: "c1" } },
        { ts: "2026-05-12T10:00:00.040Z", event_type: "tool_call_completed", payload: { tool_id: "read_file", tool_call_id: "c1", success: true, observation: "raw user text should not export" } },
        { ts: "2026-05-12T10:00:00.050Z", event_type: "llm_usage", payload: { call_site: "final_composer", provider_id: "openai", model: "gpt-5.4-mini" } },
        { ts: "2026-05-12T10:00:00.060Z", event_type: "status_changed", payload: { status: "success" } }
      ];
    }
  };
}

test("network OTEL config requires opt-in consent and sanitizes endpoints", () => {
  assert.equal(sanitizeNetworkOtelEndpoint("https://user:pass@otel.example.test/v1/traces#secret"), "https://otel.example.test/v1/traces");
  assert.equal(sanitizeNetworkOtelEndpoint("file:///tmp/spans.json"), "");
  const disabled = normalizeNetworkOtelConfig({ observability: { networkOtel: { enabled: true } } });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.active, false);
  const active = normalizeNetworkOtelConfig({
    observability: {
      networkOtel: {
        enabled: true,
        endpoint: "https://otel.example.test/v1/traces",
        consent: { accepted: true }
      }
    }
  });
  assert.equal(active.enabled, true);
  assert.equal(active.active, true);
});

test("network OTEL request body is OTLP-shaped and omits raw payload detail", () => {
  const body = buildNetworkOtelRequestBody([{
    task_id: "task_otel",
    span_count: 1,
    spans: [{
      span_id: "tool:read_file:1",
      name: "tool.call",
      kind: "tool",
      phase: "tool",
      status: "success",
      start_ms: 1000,
      end_ms: 1050,
      attributes: {
        label: "read_file",
        detail: "raw path and content should not appear"
      }
    }]
  }]);
  const text = JSON.stringify(body);
  assert.match(text, /resourceSpans/u);
  assert.match(text, /lingxy\.redaction/u);
  assert.match(text, /read_file/u);
  assert.doesNotMatch(text, /raw path and content/u);
});

test("network OTEL exporter queues terminal task spans and posts asynchronously", async () => {
  const calls = [];
  const exporter = createNetworkOtelExporter({
    store: makeStore(),
    configStore: {
      load() {
        return {
          observability: {
            networkOtel: {
              enabled: true,
              endpoint: "https://otel.example.test/v1/traces",
              consent: { accepted: true }
            }
          }
        };
      }
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200 };
    }
  });
  exporter.recordTaskEvent({
    taskId: "task_otel",
    eventType: "status_changed",
    payload: { status: "success" }
  });
  await exporter.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://otel.example.test/v1/traces");
  assert.equal(exporter.getStatus().exportedSpans, 2);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /raw user text/u);
});
