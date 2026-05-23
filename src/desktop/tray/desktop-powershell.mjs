import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { desktopScriptPath } from "./desktop-paths.mjs";

export const execFileAsync = promisify(execFile);

export function buildPowerShellScriptArgs(scriptPath, args = []) {
  return [
    "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    ...args
  ];
}

export async function runPowerShellScript({ script, args = [], timeoutMs = 3000 }) {
  const scriptPath = desktopScriptPath(script);
  return execFileAsync("powershell", buildPowerShellScriptArgs(scriptPath, args), {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true
  });
}
