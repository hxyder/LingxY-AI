import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } from "electron";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";

function buildWindowHtml(windowDef, serviceBaseUrl) {
  const payload = JSON.stringify({
    windowId: windowDef.id,
    route: windowDef.route,
    serviceBaseUrl
  });

  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${windowDef.title}</title></head>
  <body>
    <pre id="uca-shell">${payload}</pre>
  </body>
</html>`)}`;
}

export function createElectronShellRuntime({
  serviceBaseUrl = process.env.UCA_SERVICE_BASE_URL ?? "http://127.0.0.1:4310"
} = {}) {
  const windows = new Map();
  let tray = null;

  function createWindows() {
    for (const windowDef of DESKTOP_SHELL_MANIFEST.windows) {
      const browserWindow = new BrowserWindow({
        width: windowDef.width,
        height: windowDef.height,
        show: !windowDef.startsHidden,
        title: windowDef.title,
        webPreferences: {
          sandbox: true,
          contextIsolation: true
        }
      });
      browserWindow.loadURL(buildWindowHtml(windowDef, serviceBaseUrl));
      windows.set(windowDef.id, browserWindow);
    }
  }

  function registerShortcuts() {
    for (const shortcut of DESKTOP_SHELL_MANIFEST.shortcuts) {
      globalShortcut.register(shortcut.accelerator, () => {
        const payload = {
          shortcutId: shortcut.id,
          accelerator: shortcut.accelerator
        };
        if (shortcut.id === "toggle-overlay") {
          windows.get("overlay")?.show();
        }
        if (shortcut.id === "open-console") {
          windows.get("console")?.show();
        }
        for (const browserWindow of windows.values()) {
          browserWindow.webContents.send(IPC_CHANNELS.shortcutTriggered, payload);
        }
      });
    }
  }

  function createTray() {
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip(DESKTOP_SHELL_MANIFEST.trayTooltip);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: "Open Console",
        click() {
          windows.get("console")?.show();
        }
      },
      {
        label: "Open Overlay",
        click() {
          windows.get("overlay")?.show();
        }
      },
      {
        label: "Quit",
        click() {
          app.quit();
        }
      }
    ]));
  }

  return {
    async start() {
      await app.whenReady();
      createWindows();
      createTray();
      registerShortcuts();
      ipcMain.handle(IPC_CHANNELS.shellStatus, () => ({
        serviceBaseUrl,
        windowIds: [...windows.keys()]
      }));
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindows();
        }
      });
      return {
        serviceBaseUrl,
        windows: [...windows.keys()],
        trayReady: Boolean(tray)
      };
    }
  };
}

if (process.env.UCA_ELECTRON_AUTOSTART !== "0") {
  const runtime = createElectronShellRuntime();
  runtime.start();
}
