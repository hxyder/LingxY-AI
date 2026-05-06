import { spawn } from "node:child_process";
import readline from "node:readline";

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

function makeRequestId() {
  return `kws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonLine(line = "") {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try { return JSON.parse(trimmed); }
  catch { return null; }
}

export function createSherpaKwsDaemon({
  pythonCommand,
  scriptPath,
  spawnImpl = spawn,
  env = process.env,
  requestTimeoutMs = Number(env.UCA_SHERPA_KWS_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS),
  idleTimeoutMs = Number(env.UCA_SHERPA_KWS_DAEMON_IDLE_TIMEOUT_MS ?? DEFAULT_IDLE_TIMEOUT_MS)
} = {}) {
  let child = null;
  let rl = null;
  let stderrText = "";
  let idleTimer = null;
  const pending = new Map();

  const resetIdleTimer = () => {
    if (!idleTimeoutMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stop();
    }, idleTimeoutMs);
  };

  const rejectPending = (error) => {
    for (const { reject, timer } of pending.values()) {
      if (timer) clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  const stop = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    try { rl?.close?.(); } catch { /* ignore */ }
    rl = null;
    if (child && !child.killed) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
    child = null;
    stderrText = "";
  };

  const ensureStarted = () => {
    if (child && !child.killed && child.stdin?.writable) return;
    if (!pythonCommand || !scriptPath) {
      throw new Error("sherpa daemon missing python command or script path");
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
      const id = payload?.id;
      if (!id || !pending.has(id)) return;
      const entry = pending.get(id);
      pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      resetIdleTimer();
      entry.resolve(payload);
    });
    child.on?.("error", (error) => {
      rejectPending(error);
      stop();
    });
    child.on?.("close", (code) => {
      const error = new Error(`sherpa daemon exited with code ${code}${stderrText ? `: ${stderrText}` : ""}`);
      rejectPending(error);
      stop();
    });
    resetIdleTimer();
  };

  const detect = async ({
    audioPath,
    personalized = false,
    templateFallback = false,
    keywords = []
  } = {}) => {
    ensureStarted();
    const id = makeRequestId();
    const payload = {
      id,
      audio_path: audioPath,
      personalized: Boolean(personalized),
      template_fallback: Boolean(templateFallback),
      keywords: Array.isArray(keywords) ? keywords : []
    };
    const timeoutMs = Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`sherpa daemon request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
        if (!error) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  };

  return {
    detect,
    stop,
    get running() {
      return Boolean(child && !child.killed);
    }
  };
}

let singleton = null;

export async function detectWakeKeywordWithSherpaDaemon(options = {}) {
  if (process.env.UCA_SHERPA_KWS_DAEMON === "0") {
    throw new Error("sherpa daemon disabled");
  }
  if (!singleton) {
    singleton = createSherpaKwsDaemon(options);
  }
  return await singleton.detect(options);
}

export function stopSherpaKwsDaemon() {
  singleton?.stop?.();
  singleton = null;
}
