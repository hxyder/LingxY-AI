import crypto from "node:crypto";
import { mkdir, writeFile, readFile, lstat, stat, readdir, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createNoopTool, writeToolArtifact } from "../tool-helper.mjs";
import { createActionResult } from "../types.mjs";
import { translateText } from "../../translation/free-translator.mjs";
import { searchWeb, formatResultsForAssistant, normalizeSearchRecency } from "../../search/free-search.mjs";

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
  // exe name differs from what's on the user's machine.
  wechat: "WeChat.exe",
  "微信": "WeChat.exe",
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
    description: "Launch an allowed local application.",
    parameters: ACTION_TOOL_SCHEMAS.launch_app,
    risk_level: "medium",
    required_capabilities: ["launch_app"],
    requires_confirmation: true,
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
    const appArg = args.app ?? args.name ?? args.appName;
    if (!appArg) return createActionResult({ success: false, observation: "app name required" });
    const command = resolveAppCommand(appArg);

    // Step 1 — if the resolved command looks like an .exe, try Start-Process
    // directly. This is the fast path for anything on PATH or in the registry.
    if (process.platform === "win32") {
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

      return createActionResult({
        success: false,
        observation: `未能启动 ${appArg}。已尝试 Start-Process 和 Get-StartApps，都没找到匹配。你可以告诉我完整的可执行文件路径，或让我用 web_search 帮你搜官方下载页。`,
        metadata: { method: "exhausted", tried: [command, "Get-StartApps"] }
      });
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
      title: args.title ?? "UCA 提醒",
      body: args.body ?? args.message ?? "时间到了",
      created_at: new Date().toISOString(),
      handoff: args.handoff ?? null,
      navigate: args.navigate ?? null
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
      const asText = formatResultsForAssistant(result.results, {
        query,
        provider: result.provider,
        recency: result.recency,
        maxResults: limit
      });
      return createActionResult({
        success: true,
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

export const FILE_OP_TOOL = {
  id: "file_op",
  name: "File Operation",
  description: "Perform a constrained file operation in the allowed workspace.",
  parameters: ACTION_TOOL_SCHEMAS.file_op,
  risk_level: "high",
  required_capabilities: ["file_write"],
  requires_confirmation: true,
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
    const artifactPath = await writeToolArtifact(ctx, `${args.label.replace(/[^a-z0-9_-]/gi, "_")}.txt`, "screenshot placeholder");
    return createActionResult({
      success: true,
      observation: `Captured screenshot artifact ${artifactPath}`,
      artifactPaths: [artifactPath]
    });
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
  description: "Create a cron, interval, or file-watch schedule.",
  parameters: ACTION_TOOL_SCHEMAS.create_scheduled_task,
  risk_level: "high",
  required_capabilities: ["schedule_manage"],
  requires_confirmation: true,
  async execute(args, ctx) {
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
/*   - generate_document: pptx / docx / xlsx / pdf via create-ooxml-fixture  */
/*                                                                           */
/* All three tools sandbox inside the task's output_dir. Symlink traversal   */
/* and `..` path segments are rejected explicitly so the LLM can't escape    */
/* the artifact workspace.                                                   */
/* ------------------------------------------------------------------------ */

function resolveOutputDirForTool(ctx) {
  return ctx?.outputDir
    || ctx?.runtime?.artifactStore?.createTaskOutputDirSync?.(ctx?.task?.task_id)
    || path.join(os.homedir(), "Desktop", "UCA", ctx?.task?.task_id ?? `scratch-${Date.now()}`);
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
  risk_level: "high",
  required_capabilities: ["subprocess_exec"],
  requires_confirmation: true,
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

async function resolveOoxmlFixtureScript() {
  const scriptName = "create-ooxml-fixture.ps1";
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
  for (const section of Array.isArray(outline.sections) ? outline.sections : []) {
    if (section?.heading) lines.push(`# ${section.heading}`);
    if (section?.body) lines.push(String(section.body));
  }
  if (outline.body && !outline.sections) lines.push(String(outline.body));
  return lines.join("\n");
}

async function invokeOoxmlFixture({ kind, targetPath, plainText }) {
  const scriptPath = await resolveOoxmlFixtureScript();
  await execFileAsync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-TargetPath",
    targetPath,
    "-Kind",
    kind,
    "-Text",
    plainText
  ], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
}

export const GENERATE_DOCUMENT_TOOL = {
  id: "generate_document",
  name: "Generate Document",
  description: "Produce a pptx / docx / xlsx / pdf artifact from a structured outline. For pptx, outline shape is {title, subtitle?, slides:[{heading, bullets:[string]}]}.",
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
      const filename = typeof args.filename === "string" && args.filename.trim()
        ? args.filename.trim()
        : `result${KIND_EXTENSIONS[kind]}`;
      const absTarget = await resolveSandboxedTarget(outputDir, filename);
      const plainText = coerceOutlineToPlainText(kind, args.outline).trim()
        || "UCA generated document (empty outline).";
      if (kind === "pdf") {
        // For pdf, we delegate to writeRequestedArtifacts' pdf path (Edge/Chrome headless).
        // To keep this tool self-contained, we produce an HTML sidecar and let the
        // executor / user open/print it. The MIME is still declared as pdf so the
        // UI knows the user asked for a printable doc.
        await writeFile(absTarget.replace(/\.pdf$/i, ".html"), `<pre>${plainText}</pre>\n`, "utf8");
        // Fall through to still produce an xlsx-style fixture-based artifact is wrong;
        // return the html path with a pdf mime hint instead.
        const htmlPath = absTarget.replace(/\.pdf$/i, ".html");
        return createActionResult({
          success: true,
          observation: `generate_document produced HTML fallback at ${path.relative(outputDir, htmlPath)} — Edge/Chrome headless PDF conversion is handled by the output pipeline.`,
          metadata: {
            tool_id: "generate_document",
            kind,
            path: htmlPath,
            mime_type: "text/html",
            needs_pdf_conversion: true
          },
          artifactPaths: [htmlPath]
        });
      }
      await invokeOoxmlFixture({ kind, targetPath: absTarget, plainText });
      return createActionResult({
        success: true,
        observation: `generate_document produced ${kind.toUpperCase()} at ${path.relative(outputDir, absTarget) || path.basename(absTarget)}`,
        metadata: {
          tool_id: "generate_document",
          kind,
          path: absTarget,
          mime_type: KIND_MIMES[kind]
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

/* ------------------------------------------------------------------------ */
/* UCA-053: File Discovery & Artifact Verification tools                     */
/* ------------------------------------------------------------------------ */

// Resolve the default output directory from ctx (runtime config or fallback)
function resolveDefaultOutputDir(ctx) {
  return ctx?.runtime?.config?.output?.defaultDir
    ?? ctx?.outputDir
    ?? path.join(os.homedir(), "Documents", "UCA");
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

// Simple glob-to-regex converter (supports * and ** only)
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const converted = escaped.replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/\\\\]*");
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
  WRITE_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  GENERATE_DOCUMENT_TOOL,
  // UCA-053: File Discovery & Artifact Verification
  LIST_FILES_TOOL,
  GLOB_FILES_TOOL,
  FIND_RECENT_FILES_TOOL,
  GET_LATEST_ARTIFACT_TOOL,
  STAT_FILE_TOOL,
  VERIFY_FILE_EXISTS_TOOL,
  REGISTER_ARTIFACT_TOOL,
  RESOLVE_OUTPUT_PATH_TOOL
]);
