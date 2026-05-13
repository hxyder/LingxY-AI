#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  buildNetworkOtelRequestBody,
  createNetworkOtelExporter
} from "../src/service/observability/network-otel-exporter.mjs";
import { normalizeNetworkOtelConfig } from "../src/shared/network-otel-config.mjs";

const exporter = readFileSync("src/service/observability/network-otel-exporter.mjs", "utf8");
const sharedConfig = readFileSync("src/shared/network-otel-config.mjs", "utf8");
const eventEmitter = readFileSync("src/service/core/task-runtime/event-emitter.mjs", "utf8");
const bootstrap = readFileSync("src/service/core/service-bootstrap.mjs", "utf8");
const services = readFileSync("src/service/core/task-runtime/runtime-services.mjs", "utf8");
const taxonomyVerifier = readFileSync("scripts/verify-task-span-taxonomy.mjs", "utf8");
const behavior = readFileSync("tests/behavior/network-otel-exporter.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");

assert.match(sharedConfig, /sanitizeNetworkOtelEndpoint/u, "endpoint sanitizer must be shared");
assert.match(sharedConfig, /consent\.accepted/u, "config must require explicit consent");
assert.match(exporter, /createNetworkOtelExporter/u, "exporter factory must exist");
assert.match(exporter, /buildNetworkOtelRequestBody/u, "exporter must build OTLP-shaped request bodies");
assert.match(exporter, /summary_only_no_raw_payloads/u, "exporter must use summary-only redaction");
assert.match(exporter, /maxQueueSize/u, "exporter must have bounded queue/backpressure");
assert.match(exporter, /AbortController/u, "exporter must use timeout/cancellation");
assert.match(eventEmitter, /networkOtelExporter\?\.recordTaskEvent/u, "terminal task events must feed the exporter fail-soft");
assert.match(bootstrap, /createNetworkOtelExporter/u, "service bootstrap must wire exporter");
assert.match(services, /createNetworkOtelExporter/u, "runtime service fallback must wire exporter for tests/narrow runtimes");
assert.match(taxonomyVerifier, /!taxonomy\.includes\("fetch\("\)/u, "taxonomy verifier must keep network out of shared span taxonomy");
assert.match(behavior, /omits raw payload detail/u, "behavior tests must prove raw payload detail is not exported");
assert.match(roadmap, /Network OTEL/u, "roadmap must track Network OTEL");

const active = normalizeNetworkOtelConfig({
  observability: {
    networkOtel: {
      enabled: true,
      endpoint: "https://otel.example.test/v1/traces",
      consent: { accepted: true }
    }
  }
});
assert.equal(active.active, true);

const body = buildNetworkOtelRequestBody([{
  task_id: "task_verify",
  span_count: 1,
  spans: [{
    span_id: "s1",
    name: "model.call",
    kind: "llm",
    phase: "model",
    status: "completed",
    start_ms: 1,
    end_ms: 2,
    attributes: { label: "planner", detail: "secret prompt" }
  }]
}]);
assert.equal(body.resourceSpans[0].scopeSpans[0].spans.length, 1);
assert.doesNotMatch(JSON.stringify(body), /secret prompt/u);

const exporterInstance = createNetworkOtelExporter({
  store: { getTaskEvents: () => [] },
  configStore: { load: () => ({}) },
  fetchImpl: async () => ({ ok: true })
});
assert.equal(exporterInstance.getStatus().active, false);

const command = "node scripts/verify-network-otel-exporter.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include network OTEL verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include network OTEL verifier");

console.log("[verify-network-otel-exporter] Network OTEL exporter contract OK");
