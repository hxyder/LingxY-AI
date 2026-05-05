const DEFAULT_RUNTIME_BASE = "http://127.0.0.1:4310";
const DIRECT_VISION_PROVIDERS = Object.freeze(new Set([
  "anthropic",
  "openai",
  "doubao",
  "gemini",
  "qwen",
  "zhipu",
  "mistral",
  "siliconflow",
  "openrouter",
  "xai"
]));
const LINK_ACTIONS = Object.freeze(new Set(["uca.fetch-link", "fetch-link"]));
const IMAGE_ACTIONS = Object.freeze(new Set(["uca.inspect-image", "inspect-image"]));
const TEXT_ACTIONS = Object.freeze(new Set([
  "uca.summarize-selection",
  "uca.translate-selection",
  "summarize",
  "translate",
  "explain"
]));

export function normalizeRuntimeBase(runtimeUrl = DEFAULT_RUNTIME_BASE) {
  return `${runtimeUrl || DEFAULT_RUNTIME_BASE}`.replace(/\/+$/, "");
}

export function standaloneProviderSupportsVision(provider = "") {
  return DIRECT_VISION_PROVIDERS.has(`${provider ?? ""}`.trim());
}

export function createRunModeCapabilities({
  desktopAvailable = false,
  standaloneReady = false,
  standaloneConfig = null
} = {}) {
  const provider = `${standaloneConfig?.provider ?? ""}`.trim();
  const runtimeBase = normalizeRuntimeBase(standaloneConfig?.runtimeUrl);
  const directVisionReady = Boolean(standaloneReady && standaloneProviderSupportsVision(provider));
  return Object.freeze({
    runtimeBase,
    desktopAvailable: Boolean(desktopAvailable),
    standaloneReady: Boolean(standaloneReady),
    standaloneProvider: provider || null,
    canDesktopTask: Boolean(desktopAvailable),
    canOverlayHandoff: Boolean(desktopAvailable),
    canSidePanel: true,
    canStandaloneChat: Boolean(standaloneReady),
    canStandaloneQuickText: Boolean(standaloneReady),
    canStandaloneVision: directVisionReady,
    canPageExplain: Boolean(desktopAvailable || standaloneReady)
  });
}

export function classifyQuickAction(action = "") {
  const normalized = `${action ?? ""}`.trim();
  if (LINK_ACTIONS.has(normalized)) return "link";
  if (IMAGE_ACTIONS.has(normalized)) return "image";
  if (TEXT_ACTIONS.has(normalized)) return "text";
  return "text";
}

export function planQuickActionRoute({
  action = "",
  origin = "selection_chip",
  capabilities = createRunModeCapabilities(),
  preferInline = true
} = {}) {
  const actionKind = classifyQuickAction(action);
  if (capabilities.desktopAvailable) {
    return Object.freeze({
      ok: true,
      origin,
      actionKind,
      ui: preferInline ? "inline_frame" : "sidepanel_pending",
      transport: "desktop_task",
      mode: "desktop",
      reason: "desktop_available"
    });
  }
  if (actionKind === "image" && capabilities.canStandaloneVision) {
    return Object.freeze({
      ok: true,
      origin,
      actionKind,
      ui: preferInline ? "inline_frame" : "sidepanel_pending",
      transport: "standalone_direct",
      mode: "standalone",
      reason: "desktop_unavailable_standalone_vision"
    });
  }
  if (actionKind !== "image" && capabilities.canStandaloneQuickText) {
    return Object.freeze({
      ok: true,
      origin,
      actionKind,
      ui: preferInline ? "inline_frame" : "sidepanel_pending",
      transport: "standalone_direct",
      mode: "standalone",
      reason: "desktop_unavailable_standalone_text"
    });
  }
  return Object.freeze({
    ok: false,
    origin,
    actionKind,
    ui: "error",
    transport: "none",
    mode: "offline",
    reason: actionKind === "image" ? "no_vision_runtime" : "no_runtime"
  });
}
