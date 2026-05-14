(function initPreviewShellClient() {
  if (window.previewShellClient) return;

  function createPreviewShellClient({
    shellProvider = () => window.ucaShell
  } = {}) {
    function requireMethod(name, message) {
      const shell = shellProvider();
      const fn = shell?.[name];
      if (typeof fn !== "function") throw new Error(message);
      return fn.bind(shell);
    }

    function optionalMethod(name) {
      const shell = shellProvider();
      const fn = shell?.[name];
      return typeof fn === "function" ? fn.bind(shell) : null;
    }

    return {
      readTextFile(filePath, maxBytes, message = "ucaShell.readTextFile 未挂载") {
        return requireMethod("readTextFile", message)(filePath, maxBytes);
      },
      statPath(filePath, message = "ucaShell.statPath 未挂载") {
        return requireMethod("statPath", message)(filePath);
      },
      listDirectory(filePath, options = {}, message = "ucaShell.listDirectory 未挂载") {
        return requireMethod("listDirectory", message)(filePath, options ?? {});
      },
      readFileAsDataUrl(filePath, mime, message = "ucaShell.readFileAsDataUrl 未挂载") {
        return requireMethod("readFileAsDataUrl", message)(filePath, mime);
      },
      getPdfWorkerUrl(message = "ucaShell.getPdfWorkerUrl 未挂载（preload）") {
        return requireMethod("getPdfWorkerUrl", message)();
      },
      closePreviewWindow() {
        return optionalMethod("closePreviewWindow")?.();
      },
      setPreviewWindowAlwaysOnTop(flag) {
        return optionalMethod("setPreviewWindowAlwaysOnTop")?.(flag);
      },
      onPreviewWindowInit(listener) {
        return optionalMethod("onPreviewWindowInit")?.(listener);
      },
      onPreviewWindowDelta(listener) {
        return optionalMethod("onPreviewWindowDelta")?.(listener);
      },
      onPreviewWindowCommitted(listener) {
        return optionalMethod("onPreviewWindowCommitted")?.(listener);
      }
    };
  }

  window.createPreviewShellClient = createPreviewShellClient;
  window.previewShellClient = createPreviewShellClient();
})();
