import crypto from "node:crypto";
import { mkdir, writeFile, readFile, lstat, stat, readdir, access, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createNoopTool } from "../tool-helper.mjs";
import { createActionResult } from "../types.mjs";
import { translateText } from "../../translation/free-translator.mjs";
import { searchWeb, formatResultsForAssistant, normalizeSearchRecency } from "../../search/free-search.mjs";
import { CONNECTOR_ACTION_TOOLS } from "../../connectors/tools/action-tool-aggregator.mjs";
import { MEMORY_TOOLS } from "./memory-tools.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Map of friendly app names to executable names / commands.
// Entries here cover the happy path; for apps not in this list we fall back
// to Windows' Get-StartApps + shell:AppsFolder, so the AI can still launch
// things like 微信 / QQ / 钉钉 / Spotify / Notion that users actually have
// installed but aren't in the hardcoded allowlist.
const KNOWN_APPS = {
  outlook: "outlook.exe",
  word: "winword.exe",
  excel: "excel.exe",
  powerpoint: "powerpnt.exe",
  ppt: "powerpnt.exe",
  notepad: "notepad.exe",
  calc: "calc.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  edge: "msedge.exe",
  chrome: "chrome.exe",
  firefox: "firefox.exe",
  vscode: "code",
  "vs code": "code",
  cmd: "cmd.exe",
  powershell: "powershell.exe",
  paint: "mspaint.exe",
  // Chinese / locally-popular apps — still benefit from Get-StartApps if the
  // exe name differs from what's on the user's machine. We intentionally do
  // NOT hard-map 微信/WeChat here: that bypasses the Python launcher's
  // ambiguity rules and can open 微信开发者工具 instead of the chat client.
  qq: "QQ.exe",
  "钉钉": "DingTalk.exe",
  dingtalk: "DingTalk.exe",
  "腾讯会议": "WeMeetApp.exe",
  "wemeet": "WeMeetApp.exe",
  "网易云音乐": "cloudmusic.exe",
  "cloudmusic": "cloudmusic.exe",
  spotify: "spotify.exe",
  notion: "notion.exe",
  slack: "slack.exe",
  telegram: "telegram.exe",
  discord: "discord.exe"
};

function resolveAppCommand(appName) {
  const key = `${appName}`.toLowerCase().trim();
  return KNOWN_APPS[key] ?? appName;
}

function hasKnownAppAlias(appName) {
  return Object.prototype.hasOwnProperty.call(KNOWN_APPS, `${appName}`.toLowerCase().trim());
}

function looksLikeExecutableTarget(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (/^[A-Za-z]:\\/.test(text)) return true;
  if (/^\\\\/.test(text)) return true;
  if (/[\\/]/.test(text)) return true;
  if (/\.(exe|bat|cmd|lnk)$/i.test(text)) return true;
  if (/^shell:/i.test(text)) return true;
  return false;
}

function formatLaunchAmbiguityObservation(appArg, candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const allDevTools = list.length > 0 && list.every((candidate) => candidate?.is_dev_tool);
  const choiceList = list
    .map((c, i) => `${i + 1}. ${c.display_name}${c.is_dev_tool ? "（开发工具）" : ""} — ${c.exe_path}`)
    .join("\n");
  if (allDevTools) {
    return `当前只找到了和 ${appArg} 相关的开发工具，没有找到普通应用。\n如果你要打开普通版 ${appArg}，请告诉我它的可执行文件路径，或先在启动器别名里绑定正确路径。\n${choiceList}`;
  }
  return `${appArg} 有多个可能的匹配，请让用户挑一个或告诉我具体路径：\n${choiceList}`;
}

// 83.8 — Locate the Python app launcher script. Cached after first resolve
// so repeated launches don't re-check the filesystem. Looks up several
// candidates to handle both dev (scripts/app_launcher/launcher.py next to
// the source) and packaged Electron (process.resourcesPath/scripts/...) layouts.
let _pythonLauncherPathCache = null;
async function findPythonLauncherScript() {
  if (_pythonLauncherPathCache !== null) return _pythonLauncherPathCache;
  const candidates = [
    path.join(process.cwd(), "scripts", "app_launcher", "launcher.py"),
    path.resolve(__dirname, "..", "..", "..", "..", "scripts", "app_launcher", "launcher.py"),
    process.resourcesPath
      ? path.join(process.resourcesPath, "scripts", "app_launcher", "launcher.py")
      : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.F_OK);
      _pythonLauncherPathCache = candidate;
      return candidate;
    } catch { /* try next */ }
  }
  _pythonLauncherPathCache = "";
  return "";
}

/**
 * Invoke `scripts/app_launcher/launcher.py open --name <name> --json`.
 * Returns the parsed JSON result, or `{ok: false, reason: "..."}` on spawn/
 * parse failure. Throws only when Python itself isn't on PATH — callers
 * fall back to the legacy "exhausted" observation in that case.
 */
async function tryPythonLauncher(appName) {
  const scriptPath = await findPythonLauncherScript();
  if (!scriptPath) throw new Error("python_launcher_script_not_found");
  const { stdout } = await execFileAsync("python", [
    scriptPath, "open", "--name", String(appName), "--json"
  ], {
    encoding: "utf8",
    timeout: 25_000,
    windowsHide: true,
    // Force UTF-8 everywhere so Chinese display names survive the round trip.
    env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
  const line = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error("python_launcher_no_output");
  const parsed = JSON.parse(line);
  // Normalize the "ambiguous" shape into a top-level flag the caller switches on.
  if (parsed.ok && parsed.action === "ambiguous") {
    return { ok: false, ambiguous: true, candidates: parsed.candidates ?? [], decision_reason: parsed.decision_reason };
  }
  return parsed;
}

// Fallback resolver: query the Windows Start menu via PowerShell Get-StartApps
// and return the AppID of the first match. The AppID can be launched via
// `explorer.exe shell:AppsFolder\<AppID>`, which works for packaged UWP apps
// (Microsoft Store) and traditional desktop apps alike.
async function resolveAppViaStartMenu(appName) {
  if (process.platform !== "win32" || !appName) return null;
  const needle = `${appName}`.trim();
  if (!needle) return null;
  try {
    // -like matching is case-insensitive by default in PowerShell
    const psScript = `
      $ErrorActionPreference = 'Stop'
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      [Console]::OutputEncoding = $utf8NoBom
      $q = ${JSON.stringify(needle)}
      $matches = Get-StartApps | Where-Object { $_.Name -like ('*' + $q + '*') }
      if (-not $matches) { @{ ok = $false } | ConvertTo-Json -Compress; exit 0 }
      $first = $matches | Select-Object -First 1
      @{ ok = $true; name = $first.Name; appId = $first.AppID } | ConvertTo-Json -Compress
    `;
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript
    ], { encoding: "utf8", timeout: 6000, windowsHide: true });
    const payload = JSON.parse(stdout.trim() || "{}");
    if (payload.ok && payload.appId) {
      return { name: payload.name, appId: payload.appId };
    }
  } catch { /* fall through */ }
  return null;
}

const TOOL_DEFINITIONS = [
  {
    id: "open_url",
    name: "Open URL",
    description: "Open a URL in the user's default browser.",
    parameters: ACTION_TOOL_SCHEMAS.open_url,
    risk_level: "low",
    required_capabilities: ["network"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Opened URL ${args.url}`;
    }
  },
  {
    id: "web_search",
    name: "Web Search",
    description: "Open a search results page with the user's preferred engine.",
    parameters: ACTION_TOOL_SCHEMAS.web_search,
    risk_level: "low",
    required_capabilities: ["network"],
    // P4-00: membership echoed for locality; canonical list lives in
    // src/service/core/policy/policy-groups.mjs.
    policy_group: "external_web_read",
    requires_confirmation: false,
    formatObservation(args) {
      return `Opened web search for "${args.query}"`;
    }
  },
  {
    id: "compose_email",
    name: "Compose Email",
    description: "Open a mail draft with prefilled recipients, subject, and body.",
    parameters: ACTION_TOOL_SCHEMAS.compose_email,
    risk_level: "low",
    required_capabilities: ["launch_app"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Prepared a draft email to ${(args.to ?? []).join(", ")}`;
    }
  },
  {
    id: "send_email_smtp",
    name: "Send Email SMTP",
    description: "Send an email directly over SMTP using user configuration.",
    parameters: ACTION_TOOL_SCHEMAS.send_email_smtp,
    risk_level: "high",
    required_capabilities: ["network"],
    requires_confirmation: true,
    formatObservation(args) {
      return `Sent SMTP email to ${(args.to ?? []).join(", ")}`;
    }
  },
  {
    id: "open_file",
    name: "Open File",
    description: "Open a local file with the associated application.",
    parameters: ACTION_TOOL_SCHEMAS.open_file,
    risk_level: "medium",
    required_capabilities: ["file_read", "launch_app"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Opened file ${args.path}`;
    }
  },
  {
    id: "reveal_in_explorer",
    name: "Reveal In Explorer",
    description: "Reveal a local file in Explorer.",
    parameters: ACTION_TOOL_SCHEMAS.reveal_in_explorer,
    risk_level: "low",
    required_capabilities: ["file_read"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Revealed ${args.path} in Explorer`;
    }
  },
  {
    id: "launch_app",
    name: "Launch App",
    description: "Launch or focus a local application.",
    parameters: ACTION_TOOL_SCHEMAS.launch_app,
    risk_level: "medium",
    required_capabilities: ["launch_app"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Launched app ${args.app}`;
    }
  },
  {
    id: "copy_to_clipboard",
    name: "Copy To Clipboard",
    description: "Write text to the system clipboard.",
    parameters: ACTION_TOOL_SCHEMAS.copy_to_clipboard,
    risk_level: "low",
    required_capabilities: ["clipboard_write"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Copied ${String(args.content).length} characters to the clipboard`;
    }
  },
  {
    id: "notify",
    name: "Notify",
    description: "Show a local toast notification.",
    parameters: ACTION_TOOL_SCHEMAS.notify,
    risk_level: "low",
    required_capabilities: ["notify"],
    requires_confirmation: false,
    formatObservation(args) {
      return `Displayed notification "${args.title}"`;
    }
  },
  {
    id: "read_clipboard",
    name: "Read Clipboard",
    description: "Read the current clipboard content.",
    parameters: ACTION_TOOL_SCHEMAS.read_clipboard,
    risk_level: "medium",
    required_capabilities: ["clipboard_read"],
    requires_confirmation: false,
    formatObservation(_, ctx) {
      return `Read clipboard contents: ${ctx.clipboardText ?? ""}`;
    }
  },
  {
    id: "translate_text",
    name: "Translate Text",
    description: "Translate text using a free, no-key translation provider (MyMemory + Google web fallback).",
    parameters: ACTION_TOOL_SCHEMAS.translate_text,
    risk_level: "low",
    required_capabilities: ["network"],
    requires_confirmation: false,
    formatObservation(args) {
      const length = String(args.text ?? args.content ?? "").length;
      return `Translated ${length} characters to ${args.target ?? "auto"}`;
    }
  },
  {
    id: "web_search_fetch",
    name: "Web Search (fetch snippets)",
    description: "Search the web via DuckDuckGo HTML (no API key) and return the top result snippets as text so the LLM can cite them.",
    parameters: ACTION_TOOL_SCHEMAS.web_search_fetch,
    risk_level: "low",
    required_capabilities: ["network"],
    // P4-00: see policy-groups.mjs.
    policy_group: "external_web_read",
    requires_confirmation: false,
    formatObservation(args) {
      return `Searched the web for "${args.query}"`;
    }
  }
];

