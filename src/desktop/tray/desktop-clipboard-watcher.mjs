export function createDesktopClipboardWatcher({
  clipboard,
  getDockWindow,
  shellClipboardChangedChannel,
  intervalMs = 800
} = {}) {
  if (!clipboard?.readText) throw new TypeError("createDesktopClipboardWatcher requires clipboard.");
  if (typeof getDockWindow !== "function") throw new TypeError("createDesktopClipboardWatcher requires getDockWindow.");

  let lastClipboardText = "";
  let clipboardPollTimer = null;

  function setLastClipboardText(text) {
    lastClipboardText = text ?? "";
  }

  function startClipboardWatcher() {
    lastClipboardText = clipboard.readText() ?? "";
    clipboardPollTimer = setInterval(() => {
      try {
        const current = clipboard.readText() ?? "";
        if (current && current !== lastClipboardText && current.trim().length >= 4) {
          lastClipboardText = current;
          const dock = getDockWindow();
          if (dock) {
            dock.webContents.send(shellClipboardChangedChannel, {
              length: current.length,
              preview: current.slice(0, 60)
            });
          }
        }
      } catch { /* ignore clipboard transient errors */ }
    }, intervalMs);
  }

  function stopClipboardWatcher() {
    if (clipboardPollTimer) {
      clearInterval(clipboardPollTimer);
      clipboardPollTimer = null;
    }
  }

  return {
    setLastClipboardText,
    startClipboardWatcher,
    stopClipboardWatcher
  };
}
