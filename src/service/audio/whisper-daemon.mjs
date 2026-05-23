import { spawn } from "node:child_process";
import readline from "node:readline";

// Codex Round 7 review: whisper transcribe is single-threaded server-side
// (faster-whisper has no batching for our flow), so we MUST serialise
// requests on the Node side too. A pending Map of in-flight requests would
// silently let the queue grow unbounded and inflate per-request latency
// well past every operator's mental model. Treat the daemon as a
// single-worker queue; one stdin write at a time, one stdout response at a
// time. Keep id-based routing only as a defensive parse — there should
// never be more than one outstanding id.

// Idle timeout pulled to session-scale (5 minutes). Codex flagged that the
// 60-120 s default in sherpa-daemon would force frequent cold reloads when
// the user takes a normal think-and-talk break, undoing the daemon's
// purpose. faster-whisper holds 300-500 MB of weights so we still kill on
// idle to release memory for other processes; just not aggressively.
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

// Per-request timeout. faster-whisper base-int8 typically transcribes 30s
// of audio in 5-10s on CPU; we leave 6× headroom but cap at the operator's
// absolute upper bound (UCA_LOCAL_WHISPER_TIMEOUT_MS, defaulting to 30
// minutes upstream). The route layer decides which value applies; this
// constant is only the floor when neither env nor caller specifies one.
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

// Circuit breaker: when daemon spawn fails repeatedly, fall back to the
// fork-exec path without spawning a new process every time. Exponential
// backoff resets on first success.
const BACKOFF_STEPS_MS = Object.freeze([5_000, 30_000, 120_000, 600_000]);