const NOOP_TOOLS = TOOL_DEFINITIONS
  .filter((definition) => definition.id !== "notify")
  .map((definition) => createNoopTool(definition));

// Open a URL or shell URI (mailto:, file:, http:) using the OS default handler.
// On Windows we use PowerShell Start-Process which correctly handles `&` and `?`
// in URLs (cmd.exe `start` does not — it interprets `&` as a command separator).
async function openWithDefaultHandler(target) {
  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-Command",
      `Start-Process ${JSON.stringify(target)}`
    ], { windowsHide: true });
  } else if (process.platform === "darwin") {
    await execFileAsync("open", [target]);
  } else {
    await execFileAsync("xdg-open", [target]);
  }
}

// Real implementations for the most common tools
export const OPEN_URL_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "open_url"),
  async execute(args = {}) {
    const url = args.url;
    if (!url) return createActionResult({ success: false, observation: "url required" });
    try {
      await openWithDefaultHandler(url);
      return createActionResult({ success: true, observation: `Opened ${url}` });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open url: ${error.message}` });
    }
  }
};

export const WEB_SEARCH_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "web_search"),
  async execute(args = {}) {
    const q = encodeURIComponent(args.query ?? "");
    if (!q) return createActionResult({ success: false, observation: "query required" });
    const recency = normalizeSearchRecency(args.recency, args.query);
    const url = `https://www.google.com/search?q=${q}${recency ? `&tbs=qdr:${encodeURIComponent(recency)}` : ""}`;
    return OPEN_URL_TOOL.execute({ url });
  }
};

export const COMPOSE_EMAIL_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "compose_email"),
  async execute(args = {}) {
    // Normalize `to` — accept string or array
    let toList = [];
    if (Array.isArray(args.to)) toList = args.to;
    else if (typeof args.to === "string" && args.to.trim()) toList = [args.to.trim()];

    let ccList = [];
    if (Array.isArray(args.cc)) ccList = args.cc;
    else if (typeof args.cc === "string" && args.cc.trim()) ccList = [args.cc.trim()];

    const subject = args.subject ?? "";
    const body = args.body ?? "";

    // Build mailto URI — Outlook/Mail apps will open with prefilled draft
    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    if (ccList.length > 0) params.push(`cc=${encodeURIComponent(ccList.join(","))}`);
    const mailto = `mailto:${toList.join(",")}${params.length > 0 ? "?" + params.join("&") : ""}`;

    try {
      await openWithDefaultHandler(mailto);
      const recipients = toList.length > 0 ? toList.join(", ") : "(no recipient)";
      return createActionResult({
        success: true,
        observation: `Opened email draft to ${recipients}${subject ? ` with subject "${subject}"` : ""}.`
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open email draft: ${error.message}` });
    }
  }
};

export const SEND_EMAIL_SMTP_TOOL = NOOP_TOOLS.find((tool) => tool.id === "send_email_smtp");

export const OPEN_FILE_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "open_file"),
  async execute(args = {}) {
    const target = args.path;
    if (!target) return createActionResult({ success: false, observation: "path required" });
    try {
      await openWithDefaultHandler(target);
      return createActionResult({ success: true, observation: `Opened ${target}` });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open file: ${error.message}` });
    }
  }
};

export const REVEAL_IN_EXPLORER_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "reveal_in_explorer"),
  async execute(args = {}) {
    if (!args.path) return createActionResult({ success: false, observation: "path required" });
    try {
      if (process.platform === "win32") {
        await execFileAsync("explorer.exe", ["/select,", args.path]);
      } else {
        return OPEN_FILE_TOOL.execute({ path: path.dirname(args.path) });
      }
      return createActionResult({ success: true, observation: `Revealed ${args.path}` });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to reveal: ${error.message}` });
    }
  }
};

export const LAUNCH_APP_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "launch_app"),
  async execute(args = {}) {
    const rawAppArg = args.app ?? args.name ?? args.appName;
    const appArg = Array.isArray(rawAppArg)
      ? rawAppArg.map((item) => String(item ?? "").trim()).find(Boolean)
      : rawAppArg;
    if (!appArg) return createActionResult({ success: false, observation: "app name required" });
    const command = resolveAppCommand(appArg);

    if (process.platform === "win32") {
      if (!looksLikeExecutableTarget(appArg) && !hasKnownAppAlias(appArg)) {
        try {
          const pyResult = await tryPythonLauncher(appArg);
          if (pyResult.ok) {
            return createActionResult({
              success: true,
              observation: `${pyResult.action === "focused" ? "已切换到" : pyResult.action === "restored" ? "已还原" : pyResult.action === "unhid" ? "已显示" : "已启动"} ${pyResult.display_name ?? appArg}`,
              metadata: {
                method: "python_launcher",
                action: pyResult.action,
                display_name: pyResult.display_name,
                exe_path: pyResult.exe_path,
                decision_reason: pyResult.decision_reason,
                hwnd: pyResult.hwnd,
                pid: pyResult.pid
              }
            });
          }
          if (pyResult.ambiguous) {
            return createActionResult({
              success: false,
              observation: formatLaunchAmbiguityObservation(appArg, pyResult.candidates ?? []),
              metadata: {
                method: "python_launcher",
                action: "ambiguous",
                candidates: pyResult.candidates
              }
            });
          }
        } catch {
          // Fall through to native Windows resolvers when Python is unavailable.
        }
      }

      try {
        await execFileAsync("powershell.exe", [
          "-NoProfile", "-Command",
          `$ErrorActionPreference='Stop'; Start-Process ${JSON.stringify(command)}`
        ], { windowsHide: true, timeout: 8000 });
        return createActionResult({
          success: true,
          observation: `Launched ${appArg}`,
          metadata: { method: "start_process", command }
        });
      } catch {
        // Fall through to Get-StartApps lookup — the app might exist under a
        // display name that doesn't match any registered .exe on PATH.
      }

      // Step 2 — look up the display name in the Windows Start menu
      const resolved = await resolveAppViaStartMenu(appArg);
      if (resolved?.appId) {
        try {
          await execFileAsync("explorer.exe", [`shell:AppsFolder\\${resolved.appId}`], {
            windowsHide: true,
            timeout: 6000
          });
          return createActionResult({
            success: true,
            observation: `Launched ${resolved.name} via Start menu (${resolved.appId})`,
            metadata: { method: "apps_folder", app_id: resolved.appId, matched_name: resolved.name }
          });
        } catch (error) {
          return createActionResult({
            success: false,
            observation: `Found ${resolved.name} in Start menu but failed to launch: ${error.message}`,
            metadata: { matched_name: resolved.name, app_id: resolved.appId }
          });
        }
      }

      // Step 3 — final pass through the Python launcher. This keeps custom
      // aliases / scanned install roots available even when Start-Process
      // and Get-StartApps couldn't resolve the name.
      try {
        const pyResult = await tryPythonLauncher(appArg);
        if (pyResult.ok) {
          return createActionResult({
            success: true,
            observation: `${pyResult.action === "focused" ? "已切换到" : pyResult.action === "restored" ? "已还原" : "已启动"} ${pyResult.display_name ?? appArg}`,
            metadata: {
              method: "python_launcher",
              action: pyResult.action,
              display_name: pyResult.display_name,
              exe_path: pyResult.exe_path,
              decision_reason: pyResult.decision_reason,
              hwnd: pyResult.hwnd,
              pid: pyResult.pid
            }
          });
        }
        if (pyResult.ambiguous) {
          return createActionResult({
            success: false,
            observation: formatLaunchAmbiguityObservation(appArg, pyResult.candidates ?? []),
            metadata: {
              method: "python_launcher",
              action: "ambiguous",
              candidates: pyResult.candidates
            }
          });
        }
        return createActionResult({
          success: false,
          observation: `未能启动 ${appArg}。Python 启动器：${pyResult.reason ?? "no_candidate"}（${pyResult.decision_reason ?? "unknown"}）。你可以告诉我完整的可执行文件路径。`,
          metadata: {
            method: "python_launcher_failed",
            reason: pyResult.reason,
            decision_reason: pyResult.decision_reason
          }
        });
      } catch (pyErr) {
        return createActionResult({
          success: false,
          observation: `未能启动 ${appArg}。已尝试 Start-Process 和 Get-StartApps，都没找到匹配。你可以告诉我完整的可执行文件路径，或让我用 web_search 帮你搜官方下载页。`,
          metadata: {
            method: "exhausted",
            tried: [command, "Get-StartApps", "python_launcher"],
            python_error: pyErr?.message
          }
        });
      }
    }

    // Non-Windows platforms: fall back to spawn
    try {
      spawn(command, [], { detached: true, stdio: "ignore" }).unref();
      return createActionResult({
        success: true,
        observation: `Launched ${appArg}`,
        metadata: { method: "spawn", command }
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to launch ${appArg}: ${error.message}` });
    }
  }
};

export const COPY_TO_CLIPBOARD_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "copy_to_clipboard"),
  async execute(args = {}) {
    const content = args.content ?? args.text ?? args.value ?? "";
    if (!content) return createActionResult({ success: false, observation: "content required" });
    const text = typeof content === "string" ? content : JSON.stringify(content);
    try {
      if (process.platform === "win32") {
        // pipe text to clip.exe via powershell to handle UTF-8 reliably
        await execFileAsync("powershell.exe", [
          "-NoProfile", "-Command",
          `Set-Clipboard -Value ${JSON.stringify(text)}`
        ], { windowsHide: true });
      } else if (process.platform === "darwin") {
        const child = spawn("pbcopy");
        child.stdin.write(text);
        child.stdin.end();
        await new Promise((resolve) => child.on("close", resolve));
      } else {
        const child = spawn("xclip", ["-selection", "clipboard"]);
        child.stdin.write(text);
        child.stdin.end();
        await new Promise((resolve) => child.on("close", resolve));
      }
      const preview = text.slice(0, 60);
      return createActionResult({
        success: true,
        observation: `Copied ${text.length} chars to clipboard${text.length > 60 ? `: "${preview}…"` : `: "${preview}"`}`
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to copy: ${error.message}` });
    }
  }
};
export const NOTIFY_TOOL = {
  ...TOOL_DEFINITIONS.find((tool) => tool.id === "notify"),
  async execute(args = {}, ctx = {}) {
    const baseDir = ctx.runtime?.paths?.baseDir
      ?? path.join(os.tmpdir(), "uca-test-runtime");
    const notificationDir = args.notificationDir
      ?? path.join(baseDir, "notifications");
    await mkdir(notificationDir, { recursive: true });
    const notificationPath = path.join(notificationDir, `notification-${Date.now()}-${crypto.randomUUID()}.json`);
    const payload = {
      kind: args.kind ?? undefined,
      title: args.title ?? "UCA 提醒",
      body: args.body ?? args.message ?? "时间到了",
      created_at: new Date().toISOString(),
      handoff: args.handoff ?? null,
      navigate: args.navigate ?? null,
      taskId: args.taskId ?? ctx.task?.task_id ?? null,
      artifactPath: args.artifactPath ?? null,
      mime: args.mime ?? null,
      inlinePreview: args.inlinePreview ?? null,
      openWindow: args.openWindow ?? null,
      allowContinue: args.allowContinue ?? undefined,
      allowLongBody: args.allowLongBody ?? undefined,
      autoHideMs: args.autoHideMs ?? undefined,
      dedupeKey: args.dedupeKey ?? undefined,
      skipBatch: args.skipBatch ?? undefined
    };
    await writeFile(notificationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return createActionResult({
      success: true,
      observation: `Displayed notification "${payload.title}"`,
      metadata: {
        tool_id: "notify",
        notification_path: notificationPath
      }
    });
  }
};
export const READ_CLIPBOARD_TOOL = NOOP_TOOLS.find((tool) => tool.id === "read_clipboard");

export const TRANSLATE_TEXT_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "translate_text"),
  async execute(args = {}) {
    const text = args.text ?? args.content ?? args.value ?? "";
    if (!text || !String(text).trim()) {
      return createActionResult({ success: false, observation: "text required" });
    }
    try {
      const result = await translateText({
        text: String(text),
        source: args.source ?? "auto",
        target: args.target ?? null
      });
      return createActionResult({
        success: true,
        observation: `Translated to ${result.target_language} via ${result.provider}: ${result.text.slice(0, 200)}${result.text.length > 200 ? "…" : ""}`,
        metadata: {
          tool_id: "translate_text",
          source_language: result.source_language,
          target_language: result.target_language,
          provider: result.provider,
          translated_text: result.text
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Free translation failed: ${error.message}`
      });
    }
  }
};

