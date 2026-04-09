function createFloatingChipController(doc = document) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-floating-chip", "true");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      .chip-shell {
        display: grid;
        gap: 8px;
        pointer-events: auto;
      }
      .chip-button {
        all: initial;
        box-sizing: border-box;
        min-width: 164px;
        padding: 10px 14px;
        border-radius: 999px;
        background:
          linear-gradient(135deg, rgba(13, 148, 136, 0.96), rgba(21, 94, 117, 0.96));
        color: white;
        font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        cursor: pointer;
        box-shadow: 0 12px 26px rgba(8, 47, 73, 0.22);
      }
      .chip-button:hover {
        transform: translateY(-1px);
      }
      .chip-button:focus {
        outline: none;
      }
      .chip-preview {
        display: none;
        min-width: 220px;
        padding: 10px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.97);
        border: 1px solid rgba(15, 118, 110, 0.16);
        box-shadow: 0 18px 38px rgba(8, 47, 73, 0.18);
        color: #163047;
        font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
      }
      .chip-preview[data-open="true"] {
        display: grid;
        gap: 8px;
      }
      .chip-actions {
        display: grid;
        gap: 6px;
      }
      .chip-action {
        all: initial;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(236, 253, 245, 0.92);
        color: #0f172a;
        cursor: pointer;
        font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        font-size: 12px;
      }
      .chip-hint {
        font-size: 11px;
        color: #4b5563;
      }
    </style>
    <div class="chip-shell">
      <button class="chip-button" type="button" tabindex="-1">用 UCA 总结</button>
      <div class="chip-preview" data-open="false">
        <div class="chip-actions">
          <button class="chip-action" type="button" data-action="summarize">总结</button>
          <button class="chip-action" type="button" data-action="translate">翻译</button>
          <button class="chip-action" type="button" data-action="explain">解释</button>
        </div>
        <div class="chip-hint">Esc 隐藏本轮，滚出视口自动收起</div>
      </div>
    </div>
  `;

  const button = root.querySelector(".chip-button");
  const preview = root.querySelector(".chip-preview");
  const actionButtons = [...root.querySelectorAll(".chip-action")];

  host.style.position = "fixed";
  host.style.display = "none";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  doc.documentElement.appendChild(host);

  let previewOpen = false;
  let previewTimer = null;
  let currentSelectionKey = null;

  function clearPreviewTimer() {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function setPreviewOpen(nextOpen) {
    previewOpen = nextOpen;
    preview.dataset.open = nextOpen ? "true" : "false";
  }

  button.addEventListener("mouseenter", () => {
    const delay = Number(host.dataset.previewDelayMs ?? "300");
    clearPreviewTimer();
    previewTimer = setTimeout(() => setPreviewOpen(true), delay);
  });
  button.addEventListener("mouseleave", () => {
    clearPreviewTimer();
    if (!host.matches(":hover")) {
      setPreviewOpen(false);
    }
  });
  preview.addEventListener("mouseleave", () => {
    if (!host.matches(":hover")) {
      setPreviewOpen(false);
    }
  });
  preview.addEventListener("mouseenter", () => {
    clearPreviewTimer();
    setPreviewOpen(true);
  });

  for (const actionButton of actionButtons) {
    actionButton.addEventListener("click", () => {
      window.__ucaOverlayLastAction = {
        action: actionButton.dataset.action,
        selectionKey: currentSelectionKey,
        ts: Date.now()
      };
    });
  }

  return {
    show({ position, label, selectionKey, previewDelayMs }) {
      currentSelectionKey = selectionKey;
      host.dataset.previewDelayMs = String(previewDelayMs ?? 300);
      button.textContent = label;
      host.style.left = `${position.left}px`;
      host.style.top = `${position.top}px`;
      host.style.display = "block";
      host.style.pointerEvents = "auto";
    },
    reposition(position) {
      host.style.left = `${position.left}px`;
      host.style.top = `${position.top}px`;
    },
    hide() {
      clearPreviewTimer();
      setPreviewOpen(false);
      currentSelectionKey = null;
      host.style.display = "none";
      host.style.pointerEvents = "none";
    },
    contains(node) {
      return host.contains(node) || root.contains(node);
    },
    isVisible() {
      return host.style.display !== "none";
    },
    getSelectionKey() {
      return currentSelectionKey;
    },
    isPreviewOpen() {
      return previewOpen;
    }
  };
}

function captureSelectionState(doc = document) {
  const selection = doc.getSelection();
  const text = selection?.toString().trim() ?? "";
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect?.();
  const overlay = globalThis.__ucaOverlay ?? {};
  const selectionKey = overlay.createSelectionKey?.({
    text,
    rect
  }) ?? text;

  return {
    text,
    contextBefore: text ? text.slice(0, 100) : "",
    contextAfter: text ? text.slice(-100) : "",
    rect: rect
      ? {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }
      : null,
    selectionKey
  };
}

function getOverlaySettings() {
  const overlay = globalThis.__ucaOverlay ?? {};
  return overlay.mergeOverlaySettings?.(window.__ucaOverlaySettings ?? {}) ?? {
    enabled: true,
    displayMode: "smart",
    minLength: 5,
    longSelectionMinLength: 32,
    autoHideMs: 5000,
    previewDelayMs: 300,
    debounceMs: 150,
    stabilityMs: 200,
    blockedDomains: []
  };
}

function getOverlayEnvironment(doc = document) {
  return {
    presenterMode: Boolean(window.__ucaOverlaySecurityState?.presenterMode),
    hostname: window.location.hostname,
    activeElement: doc.activeElement
  };
}

function installSelectionObserver(doc = document, win = window) {
  const overlay = globalThis.__ucaOverlay ?? {};
  const chip = createFloatingChipController(doc);
  const dismissedSelections = new Set();
  let currentState = null;
  let selectionDebounce = null;
  let autoHideTimer = null;
  let rafPending = false;

  function clearAutoHide() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function hideChip() {
    clearAutoHide();
    chip.hide();
  }

  function maybeAutoHide() {
    clearAutoHide();
    const settings = getOverlaySettings();
    autoHideTimer = setTimeout(() => {
      if (!chip.isPreviewOpen()) {
        hideChip();
      }
    }, settings.autoHideMs);
  }

  function showChip(state) {
    const settings = getOverlaySettings();
    const position = overlay.computeFloatingChipPlacement?.(state.rect) ?? {
      left: state.rect.left,
      top: state.rect.bottom + 8
    };
    chip.show({
      position,
      label: settings.displayMode === "long_selection_only" ? "用 UCA 深入处理" : "用 UCA 总结",
      selectionKey: state.selectionKey,
      previewDelayMs: settings.previewDelayMs
    });
    maybeAutoHide();
  }

  function reevaluateCurrentSelection() {
    if (!currentState?.rect || !chip.isVisible()) {
      return;
    }

    const decision = overlay.shouldShowFloatingChip?.({
      state: currentState,
      settings: getOverlaySettings(),
      environment: getOverlayEnvironment(doc),
      dismissedKeys: dismissedSelections,
      isVisibleRect: (rect) => overlay.isRectVisible?.(rect) ?? true
    }) ?? { show: true };

    if (!decision.show) {
      hideChip();
      return;
    }

    if (!(overlay.isRectVisible?.(currentState.rect) ?? true)) {
      hideChip();
      return;
    }

    chip.reposition(overlay.computeFloatingChipPlacement(currentState.rect));
  }

  const watcher = (overlay.createStabilityWatcher?.({
    stabilityMs: getOverlaySettings().stabilityMs,
    onStable(state) {
      currentState = state;
      const decision = overlay.shouldShowFloatingChip?.({
        state,
        settings: getOverlaySettings(),
        environment: getOverlayEnvironment(doc),
        dismissedKeys: dismissedSelections,
        isVisibleRect: (rect) => overlay.isRectVisible?.(rect) ?? true
      }) ?? { show: true };

      window.__ucaSelectionState = state;
      window.__ucaOverlayLastDecision = decision;

      if (!decision.show) {
        hideChip();
        return;
      }

      showChip(state);
    },
    onReset() {
      hideChip();
    }
  })) ?? {
    observe() {},
    dismiss() {}
  };

  function scheduleReposition() {
    if (rafPending) {
      return;
    }
    rafPending = true;
    win.requestAnimationFrame(() => {
      rafPending = false;
      reevaluateCurrentSelection();
    });
  }

  function onSelectionChange() {
    if (selectionDebounce) {
      clearTimeout(selectionDebounce);
    }

    selectionDebounce = setTimeout(() => {
      const state = captureSelectionState(doc);
      window.__ucaSelectionState = state;
      if (!state.text || !state.rect) {
        watcher.dismiss();
        hideChip();
        return;
      }

      watcher.observe(state);
    }, getOverlaySettings().debounceMs);
  }

  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("pointerdown", (event) => {
    if (chip.isVisible() && !chip.contains(event.target)) {
      hideChip();
    }
  }, true);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && chip.isVisible()) {
      const key = chip.getSelectionKey();
      if (key) {
        dismissedSelections.add(key);
      }
      hideChip();
    }
  }, true);
  win.addEventListener("scroll", scheduleReposition, true);
  win.addEventListener("resize", scheduleReposition, true);
  win.visualViewport?.addEventListener("resize", scheduleReposition);
  win.visualViewport?.addEventListener("scroll", scheduleReposition);

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["ucaOverlaySettings", "ucaOverlaySecurityState"], (data) => {
      window.__ucaOverlaySettings = data.ucaOverlaySettings ?? {};
      window.__ucaOverlaySecurityState = data.ucaOverlaySecurityState ?? { presenterMode: false };
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      if (changes.ucaOverlaySettings) {
        window.__ucaOverlaySettings = changes.ucaOverlaySettings.newValue ?? {};
      }
      if (changes.ucaOverlaySecurityState) {
        window.__ucaOverlaySecurityState = changes.ucaOverlaySecurityState.newValue ?? { presenterMode: false };
      }
      reevaluateCurrentSelection();
    });
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.__ucaSelectionApi = {
    captureSelectionState,
    installSelectionObserver
  };
  installSelectionObserver(document, window);
}
