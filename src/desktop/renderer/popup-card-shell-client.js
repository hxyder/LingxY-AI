(function initPopupCardShellClient() {
  if (window.popupCardShellClient) return;

  function createPopupCardShellClient({
    shellProvider = () => window.ucaShell
  } = {}) {
    function method(name) {
      const shell = shellProvider();
      const fn = shell?.[name];
      return typeof fn === "function" ? fn.bind(shell) : null;
    }

    return {
      resizePopupCard(cardId, height) {
        return method("resizePopupCard")?.(cardId, height);
      },
      closePopupCard(cardId, payload) {
        return method("closePopupCard")?.(cardId, payload);
      },
      resolvePopupCard(cardId, payload) {
        return method("resolvePopupCard")?.(cardId, payload);
      },
      showWindow(target) {
        return method("showWindow")?.(target);
      },
      navigateConsole(payload) {
        return method("navigateConsole")?.(payload);
      },
      togglePopupCardPin(cardId, pinned) {
        return method("togglePopupCardPin")?.(cardId, pinned);
      },
      onPopupCardInit(listener) {
        return method("onPopupCardInit")?.(listener);
      }
    };
  }

  window.createPopupCardShellClient = createPopupCardShellClient;
  window.popupCardShellClient = createPopupCardShellClient();
})();
