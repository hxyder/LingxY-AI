import assert from "node:assert/strict";
import {
  createRunModeCapabilities,
  planQuickActionRoute,
  standaloneProviderSupportsVision
} from "../browser_ext/background/run-mode-router.js";

const desktopCaps = createRunModeCapabilities({
  desktopAvailable: true,
  standaloneReady: true,
  standaloneConfig: { provider: "openai", runtimeUrl: "http://127.0.0.1:4310/" }
});
assert.equal(desktopCaps.runtimeBase, "http://127.0.0.1:4310");
assert.equal(desktopCaps.canDesktopTask, true);
assert.equal(desktopCaps.canStandaloneQuickText, true);
assert.equal(desktopCaps.canStandaloneVision, true);
assert.deepEqual(
  planQuickActionRoute({
    action: "uca.translate-selection",
    origin: "selection_chip",
    capabilities: desktopCaps
  }),
  {
    ok: true,
    origin: "selection_chip",
    actionKind: "text",
    ui: "inline_frame",
    transport: "desktop_task",
    mode: "desktop",
    reason: "desktop_available"
  }
);

const standaloneTextCaps = createRunModeCapabilities({
  desktopAvailable: false,
  standaloneReady: true,
  standaloneConfig: { provider: "deepseek" }
});
assert.equal(standaloneTextCaps.canStandaloneQuickText, true);
assert.equal(standaloneTextCaps.canStandaloneVision, false);
assert.equal(
  planQuickActionRoute({
    action: "summarize",
    origin: "sidepanel",
    capabilities: standaloneTextCaps,
    preferInline: false
  }).transport,
  "standalone_direct"
);
assert.equal(
  planQuickActionRoute({
    action: "uca.inspect-image",
    origin: "context_menu",
    capabilities: standaloneTextCaps
  }).reason,
  "no_vision_runtime"
);

const standaloneVisionCaps = createRunModeCapabilities({
  desktopAvailable: false,
  standaloneReady: true,
  standaloneConfig: { provider: "gemini" }
});
assert.equal(standaloneProviderSupportsVision("gemini"), true);
assert.equal(
  planQuickActionRoute({
    action: "uca.inspect-image",
    origin: "hover_chip",
    capabilities: standaloneVisionCaps
  }).transport,
  "standalone_direct"
);

const offlineCaps = createRunModeCapabilities({
  desktopAvailable: false,
  standaloneReady: false,
  standaloneConfig: null
});
assert.deepEqual(
  planQuickActionRoute({
    action: "uca.fetch-link",
    origin: "context_menu",
    capabilities: offlineCaps
  }),
  {
    ok: false,
    origin: "context_menu",
    actionKind: "link",
    ui: "error",
    transport: "none",
    mode: "offline",
    reason: "no_runtime"
  }
);

console.log("ok verify-browser-runmode-router");
