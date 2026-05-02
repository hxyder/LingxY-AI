import { spawn } from "node:child_process";

export class ExternalCallTimeoutError extends Error {
  constructor(message, { label = "external_call", timeoutMs = null } = {}) {
    super(message);
    this.name = "ExternalCallTimeoutError";
    this.code = "EXTERNAL_CALL_TIMEOUT";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export class ExternalCallHttpError extends Error {
  constructor(message, { label = "external_fetch", status = null, body = "" } = {}) {
    super(message);
    this.name = "ExternalCallHttpError";
    this.code = "EXTERNAL_CALL_HTTP_ERROR";
    this.label = label;
    this.status = status;
    this.body = body;
  }
}

function wait(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultShouldRetry(error) {
  if (error?.name === "ExternalCallTimeoutError") return true;
  if (error?.code === "ABORT_ERR") return false;
  const status = Number(error?.status ?? error?.response?.status);
  if (Number.isFinite(status)) return status >= 500;
  return false;
}

export async function withTimeout(operation, {
  timeoutMs = 30_000,
  label = "external_call",
  signal = null
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("withTimeout requires an operation function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation({ signal });
  }

  const controller = new AbortController();
  const abortFromParent = () => {
    try { controller.abort(signal?.reason); } catch { controller.abort(); }
  };
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener?.("abort", abortFromParent, { once: true });

  let timer = null;
  const timeoutError = new ExternalCallTimeoutError(
    `${label} timed out after ${timeoutMs}ms`,
    { label, timeoutMs }
  );
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(timeoutError); } catch { /* noop */ }
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal })),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abortFromParent);
  }
}

export async function withRetry(operation, {
  retries = 2,
  delayMs = 100,
  label = "external_call",
  shouldRetry = defaultShouldRetry
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("withRetry requires an operation function");
  }

  let attempt = 0;
  let lastError = null;
  while (attempt <= retries) {
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && shouldRetry(error, { attempt, label }) !== false;
      if (!canRetry) throw error;
      await wait(typeof delayMs === "function" ? delayMs({ attempt, error, label }) : delayMs);
      attempt += 1;
    }
  }
  throw lastError;
}

export async function fetchExternal(url, init = {}, {
  timeoutMs = 30_000,
  retries = 2,
  delayMs = 100,
  label = "external_fetch",
  signal = null,
  shouldRetry = defaultShouldRetry,
  httpErrorPrefix = "External fetch error"
} = {}) {
  const requestInit = { ...(init ?? {}) };
  const parentSignal = signal ?? requestInit.signal ?? null;
  delete requestInit.signal;

  return withRetry(
    () => withTimeout(async ({ signal: requestSignal }) => {
      const response = await fetch(url, {
        ...requestInit,
        signal: requestSignal
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ExternalCallHttpError(
          `${httpErrorPrefix} ${response.status}: ${body.slice(0, 200)}`,
          { label, status: response.status, body }
        );
      }
      return response;
    }, {
      timeoutMs,
      label,
      signal: parentSignal
    }),
    {
      retries,
      delayMs,
      label,
      shouldRetry
    }
  );
}

function appendDiagnostic(stderr, diagnostic) {
  if (!diagnostic) return stderr ?? "";
  if (!stderr) return diagnostic;
  return `${stderr}\n${diagnostic}`;
}

export function spawnExternal(command, args = [], {
  env = process.env,
  cwd = undefined,
  input = null,
  timeoutMs = 30_000,
  label = "external_spawn",
  signal = null,
  stdio = ["pipe", "pipe", "pipe"],
  windowsHide = true,
  encoding = "utf8",
  onStdout = null,
  onStderr = null,
  timeoutKillSignal = "SIGTERM",
  abortKillSignal = "SIGTERM",
  forceKillSignal = "SIGKILL",
  forceKillAfterMs = 250
} = {}) {
  if (!command) {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: `${label} missing command`,
      exitCode: null,
      exitSignal: null,
      timedOut: false,
      aborted: false,
      spawnError: true
    });
  }

  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: `[${label}] aborted by signal`,
      exitCode: null,
      exitSignal: null,
      timedOut: false,
      aborted: true,
      spawnError: false
    });
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env,
        cwd,
        stdio,
        windowsHide
      });
      child.stdin?.setDefaultEncoding?.(encoding);
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: error.message,
        exitCode: null,
        exitSignal: null,
        timedOut: false,
        aborted: false,
        spawnError: true
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle = null;
    let forceKillHandle = null;

    const cleanup = ({ keepForceKillHandle = false } = {}) => {
      clearTimeout(timeoutHandle);
      if (!keepForceKillHandle) clearTimeout(forceKillHandle);
      signal?.removeEventListener?.("abort", onAbort);
    };

    const finish = (result, cleanupOptions = {}) => {
      if (settled) return;
      settled = true;
      cleanup(cleanupOptions);
      resolve(result);
    };

    const scheduleForceKill = () => {
      if (!Number.isFinite(forceKillAfterMs) || forceKillAfterMs < 0) return;
      forceKillHandle = setTimeout(() => {
        try { child.kill(forceKillSignal); } catch { /* noop */ }
      }, forceKillAfterMs);
    };

    const onTimeout = () => {
      try { child.kill(timeoutKillSignal); } catch { /* noop */ }
      if (timeoutKillSignal !== forceKillSignal) scheduleForceKill();
      finish({
        ok: false,
        stdout,
        stderr: appendDiagnostic(stderr, `[${label}] killed after ${timeoutMs}ms timeout`),
        exitCode: null,
        exitSignal: null,
        timedOut: true,
        aborted: false,
        spawnError: false
      }, { keepForceKillHandle: timeoutKillSignal !== forceKillSignal });
    };

    const onAbort = () => {
      try { child.kill(abortKillSignal); } catch { /* noop */ }
      if (abortKillSignal !== forceKillSignal) scheduleForceKill();
      finish({
        ok: false,
        stdout,
        stderr: appendDiagnostic(stderr, `[${label}] aborted by signal`),
        exitCode: null,
        exitSignal: null,
        timedOut: false,
        aborted: true,
        spawnError: false
      }, { keepForceKillHandle: abortKillSignal !== forceKillSignal });
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(onTimeout, timeoutMs);
    }

    signal?.addEventListener?.("abort", onAbort, { once: true });

    child.stdout?.setEncoding?.(encoding);
    child.stderr?.setEncoding?.(encoding);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      onStderr?.(chunk);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        stdout,
        stderr: appendDiagnostic(stderr, error.message),
        exitCode: null,
        exitSignal: null,
        timedOut: false,
        aborted: false,
        spawnError: true
      });
    });

    child.on("close", (code, closeSignal) => {
      if (settled) {
        clearTimeout(forceKillHandle);
        return;
      }
      finish({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
        exitSignal: closeSignal,
        timedOut: false,
        aborted: false,
        spawnError: false
      });
    });

    try {
      if (input != null) {
        child.stdin?.write(input);
      }
      child.stdin?.end();
    } catch (error) {
      finish({
        ok: false,
        stdout,
        stderr: appendDiagnostic(stderr, error.message),
        exitCode: null,
        exitSignal: null,
        timedOut: false,
        aborted: false,
        spawnError: true
      });
    }
  });
}
