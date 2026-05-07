import path from "node:path";
import { mkdirSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, unlink, watch, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";
import { createPersistentRuntime } from "../../service/core/persistent-runtime.mjs";
import { createPopupCardManager } from "./popup-card-manager.mjs";
import {
  DESKTOP_CONSOLE_ACTOR,
  desktopActorForSender as resolveDesktopActorForSender
} from "./desktop-actor.mjs";
import {
  DOCK_SIZE_PX,
  dockDefaultBounds,
  normalizeDockBounds
} from "./dock-geometry.mjs";

// Guard against EPIPE — stderr/stdout may be a broken pipe when the parent
// process (Explorer shell, Windows shortcut, etc.) has already closed. Any
// unguarded console.error/warn in an async handler would crash the main
// process with "Error: EPIPE: broken pipe, write".
function safeError(...args) {
  try { if (process.stderr?.writable !== false) console.error(...args); } catch { /* swallow */ }
}
function safeWarn(...args) {
  try { if (process.stderr?.writable !== false) console.warn(...args); } catch { /* swallow */ }
}
import {
  captureActiveWindowContext as runCaptureActiveWindowContext,
  buildShellContextPayload
} from "./active-window-context.mjs";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const PRELOAD_PATH = path.join(RENDERER_DIR, "preload.cjs");
const DESKTOP_ACTOR_HEADER = "X-Lingxy-Desktop-Actor";
const DOCK_WINDOW_ID = "dock";
const ECHO_DOCK_DROP_VOICE_READY_MS = 30_000;
const DOCK_HUD_SCROLL_LOCK_CSS = `
  html, body, #dockButton {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
    overflow: clip !important;
    overscroll-behavior: none !important;
    scrollbar-width: none !important;
  }
  #dockButton {
    display: block !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    transform-origin: center center !important;
  }
  #dockButton canvas,
  canvas#orbCanvas {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
  }
  html::-webkit-scrollbar,
  body::-webkit-scrollbar,
  #dockButton::-webkit-scrollbar,
  *::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
    display: none !important;
  }
`;
let desktopDiagnosticsInstalled = false;

function desktopLogsDir() {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "UCA", "logs");
}

function serializeDiagnosticError(error) {
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

async function appendDesktopDiagnosticError(kind, error, metadata = {}) {
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

function installDesktopDiagnostics({ app, crashReporter } = {}) {
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
    mkdirSync(crashDir, { recursive: true });
    app.setPath?.("crashDumps", crashDir);
    crashReporter.start({
      uploadToServer: false,
      compress: false,
      globalExtra: {
        app: "LingxY"
      }
    });
  } catch (error) {
    void appendDesktopDiagnosticError("crash_reporter_start_failed", error, {});
  }
}

async function readServiceJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json_response", message: text.slice(0, 400) };
  }
}

function normalizeMcpInstallPayload(payload = {}) {
  const timeoutMs = Number(payload.timeoutMs);
  return {
    source: `${payload.source ?? ""}`.trim(),
    id: `${payload.id ?? ""}`.trim(),
    allowScripts: payload.allowScripts === true,
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs: Math.floor(timeoutMs) } : {})
  };
}

function normalizeMcpInstallPreviewPayload(payload = {}) {
  return {
    packageDir: `${payload.packageDir ?? ""}`.trim(),
    packageName: `${payload.packageName ?? ""}`.trim(),
    id: `${payload.id ?? ""}`.trim()
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => `${item ?? ""}`.trim())
    .filter(Boolean);
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [`${key}`.trim(), `${item ?? ""}`])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeMcpServerDescriptorPayload(payload = {}) {
  const transport = `${payload.transport ?? "stdio"}`.trim() || "stdio";
  return {
    id: `${payload.id ?? ""}`.trim(),
    displayName: `${payload.displayName ?? payload.name ?? payload.id ?? ""}`.trim(),
    transport,
    command: payload.command == null ? null : `${payload.command}`.trim(),
    args: normalizeStringArray(payload.args),
    url: payload.url == null ? null : `${payload.url}`.trim(),
    env: normalizeStringMap(payload.env),
    enabled: payload.enabled !== false
  };
}

function normalizeMcpServerId(value) {
  return `${value ?? ""}`.trim();
}

function normalizeMcpServerTogglePayload(payload = {}) {
  return {
    id: normalizeMcpServerId(payload.id),
    enabled: payload.enabled === true
  };
}

function normalizeMcpServerConfigPayload(payload = {}) {
  const values = payload.values && typeof payload.values === "object" && !Array.isArray(payload.values)
    ? Object.fromEntries(Object.entries(payload.values).map(([key, value]) => [
      `${key ?? ""}`.trim(),
      value == null ? "" : `${value}`
    ]).filter(([key]) => key))
    : null;
  const references = Array.isArray(payload.references)
    ? payload.references.map((entry) => ({
      envKey: `${entry?.envKey ?? ""}`.trim(),
      type: `${entry?.type ?? ""}`.trim(),
      name: `${entry?.name ?? ""}`.trim()
    })).filter((entry) => entry.envKey)
    : [];
  return {
    id: normalizeMcpServerId(payload.id),
    key: `${payload.key ?? ""}`.trim(),
    value: payload.value == null ? "" : `${payload.value}`,
    ...(values ? { values } : {}),
    ...(references.length > 0 ? { references } : {})
  };
}

function normalizeMcpDraftImportPayload(payload = {}) {
  return {
    file: `${payload.file ?? ""}`.trim(),
    path: `${payload.path ?? ""}`.trim()
  };
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeApprovalDecisionPayload(payload = {}) {
  return {
    approvalId: `${payload.approvalId ?? payload.approval_id ?? payload.id ?? ""}`.trim(),
    overrides: normalizePlainObject(payload.overrides),
    reason: `${payload.reason ?? ""}`.trim()
  };
}

function buildApprovalDecisionBody(payload, actor, action) {
  const body = { actor };
  if (action === "approve" && payload.overrides) {
    body.overrides = payload.overrides;
  }
  if (action === "reject" && payload.reason) {
    body.reason = payload.reason;
  }
  return body;
}

function normalizeSecurityStatePatch(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeBudgetUpdatePayload(payload = {}) {
  const limits = normalizePlainObject(payload.limits ?? payload) ?? {};
  return { limits };
}

function normalizeScheduleMutationPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeScheduleId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeScheduleIdPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    id: normalizeScheduleId(source.id ?? source.scheduleId ?? source.schedule_id),
    body: normalizePlainObject(source.body ?? source.patch ?? source.payload ?? source) ?? {}
  };
}

function normalizeScheduleRunPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    id: normalizeScheduleId(source.id ?? source.scheduleId ?? source.schedule_id),
    triggerPayload: normalizePlainObject(source.triggerPayload ?? source.trigger_payload ?? {}) ?? {}
  };
}

function normalizeTemplateSavePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    template: normalizePlainObject(source.template ?? source) ?? {}
  };
}

function normalizeTemplateImportPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    raw: source.raw ?? source.template ?? source
  };
}

function normalizeTemplateId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeDagExecutionId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeProviderConfigPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeProviderId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeCodeCliAdapterPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeCodeCliAdapterId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeSkillRegistryPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeSkillRegistryId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeAutoSkillPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeSkillMarkdownWritePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : "",
    markdown: source.markdown == null ? "" : `${source.markdown}`
  };
}

function normalizeSkillMarkdownReadPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
}

function normalizeSkillCreatePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : "New Skill",
    description: typeof source.description === "string" ? source.description : "",
    markdown: typeof source.markdown === "string" ? source.markdown : ""
  };
}

function normalizeSkillDuplicatePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : "",
    id: typeof source.id === "string" ? source.id : "",
    name: typeof source.name === "string" ? source.name : ""
  };
}

function normalizeSkillHistoryPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
}

function normalizeSkillRollbackPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : "",
    historyId: typeof source.historyId === "string" ? source.historyId : ""
  };
}

function normalizeSkillTestPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  const normalized = {
    entryPath: typeof source.entryPath === "string" ? source.entryPath : ""
  };
  if (Object.prototype.hasOwnProperty.call(source, "markdown")) {
    normalized.markdown = source.markdown == null ? "" : `${source.markdown}`;
  }
  return normalized;
}

function normalizeRuntimeConfigPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeEmailAccountPayload(payload = {}) {
  return normalizePlainObject(payload) ?? {};
}

function normalizeEmailAccountId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeEmailDigestCheckPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    force: source.force === true
  };
}

function normalizeNotesSavePayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  const source = normalizePlainObject(payload) ?? {};
  return Array.isArray(source.notes) ? source.notes : [];
}

function normalizeNoteUpsertPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    note: normalizePlainObject(source.note ?? source) ?? {}
  };
}

function normalizeNoteId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeNoteAppendChipPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    noteId: `${source.noteId ?? source.note_id ?? "__new__"}`.trim() || "__new__",
    text: source.text == null ? "" : `${source.text}`,
    sourceLabel: source.sourceLabel ?? source.source_label ?? null,
    title: source.title ?? null
  };
}

function normalizeProjectStoreSavePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    store: normalizePlainObject(source.store ?? source) ?? {}
  };
}

function normalizeProjectFilesAttachPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    paths: Array.isArray(source.paths)
      ? source.paths.filter((filePath) => typeof filePath === "string" && filePath.trim()).map((filePath) => filePath.trim())
      : [],
    projectId: typeof source.projectId === "string" ? source.projectId.trim() : ""
  };
}

function normalizeProjectFilesRemoveIndexPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    paths: Array.isArray(source.paths)
      ? source.paths.filter((filePath) => typeof filePath === "string" && filePath.trim()).map((filePath) => filePath.trim())
      : [],
    projectId: typeof source.projectId === "string" ? source.projectId.trim() : "",
    detach: source.detach === true
  };
}

function normalizeConnectedAccountId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeConnectorAccountType(type) {
  const value = typeof type === "string" ? type.trim() : "";
  return value === "microsoft" || value === "google" ? value : "";
}

function normalizeConnectedAccountRenamePayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    accountId: normalizeConnectedAccountId(source.accountId ?? source.account_id ?? source.id),
    displayName: `${source.displayName ?? source.display_name ?? ""}`.trim()
  };
}

function normalizeConnectedAccountDefaultPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    accountId: normalizeConnectedAccountId(source.accountId ?? source.account_id ?? source.id),
    purpose: `${source.purpose ?? ""}`.trim()
  };
}

function normalizeConnectorAccountConfigPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  const config = normalizePlainObject(source.config ?? source.body ?? source.payload) ?? {};
  const body = {};
  if (typeof config.clientId === "string") body.clientId = config.clientId.trim();
  if (typeof config.clientSecret === "string") body.clientSecret = config.clientSecret.trim();
  return {
    type: normalizeConnectorAccountType(source.type ?? source.provider),
    body
  };
}

function normalizeTaskId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeTaskCancelPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    taskId: normalizeTaskId(source.taskId ?? source.task_id ?? source.id),
    force: source.force === true
  };
}

function normalizeTaskRetryPayload(payload = {}) {
  const source = normalizePlainObject(payload) ?? {};
  return {
    taskId: normalizeTaskId(source.taskId ?? source.task_id ?? source.id),
    mode: `${source.mode ?? "retry_same"}`.trim() || "retry_same",
    overrides: normalizePlainObject(source.overrides) ?? {},
    background: source.background === true || source.returnImmediately === true
  };
}

async function requestDesktopServiceJson({
  base,
  pathname,
  method = "POST",
  body,
  actor = DESKTOP_CONSOLE_ACTOR
}) {
  const headers = {
    [DESKTOP_ACTOR_HEADER]: actor
  };
  const requestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(body ?? {});
  }
  const response = await fetch(`${base}${pathname}`, {
    ...requestInit
  });
  const result = await readServiceJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? "desktop_service_request_failed",
      message: result.message ?? `Desktop service request failed with HTTP ${response.status}.`,
      status: response.status,
      ...result
    };
  }
  return result;
}

async function postDesktopServiceJson({ base, pathname, body, actor = DESKTOP_CONSOLE_ACTOR }) {
  return requestDesktopServiceJson({ base, pathname, method: "POST", body, actor });
}

function bufferFromIpcBinary(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.alloc(0);
}

async function postDesktopServiceBinary({
  base,
  pathname,
  search = "",
  body,
  contentType = "application/octet-stream",
  actor = "desktop_shell"
}) {
  const response = await fetch(`${base}${pathname}${search}`, {
    method: "POST",
    headers: {
      [DESKTOP_ACTOR_HEADER]: actor,
      "Content-Type": contentType || "application/octet-stream"
    },
    body: bufferFromIpcBinary(body)
  });
  const result = await readServiceJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: result.error ?? "desktop_service_request_failed",
      message: result.message ?? `Desktop service request failed with HTTP ${response.status}.`,
      status: response.status,
      ...result
    };
  }
  return result;
}

async function postDesktopServiceBinaryStream({
  base,
  pathname,
  search = "",
  body,
  contentType = "application/octet-stream",
  actor = "desktop_overlay",
  firstFrameTimeoutMs = 30_000,
  onEvent
}) {
  const controller = new AbortController();
  let firstFrameTimer = null;
  let gotAnyFrame = false;
  let sawError = false;
  let assembled = "";
  let finalTranscript = "";
  const clearFirstFrameTimer = () => {
    if (firstFrameTimer) clearTimeout(firstFrameTimer);
    firstFrameTimer = null;
  };
  firstFrameTimer = setTimeout(() => controller.abort(), firstFrameTimeoutMs);
  try {
    const response = await fetch(`${base}${pathname}${search}`, {
      method: "POST",
      headers: {
        [DESKTOP_ACTOR_HEADER]: actor,
        "Content-Type": contentType || "application/octet-stream"
      },
      body: bufferFromIpcBinary(body),
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      clearFirstFrameTimer();
      const result = await readServiceJson(response);
      return {
        ok: false,
        error: result.error ?? "note_transcribe_stream_failed",
        message: result.message ?? `Desktop service request failed with HTTP ${response.status}.`,
        status: response.status,
        ...result
      };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        let event;
        try { event = JSON.parse(dataLine.slice(5).trim()); }
        catch { continue; }
        if (!gotAnyFrame) {
          gotAnyFrame = true;
          clearFirstFrameTimer();
        }
        onEvent?.(event);
        if (event.type === "segment" && event.text) {
          assembled += (assembled ? "\n" : "") + event.text;
        } else if (event.type === "done") {
          finalTranscript = `${event.transcript ?? assembled}`.trim();
        } else if (event.type === "error") {
          sawError = true;
        }
      }
    }
  } catch (error) {
    clearFirstFrameTimer();
    return {
      ok: false,
      error: error?.name === "AbortError" ? "note_transcribe_stream_timeout" : "note_transcribe_stream_failed",
      message: error?.message ?? String(error)
    };
  } finally {
    clearFirstFrameTimer();
  }
  if (!gotAnyFrame || sawError) {
    return {
      ok: false,
      error: sawError ? "note_transcribe_stream_error" : "note_transcribe_stream_empty"
    };
  }
  return {
    ok: true,
    transcript: finalTranscript || assembled
  };
}

