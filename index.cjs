const { spawn } = require("node:child_process");
const path = require("node:path");

if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  const nextEnv = { ...process.env };
  delete nextEnv.ELECTRON_RUN_AS_NODE;

  const relaunchCwd = process.defaultApp
    ? process.cwd()
    : path.dirname(process.execPath);

  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: relaunchCwd,
    env: nextEnv,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  process.exit(0);
}

const electron = require("electron");

// Guard against EPIPE on stderr — when Electron is launched from a parent
// process that has already closed its pipe (e.g. double-click on Windows),
// any console.error/warn call crashes the main process with "broken pipe".
function safeLog(...args) {
  try { if (process.stdout?.writable !== false) console.log(...args); } catch { /* ignore */ }
}
function safeError(...args) {
  try { if (process.stderr?.writable !== false) console.error(...args); } catch { /* ignore */ }
}
process.stdout?.on?.("error", () => {});
process.stderr?.on?.("error", () => {});

import("./src/desktop/tray/electron-main.mjs")
  .then(({ initializeElectronShellRuntime }) =>
    initializeElectronShellRuntime({ electron })
  )
  .catch((error) => {
    safeError(error);
    process.exit(1);
  });
