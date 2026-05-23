import { createHash } from "node:crypto";
import { normalizeNetworkOtelConfig } from "../../shared/network-otel-config.mjs";
import { buildTaskSpanExport } from "../../shared/task-span-taxonomy.mjs";
import { buildTaskTraceSummary } from "../../shared/task-trace-summary.mjs";

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled", "partial_success"]);

function nowIso() {
  return new Date().toISOString();
}

function hexId(value, bytes) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, bytes * 2);
}

function msToNsString(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return "0";
  return String(Math.max(0, Math.floor(ms * 1_000_000)));
}

function otelStatusCode(status = "") {
  return status === "failed" || status === "aborted" ? 2 : 1;
}

function attr(key, value) {
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (Number.isFinite(Number(value))) return { key, value: { intValue: String(Math.floor(Number(value))) } };
  return { key, value: { stringValue: String(value ?? "") } };
}

export function buildNetworkOtelRequestBody(spanExports = [], {
  serviceName = "lingxy-runtime"
} = {}) {
  const spans = [];
  for (const spanExport of spanExports) {
    const taskId = spanExport?.task_id ?? "";
    for (const span of spanExport?.spans ?? []) {
      const seed = `${taskId}:${span.span_id ?? span.name}:${span.start_ms ?? ""}:${span.end_ms ?? ""}`;
      spans.push({
        traceId: hexId(taskId || seed, 16),
        spanId: hexId(seed, 8),
        parentSpanId: span.parent_span_id ? hexId(`${taskId}:${span.parent_span_id}`, 8) : undefined,
        name: span.name,
        kind: 1,
        startTimeUnixNano: msToNsString(span.start_ms),
        endTimeUnixNano: msToNsString(span.end_ms ?? span.start_ms),
        attributes: [
          attr("lingxy.task_id", taskId),
          attr("lingxy.phase", span.phase ?? "system"),
          attr("lingxy.kind", span.kind ?? "internal"),
          attr("lingxy.status", span.status ?? "completed"),
          attr("lingxy.label", span.attributes?.label ?? "")
        ],
        status: {
          code: otelStatusCode(span.status),
          message: span.status ?? "completed"
        }
      });
    }
  }

  return {
    resourceSpans: [{
      resource: {
        attributes: [
          attr("service.name", serviceName),
          attr("telemetry.sdk.name", "lingxy-local-otel-exporter"),
          attr("lingxy.redaction", "summary_only_no_raw_payloads")
        ]
      },
      scopeSpans: [{
        scope: { name: "lingxy.task.trace", version: "1" },
        spans
      }]
    }]
  };
}

export function createNetworkOtelExporter({
  runtime = null,
  configStore = null,
  store = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const queue = [];
  const pendingTaskIds = new Set();
  const stats = {
    queued: 0,
    dropped: 0,
    exportedBatches: 0,
    exportedSpans: 0,
    failedBatches: 0,
    lastExportAt: null,
    lastError: null
  };
  let flushing = false;
  let scheduled = false;

  const loadConfig = () => normalizeNetworkOtelConfig(configStore?.load?.() ?? {});

  function getStatus() {
    const config = loadConfig();
    return {
      enabled: config.enabled,
      active: config.active,
      endpointConfigured: Boolean(config.endpoint),
      consentAccepted: config.consent.accepted,
      redaction: config.redaction,
      queueDepth: queue.length,
      ...stats
    };
  }

  function enqueueTask(taskId) {
    const config = loadConfig();
    if (!config.active || !taskId || typeof store?.getTaskEvents !== "function") return false;
    if (pendingTaskIds.has(taskId)) return true;
    if (queue.length >= config.maxQueueSize) {
      stats.dropped += 1;
      stats.lastError = "queue_full";
      return false;
    }
    queue.push({ taskId, queuedAt: nowIso() });
    pendingTaskIds.add(taskId);
    stats.queued += 1;
    scheduleFlush();
    return true;
  }

  function recordTaskEvent({ taskId, eventType, payload = {} } = {}) {
    if (eventType === "status_changed" && TERMINAL_STATUSES.has(payload?.status)) {
      enqueueTask(taskId);
    }
  }

  function scheduleFlush() {
    if (scheduled || flushing) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void flush();
    }, 0);
  }

  async function flush() {
    if (flushing || queue.length === 0) return getStatus();
    const config = loadConfig();
    if (!config.active || typeof fetchImpl !== "function") return getStatus();
    flushing = true;
    const batch = queue.splice(0, config.batchSize);
    for (const entry of batch) pendingTaskIds.delete(entry.taskId);
    try {
      const spanExports = batch.map((entry) => {
        const events = store.getTaskEvents(entry.taskId) ?? [];
        return buildTaskSpanExport(buildTaskTraceSummary(events), { taskId: entry.taskId });
      }).filter((spanExport) => spanExport.span_count > 0);
      const body = buildNetworkOtelRequestBody(spanExports);
      const spanCount = body.resourceSpans[0].scopeSpans[0].spans.length;
      if (spanCount === 0) return getStatus();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!response?.ok) throw new Error(`otel_export_http_${response?.status ?? "unknown"}`);
      } finally {
        clearTimeout(timer);
      }
      stats.exportedBatches += 1;
      stats.exportedSpans += spanCount;
      stats.lastExportAt = nowIso();
      stats.lastError = null;
    } catch (error) {
      stats.failedBatches += 1;
      stats.lastError = error?.name === "AbortError" ? "timeout" : error?.message ?? String(error);
      for (const entry of batch) {
        if (queue.length < config.maxQueueSize) {
          queue.push(entry);
          pendingTaskIds.add(entry.taskId);
        } else {
          stats.dropped += 1;
        }
      }
    } finally {
      flushing = false;
      if (queue.length > 0) scheduleFlush();
    }
    return getStatus();
  }

  return {
    enqueueTask,
    flush,
    getStatus,
    recordTaskEvent,
    _queue: queue,
    _stats: stats,
    _runtime: runtime
  };
}
