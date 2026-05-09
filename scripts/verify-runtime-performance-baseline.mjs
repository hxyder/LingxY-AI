import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import {
  createMetricsRegistry,
  createRuntimeBaselineMetrics
} from "../src/service/metrics/registry.mjs";

function createEmptyStore() {
  return {
    listTasks() {
      return [];
    }
  };
}

function createEmptyQueue() {
  return {
    snapshot() {
      return { queued: 0, running: 0 };
    }
  };
}

function walkFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (/\.(?:mjs|js|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

let nowMs = 1000;
const baseline = createRuntimeBaselineMetrics({
  clock: () => nowMs,
  wallClock: () => new Date("2026-05-09T00:00:00.000Z")
});

const stopContextCompile = baseline.startTimer("context.compile", {
  source: "service",
  status: "success"
});
nowMs += 12.3456;
const timing = stopContextCompile();
assert.equal(timing.operation, "context.compile");
assert.equal(timing.count, 1);
assert.equal(timing.last_ms, 12.346);
assert.equal(stopContextCompile(), null, "runtime timers must be single-use");

baseline.incrementCounter("context.compile.invoked", 2, {
  source: "service",
  status: "success"
});

const baselineSnapshot = baseline.snapshot();
assert.ok(baselineSnapshot.timings["context.compile|service|success"]);
assert.equal(
  baselineSnapshot.counters["context.compile.invoked|service|success"].total,
  2
);
assert.match(baseline.renderPrometheus(), /uca_runtime_timing_count/);
assert.match(baseline.renderPrometheus(), /operation="context.compile"/);

const metrics = createMetricsRegistry({
  store: createEmptyStore(),
  queue: createEmptyQueue()
});
metrics.recordRuntimeTiming("artifact.extract", 42.5, {
  source: "service",
  status: "success"
});
metrics.incrementRuntimeCounter("artifact.extract.invoked", 1, {
  source: "service",
  status: "success"
});
const snapshot = metrics.snapshot();
assert.equal(snapshot.runtime_baseline.timings["artifact.extract|service|success"].max_ms, 42.5);
assert.equal(snapshot.runtime_baseline.counters["artifact.extract.invoked|service|success"].total, 1);
assert.match(metrics.renderPrometheus(), /uca_runtime_counter_total/);

const service = createServiceBootstrap();
const bootstrapSnapshot = service.runtime.metrics.snapshot();
assert.ok(
  bootstrapSnapshot.runtime_baseline.timings["service.bootstrap.create_runtime|service-bootstrap|success"],
  "service bootstrap must record a runtime creation timing"
);
assert.equal(
  bootstrapSnapshot.runtime_baseline.counters["service.bootstrap.created|service-bootstrap|success"].total,
  1
);

const desktopFiles = walkFiles(path.join(process.cwd(), "src", "desktop"));
for (const filePath of desktopFiles) {
  const source = readFileSync(filePath, "utf8");
  assert.equal(
    /from\s+["'][^"']*service\/metrics\/registry\.mjs["']/.test(source),
    false,
    `${path.relative(process.cwd(), filePath)} must not import service metrics directly`
  );
  assert.equal(
    /\b(recordRuntimeTiming|incrementRuntimeCounter|startRuntimeTimer)\b/.test(source),
    false,
    `${path.relative(process.cwd(), filePath)} must not own PR-02 runtime baseline instrumentation`
  );
}

const performancePlan = readFileSync(
  path.join(process.cwd(), "docs", "architecture", "electron-js-runtime-performance-plan.md"),
  "utf8"
);
assert.match(performancePlan, /\| PR-02 \| Performance baseline instrumentation \| Done/);
assert.match(performancePlan, /npm run verify:runtime-performance-baseline/);

console.log("[verify-runtime-performance-baseline] baseline metrics verified");
