import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";

let desktopDiagnosticsInstalled = false;

// Guard against EPIPE: stderr/stdout may be a broken pipe when the parent
// process has already closed. Unguarded console writes in async handlers can
// crash the main process.
export function safeError(...args) {
  try { if (process.stderr?.writable !== false) console.error(...args); } catch { /* swallow */ }
}

export function safeWarn(...args) {
  try { if (process.stderr?.writable !== false) console.warn(...args); } catch { /* swallow */ }
}

export function desktopLogsDir() {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "UCA", "logs");
}

export function serializeDiagnosticError(error) {
  if (!error) return { message: "" };
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  if (typeof error === "object") {
    return {
      message: error.message == null ? String(error) : String(error.message),
      stack: error.stack == null ? null : String(error.stack)
    };
  }
  return { message: String(error) };
}

export async function appendDesktopDiagnosticError(kind, error, metadata = {}) {
  try {
    const dir = desktopLogsDir();
    await mkdir(dir, { recursive: true });
    await appendFile(
      path.join(dir, "desktop-errors.jsonl"),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        kind,
        error: serializeDiagnosticError(error),
        metadata
      })}\n`,
      "utf8"
    );
  } catch (err) {
    safeWarn("[LingxY] failed to write desktop diagnostic error:", err?.message ?? err);
  }
}

export function installDesktopDiagnostics({ app, crashReporter } = {}) {
  if (desktopDiagnosticsInstalled) return;
  desktopDiagnosticsInstalled = true;
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    void appendDesktopDiagnosticError("main_uncaught_exception", error, { origin });
  });
  process.on("unhandledRejection", (reason) => {
    void appendDesktopDiagnosticError("main_unhandled_rejection", reason, {});
  });
  if (!app || !crashReporter?.start) return;
  try {
    const crashDir = path.join(desktopLogsDir(), "crash-dumps");
    void mkdir(crashDir, { recursive: true }).then(() => {
      app.setPath?.("crashDumps", crashDir);
      crashReporter.start({
        uploadToServer: false,
        compress: false,
        globalExtra: {
          app: "LingxY"
        }
      });
    }).catch((error) => {
      void appendDesktopDiagnosticError("crash_reporter_start_failed", error, {});
    });
  } catch (error) {
    void appendDesktopDiagnosticError("crash_reporter_start_failed", error, {});
  }
}
