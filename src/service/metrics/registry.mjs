import { performance } from "node:perf_hooks";

function todayPrefix(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

const MAX_RUNTIME_BASELINE_SERIES = 100;

function normalizeMetricPart(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  return (normalized || fallback).slice(0, 96);
}

function metricSeriesKey({ name, source, status }) {
  return `${name}|${source}|${status}`;
}

function roundMs(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function labelValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n");
}

export function createRuntimeBaselineMetrics({
  clock = () => performance.now(),
  wallClock = () => new Date()
} = {}) {
  const timings = new Map();
  const counters = new Map();

  function touchEntry(map, key, createEntry) {
    if (!map.has(key) && map.size >= MAX_RUNTIME_BASELINE_SERIES) {
      return null;
    }
    if (!map.has(key)) {
      map.set(key, createEntry());
    }
    return map.get(key);
  }

  function recordTiming(name, durationMs, context = {}) {
    const duration = Math.max(0, Number(durationMs));
    if (!Number.isFinite(duration)) return null;
    const operation = normalizeMetricPart(name, "runtime.operation");
    const source = normalizeMetricPart(context.source, "service");
    const status = normalizeMetricPart(context.status, "success");
    const key = metricSeriesKey({ name: operation, source, status });
    const entry = touchEntry(timings, key, () => ({
      operation,
      source,
      status,
      count: 0,
      total_ms: 0,
      max_ms: 0,
      last_ms: 0,
      updated_at: null
    }));
    if (!entry) return null;
    entry.count += 1;
    entry.total_ms = roundMs(entry.total_ms + duration);
    entry.max_ms = roundMs(Math.max(entry.max_ms, duration));
    entry.last_ms = roundMs(duration);
    entry.avg_ms = roundMs(entry.total_ms / entry.count);
    entry.updated_at = wallClock().toISOString();
    return { ...entry };
  }

  function incrementCounter(name, value = 1, context = {}) {
    const delta = Number(value);
    if (!Number.isFinite(delta)) return null;
    const counter = normalizeMetricPart(name, "runtime.counter");
    const source = normalizeMetricPart(context.source, "service");
    const status = normalizeMetricPart(context.status, "success");
    const key = metricSeriesKey({ name: counter, source, status });
    const entry = touchEntry(counters, key, () => ({
      counter,
      source,
      status,
      total: 0,
      updated_at: null
    }));
    if (!entry) return null;
    entry.total = Math.round((entry.total + delta) * 1000) / 1000;
    entry.updated_at = wallClock().toISOString();
    return { ...entry };
  }

  function startTimer(name, context = {}) {
    const startedAt = clock();
    let stopped = false;
    return (finishContext = {}) => {
      if (stopped) return null;
      stopped = true;
      return recordTiming(name, clock() - startedAt, {
        ...context,
        ...finishContext
      });
    };
  }

  function snapshot() {
    return {
      timings: Object.fromEntries([...timings.entries()].sort(([a], [b]) => a.localeCompare(b))),
      counters: Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
      series_limit: MAX_RUNTIME_BASELINE_SERIES
    };
  }

  function renderPrometheus() {
    const lines = [
      "# HELP uca_runtime_timing_count Runtime baseline timing sample count",
      "# TYPE uca_runtime_timing_count counter",
      "# HELP uca_runtime_timing_total_ms Runtime baseline timing total milliseconds",
      "# TYPE uca_runtime_timing_total_ms counter",
      "# HELP uca_runtime_timing_max_ms Runtime baseline timing max milliseconds",
      "# TYPE uca_runtime_timing_max_ms gauge",
      "# HELP uca_runtime_counter_total Runtime baseline counter total",
      "# TYPE uca_runtime_counter_total counter"
    ];
    for (const timing of timings.values()) {
      const labels = `operation="${labelValue(timing.operation)}",source="${labelValue(timing.source)}",status="${labelValue(timing.status)}"`;
      lines.push(`uca_runtime_timing_count{${labels}} ${timing.count}`);
      lines.push(`uca_runtime_timing_total_ms{${labels}} ${timing.total_ms}`);
      lines.push(`uca_runtime_timing_max_ms{${labels}} ${timing.max_ms}`);
    }
    for (const counter of counters.values()) {
      const labels = `counter="${labelValue(counter.counter)}",source="${labelValue(counter.source)}",status="${labelValue(counter.status)}"`;
      lines.push(`uca_runtime_counter_total{${labels}} ${counter.total}`);
    }
    return lines.join("\n");
  }

  return {
    recordTiming,
    incrementCounter,
    startTimer,
    snapshot,
    renderPrometheus
  };
}

export function createMetricsRegistry({ store, queue }) {
  const runtimeBaseline = createRuntimeBaselineMetrics();

  return {
    recordRuntimeTiming(name, durationMs, context = {}) {
      return runtimeBaseline.recordTiming(name, durationMs, context);
    },
    incrementRuntimeCounter(name, value = 1, context = {}) {
      return runtimeBaseline.incrementCounter(name, value, context);
    },
    startRuntimeTimer(name, context = {}) {
      return runtimeBaseline.startTimer(name, context);
    },
    snapshot(now = new Date()) {
      const tasks = store.listTasks();
      const prefix = todayPrefix(now);
      const todayTasks = tasks.filter((task) => task.created_at.startsWith(prefix));
      const failed = tasks.filter((task) => task.status === "failed").length;
      const cancelled = tasks.filter((task) => task.status === "cancelled").length;
      const queueState = queue.snapshot();

      return {
        task_total: tasks.length,
        task_running: tasks.filter((task) => task.status === "running").length,
        task_failed_total: failed,
        task_cancelled_total: cancelled,
        failure_rate: tasks.length === 0 ? 0 : Number((failed / tasks.length).toFixed(4)),
        queue_depth: queueState.queued,
        queue_running: queueState.running,
        today_success_total: todayTasks.filter((task) => task.status === "success").length,
        today_failed_total: todayTasks.filter((task) => task.status === "failed").length,
        runtime_baseline: runtimeBaseline.snapshot()
      };
    },
    renderPrometheus(now = new Date()) {
      const snapshot = this.snapshot(now);
      return [
        "# HELP uca_task_total Total number of tasks",
        "# TYPE uca_task_total gauge",
        `uca_task_total ${snapshot.task_total}`,
        "# HELP uca_task_failed_total Total failed tasks",
        "# TYPE uca_task_failed_total gauge",
        `uca_task_failed_total ${snapshot.task_failed_total}`,
        "# HELP uca_task_cancelled_total Total cancelled tasks",
        "# TYPE uca_task_cancelled_total gauge",
        `uca_task_cancelled_total ${snapshot.task_cancelled_total}`,
        "# HELP uca_failure_rate Failed tasks over total tasks",
        "# TYPE uca_failure_rate gauge",
        `uca_failure_rate ${snapshot.failure_rate}`,
        "# HELP uca_queue_depth Number of queued tasks",
        "# TYPE uca_queue_depth gauge",
        `uca_queue_depth ${snapshot.queue_depth}`,
        "# HELP uca_queue_running Number of running tasks",
        "# TYPE uca_queue_running gauge",
        `uca_queue_running ${snapshot.queue_running}`,
        runtimeBaseline.renderPrometheus()
      ].join("\n");
    }
  };
}
