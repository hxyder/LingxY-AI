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
const ROUTE_TRANSPORTS = Object.freeze(new Set([
  "desktop_task",
  "desktop_page_explain",
  "standalone_direct",
  "none"
]));
const ROUTE_MODES = Object.freeze(new Set(["desktop", "standalone", "offline"]));
const ROUTE_UIS = Object.freeze(new Set([
  "inline_frame",
  "sidepanel_pending",
  "desktop_handoff",
  "standalone_notification",
  "error"
]));
const ROUTE_ACTION_KINDS = Object.freeze(new Set([
  "text",
  "link",
  "image",
  "page_explain"
]));

export function normalizeRuntimeBase(runtimeUrl = DEFAULT_RUNTIME_BASE) {
  return `${runtimeUrl || DEFAULT_RUNTIME_BASE}`.replace(/\/+$/, "");
}

export function standaloneProviderSupportsVision(provider = "") {
  return DIRECT_VISION_PROVIDERS.has(`${provider ?? ""}`.trim());
}

export function validateRoutePlan(routePlan = null) {
  if (!routePlan || typeof routePlan !== "object") {
    return { ok: false, reason: "not_object" };
  }
  if (typeof routePlan.ok !== "boolean") {
    return { ok: false, reason: "missing_ok" };
  }
  if (!ROUTE_TRANSPORTS.has(routePlan.transport)) {
    return { ok: false, reason: "invalid_transport" };
  }
  if (!ROUTE_MODES.has(routePlan.mode)) {
    return { ok: false, reason: "invalid_mode" };
  }
  if (!ROUTE_UIS.has(routePlan.ui)) {
    return { ok: false, reason: "invalid_ui" };
  }
  if (!ROUTE_ACTION_KINDS.has(routePlan.actionKind)) {
    return { ok: false, reason: "invalid_action_kind" };
  }
  if (typeof routePlan.reason !== "string" || routePlan.reason.length === 0) {
    return { ok: false, reason: "missing_reason" };
  }
  if (routePlan.ok && routePlan.transport === "none") {
    return { ok: false, reason: "ok_route_has_no_transport" };
  }
  if (!routePlan.ok && routePlan.transport !== "none") {
    return { ok: false, reason: "failed_route_has_transport" };
  }
  return { ok: true, routePlan };
}

export function isValidRoutePlan(routePlan = null) {
  return validateRoutePlan(routePlan).ok;
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

export function planPageExplainRoute({
  origin = "page_action",
  capabilities = createRunModeCapabilities(),
  preferSidePanel = true
} = {}) {
  if (capabilities.desktopAvailable) {
    return Object.freeze({
      ok: true,
      origin,
      actionKind: "page_explain",
      ui: preferSidePanel ? "sidepanel_pending" : "desktop_handoff",
      transport: "desktop_page_explain",
      mode: "desktop",
      reason: "desktop_available"
    });
  }
  if (capabilities.canStandaloneChat) {
    return Object.freeze({
      ok: true,
      origin,
      actionKind: "page_explain",
      ui: preferSidePanel ? "sidepanel_pending" : "standalone_notification",
      transport: "standalone_direct",
      mode: "standalone",
      reason: "desktop_unavailable_standalone_text"
    });
  }
  return Object.freeze({
    ok: false,
    origin,
    actionKind: "page_explain",
    ui: "error",
    transport: "none",
    mode: "offline",
    reason: "no_runtime"
  });
}
