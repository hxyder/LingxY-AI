import { runArtifactExtractWorker } from "../../workers/artifact-extract-worker.mjs";
import { ARTIFACT_EXTRACT_KINDS } from "./artifact-extract-service.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 1;

function nowIso() {
  return new Date().toISOString();
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.trunc(numeric);
}

function normalizeQuality(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function warningList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 20) : [];
}

function createTimeoutAbortController(timeoutMs, parentSignal = null) {
  const controller = new AbortController();
  let timer = null;
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (parentSignal?.aborted) {
    abort(parentSignal.reason ?? new Error("aborted"));
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", () => abort(parentSignal.reason ?? new Error("aborted")), { once: true });
  }
  timer = setTimeout(() => abort(new Error("artifact extraction timeout")), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

function failureResult(input = {}, error, reason = "failed") {
  const message = error?.message ?? String(error ?? "artifact extraction failed");
  return {
    artifactId: input.artifactId ?? input.artifact_id ?? null,
    kind: input.kind ?? "unknown",
    quality: {
      parse_status: reason,
      reason,
      error: message
    },
    summary: `Artifact extraction ${reason}: ${message}`,
    content: "",
    warnings: [reason]
  };
}

export function createArtifactExtractBackgroundLane({
  artifactExtracts,
  worker = runArtifactExtractWorker,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  metrics = null
} = {}) {
  if (typeof artifactExtracts?.appendExtract !== "function") {
    throw new Error("ArtifactExtractBackgroundLane requires artifactExtracts.appendExtract");
  }
  if (typeof worker !== "function") {
    throw new Error("ArtifactExtractBackgroundLane requires a worker function");
  }
  const concurrency = normalizePositiveInteger(maxConcurrent, DEFAULT_MAX_CONCURRENT);
  const defaultTimeout = normalizePositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const queue = [];
  const running = new Set();

  function emitProgress(job, event) {
    const progress = {
      lane: "artifact_extract",
      job_id: job.jobId,
      artifact_id: job.input.artifactId ?? job.input.artifact_id ?? null,
      task_id: job.input.taskId ?? job.input.task_id ?? null,
      ts: nowIso(),
      ...event
    };
    job.onProgress?.(progress);
    return progress;
  }

  function appendResult(input, result) {
    const artifactId = result.artifactId ?? input.artifactId ?? input.artifact_id;
    const quality = normalizeQuality(result.quality);
    const warnings = warningList(result.warnings);
    return artifactExtracts.appendExtract({
      artifactId,
      taskId: input.taskId ?? input.task_id ?? null,
      conversationId: input.conversationId ?? input.conversation_id ?? null,
      kind: ARTIFACT_EXTRACT_KINDS.SUMMARY,
      label: `${input.kind ?? result.kind ?? "artifact"} extraction`,
      content: result.summary ?? result.content ?? "",
      data: {
        content: result.content ?? "",
        warnings,
        quality
      },
      source: "artifact_extract_background_lane",
      confidence: quality.parse_status === "failed" ? 0 : null,
      metadata: {
        extractor: "artifact_extract_background_lane",
        worker_kind: result.kind ?? input.kind ?? null,
        quality,
        warnings
      }
    });
  }

  async function runJob(job) {
    running.add(job);
    emitProgress(job, { phase: "started" });
    const timeout = createTimeoutAbortController(job.timeoutMs, job.signal);
    try {
      const result = await worker(job.input, {
        signal: timeout.signal,
        onProgress: (event) => emitProgress(job, event)
      });
      const record = appendResult(job.input, result);
      emitProgress(job, { phase: "completed", extract_id: record.extract_id });
      metrics?.incrementRuntimeCounter?.("artifact.extract.background.completed", 1, {
        source: "artifact_extract_background_lane"
      });
      job.resolve({ ok: true, record, result });
    } catch (error) {
      const reason = timeout.signal.aborted ? "timeout_or_aborted" : "failed";
      const result = failureResult(job.input, error, reason);
      const record = appendResult(job.input, result);
      emitProgress(job, { phase: "failed", extract_id: record.extract_id, reason });
      metrics?.incrementRuntimeCounter?.("artifact.extract.background.failed", 1, {
        source: "artifact_extract_background_lane",
        reason
      });
      job.resolve({ ok: false, record, result, error: error?.message ?? String(error) });
    } finally {
      timeout.clear();
      running.delete(job);
      drain();
    }
  }

  function drain() {
    while (running.size < concurrency && queue.length > 0) {
      const job = queue.shift();
      void runJob(job);
    }
  }

  function enqueueArtifactExtract(input = {}, options = {}) {
    const job = {
      jobId: `aextjob_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      input,
      signal: options.signal ?? input.signal ?? null,
      timeoutMs: normalizePositiveInteger(options.timeoutMs ?? input.timeoutMs, defaultTimeout),
      onProgress: options.onProgress ?? input.onProgress ?? null,
      resolve: null
    };
    const promise = new Promise((resolve) => {
      job.resolve = resolve;
    });
    queue.push(job);
    emitProgress(job, { phase: "queued" });
    drain();
    return promise;
  }

  function snapshot() {
    return {
      queued: queue.length,
      running: running.size,
      max_concurrent: concurrency
    };
  }

  return {
    enqueueArtifactExtract,
    snapshot
  };
}
