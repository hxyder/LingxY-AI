/**
 * verify-active-window-probe.mjs — UCA-047 regression guard.
 *
 * Drives the pure-JS helper `src/desktop/tray/active-window-context.mjs` with
 * a mocked PowerShell runner that spawns `tests/fixtures/mock-active-window-probe.mjs`
 * instead of the real `active-window-probe.ps1`. This lets us assert the
 * parser + merger logic without needing Windows UI Automation, a real
 * foreground window, or any Office COM runtime.
 *
 * Scenarios covered (they map 1:1 to the mock fixture's `scenario` arg):
 *   - browser-edge-url            → active_window.detected_kind = "web_url"
 *   - browser-address-unreadable  → detected_kind = "window_title", no url
 *   - office-word-com             → detected_kind = "file_path", filePath set
 *   - office-word-title-fallback  → detected_kind = "window_title" with
 *                                    extra.parsed_filename
 *   - vscode-title                → detected_kind = "file_path", extra.parsed_folder
 *   - unknown-process             → detected_kind = "unknown"
 *   - blocklisted                 → blocked = true, no title leaked
 *   - probe-failed                → activeWindow === null
 *
 * Also covers the `capture-context.ps1` merge path: file_paths and
 * selectedText from the capture probe surface cleanly alongside the active
 * window hint.
 *
 * Parser-level unit tests on parseActiveWindowProbeOutput + buildShellContextPayload
 * round out the script so we don't need to spawn a subprocess for every
 * parser regression.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureActiveWindowContext,
  parseCaptureContextOutput,
  parseActiveWindowProbeOutput,
  normalizeActiveWindowProbe,
  buildShellContextPayload
} from "../src/desktop/tray/active-window-context.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mockFixturePath = path.join(repoRoot, "tests", "fixtures", "mock-active-window-probe.mjs");
const electronMainSource = readFileSync(path.join(repoRoot, "src", "desktop", "tray", "electron-main.mjs"), "utf8");

/* ------------------------------------------------------------------------ */
/* Parser unit tests                                                         */
/* ------------------------------------------------------------------------ */

{
  // parseCaptureContextOutput ignores trailing newlines and garbage
  const parsed = parseCaptureContextOutput('{"title":"Test","process":"explorer","files":["C:\\\\x.txt"],"text":""}\n');
  assert.equal(parsed.title, "Test");
  assert.equal(parsed.process, "explorer");
  assert.deepEqual(parsed.files, ["C:\\x.txt"]);
}

{
  // parseActiveWindowProbeOutput picks the last JSON line with an `ok` field
  const stdout = [
    "WARNING: some PowerShell log that isn't JSON",
    '{"unrelated":"garbage"}',
    '{"ok":true,"process":"msedge","title":"t","detected_kind":"web_url","payload":{"url":"https://x"},"blocked":false}'
  ].join("\n");
  const parsed = parseActiveWindowProbeOutput(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.process, "msedge");
  assert.equal(parsed.payload.url, "https://x");
}