export const WEB_SEARCH_FETCH_TOOL = {
  ...TOOL_DEFINITIONS.find((t) => t.id === "web_search_fetch"),
  async execute(args = {}) {
    const query = String(args.query ?? "").trim();
    if (!query) {
      return createActionResult({ success: false, observation: "query required" });
    }
    const limit = Math.max(1, Math.min(10, Number(args.limit) || 5));
    try {
      const recency = normalizeSearchRecency(args.recency, query);
      const result = await searchWeb({ query, limit, recency });

      // Distinguish between a network/bot-detection failure and a genuine
      // "no results" response. When both DDG endpoints had fetch-level errors
      // (HTTP error, timeout, bot-detection page), mark the tool as failed so
      // the LLM does not silently fall back to training-data answers.
      if (result.fetchFailed) {
        // Surface which providers we actually tried so the LLM — and
        // the user reading the task result_summary — knows this was a
        // real network / bot-detection problem, not the model ducking
        // the search.
        const tried = (result.attempts ?? []).map((a) => a.provider).filter(Boolean).join(", ") || result.provider;
        return createActionResult({
          success: false,
          observation: `Web search unavailable. Tried: ${tried}. All providers either timed out, returned HTTP errors, or served bot-detection pages. Do not fall back to training data — tell the user live search is unreachable right now and suggest retrying or checking their connection.`,
          metadata: {
            tool_id: "web_search_fetch",
            query,
            provider: result.provider,
            recency: result.recency,
            attempts: result.attempts ?? [],
            results: []
          }
        });
      }

      const asText = formatResultsForAssistant(result.results, {
        query,
        provider: result.provider,
        recency: result.recency,
        maxResults: limit
      });
      return createActionResult({
        success: result.results.length > 0,
        observation: asText,
        metadata: {
          tool_id: "web_search_fetch",
          query,
          provider: result.provider,
          recency: result.recency,
          results: result.results
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Web search failed: ${error.message}`
      });
    }
  }
};

/**
 * Fetch a URL and return its readable text content so the LLM can cite it directly.
 * This is the fallback when web_search_fetch returns no results — the LLM can
 * call this with a known authoritative URL (e.g. weather.gov, wikipedia.org)
 * and get back the actual page text without opening a browser.
 */
export const FETCH_URL_CONTENT_TOOL = {
  id: "fetch_url_content",
  name: "Fetch URL Content",
  description: "Fetch a URL and return its readable text content. Use this when web_search_fetch returns no results — call it with an authoritative URL (e.g. weather.gov for weather, en.wikipedia.org for facts) to read the actual page text. Returns up to 3000 characters of extracted text.",
  parameters: ACTION_TOOL_SCHEMAS.fetch_url_content,
  risk_level: "low",
  required_capabilities: ["network"],
  // P4-00: see policy-groups.mjs.
  policy_group: "external_web_read",
  requires_confirmation: false,
  async execute(args = {}) {
    const url = String(args.url ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return createActionResult({ success: false, observation: "url required (must start with http:// or https://)" });
    }
    const maxChars = Math.max(500, Math.min(8000, Number(args.max_chars) || 3000));

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        return createActionResult({
          success: false,
          observation: `Fetch failed: HTTP ${response.status} ${response.statusText} for ${url}`
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      const rawBody = await response.text();

      let text;
      if (contentType.includes("text/html") || url.endsWith(".html") || url.endsWith(".htm")) {
        text = extractTextFromHtml(rawBody);
      } else {
        // Plain text / JSON / XML — return as-is (trimmed)
        text = rawBody.replace(/\s+/g, " ").trim();
      }

      const excerpt = text.slice(0, maxChars);
      const truncated = text.length > maxChars ? `\n\n[截断：原文共 ${text.length} 字符，仅显示前 ${maxChars} 字符]` : "";

      return createActionResult({
        success: true,
        observation: `来源：${url}\n\n${excerpt}${truncated}`,
        metadata: { url, chars_extracted: text.length, chars_returned: excerpt.length }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Fetch error for ${url}: ${error.message}`
      });
    }
  }
};

/**
 * Extract readable text from HTML.
 * Removes scripts, styles, and all tags; decodes common entities.
 */
function extractTextFromHtml(html = "") {
  return html
    // Remove <script> blocks (including content)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    // Remove <style> blocks
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    // Remove <noscript> blocks
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    // Replace block-level tags with newlines to preserve structure
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|article|section|header|footer|nav|main|aside)[^>]*>/gi, "\n")
    // Strip all remaining HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // Collapse excessive whitespace while preserving paragraph breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const FILE_OP_TOOL = {
  id: "file_op",
  name: "File Operation",
  description: "Perform a constrained file operation in the allowed workspace.",
  parameters: ACTION_TOOL_SCHEMAS.file_op,
  risk_level: "medium",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args) {
    return createActionResult({
      success: true,
      observation: `Prepared file operation ${args.operation} for ${args.path}`,
      metadata: {
        operation: args.operation,
        targetPath: args.targetPath ?? null
      }
    });
  }
};

