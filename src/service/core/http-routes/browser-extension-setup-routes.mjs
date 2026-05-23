import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { resolveDesktopResourcePath } from "../desktop-resource-paths.mjs";

const execFileAsync = promisify(execFile);
const BROWSER_EXTENSION_SETUP_ACTORS = ["desktop_console"];

function parsePowerShellJson(stdout = "") {
  const text = String(stdout ?? "").trim();
  if (!text) return {};
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .reverse()
    .find((item) => item.startsWith("{") && item.endsWith("}"));
  return JSON.parse(line ?? text);
}

async function runBrowserExtensionSetup({
  statusOnly = false,
  browser = "both",
  openExtensionPage = false,
  openExtensionFolder = false
} = {}) {
  const scriptPath = resolveDesktopResourcePath("scripts/install-native-host.ps1", {
    preferResources: true
  }).path;
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Browser",
    browser === "chrome" || browser === "edge" ? browser : "both"
  ];

  if (statusOnly) args.push("-StatusOnly");
  if (openExtensionPage) args.push("-OpenExtensionPage");
  if (openExtensionFolder) args.push("-OpenExtensionFolder");

  const { stdout, stderr } = await execFileAsync("powershell.exe", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: statusOnly ? 30_000 : 90_000
  });
  return {
    status: parsePowerShellJson(stdout),
    stderr: String(stderr ?? "").trim()
  };
}

function resolveBrowserExtensionSetupRunner(runtime) {
  if (typeof runtime?.browserExtensionSetup?.runBrowserExtensionSetup === "function") {
    return runtime.browserExtensionSetup.runBrowserExtensionSetup;
  }
  if (typeof runtime?.runBrowserExtensionSetup === "function") {
    return runtime.runBrowserExtensionSetup;
  }
  return runBrowserExtensionSetup;
}

export async function tryHandleBrowserExtensionSetupRoute({ request, response, method, url, runtime }) {
  if (method === "GET" && url.pathname === "/setup/browser-extension/status") {
    if (!requireDesktopActor({ request, response, allowedActors: BROWSER_EXTENSION_SETUP_ACTORS })) return true;
    const runSetup = resolveBrowserExtensionSetupRunner(runtime);
    const result = await runSetup({ statusOnly: true });
    sendJson(response, 200, result.status ?? result);
    return true;
  }

  if (method === "POST" && url.pathname === "/setup/browser-extension") {
    if (!requireDesktopActor({ request, response, allowedActors: BROWSER_EXTENSION_SETUP_ACTORS })) return true;
    const body = await readJsonBody(request);
    const runSetup = resolveBrowserExtensionSetupRunner(runtime);
    const result = await runSetup({
      browser: body.browser,
      openExtensionPage: body.openExtensionPage !== false,
      openExtensionFolder: body.openExtensionFolder !== false
    });
    sendJson(response, 200, result.status ?? result);
    return true;
  }

  return false;
}
