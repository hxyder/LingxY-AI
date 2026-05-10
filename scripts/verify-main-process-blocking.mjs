import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const mainSurfaceRoots = [
  path.join(repoRoot, "index.cjs"),
  path.join(repoRoot, "src", "desktop", "tray")
];

const bannedSyncApis = [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "readdirSync",
  "statSync",
  "lstatSync",
  "existsSync",
  "execSync",
  "execFileSync",
  "spawnSync",
  "Atomics.wait"
];

function walkJsFiles(target) {
  const files = [];
  const stat = readdirOrFile(target);
  if (stat === "file") return [target];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (/\.(?:mjs|js|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function readdirOrFile(target) {
  return /\.(?:mjs|js|cjs)$/.test(target) ? "file" : "dir";
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function matchingParenOffset(source, openOffset) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openOffset; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectIpcHandlers(source) {
  const handlers = [];
  const pattern = /ipcMain\.handle\s*\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const open = source.indexOf("(", match.index);
    const close = matchingParenOffset(source, open);
    if (close < 0) continue;
    const body = source.slice(open + 1, close);
    const startLine = lineForOffset(source, match.index);
    const endLine = lineForOffset(source, close);
    handlers.push({ startLine, endLine, body });
    pattern.lastIndex = close + 1;
  }
  return handlers;
}

function hasAwaitInLoopBlock(source, loopOffset) {
  const openBrace = source.indexOf("{", loopOffset);
  if (openBrace < 0) return false;
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return /\bawait\b/.test(source.slice(openBrace, i + 1));
      }
    }
  }
  return false;
}

