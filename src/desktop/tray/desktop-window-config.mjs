import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RENDERER_DIR = path.join(__dirname, "..", "renderer");
export const PRELOAD_PATH = path.join(RENDERER_DIR, "preload.cjs");

export function buildRendererFileUrl(fileName) {
  return pathToFileURL(path.join(RENDERER_DIR, fileName)).toString();
}

export function buildWindowUrl(windowDef, serviceBaseUrl) {
  const url = new URL(buildRendererFileUrl(`${windowDef.id}.html`));
  url.searchParams.set("windowId", windowDef.id);
  url.searchParams.set("route", windowDef.route);
  url.searchParams.set("serviceBaseUrl", serviceBaseUrl);
  return url.toString();
}

export function resolveWindowOptions(windowDef) {
  if (windowDef.id === "dock") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      thickFrame: false,
      transparent: true,
      resizable: false,
      useContentSize: true,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false
    };
  }

  if (windowDef.id === "overlay") {
    return {
      alwaysOnTop: false,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: true,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false
    };
  }

  if (windowDef.id === "echo-bubble") {
    return {
      alwaysOnTop: true,
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      focusable: false,
      closable: false
    };
  }

  return {
    autoHideMenuBar: true
  };
}
