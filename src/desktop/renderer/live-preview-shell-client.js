(function initLivePreviewShellClient() {
  if (window.livePreviewShellClient) return;

  function createLivePreviewShellClient({
    shellProvider = () => window.ucaShell
  } = {}) {
    function method(name) {
      const shell = shellProvider();
      const fn = shell?.[name];
      return typeof fn === "function" ? fn.bind(shell) : null;
    }

    return {
      showPreviewWindow(payload) {
        return method("showPreviewWindow")?.(payload);
      },
      appendPreviewDelta(payload) {
        return method("appendPreviewDelta")?.(payload);
      },
      commitPreviewWindow(payload) {
        return method("commitPreviewWindow")?.(payload);
      },
      closePreviewWindow() {
        return method("closePreviewWindow")?.();
      }
    };
  }

  window.createLivePreviewShellClient = createLivePreviewShellClient;
  window.livePreviewShellClient = createLivePreviewShellClient();
})();
