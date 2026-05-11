export function registerShellOpenUrlIpc({
  ipcMain,
  IPC_CHANNELS,
  BrowserWindow,
  brandIcons,
  dialog,
  shell,
  normalizeOpenableUrl,
  readLinkOpenPreference,
  showLinkBrowserWindow
} = {}) {
  if (!ipcMain?.handle) throw new Error("ipcMain is required to register shell open-url IPC.");
  if (!IPC_CHANNELS) throw new Error("IPC_CHANNELS is required to register shell open-url IPC.");
  if (!BrowserWindow) throw new Error("BrowserWindow is required to register shell open-url IPC.");
  if (!brandIcons?.showBrandedMessageBox) throw new Error("brandIcons.showBrandedMessageBox is required.");
  if (!dialog) throw new Error("dialog is required to register shell open-url IPC.");
  if (!shell?.openExternal) throw new Error("shell.openExternal is required.");
  if (typeof normalizeOpenableUrl !== "function") throw new Error("normalizeOpenableUrl is required.");
  if (typeof readLinkOpenPreference !== "function") throw new Error("readLinkOpenPreference is required.");
  if (typeof showLinkBrowserWindow !== "function") throw new Error("showLinkBrowserWindow is required.");

  ipcMain.handle(IPC_CHANNELS.shellOpenUrl, async (event, payload = {}) => {
    const url = normalizeOpenableUrl(payload.url);
    if (!url) return { ok: false, error: "invalid_url" };
    const protocol = new URL(url).protocol;
    const canOpenInLingxy = protocol === "http:" || protocol === "https:";
    // Resolution order: explicit caller request > user preference >
    // system browser default. Renderer link surfaces pass
    // `{ ask: true }` when a click should never silently navigate
    // away from the current LingxY surface.
    const explicitMode = payload.ask === true
      ? "ask"
      : (["system", "lingxy_browser", "ask"].includes(payload.mode) ? payload.mode : null);
    // The user-facing setting lives in Console Settings -> link open mode,
    // so users who liked the in-app browser can pick it as their default again.
    let mode = explicitMode ?? readLinkOpenPreference();
    if (mode === "ask" && canOpenInLingxy) {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
      const choice = await brandIcons.showBrandedMessageBox(dialog, owner ?? undefined, {
        type: "question",
        title: "Open link",
        message: "用什么方式打开这个链接？",
        detail: url,
        buttons: ["LingxY 新窗口", "系统浏览器", "取消"],
        // Default to system browser on Enter so the safer choice is
        // one keystroke away.
        defaultId: 1,
        cancelId: 2,
        noLink: true
      });
      if (choice.response === 2) return { ok: false, cancelled: true };
      mode = choice.response === 0 ? "lingxy_browser" : "system";
    }
    if (mode === "lingxy_browser" && canOpenInLingxy) {
      return showLinkBrowserWindow(url);
    }
    await shell.openExternal(url);
    return { ok: true, mode: "system" };
  });
}