export const TAKE_SCREENSHOT_TOOL = {
  id: "take_screenshot",
  name: "Take Screenshot",
  description: "Capture a screenshot and save it as an artifact.",
  parameters: ACTION_TOOL_SCHEMAS.take_screenshot,
  risk_level: "low",
  required_capabilities: ["screenshot"],
  requires_confirmation: false,
  async execute(args, ctx) {
    if (process.platform !== "win32") {
      return createActionResult({
        success: false,
        observation: "take_screenshot is currently implemented for Windows desktops only.",
        error: "unsupported_platform",
        metadata: { platform: process.platform }
      });
    }

    const rawLabel = String(args?.label ?? "screenshot").trim() || "screenshot";
    const safeLabel = rawLabel.replace(/[^a-z0-9_-]/gi, "_");
    const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
    const artifactPath = path.join(outputDir, `${safeLabel}.png`);
    const scriptPath = path.resolve(__dirname, "../../../../scripts/capture-screenshot.ps1");

    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-OutputPath",
        artifactPath
      ], {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true
      });
      const payload = JSON.parse(stdout.trim() || "{}");
      if (!payload.ok) {
        return createActionResult({
          success: false,
          observation: `Screenshot capture failed: ${payload.error ?? "unknown error"}`,
          error: payload.error ?? "screenshot_failed",
          metadata: { path: artifactPath }
        });
      }
      return createActionResult({
        success: true,
        observation: `Captured screenshot artifact ${artifactPath} (${payload.width}x${payload.height})`,
        artifactPaths: [artifactPath],
        metadata: {
          path: artifactPath,
          width: payload.width,
          height: payload.height,
          mime_type: "image/png"
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Screenshot capture failed: ${error.message}`,
        error: error.message,
        metadata: { path: artifactPath }
      });
    }
  }
};

function getSchedulerRuntime(ctx) {
  const scheduler = ctx.runtime?.scheduler;
  if (!scheduler) {
    throw new Error("Scheduler runtime is unavailable.");
  }
  return scheduler;
}

export const CREATE_SCHEDULED_TASK_TOOL = {
  id: "create_scheduled_task",
  name: "Create Scheduled Task",
  description: "Schedule work for LATER. Use this whenever the user says '过 N 分钟/小时/天后 …' / '明天上午 X 点 …' / 'in 10 minutes …'. Do NOT execute the work now — just create the schedule and return. When the trigger fires, the scheduler wakes the AI up and feeds it action.params.userCommand, which then runs through the normal executor (web_search / email workflow / etc.). Trigger shapes: {natural_language:'5 分钟后'} (easiest), or {type:'at', run_at:'<ISO>'} / {type:'cron', expression:'0 9 * * *'}. Action shape for AI tasks: {type:'task', target:'<short label>', params:{userCommand:'<full natural language instruction including recipient/content>'}}.",
  parameters: ACTION_TOOL_SCHEMAS.create_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args, ctx) {
    // UCA-096: Block agents from creating a new schedule while they are
    // already running inside a scheduled-task fire. Otherwise the scheduler
    // feeds the original user command back into the LLM, which re-interprets
    // it as a scheduling request and builds an infinite loop of clones.
    if (ctx?.task?.context_packet?.source_app === "uca.scheduler") {
      return createActionResult({
        success: false,
        observation: "Cannot create a schedule from inside a scheduled task fire. Execute the action now (notify / send_email / etc.).",
        error: "scheduled_fire_cannot_reschedule"
      });
    }

    const scheduler = getSchedulerRuntime(ctx);
    const schedule = scheduler.createSchedule({
      name: args.name,
      description: args.description ?? "",
      trigger: args.trigger,
      action: args.action,
      executionMode: args.execution_mode ?? "unattended_safe",
      catchupPolicy: args.catchup_policy ?? "skip"
    }, {
      createdBy: ctx.task ? "agent" : "user"
    });

    return createActionResult({
      success: true,
      observation: `Created schedule ${schedule.schedule_id}`,
      metadata: {
        schedule_id: schedule.schedule_id,
        next_run_at: schedule.next_run_at
      }
    });
  }
};

export const LIST_SCHEDULED_TASKS_TOOL = {
  id: "list_scheduled_tasks",
  name: "List Scheduled Tasks",
  description: "List configured schedules and their current status.",
  parameters: ACTION_TOOL_SCHEMAS.list_scheduled_tasks,
  risk_level: "low",
  required_capabilities: ["schedule_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedules = scheduler.listSchedules()
      .filter((schedule) => args.includeDisabled || schedule.enabled);
    return createActionResult({
      success: true,
      observation: `Listed ${schedules.length} schedules`,
      metadata: {
        schedules
      }
    });
  }
};

export const DELETE_SCHEDULED_TASK_TOOL = {
  id: "delete_scheduled_task",
  name: "Delete Scheduled Task",
  description: "Delete a schedule and its active registrations.",
  parameters: ACTION_TOOL_SCHEMAS.delete_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const deleted = scheduler.deleteSchedule(args.schedule_id);
    return createActionResult({
      success: Boolean(deleted),
      observation: deleted ? `Deleted schedule ${args.schedule_id}` : `Schedule ${args.schedule_id} not found`,
      metadata: {
        schedule_id: args.schedule_id
      },
      error: deleted ? null : "schedule_not_found"
    });
  }
};

export const PAUSE_SCHEDULED_TASK_TOOL = {
  id: "pause_scheduled_task",
  name: "Pause Scheduled Task",
  description: "Pause or resume a schedule.",
  parameters: ACTION_TOOL_SCHEMAS.pause_scheduled_task,
  risk_level: "medium",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: false,
  async execute(args = {}, ctx) {
    const scheduler = getSchedulerRuntime(ctx);
    const schedule = scheduler.pauseSchedule(args.schedule_id, args.enabled ?? false);
    return createActionResult({
      success: Boolean(schedule),
      observation: schedule
        ? `${schedule.enabled ? "Resumed" : "Paused"} schedule ${args.schedule_id}`
        : `Schedule ${args.schedule_id} not found`,
      metadata: {
        schedule_id: args.schedule_id,
        enabled: schedule?.enabled ?? null
      },
      error: schedule ? null : "schedule_not_found"
    });
  }
};

/* ------------------------------------------------------------------------ */
/* UCA-049 commit 2: universal tool belt                                     */
/*                                                                           */
/*   - write_file:        sandbox-checked file writing                       */
/*   - run_script:        whitelisted language execution with timeout        */
/*   - generate_document: pptx / docx / xlsx / pdf via render-document       */
/*                                                                           */
/* All three tools sandbox inside the task's output_dir. Symlink traversal   */
/* and `..` path segments are rejected explicitly so the LLM can't escape    */
/* the artifact workspace.                                                   */
/* ------------------------------------------------------------------------ */

function resolveOutputDirForTool(ctx) {
  if (ctx?.outputDir) return ctx.outputDir;
  const configuredDir = ctx?.runtime?.configStore?.load?.()?.output?.defaultDir;
  if (configuredDir && typeof configuredDir === "string" && configuredDir.trim()) {
    return path.join(configuredDir.trim(), ctx?.task?.task_id ?? `scratch-${Date.now()}`);
  }
  return path.join(os.homedir(), "Desktop", "UCA", ctx?.task?.task_id ?? `scratch-${Date.now()}`);
}

async function ensureOutputDir(outputDir) {
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

// Reject paths with `..`, absolute paths outside the workspace, or symlinks
// that resolve above the workspace. Returns the canonicalised target path.
async function resolveSandboxedTarget(outputDir, relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("path is required");
  }
  // Reject `..` segments outright, even if they'd cancel out, because LLMs
  // sometimes write things like `reports/../../etc/passwd` and we don't want
  // to rely on resolve() normalising away the mistake.
  if (relativePath.includes("..")) {
    throw new Error("path must not contain '..'");
  }
  // Treat absolute paths as "use as-is" but still check they're inside the
  // output dir so the LLM can paste a full `C:\...\outputs\xx\foo.txt` without
  // being rejected.
  const resolvedOutputDir = path.resolve(outputDir);
  const absTarget = path.isAbsolute(relativePath)
    ? path.resolve(relativePath)
    : path.resolve(resolvedOutputDir, relativePath);
  const withinWorkspace = absTarget === resolvedOutputDir
    || absTarget.startsWith(resolvedOutputDir + path.sep);
  if (!withinWorkspace) {
    throw new Error(`path escapes task workspace: ${relativePath}`);
  }
  // Reject any existing symlink components in the *parent* chain between the
  // workspace and the target. realpath() would silently follow them.
  let probe = path.dirname(absTarget);
  while (probe && probe.length >= resolvedOutputDir.length) {
    try {
      const info = await lstat(probe);
      if (info.isSymbolicLink()) {
        throw new Error(`parent path contains a symlink: ${probe}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  // If the target already exists, make sure it's not itself a symlink.
  try {
    const info = await lstat(absTarget);
    if (info.isSymbolicLink()) {
      throw new Error(`target path is a symlink: ${relativePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return absTarget;
}

async function resolveEditableTargetForEdit(ctx, targetArg) {
  const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
  if (!path.isAbsolute(targetArg)) {
    return resolveSandboxedTarget(outputDir, targetArg);
  }

  const absTarget = path.resolve(targetArg);
  const allowedRoots = [
    ctx?.runtime?.paths?.outputsDir,
    ctx?.runtime?.configStore?.load?.()?.output?.defaultDir,
    path.join(os.homedir(), "Desktop", "UCA"),
    outputDir
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  const withinAllowedRoot = allowedRoots.some((root) =>
    absTarget === root || absTarget.startsWith(root + path.sep)
  );
  if (!withinAllowedRoot) {
    throw new Error(`path escapes editable artifact roots: ${targetArg}`);
  }
  const info = await lstat(absTarget);
  if (info.isSymbolicLink()) {
    throw new Error(`target path is a symlink: ${targetArg}`);
  }
  return absTarget;
}

function decodeWriteFileContent({ content, text, encoding }) {
  const raw = typeof content === "string" ? content
    : typeof text === "string" ? text
      : "";
  const enc = (encoding || "utf8").toLowerCase();
  if (enc === "utf8" || enc === "utf-8") {
    return Buffer.from(raw, "utf8");
  }
  if (enc === "base64") {
    return Buffer.from(raw, "base64");
  }
  throw new Error(`unsupported encoding: ${encoding}`);
}

export const WRITE_FILE_TOOL = {
  id: "write_file",
  name: "Write File",
  description: "Write text or base64-encoded content to a file inside the task workspace. Rejects '..' segments and symlink escapes.",
  parameters: ACTION_TOOL_SCHEMAS.write_file,
  risk_level: "medium",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
    const targetArg = args.path ?? args.filename ?? "";
    try {
      const absTarget = await resolveSandboxedTarget(outputDir, targetArg);
      if (!args.overwrite) {
        try {
          await access(absTarget, fsConstants.F_OK);
          return createActionResult({
            success: false,
            observation: `File already exists at ${path.relative(outputDir, absTarget)}; pass overwrite:true to replace it.`,
            metadata: { tool_id: "write_file", path: absTarget }
          });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      await mkdir(path.dirname(absTarget), { recursive: true });
      const buffer = decodeWriteFileContent(args);
      await writeFile(absTarget, buffer);
      return createActionResult({
        success: true,
        observation: `Wrote ${buffer.length} bytes to ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
        metadata: {
          tool_id: "write_file",
          path: absTarget,
          bytes: buffer.length
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `write_file failed: ${error.message}`,
        metadata: { tool_id: "write_file", attempted_path: targetArg }
      });
    }
  }
};

const RUN_SCRIPT_LANGUAGES = Object.freeze({
  powershell: { interpreter: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"], ext: ".ps1" },
  node: { interpreter: process.execPath, args: [], ext: ".mjs" },
  python: { interpreter: "python", args: [], ext: ".py" }
});

function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(20, Math.max(1, Math.floor(n)));
}

async function spawnScript({ language, scriptPath, timeoutSeconds }) {
  const spec = RUN_SCRIPT_LANGUAGES[language];
  if (!spec) {
    throw new Error(`unsupported language: ${language}`);
  }
  return new Promise((resolve) => {
    const child = spawn(spec.interpreter, [...spec.args, scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const killTimer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      settled = true;
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ exitCode: null, stdout, stderr: stderr + `\n${error.message}`, spawnError: true });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ exitCode: code, stdout, stderr, timedOut: false });
    });
  });
}

export const RUN_SCRIPT_TOOL = {
  id: "run_script",
  name: "Run Script",
  description: "Execute a short powershell / node / python script inside the task workspace. Output is captured and returned as the observation. Scripts are killed after 20 seconds.",
  parameters: ACTION_TOOL_SCHEMAS.run_script,
  risk_level: "medium",
  required_capabilities: ["subprocess_exec"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const language = String(args.language ?? "").toLowerCase().trim();
    const source = typeof args.script === "string" ? args.script
      : typeof args.code === "string" ? args.code
        : "";
    if (!RUN_SCRIPT_LANGUAGES[language]) {
      return createActionResult({
        success: false,
        observation: `run_script rejected: language must be one of powershell/node/python. Got "${args.language}".`,
        metadata: { tool_id: "run_script" }
      });
    }
    if (!source.trim()) {
      return createActionResult({
        success: false,
        observation: "run_script rejected: script/code is empty.",
        metadata: { tool_id: "run_script" }
      });
    }
    const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
    const spec = RUN_SCRIPT_LANGUAGES[language];
    const scriptPath = path.join(outputDir, `run-script-${crypto.randomUUID().slice(0, 8)}${spec.ext}`);
    await writeFile(scriptPath, source, "utf8");
    const timeoutSeconds = clampTimeout(args.timeout);
    try {
      const result = await spawnScript({ language, scriptPath, timeoutSeconds });
      if (result.timedOut) {
        return createActionResult({
          success: false,
          observation: `run_script (${language}) timed out after ${timeoutSeconds}s and was killed.\n--- stdout ---\n${result.stdout.slice(0, 2000)}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
          metadata: { tool_id: "run_script", language, timed_out: true, timeout_seconds: timeoutSeconds }
        });
      }
      if (result.spawnError || result.exitCode !== 0) {
        return createActionResult({
          success: false,
          observation: `run_script (${language}) exited with code ${result.exitCode ?? "unknown"}.\n--- stdout ---\n${result.stdout.slice(0, 2000)}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
          metadata: { tool_id: "run_script", language, exit_code: result.exitCode }
        });
      }
      return createActionResult({
        success: true,
        observation: `run_script (${language}) finished with exit 0.\n--- stdout ---\n${result.stdout.slice(0, 4000) || "(empty)"}\n--- stderr ---\n${result.stderr.slice(0, 2000)}`,
        metadata: {
          tool_id: "run_script",
          language,
          exit_code: 0,
          stdout_bytes: result.stdout.length,
          stderr_bytes: result.stderr.length
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `run_script crashed: ${error.message}`,
        metadata: { tool_id: "run_script", language }
      });
    }
  }
};

async function resolveDocumentRendererScript() {
  const scriptName = "render-document.ps1";
  const candidates = [
    path.join(process.cwd(), "scripts", scriptName),
    path.resolve(__dirname, "..", "..", "..", "..", "scripts", scriptName),
    process.resourcesPath ? path.join(process.resourcesPath, "scripts", scriptName) : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.F_OK);
      return candidate;
    } catch { /* try next */ }
  }
  return candidates[0];
}

const OUTLINE_KINDS = new Set(["pptx", "docx", "xlsx", "pdf"]);
const KIND_EXTENSIONS = { pptx: ".pptx", docx: ".docx", xlsx: ".xlsx", pdf: ".pdf" };
const KIND_MIMES = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf"
};

function artifactKindFromTarget(targetPath = "") {
  const ext = path.extname(String(targetPath ?? "")).toLowerCase();
  if (ext === ".pptx") return "pptx";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".md") return "md";
  if (ext === ".txt") return "txt";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".csv") return "csv";
  if (ext === ".json") return "json";
  return null;
}

function escapeHtmlForDocument(text) {
  return `${text}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writePdfFromHtmlArtifact(htmlPath, pdfPath) {
  const browsers = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  let browserPath = null;
  for (const candidate of browsers) {
    try {
      await access(candidate, fsConstants.F_OK);
      browserPath = candidate;
      break;
    } catch { /* try next */ }
  }

  if (!browserPath) {
    throw new Error("No Edge/Chrome browser found for PDF conversion.");
  }

  await execFileAsync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--print-to-pdf=${pdfPath}`,
    "--print-to-pdf-no-header",
    pathToFileURL(htmlPath).href
  ], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(pdfPath);
      if (info.size > 0) return;
    } catch { /* wait for browser to flush the PDF */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("PDF conversion finished but output file was not created.");
}

