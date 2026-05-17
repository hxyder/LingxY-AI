/**
 * UCA-047 — active window context capture.
 *
 * Extracted from electron-main.mjs so that verify scripts can drive the
 * merge logic without an Electron runtime. The real electron-main wires
 * this helper into the `capture-and-ask` hotkey handler.
 *
 * Contract:
 *
 *   captureActiveWindowContext({ runPowerShell, clipboardFallback })
 *
 *     runPowerShell({ script, args, timeoutMs }) → Promise<{ stdout, stderr }>
 *     clipboardFallback() → string | null  (optional)
 *     clipboardBaseline → string | null     (optional, filters stale copy text)
 *
 * Returns:
 *
 *   {
 *     processName:  string | null,   // from capture-context.ps1
 *     windowTitle:  string | null,
 *     filePaths:    string[],
 *     selectedText: string | null,
 *     activeWindow: {                 // from active-window-probe.ps1
 *       process:      string,
 *       title:        string,
 *       detectedKind: "web_url" | "file_path" | "window_title" | "unknown",
 *       url?:         string,
 *       filePath?:    string,
 *       extra?:       object,
 *       blocked:      boolean
 *     } | null
 *   }
 *
 * The two PowerShell probes run in parallel via Promise.allSettled. Neither
 * probe failing is fatal: the function still returns whatever it could
 * resolve, and the caller is expected to continue in degraded mode.
 */

export const CAPTURE_SCRIPT_NAME = "capture-context.ps1";
export const PROBE_SCRIPT_NAME = "active-window-probe.ps1";

export function parseCaptureContextOutput(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

export function parseActiveWindowProbeOutput(stdout) {
  if (!stdout) return null;
  try {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    // probe writes one JSON line; tolerate logs before it by picking the
    // last line that parses as a JSON object with an `ok` field.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
      } catch { /* try the next line up */ }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Flatten the probe JSON into the shape the overlay consumes. Returns null
 * for blocked / failed probes so the caller can skip rendering the preview
 * card entirely.
 */
export function normalizeActiveWindowProbe(probe) {
  if (!probe || probe.ok === false) return null;
  if (probe.blocked === true) {
    return {
      process: probe.process ?? null,
      title: "",
      detectedKind: "unknown",
      blocked: true,
      extra: probe.payload?.extra ?? {}
    };
  }
  const payload = probe.payload ?? {};
  return {
    process: probe.process ?? null,
    title: probe.title ?? "",
    detectedKind: probe.detected_kind ?? "unknown",
    url: typeof payload.url === "string" ? payload.url : undefined,
    filePath: typeof payload.filePath === "string" ? payload.filePath : undefined,
    extra: payload.extra ?? {},
    blocked: false
  };
}

function buildWindowTitleFallback(result) {
  if (!result?.processName && !result?.windowTitle) return null;
  return {
    process: result.processName || "unknown",
    title: result.windowTitle ?? "",
    detectedKind: "window_title",
    extra: { reason: "capture_context_fallback" },
    blocked: false
  };
}

function parseHttpUrl(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Run both PowerShell probes in parallel and merge the results into a
 * single context object. See contract above for shape.
 */
export async function captureActiveWindowContext({
  runPowerShell,
  clipboardFallback = null,
  captureScriptName = CAPTURE_SCRIPT_NAME,
  probeScriptName = PROBE_SCRIPT_NAME,
  timeoutMs = 3000,
  activeWindowEnabled = true,
  includeSelection = true,
  allowClipboardFallback = true,
  clipboardBaseline = null
} = {}) {
  if (typeof runPowerShell !== "function") {
    throw new Error("captureActiveWindowContext requires a runPowerShell({script,args}) function.");
  }

  const result = {
    processName: null,
    windowTitle: null,
    filePaths: [],
    selectedText: null,
    activeWindow: null
  };

  const [captureResult, probeResult] = await Promise.allSettled([
    includeSelection
      ? runPowerShell({
          script: captureScriptName,
          args: ["-SimulateCopy"],
          timeoutMs
        })
      : Promise.resolve({ stdout: "" }),
    activeWindowEnabled
      ? runPowerShell({
          script: probeScriptName,
          args: [],
          timeoutMs
        })
      : Promise.resolve({ stdout: "" })
  ]);

  if (captureResult.status === "fulfilled") {
    const info = parseCaptureContextOutput(captureResult.value?.stdout);
    if (info) {
      result.processName = info.process ?? null;
      result.windowTitle = info.title ?? null;
      if (Array.isArray(info.files)) {
        result.filePaths = info.files.filter((f) => typeof f === "string" && f.length > 0);
      }
      const clipText = info.text ?? "";
      const trimmed = typeof clipText === "string" ? clipText.trim() : "";
      const baseline = typeof clipboardBaseline === "string" ? clipboardBaseline.trim() : null;
      if (trimmed.length > 2 && (!baseline || trimmed !== baseline)) {
        result.selectedText = trimmed;
      }
    }
  }

  if (includeSelection
      && allowClipboardFallback
      && !result.selectedText
      && result.filePaths.length === 0
      && typeof clipboardFallback === "function") {
    const clipText = clipboardFallback();
    if (typeof clipText === "string" && clipText.trim().length > 2) {
      result.selectedText = clipText.trim();
    }
  }

  if (probeResult.status === "fulfilled") {
    const probe = parseActiveWindowProbeOutput(probeResult.value?.stdout);
    result.activeWindow = normalizeActiveWindowProbe(probe);
  }

  if (!result.activeWindow) {
    result.activeWindow = buildWindowTitleFallback(result);
  }

  return result;
}

/**
 * Build the `shellContextReceived` IPC payload that the overlay consumes,
 * merging `active_window` into the existing capture payload. Callers
 * (electron-main.mjs) pass in the raw result from `captureActiveWindowContext`
 * and the chosen `source_app`.
 */
export function buildShellContextPayload({ context, sourceApp, captureMode = "hotkey_capture" }) {
  const base = {
    targetWindow: "overlay",
    source_app: sourceApp ?? context.processName ?? "unknown",
    capture_mode: captureMode
  };
  if (context.filePaths.length > 0) {
    base.file_paths = context.filePaths;
    return base;
  }
  if (context.selectedText) {
    const selectedUrl = parseHttpUrl(context.selectedText);
    if (selectedUrl) {
      base.capture = {
        sourceType: "link",
        text: "",
        url: selectedUrl,
        pageTitle: context.windowTitle ?? "",
        processName: context.processName ?? null
      };
      return base;
    }
    base.capture = {
      sourceType: "text_selection",
      text: context.selectedText,
      url: context.activeWindow?.url ?? "",
      pageTitle: context.windowTitle ?? "",
      processName: context.processName ?? null
    };
    return base;
  }
  if (context.activeWindow) {
    base.active_window = {
      process: context.activeWindow.process,
      title: context.activeWindow.title,
      detected_kind: context.activeWindow.detectedKind,
      url: context.activeWindow.url ?? null,
      file_path: context.activeWindow.filePath ?? null,
      blocked: Boolean(context.activeWindow.blocked),
      extra: context.activeWindow.extra ?? {}
    };
  }
  // No files or text — still send the base payload so overlay can show the
  // active-window preview card and offer quick actions.
  return base;
}
