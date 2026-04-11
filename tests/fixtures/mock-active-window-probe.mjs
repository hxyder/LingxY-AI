/**
 * mock-active-window-probe.mjs — fixture for verify-active-window-probe.mjs.
 *
 * Emulates `scripts/active-window-probe.ps1` output for test purposes so
 * verify scripts can drive `captureActiveWindowContext()` without depending
 * on a real foreground Win32 window.
 *
 * Usage (via verify script):
 *   node tests/fixtures/mock-active-window-probe.mjs <scenario>
 *
 * Scenarios:
 *   browser-edge-url           — Edge with a readable address bar
 *   browser-address-unreadable — Edge whose UI Automation probe failed
 *   office-word-com            — Word with a resolved ActiveDocument path
 *   office-word-title-fallback — Word whose COM failed, title-parsed filename
 *   vscode-title               — VSCode with parseable "file - folder - Visual Studio Code"
 *   unknown-process            — foreground app not in the dispatch table
 *   blocklisted                — foreground is a password manager
 *   probe-failed               — probe crashed
 */

const scenario = process.argv[2] ?? "browser-edge-url";

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

switch (scenario) {
  case "browser-edge-url":
    emit({
      ok: true,
      process: "msedge",
      pid: 12345,
      title: "UCA-047 · Active window probe — Claude · Microsoft Edge",
      detected_kind: "web_url",
      payload: { url: "https://claude.ai/chat/test" },
      blocked: false
    });
    break;

  case "browser-address-unreadable":
    emit({
      ok: true,
      process: "chrome",
      pid: 23456,
      title: "Internal tool · Google Chrome",
      detected_kind: "window_title",
      payload: { extra: { reason: "address_bar_unreadable", raw_title: "Internal tool · Google Chrome" } },
      blocked: false
    });
    break;

  case "office-word-com":
    emit({
      ok: true,
      process: "winword",
      pid: 34567,
      title: "report.docx - Word",
      detected_kind: "file_path",
      payload: { filePath: "C:\\Users\\der\\Documents\\report.docx" },
      blocked: false
    });
    break;

  case "office-word-title-fallback":
    emit({
      ok: true,
      process: "winword",
      pid: 34568,
      title: "report.docx [Read-Only] - Word",
      detected_kind: "window_title",
      payload: {
        extra: {
          reason: "com_unavailable",
          parsed_filename: "report.docx",
          raw_title: "report.docx [Read-Only] - Word"
        }
      },
      blocked: false
    });
    break;

  case "vscode-title":
    emit({
      ok: true,
      process: "Code",
      pid: 45678,
      title: "planner.mjs - agentic - Visual Studio Code",
      detected_kind: "file_path",
      payload: {
        filePath: "planner.mjs",
        extra: { parsed_folder: "agentic", source: "window_title" }
      },
      blocked: false
    });
    break;

  case "unknown-process":
    emit({
      ok: true,
      process: "SomeRandomApp",
      pid: 56789,
      title: "Random App Window",
      detected_kind: "unknown",
      payload: { extra: { raw_title: "Random App Window" } },
      blocked: false
    });
    break;

  case "blocklisted":
    emit({
      ok: true,
      process: "KeePass",
      pid: 67890,
      title: "",
      detected_kind: "unknown",
      payload: { extra: { reason: "blocklisted_process" } },
      blocked: true
    });
    break;

  case "probe-failed":
    emit({ ok: false, reason: "probe_failed", error: "simulated failure" });
    break;

  default:
    emit({ ok: false, reason: "unknown_scenario", scenario });
    break;
}