function coerceOutlineToPlainText(kind, outline) {
  if (typeof outline === "string") return outline;
  if (!outline || typeof outline !== "object") return "";
  if (kind === "pptx") {
    const lines = [];
    if (outline.title) lines.push(String(outline.title));
    if (outline.subtitle) lines.push(String(outline.subtitle));
    lines.push("");
    for (const slide of Array.isArray(outline.slides) ? outline.slides : []) {
      if (slide?.heading) lines.push(`# ${slide.heading}`);
      for (const bullet of Array.isArray(slide?.bullets) ? slide.bullets : []) {
        lines.push(`- ${bullet}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  if (kind === "xlsx") {
    const rows = Array.isArray(outline.rows) ? outline.rows
      : Array.isArray(outline) ? outline
        : [];
    return rows.map((row) => Array.isArray(row) ? row.join("\t") : String(row ?? "")).join("\n");
  }
  // docx / pdf default: flatten sections/headings/body
  const lines = [];
  if (outline.title) lines.push(String(outline.title));
  if (outline.subtitle) lines.push(String(outline.subtitle));
  // Accept either `sections` (canonical) or `slides` (AI sometimes uses pptx
  // shape for docx when the prompt example is ambiguous).
  const sections = Array.isArray(outline.sections) ? outline.sections
    : Array.isArray(outline.slides) ? outline.slides
      : [];
  for (const section of sections) {
    const heading = section?.heading ?? section?.title ?? null;
    if (heading) lines.push(`# ${heading}`);
    // `body` (canonical), `content` or `bullets` array (pptx fallback)
    if (section?.body) {
      lines.push(String(section.body));
    } else if (Array.isArray(section?.bullets)) {
      for (const b of section.bullets) lines.push(`- ${b}`);
    } else if (section?.content) {
      lines.push(String(section.content));
    }
  }
  if (outline.body && sections.length === 0) lines.push(String(outline.body));
  return lines.join("\n");
}

function stripCodeFences(text) {
  return String(text ?? "")
    .replace(/```[a-z0-9_-]*\r?\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function tryParseOutlineJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const candidates = [value, stripCodeFences(value)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* try next */ }
  }
  return null;
}

function heuristicPptxOutlineFromText(text) {
  const lines = stripCodeFences(text).split(/\r?\n/);
  const slides = [];
  let current = null;
  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) {
      if (current && (current.heading || current.bullets.length > 0)) {
        slides.push(current);
        current = null;
      }
      continue;
    }
    if (!current) {
      current = { heading: line.replace(/^#+\s*/, ""), bullets: [] };
      continue;
    }
    current.bullets.push(line.replace(/^[-*]\s*/, ""));
  }
  if (current && (current.heading || current.bullets.length > 0)) slides.push(current);
  return {
    title: slides[0]?.heading ?? "Presentation",
    slides: slides.length > 0 ? slides : [{ heading: "Presentation", bullets: [stripCodeFences(text).slice(0, 200)] }]
  };
}

function heuristicSectionOutlineFromText(text) {
  const cleaned = stripCodeFences(text);
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { title: "Document", sections: [] };
  return {
    title: lines[0].replace(/^#+\s*/, ""),
    sections: [{ heading: lines[0].replace(/^#+\s*/, ""), body: lines.slice(1).join("\n") || cleaned }]
  };
}

function heuristicXlsxOutlineFromText(text) {
  const rows = stripCodeFences(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,|\|/).map((cell) => cell.trim()).filter(Boolean));
  return { rows };
}

function normalizeDocumentOutline(kind, outline) {
  if (outline && typeof outline === "object") return outline;
  const parsed = tryParseOutlineJson(outline);
  if (parsed) return parsed;
  const raw = String(outline ?? "").trim();
  if (!raw) return {};
  if (kind === "pptx") return heuristicPptxOutlineFromText(raw);
  if (kind === "xlsx") return heuristicXlsxOutlineFromText(raw);
  return heuristicSectionOutlineFromText(raw);
}

function previewSidecarPathForArtifact(targetPath) {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.name}-preview.html`);
}

async function buildDocumentPreviewHtml(kind, outline, targetPath = "") {
  if (kind === "pdf") {
    return buildPdfHtml(outline);
  }
  const { renderDocumentPreviewHtml } = await import("./document-renderer.mjs");
  return renderDocumentPreviewHtml({
    kind,
    outline,
    title: outline?.title || path.basename(targetPath || `result.${kind}`)
  });
}

async function writeDocumentPreviewSidecar({ kind, targetPath, outline }) {
  const previewPath = previewSidecarPathForArtifact(targetPath);
  const html = await buildDocumentPreviewHtml(kind, outline, targetPath);
  await writeFile(previewPath, html, "utf8");
  return previewPath;
}

async function invokeDocumentRenderer({ kind, targetPath, outline }) {
  // Try the Node.js renderer first (pptxgenjs / docx / exceljs — styled output).
  try {
    const { renderDocument } = await import("./document-renderer.mjs");
    await renderDocument({ kind, targetPath, outline });
    return;
  } catch (nodeErr) {
    // Fall back to PowerShell bare-XML renderer if the npm packages are missing
    // or if the outline shape confused the Node renderer. We pass the outline
    // text through a UTF-8 temp file rather than a CLI argument: Windows caps
    // command-line length at 8191 chars, and a single long bullet or body
    // paragraph trivially exceeds that. The temp file is deleted in finally.
    const tempFile = path.join(
      os.tmpdir(),
      `lingxy-doc-${crypto.randomBytes(8).toString("hex")}.txt`
    );
    try {
      const scriptPath = await resolveDocumentRendererScript();
      const plainText = coerceOutlineToPlainText(kind, outline);
      await writeFile(tempFile, plainText, "utf8");
      await execFileAsync("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
        "-TargetPath", targetPath,
        "-Kind", kind,
        "-TextFile", tempFile
      ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    } catch (psErr) {
      throw new Error(`Document render failed (Node: ${nodeErr.message}; PS: ${psErr.message})`);
    } finally {
      await unlink(tempFile).catch(() => { /* best-effort cleanup */ });
    }
  }
}

export const GENERATE_DOCUMENT_TOOL = {
  id: "generate_document",
  name: "Generate Document",
  description: `Produce a professionally styled pptx / docx / xlsx / pdf artifact from a structured outline.

Outline shapes:
• pptx → { title, subtitle?, author?, date?, slides: [{ heading, bullets?: string[], body?: string, table?: { headers: string[], rows: any[][] }, layout?: "section" }] }
• docx → { title, subtitle?, author?, date?, sections: [{ heading, level?: 1|2, body?: string, bullets?: string[], table?: { headers: string[], rows: any[][] } }] }
• xlsx → { headers: string[], rows: any[][] }  OR  { sheets: [{ name, headers, rows }] }
• pdf  → same shape as docx (rendered to HTML then printed)

Preferred calling convention:
• Pass \`outline\` as a native object, not a stringified JSON string.
• The tool will still normalize stringified JSON or plain-text outlines as a fallback, but object input is more reliable across models.

For reports with charts: include Mermaid diagram code in body text wrapped in triple-backtick mermaid blocks — they render automatically in HTML/PDF output.`,
  parameters: ACTION_TOOL_SCHEMAS.generate_document,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase().trim();
    if (!OUTLINE_KINDS.has(kind)) {
      return createActionResult({
        success: false,
        observation: `generate_document rejected: kind must be one of pptx/docx/xlsx/pdf. Got "${args.kind}".`,
        metadata: { tool_id: "generate_document" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const targetArg = typeof args.path === "string" && args.path.trim()
        ? args.path.trim()
        : (typeof args.filename === "string" && args.filename.trim()
          ? args.filename.trim()
          : `result${KIND_EXTENSIONS[kind]}`);
      const absTarget = await resolveSandboxedTarget(outputDir, targetArg);
      const outline   = normalizeDocumentOutline(kind, args.outline ?? {});

      if (kind === "pdf") {
        const htmlPath = absTarget.replace(/\.pdf$/i, ".html");
        const htmlContent = buildPdfHtml(outline);
        await writeFile(htmlPath, htmlContent, "utf8");
        try {
          await writePdfFromHtmlArtifact(htmlPath, absTarget);
          const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
          return createActionResult({
            success: true,
            observation: `generate_document produced PDF at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
            metadata: {
              tool_id: "generate_document", kind,
              path: absTarget, mime_type: KIND_MIMES[kind],
              html_source_path: htmlPath,
              preview_html_path: previewPath
            },
            artifactPaths: [absTarget]
          });
        } catch (error) {
          return createActionResult({
            success: true,
            observation: `generate_document could not convert to PDF (${error.message}); produced HTML at ${path.relative(outputDir, htmlPath)}.`,
            metadata: {
              tool_id: "generate_document", kind,
              path: htmlPath, mime_type: "text/html",
              needs_pdf_conversion: true, pdf_conversion_error: error.message
            },
            artifactPaths: [htmlPath]
          });
        }
      }

      await invokeDocumentRenderer({ kind, targetPath: absTarget, outline });
      const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
      return createActionResult({
        success: true,
        observation: `generate_document produced ${kind.toUpperCase()} at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
        metadata: {
          tool_id: "generate_document",
          kind,
          path: absTarget,
          mime_type: KIND_MIMES[kind],
          preview_html_path: previewPath
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `generate_document failed: ${error.message}`,
        metadata: { tool_id: "generate_document", kind }
      });
    }
  }
};

export const EDIT_FILE_TOOL = {
  id: "edit_file",
  name: "Edit File",
  description: "Update an existing file in place. For pptx/docx/xlsx/pdf pass a full updated outline and the existing absolute path; for text-like files pass the full replacement content.",
  parameters: ACTION_TOOL_SCHEMAS.edit_file,
  risk_level: "medium",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const targetArg = String(args.path ?? "").trim();
    if (!targetArg) {
      return createActionResult({
        success: false,
        observation: "edit_file rejected: path is required.",
        metadata: { tool_id: "edit_file" }
      });
    }
    try {
      const absTarget = await resolveEditableTargetForEdit(ctx, targetArg);
      const ext = path.extname(absTarget).toLowerCase();
      const kind = String(args.kind ?? artifactKindFromTarget(absTarget) ?? "").toLowerCase().trim();
      if (OUTLINE_KINDS.has(kind)) {
        const outline = normalizeDocumentOutline(kind, args.outline ?? args.content ?? args.text ?? {});
        if (!outline || (typeof outline === "object" && Object.keys(outline).length === 0)) {
          return createActionResult({
            success: false,
            observation: `edit_file rejected: ${kind} edits require a full updated outline/content.`,
            metadata: { tool_id: "edit_file", path: absTarget, kind }
          });
        }
        if (kind === "pdf") {
          const htmlPath = absTarget.replace(/\.pdf$/i, ".html");
          const htmlContent = buildPdfHtml(outline);
          await writeFile(htmlPath, htmlContent, "utf8");
          await writePdfFromHtmlArtifact(htmlPath, absTarget);
        } else {
          await invokeDocumentRenderer({ kind, targetPath: absTarget, outline });
        }
        const previewPath = await writeDocumentPreviewSidecar({ kind, targetPath: absTarget, outline });
        return createActionResult({
          success: true,
          observation: `edit_file updated ${path.basename(absTarget)} in place.`,
          metadata: {
            tool_id: "edit_file",
            path: absTarget,
            kind,
            mime_type: KIND_MIMES[kind] ?? null,
            preview_html_path: previewPath
          },
          artifactPaths: [absTarget]
        });
      }

      const rawContent = typeof args.content === "string" ? args.content
        : typeof args.text === "string" ? args.text
          : "";
      if (!rawContent) {
        return createActionResult({
          success: false,
          observation: `edit_file rejected: ${ext || "text"} edits require replacement content in content/text.`,
          metadata: { tool_id: "edit_file", path: absTarget }
        });
      }
      const buffer = decodeWriteFileContent({
        content: rawContent,
        encoding: args.encoding
      });
      await writeFile(absTarget, buffer);
      return createActionResult({
        success: true,
        observation: `edit_file updated ${path.basename(absTarget)} in place.`,
        metadata: {
          tool_id: "edit_file",
          path: absTarget,
          bytes: buffer.length,
          kind: kind || artifactKindFromTarget(absTarget) || "text"
        },
        artifactPaths: [absTarget]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `edit_file failed: ${error.message}`,
        metadata: { tool_id: "edit_file", attempted_path: targetArg }
      });
    }
  }
};

/* ------------------------------------------------------------------------ */
/* PDF HTML builder (with Mermaid support)                                   */
/* ------------------------------------------------------------------------ */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Convert a structured outline (same shape as docx) to a styled HTML document
 * suitable for printing to PDF via headless Chrome.
 * Mermaid code blocks in body text are automatically rendered via mermaid.js.
 */
function buildPdfHtml(outline) {
  const title    = outline.title    ?? "Document";
  const subtitle = outline.subtitle ?? "";
  const author   = outline.author   ?? "";
  const date     = outline.date     ?? "";

  const sections = Array.isArray(outline.sections) ? outline.sections
    : Array.isArray(outline.slides)                ? outline.slides
    : [];

  const bodyLines = [];

  if (title) {
    bodyLines.push(`<h1 class="doc-title">${escapeHtml(title)}</h1>`);
  }
  if (subtitle) {
    bodyLines.push(`<p class="doc-subtitle">${escapeHtml(subtitle)}</p>`);
  }
  const meta = [author, date].filter(Boolean).join("   ·   ");
  if (meta) {
    bodyLines.push(`<p class="doc-meta">${escapeHtml(meta)}</p>`);
  }
  if (title) {
    bodyLines.push(`<hr class="title-rule">`);
  }

  for (const sec of sections) {
    const heading = sec.heading ?? sec.title;
    if (heading) {
      const tag = sec.level === 2 ? "h3" : "h2";
      bodyLines.push(`<${tag}>${escapeHtml(heading)}</${tag}>`);
    }

    if (sec.body) {
      bodyLines.push(renderBodyWithMermaid(String(sec.body)));
    }

    if (Array.isArray(sec.bullets) && sec.bullets.length > 0) {
      bodyLines.push("<ul>");
      for (const b of sec.bullets) {
        bodyLines.push(`  <li>${escapeHtml(String(b))}</li>`);
      }
      bodyLines.push("</ul>");
    }

    if (sec.table && Array.isArray(sec.table.rows)) {
      bodyLines.push(renderHtmlTable(sec.table));
    }
  }

  // Plain body fallback
  if (outline.body && sections.length === 0) {
    bodyLines.push(renderBodyWithMermaid(String(outline.body)));
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Microsoft YaHei", Calibri, Arial, sans-serif;
    font-size: 11pt; line-height: 1.65; color: #374151;
    max-width: 760px; margin: 0 auto; padding: 40px 48px;
    background: #fff;
  }
  h1.doc-title  { font-size: 26pt; font-weight: 700; color: #1E293B; margin: 0 0 6px; }
  p.doc-subtitle{ font-size: 14pt; color: #64748B; margin: 0 0 4px; }
  p.doc-meta    { font-size: 9pt;  color: #94A3B8; margin: 0 0 12px; }
  hr.title-rule { border: none; border-top: 2px solid #2563EB; margin: 16px 0 28px; }
  h2 { font-size: 16pt; font-weight: 700; color: #1E293B;
       border-bottom: 1px solid #E2E8F0; padding-bottom: 4px;
       margin: 32px 0 10px; }
  h3 { font-size: 13pt; font-weight: 600; color: #374151; margin: 24px 0 8px; }
  p  { margin: 0 0 10px; }
  ul, ol { margin: 6px 0 12px 24px; padding: 0; }
  li { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 20px; font-size: 10pt; }
  thead tr { background: #1E293B; color: #fff; }
  thead th { padding: 7px 10px; text-align: left; font-weight: 600; }
  tbody tr:nth-child(even) { background: #F8FAFC; }
  tbody td { padding: 6px 10px; border: 1px solid #E2E8F0; vertical-align: top; }
  .mermaid { margin: 16px 0; text-align: center; }
  pre.mermaid-fallback {
    background: #F1F5F9; border: 1px solid #E2E8F0;
    padding: 12px; border-radius: 4px; font-size: 9pt;
    white-space: pre-wrap; color: #475569; margin: 12px 0;
  }
  @media print {
    body { padding: 0; max-width: none; }
    h2 { page-break-after: avoid; }
  }
</style>
</head>
<body>
${bodyLines.join("\n")}
<script>
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
  } else {
    document.querySelectorAll(".mermaid").forEach(el => {
      const pre = document.createElement("pre");
      pre.className = "mermaid-fallback";
      pre.textContent = el.textContent;
      el.replaceWith(pre);
    });
  }
</script>
</body>
</html>`;
}

/** Wrap ```mermaid...``` blocks; escape everything else. */
function renderBodyWithMermaid(text) {
  const parts = text.split(/(```mermaid[\s\S]*?```)/g);
  return parts.map(part => {
    const m = part.match(/^```mermaid\n?([\s\S]*?)```$/);
    if (m) {
      return `<div class="mermaid">${escapeHtml(m[1].trim())}</div>`;
    }
    // Regular text: split by double newline → paragraphs
    return part.split(/\n\n+/).map(p => {
      const t = p.replace(/\n/g, " ").trim();
      return t ? `<p>${escapeHtml(t)}</p>` : "";
    }).filter(Boolean).join("\n");
  }).join("\n");
}

function renderHtmlTable(table) {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rows    = Array.isArray(table.rows)    ? table.rows    : [];
  const lines   = ["<table>"];
  if (headers.length) {
    lines.push("  <thead><tr>");
    for (const h of headers) lines.push(`    <th>${escapeHtml(String(h ?? ""))}</th>`);
    lines.push("  </tr></thead>");
  }
  lines.push("  <tbody>");
  for (const row of rows) {
    lines.push("  <tr>");
    const cells = Array.isArray(row) ? row : [row];
    for (const c of cells) lines.push(`    <td>${escapeHtml(String(c ?? ""))}</td>`);
    lines.push("  </tr>");
  }
  lines.push("  </tbody></table>");
  return lines.join("\n");
}

/* ------------------------------------------------------------------------ */
/* RENDER_DIAGRAM_TOOL — Mermaid diagrams to standalone HTML                 */
/* ------------------------------------------------------------------------ */

export const RENDER_DIAGRAM_TOOL = {
  id: "render_diagram",
  name: "Render Diagram",
  description: `Render a Mermaid diagram to a standalone interactive HTML file.
Use for any chart or diagram in reports: flowchart, sequenceDiagram, pie, xychart-beta (bar/line), gantt, mindmap, timeline, etc.
The output HTML can be opened in any browser or embedded in a PDF via generate_document.

Example code:
  pie title Browser Share
    "Chrome" : 65
    "Firefox" : 20
    "Other" : 15`,
  parameters: ACTION_TOOL_SCHEMAS.render_diagram,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const code     = String(args.code ?? "").trim();
    const filename = typeof args.filename === "string" && args.filename.trim()
      ? args.filename.trim().replace(/\.(html|svg|png)$/i, "") + ".html"
      : "diagram.html";
    if (!code) {
      return createActionResult({
        success: false,
        observation: "render_diagram: no Mermaid code provided.",
        metadata: { tool_id: "render_diagram" }
      });
    }
    try {
      const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
      const htmlPath  = await resolveSandboxedTarget(outputDir, filename);
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagram</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
  body { margin: 0; padding: 24px; background: #fff; font-family: system-ui, sans-serif; }
  .mermaid { max-width: 100%; }
</style>
</head>
<body>
<div class="mermaid">
${escapeHtml(code)}
</div>
<script>
  mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
</script>
</body>
</html>`;
      await writeFile(htmlPath, html, "utf8");
      return createActionResult({
        success: true,
        observation: `render_diagram produced ${path.relative(outputDir, htmlPath) || path.basename(htmlPath)}`,
        metadata: { tool_id: "render_diagram", path: htmlPath, mime_type: "text/html" },
        artifactPaths: [htmlPath]
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `render_diagram failed: ${error.message}`,
        metadata: { tool_id: "render_diagram" }
      });
    }
  }
};

/* ------------------------------------------------------------------------ */
/* UCA-053: File Discovery & Artifact Verification tools                     */
/* ------------------------------------------------------------------------ */

// Resolve the default output directory from ctx (runtime config or fallback)
function resolveDefaultOutputDir(ctx) {
  const configuredDir = ctx?.runtime?.configStore?.load?.()?.output?.defaultDir;
  if (configuredDir && typeof configuredDir === "string" && configuredDir.trim()) return configuredDir.trim();
  return ctx?.outputDir ?? path.join(os.homedir(), "Documents", "UCA");
}

// The artifact manifest lives at <defaultOutputDir>/.uca-manifest.json
async function readManifest(outputDir) {
  const manifestPath = path.join(outputDir, ".uca-manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeManifest(outputDir, entries) {
  const manifestPath = path.join(outputDir, ".uca-manifest.json");
  await mkdir(outputDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

// Simple glob-to-regex converter (supports * and ** only).
// `**/foo` should match both `foo` in the base dir and `a/b/foo` deeper down,
// so we treat a leading `**/` as an optional recursive prefix instead of a
// mandatory path segment. This keeps agent-loop file enumeration prompts from
// exploding on common patterns like `**/*6236605264*`.
function globToRegex(pattern) {
  const normalized = String(pattern ?? "").replace(/\\/g, "/");
  const braceGroups = [];
  const withBraceTokens = normalized.replace(/\{([^{}]+)\}/g, (_match, body) => {
    const alternatives = String(body).split(",").map((item) => item.trim()).filter(Boolean);
    if (alternatives.length === 0) return "";
    const index = braceGroups.push(alternatives) - 1;
    return `__BRACE_${index}__`;
  });
  const escaped = withBraceTokens.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let converted = escaped
    .replace(/\*\*\//g, "__GLOBSTAR_DIR__")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/__GLOBSTAR_DIR__/g, "(?:.*[/\\\\])?")
    .replace(/__GLOBSTAR__/g, ".*");
  for (const [index, alternatives] of braceGroups.entries()) {
    const escapedAlternatives = alternatives.map((item) => item.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
    converted = converted.replace(
      new RegExp(`__BRACE_${index}__`, "g"),
      `(?:${escapedAlternatives.join("|")})`
    );
  }
  return new RegExp(`^${converted}$`, "i");
}

const FILE_KIND_EXTS = {
  pptx: [".pptx"],
  docx: [".docx"],
  xlsx: [".xlsx"],
  pdf: [".pdf"],
  txt: [".txt"],
  md: [".md"],
  csv: [".csv"],
  html: [".html", ".htm"]
};

export const LIST_FILES_TOOL = {
  id: "list_files",
  name: "List Files",
  description: "List files in a directory, optionally filtered by glob pattern (e.g. *.pptx).",
  parameters: ACTION_TOOL_SCHEMAS.list_files,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const dir = args.dir
      ? path.resolve(args.dir.replace(/^~/, os.homedir()))
      : resolveDefaultOutputDir(ctx);
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
    const patternRegex = args.pattern ? globToRegex(args.pattern) : null;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .filter((e) => !patternRegex || patternRegex.test(e.name))
        .slice(0, limit)
        .map((e) => path.join(dir, e.name));
      return createActionResult({
        success: true,
        observation: files.length > 0
          ? `Found ${files.length} file(s) in ${dir}:\n${files.join("\n")}`
          : `No files found in ${dir}${args.pattern ? ` matching "${args.pattern}"` : ""}`,
        metadata: { tool_id: "list_files", dir, files }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `list_files failed: ${error.message}`,
        metadata: { tool_id: "list_files", dir }
      });
    }
  }
};

export const GLOB_FILES_TOOL = {
  id: "glob_files",
  name: "Glob Files",
  description: "Search for files matching a glob pattern (supports * and **). E.g. ~/Documents/**/*.pptx",
  parameters: ACTION_TOOL_SCHEMAS.glob_files,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}) {
    const pattern = String(args.pattern ?? "").replace(/^~/, os.homedir());
    if (!pattern) return createActionResult({ success: false, observation: "pattern required" });
    // Split into base dir and file pattern
    const parts = pattern.replace(/\\/g, "/").split("/");
    let baseIdx = parts.findIndex((p) => p.includes("*"));
    if (baseIdx < 0) baseIdx = parts.length - 1;
    const baseDir = path.resolve(parts.slice(0, baseIdx).join("/") || ".");
    const filePattern = parts.slice(baseIdx).join("/");
    const patternRegex = globToRegex(filePattern);

    async function walk(dir, depth = 0) {
      if (depth > 10) return [];
      const results = [];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
          if (entry.isFile() && patternRegex.test(relPath)) {
            results.push(fullPath);
          } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
            results.push(...await walk(fullPath, depth + 1));
          }
        }
      } catch { /* skip inaccessible dirs */ }
      return results;
    }

    try {
      const files = (await walk(baseDir)).slice(0, 50);
      return createActionResult({
        success: true,
        observation: files.length > 0
          ? `Found ${files.length} file(s) matching "${args.pattern}":\n${files.join("\n")}`
          : `No files found matching "${args.pattern}"`,
        metadata: { tool_id: "glob_files", pattern, files }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `glob_files failed: ${error.message}`
      });
    }
  }
};

export const FIND_RECENT_FILES_TOOL = {
  id: "find_recent_files",
  name: "Find Recent Files",
  description: "Find the most recently modified files of a given type (pptx, docx, xlsx, pdf, txt, md).",
  parameters: ACTION_TOOL_SCHEMAS.find_recent_files,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase();
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
    const sinceHours = Number(args.since_hours) || 24;
    const sinceMs = Date.now() - sinceHours * 3600 * 1000;
    const exts = FILE_KIND_EXTS[kind] ?? Object.values(FILE_KIND_EXTS).flat();
    const searchDir = resolveDefaultOutputDir(ctx);

    async function walk(dir, depth = 0) {
      if (depth > 6) return [];
      const results = [];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && exts.includes(path.extname(entry.name).toLowerCase())) {
            try {
              const info = await stat(fullPath);
              if (info.mtimeMs >= sinceMs) {
                results.push({ path: fullPath, mtime: info.mtimeMs, size: info.size });
              }
            } catch { /* skip */ }
          } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
            results.push(...await walk(fullPath, depth + 1));
          }
        }
      } catch { /* skip */ }
      return results;
    }

    try {
      const found = (await walk(searchDir))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);
      if (found.length === 0) {
        return createActionResult({
          success: true,
          observation: `No ${kind || "any"} files found in the last ${sinceHours}h under ${searchDir}`,
          metadata: { tool_id: "find_recent_files", files: [] }
        });
      }
      const lines = found.map((f) => `${f.path} (${Math.round(f.size / 1024)}KB, ${new Date(f.mtime).toLocaleString()})`);
      return createActionResult({
        success: true,
        observation: `Found ${found.length} recent ${kind || "any"} file(s):\n${lines.join("\n")}`,
        metadata: { tool_id: "find_recent_files", files: found.map((f) => f.path) }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `find_recent_files failed: ${error.message}`
      });
    }
  }
};

export const GET_LATEST_ARTIFACT_TOOL = {
  id: "get_latest_artifact",
  name: "Get Latest Artifact",
  description: "Get the latest artifact of a given kind from the UCA artifact manifest.",
  parameters: ACTION_TOOL_SCHEMAS.get_latest_artifact,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const kind = String(args.kind ?? "").toLowerCase() || null;
    const outputDir = resolveDefaultOutputDir(ctx);
    try {
      const manifest = await readManifest(outputDir);
      let entries = manifest;
      if (kind && kind !== "any") {
        entries = manifest.filter((e) => e.kind === kind);
      }
      if (args.task_id) {
        entries = entries.filter((e) => e.task_id === args.task_id);
      }
      entries = entries.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      const latest = entries[0];
      if (!latest) {
        return createActionResult({
          success: false,
          observation: `No ${kind ?? "any"} artifact found in manifest${args.task_id ? ` for task ${args.task_id}` : ""}`,
          metadata: { tool_id: "get_latest_artifact" }
        });
      }
      return createActionResult({
        success: true,
        observation: `Latest ${latest.kind} artifact: ${latest.path} (created ${latest.created_at})`,
        metadata: { tool_id: "get_latest_artifact", artifact: latest }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `get_latest_artifact failed: ${error.message}`
      });
    }
  }
};

export const STAT_FILE_TOOL = {
  id: "stat_file",
  name: "Stat File",
  description: "Check a file's existence, size, and modification time.",
  parameters: ACTION_TOOL_SCHEMAS.stat_file,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}) {
    const filePath = args.path ? path.resolve(args.path.replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    try {
      const info = await stat(filePath);
      return createActionResult({
        success: true,
        observation: `File ${filePath}: size=${info.size}B, modified=${info.mtime.toISOString()}`,
        metadata: {
          tool_id: "stat_file",
          path: filePath,
          size: info.size,
          mtime: info.mtime.toISOString(),
          isFile: info.isFile()
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: error.code === "ENOENT" ? `File not found: ${filePath}` : `stat_file failed: ${error.message}`,
        metadata: { tool_id: "stat_file", path: filePath, exists: false }
      });
    }
  }
};

export const VERIFY_FILE_EXISTS_TOOL = {
  id: "verify_file_exists",
  name: "Verify File Exists",
  description: "Assert that a file exists and has non-zero size. Required before claiming a document was successfully generated.",
  parameters: ACTION_TOOL_SCHEMAS.verify_file_exists,
  risk_level: "low",
  required_capabilities: ["file_read"],
  requires_confirmation: false,
  async execute(args = {}) {
    const filePath = args.path ? path.resolve(args.path.replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    try {
      const info = await stat(filePath);
      const exists = info.isFile() && info.size > 0;
      return createActionResult({
        success: exists,
        observation: exists
          ? `File verified: ${filePath} exists (${info.size} bytes)`
          : `File is empty or not a regular file: ${filePath}`,
        metadata: { tool_id: "verify_file_exists", path: filePath, exists, size: info.size }
      });
    } catch {
      return createActionResult({
        success: false,
        observation: `File does not exist: ${filePath}`,
        metadata: { tool_id: "verify_file_exists", path: filePath, exists: false }
      });
    }
  }
};

export const REGISTER_ARTIFACT_TOOL = {
  id: "register_artifact",
  name: "Register Artifact",
  description: "Register a generated file into the UCA artifact manifest so it can be found later.",
  parameters: ACTION_TOOL_SCHEMAS.register_artifact,
  risk_level: "low",
  required_capabilities: ["file_write"],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const filePath = args.path ? path.resolve(args.path.replace(/^~/, os.homedir())) : "";
    if (!filePath) return createActionResult({ success: false, observation: "path required" });
    const kind = String(args.kind ?? path.extname(filePath).slice(1) ?? "unknown");
    const outputDir = resolveDefaultOutputDir(ctx);
    try {
      const info = await stat(filePath);
      const manifest = await readManifest(outputDir);
      // avoid duplicate registration
      const alreadyRegistered = manifest.some((e) => e.path === filePath);
      if (!alreadyRegistered) {
        manifest.push({
          path: filePath,
          kind,
          task_id: args.task_id ?? ctx?.task?.task_id ?? null,
          size: info.size,
          created_at: new Date().toISOString()
        });
        await writeManifest(outputDir, manifest);
      }
      return createActionResult({
        success: true,
        observation: `Registered ${kind} artifact: ${filePath}${alreadyRegistered ? " (already registered)" : ""}`,
        metadata: { tool_id: "register_artifact", path: filePath, kind }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `register_artifact failed: ${error.message}`,
        metadata: { tool_id: "register_artifact", path: filePath }
      });
    }
  }
};

export const RESOLVE_OUTPUT_PATH_TOOL = {
  id: "resolve_output_path",
  name: "Resolve Output Path",
  description: "Resolve a filename to the full path in the UCA default output directory (from Settings).",
  parameters: ACTION_TOOL_SCHEMAS.resolve_output_path,
  risk_level: "low",
  required_capabilities: [],
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const filename = String(args.filename ?? "").trim();
    if (!filename) return createActionResult({ success: false, observation: "filename required" });
    const outputDir = resolveDefaultOutputDir(ctx);
    const resolved = path.join(outputDir, filename);
    await mkdir(outputDir, { recursive: true });
    return createActionResult({
      success: true,
      observation: `Resolved output path: ${resolved}`,
      metadata: { tool_id: "resolve_output_path", path: resolved, outputDir }
    });
  }
};

// ── UCA-076: GUI Automation (Windows UIAutomation via PowerShell) ──────────────

/**
 * Build a PowerShell snippet that loads Windows UIAutomation and returns the
 * first UI element matching the supplied criteria as a JSON object with
 * properties: Found, Name, AutomationId, ControlType, BoundingLeft,
 * BoundingTop, BoundingWidth, BoundingHeight.
 */
function buildGuiFindScript({ window_title, automation_id, element_name, control_type }) {
  // We use [System.Windows.Automation] which ships with every modern Windows.
  const lines = [
    `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes`,
    `$root = [System.Windows.Automation.AutomationElement]::RootElement`,
    `$scope = [System.Windows.Automation.TreeScope]::Descendants`,
    `$conds = [System.Collections.Generic.List[System.Windows.Automation.Condition]]::new()`
  ];

  if (window_title) {
    lines.push(
      `$winCond = New-Object System.Windows.Automation.PropertyCondition(`,
      `  [System.Windows.Automation.AutomationElement]::NameProperty,`,
      `  ${JSON.stringify(window_title)},`,
      `  [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase`,
      `)`,
      // First narrow to the window
      `$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)`,
      `if ($wins.Count -gt 0) { $root = $wins[0] }`
    );
  }

  if (automation_id) {
    lines.push(
      `$conds.Add((New-Object System.Windows.Automation.PropertyCondition(`,
      `  [System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${JSON.stringify(automation_id)})))`
    );
  }
  if (element_name) {
    lines.push(
      `$conds.Add((New-Object System.Windows.Automation.PropertyCondition(`,
      `  [System.Windows.Automation.AutomationElement]::NameProperty, ${JSON.stringify(element_name)},`,
      `  [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)))`
    );
  }
  if (control_type) {
    const ctMap = {
      button: "Button", edit: "Edit", text: "Text", checkbox: "CheckBox",
      combobox: "ComboBox", listitem: "ListItem", tab: "TabItem",
      menu: "MenuItem", image: "Image", link: "Hyperlink"
    };
    const ct = ctMap[(control_type || "").toLowerCase()] ?? control_type;
    lines.push(
      `$ctField = [System.Windows.Automation.ControlType]::${ct}`,
      `$conds.Add((New-Object System.Windows.Automation.PropertyCondition(`,
      `  [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctField)))`
    );
  }

  lines.push(
    `if ($conds.Count -eq 0) {`,
    `  @{ Found = $false; Error = "No search criteria" } | ConvertTo-Json -Compress; exit 0`,
    `}`,
    `$cond = if ($conds.Count -eq 1) { $conds[0] } else {`,
    `  New-Object System.Windows.Automation.AndCondition($conds.ToArray()) }`,
    `$el = $root.FindFirst($scope, $cond)`,
    `if (-not $el) {`,
    `  @{ Found = $false } | ConvertTo-Json -Compress; exit 0`,
    `}`,
    `$r = $el.Current.BoundingRectangle`,
    `@{`,
    `  Found         = $true`,
    `  Name          = $el.Current.Name`,
    `  AutomationId  = $el.Current.AutomationId`,
    `  ControlType   = $el.Current.ControlType.ProgrammaticName`,
    `  BoundingLeft  = [int]$r.Left`,
    `  BoundingTop   = [int]$r.Top`,
    `  BoundingWidth = [int]$r.Width`,
    `  BoundingHeight= [int]$r.Height`,
    `  CenterX       = [int]($r.Left + $r.Width  / 2)`,
    `  CenterY       = [int]($r.Top  + $r.Height / 2)`,
    `} | ConvertTo-Json -Compress`
  );

  return lines.join("\n");
}

async function runGuiPsScript(psScript, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const ps = spawn("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript
    ], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (d) => { stdout += d; });
    ps.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => {
      try { ps.kill(); } catch { /* ignore */ }
      resolve({ ok: false, error: "timeout", stdout, stderr });
    }, timeoutMs);
    ps.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    ps.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout, stderr });
    });
  });
}

