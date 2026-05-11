import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function openWithDefaultHandler(target) {
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