function buildWindowUrl(windowDef, serviceBaseUrl) {
  const filePath = path.join(RENDERER_DIR, `${windowDef.id}.html`);
  const url = new URL(pathToFileURL(filePath).toString());
  url.searchParams.set("windowId", windowDef.id);
  url.searchParams.set("route", windowDef.route);
  url.searchParams.set("serviceBaseUrl", serviceBaseUrl);
  return url.toString();
}

function resolveWindowOptions(windowDef) {
  if (windowDef.id === "dock") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      thickFrame: false,
      transparent: true,
      resizable: false,
      useContentSize: true,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false
    };
  }

  if (windowDef.id === "overlay") {
    return {
      alwaysOnTop: false,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: true,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false
    };
  }

  if (windowDef.id === "echo-bubble") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      focusable: false,  // never steal focus from the user's active app
      closable: false
    };
  }

  return {
    autoHideMenuBar: true
  };
}

export function createElectronShellRuntime({
  electron,
  serviceBaseUrl = process.env.UCA_SERVICE_BASE_URL ?? "http://127.0.0.1:4310"
} = {}) {
  if (!electron) {
    throw new Error("Electron bindings are required to create the shell runtime.");
  }

  const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, screen, clipboard, session, desktopCapturer, crashReporter, dialog, shell } = electron;
  installDesktopDiagnostics({ app, crashReporter });
  const windows = new Map();
  const readyWindows = new Set();
  const pendingWindowMessages = new Map();
  const handoffDir = path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");
  const handoffFilePattern = /^prompt-handoff-.*\.json$/i;
  const processedHandoffFiles = new Set();
  const notificationDir = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "UCA", "notifications");
  const notificationFilePattern = /^notification-.*\.json$/i;
  const processedNotificationFiles = new Set();
  let tray = null;
  let quitting = false;
  let resolvedServiceBaseUrl = serviceBaseUrl;
  let handoffWatcher = null;
  let notificationWatcher = null;
  let embeddedServiceRuntime = null;
  let noteRecordingState = { active: false };
  let lastExternalWindowContext = null;
  let registeredPopupCardManager = null;
  let dockDisplayRepairInstalled = false;
  // UCA-182 Phase 14: dedicated preview BrowserWindow anchored to the
  // right edge of the primary display. Created lazily on first show
  // so apps that never preview a file don't pay the memory cost.
  let previewWindow = null;
  let previewWindowPinned = false;
  const linkBrowserWindows = new Set();

  function desktopActorForSender(sender) {
    return resolveDesktopActorForSender(sender, windows);
  }

  function servicePortFromUrl(urlValue) {
    try {
      const parsed = new URL(urlValue);
      return parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
    } catch {
      return 4310;
    }
  }

  function shouldHostEmbeddedService(urlValue) {
    try {
      const parsed = new URL(urlValue);
      return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  async function serviceIsHealthy() {
    try {
      const response = await fetch(`${resolvedServiceBaseUrl}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function waitForServiceHealth(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await serviceIsHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  async function ensureEmbeddedServiceRuntime() {
    if (await serviceIsHealthy()) return null;
    if (!shouldHostEmbeddedService(resolvedServiceBaseUrl)) return null;
    if (embeddedServiceRuntime) return embeddedServiceRuntime;
    embeddedServiceRuntime = createPersistentRuntime({
      port: servicePortFromUrl(resolvedServiceBaseUrl)
    });
    let listening;
    try {
      listening = await embeddedServiceRuntime.start();
    } catch (error) {
      embeddedServiceRuntime = null;
      if (await waitForServiceHealth()) return null;
      throw error;
    }
    resolvedServiceBaseUrl = listening.baseUrl ?? resolvedServiceBaseUrl;
    return embeddedServiceRuntime;
  }

  // Desktop shell settings (echo mode, future flags). Persisted as JSON in
  // AppData/Local/UCA/settings.json. Loaded lazily on first access; callers
  // mutate via updateSettings() which also broadcasts to interested windows.
  const settingsPath = path.join(os.homedir(), "AppData", "Local", "UCA", "settings.json");
  let settingsCache = null;
  const WINDOW_ALWAYS_ON_TOP_DEFAULTS = Object.freeze({
    dock: true,
    overlay: false,
    console: false,
    "echo-bubble": true
  });
  const WINDOW_SIZE_LIMITS = Object.freeze({
    dock: { minWidth: DOCK_SIZE_PX, minHeight: DOCK_SIZE_PX, maxWidth: DOCK_SIZE_PX, maxHeight: DOCK_SIZE_PX },
    overlay: { minWidth: 420, minHeight: 360, maxWidth: 1400, maxHeight: 1200 }
  });

  function mergeSettingsDefaults(raw = {}) {
    return {
      echoMode: false,
      echoWake: {
        displayName: "linxi",
        phrases: [],
        includeDefault: true
      },
      windowPreferences: {},
      ...raw,
      echoWake: {
        displayName: raw?.echoWake?.displayName || "linxi",
        phrases: Array.isArray(raw?.echoWake?.phrases) ? raw.echoWake.phrases : [],
        includeDefault: raw?.echoWake?.includeDefault !== false
      },
      windowPreferences: {
        ...(raw?.windowPreferences ?? {})
      }
    };
  }

  async function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
      const text = await readFile(settingsPath, "utf8");
      settingsCache = mergeSettingsDefaults(JSON.parse(text));
    } catch {
      settingsCache = mergeSettingsDefaults();
    }
    return settingsCache;
  }
  async function saveSettings() {
    try {
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settingsCache ?? {}, null, 2), "utf8");
    } catch (err) {
      safeError("[LingxY] failed to persist settings:", err?.message ?? err);
    }
  }
  async function updateSettings(patch) {
    const current = await loadSettings();
    settingsCache = mergeSettingsDefaults({
      ...current,
      ...patch,
      windowPreferences: {
        ...(current?.windowPreferences ?? {}),
        ...(patch?.windowPreferences ?? {})
      },
      echoWake: patch?.echoWake
        ? mergeSettingsDefaults({ echoWake: patch.echoWake }).echoWake
        : current?.echoWake
    });
    await saveSettings();
    for (const browserWindow of windows.values()) {
      if (!browserWindow.webContents?.isDestroyed?.()) {
        browserWindow.webContents.send("uca:shell-settings-changed", settingsCache);
      }
    }
    return settingsCache;
  }

  function getWindowPreferences(windowId) {
    return settingsCache?.windowPreferences?.[windowId] ?? {};
  }

  function isWindowAlwaysOnTop(windowId) {
    if (windowId === DOCK_WINDOW_ID) return true;
    const prefs = getWindowPreferences(windowId);
    if (typeof prefs.alwaysOnTop === "boolean") return prefs.alwaysOnTop;
    return WINDOW_ALWAYS_ON_TOP_DEFAULTS[windowId] ?? false;
  }

  function getWindowSizeLimits(windowId) {
    return WINDOW_SIZE_LIMITS[windowId] ?? { minWidth: 320, minHeight: 240, maxWidth: 2000, maxHeight: 1600 };
  }

  function clampWindowBounds(windowId, bounds = {}, options = {}) {
    const fallbackWorkArea = screen.getPrimaryDisplay().workArea;
    if (windowId === DOCK_WINDOW_ID) {
      const tentativeDockBounds = {
        x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : fallbackWorkArea.x,
        y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : fallbackWorkArea.y,
        width: Number.isFinite(bounds.width) ? Math.round(bounds.width) : DOCK_SIZE_PX,
        height: Number.isFinite(bounds.height) ? Math.round(bounds.height) : DOCK_SIZE_PX
      };
      const dockDisplay = screen.getDisplayMatching?.(tentativeDockBounds) ?? screen.getPrimaryDisplay();
      return normalizeDockBounds(tentativeDockBounds, dockDisplay, {
        fallbackArea: fallbackWorkArea,
        migrateLegacy: Boolean(options.migrateLegacy),
        snap: options.mode === "move"
      });
    }
    const limits = getWindowSizeLimits(windowId);
    const width = Math.max(limits.minWidth, Math.min(limits.maxWidth, Math.round(bounds.width ?? limits.minWidth)));
    const height = Math.max(limits.minHeight, Math.min(limits.maxHeight, Math.round(bounds.height ?? limits.minHeight)));
    const tentative = {
      x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : fallbackWorkArea.x,
      y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : fallbackWorkArea.y,
      width,
      height
    };
    const matchingDisplay = screen.getDisplayMatching?.(tentative) ?? screen.getPrimaryDisplay();
    const workArea = matchingDisplay.workArea ?? fallbackWorkArea;
    const overlayMove = windowId === "overlay" && options.mode === "move";
    const visibleMargin = overlayMove ? 96 : 0;
    const minX = overlayMove ? workArea.x - width + visibleMargin : workArea.x;
    const minY = overlayMove ? workArea.y - height + visibleMargin : workArea.y;
    const maxX = overlayMove
      ? workArea.x + workArea.width - visibleMargin
      : workArea.x + Math.max(0, workArea.width - width);
    const maxY = overlayMove
      ? workArea.y + workArea.height - visibleMargin
      : workArea.y + Math.max(0, workArea.height - height);
    let x = Math.max(minX, Math.min(maxX, tentative.x));
    let y = Math.max(minY, Math.min(maxY, tentative.y));
    return {
      x,
      y,
      width,
      height
    };
  }

  function getDefaultWindowBounds(windowDef, browserWindow) {
    const { workArea } = screen.getPrimaryDisplay();
    const [currentWidth, currentHeight] = browserWindow.getSize();
    const width = currentWidth || windowDef.width;
    const height = currentHeight || windowDef.height;
    if (windowDef.id === "dock") {
      return dockDefaultBounds(screen.getPrimaryDisplay(), { fallbackArea: workArea });
    }
    if (windowDef.id === "overlay") {
      return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.max(workArea.y, workArea.y + workArea.height - height - 16),
        width,
        height
      };
    }
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + Math.max(0, workArea.height - height) / 2),
      width,
      height
    };
  }

  function resolveWindowBounds(windowDef, browserWindow) {
    const prefs = getWindowPreferences(windowDef.id);
    const defaults = getDefaultWindowBounds(windowDef, browserWindow);
    if (prefs?.bounds && Number.isFinite(prefs.bounds.x) && Number.isFinite(prefs.bounds.y) && Number.isFinite(prefs.bounds.width) && Number.isFinite(prefs.bounds.height)) {
      // Dock is a fixed-size 48×48 orb. Some past sessions persisted the
      // Electron BrowserWindow default 320×240 (when the window was first
      // created without explicit dimensions) into settings.json, which
      // then survives every relaunch and surrounds the visible orb with
      // a giant transparent hitbox. Preserve the old size long enough for
      // dock geometry migration to project legacy right/bottom-edge intent
      // onto the current 48×48 content bounds.
      const bounds = prefs.bounds;
      return clampWindowBounds(windowDef.id, bounds, { migrateLegacy: windowDef.id === "dock" });
    }
    return clampWindowBounds(windowDef.id, defaults);
  }

  function getManagedWindowBounds(windowId, browserWindow) {
    if (windowId === "dock" && typeof browserWindow.getContentBounds === "function") {
      return browserWindow.getContentBounds();
    }
    return browserWindow.getBounds();
  }

  function setManagedWindowBounds(windowId, browserWindow, bounds) {
    if (windowId === "dock" && typeof browserWindow.setContentBounds === "function") {
      browserWindow.setContentBounds(bounds);
      return;
    }
    browserWindow.setBounds(bounds);
  }

  function lockWindowRendererZoom(windowDef, browserWindow) {
    if (!windowDef?.locksRendererZoom || !browserWindow?.webContents || browserWindow.webContents.isDestroyed?.()) {
      return;
    }
    // Tiny HUD windows are sized by Electron content bounds. If Chromium
    // restores or accepts page zoom above 100%, CSS boxes can exceed the
    // content viewport and native scrollbars appear.
    try { browserWindow.webContents.setZoomFactor?.(1); } catch { /* ignore */ }
    try { void browserWindow.webContents.setVisualZoomLevelLimits?.(1, 1); } catch { /* ignore */ }
  }

  function applyWindowPresentation(windowId, browserWindow) {
    const alwaysOnTop = isWindowAlwaysOnTop(windowId);
    browserWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
  }

  function equalWindowBounds(left = {}, right = {}) {
    return Math.round(left.x ?? 0) === Math.round(right.x ?? 0)
      && Math.round(left.y ?? 0) === Math.round(right.y ?? 0)
      && Math.round(left.width ?? 0) === Math.round(right.width ?? 0)
      && Math.round(left.height ?? 0) === Math.round(right.height ?? 0);
  }

  function enforceDockWindowInvariants(browserWindow, bounds = null) {
    if (!browserWindow || browserWindow.isDestroyed?.()) return null;
    const limits = getWindowSizeLimits(DOCK_WINDOW_ID);
    try { browserWindow.setResizable?.(false); } catch { /* ignore */ }
    try { browserWindow.setMinimumSize?.(limits.minWidth, limits.minHeight); } catch { /* ignore */ }
    try { browserWindow.setMaximumSize?.(limits.maxWidth, limits.maxHeight); } catch { /* ignore */ }
    lockWindowRendererZoom({ locksRendererZoom: true }, browserWindow);
    const currentBounds = bounds ?? getManagedWindowBounds(DOCK_WINDOW_ID, browserWindow);
    const nextBounds = clampWindowBounds(DOCK_WINDOW_ID, {
      ...currentBounds,
      width: limits.minWidth,
      height: limits.minHeight
    });
    if (equalWindowBounds(currentBounds, nextBounds)) return null;
    setManagedWindowBounds(DOCK_WINDOW_ID, browserWindow, nextBounds);
    return nextBounds;
  }

  function installDockHudScrollLock(browserWindow) {
    if (!browserWindow?.webContents || browserWindow.webContents.isDestroyed?.()) return;
    try {
      void browserWindow.webContents.insertCSS(DOCK_HUD_SCROLL_LOCK_CSS, { cssOrigin: "author" });
    } catch { /* ignore */ }
  }

  function persistWindowPreferences(windowId, patch = {}) {
    void (async () => {
      const current = await loadSettings();
      const existing = current.windowPreferences?.[windowId] ?? {};
      await updateSettings({
        windowPreferences: {
          [windowId]: {
            ...existing,
            ...patch
          }
        }
      });
    })();
  }

  let activeWindowMemoryPollInFlight = false;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function looksLikeShellWindowContext(context) {
    const activeWindow = context?.activeWindow;
    const processName = `${activeWindow?.process ?? context?.processName ?? ""}`.toLowerCase();
    const title = `${activeWindow?.title ?? context?.windowTitle ?? ""}`.toLowerCase();
    return processName.includes("electron")
      || processName.includes("universal-context-agent")
      || processName === "uca"
      || title === "uca"
      || title.includes("uca overlay")
      || title.includes("uca dock")
      || title.includes("universal context agent")
      || (processName === "node" && title.includes("uca"));
  }

  function rememberExternalWindowContext(context) {
    if (!context?.activeWindow || context.activeWindow.blocked) return;
    if (looksLikeShellWindowContext(context)) return;
    lastExternalWindowContext = {
      context,
      updatedAt: Date.now()
    };
  }

  function preferLastExternalWindowContext(context, options = {}) {
    if (!options?.preferLastExternal) return context;
    if (!looksLikeShellWindowContext(context)) return context;
    const maxAgeMs = Number(options.maxExternalAgeMs ?? 10 * 60_000);
    if (!lastExternalWindowContext?.context) return context;
    if (Date.now() - lastExternalWindowContext.updatedAt > maxAgeMs) return context;
    return lastExternalWindowContext.context;
  }

  function startActiveWindowMemoryPoll() {
    setInterval(() => {
      if (activeWindowMemoryPollInFlight) return;
      activeWindowMemoryPollInFlight = true;
      captureActiveWindowContext({ includeSelection: false })
        .catch(() => {})
        .finally(() => { activeWindowMemoryPollInFlight = false; });
    }, 3000);
  }

  function buildOverlayPayloadFromFiles(filePaths, sourceApp = "uca.dock", captureMode = "dock_drop", options = {}) {
    return {
      source_app: sourceApp,
      capture_mode: captureMode,
      file_paths: filePaths,
      targetWindow: "overlay",
      mode: options.mode ?? null,
      surface: options.surface ?? null,
      voiceContinueTtlMs: options.voiceContinueTtlMs ?? 0
    };
  }

  function enqueueWindowMessage(windowId, channel, payload) {
    const target = windows.get(windowId);
    if (target && readyWindows.has(windowId)) {
      target.webContents.send(channel, payload);
      return;
    }

    const queued = pendingWindowMessages.get(windowId) ?? [];
    queued.push({ channel, payload });
    pendingWindowMessages.set(windowId, queued);
  }

  function flushWindowMessages(windowId) {
    const target = windows.get(windowId);
    const queued = pendingWindowMessages.get(windowId) ?? [];
    if (!target || queued.length === 0) {
      return;
    }

    for (const message of queued) {
      target.webContents.send(message.channel, message.payload);
    }
    pendingWindowMessages.delete(windowId);
  }

  // 83.2 — Notification batching.
  //
  // A single user submission can fire 4+ shellNotify calls in quick succession
  // (task_created, inline_result, artifact_ready, success). Before the batch
  // layer each of those became its own top-right card, drowning the screen.
  //
  // Strategy:
  //   - Keep an in-memory buffer keyed by taskId. Each non-error info-style
  //     notification pushes an entry onto the task's buffer and resets a
  //     500ms debounce timer.
  //   - When the timer fires OR a priority notification (error/approval)
  //     arrives for the same task, flush the buffer as a single "batched"
  //     popup card with entries[] and let the renderer handle paging 1/N.
  //   - Errors and approvals skip the buffer entirely — they're immediate,
  //     actionable, and must not be hidden behind pagination.
  //   - A single entry in the buffer still renders as "batched" but the UI
  //     collapses to the simple one-notification form; no UX regression
  //     for single-notification tasks.
  const notificationBatches = new Map(); // taskId -> { entries, timer, primaryTitle }
  const NOTIFICATION_BATCH_MS = 500;

  function notificationBodyLines(payload, defaultLimit = 4) {
    const body = payload.allowLongBody === true && payload.inlinePreview
      ? payload.inlinePreview
      : (payload.body ?? payload.message ?? "");
    if (!body) return [];
    const lines = String(body).split(/\r?\n/);
    if (payload.allowLongBody === true && payload.forcePopup === true) return lines;
    const limit = payload.allowLongBody === true ? 240 : payload.kind === "success" ? 80 : defaultLimit;
    if (lines.length <= limit) return lines;
    return [
      ...lines.slice(0, limit),
      `... ${lines.length - limit} more line(s). Open the conversation for the full result.`
    ];
  }

  function normalizeBatchEntry(payload) {
    return {
      title: payload.title ?? "LingxY",
      lines: notificationBodyLines(payload),
      kind: payload.kind ?? "info",
      taskId: payload.taskId ?? null,
      conversationId: payload.conversationId ?? null,
      artifactPath: payload.artifactPath ?? null,
      mime: payload.mime ?? null,
      inlinePreview: payload.inlinePreview ?? null,
      openWindow: payload.openWindow ?? null,
      handoff: payload.handoff ?? null,
      allowLongBody: payload.allowLongBody ?? null,
      allowContinue: payload.allowContinue ?? null,
      forcePopup: payload.forcePopup ?? null,
      addedAt: Date.now()
    };
  }

  function flushBatch(taskId) {
    const batch = notificationBatches.get(taskId);
    if (!batch) return;
    clearTimeout(batch.timer);
    notificationBatches.delete(taskId);
    if (!batch.entries.length) return;
    if (!registeredPopupCardManager) return;
    try {
      // If only one entry, render as a plain info card (no carousel chrome).
      // If multiple entries, render as "batched" kind with paging controls.
      if (batch.entries.length === 1) {
        const only = batch.entries[0];
        registeredPopupCardManager.showCard({
          kind: only.kind === "info" ? "info" : only.kind,
          title: only.title,
          lines: only.lines,
          taskId,
          conversationId: only.conversationId ?? null,
          autoHideMs: 8000,
          artifactPath: only.artifactPath,
          mime: only.mime,
          inlinePreview: only.inlinePreview,
          openWindow: only.openWindow,
          allowContinue: only.allowContinue,
          forcePopup: only.forcePopup,
          dedupeKey: `notify:${taskId}`
        });
      } else {
        registeredPopupCardManager.showCard({
          kind: "batched",
          title: `${batch.primaryTitle} (${batch.entries.length})`,
          taskId,
          conversationId: batch.entries.find((entry) => entry.conversationId)?.conversationId ?? null,
          entries: batch.entries,
          autoHideMs: 12000,
          dedupeKey: `batched:${taskId}`
        });
      }
    } catch (err) {
      safeWarn("[LingxY] batched popup-card flush failed:", err?.message ?? err);
    }
  }

  function queueBatchedNotification(payload) {
    const taskId = payload.taskId ?? "_no_task_";
    let batch = notificationBatches.get(taskId);
    if (!batch) {
      batch = { entries: [], timer: null, primaryTitle: payload.title ?? "LingxY" };
      notificationBatches.set(taskId, batch);
    }
    batch.entries.push(normalizeBatchEntry(payload));
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => flushBatch(taskId), NOTIFICATION_BATCH_MS);
  }

  function showDesktopNotification(payload = {}) {
    const uiOpen = ["overlay", "console"].some((id) => {
      const win = windows.get(id);
      return Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
    });
    if (payload.kind === "success" && uiOpen && payload.forcePopup !== true) {
      return { shown: false, reason: "primary_ui_visible" };
    }

    // UCA-182 Phase 8: all in-app notifications now route through the
    // popup-card stack (top-right). 83.2 adds batching on top so a single
    // task's rapid-fire notifications collapse into one paged card.
    if (registeredPopupCardManager) {
      try {
        // Skip batching for errors, approvals, explicit urgent, or when the
        // payload explicitly opts out via skipBatch. Also skip when no taskId
        // is provided — without one we can't group sensibly.
        const skipBatch =
          payload.skipBatch === true ||
          payload.kind === "error" ||
          payload.kind === "approval" ||
          (payload.forcePopup === true && payload.allowLongBody === true) ||
          !payload.taskId;
        if (skipBatch) {
          registeredPopupCardManager.showCard({
            kind: payload.kind ?? "info",
            title: payload.title ?? "LingxY",
            lines: notificationBodyLines(payload),
            taskId: payload.taskId ?? null,
            conversationId: payload.conversationId ?? null,
            autoHideMs: payload.autoHideMs ?? 8000,
            artifactPath: payload.artifactPath ?? null,
            mime: payload.mime ?? null,
            inlinePreview: payload.inlinePreview ?? null,
            openWindow: payload.openWindow ?? null,
            handoff: payload.handoff ?? null,
            allowContinue: payload.allowContinue ?? null,
            dedupeKey: payload.dedupeKey
              ?? (payload.taskId ? `notify:${payload.taskId}` : undefined)
          });
          return { shown: true, delivery: "popup_card" };
        }
        queueBatchedNotification(payload);
        return { shown: true, delivery: "popup_card_batched" };
      } catch (err) {
        safeWarn("[LingxY] popup-card notify failed, falling back:", err?.message ?? err);
      }
    }

    if (!Notification?.isSupported?.()) {
      return { shown: false, reason: "unsupported" };
    }

    const notification = new Notification({
      title: payload.title ?? "LingxY",
      body: payload.body ?? payload.message ?? "",
      silent: false
    });
    notification.show();
    return { shown: true, delivery: "native_notification" };
  }

  function getArgValue(argv, flagName) {
    const index = argv.findIndex((item) => item === flagName);
    if (index < 0 || index + 1 >= argv.length) {
      return null;
    }
    return argv[index + 1];
  }

  async function handleLaunchArgs(argv = []) {
    const requestedServiceBaseUrl = getArgValue(argv, "--uca-service-url");
    if (requestedServiceBaseUrl) {
      resolvedServiceBaseUrl = requestedServiceBaseUrl;
    }

    const handoffFile = getArgValue(argv, "--uca-handoff-file");
    if (handoffFile) {
      await consumeHandoffFile(handoffFile);
      return true;
    }

    if (argv.includes("--uca-open-overlay")) {
      showWindow("overlay");
      return true;
    }

    return false;
  }

  async function consumeHandoffFile(handoffFile) {
    if (!handoffFilePattern.test(path.basename(handoffFile))) {
      return false;
    }
    if (processedHandoffFiles.has(handoffFile)) {
      return false;
    }

    processedHandoffFiles.add(handoffFile);
    try {
      const raw = await readFile(handoffFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      await unlink(handoffFile).catch(() => {});
      showWindow("overlay");
      enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
        ...payload,
        targetWindow: "overlay"
      });
      return true;
    } finally {
      processedHandoffFiles.delete(handoffFile);
    }
  }

  async function drainHandoffDirectory() {
    try {
      const entries = await readdir(handoffDir, { withFileTypes: true });
      const handoffFiles = entries
        .filter((entry) => entry.isFile() && handoffFilePattern.test(entry.name))
        .map((entry) => path.join(handoffDir, entry.name))
        .sort((left, right) => left.localeCompare(right));

      for (const handoffFile of handoffFiles) {
        await consumeHandoffFile(handoffFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to drain explorer handoff directory", error);
      }
    }
  }

  async function startHandoffWatcher() {
    await drainHandoffDirectory();

    try {
      handoffWatcher = watch(handoffDir);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to watch explorer handoff directory", error);
      }
      return;
    }

    (async () => {
      try {
        for await (const event of handoffWatcher) {
          if (!event.filename || !handoffFilePattern.test(event.filename)) {
            continue;
          }
          await consumeHandoffFile(path.join(handoffDir, event.filename));
        }
      } catch (error) {
        if (!quitting && error?.name !== "AbortError") {
          safeError("Explorer handoff watcher stopped unexpectedly", error);
        }
      }
    })().catch((error) => {
      safeError("Explorer handoff watcher task failed", error);
    });
  }

  async function consumeNotificationFile(notificationFile) {
    if (!notificationFilePattern.test(path.basename(notificationFile))) {
      return false;
    }
    if (processedNotificationFiles.has(notificationFile)) {
      return false;
    }

    processedNotificationFiles.add(notificationFile);
    try {
      const raw = await readFile(notificationFile, "utf8").catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (!raw) {
        return false;
      }
      const payload = JSON.parse(raw);
      await unlink(notificationFile).catch(() => {});
      showDesktopNotification(payload);
      return true;
    } finally {
      processedNotificationFiles.delete(notificationFile);
    }
  }

  async function drainNotificationDirectory() {
    try {
      await mkdir(notificationDir, { recursive: true });
      const entries = await readdir(notificationDir, { withFileTypes: true });
      const notificationFiles = entries
        .filter((entry) => entry.isFile() && notificationFilePattern.test(entry.name))
        .map((entry) => path.join(notificationDir, entry.name))
        .sort((left, right) => left.localeCompare(right));

      for (const notificationFile of notificationFiles) {
        await consumeNotificationFile(notificationFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to drain notification directory", error);
      }
    }
  }

  async function startNotificationWatcher() {
    await drainNotificationDirectory();

    try {
      await mkdir(notificationDir, { recursive: true });
      notificationWatcher = watch(notificationDir);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        safeError("Failed to watch notification directory", error);
      }
      return;
    }

    (async () => {
      try {
        for await (const event of notificationWatcher) {
          if (!event.filename || !notificationFilePattern.test(event.filename)) {
            continue;
          }
          await consumeNotificationFile(path.join(notificationDir, event.filename));
        }
      } catch (error) {
        if (!quitting && error?.name !== "AbortError") {
          safeError("Notification watcher stopped unexpectedly", error);
        }
      }
    })().catch((error) => {
      safeError("Notification watcher task failed", error);
    });
  }

  async function requestMorningDigestCheck() {
    if (typeof fetch !== "function") {
      return;
    }
    try {
      await requestDesktopServiceJson({
        base: resolvedServiceBaseUrl ?? "http://127.0.0.1:4310",
        actor: "desktop_shell",
        method: "POST",
        pathname: "/email/digest/check",
        body: {}
      });
    } catch (error) {
      safeWarn("Morning digest check failed", error?.message ?? error);
    }
  }

  const scriptsDir = path.join(__dirname, "..", "..", "..", "scripts");

  // Shared PowerShell runner used by both capture-context.ps1 and
  // active-window-probe.ps1. Returns `{stdout, stderr}` the same way
  // execFile does, so the helper in `active-window-context.mjs` can stay
  // Electron-free (and therefore testable from verify scripts).
  async function runPowerShellScript({ script, args = [], timeoutMs = 3000 }) {
    const scriptPath = path.join(scriptsDir, script);
    return execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      ...args
    ], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  }

  async function isRemoteFeatureEnabled(featureId) {
    if (typeof fetch !== "function") return false;
    try {
      const response = await fetch(`${resolvedServiceBaseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const payload = await response.json();
      return payload?.config?.features?.[featureId]?.enabled !== false;
    } catch {
      // Network error or timeout: default to disabled to avoid silently enabling features
      return false;
    }
  }

  async function captureActiveWindowContext({
    includeSelection = true,
    allowClipboardFallback = true,
    clipboardBaseline = null
  } = {}) {
    const activeWindowEnabled = await isRemoteFeatureEnabled("active_window_probe");
    const context = await runCaptureActiveWindowContext({
      runPowerShell: runPowerShellScript,
      clipboardFallback: () => clipboard.readText() ?? "",
      timeoutMs: 3000,
      activeWindowEnabled,
      includeSelection,
      allowClipboardFallback,
      clipboardBaseline
    });

    // Keep the clipboard watcher in sync when capture-context.ps1 surfaced
    // selected text. Before UCA-047 this was done inline; the helper now
    // owns the merge but we still have to update this closure's mutable
    // `lastClipboardText` for dock pulse behaviour.
    if (context.selectedText) {
      lastClipboardText = context.selectedText;
    }

    rememberExternalWindowContext(context);
    return context;
  }

  let lastClipboardText = "";
  let clipboardPollTimer = null;
  let captureInFlight = false; // debounce guard for capture-and-ask hotkey

  function startClipboardWatcher() {
    lastClipboardText = clipboard.readText() ?? "";
    clipboardPollTimer = setInterval(() => {
      try {
        const current = clipboard.readText() ?? "";
        if (current && current !== lastClipboardText && current.trim().length >= 4) {
          lastClipboardText = current;
          // notify dock to pulse
          const dock = windows.get("dock");
          if (dock && readyWindows.has("dock")) {
            dock.webContents.send(IPC_CHANNELS.shellClipboardChanged, {
              length: current.length,
              preview: current.slice(0, 60)
            });
          }
        }
      } catch { /* ignore clipboard read errors */ }
    }, 800);
  }

  function stopClipboardWatcher() {
    if (clipboardPollTimer) {
      clearInterval(clipboardPollTimer);
      clipboardPollTimer = null;
    }
  }

  function createWindows() {
    for (const windowDef of DESKTOP_SHELL_MANIFEST.windows) {
      if (windows.has(windowDef.id)) {
        continue;
      }
      const browserWindow = new BrowserWindow({
        width: windowDef.width,
        height: windowDef.height,
        show: !windowDef.startsHidden,
        title: windowDef.title,
        ...resolveWindowOptions(windowDef),
        webPreferences: {
          sandbox: false,
          contextIsolation: true,
          preload: PRELOAD_PATH,
          ...(windowDef.locksRendererZoom ? { zoomFactor: 1 } : {})
        }
      });
      const initialBounds = resolveWindowBounds(windowDef, browserWindow);
      setManagedWindowBounds(windowDef.id, browserWindow, initialBounds);
      if (windowDef.id === DOCK_WINDOW_ID) {
        enforceDockWindowInvariants(browserWindow, initialBounds);
        persistWindowPreferences(DOCK_WINDOW_ID, { bounds: getManagedWindowBounds(DOCK_WINDOW_ID, browserWindow) });
      }
      lockWindowRendererZoom(windowDef, browserWindow);
      applyWindowPresentation(windowDef.id, browserWindow);
      browserWindow.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          browserWindow.hide();
        }
      });
      browserWindow.on("focus", () => {
        browserWindow.webContents.send(IPC_CHANNELS.shellWindowFocused, {
          windowId: windowDef.id
        });
      });
      // Overlay click-outside behaviour: when the overlay loses focus AND
      // the user has truly left the application (no other internal window
      // took focus — popup-card / preview / settings / dock are all
      // BrowserWindow instances and would show up in getFocusedWindow),
      // ask the renderer to run its dismiss flow. Defer one tick so the
      // OS can finish moving focus before we sample it.
      if (windowDef.id === "overlay") {
        browserWindow.on("blur", () => {
          setTimeout(() => {
            if (browserWindow.isDestroyed()) return;
            if (!browserWindow.isVisible()) return;
            // null → no LingxY window has focus → user is in another app.
            // Non-null → a sibling internal window (popup-card etc.) took
            // focus, so leave the overlay open underneath.
            if (BrowserWindow.getFocusedWindow() != null) return;
            try {
              browserWindow.webContents.send(IPC_CHANNELS.overlayAutoHide, {});
            } catch (error) {
              safeWarn("[overlay] auto-hide IPC send failed:", error?.message ?? error);
            }
          }, 80);
        });
      }
      browserWindow.on("closed", () => {
        readyWindows.delete(windowDef.id);
        pendingWindowMessages.delete(windowDef.id);
        windows.delete(windowDef.id);
      });
      let boundsPersistTimer = null;
      const scheduleBoundsPersist = () => {
        if (!["overlay", "console", "dock"].includes(windowDef.id)) return;
        if (boundsPersistTimer) clearTimeout(boundsPersistTimer);
        boundsPersistTimer = setTimeout(() => {
          if (browserWindow.isDestroyed()) return;
          persistWindowPreferences(windowDef.id, { bounds: getManagedWindowBounds(windowDef.id, browserWindow) });
        }, 180);
      };
      browserWindow.on("move", scheduleBoundsPersist);
      browserWindow.on("resize", () => {
        if (windowDef.id === DOCK_WINDOW_ID) {
          enforceDockWindowInvariants(browserWindow);
        }
        scheduleBoundsPersist();
      });
      if (windowDef.locksRendererZoom) {
        browserWindow.webContents.on("zoom-changed", (event) => {
          event.preventDefault?.();
          lockWindowRendererZoom(windowDef, browserWindow);
        });
        browserWindow.webContents.on("before-input-event", (event, input = {}) => {
          if (input.type !== "keyDown") return;
          const meta = Boolean(input.control || input.meta);
          const key = `${input.key ?? ""}`.toLowerCase();
          const code = `${input.code ?? ""}`;
          const isZoomKey = ["+", "=", "-", "0"].includes(key)
            || code === "NumpadAdd"
            || code === "NumpadSubtract";
          if (meta && isZoomKey) {
            event.preventDefault?.();
            lockWindowRendererZoom(windowDef, browserWindow);
          }
        });
      }
      if (windowDef.id === DOCK_WINDOW_ID) {
        browserWindow.webContents.on("dom-ready", () => {
          installDockHudScrollLock(browserWindow);
          enforceDockWindowInvariants(browserWindow);
        });
      }
      browserWindow.webContents.on("did-finish-load", () => {
        lockWindowRendererZoom(windowDef, browserWindow);
        readyWindows.add(windowDef.id);
        if (windowDef.id === DOCK_WINDOW_ID) {
          installDockHudScrollLock(browserWindow);
          enforceDockWindowInvariants(browserWindow);
        }
        browserWindow.webContents.send(IPC_CHANNELS.shellReady, {
          windowId: windowDef.id,
          route: windowDef.route,
          serviceBaseUrl: resolvedServiceBaseUrl
        });
        if (windowDef.id === "dock") {
          browserWindow.webContents.send("uca:note-recording-state", noteRecordingState);
        }
        flushWindowMessages(windowDef.id);
      });
      // UCA-050: surface renderer load failures so they're not silent
      browserWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
        if (errorCode !== -3) { // -3 = ERR_ABORTED (normal on hide/navigate)
          safeError(`[LingxY] Window "${windowDef.id}" failed to load: ${errorDescription} (${errorCode})`);
        }
      });
      browserWindow.loadURL(buildWindowUrl(windowDef, resolvedServiceBaseUrl));
      windows.set(windowDef.id, browserWindow);
    }
  }

  function repairDockWindowForDisplayChange(reason = "display") {
    const dock = windows.get(DOCK_WINDOW_ID);
    if (!dock || dock.isDestroyed?.()) return;
    const nextBounds = enforceDockWindowInvariants(dock);
    if (nextBounds) {
      safeWarn(`[LingxY] repaired dock HUD bounds after ${reason}`);
      persistWindowPreferences(DOCK_WINDOW_ID, { bounds: nextBounds });
    }
  }

  function installDockDisplayRepair() {
    if (dockDisplayRepairInstalled) return;
    dockDisplayRepairInstalled = true;
    screen.on("display-metrics-changed", () => repairDockWindowForDisplayChange("display-metrics-changed"));
    screen.on("display-added", () => repairDockWindowForDisplayChange("display-added"));
    screen.on("display-removed", () => repairDockWindowForDisplayChange("display-removed"));
  }

  function showWindow(windowId) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    if (target.isMinimized()) {
      target.restore();
    }
    const windowDef = DESKTOP_SHELL_MANIFEST.windows.find((candidate) => candidate.id === windowId);
    if (windowDef && !getWindowPreferences(windowId)?.bounds) {
      setManagedWindowBounds(windowId, target, resolveWindowBounds(windowDef, target));
    }
    if (windowId === DOCK_WINDOW_ID) {
      enforceDockWindowInvariants(target);
    }
    applyWindowPresentation(windowId, target);
    target.show();
    try { target.moveTop(); } catch { /* ignore */ }
    target.focus();
    // Keep the dock orb above all other UCA windows so it remains draggable
    // even when the overlay is open on top.
    if (windowId !== "dock") {
      const dock = windows.get("dock");
      if (dock && dock.isVisible()) {
        dock.setAlwaysOnTop(true, "screen-saver");
        dock.showInactive();
        dock.moveTop();
      }
    }
    return true;
  }

  function hideWindow(windowId) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    target.hide();
    return true;
  }

  function openOverlayVoice(payload = {}) {
    const mode = payload?.mode === "note" ? "note" : "voice";
    const shortcutId = mode === "note" ? "note-wake" : "voice-wake";
    const shown = showWindow("overlay");
    enqueueWindowMessage("overlay", IPC_CHANNELS.shortcutTriggered, {
      shortcutId,
      accelerator: mode === "note" ? "Ctrl+Shift+N" : "Ctrl+Shift+V",
      source: "shell_bridge",
      mode,
      autoStart: payload?.autoStart !== false,
      preserveContext: Boolean(payload?.preserveContext)
    });
    return {
      ok: Boolean(shown),
      mode,
      shortcutId
    };
  }

  function sendEchoShortcutWake(kind = "voice") {
    const payload = {
      kind,
      transcript: "shortcut",
      source: "shortcut",
      triggeredAt: Date.now()
    };
    const dock = windows.get("dock");
    if (dock && !dock.webContents?.isDestroyed?.()) {
      dock.webContents.send("uca:echo-shortcut-wake", payload);
      return true;
    }
    enqueueWindowMessage("overlay", "uca:echo-wake", payload);
    return false;
  }

  function registerShortcuts() {
    for (const shortcut of DESKTOP_SHELL_MANIFEST.shortcuts) {
      const registered = globalShortcut.register(shortcut.accelerator, () => {
        const payload = {
          shortcutId: shortcut.id,
          accelerator: shortcut.accelerator
        };

        if (shortcut.id === "toggle-overlay") {
          // Clean open — no auto-capture. Earlier behaviour ran a PowerShell
          // selection capture that could mojibake non-ASCII text in stdout
          // and confused users who just wanted an empty input. We still keep
          // the active browser/file window as a lightweight hint so the
          // renderer can answer "summarize this page/video" once the user asks.
          captureActiveWindowContext({ includeSelection: false }).then((ctx) => {
            const hasActiveWindow = Boolean(ctx.activeWindow && !ctx.activeWindow.blocked);
            if (!hasActiveWindow) return;
            const shellPayload = buildShellContextPayload({
              context: ctx,
              sourceApp: ctx.processName ?? ctx.activeWindow?.process ?? "unknown",
              captureMode: "hotkey_preview"
            });
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, shellPayload);
          }).catch(() => {});
          showWindow("overlay");
          for (const bw of windows.values()) {
            bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
          }
          return;
        }

        if (shortcut.id === "voice-wake") {
          captureActiveWindowContext({ includeSelection: false }).catch(() => {});
          void loadSettings().then((settings) => {
            if (settings?.echoMode) {
              sendEchoShortcutWake("voice");
              return;
            }
            // Open overlay and immediately start voice input.
            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          });
          return;
        }

        if (shortcut.id === "note-wake") {
          captureActiveWindowContext({ includeSelection: false }).catch(() => {});
          void loadSettings().then((settings) => {
            if (settings?.echoMode) {
              sendEchoShortcutWake("note");
              return;
            }
            // Open overlay and immediately start voice-note recording (dual channel:
            // mic + system audio). Same wiring as voice-wake; overlay decides mode.
            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          });
          return;
        }

        if (shortcut.id === "capture-and-ask") {
          // Explicit "grab whatever the user is looking at" hotkey. Files
          // pass through cleanly; selected text only attaches when it
          // round-trips through stdout without encoding loss. UCA-047 also
          // runs the active-window-probe in parallel to add URL / document
          // path hints so the overlay can offer "analyse this page" /
          // "summarise this document" quick-actions even when there's no
          // clipboard selection.
          //
          // UCA-050: guard against rapid double-press racing two concurrent
          // captureActiveWindowContext() promises that could each try to
          // enqueue a different context payload to the overlay.
          const revealOverlayForCapture = () => {
            showWindow("overlay");
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          };
          if (captureInFlight) {
            revealOverlayForCapture();
            return;
          }
          captureInFlight = true;
          revealOverlayForCapture();
          // Snapshot clipboard synchronously right now — before any async work
          // that might shift focus or delay the SimulateCopy execution. This
          // lets us detect whether SimulateCopy completed late (Add-Type JIT
          // on first run can take 500–2000ms, so the clipboard update may
          // arrive after the PowerShell script's own read but before we show
          // the overlay).
          const hotKeyClipboardSnapshot = clipboard.readText() ?? "";
          captureActiveWindowContext({
            allowClipboardFallback: false,
            clipboardBaseline: hotKeyClipboardSnapshot
          }).then((ctx) => {
            // If the in-script clipboard read missed the SimulateCopy result
            // (timing race on first run), check whether the clipboard changed
            // since the hotkey fired and adopt the new value.
            if (!ctx.selectedText) {
              const postClipboard = clipboard.readText() ?? "";
              const postTrimmed = postClipboard.trim();
              const preTrimmed = hotKeyClipboardSnapshot.trim();
              if (postTrimmed.length > 2 && postTrimmed !== preTrimmed) {
                ctx.selectedText = postTrimmed;
              }
            }

            const hasFiles = ctx.filePaths.length > 0;
            const hasText = Boolean(ctx.selectedText);
            const hasActiveWindow = Boolean(ctx.activeWindow && !ctx.activeWindow.blocked);

            if (hasFiles || hasText || hasActiveWindow) {
              const shellPayload = buildShellContextPayload({
                context: ctx,
                sourceApp: ctx.processName ?? ctx.activeWindow?.process ?? "unknown",
                captureMode: "hotkey_capture"
              });
              enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, shellPayload);
            }
          }).catch(() => {
            // Overlay is already visible; a failed capture simply leaves the
            // user with a fresh composer instead of delaying the UI.
          }).finally(() => {
            captureInFlight = false;
          });
          return;
        }

        if (shortcut.id === "capture-screenshot") {
          const screenshotScriptPath = path.join(__dirname, "..", "..", "..", "scripts", "capture-screenshot.ps1");
          const screenshotPath = path.join(os.tmpdir(), "UCA", "screenshots", `capture-${Date.now()}.png`);

          execFileAsync("powershell", [
            "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", screenshotScriptPath,
            "-OutputPath", screenshotPath
          ], { encoding: "utf8", timeout: 8000 }).then(({ stdout }) => {
            let result;
            try { result = JSON.parse(stdout.trim()); } catch { result = { ok: false }; }
            if (result.ok) {
              showWindow("overlay");
              enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
                targetWindow: "overlay",
                source_app: "uca.screenshot",
                capture_mode: "hotkey_capture",
                file_paths: [screenshotPath]
              });
            } else {
              safeError("[LingxY] capture-screenshot: PowerShell returned ok=false", result);
              showWindow("overlay");
              enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
                targetWindow: "overlay",
                source_app: "uca.screenshot",
                capture_mode: "hotkey_capture",
                error: result.error ?? "截图失败，未生成图片。"
              });
            }
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          }).catch((err) => {
            safeError("[LingxY] capture-screenshot: PowerShell failed", err?.message ?? err);
            showWindow("overlay");
            enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
              targetWindow: "overlay",
              source_app: "uca.screenshot",
              capture_mode: "hotkey_capture",
              error: err?.message ?? "截图失败，未生成图片。"
            });
            for (const bw of windows.values()) {
              bw.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
            }
          });
          return;
        }

        if (shortcut.id === "open-console") {
          showWindow("console");
        }
        for (const browserWindow of windows.values()) {
          browserWindow.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
        }
      });
      if (!registered) {
        safeError(`[LingxY] Failed to register shortcut ${shortcut.id} (${shortcut.accelerator}). It may be used by another app.`);
      }
    }
  }

  function createTray() {
    tray = new Tray(buildTrayIcon(0));
    tray.setToolTip(DESKTOP_SHELL_MANIFEST.trayTooltip);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: "Open Console",
        click() {
          showWindow("console");
        }
      },
      {
        label: "Open Overlay",
        click() {
          showWindow("overlay");
        }
      },
      {
        label: "Quit",
        click() {
          app.quit();
        }
      }
    ]));
  }

  // UCA-069: Generate a tray icon with optional badge number using SVG data URL.
  function buildTrayIcon(count) {
    const hasBadge = count > 0;
    const label = count > 99 ? "99+" : count > 0 ? String(count) : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <!-- orb base -->
      <circle cx="16" cy="16" r="14" fill="url(#base)"/>
      <defs>
        <radialGradient id="base" cx="40%" cy="35%">
          <stop offset="0%" stop-color="#6366f1"/>
          <stop offset="60%" stop-color="#312e81"/>
          <stop offset="100%" stop-color="#0f0f1a"/>
        </radialGradient>
      </defs>
      <!-- glass highlight -->
      <ellipse cx="12" cy="10" rx="5" ry="3" fill="rgba(255,255,255,0.3)" transform="rotate(-20,12,10)"/>
      ${hasBadge ? `
      <!-- badge circle -->
      <circle cx="24" cy="8" r="${label.length > 1 ? 9 : 7}" fill="#22c55e"/>
      <text x="24" y="${label.length > 1 ? 12 : 12}" text-anchor="middle"
        font-family="system-ui,sans-serif" font-size="${label.length > 1 ? 7 : 9}"
        font-weight="bold" fill="white">${label}</text>` : ""}
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    return nativeImage.createFromDataURL(dataUrl);
  }

  async function updateTrayBadge() {
    if (!tray) return;
    try {
      const resp = await fetch(`${resolvedServiceBaseUrl}/tasks`);
      if (!resp.ok) return;
      const data = await resp.json();
      const tasks = data.tasks ?? [];
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();
      const completed = tasks.filter((t) => {
        if (t.status !== "success" && t.status !== "partial_success") return false;
        const ms = new Date(t.updated_at ?? t.created_at).getTime();
        return Number.isFinite(ms) && ms >= todayMs;
      }).length;

      tray.setImage(buildTrayIcon(completed));
      tray.setToolTip(completed > 0
        ? `LingxY · 今日完成 ${completed} 个任务`
        : DESKTOP_SHELL_MANIFEST.trayTooltip);
    } catch { /* service not ready */ }
  }

  return {
    async start() {
      await app.whenReady();
      try {
        await ensureEmbeddedServiceRuntime();
      } catch (error) {
        safeError("[LingxY] failed to start local runtime service:", error?.message ?? error);
        void appendDesktopDiagnosticError("embedded_runtime_start_failed", error, {
          serviceBaseUrl: resolvedServiceBaseUrl
        });
      }

      // Grant microphone access to our own renderer windows so the Web
      // Speech API (used by the overlay's voice input) doesn't fail with
      // `not-allowed`. Permission is only granted to file:// or http://127.0.0.1
      // URLs that we serve ourselves — never to arbitrary remote origins.
      try {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
          const requestingUrl = webContents?.getURL?.() ?? "";
          const isLocal = requestingUrl.startsWith("file://")
            || requestingUrl.startsWith("http://127.0.0.1")
            || requestingUrl.startsWith("http://localhost");
          const isAudioOrDisplay = permission === "media"
            || permission === "audioCapture"
            || permission === "microphone"
            || permission === "displayCapture";
          if (isLocal && isAudioOrDisplay) {
            callback(true);
            return;
          }
          callback(false);
        });
        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
          const url = requestingOrigin ?? webContents?.getURL?.() ?? "";
          const isLocal = url.startsWith("file://")
            || url.startsWith("http://127.0.0.1")
            || url.startsWith("http://localhost");
          const isAudioOrDisplay = permission === "media"
            || permission === "audioCapture"
            || permission === "microphone"
            || permission === "displayCapture";
          return isLocal && isAudioOrDisplay;
        });
      } catch (error) {
        safeError("Failed to install permission handler", error);
      }

      await loadSettings();
      createWindows();
      installDockDisplayRepair();
      createTray();
      registerShortcuts();
      await startHandoffWatcher();
      await startNotificationWatcher();
      setTimeout(() => {
        requestMorningDigestCheck().catch(() => {});
      }, 1500);
      // UCA-069: update tray badge after service is likely ready, then every 30s
      setTimeout(() => { updateTrayBadge().catch(() => {}); }, 5000);
      setInterval(() => { updateTrayBadge().catch(() => {}); }, 30_000);
      startClipboardWatcher();
      startActiveWindowMemoryPoll();
      app.on("second-instance", (_event, argv) => {
        handleLaunchArgs(argv).catch((error) => {
          safeError("Failed to process second-instance args", error);
        });
      });
      // Expose the primary screen's desktopCapturer source ID to renderers so
      // they can capture system audio via getUserMedia + chromeMediaSource:
      // 'desktop', bypassing the getDisplayMedia screen-picker dialog entirely.
      ipcMain.handle("uca:get-desktop-audio-source", async () => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 }
          });
          const primaryDisplay = screen.getPrimaryDisplay();
          const primarySource = sources.find((source) => `${source.display_id}` === `${primaryDisplay.id}`);
          return (primarySource ?? sources[0])?.id ?? null;
        } catch {
          return null;
        }
      });

      ipcMain.handle("uca:capture-active-window-context", async (event, options = {}) => {
        try {
          let context = await captureActiveWindowContext({
            includeSelection: options?.includeSelection !== false,
            allowClipboardFallback: options?.allowClipboardFallback !== false,
            clipboardBaseline: typeof options?.clipboardBaseline === "string" ? options.clipboardBaseline : null
          });
          if (options?.excludeShellWindow && looksLikeShellWindowContext(context)) {
            const sourceWindow = BrowserWindow.fromWebContents(event.sender);
            const wasVisible = sourceWindow?.isVisible?.() ?? false;
            if (sourceWindow && wasVisible) {
              sourceWindow.hide();
              try {
                await wait(160);
                context = await captureActiveWindowContext({
                  includeSelection: options?.includeSelection !== false,
                  allowClipboardFallback: options?.allowClipboardFallback !== false,
                  clipboardBaseline: typeof options?.clipboardBaseline === "string" ? options.clipboardBaseline : null
                });
              } finally {
                if (typeof sourceWindow.showInactive === "function") sourceWindow.showInactive();
                else sourceWindow.show();
              }
            }
          }
          context = preferLastExternalWindowContext(context, options);
          return buildShellContextPayload({
            context,
            sourceApp: context.processName ?? context.activeWindow?.process ?? "unknown",
            captureMode: options?.captureMode ?? "note_recording"
          });
        } catch {
          return null;
        }
      });

      ipcMain.handle("uca:note-recording-state", (_event, payload = {}) => {
        noteRecordingState = {
          active: Boolean(payload.active),
          elapsedMs: Number(payload.elapsedMs ?? 0),
          elapsed: payload.elapsed ?? "00:00",
          hasMicTranscript: Boolean(payload.hasMicTranscript),
          hasSystemAudio: Boolean(payload.hasSystemAudio),
          updatedAt: Date.now()
        };
        const dock = windows.get("dock");
        if (dock && readyWindows.has("dock")) {
          dock.webContents.send("uca:note-recording-state", noteRecordingState);
        }
        return noteRecordingState;
      });

      ipcMain.handle("uca:get-note-recording-state", () => noteRecordingState);

      // UCA-182 Phase 4: resolve the pdfjs-dist worker's on-disk path
      // to a file:// URL so the renderer can spin up the worker without
      // having to fetch it from the runtime server or bundle it. The
      // legacy build ships an ESM worker that Electron can import
      // directly via GlobalWorkerOptions.workerSrc.
      ipcMain.handle("uca:get-pdf-worker-url", async () => {
        const workerPath = path.join(
          app.getAppPath(),
          "node_modules",
          "pdfjs-dist",
          "legacy",
          "build",
          "pdf.worker.mjs"
        );
        const mainPath = path.join(
          app.getAppPath(),
          "node_modules",
          "pdfjs-dist",
          "legacy",
          "build",
          "pdf.mjs"
        );
        return {
          workerUrl: pathToFileURL(workerPath).toString(),
          mainUrl: pathToFileURL(mainPath).toString()
        };
      });

      ipcMain.handle("uca:get-settings", async () => loadSettings());
      ipcMain.handle("uca:set-echo-mode", async (_event, enabled) => {
        return updateSettings({ echoMode: Boolean(enabled) });
      });
      ipcMain.handle(IPC_CHANNELS.echoWakeProfileUpdate, async (_event, profile = {}) => {
        return updateSettings({ echoWake: profile && typeof profile === "object" ? profile : {} });
      });
      ipcMain.handle(IPC_CHANNELS.echoDiagnostics, async (event) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const settings = await loadSettings();
        const [kws, enrollment, transcription] = await Promise.all([
          requestDesktopServiceJson({
            base,
            pathname: "/echo/kws/status",
            method: "GET",
            actor
          }).catch((error) => ({
            ok: false,
            reason: "kws_status_unavailable",
            message: error?.message ?? String(error)
          })),
          requestDesktopServiceJson({
            base,
            pathname: "/echo/enrollment/status",
            method: "GET",
            actor
          }).catch((error) => ({
            ok: false,
            reason: "enrollment_status_unavailable",
            message: error?.message ?? String(error)
          })),
          requestDesktopServiceJson({
            base,
            pathname: "/note/transcribe/status",
            method: "GET",
            actor
          }).catch((error) => ({
            ok: false,
            reason: "transcription_status_unavailable",
            message: error?.message ?? String(error)
          }))
        ]);
        return {
          ok: true,
          echoMode: Boolean(settings?.echoMode),
          echoWake: settings?.echoWake ?? {},
          kws,
          enrollment,
          transcription
        };
      });
      ipcMain.handle(IPC_CHANNELS.echoWakeEnrollmentStart, async () => {
        const dock = windows.get("dock");
        if (!dock || dock.webContents?.isDestroyed?.()) {
          return { ok: false, reason: "dock_unavailable", message: "Dock is not available." };
        }
        dock.webContents.send("uca:start-wake-enrollment", { at: Date.now(), source: "settings" });
        return { ok: true };
      });

      // Right-click on the dock orb asks the main process to show a native
      // context menu. Done here (not in the renderer) so we get native
      // look-and-feel, keyboard-nav, and the menu survives window-focus
      // changes cleanly.
      ipcMain.handle("uca:show-dock-menu", async () => {
        const current = await loadSettings();
        const dockWin = windows.get("dock");
        if (!dockWin || dockWin.webContents?.isDestroyed?.()) return;
        // Best-effort fetch of the echo TTS preference with a hard timeout
        // so a stuck service never blocks the menu from popping. Codex
        // review caught this: an awaited fetch with no abort signal would
        // leave the user staring at a frozen orb on right-click.
        let ttsPreference = { enabled: true };
        let ttsEngineUnavailable = false;
        try {
          if (resolvedServiceBaseUrl) {
            const ttsResp = await fetch(`${resolvedServiceBaseUrl}/echo/tts/preference`, {
              method: "GET",
              headers: { "x-uca-actor": "desktop_shell" },
              signal: AbortSignal.timeout(500)
            });
            if (ttsResp.ok) {
              const ttsData = await ttsResp.json().catch(() => ({}));
              ttsPreference = ttsData.preference ?? ttsPreference;
              ttsEngineUnavailable = Boolean(ttsData.engineUnavailable);
            }
          }
        } catch { /* fall through with defaults — timeout, abort, or service down */ }
        const setEchoTtsEnabled = async (enabled) => {
          if (!resolvedServiceBaseUrl) return;
          try {
            await fetch(`${resolvedServiceBaseUrl}/echo/tts/preference`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-uca-actor": "desktop_shell" },
              body: JSON.stringify({ enabled })
            });
          } catch { /* surfaced visually next time the menu opens */ }
        };
        const menu = Menu.buildFromTemplate([
          {
            label: "正常模式",
            type: "radio",
            checked: !current.echoMode,
            click() { void updateSettings({ echoMode: false }); }
          },
          {
            label: "Echo 模式（常开唤醒）",
            type: "radio",
            checked: Boolean(current.echoMode),
            click() { void updateSettings({ echoMode: true }); }
          },
          { type: "separator" },
          {
            label: ttsEngineUnavailable
              ? "语音回复（系统 TTS 不可用）"
              : "语音回复",
            type: "checkbox",
            checked: Boolean(ttsPreference.enabled) && !ttsEngineUnavailable,
            enabled: !ttsEngineUnavailable,
            click(menuItem) { void setEchoTtsEnabled(menuItem.checked); }
          },
          { type: "separator" },
          {
            label: "录入我的唤醒词（3 次）...",
            enabled: Boolean(current.echoMode),
            click() {
              const dock = windows.get("dock");
              if (dock && !dock.webContents?.isDestroyed?.()) {
                dock.webContents.send("uca:start-wake-enrollment", { at: Date.now() });
              }
            }
          },
          {
            label: "清除个人唤醒词样本",
            enabled: Boolean(current.echoMode),
            async click() {
              try {
                const dir = path.resolve(process.cwd(), "models", "user-keywords");
                const files = await readdir(dir).catch(() => []);
                await Promise.all(files
                  .filter((f) => f.endsWith(".txt") || f.endsWith(".webm") || f.endsWith(".wav") || f.endsWith(".json"))
                  .map((f) => unlink(path.join(dir, f)).catch(() => null)));
                const dock = windows.get("dock");
                if (dock && !dock.webContents?.isDestroyed?.()) {
                  dock.webContents.send("uca:echo-bubble-show", {
                    text: "✓ 个人唤醒词样本已清除",
                    kind: "info", durationMs: 1800
                  });
                }
              } catch (err) {
                safeWarn("[LingxY] clear-user-keywords failed:", err?.message ?? err);
              }
            }
          },
          { type: "separator" },
          {
            label: "打开 Dock 开发者工具（查看 Echo 日志）",
            click() {
              const dock = windows.get("dock");
              if (dock && !dock.webContents?.isDestroyed?.()) {
                try { dock.webContents.openDevTools({ mode: "detach" }); } catch { /* ignore */ }
              }
            }
          },
          { type: "separator" },
          { label: "打开主控台", click() { showWindow("console"); } },
          { label: "打开对话框", click() { showWindow("overlay"); } },
          { type: "separator" },
          { label: "退出 LingxY", click() { app.quit(); } }
        ]);
        menu.popup({ window: dockWin });
      });

      // Echo mode coordination — the dock renderer owns the wake-word
      // recognizer and reports wake events here so we can hand them off to
      // the overlay (which owns the existing voice/note capture state).
      // Echo mode stays HUD-only: the dock orb and echo bubble carry state,
      // and the overlay is only shown when the user explicitly clicks the dock.
      ipcMain.handle("uca:echo-wake", async (_event, payload = {}) => {
        enqueueWindowMessage("overlay", "uca:echo-wake", {
          kind: payload.kind ?? "voice",
          transcript: payload.transcript ?? "",
          preserveContext: Boolean(payload.preserveContext),
          triggeredAt: Date.now()
        });
        return { accepted: true };
      });

      // Session-scoped submit shortcuts. Overlay registers these at the start of
      // an echo-initiated voice/note session and unregisters on finish, so
      // the shortcut never interferes with other apps outside the session.
      // The accelerator is forwarded to the overlay renderer as a virtual
      // IPC event, letting it run the same handleUserSend / finishNote
      // paths it already uses for Enter.
      ipcMain.handle("uca:register-ctrl-enter", (_event, tag = "echo-session") => {
        const accelerators = ["CommandOrControl+Return", "Return"];
        let accepted = true;
        for (const accelerator of accelerators) {
          if (globalShortcut.isRegistered(accelerator)) continue;
          const ok = globalShortcut.register(accelerator, () => {
            for (const browserWindow of windows.values()) {
              if (!browserWindow.webContents?.isDestroyed?.()) {
                browserWindow.webContents.send("uca:ctrl-enter", { tag, accelerator });
              }
            }
          });
          accepted = accepted && Boolean(ok);
        }
        return { accepted };
      });
      ipcMain.handle("uca:unregister-ctrl-enter", () => {
        for (const accelerator of ["CommandOrControl+Return", "Return"]) {
          try { globalShortcut.unregister(accelerator); } catch { /* ignore */ }
        }
        // Echo session has ended — tell the dock so it can resume wake-word
        // listening immediately instead of waiting for its 20s fallback timer.
        const dock = windows.get("dock");
        if (dock && !dock.webContents?.isDestroyed?.()) {
          dock.webContents.send("uca:echo-session-end", { at: Date.now() });
        }
        return { accepted: true };
      });

      // Show the echo-bubble HUD near the dock. Positions the bubble to the
      // left of the dock window (or right, if there's no room on the left)
      // and pushes the payload to the bubble renderer.
      ipcMain.handle("uca:echo-bubble-show", async (_event, payload = {}) => {
        const bubbleWin = windows.get("echo-bubble");
        const dockWin = windows.get("dock");
        if (!bubbleWin || !dockWin) return { accepted: false };
        try {
          const dockBounds = getManagedWindowBounds(DOCK_WINDOW_ID, dockWin);
          const display = screen.getDisplayMatching(dockBounds);
          const bubbleSize = bubbleWin.getSize();
          const margin = 8;
          let x = dockBounds.x - bubbleSize[0] - margin;
          // If not enough room on the left, place to the right instead.
          if (x < display.workArea.x) {
            x = dockBounds.x + dockBounds.width + margin;
          }
          const y = dockBounds.y + Math.round((dockBounds.height - bubbleSize[1]) / 2);
          bubbleWin.setBounds({ x, y, width: bubbleSize[0], height: bubbleSize[1] });
          if (!bubbleWin.isVisible()) {
            bubbleWin.showInactive();  // never steal focus
          }
          bubbleWin.setAlwaysOnTop(true, "screen-saver");
          bubbleWin.moveTop();
          if (readyWindows.has("echo-bubble")) {
            bubbleWin.webContents.send("uca:echo-bubble-show", payload);
          } else {
            enqueueWindowMessage("echo-bubble", "uca:echo-bubble-show", payload);
          }
        } catch (err) {
          safeWarn("[LingxY] echo-bubble-show failed:", err?.message ?? err);
        }
        return { accepted: true };
      });

      // ── Popup cards (approval + task completion) ──
      const popupCardManager = createPopupCardManager({
        BrowserWindow,
        screen,
        ipcMain,
        resolveServiceBaseUrl: () => resolvedServiceBaseUrl
      });
      popupCardManager.registerIpcHandlers({
        onResolve: async (card) => {
          try {
            if (card.kind === "approval" && card.payload?.approvalId) {
              const approvalId = card.payload.approvalId;
              const action = card.action === "approve" ? "approve" : card.action === "reject" ? "reject" : null;
              if (!action) return;
              const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
              const actor = "popup_card";
              await requestDesktopServiceJson({
                base,
                method: "POST",
                actor,
                pathname: `/approvals/${encodeURIComponent(approvalId)}/${action}`,
                body: buildApprovalDecisionBody(
                  normalizeApprovalDecisionPayload(card.payload),
                  actor,
                  action
                )
              }).catch((err) => safeWarn("[LingxY] approval resolve failed:", err?.message ?? err));
            }
            if (card.action === "open_overlay") {
              showWindow("overlay");
            }
          } catch (err) {
            safeWarn("[LingxY] popup-card onResolve failed:", err?.message ?? err);
          }
          // Broadcast the resolution so the overlay (which may be showing an
          // inline twin of the same approval) can mark its copy as handled.
          try {
            const overlayWin = windows.get("overlay");
            if (overlayWin && !overlayWin.webContents?.isDestroyed?.()) {
              overlayWin.webContents.send(IPC_CHANNELS.popupCardResolved, {
                cardId: card.cardId,
                kind: card.kind,
                action: card.action,
                approvalId: card.payload?.approvalId ?? null,
                taskId: card.payload?.taskId ?? null,
                conversationId: card.payload?.conversationId ?? card.meta?.conversationId ?? null,
                title: card.payload?.title ?? null,
                lines: card.payload?.lines ?? null,
                body: card.payload?.body ?? null,
                // UCA-182 Phase 8: forward arbitrary meta (artifactPath,
                // inlinePreview, mime, ...) so the overlay's resolve
                // listener can wire success-kind buttons to the right
                // file / clipboard actions without another IPC hop.
                meta: card.meta ?? null
              });
            }
          } catch (err) {
            safeWarn("[LingxY] popup-card resolved-broadcast failed:", err?.message ?? err);
          }
        }
      });
      registeredPopupCardManager = popupCardManager;

      // UCA-182 Phase 14: preview window lifecycle. Created on demand,
      // positioned to cover the right ~42% of the primary workArea.
      // We keep the window between uses (hide, not destroy) so the
      // next preview can paint without reloading the HTML + scripts.
      function computePreviewBounds() {
        const { workArea } = screen.getPrimaryDisplay();
        const width = Math.max(720, Math.min(Math.round(workArea.width * 0.42), 1100));
        const height = Math.max(480, workArea.height - 32);
        const x = workArea.x + workArea.width - width - 16;
        const y = workArea.y + 16;
        return { x, y, width, height };
      }
      function ensurePreviewWindow() {
        if (previewWindow && !previewWindow.isDestroyed()) return previewWindow;
        const bounds = computePreviewBounds();
        const baseUrl = resolvedServiceBaseUrl ?? "";
        const url = pathToFileURL(path.join(RENDERER_DIR, "preview-window.html")).toString()
          + `?serviceBaseUrl=${encodeURIComponent(baseUrl)}`;
        previewWindow = new BrowserWindow({
          ...bounds,
          show: false,
          frame: false,
          transparent: false,
          alwaysOnTop: false,
          resizable: true,
          movable: true,
          skipTaskbar: false,
          title: "LingxY Preview",
          backgroundColor: "#ffffff",
          webPreferences: {
            sandbox: false,
            contextIsolation: true,
            preload: PRELOAD_PATH
          }
        });
        previewWindow.on("close", (event) => {
          // Hide instead of destroy so state survives across opens.
          // `quitting` is the module-scoped flag set in the before-quit
          // handler so we don't keep blocking the app shutdown.
          if (!quitting) {
            event.preventDefault();
            previewWindow.hide();
          }
        });
        previewWindow.on("closed", () => { previewWindow = null; });
        previewWindow.loadURL(url);
        return previewWindow;
      }
      function showPreviewWindowIfHidden() {
        const win = ensurePreviewWindow();
        if (!win.isVisible()) {
          // Re-compute bounds in case the user moved to a different
          // display since last open.
          try { win.setBounds(computePreviewBounds()); } catch { /* ignore */ }
          win.showInactive();
        } else {
          try { win.moveTop(); } catch { /* ignore */ }
        }
        return win;
      }
      // Deliver to the preview window with loading-aware queueing.
      // Problem this fixes: after showPreviewWindowIfHidden() the window
      // is isVisible() = true but DOM scripts haven't run yet; any
      // webContents.send() lands on a window without event listeners and
      // the message is lost. We buffer by channel until did-finish-load
      // fires, and for delta frames we coalesce (only keep the latest
      // payload — partial_json is already cumulative).
      const previewPendingByChannel = new Map();
      let previewFlushBound = false;
      function flushPreviewPending() {
        if (!previewWindow || previewWindow.isDestroyed()) {
          previewPendingByChannel.clear();
          return;
        }
        for (const [channel, payload] of previewPendingByChannel) {
          try { previewWindow.webContents.send(channel, payload); } catch { /* ignore */ }
        }
        previewPendingByChannel.clear();
      }
      function sendToPreview(channel, payload, { coalesce = false } = {}) {
        const win = showPreviewWindowIfHidden();
        if (win.webContents.isLoading()) {
          // Buffer. For delta (coalesce), replace any prior frame on
          // the same channel so we only deliver the latest.
          if (coalesce) {
            previewPendingByChannel.set(channel, payload);
          } else if (previewPendingByChannel.has(channel)) {
            // For non-delta frames we still overwrite by channel; the
            // latest init / committed is what the window cares about.
            previewPendingByChannel.set(channel, payload);
          } else {
            previewPendingByChannel.set(channel, payload);
          }
          if (!previewFlushBound) {
            previewFlushBound = true;
            win.webContents.once("did-finish-load", () => {
              previewFlushBound = false;
              flushPreviewPending();
            });
          }
          return;
        }
        try { win.webContents.send(channel, payload); } catch { /* ignore */ }
      }

      ipcMain.handle(IPC_CHANNELS.previewWindowShow, (_event, payload = {}) => {
        sendToPreview(IPC_CHANNELS.previewWindowInit, payload);
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.previewWindowAppendDelta, (_event, payload = {}) => {
        // Route through sendToPreview so deltas that arrive while the
        // window is still loading are coalesced and flushed on
        // did-finish-load instead of dropped. Previously we required
        // isVisible() AND not-loading, which silently discarded every
        // delta between openForTool and the first frame paint.
        sendToPreview(IPC_CHANNELS.previewWindowDelta, payload, { coalesce: true });
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.previewWindowCommit, (_event, payload = {}) => {
        sendToPreview(IPC_CHANNELS.previewWindowCommitted, payload);
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.previewWindowClose, () => {
        if (previewWindow && !previewWindow.isDestroyed()) previewWindow.hide();
        return { ok: true };
      });
      ipcMain.handle("uca:preview-window-pin", (_event, flag) => {
        previewWindowPinned = Boolean(flag);
        if (previewWindow && !previewWindow.isDestroyed()) {
          try { previewWindow.setAlwaysOnTop(previewWindowPinned, "screen-saver"); } catch { /* ignore */ }
        }
        return previewWindowPinned;
      });

      function normalizeOpenableUrl(value) {
        try {
          const parsed = new URL(String(value ?? "").trim());
          if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
          return parsed.toString();
        } catch {
          return null;
        }
      }

      function showLinkBrowserWindow(url) {
        const { workArea } = screen.getPrimaryDisplay();
        const width = Math.max(920, Math.min(Math.round(workArea.width * 0.58), 1280));
        const height = Math.max(620, Math.min(workArea.height - 48, 900));
        const win = new BrowserWindow({
          width,
          height,
          x: workArea.x + Math.max(12, Math.round((workArea.width - width) / 2)),
          y: workArea.y + 24,
          show: false,
          frame: true,
          resizable: true,
          movable: true,
          minimizable: true,
          maximizable: true,
          closable: true,
          alwaysOnTop: false,
          skipTaskbar: false,
          title: "LingxY Browser",
          backgroundColor: "#ffffff",
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true
          }
        });
        linkBrowserWindows.add(win);
        win.on("closed", () => linkBrowserWindows.delete(win));
        win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
          const safeUrl = normalizeOpenableUrl(nextUrl);
          if (safeUrl && /^https?:/i.test(safeUrl)) {
            showLinkBrowserWindow(safeUrl);
          } else if (safeUrl) {
            void shell.openExternal(safeUrl);
          }
          return { action: "deny" };
        });
        win.webContents.on("will-navigate", (event, nextUrl) => {
          const safeUrl = normalizeOpenableUrl(nextUrl);
          if (!safeUrl) event.preventDefault();
        });
        // Show + bring-to-front only after the page is loading, so the
        // user sees a real navigation rather than a blank chrome flash.
        // The dock is the only alwaysOnTop window in the app, but it is
        // tiny (48x48) so the link browser still dominates the viewport.
        win.once("ready-to-show", () => {
          try { win.show(); win.focus(); } catch { /* ignore */ }
        });
        win.loadURL(url);
        return { ok: true, mode: "lingxy_browser" };
      }

      function readLinkOpenPreference() {
        try {
          const config = runtime?.configStore?.load?.() ?? {};
          const mode = String(config?.ui?.linkOpenMode ?? "").trim().toLowerCase();
          if (["system", "lingxy_browser", "ask"].includes(mode)) return mode;
        } catch { /* fall through */ }
        return "system";
      }

      ipcMain.handle(IPC_CHANNELS.shellOpenUrl, async (event, payload = {}) => {
        const url = normalizeOpenableUrl(payload.url);
        if (!url) return { ok: false, error: "invalid_url" };
        const protocol = new URL(url).protocol;
        const canOpenInLingxy = protocol === "http:" || protocol === "https:";
        // Resolution order: explicit caller mode > user preference >
        // system browser default. The user-facing setting lives in
        // Console Settings → "链接打开方式" so users who liked the in-app
        // browser can pick it as their default again.
        let mode = ["system", "lingxy_browser", "ask"].includes(payload.mode)
          ? payload.mode
          : readLinkOpenPreference();
        if (mode === "ask" && canOpenInLingxy) {
          const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
          const choice = await dialog.showMessageBox(owner ?? undefined, {
            type: "question",
            title: "Open link",
            message: "用什么方式打开这个链接？",
            detail: url,
            buttons: ["LingxY 新窗口", "系统浏览器", "取消"],
            // Default to system browser on Enter so the safer choice is
            // one keystroke away (codex review of the original dialog
            // flagged the previous default-to-in-app as a footgun).
            defaultId: 1,
            cancelId: 2,
            noLink: true
          });
          if (choice.response === 2) return { ok: false, cancelled: true };
          mode = choice.response === 0 ? "lingxy_browser" : "system";
        }
        if (mode === "lingxy_browser" && canOpenInLingxy) {
          return showLinkBrowserWindow(url);
        }
        await shell.openExternal(url);
        return { ok: true, mode: "system" };
      });
      ipcMain.handle(IPC_CHANNELS.mcpInstallPreview, async (_event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        try {
          return await postDesktopServiceJson({
            base,
            pathname: "/config/mcp/install/preview",
            body: normalizeMcpInstallPreviewPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_install_preview_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpInstallRun, async (_event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        try {
          return await postDesktopServiceJson({
            base,
            pathname: "/config/mcp/install/run",
            body: normalizeMcpInstallPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_install_request_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpServerSave, async (_event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        try {
          return await postDesktopServiceJson({
            base,
            pathname: "/config/mcp/servers",
            body: normalizeMcpServerDescriptorPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_server_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpServerDelete, async (_event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const serverId = normalizeMcpServerId(id);
        if (!serverId) {
          return { ok: false, error: "mcp_server_id_required", message: "MCP server id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            pathname: `/config/mcp/servers/${encodeURIComponent(serverId)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_server_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpServerTest, async (_event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const serverId = normalizeMcpServerId(id);
        if (!serverId) {
          return { ok: false, error: "mcp_server_id_required", message: "MCP server id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            pathname: `/config/mcp/servers/${encodeURIComponent(serverId)}/test`,
            body: {}
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_server_test_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpServerToggle, async (_event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const body = normalizeMcpServerTogglePayload(payload);
        if (!body.id) {
          return { ok: false, error: "mcp_server_id_required", message: "MCP server id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            pathname: `/ai/mcp/${encodeURIComponent(body.id)}/toggle`,
            body: { enabled: body.enabled }
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_server_toggle_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpServerConfig, async (_event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const body = normalizeMcpServerConfigPayload(payload);
        if (!body.id || (!body.key && !body.values)) {
          return { ok: false, error: "mcp_server_config_required", message: "MCP server id and config values are required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            pathname: `/ai/mcp/${encodeURIComponent(body.id)}/config`,
            body
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_server_config_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.mcpDraftImport, async (_event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const body = normalizeMcpDraftImportPayload(payload);
        if (!body.file && !body.path) {
          return { ok: false, error: "mcp_draft_required", message: "MCP draft file is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            pathname: "/config/mcp/drafts/import",
            body
          });
        } catch (error) {
          return {
            ok: false,
            error: "mcp_draft_import_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.approvalApprove, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const body = normalizeApprovalDecisionPayload(payload);
        if (!body.approvalId) {
          return { ok: false, error: "approval_id_required", message: "Approval id is required." };
        }
        const actor = desktopActorForSender(event.sender);
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/approvals/${encodeURIComponent(body.approvalId)}/approve`,
            body: buildApprovalDecisionBody(body, actor, "approve")
          });
        } catch (error) {
          return {
            ok: false,
            error: "approval_approve_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.approvalReject, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const body = normalizeApprovalDecisionPayload(payload);
        if (!body.approvalId) {
          return { ok: false, error: "approval_id_required", message: "Approval id is required." };
        }
        const actor = desktopActorForSender(event.sender);
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/approvals/${encodeURIComponent(body.approvalId)}/reject`,
            body: buildApprovalDecisionBody(body, actor, "reject")
          });
        } catch (error) {
          return {
            ok: false,
            error: "approval_reject_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.securityStateUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/security/state",
            body: normalizeSecurityStatePatch(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "security_state_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.budgetUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/budget",
            body: normalizeBudgetUpdatePayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "budget_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.exportBundle, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const params = new URLSearchParams();
        if (payload?.includeTaskEvents === false) params.set("includeTaskEvents", "false");
        const suffix = params.toString() ? `?${params}` : "";
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: `/export/bundle${suffix}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "export_bundle_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.diagnosticBundle, async (event) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/diagnostics/bundle"
          });
        } catch (error) {
          return {
            ok: false,
            error: "diagnostic_bundle_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.rendererErrorReport, async (event, payload = {}) => {
        await appendDesktopDiagnosticError("renderer_report", null, {
          actor: desktopActorForSender(event.sender),
          payload: normalizePlainObject(payload) ?? {}
        });
        return { ok: true };
      });
      ipcMain.handle(IPC_CHANNELS.scheduleCreate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/schedules",
            body: normalizeScheduleMutationPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "schedule_create_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.scheduleUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const { id, body } = normalizeScheduleIdPayload(payload);
        if (!id) {
          return { ok: false, error: "schedule_id_required", message: "Schedule id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            actor,
            pathname: `/schedules/${encodeURIComponent(id)}`,
            body
          });
        } catch (error) {
          return {
            ok: false,
            error: "schedule_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.scheduleDelete, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const scheduleId = normalizeScheduleId(id);
        if (!scheduleId) {
          return { ok: false, error: "schedule_id_required", message: "Schedule id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/schedules/${encodeURIComponent(scheduleId)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "schedule_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.scheduleRun, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const { id, triggerPayload } = normalizeScheduleRunPayload(payload);
        if (!id) {
          return { ok: false, error: "schedule_id_required", message: "Schedule id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/schedules/${encodeURIComponent(id)}/runs`,
            body: { triggerPayload }
          });
        } catch (error) {
          return {
            ok: false,
            error: "schedule_run_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.templateSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/templates",
            body: normalizeTemplateSavePayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "template_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.templateImport, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/templates/import",
            body: normalizeTemplateImportPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "template_import_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.templateDelete, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const templateId = normalizeTemplateId(id);
        if (!templateId) {
          return { ok: false, error: "template_id_required", message: "Template id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/templates/${encodeURIComponent(templateId)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "template_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.dagResume, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const executionId = normalizeDagExecutionId(id);
        if (!executionId) {
          return { ok: false, error: "dag_execution_id_required", message: "DAG execution id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/dag/executions/${encodeURIComponent(executionId)}/resume`
          });
        } catch (error) {
          return {
            ok: false,
            error: "dag_resume_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.providerSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/providers",
            body: normalizeProviderConfigPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "provider_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.providerDelete, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const providerId = normalizeProviderId(id);
        if (!providerId) {
          return { ok: false, error: "provider_id_required", message: "Provider id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/config/providers/${encodeURIComponent(providerId)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "provider_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.onboardingSuggestionUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const suggestionId = `${payload?.id ?? ""}`.trim();
        if (!suggestionId) {
          return { ok: false, error: "suggestion_id_required", message: "Suggestion id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            actor,
            pathname: `/config/onboarding/suggestions/${encodeURIComponent(suggestionId)}`,
            body: { status: payload?.status ?? "dismissed" }
          });
        } catch (error) {
          return {
            ok: false,
            error: "onboarding_suggestion_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.codeCliAdapterSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/code-cli/adapters",
            body: normalizeCodeCliAdapterPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "code_cli_adapter_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.codeCliAdapterDelete, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const adapterId = normalizeCodeCliAdapterId(id);
        if (!adapterId) {
          return { ok: false, error: "code_cli_adapter_id_required", message: "Code CLI adapter id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/config/code-cli/adapters/${encodeURIComponent(adapterId)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "code_cli_adapter_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillRegistrySave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/skills/registries",
            body: normalizeSkillRegistryPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_registry_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillRegistryDelete, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const registryId = normalizeSkillRegistryId(id);
        if (!registryId) {
          return { ok: false, error: "skill_registry_id_required", message: "Skill registry id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/config/skills/registries/${encodeURIComponent(registryId)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_registry_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.autoSkillSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/skills/save",
            body: normalizeAutoSkillPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "auto_skill_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillMarkdownRead, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeSkillMarkdownReadPayload(payload);
        try {
          return await requestDesktopServiceJson({
            base,
            method: "GET",
            actor,
            pathname: `/skills/read?entryPath=${encodeURIComponent(body.entryPath)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_markdown_read_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillMarkdownWrite, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/skills/write",
            body: normalizeSkillMarkdownWritePayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_markdown_write_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillCreate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/skills/create",
            body: normalizeSkillCreatePayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_create_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillDuplicate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/skills/duplicate",
            body: normalizeSkillDuplicatePayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_duplicate_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillHistory, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeSkillHistoryPayload(payload);
        try {
          return await requestDesktopServiceJson({
            base,
            method: "GET",
            actor,
            pathname: `/skills/history?entryPath=${encodeURIComponent(body.entryPath)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_history_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillRollback, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/skills/rollback",
            body: normalizeSkillRollbackPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_rollback_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.skillTest, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/skills/test",
            body: normalizeSkillTestPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "skill_test_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.routingConfigUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/routing",
            body: normalizeRuntimeConfigPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "routing_config_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.outputConfigUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/output",
            body: normalizeRuntimeConfigPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "output_config_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.featureConfigUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/features",
            body: normalizeRuntimeConfigPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "feature_config_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.emailSettingsUpdate, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/email/settings",
            body: normalizeRuntimeConfigPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "email_settings_update_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.emailAccountSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/config/email/accounts",
            body: normalizeEmailAccountPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "email_account_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.emailAccountDelete, async (event, accountId = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const id = normalizeEmailAccountId(accountId);
        if (!id) {
          return { ok: false, error: "email_account_id_required", message: "Email account id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/config/email/accounts/${encodeURIComponent(id)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "email_account_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.emailDigestCheck, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/email/digest/check",
            body: normalizeEmailDigestCheckPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "email_digest_check_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.notesSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/notes",
            body: { notes: normalizeNotesSavePayload(payload) }
          });
        } catch (error) {
          return {
            ok: false,
            error: "notes_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.noteUpsert, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/notes/upsert",
            body: normalizeNoteUpsertPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "note_upsert_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.noteDelete, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const noteId = normalizeNoteId(id);
        if (!noteId) {
          return { ok: false, error: "note_id_required", message: "Note id is required." };
        }
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/notes/delete",
            body: { id: noteId }
          });
        } catch (error) {
          return {
            ok: false,
            error: "note_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.noteRestore, async (event, id = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const noteId = normalizeNoteId(id);
        if (!noteId) {
          return { ok: false, error: "note_id_required", message: "Note id is required." };
        }
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/notes/restore",
            body: { id: noteId }
          });
        } catch (error) {
          return {
            ok: false,
            error: "note_restore_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.noteAppendChip, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/notes/append-chip",
            body: normalizeNoteAppendChipPayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "note_append_chip_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.projectStoreSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/projects/store",
            body: normalizeProjectStoreSavePayload(payload)
          });
        } catch (error) {
          return {
            ok: false,
            error: "project_store_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.projectFilesPick, async (event, options = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender);
        const properties = ["openFile", "openDirectory", "multiSelections"];
        const normalizedOptions = normalizePlainObject(options) ?? {};
        const result = await dialog.showOpenDialog(owner ?? undefined, {
          ...normalizedOptions,
          title: "Add files or folders to this project",
          buttonLabel: "Add to Project",
          properties
        });
        return {
          canceled: result.canceled === true,
          paths: Array.isArray(result.filePaths) ? result.filePaths : []
        };
      });
      ipcMain.handle(IPC_CHANNELS.projectFilesAttach, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeProjectFilesAttachPayload(payload);
        if (!body.projectId) {
          return { ok: false, error: "project_id_required", message: "Project id required." };
        }
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: `/projects/${encodeURIComponent(body.projectId)}/files/attach`,
            body: { paths: body.paths }
          });
        } catch (error) {
          return {
            ok: false,
            error: "project_files_attach_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.projectFilesRemoveIndex, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeProjectFilesRemoveIndexPayload(payload);
        if (!body.projectId) {
          return { ok: false, error: "project_id_required", message: "Project id required." };
        }
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: `/projects/${encodeURIComponent(body.projectId)}/files/remove-index`,
            body: { paths: body.paths, detach: body.detach }
          });
        } catch (error) {
          return {
            ok: false,
            error: "project_files_remove_index_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.previewCacheClear, async (event) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/preview/cache/clear"
          });
        } catch (error) {
          return {
            ok: false,
            error: "preview_cache_clear_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.officeAddinsSetup, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        try {
          return await postDesktopServiceJson({
            base,
            actor,
            pathname: "/setup/office-addins",
            body: payload ?? {}
          });
        } catch (error) {
          return {
            ok: false,
            error: "office_addins_setup_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.echoKwsDetect, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const params = new URLSearchParams();
        if (Array.isArray(payload?.keywords) && payload.keywords.length) {
          params.set("keywords", payload.keywords.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n"));
        }
        const search = params.toString() ? `?${params}` : "";
        try {
          return await postDesktopServiceBinary({
            base,
            actor,
            pathname: "/echo/kws",
            search,
            body: payload?.audio,
            contentType: payload?.mimeType || "audio/webm"
          });
        } catch (error) {
          return {
            ok: false,
            error: "echo_kws_detect_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.echoKeywordEnroll, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const params = new URLSearchParams();
        if (payload?.sample) params.set("sample", `${payload.sample}`);
        if (payload?.session) params.set("session", `${payload.session}`);
        const search = params.toString() ? `?${params}` : "";
        try {
          return await postDesktopServiceBinary({
            base,
            actor,
            pathname: "/echo/enroll-keyword",
            search,
            body: payload?.audio,
            contentType: payload?.mimeType || "audio/webm"
          });
        } catch (error) {
          return {
            ok: false,
            error: "echo_keyword_enroll_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.noteTranscribe, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const params = new URLSearchParams();
        params.set("lang", `${payload?.lang || "auto"}`);
        if (payload?.outputLocale) params.set("output_locale", `${payload.outputLocale}`);
        try {
          return await postDesktopServiceBinary({
            base,
            actor,
            pathname: "/note/transcribe",
            search: `?${params}`,
            body: payload?.audio,
            contentType: payload?.mimeType || "audio/webm"
          });
        } catch (error) {
          return {
            ok: false,
            error: "note_transcribe_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.noteTranscribeStream, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const streamId = `${payload?.streamId ?? ""}`.trim();
        const params = new URLSearchParams();
        params.set("stream", "1");
        params.set("lang", `${payload?.lang || "auto"}`);
        if (payload?.outputLocale) params.set("output_locale", `${payload.outputLocale}`);
        try {
          return await postDesktopServiceBinaryStream({
            base,
            actor,
            pathname: "/note/transcribe",
            search: `?${params}`,
            body: payload?.audio,
            contentType: payload?.mimeType || "audio/webm",
            onEvent(frame) {
              event.sender.send(IPC_CHANNELS.noteTranscribeStreamEvent, {
                streamId,
                ...frame
              });
            }
          });
        } catch (error) {
          return {
            ok: false,
            error: "note_transcribe_stream_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.connectedAccountRename, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeConnectedAccountRenamePayload(payload);
        if (!body.accountId) {
          return { ok: false, error: "connected_account_id_required", message: "Connected account id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            actor,
            pathname: `/connectors/connected-accounts/${encodeURIComponent(body.accountId)}`,
            body: { displayName: body.displayName }
          });
        } catch (error) {
          return {
            ok: false,
            error: "connected_account_rename_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.connectedAccountDefaultSet, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeConnectedAccountDefaultPayload(payload);
        if (!body.accountId || !body.purpose) {
          return {
            ok: false,
            error: "connected_account_default_required",
            message: "Connected account id and default purpose are required."
          };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            actor,
            pathname: `/connectors/connected-accounts/${encodeURIComponent(body.accountId)}/defaults`,
            body: { purpose: body.purpose }
          });
        } catch (error) {
          return {
            ok: false,
            error: "connected_account_default_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.connectedAccountDisconnect, async (event, accountId = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const id = normalizeConnectedAccountId(accountId);
        if (!id) {
          return { ok: false, error: "connected_account_id_required", message: "Connected account id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/connectors/connected-accounts/${encodeURIComponent(id)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "connected_account_disconnect_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.connectorAccountDisconnect, async (event, type = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const connectorType = normalizeConnectorAccountType(type);
        if (!connectorType) {
          return { ok: false, error: "connector_account_type_required", message: "Connector account type is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/connectors/accounts/${encodeURIComponent(connectorType)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "connector_account_disconnect_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.connectorAccountConfigSave, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const { type, body } = normalizeConnectorAccountConfigPayload(payload);
        if (!type) {
          return { ok: false, error: "connector_account_type_required", message: "Connector account type is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "PATCH",
            actor,
            pathname: `/connectors/accounts/${encodeURIComponent(type)}/config`,
            body
          });
        } catch (error) {
          return {
            ok: false,
            error: "connector_account_config_save_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.taskCancel, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeTaskCancelPayload(payload);
        if (!body.taskId) {
          return { ok: false, error: "task_id_required", message: "Task id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/task/${encodeURIComponent(body.taskId)}/cancel`,
            body: { force: body.force }
          });
        } catch (error) {
          return {
            ok: false,
            error: "task_cancel_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.taskRetry, async (event, payload = {}) => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const body = normalizeTaskRetryPayload(payload);
        if (!body.taskId) {
          return { ok: false, error: "task_id_required", message: "Task id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/task/${encodeURIComponent(body.taskId)}/retry`,
            body: {
              mode: body.mode,
              overrides: body.overrides,
              background: body.background
            }
          });
        } catch (error) {
          return {
            ok: false,
            error: "task_retry_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.taskDelete, async (event, taskId = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const id = normalizeTaskId(taskId);
        if (!id) {
          return { ok: false, error: "task_id_required", message: "Task id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "DELETE",
            actor,
            pathname: `/task/${encodeURIComponent(id)}`
          });
        } catch (error) {
          return {
            ok: false,
            error: "task_delete_failed",
            message: error?.message ?? String(error)
          };
        }
      });
      ipcMain.handle(IPC_CHANNELS.taskRestore, async (event, taskId = "") => {
        const base = resolvedServiceBaseUrl ?? "http://127.0.0.1:4310";
        const actor = desktopActorForSender(event.sender);
        const id = normalizeTaskId(taskId);
        if (!id) {
          return { ok: false, error: "task_id_required", message: "Task id is required." };
        }
        try {
          return await requestDesktopServiceJson({
            base,
            method: "POST",
            actor,
            pathname: `/task/${encodeURIComponent(id)}/restore`
          });
        } catch (error) {
          return {
            ok: false,
            error: "task_restore_failed",
            message: error?.message ?? String(error)
          };
        }
      });

      ipcMain.handle(IPC_CHANNELS.shellStatus, () => ({
        serviceBaseUrl: resolvedServiceBaseUrl,
        windowIds: [...windows.keys()],
        windows: DESKTOP_SHELL_MANIFEST.windows.map((windowDef) => ({
          id: windowDef.id,
          title: windowDef.title,
          route: windowDef.route,
          visible: windows.get(windowDef.id)?.isVisible() ?? false,
          minimized: windows.get(windowDef.id)?.isMinimized?.() ?? false,
          focused: windows.get(windowDef.id)?.isFocused?.() ?? false
        }))
      }));
      ipcMain.handle(IPC_CHANNELS.shellShowWindow, (_event, windowId) => showWindow(windowId));
      ipcMain.handle(IPC_CHANNELS.shellHideWindow, (_event, windowId) => hideWindow(windowId));
      ipcMain.handle(IPC_CHANNELS.shellOpenOverlayVoice, (_event, payload = {}) => openOverlayVoice(payload));
      ipcMain.handle(IPC_CHANNELS.shellSubmitDroppedFiles, async (_event, filePaths = []) => {
        const acceptedFilePaths = filePaths.filter((filePath) => typeof filePath === "string" && filePath.length > 0);
        if (acceptedFilePaths.length === 0) {
          return { accepted: false, reason: "no_files" };
        }
        const settings = await loadSettings();
        // Dropping onto the dock is mode-aware:
        // - Echo mode: keep the orb calm; the hidden overlay receives the
        //   pending files and the user can press V to ask without opening chat.
        // - Normal mode: open the overlay because the user expects a visible
        //   composer after dropping files.
        if (!settings?.echoMode) {
          showWindow("overlay");
        }
        enqueueWindowMessage(
          "overlay",
          IPC_CHANNELS.shellContextReceived,
          buildOverlayPayloadFromFiles(acceptedFilePaths, "uca.dock", "dock_drop", {
            mode: settings?.echoMode ? "echo" : "normal",
            surface: settings?.echoMode ? "echo_receipt" : "overlay",
            voiceContinueTtlMs: settings?.echoMode ? ECHO_DOCK_DROP_VOICE_READY_MS : 0
          })
        );
        return {
          accepted: true,
          fileCount: acceptedFilePaths.length,
          mode: settings?.echoMode ? "echo" : "normal",
          surface: settings?.echoMode ? "echo_receipt" : "overlay",
          voiceContinueTtlMs: settings?.echoMode ? ECHO_DOCK_DROP_VOICE_READY_MS : 0
        };
      });
      ipcMain.handle(IPC_CHANNELS.shellMoveWindowBy, (_event, { windowId, deltaX, deltaY } = {}) => {
        const target = windows.get(windowId);
        if (!target) return false;
        const currentBounds = getManagedWindowBounds(windowId, target);
        const nextBounds = clampWindowBounds(windowId, {
          ...currentBounds,
          x: currentBounds.x + (Number(deltaX) || 0),
          y: currentBounds.y + (Number(deltaY) || 0)
        }, { mode: "move" });
        setManagedWindowBounds(windowId, target, nextBounds);
        persistWindowPreferences(windowId, { bounds: nextBounds });
        return true;
      });
      ipcMain.handle(IPC_CHANNELS.shellResizeWindowBy, (_event, { windowId, deltaWidth, deltaHeight } = {}) => {
        const target = windows.get(windowId);
        if (!target) return false;
        if (windowId === DOCK_WINDOW_ID) {
          const repaired = enforceDockWindowInvariants(target);
          if (repaired) persistWindowPreferences(windowId, { bounds: repaired });
          return true;
        }
        const currentBounds = getManagedWindowBounds(windowId, target);
        const nextBounds = clampWindowBounds(windowId, {
          ...currentBounds,
          width: currentBounds.width + (Number(deltaWidth) || 0),
          height: currentBounds.height + (Number(deltaHeight) || 0)
        });
        setManagedWindowBounds(windowId, target, nextBounds);
        persistWindowPreferences(windowId, { bounds: nextBounds });
        return true;
      });
      ipcMain.handle(IPC_CHANNELS.shellSetIgnoreMouseEvents, (_event, { windowId, ignore, forward } = {}) => {
        const target = windows.get(windowId);
        if (!target || target.isDestroyed()) return false;
        target.setIgnoreMouseEvents(Boolean(ignore), { forward: forward !== false });
        return true;
      });
      ipcMain.handle(IPC_CHANNELS.shellNotify, (_event, payload = {}) => {
        return showDesktopNotification(payload);
      });
      ipcMain.handle(IPC_CHANNELS.shellNavigateConsole, (_event, payload = {}) => {
        const tabId = typeof payload?.tabId === "string" ? payload.tabId : "settings";
        showWindow("console");
        enqueueWindowMessage("console", IPC_CHANNELS.shellNavigateConsole, { tabId });
        return { ok: true, tabId };
      });
      app.on("activate", () => {
        // UCA-050: also recreate if all existing windows are destroyed/crashed
        const aliveWindows = [...windows.values()].filter(
          (w) => !w.isDestroyed() && !w.webContents.isCrashed()
        );
        if (BrowserWindow.getAllWindows().length === 0 || aliveWindows.length === 0) {
          windows.clear();
          readyWindows.clear();
          createWindows();
        }
      });
      app.on("before-quit", () => {
        quitting = true;
        stopClipboardWatcher();
        handoffWatcher?.return?.().catch?.(() => {});
        notificationWatcher?.return?.().catch?.(() => {});
        registeredPopupCardManager?.shutdown?.();
        embeddedServiceRuntime?.stop?.().catch?.(() => {});
      });
      await handleLaunchArgs(process.argv);
      return {
        serviceBaseUrl: resolvedServiceBaseUrl,
        windows: [...windows.keys()],
        trayReady: Boolean(tray)
      };
    }
  };
}

export async function initializeElectronShellRuntime({
  electron,
  serviceBaseUrl
} = {}) {
  if (!electron?.app) {
    throw new Error("Electron app bindings are required to initialize the shell runtime.");
  }

  if (!electron.app.requestSingleInstanceLock()) {
    electron.app.quit();
    return null;
  }

  const runtime = createElectronShellRuntime({
    electron,
    serviceBaseUrl
  });
  await runtime.start();
  return runtime;
}
