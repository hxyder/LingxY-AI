import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonBody, sendJson } from "../http-helpers.mjs";

const execFileAsync = promisify(execFile);

async function runOfficeAddinSetup({ statusOnly = false, elevate = false, resetCache = false } = {}) {
  const scriptPath = path.join(process.cwd(), "scripts", "setup-office-addins.ps1");
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

  const officeAddinDir = path.join(process.cwd(), "office_addin", "shared");
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

export async function tryHandleOfficeRoute({ request, response, method, url }) {
  if (await tryServeOfficeStaticFile({ response, method, url })) {
    return true;
  }

  if (method === "GET" && url.pathname === "/setup/office-addins/status") {
    const result = await runOfficeAddinSetup({ statusOnly: true });
    sendJson(response, 200, result.status);
    return true;
  }

  if (method === "POST" && url.pathname === "/setup/office-addins") {
    const body = await readJsonBody(request);
    const result = await runOfficeAddinSetup({
      elevate: body.elevate !== false,
      resetCache: body.resetCache === true
    });
    sendJson(response, 200, result.status);
    return true;
  }

  return false;
}