export const GUI_FIND_ELEMENT_TOOL = {
  id: "gui_find_element",
  name: "GUI Find Element",
  description: "Find a UI element in an open window using Windows UIAutomation. Returns position (BoundingLeft/Top/Width/Height/CenterX/CenterY), Name, AutomationId, ControlType. Only works on Windows.",
  parameters: ACTION_TOOL_SCHEMAS.gui_find_element,
  risk_level: "low",
  required_capabilities: ["gui_automation"],
  requires_confirmation: false,
  async execute(args = {}, _ctx = {}) {
    if (process.platform !== "win32") {
      return createActionResult({ success: false, observation: "gui_find_element is only supported on Windows." });
    }
    const { window_title, automation_id, element_name, control_type } = args;
    if (!automation_id && !element_name && !control_type) {
      return createActionResult({ success: false, observation: "gui_find_element requires at least one of: automation_id, element_name, control_type." });
    }
    const script = buildGuiFindScript({ window_title, automation_id, element_name, control_type });
    const result = await runGuiPsScript(script);
    if (!result.ok && result.error) {
      return createActionResult({ success: false, observation: `gui_find_element failed: ${result.error}\n${result.stderr}` });
    }
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch { /* ignore */ }
    if (!parsed) {
      return createActionResult({ success: false, observation: `gui_find_element: could not parse result.\nstdout: ${result.stdout}\nstderr: ${result.stderr}` });
    }
    if (!parsed.Found) {
      return createActionResult({ success: false, observation: `gui_find_element: no element matched the criteria.` });
    }
    return createActionResult({
      success: true,
      observation: `Found element "${parsed.Name}" (${parsed.ControlType}) at center (${parsed.CenterX}, ${parsed.CenterY}).`,
      metadata: { tool_id: "gui_find_element", ...parsed }
    });
  }
};

