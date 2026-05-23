export function createDockShellClient({
  shellProvider = () => window.ucaShell
} = {}) {
  function method(name) {
    const shell = shellProvider();
    const fn = shell?.[name];
    return typeof fn === "function" ? fn.bind(shell) : null;
  }

  function requireMethod(name, message = `ucaShell.${name} unavailable`) {
    const fn = method(name);
    if (!fn) throw new Error(message);
    return fn;
  }

  return {
    setIgnoreMouseEvents(windowId, ignore, options) {
      return method("setIgnoreMouseEvents")?.(windowId, ignore, options);
    },
    detectEchoKeyword(payload) {
      return requireMethod("detectEchoKeyword", "Desktop Echo KWS bridge unavailable.")(payload);
    },
    enrollEchoKeyword(payload) {
      return requireMethod("enrollEchoKeyword", "Desktop Echo enrollment bridge unavailable.")(payload);
    },
    onNoteRecordingState(listener) {
      return method("onNoteRecordingState")?.(listener);
    },
    getNoteRecordingState() {
      return method("getNoteRecordingState")?.();
    },
    showEchoBubble(payload) {
      return method("showEchoBubble")?.(payload);
    },
    sendEchoWake(payload) {
      return method("sendEchoWake")?.(payload);
    },
    getSettings() {
      return method("getSettings")?.();
    },
    onSettingsChanged(listener) {
      return method("onSettingsChanged")?.(listener);
    },
    onStartWakeEnrollment(listener) {
      return method("onStartWakeEnrollment")?.(listener);
    },
    onEchoSessionEnd(listener) {
      return method("onEchoSessionEnd")?.(listener);
    },
    onEchoShortcutWake(listener) {
      return method("onEchoShortcutWake")?.(listener);
    },
    showDockMenu() {
      return method("showDockMenu")?.();
    },
    setEchoMode(enabled) {
      return method("setEchoMode")?.(enabled);
    },
    onClipboardChanged(listener) {
      return requireMethod("onClipboardChanged")(listener);
    },
    moveWindowBy(windowId, dx, dy) {
      return requireMethod("moveWindowBy")(windowId, dx, dy);
    },
    showWindow(windowId) {
      return requireMethod("showWindow")(windowId);
    },
    resolveDroppedFilePaths(files) {
      return requireMethod("resolveDroppedFilePaths")(files);
    },
    notify(payload) {
      return requireMethod("notify")(payload);
    },
    submitDroppedFiles(filePaths) {
      return requireMethod("submitDroppedFiles")(filePaths);
    }
  };
}
