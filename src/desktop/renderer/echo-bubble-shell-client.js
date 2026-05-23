(function initEchoBubbleShellClient() {
  if (window.echoBubbleShellClient) return;

  function createEchoBubbleShellClient({
    shellProvider = () => window.ucaShell
  } = {}) {
    function method(name) {
      const shell = shellProvider();
      const fn = shell?.[name];
      return typeof fn === "function" ? fn.bind(shell) : null;
    }

    return {
      hideWindow(windowId) {
        return method("hideWindow")?.(windowId);
      },
      onEchoBubble(listener) {
        return method("onEchoBubble")?.(listener);
      }
    };
  }

  window.createEchoBubbleShellClient = createEchoBubbleShellClient;
  window.echoBubbleShellClient = createEchoBubbleShellClient();
})();
