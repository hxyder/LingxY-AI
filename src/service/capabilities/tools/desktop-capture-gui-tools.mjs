import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { ensureOutputDir, resolveOutputDirForTool } from "../../core/artifact-path-helper.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Build a PowerShell snippet that loads Windows UIAutomation and returns the
 * first UI element matching the supplied criteria as a JSON object with
 * properties: Found, Name, AutomationId, ControlType, BoundingLeft,
 * BoundingTop, BoundingWidth, BoundingHeight.
 */
function buildGuiFindScript({ window_title, automation_id, element_name, control_type }) {
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

    if (automation_id || element_name) {
      const findScript = buildGuiFindScript({ window_title, automation_id, element_name, control_type: args.control_type });
      const findResult = await runGuiPsScript(findScript);
      let parsed = null;
      try { parsed = JSON.parse(findResult.stdout); } catch { /* ignore */ }
      if (parsed?.Found) {
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

    const pressEnterStr = press_enter ? `[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")` : "";
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
