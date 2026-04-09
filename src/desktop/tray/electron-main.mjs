import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DESKTOP_SHELL_MANIFEST, IPC_CHANNELS } from "../shared/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const PRELOAD_PATH = path.join(RENDERER_DIR, "preload.cjs");

function buildWindowUrl(windowDef, serviceBaseUrl) {
  const filePath = path.join(RENDERER_DIR, `${windowDef.id}.html`);
  const url = new URL(pathToFileURL(filePath).toString());
  url.searchParams.set("windowId", windowDef.id);
  url.searchParams.set("route", windowDef.route);
  url.searchParams.set("serviceBaseUrl", serviceBaseUrl);
  return url.toString();
}

function resolveWindowOptions(windowDef) {
  if (windowDef.id === "overlay") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      maximizable: false,
      minimizable: false
    };
  }

  return {
    autoHideMenuBar: true
  };
}

export function createElectronShellRuntime({
  electron,
  serviceBaseUrl = process.env.UCA_SERVICE_BASE_URL ?? "http://127.0.0.1:4310"
} = {}) {
  if (!electron) {
    throw new Error("Electron bindings are required to create the shell runtime.");
  }

  const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = electron;
  const windows = new Map();
  const readyWindows = new Set();
  const pendingWindowMessages = new Map();
  let tray = null;
  let quitting = false;
  let resolvedServiceBaseUrl = serviceBaseUrl;

  function enqueueWindowMessage(windowId, channel, payload) {
    const target = windows.get(windowId);
    if (target && readyWindows.has(windowId)) {
      target.webContents.send(channel, payload);
      return;
    }

    const queued = pendingWindowMessages.get(windowId) ?? [];
    queued.push({ channel, payload });
    pendingWindowMessages.set(windowId, queued);
  }

  function flushWindowMessages(windowId) {
    const target = windows.get(windowId);
    const queued = pendingWindowMessages.get(windowId) ?? [];
    if (!target || queued.length === 0) {
      return;
    }

    for (const message of queued) {
      target.webContents.send(message.channel, message.payload);
    }
    pendingWindowMessages.delete(windowId);
  }

  function getArgValue(argv, flagName) {
    const index = argv.findIndex((item) => item === flagName);
    if (index < 0 || index + 1 >= argv.length) {
      return null;
    }
    return argv[index + 1];
  }

  async function handleLaunchArgs(argv = []) {
    const requestedServiceBaseUrl = getArgValue(argv, "--uca-service-url");
    if (requestedServiceBaseUrl) {
      resolvedServiceBaseUrl = requestedServiceBaseUrl;
    }

    const handoffFile = getArgValue(argv, "--uca-handoff-file");
    if (handoffFile) {
      const raw = await readFile(handoffFile, "utf8");
      const payload = JSON.parse(raw);
      await unlink(handoffFile).catch(() => {});
      showWindow("overlay");
      enqueueWindowMessage("overlay", IPC_CHANNELS.shellContextReceived, {
        ...payload,
        targetWindow: "overlay"
      });
      return true;
    }

    if (argv.includes("--uca-open-overlay")) {
      showWindow("overlay");
      return true;
    }

    return false;
  }

  function createWindows() {
    for (const windowDef of DESKTOP_SHELL_MANIFEST.windows) {
      if (windows.has(windowDef.id)) {
        continue;
      }
      const browserWindow = new BrowserWindow({
        width: windowDef.width,
        height: windowDef.height,
        show: !windowDef.startsHidden,
        title: windowDef.title,
        ...resolveWindowOptions(windowDef),
        webPreferences: {
          sandbox: false,
          contextIsolation: true,
          preload: PRELOAD_PATH
        }
      });
      browserWindow.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          browserWindow.hide();
        }
      });
      browserWindow.on("focus", () => {
        browserWindow.webContents.send(IPC_CHANNELS.shellWindowFocused, {
          windowId: windowDef.id
        });
      });
      browserWindow.on("closed", () => {
        readyWindows.delete(windowDef.id);
        pendingWindowMessages.delete(windowDef.id);
        windows.delete(windowDef.id);
      });
      browserWindow.webContents.on("did-finish-load", () => {
        readyWindows.add(windowDef.id);
        browserWindow.webContents.send(IPC_CHANNELS.shellReady, {
          windowId: windowDef.id,
          route: windowDef.route,
          serviceBaseUrl: resolvedServiceBaseUrl
        });
        flushWindowMessages(windowDef.id);
      });
      browserWindow.loadURL(buildWindowUrl(windowDef, resolvedServiceBaseUrl));
      windows.set(windowDef.id, browserWindow);
    }
  }

  function showWindow(windowId) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    target.show();
    target.focus();
    return true;
  }

  function hideWindow(windowId) {
    const target = windows.get(windowId);
    if (!target) {
      return false;
    }
    target.hide();
    return true;
  }

  function registerShortcuts() {
    for (const shortcut of DESKTOP_SHELL_MANIFEST.shortcuts) {
      globalShortcut.register(shortcut.accelerator, () => {
        const payload = {
          shortcutId: shortcut.id,
          accelerator: shortcut.accelerator
        };
        if (shortcut.id === "toggle-overlay") {
          showWindow("overlay");
        }
        if (shortcut.id === "open-console") {
          showWindow("console");
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
          showWindow("console");
        }
      },
      {
        label: "Open Overlay",
        click() {
          showWindow("overlay");
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
      app.on("second-instance", (_event, argv) => {
        handleLaunchArgs(argv).catch((error) => {
          console.error("Failed to process second-instance args", error);
        });
      });
      ipcMain.handle(IPC_CHANNELS.shellStatus, () => ({
        serviceBaseUrl: resolvedServiceBaseUrl,
        windowIds: [...windows.keys()],
        windows: DESKTOP_SHELL_MANIFEST.windows.map((windowDef) => ({
          id: windowDef.id,
          title: windowDef.title,
          route: windowDef.route,
          visible: windows.get(windowDef.id)?.isVisible() ?? false
        }))
      }));
      ipcMain.handle(IPC_CHANNELS.shellShowWindow, (_event, windowId) => showWindow(windowId));
      ipcMain.handle(IPC_CHANNELS.shellHideWindow, (_event, windowId) => hideWindow(windowId));
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindows();
        }
      });
      app.on("before-quit", () => {
        quitting = true;
      });
      await handleLaunchArgs(process.argv);
      return {
        serviceBaseUrl: resolvedServiceBaseUrl,
        windows: [...windows.keys()],
        trayReady: Boolean(tray)
      };
    }
  };
}

export async function initializeElectronShellRuntime({
  electron,
  serviceBaseUrl
} = {}) {
  if (!electron?.app) {
    throw new Error("Electron app bindings are required to initialize the shell runtime.");
  }

  if (!electron.app.requestSingleInstanceLock()) {
    electron.app.quit();
    return null;
  }

  const runtime = createElectronShellRuntime({
    electron,
    serviceBaseUrl
  });
  await runtime.start();
  return runtime;
}
