import assert from "node:assert/strict";
import {
  createRunModeCapabilities,
  isValidRoutePlan,
  planPageExplainRoute,
  planQuickActionRoute,
  standaloneProviderSupportsVision,
  validateRoutePlan
} from "../browser_ext/background/run-mode-router.js";
import {
  buildRunModeView,
  formatRouteFailureMessage
} from "../browser_ext/shared/run-mode-view.js";

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
assert.deepEqual(buildRunModeView(desktopCaps), {
  mode: "desktop",
  label: "桌面程序在线",
  detail: "使用完整桌面能力，任务会送到本地桌面 runtime 处理。",
  capabilities: [
    "本地工具与文件/RAG",
    "审批、任务队列和审计",
    "调度、连接器和生成文件"
  ]
});
assert.deepEqual(
  planPageExplainRoute({
    origin: "popup",
    capabilities: desktopCaps,
    preferSidePanel: true
  }),
  {
    ok: true,
    origin: "popup",
    actionKind: "page_explain",
    ui: "sidepanel_pending",
    transport: "desktop_page_explain",
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
assert.deepEqual(buildRunModeView({
  standaloneReady: true,
  provider: "deepseek",
  capabilities: standaloneTextCaps
}), {
  mode: "standalone",
  label: "独立模式 · deepseek",
  detail: "桌面程序未开时可临时直连模型；本地工具、文件、审批、调度和生成文件需要打开桌面程序。",
  capabilities: [
    "网页内容问答",
    "直接 LLM 对话",
    "文字快捷动作"
  ]
});
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
  planPageExplainRoute({
    origin: "keyboard",
    capabilities: standaloneTextCaps,
    preferSidePanel: false
  }).ui,
  "standalone_notification"
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
  buildRunModeView({
    standaloneReady: true,
    provider: "gemini",
    capabilities: standaloneVisionCaps
  }).capabilities.includes("图片快捷分析"),
  true
);
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
assert.equal(
  planPageExplainRoute({
    origin: "popup",
    capabilities: offlineCaps
  }).reason,
  "no_runtime"
);
assert.equal(buildRunModeView(offlineCaps).mode, "offline");
assert.equal(buildRunModeView(offlineCaps).capabilities[0], "暂无可运行后端");

const validStandaloneRoute = planQuickActionRoute({
  action: "summarize",
  origin: "verify",
  capabilities: standaloneTextCaps
});
assert.equal(isValidRoutePlan(validStandaloneRoute), true);
assert.deepEqual(validateRoutePlan(validStandaloneRoute), {
  ok: true,
  routePlan: validStandaloneRoute
});
assert.equal(validateRoutePlan({ transport: "standalone_direct" }).reason, "missing_ok");
assert.equal(validateRoutePlan({
  ok: true,
  origin: "verify",
  actionKind: "text",
  ui: "inline_frame",
  transport: "native_magic",
  mode: "desktop",
  reason: "forged"
}).reason, "invalid_transport");
assert.equal(validateRoutePlan({
  ok: true,
  origin: "verify",
  actionKind: "text",
  ui: "inline_frame",
  transport: "none",
  mode: "offline",
  reason: "forged"
}).reason, "ok_route_has_no_transport");
assert.match(formatRouteFailureMessage({ reason: "no_runtime" }), /没有可运行后端/);
assert.match(formatRouteFailureMessage({ reason: "no_vision_runtime" }), /图片分析后端/);

console.log("ok verify-browser-runmode-router");
