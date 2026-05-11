export function installMediaPermissionHandlers({ session, safeError } = {}) {
  if (!session?.defaultSession) throw new TypeError("installMediaPermissionHandlers requires session.");
  if (typeof safeError !== "function") throw new TypeError("installMediaPermissionHandlers requires safeError.");

  try {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const requestingUrl = webContents?.getURL?.() ?? "";
      const isLocal = requestingUrl.startsWith("file://")
        || requestingUrl.startsWith("http://127.0.0.1")
        || requestingUrl.startsWith("http://localhost");
      const isAudioOrDisplay = permission === "media"
        || permission === "audioCapture"
        || permission === "microphone"
        || permission === "displayCapture";
      if (isLocal && isAudioOrDisplay) {
        callback(true);
        return;
      }
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const url = requestingOrigin ?? webContents?.getURL?.() ?? "";
      const isLocal = url.startsWith("file://")
        || url.startsWith("http://127.0.0.1")
        || url.startsWith("http://localhost");
      const isAudioOrDisplay = permission === "media"
        || permission === "audioCapture"
        || permission === "microphone"
        || permission === "displayCapture";
      return isLocal && isAudioOrDisplay;
    });
  } catch (error) {
    safeError("Failed to install permission handler", error);
  }
}
