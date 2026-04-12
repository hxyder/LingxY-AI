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
