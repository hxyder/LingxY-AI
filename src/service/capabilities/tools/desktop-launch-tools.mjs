import crypto from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Friendly app names for the happy path. Unknown Windows names still go
// through the Python launcher and Start menu lookup.
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
  qq: "QQ.exe",
  "钉钉": "DingTalk.exe",
  dingtalk: "DingTalk.exe",
  "腾讯会议": "WeMeetApp.exe",
  wemeet: "WeMeetApp.exe",
  "网易云音乐": "cloudmusic.exe",
  cloudmusic: "cloudmusic.exe",
  spotify: "spotify.exe",
  notion: "notion.exe",
  slack: "slack.exe",
  telegram: "telegram.exe",
  discord: "discord.exe"
};

const LAUNCH_APP_DEFINITION = {
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

function stableLaunchCandidateId(candidate = {}, index = 0) {
  const seed = [
    candidate.app_id,
    candidate.exe_path,
    candidate.display_name,
    index + 1
  ].filter(Boolean).join("\n");
  return crypto.createHash("sha256").update(seed || `candidate:${index + 1}`).digest("hex").slice(0, 12);
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeLaunchCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.map((candidate = {}, index) => {
    const displayName = stringOrEmpty(candidate.display_name)
      || stringOrEmpty(candidate.name)
      || stringOrEmpty(candidate.app_id)
      || stringOrEmpty(candidate.exe_path)
      || `Candidate ${index + 1}`;
    const exePath = stringOrEmpty(candidate.exe_path) || stringOrEmpty(candidate.path);
    const appId = stringOrEmpty(candidate.app_id) || stringOrEmpty(candidate.id);
    const launchTarget = exePath || appId || displayName;
    const normalized = {
      candidate_id: stringOrEmpty(candidate.candidate_id) || stableLaunchCandidateId({
        app_id: appId,
        exe_path: exePath,
        display_name: displayName
      }, index),
      index: index + 1,
      display_name: displayName,
      is_dev_tool: Boolean(candidate.is_dev_tool),
      launch_args: { app: launchTarget }
    };
    if (appId) normalized.app_id = appId;
    if (exePath) normalized.exe_path = exePath;
    const score = numberOrNull(candidate.score);
    if (score !== null) normalized.score = score;
    const reason = stringOrEmpty(candidate.reason);
    if (reason) normalized.reason = reason;
    const useCount = numberOrNull(candidate.use_count);
    if (useCount !== null) normalized.use_count = useCount;
    const lastUsedAt = stringOrEmpty(candidate.last_used_at);
    if (lastUsedAt) normalized.last_used_at = lastUsedAt;
    return normalized;
  });
}

function formatLaunchAmbiguityObservation(appArg, candidates = []) {
  const list = normalizeLaunchCandidates(candidates);
  const allDevTools = list.length > 0 && list.every((candidate) => candidate?.is_dev_tool);
  const choiceList = list
    .map((c) => {
      const target = c.exe_path || c.app_id || c.launch_args?.app || "";
      return `${c.index}. ${c.display_name}${c.is_dev_tool ? "（开发工具）" : ""}${target ? ` — ${target}` : ""}`;
    })
    .join("\n");
  if (allDevTools) {
    return `当前只找到了和 ${appArg} 相关的开发工具，没有找到普通应用。\n如果你要打开普通版 ${appArg}，请告诉我它的可执行文件路径，或先在启动器别名里绑定正确路径。\n${choiceList}`;
  }
  return `${appArg} 有多个可能的匹配，请确认要打开哪一个，或告诉我具体路径：\n${choiceList}`;
}

export function createLaunchAmbiguityResult(appArg, candidates = [], options = {}) {
  const normalized = normalizeLaunchCandidates(candidates);
  const metadata = {
    method: options.method ?? "python_launcher",
    action: "ambiguous",
    disambiguation_required: true,
    disambiguation_type: "launch_app_candidate",
    target_app: String(appArg ?? ""),
    candidate_count: normalized.length,
    candidates: normalized,
    next_tool: "launch_app"
  };
  const decisionReason = options.decision_reason ?? options.decisionReason;
  if (decisionReason) metadata.decision_reason = decisionReason;
  return createActionResult({
    success: false,
    observation: formatLaunchAmbiguityObservation(appArg, normalized),
    metadata
  });
}

let pythonLauncherPathCache = null;
async function findPythonLauncherScript() {
  if (pythonLauncherPathCache !== null) return pythonLauncherPathCache;
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
      pythonLauncherPathCache = candidate;
      return candidate;
    } catch { /* try next */ }
  }
  pythonLauncherPathCache = "";
  return "";
}

async function tryPythonLauncher(appName) {
  const scriptPath = await findPythonLauncherScript();
  if (!scriptPath) throw new Error("python_launcher_script_not_found");
  const { stdout } = await execFileAsync("python", [
    scriptPath, "open", "--name", String(appName), "--json"
  ], {
    encoding: "utf8",
    timeout: 25_000,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
  const line = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error("python_launcher_no_output");
  const parsed = JSON.parse(line);
  if (parsed.ok && parsed.action === "ambiguous") {
    return { ok: false, ambiguous: true, candidates: parsed.candidates ?? [], decision_reason: parsed.decision_reason };
  }
  return parsed;
}

async function resolveAppViaStartMenu(appName) {
  if (process.platform !== "win32" || !appName) return null;
  const needle = `${appName}`.trim();
  if (!needle) return null;
  try {
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

export const LAUNCH_APP_TOOL = {
  ...LAUNCH_APP_DEFINITION,
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
            return createLaunchAmbiguityResult(appArg, pyResult.candidates ?? [], {
              method: "python_launcher",
              decision_reason: pyResult.decision_reason
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
        // Fall through to Get-StartApps lookup.
      }

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
          return createLaunchAmbiguityResult(appArg, pyResult.candidates ?? [], {
            method: "python_launcher",
            decision_reason: pyResult.decision_reason
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
