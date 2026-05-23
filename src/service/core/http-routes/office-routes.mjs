import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { resolveDesktopResourcePath } from "../desktop-resource-paths.mjs";

const execFileAsync = promisify(execFile);
const OFFICE_ADDIN_SETUP_ACTORS = ["desktop_console"];

async function runOfficeAddinSetup({ statusOnly = false, elevate = false, resetCache = false } = {}) {
  const scriptPath = resolveDesktopResourcePath("scripts/setup-office-addins.ps1", {
    preferResources: true
  }).path;
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ];

  if (statusOnly) {
    args.push("-StatusOnly");
  }
  if (elevate) {
    args.push("-Elevate");
  }
  if (resetCache) {
    args.push("-ResetCache");
  }

  const { stdout, stderr } = await execFileAsync("powershell.exe", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: elevate ? 120000 : 30000
  });
  const text = stdout.trim();
  return {
    status: text ? JSON.parse(text) : {},
    stderr: stderr.trim()
  };
}

async function tryServeOfficeStaticFile({ response, method, url }) {
  if (method !== "GET" || !url.pathname.startsWith("/office/")) {
    return false;
  }

  const officeAddinDir = resolveDesktopResourcePath("office_addin/shared", {
    preferResources: true
  }).path;
  const fileName = url.pathname.replace(/^\/office\//, "");
  if (!fileName || fileName.includes("..")) {
    return false;
  }

  try {
    const filePath = path.join(officeAddinDir, fileName);
    const content = await readFile(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png"
    };
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store, max-age=0"
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

function resolveOfficeAddinSetupRunner(runtime) {
  if (typeof runtime?.officeAddinSetup?.runOfficeAddinSetup === "function") {
    return runtime.officeAddinSetup.runOfficeAddinSetup;
  }
  if (typeof runtime?.runOfficeAddinSetup === "function") {
    return runtime.runOfficeAddinSetup;
  }
  return runOfficeAddinSetup;
}

export async function tryHandleOfficeRoute({ request, response, method, url, runtime }) {
  if (await tryServeOfficeStaticFile({ response, method, url })) {
    return true;
  }

  if (method === "GET" && url.pathname === "/setup/office-addins/status") {
    const runSetup = resolveOfficeAddinSetupRunner(runtime);
    const result = await runSetup({ statusOnly: true });
    sendJson(response, 200, result.status);
    return true;
  }

  if (method === "POST" && url.pathname === "/setup/office-addins") {
    if (!requireDesktopActor({ request, response, allowedActors: OFFICE_ADDIN_SETUP_ACTORS })) return true;
    const runSetup = resolveOfficeAddinSetupRunner(runtime);
    const body = await readJsonBody(request);
    const result = await runSetup({
      elevate: body.elevate !== false,
      resetCache: body.resetCache === true
    });
    sendJson(response, 200, result.status);
    return true;
  }

  return false;
}
