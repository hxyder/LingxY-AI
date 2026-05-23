export const RUNTIME_GRAPH_SCHEDULER_SCHEMA_VERSION = "1.0";

export const DEFAULT_RUNTIME_GRAPH_SCHEDULING_BUDGET = Object.freeze({
  maxConcurrent: 2,
  maxPerSession: 1,
  maxQueued: 100,
  nodeTimeoutMs: 30_000
});

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.trunc(numeric);
}

function normalizeBudget(budget = {}) {
  return {
    maxConcurrent: normalizePositiveInteger(
      budget.maxConcurrent,
      DEFAULT_RUNTIME_GRAPH_SCHEDULING_BUDGET.maxConcurrent
    ),
    maxPerSession: normalizePositiveInteger(
      budget.maxPerSession,
      DEFAULT_RUNTIME_GRAPH_SCHEDULING_BUDGET.maxPerSession
    ),
    maxQueued: normalizePositiveInteger(
      budget.maxQueued,
      DEFAULT_RUNTIME_GRAPH_SCHEDULING_BUDGET.maxQueued
    ),
    nodeTimeoutMs: normalizePositiveInteger(
      budget.nodeTimeoutMs,
      DEFAULT_RUNTIME_GRAPH_SCHEDULING_BUDGET.nodeTimeoutMs
    )
  };
}

function newJobId() {
  return `rgjob_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createAbortBoundary(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (parentSignal?.aborted) {
    abort(parentSignal.reason ?? new Error("runtime graph node aborted"));
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", () => {
      abort(parentSignal.reason ?? new Error("runtime graph node aborted"));
    }, { once: true });
  }
  timer = setTimeout(() => abort(new Error("runtime graph node timeout")), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

function sessionKeyFor(job) {
  return job.sessionId ?? `task:${job.taskId ?? "unknown"}`;
}

export function createRuntimeGraphScheduler({ budget = {}, metrics = null } = {}) {
  const limits = normalizeBudget(budget);
  const queue = [];
  const running = new Set();
  const runningBySession = new Map();

  function canRun(job) {
    if (running.size >= limits.maxConcurrent) return false;
    const sessionKey = sessionKeyFor(job);
    return (runningBySession.get(sessionKey) ?? 0) < limits.maxPerSession;
  }

  function markRunning(job) {
    running.add(job);
    const sessionKey = sessionKeyFor(job);
    runningBySession.set(sessionKey, (runningBySession.get(sessionKey) ?? 0) + 1);
  }

  function markFinished(job) {
    running.delete(job);
    const sessionKey = sessionKeyFor(job);
    const next = Math.max(0, (runningBySession.get(sessionKey) ?? 0) - 1);
    if (next === 0) runningBySession.delete(sessionKey);
    else runningBySession.set(sessionKey, next);
  }

  function finish(job, value) {
    job.resolve(value);
    metrics?.incrementRuntimeCounter?.("runtime_graph.scheduler.job", 1, {
      status: value.status ?? "unknown",
      node: job.node ?? "unknown"
    });
  }

  async function runJob(job) {
    markRunning(job);
    const abortBoundary = createAbortBoundary(job.signal, job.timeoutMs);
    try {
      if (abortBoundary.signal.aborted) {
        finish(job, {
          ok: false,
          status: "cancelled",
          job_id: job.jobId,
          node: job.node,
          error: abortBoundary.signal.reason?.message ?? "cancelled"
        });
        return;
      }
      const result = await job.run({
        signal: abortBoundary.signal,
        node: job.node,
        taskId: job.taskId,
        sessionId: job.sessionId,
        jobId: job.jobId
      });
      finish(job, {
        ok: true,
        status: "completed",
        job_id: job.jobId,
        node: job.node,
        result
      });
    } catch (error) {
      finish(job, {
        ok: false,
        status: abortBoundary.signal.aborted ? "cancelled" : "failed",
        job_id: job.jobId,
        node: job.node,
        error: error?.message ?? String(error)
      });
    } finally {
      abortBoundary.clear();
      markFinished(job);
      drain();
    }
  }

  function drain() {
    for (let index = 0; index < queue.length;) {
      const job = queue[index];
      if (!canRun(job)) {
        index += 1;
        continue;
      }
      queue.splice(index, 1);
      void runJob(job);
    }
  }

  function scheduleNode({
    node,
    taskId = null,
    sessionId = null,
    run,
    signal = null,
    timeoutMs = limits.nodeTimeoutMs
  } = {}) {
    if (!node) throw new Error("scheduleNode: node required");
    if (typeof run !== "function") throw new Error("scheduleNode: run function required");
    if (queue.length >= limits.maxQueued) {
      return Promise.resolve({
        ok: false,
        status: "rejected",
        node,
        error: "runtime graph scheduler queue is full"
      });
    }
    const job = {
      jobId: newJobId(),
      node,
      taskId,
      sessionId,
      run,
      signal,
      timeoutMs: normalizePositiveInteger(timeoutMs, limits.nodeTimeoutMs),
      resolve: null
    };
    const promise = new Promise((resolve) => {
      job.resolve = resolve;
    });
    queue.push(job);
    metrics?.recordRuntimeGauge?.("runtime_graph.scheduler.queue_depth", queue.length, {
      source: "runtime_graph_scheduler"
    });
    drain();
    return promise;
  }

  function snapshot() {
    return {
      schema_version: RUNTIME_GRAPH_SCHEDULER_SCHEMA_VERSION,
      queued: queue.length,
      running: running.size,
      running_sessions: runningBySession.size,
      budget: { ...limits }
    };
  }

  return {
    scheduleNode,
    snapshot
  };
}
