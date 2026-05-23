(function bootstrapStabilityWatcher(globalScope) {
  const overlay = globalScope.__ucaOverlay ?? (globalScope.__ucaOverlay = {});

  function createSelectionKey(state) {
    const rect = state?.rect ?? {};
    return [
      state?.text?.trim() ?? "",
      Math.round(rect.left ?? 0),
      Math.round(rect.top ?? 0),
      Math.round(rect.width ?? 0),
      Math.round(rect.height ?? 0)
    ].join("|");
  }

  function createStabilityWatcher({
    stabilityMs = 200,
    onStable = () => {},
    onReset = () => {}
  } = {}) {
    let timer = null;
    let lastKey = null;
    let lastPayload = null;

    function clearPending(emitReset = false) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (emitReset) {
        onReset(lastPayload);
      }
    }

    return {
      observe(state) {
        const nextKey = createSelectionKey(state);
        if (!state?.text?.trim()) {
          lastKey = null;
          lastPayload = null;
          clearPending(true);
          return;
        }

        if (nextKey === lastKey) {
          return;
        }

        lastKey = nextKey;
        lastPayload = {
          ...state,
          selectionKey: nextKey
        };
        clearPending();
        timer = setTimeout(() => {
          timer = null;
          onStable(lastPayload);
        }, stabilityMs);
      },
      dismiss() {
        clearPending(true);
      },
      getLastKey() {
        return lastKey;
      }
    };
  }

  overlay.createSelectionKey = createSelectionKey;
  overlay.createStabilityWatcher = createStabilityWatcher;
})(globalThis);