export const GUI_CLICK_TOOL = {
  id: "gui_click",
  name: "GUI Click",
  description: "Click a UI element or screen position using Windows UIAutomation. Provide element search criteria (window_title, automation_id, element_name, control_type) OR absolute coordinates (x, y). Each invocation requires user confirmation.",
  parameters: ACTION_TOOL_SCHEMAS.gui_click,
  risk_level: "high",
  required_capabilities: ["gui_automation"],
  requires_confirmation: true,
  async execute(args = {}, _ctx = {}) {
    if (process.platform !== "win32") {
      return createActionResult({ success: false, observation: "gui_click is only supported on Windows." });
    }

    let clickX = typeof args.x === "number" ? args.x : null;
    let clickY = typeof args.y === "number" ? args.y : null;
    let elementInfo = null;

    // If coordinates not given, find element first
    if (clickX === null || clickY === null) {
      const { window_title, automation_id, element_name, control_type } = args;
      if (!automation_id && !element_name && !control_type) {
        return createActionResult({ success: false, observation: "gui_click requires either (x, y) coordinates or element search criteria (automation_id / element_name / control_type)." });
      }
      const findScript = buildGuiFindScript({ window_title, automation_id, element_name, control_type });
      const findResult = await runGuiPsScript(findScript);
      let parsed = null;
      try { parsed = JSON.parse(findResult.stdout); } catch { /* ignore */ }
      if (!parsed?.Found) {
        return createActionResult({ success: false, observation: `gui_click: element not found.\n${findResult.stderr || findResult.stdout}` });
      }
      clickX = parsed.CenterX;
      clickY = parsed.CenterY;
      elementInfo = parsed;
    }

    // Use Win32 mouse_event via PowerShell to click
    const clickScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseHelper {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP   = 0x04;
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(80);
    mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(50);
    mouse_event(MOUSEEVENTF_LEFTUP,   x, y, 0, IntPtr.Zero);
  }
}
"@
[MouseHelper]::Click(${clickX}, ${clickY})
Write-Output '{"ok":true}'
`;
    const clickResult = await runGuiPsScript(clickScript);
    if (!clickResult.ok && clickResult.error) {
      return createActionResult({ success: false, observation: `gui_click failed: ${clickResult.error}\n${clickResult.stderr}` });
    }
    const desc = elementInfo
      ? `"${elementInfo.Name}" (${elementInfo.ControlType})`
      : `coordinates (${clickX}, ${clickY})`;
    return createActionResult({
      success: true,
      observation: `Clicked ${desc}.`,
      metadata: { tool_id: "gui_click", x: clickX, y: clickY, element: elementInfo ?? null }
    });
  }
};

export const GUI_TYPE_TEXT_TOOL = {
  id: "gui_type_text",
  name: "GUI Type Text",
  description: "Type text into a focused or target UI element. Optionally finds the element first using search criteria. Optionally presses Enter after typing. Each invocation requires user confirmation.",
  parameters: ACTION_TOOL_SCHEMAS.gui_type_text,
  risk_level: "high",
  required_capabilities: ["gui_automation"],
  requires_confirmation: true,
  async execute(args = {}, _ctx = {}) {
    if (process.platform !== "win32") {
      return createActionResult({ success: false, observation: "gui_type_text is only supported on Windows." });
    }
    const text = String(args.text ?? "");
    if (!text) {
      return createActionResult({ success: false, observation: "gui_type_text: text is required." });
    }
    const { window_title, automation_id, element_name, press_enter } = args;

    // If element criteria provided, try ValuePattern first (most reliable for Edit controls)
    if (automation_id || element_name) {
      const findScript = buildGuiFindScript({ window_title, automation_id, element_name, control_type: args.control_type });
      const findResult = await runGuiPsScript(findScript);
      let parsed = null;
      try { parsed = JSON.parse(findResult.stdout); } catch { /* ignore */ }
      if (parsed?.Found) {
        // Use ValuePattern.SetValue for Edit controls — avoids clipboard side-effects
        const setValueScript = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$scope = [System.Windows.Automation.TreeScope]::Descendants
${automation_id
    ? `$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${JSON.stringify(automation_id)})`
    : `$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, ${JSON.stringify(element_name)}, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)`
}
$el = $root.FindFirst($scope, $cond)
if (-not $el) { Write-Output '{"ok":false,"reason":"not found"}'; exit 0 }
$vp = $null
try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
if ($vp) {
  $el.SetFocus()
  $vp.SetValue(${JSON.stringify(text)})
  Write-Output '{"ok":true,"method":"ValuePattern"}'
} else {
  $el.SetFocus()
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(text.replace(/[+^%~(){}[\]]/g, "{$&}"))})
  Write-Output '{"ok":true,"method":"SendKeys"}'
}
${press_enter ? `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")` : ""}
`;
        const svResult = await runGuiPsScript(setValueScript);
        let svParsed = null;
        try { svParsed = JSON.parse(svResult.stdout); } catch { /* ignore */ }
        if (svParsed?.ok) {
          return createActionResult({
            success: true,
            observation: `Typed text into element via ${svParsed.method}.${press_enter ? " Pressed Enter." : ""}`,
            metadata: { tool_id: "gui_type_text", method: svParsed.method, press_enter: !!press_enter }
          });
        }
      }
    }

    // Fallback: SendKeys to currently focused window
    const pressEnterStr = press_enter ? `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")` : "";
    // Escape SendKeys special chars: + ^ % ~ ( ) { } [ ]
    const escaped = text.replace(/[+^%~(){}[\]]/g, "{$&}");
    const sendScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(escaped)})