function makeRequestId() {
  return `whisper_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonLine(line = "") {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try { return JSON.parse(trimmed); }
  catch { return null; }
}

export function createWhisperDaemon({
  pythonCommand,
  scriptPath,
  spawnImpl = spawn,
  env = process.env,
  requestTimeoutMs = Number(env.UCA_LOCAL_WHISPER_DAEMON_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS),
  idleTimeoutMs = Number(env.UCA_LOCAL_WHISPER_DAEMON_IDLE_TIMEOUT_MS ?? DEFAULT_IDLE_TIMEOUT_MS),
  backoffSteps = BACKOFF_STEPS_MS,
  now = () => Date.now()
} = {}) {
  let child = null;
  let rl = null;
  let stderrText = "";
  let idleTimer = null;
  // Single-worker queue. inflight is the request currently being awaited
  // by the daemon; queue is the FIFO of pending callers waiting for their
  // turn. We never hand the daemon more than one request at a time.
  let inflight = null;
  const queue = [];
  // Circuit breaker state. failureCount feeds the backoff index; while
  // now() < blockedUntil we refuse to spawn and the caller can fall back
  // to fork-exec immediately instead of waiting for another spawn failure.
  let failureCount = 0;
  let blockedUntil = 0;
  // Set while we are tearing down a child the daemon itself killed. Without
  // it the close event that fires after `child.kill()` would re-enter
  // recordFailure and double-count the breaker step.
  let shuttingDown = false;

  const resetIdleTimer = () => {
    if (!idleTimeoutMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    if (inflight || queue.length > 0) return;
    idleTimer = setTimeout(() => { stop(); }, idleTimeoutMs);
  };

  const failPending = (error) => {
    if (inflight) {
      const { reject, timer } = inflight;
      if (timer) clearTimeout(timer);
      inflight = null;
      try { reject(error); } catch { /* ignore */ }
    }
    while (queue.length > 0) {
      const entry = queue.shift();
      try { entry.reject(error); } catch { /* ignore */ }
    }
  };

  const stop = ({ skipKill = false } = {}) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    try { rl?.close?.(); } catch { /* ignore */ }
    rl = null;
    // Codex Round 7 final review: never call kill() on a child that has
    // already exited. `close` means the process is gone; on a long-running
    // host its PID may have been recycled by the OS, and a delayed
    // `kill(SIGTERM)` would land on an unrelated process. The close
    // handler passes skipKill:true; ordinary stop() paths still kill
    // running children but check exit codes first as belt-and-braces.
    const childAlreadyExited = !child
      || child.killed
      || (child.exitCode !== null && child.exitCode !== undefined)
      || (child.signalCode !== null && child.signalCode !== undefined);
    if (!skipKill && !childAlreadyExited) {
      shuttingDown = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
    child = null;
    stderrText = "";
  };

  const recordFailure = (error, { skipKill = false } = {}) => {
    failureCount = Math.min(failureCount + 1, backoffSteps.length);
    const cooldown = backoffSteps[Math.min(failureCount, backoffSteps.length) - 1] ?? backoffSteps[backoffSteps.length - 1];
    blockedUntil = now() + cooldown;
    failPending(error);
    stop({ skipKill });
    // Do NOT clear `shuttingDown` here. In production the `close` event
    // from `child.kill()` fires asynchronously; the close handler consumes
    // the flag.
  };

  const recordSuccess = () => {
    failureCount = 0;
    blockedUntil = 0;
  };

  const ensureStarted = () => {
    if (child && !child.killed && child.stdin?.writable) return;
    if (now() < blockedUntil) {
      const error = new Error("whisper daemon temporarily disabled (circuit breaker open)");
      error.code = "DAEMON_BACKOFF";
      throw error;
    }
    if (!pythonCommand || !scriptPath) {
      throw new Error("whisper daemon missing python command or script path");
    }
    stderrText = "";
    child = spawnImpl(pythonCommand, [scriptPath, "--server"], {
      env: { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stderr?.on?.("data", (chunk) => {
      stderrText = `${stderrText}${Buffer.from(chunk).toString("utf8")}`.slice(-4000);
    });
    rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const payload = parseJsonLine(line);
      if (!payload || typeof payload !== "object") {
        // stdout pollution. Codex Round 7 review: a third-party library in
        // Python land could print something that breaks the protocol. Treat
        // any non-JSON line as a daemon protocol violation: fail the
        // current request, kill the child, and let the next caller spawn
        // fresh (after backoff if this keeps happening).
        recordFailure(new Error(`whisper daemon emitted non-JSON line: ${String(line ?? "").slice(0, 200)}`));
        return;
      }
      const id = payload.id;
      if (!inflight || inflight.id !== id) {
        // Defensive: ignore replies that don't match the in-flight request.
        // With strict serialisation this should never happen.
        return;
      }
      const entry = inflight;
      inflight = null;
      if (entry.timer) clearTimeout(entry.timer);
      recordSuccess();
      entry.resolve(payload);
      pump();
      resetIdleTimer();
    });
    child.on?.("error", (error) => {
      recordFailure(error);
    });
    child.on?.("close", (code) => {
      if (shuttingDown) {
        // We initiated this kill (via stop / recordFailure / idle); the
        // failure has already been counted. Consume the flag and stop.
        shuttingDown = false;
        return;
      }
      const error = new Error(`whisper daemon exited with code ${code}${stderrText ? `: ${stderrText.slice(-400)}` : ""}`);
      // Codex Round 7 final: pass skipKill so stop() does not signal a
      // recycled PID — close means the child is already gone.
      recordFailure(error, { skipKill: true });
    });
    // Defensive stdin error handler — child crash mid-write surfaces here as
    // EPIPE on some platforms; without a listener Node would crash the
    // parent process.
    child.stdin?.on?.("error", () => { /* surfaced via the write callback */ });
    resetIdleTimer();
  };

  let pumping = false;
  const pump = () => {
    // Codex Round 7 review: when the breaker is open and N callers stack
    // up, the previous version recursed once per rejection (stack depth =
    // N). Iterate instead so an unbounded backlog cannot overflow.
    if (pumping) return;
    pumping = true;
    try {
      while (!inflight && queue.length > 0) {
        const next = queue.shift();
        try {
          ensureStarted();
        } catch (error) {
          try { next.reject(error); } catch { /* ignore */ }
          continue;
        }
        if (idleTimer) clearTimeout(idleTimer);
        const timer = setTimeout(() => {
          if (inflight && inflight.id === next.id) {
            inflight = null;
            recordFailure(new Error(`whisper daemon request ${next.id} timed out after ${next.timeoutMs}ms`));
            try { next.reject(new Error(`whisper daemon request timed out after ${next.timeoutMs}ms`)); } catch { /* ignore */ }
            pump();
          }
        }, next.timeoutMs);
        inflight = { ...next, timer };
        child.stdin.write(`${JSON.stringify(next.payload)}\n`, "utf8", (error) => {
          if (!error) return;
          const entry = inflight;
          inflight = null;
          if (entry?.timer) clearTimeout(entry.timer);
          recordFailure(error);
          try { entry?.reject?.(error); } catch { /* ignore */ }
          pump();
        });
        // After a successful start the loop exits naturally because
        // inflight is now set; we wait for the response or the timeout.
      }
    } finally {
      pumping = false;
    }
    if (!inflight && queue.length === 0) resetIdleTimer();
  };

  const transcribe = async ({
    audioPath,
    language = "auto",
    beamSize = null,
    noVad = false,
    model = null,
    device = null,
    computeType = null,
    timeoutMs = requestTimeoutMs
  } = {}) => {
    if (!audioPath) {
      throw new Error("audioPath required");
    }
    const id = makeRequestId();
    const payload = {
      id,
      audio_path: audioPath,
      language,
      no_vad: Boolean(noVad)
    };
    if (Number.isFinite(beamSize)) payload.beam_size = beamSize;
    if (model) payload.model = model;
    if (device) payload.device = device;
    if (computeType) payload.compute_type = computeType;
    return await new Promise((resolve, reject) => {
      queue.push({
        id,
        payload,
        timeoutMs: Math.max(1_000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS),
        resolve,
        reject
      });
      pump();
    });
  };

  return {
    transcribe,
    stop,
    get running() {
      return Boolean(child && !child.killed);
    },
    get queueLength() {
      return queue.length + (inflight ? 1 : 0);
    },
    get circuitOpen() {
      return now() < blockedUntil;
    }
  };
}

let singleton = null;

export function getWhisperDaemon(options = {}) {
  if (process.env.UCA_LOCAL_WHISPER_DAEMON === "0") {
    return null;
  }
  if (!singleton) {
    singleton = createWhisperDaemon(options);
  }
  return singleton;
}

export function stopWhisperDaemon() {
  singleton?.stop?.();
  singleton = null;
}