function collectBlockingFindings(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const source = stripComments(raw);
  const relativePath = path.relative(repoRoot, filePath).replaceAll("\\", "/");
  const findings = [];

  for (const api of bannedSyncApis) {
    const escaped = api.replace(".", "\\.");
    const pattern = new RegExp(`\\b${escaped}\\b`, "g");
    let match;
    while ((match = pattern.exec(source))) {
      findings.push(`${relativePath}:${lineForOffset(source, match.index)} sync API '${api}' is not allowed in Electron main/tray surface`);
    }
  }

  const busyLoopPatterns = [
    /while\s*\(\s*Date\.now\(\)\s*</g,
    /while\s*\(\s*performance\.now\(\)\s*</g,
    /for\s*\(\s*;\s*;\s*\)/g
  ];
  for (const pattern of busyLoopPatterns) {
    let match;
    while ((match = pattern.exec(source))) {
      if (!hasAwaitInLoopBlock(source, match.index)) {
        findings.push(`${relativePath}:${lineForOffset(source, match.index)} potential busy loop in Electron main/tray surface`);
      }
    }
  }

  for (const handler of collectIpcHandlers(source)) {
    const lineCount = handler.endLine - handler.startLine + 1;
    if (lineCount > 90) {
      findings.push(`${relativePath}:${handler.startLine} IPC handler spans ${lineCount} lines; move heavy logic behind service/runtime boundary`);
    }
    for (const api of bannedSyncApis) {
      const escaped = api.replace(".", "\\.");
      if (new RegExp(`\\b${escaped}\\b`).test(handler.body)) {
        findings.push(`${relativePath}:${handler.startLine} IPC handler uses sync API '${api}'`);
      }
    }
  }

  return findings;
}

const files = mainSurfaceRoots.flatMap(walkJsFiles);
const findings = files.flatMap(collectBlockingFindings);

assert.equal(
  findings.length,
  0,
  `Electron main-process blocking verifier found issues:\n${findings.join("\n")}`
);

const electronMain = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "electron-main.mjs"), "utf8");
const brandIcons = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "brand-icons.mjs"), "utf8");
const desktopServiceClient = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-service-client.mjs"), "utf8");
const desktopDiagnostics = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-diagnostics.mjs"), "utf8");
const desktopSettings = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-settings.mjs"), "utf8");
const desktopPayloadNormalizers = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-payload-normalizers.mjs"), "utf8");
const desktopWindowConfig = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-window-config.mjs"), "utf8");
const desktopWindowBounds = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-window-bounds.mjs"), "utf8");
const desktopOverlayPayloads = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-overlay-payloads.mjs"), "utf8");
const desktopWindowMessages = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-window-messages.mjs"), "utf8");
const desktopPaths = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-paths.mjs"), "utf8");
const desktopPowerShell = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-powershell.mjs"), "utf8");
const desktopServiceRuntime = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-service-runtime.mjs"), "utf8");
const desktopNotifications = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-notifications.mjs"), "utf8");
const desktopHandoffWatcher = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-handoff-watcher.mjs"), "utf8");
const desktopNotificationWatcher = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-notification-watcher.mjs"), "utf8");
const desktopMorningDigest = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-morning-digest.mjs"), "utf8");
const desktopRemoteFeatures = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-remote-features.mjs"), "utf8");
const desktopDockMenu = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-dock-menu.mjs"), "utf8");
const desktopTrayBadge = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-tray-badge.mjs"), "utf8");
const desktopLaunchArgs = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-launch-args.mjs"), "utf8");
const desktopExternalWindowContext = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-external-window-context.mjs"), "utf8");
const desktopActiveWindowMemoryPoll = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-active-window-memory-poll.mjs"), "utf8");
const desktopClipboardWatcher = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "desktop-clipboard-watcher.mjs"), "utf8");
assert.match(electronMain, /await brandIcons\.initialize\(\)/);
assert.match(brandIcons, /async function resolveIconsDir/);
assert.match(brandIcons, /const pngBase64Cache = new Map\(\)/);
assert.doesNotMatch(electronMain, /async function requestDesktopServiceJson\(/,
  "electron-main.mjs must not own desktop service HTTP bridge helpers");
assert.match(desktopServiceClient, /export async function requestDesktopServiceJson\(/,
  "desktop-service-client.mjs must own the desktop service JSON bridge helper");
assert.match(desktopServiceClient, /export async function postDesktopServiceBinaryStream\(/,
  "desktop-service-client.mjs must own the desktop service streaming binary bridge helper");
assert.doesNotMatch(electronMain, /async function appendDesktopDiagnosticError\(/,
  "electron-main.mjs must not own desktop diagnostic JSONL write helpers");
assert.doesNotMatch(electronMain, /function installDesktopDiagnostics\(/,
  "electron-main.mjs must not own desktop diagnostic process/crashReporter setup");
assert.match(desktopDiagnostics, /export async function appendDesktopDiagnosticError\(/,
  "desktop-diagnostics.mjs must own desktop diagnostic JSONL writes");
assert.match(desktopDiagnostics, /export function installDesktopDiagnostics\(/,
  "desktop-diagnostics.mjs must own desktop diagnostic process/crashReporter setup");
assert.doesNotMatch(electronMain, /function mergeSettingsDefaults\(/,
  "electron-main.mjs must not own desktop settings default merging");
assert.doesNotMatch(electronMain, /let settingsCache = null/,
  "electron-main.mjs must not own desktop settings cache state");
assert.match(desktopSettings, /export function createDesktopSettingsStore\(/,
  "desktop-settings.mjs must own the desktop settings store");
assert.match(desktopSettings, /export function mergeSettingsDefaults\(/,
  "desktop-settings.mjs must own desktop settings default merging");
assert.doesNotMatch(electronMain, /function normalizeApprovalDecisionPayload\(/,
  "electron-main.mjs must not own approval payload normalization");
assert.match(desktopPayloadNormalizers, /export function normalizePlainObject\(/,
  "desktop-payload-normalizers.mjs must own shared plain-object normalization");
assert.match(desktopPayloadNormalizers, /export function normalizeApprovalDecisionPayload\(/,
  "desktop-payload-normalizers.mjs must own approval payload normalization");
assert.match(desktopPayloadNormalizers, /export function buildApprovalDecisionBody\(/,
  "desktop-payload-normalizers.mjs must own approval decision body construction");

const duplicatePlainObjectNormalizers = files
  .filter((filePath) => !filePath.endsWith(path.join("src", "desktop", "tray", "desktop-payload-normalizers.mjs")))
  .filter((filePath) => /^function normalizePlainObject\(value\) \{/m.test(readFileSync(filePath, "utf8")))
  .map((filePath) => path.relative(repoRoot, filePath).replaceAll("\\", "/"));
assert.deepEqual(
  duplicatePlainObjectNormalizers,
  [],
  `desktop-payload-normalizers.mjs must be the only tray owner of normalizePlainObject; duplicates:\n${duplicatePlainObjectNormalizers.join("\n")}`
);
assert.doesNotMatch(electronMain, /function buildWindowUrl\(/,
  "electron-main.mjs must not own renderer window URL construction");
assert.doesNotMatch(electronMain, /function resolveWindowOptions\(/,
  "electron-main.mjs must not own static BrowserWindow option templates");
assert.match(desktopWindowConfig, /export function buildWindowUrl\(/,
  "desktop-window-config.mjs must own renderer window URL construction");
assert.match(desktopWindowConfig, /export function resolveWindowOptions\(/,
  "desktop-window-config.mjs must own static BrowserWindow option templates");
assert.doesNotMatch(electronMain, /function clampWindowBounds\(/,
  "electron-main.mjs must not own reusable desktop window bounds clamping");
assert.doesNotMatch(electronMain, /const DOCK_HUD_SCROLL_LOCK_CSS = /,
  "electron-main.mjs must not own dock HUD scroll-lock CSS");
assert.match(desktopWindowBounds, /export function createDesktopWindowBounds\(/,
  "desktop-window-bounds.mjs must own desktop window bounds helpers");
assert.match(desktopWindowBounds, /function clampWindowBounds\(/,
  "desktop-window-bounds.mjs must own desktop window bounds clamping");
assert.match(desktopWindowBounds, /export function lockWindowRendererZoom\(/,
  "desktop-window-bounds.mjs must own renderer zoom locking");
assert.match(desktopWindowBounds, /export const DOCK_HUD_SCROLL_LOCK_CSS/,
  "desktop-window-bounds.mjs must own dock HUD scroll-lock CSS");
assert.doesNotMatch(electronMain, /const pendingWindowMessages = new Map\(\)/,
  "electron-main.mjs must not own pending renderer message queue state");
assert.doesNotMatch(electronMain, /function buildOverlayPayloadFromFiles\(/,
  "electron-main.mjs must not own reusable overlay file payload construction");
assert.match(desktopWindowMessages, /export function createWindowMessageQueue\(/,
  "desktop-window-messages.mjs must own pending renderer message queue state");
assert.match(desktopWindowMessages, /const pendingWindowMessages = new Map\(\)/,
  "desktop-window-messages.mjs must own the pending renderer message queue");
assert.match(desktopOverlayPayloads, /export function buildOverlayPayloadFromFiles\(/,
  "desktop-overlay-payloads.mjs must own reusable overlay file payload construction");
assert.match(desktopOverlayPayloads, /export const ECHO_DOCK_DROP_VOICE_READY_MS = 30_000/,
  "desktop-overlay-payloads.mjs must own the Echo dock-drop voice continuation TTL");
assert.doesNotMatch(electronMain, /AppData", "Local", "UCA", "handoffs", "explorer"/,
  "electron-main.mjs must not own desktop handoff path constants");
assert.doesNotMatch(electronMain, /prompt-handoff-\.\*\\\.json/,
  "electron-main.mjs must not own desktop handoff filename patterns");
assert.match(desktopPaths, /export function explorerHandoffDir\(/,
  "desktop-paths.mjs must own the explorer handoff directory");
assert.match(desktopPaths, /export const EXPLORER_HANDOFF_FILE_PATTERN/,
  "desktop-paths.mjs must own the explorer handoff filename pattern");
assert.match(desktopPaths, /export function guiSmokeUserDataDir\(/,
  "desktop-paths.mjs must own GUI smoke user-data isolation paths");
assert.doesNotMatch(electronMain, /async function runPowerShellScript\(/,
  "electron-main.mjs must not own the reusable desktop PowerShell runner");
assert.match(desktopPowerShell, /export async function runPowerShellScript\(/,
  "desktop-powershell.mjs must own the reusable desktop PowerShell runner");
assert.match(desktopPowerShell, /"-WindowStyle", "Hidden"/,
  "desktop-powershell.mjs must keep hidden PowerShell execution for desktop helpers");
assert.doesNotMatch(electronMain, /function servicePortFromUrl\(/,
  "electron-main.mjs must not own desktop service URL port parsing");
assert.doesNotMatch(electronMain, /function shouldHostEmbeddedService\(/,
  "electron-main.mjs must not own embedded-service host eligibility parsing");
assert.match(desktopServiceRuntime, /export function servicePortFromUrl\(/,
  "desktop-service-runtime.mjs must own desktop service URL port parsing");
assert.match(desktopServiceRuntime, /export function shouldHostEmbeddedService\(/,
  "desktop-service-runtime.mjs must own embedded-service host eligibility parsing");
assert.match(desktopServiceRuntime, /export async function serviceIsHealthy\(/,
  "desktop-service-runtime.mjs must own reusable desktop service health checks");
assert.doesNotMatch(electronMain, /const notificationBatches = new Map\(\)/,
  "electron-main.mjs must not own notification batching state");
assert.doesNotMatch(electronMain, /function showDesktopNotification\(/,
  "electron-main.mjs must not own popup/native notification delivery");
assert.match(desktopNotifications, /export function createDesktopNotificationCenter\(/,
  "desktop-notifications.mjs must own desktop notification delivery");
assert.match(desktopNotifications, /const notificationBatches = new Map\(\)/,
  "desktop-notifications.mjs must own notification batching state");
assert.doesNotMatch(electronMain, /const processedHandoffFiles = new Set\(\)/,
  "electron-main.mjs must not own explorer handoff watcher dedupe state");
assert.doesNotMatch(electronMain, /const processedNotificationFiles = new Set\(\)/,
  "electron-main.mjs must not own notification watcher dedupe state");
assert.doesNotMatch(electronMain, /watch\(handoffDir\)/,
  "electron-main.mjs must not own explorer handoff directory watch loop");
assert.doesNotMatch(electronMain, /watch\(notificationDir\)/,
  "electron-main.mjs must not own notification directory watch loop");
assert.match(desktopHandoffWatcher, /export function createExplorerHandoffWatcher\(/,
  "desktop-handoff-watcher.mjs must own explorer handoff directory watching");
assert.match(desktopHandoffWatcher, /const processedHandoffFiles = new Set\(\)/,
  "desktop-handoff-watcher.mjs must own explorer handoff dedupe state");
assert.match(desktopNotificationWatcher, /export function createDesktopNotificationWatcher\(/,
  "desktop-notification-watcher.mjs must own notification directory watching");
assert.match(desktopNotificationWatcher, /const processedNotificationFiles = new Set\(\)/,
  "desktop-notification-watcher.mjs must own notification dedupe state");
assert.doesNotMatch(electronMain, /fetch\(`\$\{resolvedServiceBaseUrl\}\/health`/,
  "electron-main.mjs must not own remote feature health fetch details");
assert.doesNotMatch(electronMain, /pathname:\s*"\/email\/digest\/check"/,
  "electron-main.mjs must not own morning digest HTTP route details");
assert.match(desktopRemoteFeatures, /export async function isRemoteFeatureEnabled\(/,
  "desktop-remote-features.mjs must own remote feature health fetch details");
assert.match(desktopRemoteFeatures, /features\?\.\[featureId\]\?\.enabled !== false/,
  "desktop-remote-features.mjs must preserve remote feature default-enabled semantics");
assert.match(desktopMorningDigest, /export async function requestMorningDigestCheck\(/,
  "desktop-morning-digest.mjs must own morning digest check request details");
assert.match(desktopMorningDigest, /pathname:\s*"\/email\/digest\/check"/,
  "desktop-morning-digest.mjs must preserve the morning digest HTTP route");
assert.doesNotMatch(electronMain, /function buildDockContextMenu\(/,
  "electron-main.mjs must not own dock context menu templates");
assert.doesNotMatch(electronMain, /function clearUserKeywordSamples\(/,
  "electron-main.mjs must not own dock menu keyword sample cleanup");
assert.match(desktopDockMenu, /export function createDockContextMenuController\(/,
  "desktop-dock-menu.mjs must own dock context menu controller construction");
assert.match(desktopDockMenu, /export function createInitialTrayMenu\(/,
  "desktop-dock-menu.mjs must own the initial tray context menu template");
assert.match(desktopDockMenu, /function buildDockContextMenu\(/,
  "desktop-dock-menu.mjs must own dock context menu templates");
assert.match(desktopDockMenu, /function clearUserKeywordSamples\(/,
  "desktop-dock-menu.mjs must own dock menu keyword sample cleanup");
assert.doesNotMatch(electronMain, /fetch\(`\$\{resolvedServiceBaseUrl\}\/tasks`/,
  "electron-main.mjs must not own tray badge task fetch details");
assert.match(desktopTrayBadge, /export async function updateDesktopTrayBadge\(/,
  "desktop-tray-badge.mjs must own tray badge task fetch/update logic");
assert.match(desktopTrayBadge, /status !== "success" && task\.status !== "partial_success"/,
  "desktop-tray-badge.mjs must preserve successful task counting semantics");
assert.doesNotMatch(electronMain, /function getArgValue\(/,
  "electron-main.mjs must not own desktop launch argument parsing");
assert.match(desktopLaunchArgs, /export function parseDesktopLaunchArgs\(/,
  "desktop-launch-args.mjs must own desktop launch argument parsing");
assert.doesNotMatch(electronMain, /let lastExternalWindowContext = null/,
  "electron-main.mjs must not own external active-window memory state");
assert.match(desktopExternalWindowContext, /export function createExternalWindowContextMemory\(/,
  "desktop-external-window-context.mjs must own external active-window memory state");
assert.match(desktopExternalWindowContext, /export function looksLikeShellWindowContext\(/,
  "desktop-external-window-context.mjs must own LingxY self-window detection");
assert.doesNotMatch(electronMain, /let activeWindowMemoryPollInFlight = false/,
  "electron-main.mjs must not own active-window memory poll in-flight state");
assert.match(desktopActiveWindowMemoryPoll, /export function createActiveWindowMemoryPoll\(/,
  "desktop-active-window-memory-poll.mjs must own active-window memory poll construction");
assert.match(desktopActiveWindowMemoryPoll, /let activeWindowMemoryPollInFlight = false/,
  "desktop-active-window-memory-poll.mjs must own active-window memory poll in-flight state");
assert.doesNotMatch(electronMain, /let lastClipboardText = ""/,
  "electron-main.mjs must not own clipboard watcher last-text state");
assert.doesNotMatch(electronMain, /let clipboardPollTimer = null/,
  "electron-main.mjs must not own clipboard watcher timer state");
assert.match(desktopClipboardWatcher, /export function createDesktopClipboardWatcher\(/,
  "desktop-clipboard-watcher.mjs must own desktop clipboard watcher construction");
assert.match(desktopClipboardWatcher, /let lastClipboardText = ""/,
  "desktop-clipboard-watcher.mjs must own clipboard watcher last-text state");
assert.match(desktopClipboardWatcher, /intervalMs = 800/,
  "desktop-clipboard-watcher.mjs must preserve the existing clipboard poll cadence");

const desktopWindowLifecycle = readFileSync(
  path.join(repoRoot, "src", "desktop", "tray", "desktop-window-lifecycle.mjs"),
  "utf8"
);
assert.doesNotMatch(electronMain, /browserWindow\.on\(["']close["'],/,
  "electron-main.mjs must not own window lifecycle close handler");
assert.doesNotMatch(electronMain, /browserWindow\.on\(["']focus["'],/,
  "electron-main.mjs must not own window lifecycle focus handler");
assert.doesNotMatch(electronMain, /browserWindow\.on\(["']closed["'],/,
  "electron-main.mjs must not own window lifecycle closed handler");
assert.doesNotMatch(electronMain, /let boundsPersistTimer = null/,
  "electron-main.mjs must not own window bounds persist debounce timer");
assert.doesNotMatch(electronMain, /scheduleBoundsPersist/,
  "electron-main.mjs must not own window bounds persist schedule");
assert.doesNotMatch(electronMain, /did-fail-load/,
  "electron-main.mjs must not own window lifecycle did-fail-load handler");
assert.match(desktopWindowLifecycle, /export function installWindowLifecycleHandlers\(/,
  "desktop-window-lifecycle.mjs must own window lifecycle handler installation");
assert.match(desktopWindowLifecycle, /browserWindow\.on\(["']close["'],/,
  "desktop-window-lifecycle.mjs must own close->hide handler");
assert.match(desktopWindowLifecycle, /browserWindow\.on\(["']focus["'],/,
  "desktop-window-lifecycle.mjs must own focus->shellWindowFocused handler");
assert.match(desktopWindowLifecycle, /browserWindow\.on\(["']closed["'],/,
  "desktop-window-lifecycle.mjs must own closed->cleanup handler");
assert.match(desktopWindowLifecycle, /let boundsPersistTimer = null/,
  "desktop-window-lifecycle.mjs must own bounds persist debounce state");
assert.match(desktopWindowLifecycle, /scheduleBoundsPersist/,
  "desktop-window-lifecycle.mjs must own bounds persist schedule");
assert.match(desktopWindowLifecycle, /did-finish-load/,
  "desktop-window-lifecycle.mjs must own did-finish-load handler");
assert.match(desktopWindowLifecycle, /did-fail-load/,
  "desktop-window-lifecycle.mjs must own did-fail-load handler");
assert.match(desktopWindowLifecycle, /windowDef\.locksRendererZoom/,
  "desktop-window-lifecycle.mjs must own zoom-lock handler install");

console.log("[verify-main-process-blocking] Electron main/tray blocking guard verified");