{
  // normalizeActiveWindowProbe flattens payload and hides blocked title
  const blocked = normalizeActiveWindowProbe({
    ok: true,
    process: "KeePass",
    pid: 100,
    title: "secret vault name",
    detected_kind: "unknown",
    payload: { extra: { reason: "blocklisted_process" } },
    blocked: true
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.process, "KeePass");
  assert.equal(blocked.title, "");
  assert.equal(blocked.extra.reason, "blocklisted_process");
}

{
  // normalizeActiveWindowProbe returns null when probe itself failed
  assert.equal(normalizeActiveWindowProbe(null), null);
  assert.equal(normalizeActiveWindowProbe({ ok: false }), null);
}

/* ------------------------------------------------------------------------ */
/* End-to-end: mock PowerShell runner invoking the Node fixture              */
/* ------------------------------------------------------------------------ */

function createMockRunner(scenario, options = {}) {
  return async ({ script, args }) => {
    if (script === "capture-context.ps1") {
      // Canned capture-context output: no files, clipboard string.
      return {
        stdout: JSON.stringify({
          title: "Mocked window",
          process: scenario === "browser-edge-url" ? "msedge" : "",
          files: [],
          text: options.captureText ?? "",
          folder: ""
        }) + "\n",
        stderr: ""
      };
    }
    if (script === "active-window-probe.ps1") {
      // Drive the real fixture to emit the scenario's JSON line.
      const { stdout, stderr } = await execFileAsync(process.execPath, [mockFixturePath, scenario], {
        encoding: "utf8",
        timeout: 5000
      });
      return { stdout, stderr };
    }
    throw new Error(`unexpected script: ${script}`);
  };
}

async function runScenario(scenario, options = {}) {
  return captureActiveWindowContext({
    runPowerShell: createMockRunner(scenario, options),
    ...options
  });
}

{
  const ctx = await runScenario("browser-edge-url");
  assert.ok(ctx.activeWindow, "browser scenario must produce activeWindow");
  assert.equal(ctx.activeWindow.detectedKind, "web_url");
  assert.equal(ctx.activeWindow.url, "https://claude.ai/chat/test");
  assert.equal(ctx.activeWindow.process, "msedge");
  assert.equal(ctx.activeWindow.blocked, false);
}

{
  const ctx = await runScenario("browser-edge-url", {
    clipboardFallback: () => "stale clipboard mail",
    allowClipboardFallback: false
  });
  assert.equal(ctx.selectedText, null, "disabled clipboard fallback must not become selected text");
  assert.equal(ctx.activeWindow.url, "https://claude.ai/chat/test");
}

{
  const ctx = await runScenario("browser-edge-url", {
    clipboardFallback: () => "fresh copied selection",
    allowClipboardFallback: true
  });
  assert.equal(ctx.selectedText, "fresh copied selection");
}

{
  const ctx = await runScenario("browser-edge-url", {
    captureText: "selected text from page",
    clipboardBaseline: "selected text from page"
  });
  assert.equal(ctx.selectedText, null, "clipboard text matching the hotkey baseline must be treated as stale");
}

{
  const ctx = await runScenario("browser-edge-url", {
    captureText: "new selected text",
    clipboardBaseline: "old clipboard text"
  });
  assert.equal(ctx.selectedText, "new selected text");
}

{
  const ctx = await runScenario("browser-address-unreadable");
  assert.equal(ctx.activeWindow.detectedKind, "window_title");
  assert.equal(ctx.activeWindow.url, undefined);
  assert.equal(ctx.activeWindow.extra.reason, "address_bar_unreadable");
}

assert.ok(/shortcut\.id === "capture-and-ask"[\s\S]{0,1600}allowClipboardFallback:\s*false[\s\S]{0,220}clipboardBaseline:\s*hotKeyClipboardSnapshot/.test(electronMainSource),
  "capture-and-ask must only accept text copied after the hotkey, not stale clipboard fallback");

{
  const ctx = await runScenario("office-word-com");
  assert.equal(ctx.activeWindow.detectedKind, "file_path");
  assert.equal(ctx.activeWindow.filePath, "C:\\Users\\der\\Documents\\report.docx");
  assert.equal(ctx.activeWindow.process, "winword");
}

{
  const ctx = await runScenario("office-word-title-fallback");
  assert.equal(ctx.activeWindow.detectedKind, "window_title");
  assert.equal(ctx.activeWindow.extra.parsed_filename, "report.docx");
  assert.equal(ctx.activeWindow.extra.reason, "com_unavailable");
}

{
  const ctx = await runScenario("vscode-title");
  assert.equal(ctx.activeWindow.detectedKind, "file_path");
  assert.equal(ctx.activeWindow.filePath, "planner.mjs");
  assert.equal(ctx.activeWindow.extra.parsed_folder, "agentic");
}

{
  const ctx = await runScenario("unknown-process");
  assert.equal(ctx.activeWindow.detectedKind, "unknown");
  assert.equal(ctx.activeWindow.process, "SomeRandomApp");
}

{
  const ctx = await runScenario("blocklisted");
  assert.equal(ctx.activeWindow.blocked, true);
  assert.equal(ctx.activeWindow.title, "", "blocklisted probes must not leak the window title");
}

{
  const ctx = await runScenario("probe-failed");
  assert.equal(ctx.activeWindow.detectedKind, "window_title", "probe failures should fall back to captured window title");
  assert.equal(ctx.activeWindow.extra.reason, "capture_context_fallback");
}

/* ------------------------------------------------------------------------ */
/* buildShellContextPayload merge                                            */
/* ------------------------------------------------------------------------ */

{
  const context = {
    processName: "msedge",
    windowTitle: "Claude · Edge",
    filePaths: [],
    selectedText: "total revenue in Q4",
    activeWindow: {
      process: "msedge",
      title: "Claude · Edge",
      detectedKind: "web_url",
      url: "https://claude.ai/chat/test",
      extra: {},
      blocked: false
    }
  };
  const payload = buildShellContextPayload({ context, sourceApp: "msedge" });
  assert.equal(payload.targetWindow, "overlay");
  assert.equal(payload.active_window.detected_kind, "web_url");
  assert.equal(payload.active_window.url, "https://claude.ai/chat/test");
  assert.equal(payload.active_window.blocked, false);
  assert.equal(payload.capture.sourceType, "text_selection");
  assert.equal(payload.capture.url, "https://claude.ai/chat/test", "selection url should be auto-filled from active window");
}

{
  const context = {
    processName: "explorer",
    windowTitle: "Documents",
    filePaths: ["C:\\Users\\der\\Documents\\notes.md"],
    selectedText: null,
    activeWindow: null
  };
  const payload = buildShellContextPayload({ context, sourceApp: "explorer.exe" });
  assert.deepEqual(payload.file_paths, ["C:\\Users\\der\\Documents\\notes.md"]);
  assert.equal(payload.active_window, undefined);
}

{
  // No files, no text, but probe detected something → payload still emitted
  // so overlay can render the preview card + quick-action buttons.
  const context = {
    processName: "winword",
    windowTitle: "report.docx - Word",
    filePaths: [],
    selectedText: null,
    activeWindow: {
      process: "winword",
      title: "report.docx - Word",
      detectedKind: "file_path",
      filePath: "C:\\Users\\der\\Documents\\report.docx",
      extra: {},
      blocked: false
    }
  };
  const payload = buildShellContextPayload({ context, sourceApp: "winword" });
  assert.equal(payload.active_window.detected_kind, "file_path");
  assert.equal(payload.active_window.file_path, "C:\\Users\\der\\Documents\\report.docx");
  assert.equal(payload.file_paths, undefined);
  assert.equal(payload.capture, undefined);
}

console.log("Active window probe verification passed (parser / 8 mocked scenarios / payload merge).");
