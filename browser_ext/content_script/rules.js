(function bootstrapRules(globalScope) {
  const overlay = globalScope.__ucaOverlay ?? (globalScope.__ucaOverlay = {});

  const DEFAULT_OVERLAY_SETTINGS = Object.freeze({
    enabled: true,
    displayMode: "smart",
    minLength: 5,
    longSelectionMinLength: 32,
    autoHideMs: 5000,
    previewDelayMs: 300,
    debounceMs: 150,
    stabilityMs: 200,
    blockedDomains: ["mail.google.com", "outlook.live.com"],
    blacklistMode: "suffix"
  });

  function mergeOverlaySettings(patch = {}) {
    return {
      ...DEFAULT_OVERLAY_SETTINGS,
      ...patch
    };
  }

  function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    return Boolean(target.closest("input, textarea, [contenteditable='true'], [role='textbox']"));
  }

  function normalizeHostname(hostname = "") {
    return String(hostname).trim().toLowerCase();
  }

  function isDomainBlocked(hostname, blockedDomains = [], blacklistMode = "suffix") {
    const normalized = normalizeHostname(hostname);
    if (!normalized) {
      return false;
    }

    return blockedDomains.some((item) => {
      const candidate = normalizeHostname(item);
      if (!candidate) {
        return false;
      }
      if (blacklistMode === "exact") {
        return normalized === candidate;
      }
      return normalized === candidate || normalized.endsWith(`.${candidate}`);
    });
  }

  function shouldShowFloatingChip({
    state,
    settings,
    environment = {},
    dismissedKeys = new Set(),
    isVisibleRect = () => true
  }) {
    const activeSettings = mergeOverlaySettings(settings);
    const selectionKey = state?.selectionKey ?? "";
    const text = state?.text?.trim() ?? "";

    if (!activeSettings.enabled) {
      return { show: false, reason: "disabled" };
    }
    if (activeSettings.displayMode === "manual") {
      return { show: false, reason: "manual_mode" };
    }
    if (text.length < activeSettings.minLength) {
      return { show: false, reason: "too_short" };
    }
    if (activeSettings.displayMode === "long_selection_only" && text.length < activeSettings.longSelectionMinLength) {
      return { show: false, reason: "below_long_selection_threshold" };
    }
    if (dismissedKeys.has(selectionKey)) {
      return { show: false, reason: "dismissed_for_selection" };
    }
    if (environment.presenterMode) {
      return { show: false, reason: "presenter_mode" };
    }
    if (isEditableTarget(environment.activeElement)) {
      return { show: false, reason: "editable_target" };
    }
    if (isDomainBlocked(environment.hostname, activeSettings.blockedDomains, activeSettings.blacklistMode)) {
      return { show: false, reason: "domain_blocked" };
    }
    if (!state?.rect || !isVisibleRect(state.rect)) {
      return { show: false, reason: "selection_not_visible" };
    }

    return {
      show: true,
      reason: "allowed"
    };
  }

  overlay.DEFAULT_OVERLAY_SETTINGS = DEFAULT_OVERLAY_SETTINGS;
  overlay.mergeOverlaySettings = mergeOverlaySettings;
  overlay.isEditableTarget = isEditableTarget;
  overlay.isDomainBlocked = isDomainBlocked;
  overlay.shouldShowFloatingChip = shouldShowFloatingChip;
})(globalThis);