${pressEnterStr}
Write-Output '{"ok":true,"method":"SendKeys-focused"}'
`;
    const sendResult = await runGuiPsScript(sendScript);
    if (!sendResult.ok && sendResult.error) {
      return createActionResult({ success: false, observation: `gui_type_text failed: ${sendResult.error}\n${sendResult.stderr}` });
    }
    return createActionResult({
      success: true,
      observation: `Typed text via SendKeys to focused window.${press_enter ? " Pressed Enter." : ""}`,
      metadata: { tool_id: "gui_type_text", method: "SendKeys-focused", press_enter: !!press_enter }
    });
  }
};

export const BUILTIN_ACTION_TOOLS = Object.freeze([
  OPEN_URL_TOOL,
  WEB_SEARCH_TOOL,
  COMPOSE_EMAIL_TOOL,
  SEND_EMAIL_SMTP_TOOL,
  OPEN_FILE_TOOL,
  REVEAL_IN_EXPLORER_TOOL,
  LAUNCH_APP_TOOL,
  COPY_TO_CLIPBOARD_TOOL,
  NOTIFY_TOOL,
  FILE_OP_TOOL,
  TAKE_SCREENSHOT_TOOL,
  READ_CLIPBOARD_TOOL,
  CREATE_SCHEDULED_TASK_TOOL,
  LIST_SCHEDULED_TASKS_TOOL,
  DELETE_SCHEDULED_TASK_TOOL,
  PAUSE_SCHEDULED_TASK_TOOL,
  TRANSLATE_TEXT_TOOL,
  WEB_SEARCH_FETCH_TOOL,
  FETCH_URL_CONTENT_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  GENERATE_DOCUMENT_TOOL,
  RENDER_DIAGRAM_TOOL,
  // UCA-053: File Discovery & Artifact Verification
  LIST_FILES_TOOL,
  GLOB_FILES_TOOL,
  FIND_RECENT_FILES_TOOL,
  GET_LATEST_ARTIFACT_TOOL,
  STAT_FILE_TOOL,
  VERIFY_FILE_EXISTS_TOOL,
  REGISTER_ARTIFACT_TOOL,
  RESOLVE_OUTPUT_PATH_TOOL,
  // UCA-076: GUI Automation
  GUI_FIND_ELEMENT_TOOL,
  GUI_CLICK_TOOL,
  GUI_TYPE_TEXT_TOOL,
  // UCA-182 Phase 21: memory introspection tools so the planner can
  // ask for prior-task context on its own, replacing the earlier
  // submit-time digest injection.
  ...MEMORY_TOOLS,
  // Connector catalog + provider account tools (single aggregation point)
  ...CONNECTOR_ACTION_TOOLS
]);
