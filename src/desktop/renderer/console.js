import {
  formatTaskEventSummary,
  isInternalControlJsonText,
  looksLikeInternalControlJsonText,
  subscribeTaskEvents,
  toTaskEventFrame
} from "./task-event-stream.js";
import {
  buildScheduleActionFromText,
  parseScheduleTriggerFromText
} from "./schedule-parser.js";
import {
  createClientMessageId as cacheCreateClientMessageId,
  createConversationId as cacheCreateConversationId,
  ensureBackendCacheFields as cacheEnsureBackendFields,
  cssEscape as cacheCssEscape,
  applyMessageBatch as cacheApplyBatch,
  fetchMessagesSince as cacheFetchSince,
  fetchConversations as cacheFetchConversations,
  fetchConversationDetail as cacheFetchConversationDetail
} from "./conversation-cache.mjs";
import {
  artifactExtension,
  artifactIconClass,
  artifactIconText,
  createBottomPinController,
  escapeHtml,
  formatArtifactLabel as formatSharedArtifactLabel,
  formatDateTime as formatSharedDateTime,
  formatRelativeTime
} from "./shared-ui.mjs";
import {
  getMcpSourceView
} from "./mcp-source-view.mjs";
import {
  renderChatSidebarListHtml
} from "./console-chat-sidebar.mjs";
import {
  renderConversationDetailView,
  renderConversationsListHtml
} from "./console-conversation-viewer.mjs";
import {
  extractTaskProviderInfo,
  renderDowngradedWarning,
  renderTimelineEntry
} from "./console-task-timeline.mjs";
import {
  buildTaskListEntries,
  isCompositeChildTask,
  renderTaskListItemHtml,
  taskListSignature
} from "./console-task-list.mjs";
import {
  filterFileArtifacts,
  renderFilesListHtml,
  renderTaskArtifactRowsHtml
} from "./console-files-view.mjs";
import {
  renderTaskKvGrid
} from "./console-task-detail.mjs";
import {
  createConsoleTaskEventController
} from "./console-task-event-stream.mjs";
import {
  exportAsHtml,
  exportAsMarkdown,
  exportAsText,
  formatNoteAbsoluteTime as fmtAbsolute,
  formatNoteRelativeTime as fmtRel,
  makeNote,
  noteFilename,
  nowIso,
  stripHtml
} from "./console-notes-model.mjs";
import {
  formatProjectConversationPreview,
  renderProjectConversationListHtml,
  renderProjectListHtml
} from "./console-projects-view.mjs";
import {
  BUILTIN_API_TEMPLATES,
  codeCliModelChoices,
  modeOptionsForProvider as catalogModeOptionsForProvider,
  reasoningOptionsForProvider as catalogReasoningOptionsForProvider,
  providerFingerprint,
  providerModelPresets
} from "../../shared/provider-catalog.mjs";
import {
  DEFAULT_PROJECT_ID,
  buildProject,
  createProjectId,
  buildDefaultProjectStore as buildDefaultProjectStoreBase,
  normalizeProjectStore as normalizeProjectStoreBase,
  mergeProjectStores as mergeProjectStoresBase
} from "../../shared/project-store.mjs";

const runtimeState = document.querySelector("#runtimeState");
const summaryGrid = document.querySelector("#summaryGrid");
const integrationList = document.querySelector("#integrationList");
const refreshButton = document.querySelector("#refreshButton");
const openOverlayButton = document.querySelector("#openOverlayButton");
const locationButton = document.querySelector("#locationButton");
const onboardingState = document.querySelector("#onboardingState");
const wizardList = document.querySelector("#wizardList");
const taskComposer = document.querySelector("#taskComposer");
const commandInput = document.querySelector("#commandInput");
const submitState = document.querySelector("#submitState");
const taskCount = document.querySelector("#taskCount");
const taskList = document.querySelector("#taskList");
const taskDetailSummary = document.querySelector("#taskDetailSummary");
const taskChildCount = document.querySelector("#taskChildCount");
const taskChildList = document.querySelector("#taskChildList");
const taskTimeline = document.querySelector("#taskTimeline");
const taskArtifactCount = document.querySelector("#taskArtifactCount");
const taskArtifactList = document.querySelector("#taskArtifactList");
const taskArtifactPreview = document.querySelector("#taskArtifactPreview");
const openTaskArtifactButton = document.querySelector("#openTaskArtifactButton");
const copyTaskArtifactPathButton = document.querySelector("#copyTaskArtifactPathButton");
const useTaskArtifactContextButton = document.querySelector("#useTaskArtifactContextButton");
const retryTaskButton = document.querySelector("#retryTaskButton");
const cancelTaskButton = document.querySelector("#cancelTaskButton");
const approvalCount = document.querySelector("#approvalCount");
const approvalList = document.querySelector("#approvalList");
const scheduleCount = document.querySelector("#scheduleCount");
const scheduleList = document.querySelector("#scheduleList");
const scheduleForm = document.querySelector("#scheduleForm");
const scheduleWhenInput = document.querySelector("#scheduleWhenInput");
const scheduleCommandInput = document.querySelector("#scheduleCommandInput");
const scheduleCreateState = document.querySelector("#scheduleCreateState");
const scheduleSearchInput = document.querySelector("#scheduleSearchInput");
const templateCount = document.querySelector("#templateCount");
const templateList = document.querySelector("#templateList");
const templateForm = document.querySelector("#templateForm");
const templateNameInput = document.querySelector("#templateNameInput");
const templatePromptInput = document.querySelector("#templatePromptInput");
const templateImportInput = document.querySelector("#templateImportInput");
const importTemplateButton = document.querySelector("#importTemplateButton");
const deleteTemplateButton = document.querySelector("#deleteTemplateButton");
const templateState = document.querySelector("#templateState");
const templatePreview = document.querySelector("#templatePreview");
const previewDagButton = document.querySelector("#previewDagButton");
const loadSampleDagButton = document.querySelector("#loadSampleDagButton");
const dagEditorInput = document.querySelector("#dagEditorInput");
const dagPreview = document.querySelector("#dagPreview");
const dagExecutionCount = document.querySelector("#dagExecutionCount");
const dagExecutionList = document.querySelector("#dagExecutionList");
const budgetSummary = document.querySelector("#budgetSummary");
const budgetForm = document.querySelector("#budgetForm");
const monthlyBudgetInput = document.querySelector("#monthlyBudgetInput");
const budgetState = document.querySelector("#budgetState");
// UCA-121: #panel-history retired. Safe-null refs kept for any
// remaining callers; everything below is `?.` optional-chained.
const historyForm = null;
const historyQueryInput = null;
const historyList = null;
const historyPreview = null;
const projectCount = document.querySelector("#projectCount");
const projectList = document.querySelector("#projectList");
const projectConversationCount = document.querySelector("#projectConversationCount");
const projectConversationList = document.querySelector("#projectConversationList");
const projectConversationPreview = document.querySelector("#projectConversationPreview");
const projectCreateForm = document.querySelector("#projectCreateForm");
const projectNameInput = document.querySelector("#projectNameInput");
const projectState = document.querySelector("#projectState");
const privacyState = document.querySelector("#privacyState");
const killSwitchToggle = document.querySelector("#killSwitchToggle");
const offlineModeToggle = document.querySelector("#offlineModeToggle");
const presenterModeToggle = document.querySelector("#presenterModeToggle");
const redactionRuleList = document.querySelector("#redactionRuleList");
const retentionList = document.querySelector("#retentionList");
const auditCount = document.querySelector("#auditCount");
const auditList = document.querySelector("#auditList");
const officeAddinSetupState = document.querySelector("#officeAddinSetupState");
const checkOfficeAddinsButton = document.querySelector("#checkOfficeAddinsButton");
const setupOfficeAddinsButton = document.querySelector("#setupOfficeAddinsButton");
const mcpServerCount = document.querySelector("#mcpServerCount");
const mcpServerForm = document.querySelector("#mcpServerForm");
const mcpServerId = document.querySelector("#mcpServerId");
const mcpServerName = document.querySelector("#mcpServerName");
const mcpTransport = document.querySelector("#mcpTransport");
const mcpCommand = document.querySelector("#mcpCommand");
const mcpArgs = document.querySelector("#mcpArgs");
const mcpServerState = document.querySelector("#mcpServerState");
const mcpServerList = document.querySelector("#mcpServerList");
const mcpServerRefreshBtn = document.querySelector("#mcpServerRefreshBtn");
const mcpServerTestBtn = document.querySelector("#mcpServerTestBtn");
const mcpInstallSource = document.querySelector("#mcpInstallSource");
const mcpInstallPlanBtn = document.querySelector("#mcpInstallPlanBtn");
const mcpInstallRunBtn = document.querySelector("#mcpInstallRunBtn");
const mcpInstallPlanSummary = document.querySelector("#mcpInstallPlanSummary");
const mcpInstallPlanState = document.querySelector("#mcpInstallPlanState");
const mcpInstallRunState = document.querySelector("#mcpInstallRunState");
const mcpInstallPackageDir = document.querySelector("#mcpInstallPackageDir");
const mcpInstallPreviewBtn = document.querySelector("#mcpInstallPreviewBtn");
const mcpInstallPreviewSummary = document.querySelector("#mcpInstallPreviewSummary");
const mcpInstallPreviewState = document.querySelector("#mcpInstallPreviewState");
const skillRegistryCount = document.querySelector("#skillRegistryCount");
const skillRegistryForm = document.querySelector("#skillRegistryForm");
const skillRegistryId = document.querySelector("#skillRegistryId");
const skillRegistryName = document.querySelector("#skillRegistryName");
const skillRegistryPath = document.querySelector("#skillRegistryPath");
const skillRegistryState = document.querySelector("#skillRegistryState");
const skillRegistryList = document.querySelector("#skillRegistryList");
const skillRegistryRefreshBtn = document.querySelector("#skillRegistryRefreshBtn");
const skillRegistryTestBtn = document.querySelector("#skillRegistryTestBtn");
const codeCliAdapterCount = document.querySelector("#codeCliAdapterCount");
const codeCliAdapterForm = document.querySelector("#codeCliAdapterForm");
const codeCliAdapterId = document.querySelector("#codeCliAdapterId");
const codeCliAdapterName = document.querySelector("#codeCliAdapterName");
const codeCliAdapterCommand = document.querySelector("#codeCliAdapterCommand");
const codeCliAdapterModel = document.querySelector("#codeCliAdapterModel");
const codeCliAdapterArgs = document.querySelector("#codeCliAdapterArgs");
const codeCliAdapterTransport = document.querySelector("#codeCliAdapterTransport");
const codeCliAdapterMcpFiles = document.querySelector("#codeCliAdapterMcpFiles");
const codeCliAdapterState = document.querySelector("#codeCliAdapterState");
const codeCliAdapterList = document.querySelector("#codeCliAdapterList");
const codeCliAdapterRefreshBtn = document.querySelector("#codeCliAdapterRefreshBtn");
const emailAccountCount = document.querySelector("#emailAccountCount");
const emailAccountForm = document.querySelector("#emailAccountForm");
const emailAccountId = document.querySelector("#emailAccountId");
const emailAccountEmail = document.querySelector("#emailAccountEmail");
const emailAccountName = document.querySelector("#emailAccountName");
const emailAccountProvider = document.querySelector("#emailAccountProvider");
const emailAccountAuthType = document.querySelector("#emailAccountAuthType");
const emailAccountHost = document.querySelector("#emailAccountHost");
const emailAccountPort = document.querySelector("#emailAccountPort");
const emailAccountSecret = document.querySelector("#emailAccountSecret");
const emailAccountState = document.querySelector("#emailAccountState");
const emailAccountList = document.querySelector("#emailAccountList");
const emailAccountRefreshBtn = document.querySelector("#emailAccountRefreshBtn");
const emailDigestEnabled = document.querySelector("#emailDigestEnabled");
const emailDigestWindowStart = document.querySelector("#emailDigestWindowStart");
const emailDigestWindowEnd = document.querySelector("#emailDigestWindowEnd");
const emailDigestSkipWeekends = document.querySelector("#emailDigestSkipWeekends");
const emailDigestSaveBtn = document.querySelector("#emailDigestSaveBtn");
const emailDigestState = document.querySelector("#emailDigestState");
const consoleChatForm = document.querySelector("#consoleChatForm");
const consoleChatInput = document.querySelector("#consoleChatInput");
const consoleChatMessages = document.querySelector("#consoleChatMessages");
const consoleChatScrollDownBtn = document.querySelector("#consoleChatScrollDown");
const consoleChatState = document.querySelector("#consoleChatState");
const consoleChatAttachBtn = document.querySelector("#consoleChatAttachBtn");
const consoleChatVoiceBtn = document.querySelector("#consoleChatVoiceBtn");
const consoleChatModelChipLabel = document.querySelector("#consoleChatModelChipLabel");
const consoleChatAttachInput = document.querySelector("#consoleChatAttachInput");
const consoleChatAttachments = document.querySelector("#consoleChatAttachments");
const consoleChatAttachList = [];
const skillEditModal = document.querySelector("#skillEditModal");
const skillEditText = document.querySelector("#skillEditText");
const skillEditPath = document.querySelector("#skillEditPath");
const skillEditState = document.querySelector("#skillEditState");
const skillEditSaveBtn = document.querySelector("#skillEditSaveBtn");
const skillEditCloseBtn = document.querySelector("#skillEditCloseBtn");

const consoleChatPin = createBottomPinController(consoleChatMessages, {
  button: consoleChatScrollDownBtn
});

/* ═══════════════════════════════════════════════
   TOAST + CONTEXT MENU (shared)
   ═══════════════════════════════════════════════ */

const consoleToastHost = document.querySelector("#consoleToastHost");

// Lightweight floating toast. Replaces the older pattern of writing
// flash messages into consoleChatState/.textContent — that text was
// easy to miss and fought with composer status. kind: "info" | "ok" |
// "err". Auto-dismisses; click to dismiss early.
function showConsoleToast(message, { kind = "info", durationMs = 3200 } = {}) {
  if (!consoleToastHost || !message) return;
  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;
  toast.setAttribute("role", "status");
  const glyphMap = {
    ok: "✓",
    err: "!",
    info: "i"
  };
  toast.innerHTML = `
    <span class="toast-glyph">${glyphMap[kind] ?? "i"}</span>
    <span class="toast-body"></span>
  `;
  toast.querySelector(".toast-body").textContent = String(message);
  consoleToastHost.appendChild(toast);
  let timer = setTimeout(dismiss, durationMs);
  function dismiss() {
    clearTimeout(timer);
    if (!toast.isConnected) return;
    toast.classList.add("toast--leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }
  toast.addEventListener("click", dismiss);
}

// Singleton context-menu element. Each surface (chat panel, etc.)
// installs its own contextmenu listener that calls openCtxMenu with a
// list of items + the click coordinates.
const chatCtxMenu = document.querySelector("#chatCtxMenu");
function closeCtxMenu() {
  if (!chatCtxMenu) return;
  chatCtxMenu.hidden = true;
  chatCtxMenu.innerHTML = "";
}
function openCtxMenu(items, x, y) {
  if (!chatCtxMenu) return;
  chatCtxMenu.innerHTML = items.map((item) => {
    if (item.separator) return `<div class="ctx-sep" role="separator"></div>`;
    return `
      <button type="button" class="ctx-item" role="menuitem" data-act="${item.id}">
        <span class="ctx-glyph">${item.glyph ?? ""}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `;
  }).join("");
  chatCtxMenu.hidden = false;
  // Initial position — clamp to viewport so the menu stays on-screen
  // when the click is near the right/bottom edge.
  const rect = chatCtxMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  chatCtxMenu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  chatCtxMenu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  // Wire the click handlers fresh each open.
  for (const btn of chatCtxMenu.querySelectorAll("[data-act]")) {
    btn.addEventListener("click", () => {
      const item = items.find((i) => i.id === btn.dataset.act);
      closeCtxMenu();
      try { item?.onClick?.(); } catch (error) {
        showConsoleToast(`操作失败：${error?.message ?? error}`, { kind: "err" });
      }
    });
  }
}
document.addEventListener("click", (event) => {
  if (chatCtxMenu && !chatCtxMenu.hidden && !chatCtxMenu.contains(event.target)) {
    closeCtxMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chatCtxMenu && !chatCtxMenu.hidden) closeCtxMenu();
});
window.addEventListener("blur", closeCtxMenu);
window.addEventListener("scroll", closeCtxMenu, true);

// Wire chat-bubble contextmenu — one delegated listener on the chat
// messages container so it covers existing + future bubbles.
consoleChatMessages?.addEventListener("contextmenu", (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const wrapper = target?.closest?.(".chat-msg");
  if (!wrapper) return;
  event.preventDefault();
  const role = wrapper.classList.contains("user") ? "user"
    : wrapper.classList.contains("assistant") || wrapper.classList.contains("ai") ? "assistant"
    : "system";
  if (role === "system") return; // system bubbles aren't actionable
  const bubble = wrapper.querySelector(".chat-msg-bubble");
  const text = bubble?.dataset.rawText || bubble?.textContent || "";
  const taskId = wrapper.dataset.taskId || null;
  const items = [
    { id: "copy", label: "复制", glyph: "⧉", onClick: () => {
      try { navigator.clipboard?.writeText?.(text); } catch { /* ignore */ }
      showConsoleToast("已复制到剪贴板", { kind: "ok" });
    }},
    { id: "quote", label: "引用并回复", glyph: "›", onClick: () => {
      const quoted = String(text).split("\n").map((line) => `> ${line}`).join("\n");
      const prefix = consoleChatInput.value.trim() ? `${consoleChatInput.value}\n\n` : "";
      consoleChatInput.value = `${prefix}${quoted}\n\n`;
      consoleChatInput.focus();
      consoleChatInput.setSelectionRange(consoleChatInput.value.length, consoleChatInput.value.length);
      // Make the result visible — the composer is at the bottom of the
      // chat panel and may be off-screen on a long thread. Smooth-scroll
      // it into view + flash the focus ring so the user can see where
      // the quote landed.
      try { consoleChatInput.scrollIntoView({ behavior: "smooth", block: "end" }); } catch { /* ignore */ }
      consoleChatInput.classList.add("composer-flash");
      setTimeout(() => consoleChatInput.classList.remove("composer-flash"), 1200);
      showConsoleToast("已引用到输入框", { kind: "info", durationMs: 1600 });
    }},
    { id: "note", label: "添加到 Note", glyph: "+", onClick: () => {
      openNoteTargetPicker(text, wrapper);
    }}
  ];
  if (role === "assistant" && taskId) {
    items.push({ separator: true });
    items.push({ id: "regen", label: "重新生成", glyph: "↻", onClick: () => {
      void regenerateConsoleChatTask(taskId, null);
    }});
  }
  openCtxMenu(items, event.clientX, event.clientY);
});

/* ═══════════════════════════════════════════════
   TAB NAVIGATION
   ═══════════════════════════════════════════════ */

// UCA-107: Rail items + any legacy .tab-btn still use data-tab; query by
// that attribute so rail-items and tab-btns converge into one list.
const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll(".tab-panel");

// UCA-125 Phase 1: PANEL_INTROS and installPanelIntros() have been retired.
// Every tab panel now has a static <header class="page-head"> with h1 + sub
// in console.html, matching the v3 design reference. Dynamic injection was
// removing control from the markup and producing a three-line eyebrow /
// title / subtitle that duplicated the topbar breadcrumb.

function applyConsoleInformationArchitecture() {
  const connectorsConfigMount = document.querySelector("#connectorsConfigMount");
  const emailAdvancedMount = document.querySelector("#emailAdvancedMount");
  if (!connectorsConfigMount) return;

  const connectorPanelIds = [
    "integrationsStatusPanel",
    "mcpSettingsPanel",
    "skillsSettingsPanel",
    "codeCliSettingsPanel",
    "officeSetupPanel"
  ];

  for (const panelId of connectorPanelIds) {
    const panel = document.querySelector(`#${panelId}`);
    if (panel && panel.parentElement !== connectorsConfigMount) {
      connectorsConfigMount.appendChild(panel);
    }
  }

  const emailPanel = document.querySelector("#emailSettingsPanel");
  if (emailAdvancedMount && emailPanel && emailPanel.parentElement !== emailAdvancedMount) {
    emailPanel.classList.add("email-manual-panel", "manual-config-collapsed");
    emailPanel.querySelector("#emailDigestEnabled")?.closest(".stack")?.setAttribute("hidden", "");
    const title = emailPanel.querySelector(".settings-group-title");
    if (title) title.textContent = "Manual IMAP setup";
    if (!emailPanel.querySelector("[data-manual-config-toggle]")) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "secondary manual-config-toggle";
      toggle.dataset.manualConfigToggle = "emailSettingsPanel";
      toggle.textContent = "Show manual setup";
      emailPanel.insertBefore(toggle, emailPanel.children[1] ?? null);
    }
    emailAdvancedMount.appendChild(emailPanel);
  }

  for (const panelId of ["mcpSettingsPanel", "skillsSettingsPanel"]) {
    const panel = document.querySelector(`#${panelId}`);
    if (!panel || panel.querySelector("[data-manual-config-toggle]")) continue;
    panel.classList.add("manual-config-collapsed");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary manual-config-toggle";
    toggle.dataset.manualConfigToggle = panelId;
    toggle.textContent = panelId === "mcpSettingsPanel" ? "Manual MCP setup" : "Manual skill registry";
    panel.insertBefore(toggle, panel.querySelector("form"));
  }

  document.querySelectorAll("[data-manual-config-toggle]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const panel = document.querySelector(`#${button.dataset.manualConfigToggle}`);
      if (!panel) return;
      const open = panel.classList.toggle("manual-config-open");
      panel.classList.toggle("manual-config-collapsed", !open);
      if (button.dataset.manualConfigToggle === "emailSettingsPanel") {
        button.textContent = open ? "Hide manual setup" : "Show manual setup";
      }
    });
  });
}

applyConsoleInformationArchitecture();

// UCA-107: Rail collapse toggle + persisted rail state + persisted
// current view. Reads from localStorage on boot, writes on interaction.
(() => {
  const railToggle = document.querySelector("#railToggle");
  const railToggleLabel = railToggle?.querySelector(".rail-toggle-label");
  const railToggleIcon = railToggle?.querySelector("svg");

  function applyRailState(state) {
    document.body.setAttribute("data-rail", state);
    if (railToggleLabel) railToggleLabel.textContent = state === "collapsed" ? "Expand" : "Collapse";
    if (railToggle) railToggle.setAttribute("aria-label", state === "collapsed" ? "Expand sidebar" : "Collapse sidebar");
    if (railToggleIcon) {
      railToggleIcon.style.transform = state === "collapsed" ? "rotate(180deg)" : "";
    }
  }

  try {
    const stored = localStorage.getItem("lingxy.rail");
    applyRailState(stored === "collapsed" ? "collapsed" : "expanded");
  } catch { applyRailState("expanded"); }

  railToggle?.addEventListener("click", () => {
    const next = document.body.getAttribute("data-rail") === "collapsed" ? "expanded" : "collapsed";
    applyRailState(next);
    try { localStorage.setItem("lingxy.rail", next); } catch { /* ignore */ }
  });

  // Restore the last visited view. UCA-121: "history" was retired;
  // if someone's localStorage still points there, silently reset.
  try {
    let savedView = localStorage.getItem("lingxy.view");
    if (savedView === "history") {
      savedView = "tasks";
      localStorage.setItem("lingxy.view", "tasks");
    }
    if (savedView && document.querySelector(`[data-tab="${savedView}"]`)) {
      // Defer to next frame so any page-load hooks (applyConsoleInfo…
      // etc) finish their own default state first.
      requestAnimationFrame(() => switchTab(savedView));
    }
  } catch { /* ignore */ }
})();

// UCA-117: map view id → English breadcrumb label shown in the v3 topbar.
// UCA-121: "history" dropped; Memory page retired.
// UCA-126: "advanced" retired — Templates / Budget / Audit moved into
// Settings; DAG frontend removed (backend APIs retained). Any stale
// localStorage pointing to "advanced" is rerouted to "settings" in
// switchTab() below.
const VIEW_CRUMBS = {
  tasks: "Tasks", chat: "Chat", files: "Files", schedules: "Schedules",
  projects: "Projects", notes: "Notes",
  connectors: "Connectors", inbox: "Inbox",
  settings: "Settings"
};

function switchTab(tabId) {
  // UCA-126: reroute retired "advanced" to settings so stale localStorage
  // or deep links don't land on an empty panel.
  if (tabId === "advanced") tabId = "settings";
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    // UCA-107: the rail uses aria-current="page" as the active marker;
    // keep both attributes in sync so styling hooks (either the old
    // tab-btn.active ruleset or the rail's [aria-current] rule) fire.
    if (isActive) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${tabId}`));
  // UCA-117: reflect the current view in the topbar breadcrumb.
  const crumb = document.querySelector("#topCrumb");
  if (crumb) crumb.textContent = VIEW_CRUMBS[tabId] ?? tabId;
  // UCA-178: boot the Notes module when its tab becomes active (handles
  // both rail clicks and saved-view restore on startup).
  if (tabId === "notes" && typeof initNotesIfNeeded === "function") initNotesIfNeeded();
  // UCA-107: persist the selection so the app boots back to where you left.
  try { localStorage.setItem("lingxy.view", tabId); } catch { /* sandbox: ignore */ }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === "files") {
      void loadAllArtifacts();
    } else if (btn.dataset.tab === "projects") {
      renderProjectsWorkspace();
      void syncConsoleProjectStoreFromService({ rerender: true });
    } else if (btn.dataset.tab === "connectors") {
      void loadConnectorsTab();
    } else if (btn.dataset.tab === "inbox") {
      void loadInboxTab();
    } else if (btn.dataset.tab === "notes") {
      initNotesIfNeeded();
    } else if (btn.dataset.tab === "conversations") {
      void loadConversationsTab();
    } else if (btn.dataset.tab === "chat") {
      // Phase 2: refresh the chat sidebar's conversation list each
      // time the user enters the tab so newly-created conversations
      // show up without a full reload.
      void refreshChatSidebar({ force: true });
    }
  });
});

/* ═══════════════════════════════════════════════
   THEME SYSTEM
   ═══════════════════════════════════════════════ */

// UCA-111 (Phase 4f-1): Theme switching only. Tweaks panel retired —
// user asked for "normal theme switching" so we keep the topbar
// swatches and drop the accent/density pickers. The underlying
// [data-accent] / [data-density] tokens stay in tokens.css and
// default to amber + roomy; power users can still flip them via
// devtools but there's no dedicated UI.
const THEMES = ["default", "dark"];
const THEME_KEY = "uca-console-theme";

function applyTheme(themeValue) {
  const t = THEMES.includes(themeValue) ? themeValue : "default";
  if (t === "default") {
    document.documentElement.removeAttribute("data-theme");
    document.body.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", t);
    document.body.setAttribute("data-theme", t);
  }
  document.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.classList.toggle("ts-active", btn.dataset.themeValue === t);
  });
  try {
    localStorage.setItem(THEME_KEY, t);
    localStorage.setItem("lingxy.theme", t);
  } catch { /* ignore */ }
}

// Apply saved theme on load.
applyTheme((() => {
  try { return localStorage.getItem("lingxy.theme") ?? localStorage.getItem(THEME_KEY) ?? "default"; }
  catch { return "default"; }
})());

// Wire topbar swatch clicks.
document.querySelectorAll(".theme-swatch").forEach((btn) => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.themeValue));
});

// External navigation request (e.g., overlay's settings shortcut button)
if (window.ucaShell?.onNavigateConsole) {
  window.ucaShell.onNavigateConsole((payload = {}) => {
    const tabId = typeof payload.tabId === "string" ? payload.tabId : "settings";
    switchTab(tabId);
    if (tabId === "projects") {
      renderProjectsWorkspace();
      void syncConsoleProjectStoreFromService({ rerender: true });
    } else if (tabId === "connectors") {
      void loadConnectorsTab();
    } else if (tabId === "notes") {
      // Lazy-init the notes module so window.lingxyNotes is ready, then
      // honor an optional appendChip handoff from the overlay window.
      if (typeof initNotesIfNeeded === "function") initNotesIfNeeded();
      if (typeof payload.appendChip === "string" && payload.appendChip.trim()) {
        const api = window.lingxyNotes;
        if (api) {
          const target = api.list()[0]?.id || api.createNote();
          api.addToNote(target, payload.appendChip);
        }
      }
    }
  });
}

/* ═══════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════ */

const state = {
  serviceBaseUrl: new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310",
  workspace: {
    health: null,
    tasks: [],
    approvals: [],
    schedules: [],
    templates: [],
    budget: null,
    providers: [],
    codeCliAdapters: [],
    mcpServers: [],
    skillRegistries: [],
    skills: [],
    emailAccounts: [],
    emailDigestSettings: {},
    history: [],
    security: null,
    audit: [],
    dagExecutions: []
  },
  selectedTaskId: null,
  // UCA-108: Tasks page filter/search state.
  taskFilter: "all", // all | running | queued | success | errors
  taskSearch: "",
  // UCA-121: Memory/history absorbed into Tasks via these two filters.
  taskDateFilter: "all", // all | today | 7d | 30d
  taskSourceFilter: "all", // dynamic (aggregates from state.workspace.tasks)
  selectedTemplateId: null,
  currentHistoryQuery: "",
  detailVersion: 0,
  updatingSecurity: false,
  selectedDagExecutionId: null,
  selectedTaskDetail: null,
  selectedTaskArtifactPath: null,
  selectedProjectId: null,
  selectedProjectConversationId: null,
  projectStore: null,
  projectStoreRemoteReady: false,
  projectStoreSyncing: false
};

let consoleChatEventStream = null;
let consoleChatResultTaskIds = new Set();
// Track the in-flight chat task so the composer can flip the Send
// button to a Stop button while events stream. Cleared on terminal
// events (success / failed / cancelled / partial_success).
let consoleChatActiveTaskId = null;
let consoleChatCancellationRequestedTaskId = null;
const consoleChatSendBtn = document.querySelector("#consoleChatSendBtn");

function refreshConsoleChatSendBtnMode() {
  if (!consoleChatSendBtn) return;
  const running = Boolean(consoleChatActiveTaskId);
  const cancelling = running
    && consoleChatCancellationRequestedTaskId === consoleChatActiveTaskId;
  consoleChatSendBtn.classList.toggle("btn-stop", running && !cancelling);
  consoleChatSendBtn.classList.toggle("btn-cancelling", cancelling);
  if (cancelling) {
    consoleChatSendBtn.innerHTML = `取消中…<span class="zh">再次点击强制</span>`;
    consoleChatSendBtn.title = "再次点击强制取消";
  } else if (running) {
    consoleChatSendBtn.innerHTML = `停止<span class="zh">Stop</span>`;
    consoleChatSendBtn.title = "停止当前任务";
  } else {
    consoleChatSendBtn.innerHTML = `Send<span class="zh">发送</span>`;
    consoleChatSendBtn.title = "发送 (Enter)";
  }
}

const selectedTaskEventController = createConsoleTaskEventController({
  state,
  documentRef: document,
  renderSummary,
  renderTasks,
  renderTaskDetail,
  refreshTaskDetail,
  refreshWorkspace,
  surfaceApprovalPopup
});

async function cancelConsoleChatActiveTask() {
  const taskId = consoleChatActiveTaskId;
  if (!taskId) return;
  const force = consoleChatCancellationRequestedTaskId === taskId;
  consoleChatCancellationRequestedTaskId = taskId;
  refreshConsoleChatSendBtnMode();
  try {
    await cancelTaskViaShell(taskId, { force });
    showConsoleToast(force ? "已强制取消" : "已请求取消任务", { kind: force ? "ok" : "info" });
  } catch (error) {
    showConsoleToast(`取消失败：${error?.message ?? error}`, { kind: "err" });
  }
}
let consoleChatToolCardCounter = 0;
let consoleChatToolCards = new Map();
let consoleChatThinkingCard = null;
let consoleChatThinkingText = "";
let consoleChatStreamingAnswer = null;
let consoleChatProgressEventIds = new Set();
// G: console chat resume state. The chat composer threads this
// conversation_id on every submit, so back-and-forth in the same
// conversation hangs together server-side. New chat clears it.
let consoleActiveConversation = null;
const scheduleRunTaskWatchers = new Map();
const completedScheduleRunTaskIds = new Set();
const surfacedApprovalPopupIds = new Set();
const surfacingApprovalPopupIds = new Set();
let editingSkillPath = null;

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */

const CHAT_MARKDOWN_LINK_RE = /\[([^\]\n]{1,240})\]\((https?:\/\/[^\s<>"']{1,2000}?)\)/gi;
const CHAT_BARE_URL_RE = /https?:\/\/[^\s<>"']+/gi;
const CHAT_TRAILING_URL_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", "，", "。", "！", "？", "；", "：", "、"]);

function normalizeExternalUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function countChars(value, char) {
  return Array.from(String(value ?? "")).filter((c) => c === char).length;
}

function splitTrailingUrlPunctuation(rawUrl = "") {
  let url = String(rawUrl ?? "");
  let trailing = "";
  while (url) {
    const last = url.at(-1);
    const shouldTrimBracket =
      (last === ")" && countChars(url, ")") > countChars(url, "("))
      || (last === "]" && countChars(url, "]") > countChars(url, "["))
      || (last === "）" && countChars(url, "）") > countChars(url, "（"));
    if (!CHAT_TRAILING_URL_PUNCTUATION.has(last) && !shouldTrimBracket) break;
    trailing = last + trailing;
    url = url.slice(0, -1);
  }
  return { url, trailing };
}

function appendChatExternalLink(parent, href, label) {
  const normalized = normalizeExternalUrl(href);
  if (!normalized) {
    parent.appendChild(document.createTextNode(label ?? href ?? ""));
    return;
  }
  const a = document.createElement("a");
  a.href = normalized;
  a.textContent = label || href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.className = "chat-link";
  parent.appendChild(a);
}

function appendChatLinkifiedText(parent, text = "") {
  const source = String(text ?? "");
  let lastIndex = 0;
  CHAT_BARE_URL_RE.lastIndex = 0;
  for (const match of source.matchAll(CHAT_BARE_URL_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parent.appendChild(document.createTextNode(source.slice(lastIndex, index)));
    }
    const { url, trailing } = splitTrailingUrlPunctuation(match[0]);
    appendChatExternalLink(parent, url, url);
    if (trailing) parent.appendChild(document.createTextNode(trailing));
    lastIndex = index + match[0].length;
  }
  if (lastIndex < source.length) {
    parent.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
}

function renderConsoleChatBubbleContent(bubble, text = "") {
  if (!bubble) return;
  const source = String(text ?? "");
  bubble.dataset.rawText = source;
  bubble.replaceChildren();

  let lastIndex = 0;
  CHAT_MARKDOWN_LINK_RE.lastIndex = 0;
  for (const match of source.matchAll(CHAT_MARKDOWN_LINK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      appendChatLinkifiedText(bubble, source.slice(lastIndex, index));
    }
    appendChatExternalLink(bubble, match[2], match[1]);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < source.length) {
    appendChatLinkifiedText(bubble, source.slice(lastIndex));
  }
}

async function openConsoleChatExternalLink(anchor) {
  const href = normalizeExternalUrl(anchor?.getAttribute?.("href") ?? anchor?.href ?? "");
  if (!href) return false;
  try {
    if (window.ucaShell?.openExternal) {
      await window.ucaShell.openExternal(href);
      return true;
    }
    window.open(href, "_blank", "noopener,noreferrer");
    return true;
  } catch (error) {
    showConsoleToast(`Failed to open link: ${error.message}`, { kind: "err" });
    return false;
  }
}

consoleChatMessages?.addEventListener("click", (ev) => {
  const target = ev.target instanceof Element ? ev.target : null;
  const anchor = target?.closest?.("a[href]");
  if (!anchor || !consoleChatMessages.contains(anchor)) return;
  ev.preventDefault();
  void openConsoleChatExternalLink(anchor);
});

function slugify(value) {
  const normalized = `${value ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "template";
}

function buildSampleDag() {
  return {
    nodes: [
      { id: "extract", target: "browser" },
      { id: "summarize", target: "kimi_cli" },
      { id: "report", target: "template.email.draft" }
    ],
    edges: [
      { from: "extract", to: "summarize" },
      { from: "summarize", to: "report" }
    ]
  };
}

function parseScheduleTriggerInput(text) {
  return parseScheduleTriggerFromText(text, { fallback: "natural_language" });
}

/* ═══════════════════════════════════════════════
   Schedule time picker — reusable across create form + edit popover.
   Four modes:
     natural — raw text → backend NL parser (existing path)
     once    — datetime-local → { type: "at", run_at, timezone }
     daily   — HH:MM time → cron "M H * * *"
     weekly  — day-of-week chips + HH:MM → cron "M H * * dow,…"
   buildSchedulePickerHtml() returns the DOM string; pass a unique
   `prefix` per instance so multiple pickers can co-exist.
   readSchedulePicker(root) returns the structured trigger or null
   when the active mode's required fields aren't filled.
   ═══════════════════════════════════════════════ */
function buildSchedulePickerHtml({ prefix = "schedPicker", initialNatural = "" } = {}) {
  const dows = [
    { v: "1", label: "一" },
    { v: "2", label: "二" },
    { v: "3", label: "三" },
    { v: "4", label: "四" },
    { v: "5", label: "五" },
    { v: "6", label: "六" },
    { v: "0", label: "日" }
  ];
  return `
    <div class="sched-picker" data-sched-picker>
      <div class="sched-picker-tabs" role="tablist">
        <button type="button" class="sched-picker-tab active" data-mode="natural" role="tab" aria-selected="true">自然语言</button>
        <button type="button" class="sched-picker-tab" data-mode="daily" role="tab" aria-selected="false">每天</button>
        <button type="button" class="sched-picker-tab" data-mode="weekly" role="tab" aria-selected="false">每周</button>
        <button type="button" class="sched-picker-tab" data-mode="once" role="tab" aria-selected="false">一次</button>
      </div>
      <div class="sched-picker-pane" data-pane="natural">
        <input type="text" class="sched-picker-input" data-natural placeholder="例如：2分钟以后 / 每天 9点 / every hour" value="${escapeHtml(initialNatural)}"/>
      </div>
      <div class="sched-picker-pane" data-pane="daily" hidden>
        <span class="sched-picker-label">每天</span>
        <input type="time" class="sched-picker-time" data-daily-time value="09:00"/>
        <span class="sched-picker-tz muted">(${escapeHtml(getLocalTimezoneShort())})</span>
      </div>
      <div class="sched-picker-pane sched-picker-pane--weekly" data-pane="weekly" hidden>
        <div class="sched-picker-dow">
          ${dows.map((d) => `
            <label class="sched-picker-dow-chip">
              <input type="checkbox" data-dow="${d.v}"/>
              <span>${d.label}</span>
            </label>
          `).join("")}
        </div>
        <div class="sched-picker-row">
          <span class="sched-picker-label">时间</span>
          <input type="time" class="sched-picker-time" data-weekly-time value="09:00"/>
          <span class="sched-picker-tz muted">(${escapeHtml(getLocalTimezoneShort())})</span>
        </div>
      </div>
      <div class="sched-picker-pane" data-pane="once" hidden>
        <span class="sched-picker-label">在</span>
        <input type="datetime-local" class="sched-picker-datetime" data-once-datetime/>
        <span class="sched-picker-tz muted">(${escapeHtml(getLocalTimezoneShort())})</span>
      </div>
    </div>
  `;
}

function getLocalTimezoneShort() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; }
  catch { return ""; }
}

function wireSchedulePicker(root) {
  if (!root) return;
  const tabs = root.querySelectorAll(".sched-picker-tab");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        const isThis = t === tab;
        t.classList.toggle("active", isThis);
        t.setAttribute("aria-selected", isThis ? "true" : "false");
      });
      for (const pane of root.querySelectorAll(".sched-picker-pane")) {
        pane.hidden = pane.dataset.pane !== tab.dataset.mode;
      }
    });
  }
}

function readSchedulePicker(root) {
  if (!root) return null;
  const activeTab = root.querySelector(".sched-picker-tab.active");
  const mode = activeTab?.dataset.mode ?? "natural";
  const tz = getLocalTimezoneShort();
  if (mode === "natural") {
    const text = root.querySelector("[data-natural]")?.value?.trim() ?? "";
    if (!text) return null;
    return { natural_language: text, timezone: tz };
  }
  if (mode === "daily") {
    const time = root.querySelector("[data-daily-time]")?.value ?? "";
    if (!time) return null;
    const [hh, mm] = time.split(":").map((n) => Number(n));
    return { type: "cron", expression: `${mm} ${hh} * * *`, timezone: tz, label: `每天 ${time}` };
  }
  if (mode === "weekly") {
    const time = root.querySelector("[data-weekly-time]")?.value ?? "";
    const dows = [...root.querySelectorAll("[data-dow]:checked")].map((b) => b.dataset.dow);
    if (!time || dows.length === 0) return null;
    const [hh, mm] = time.split(":").map((n) => Number(n));
    return {
      type: "cron",
      expression: `${mm} ${hh} * * ${dows.join(",")}`,
      timezone: tz,
      label: `每周 ${dows.length} 天 ${time}`
    };
  }
  if (mode === "once") {
    const dt = root.querySelector("[data-once-datetime]")?.value ?? "";
    if (!dt) return null;
    // datetime-local has no timezone — server's ensureTrigger will
    // attach the system tz from our tz field.
    return { type: "at", run_at: dt, timezone: tz, oneShot: true };
  }
  return null;
}

// Mount the picker into the create form on load.
(function mountScheduleCreatePicker() {
  const host = document.querySelector("#scheduleCreateWhenPicker");
  if (!host) return;
  host.innerHTML = buildSchedulePickerHtml({ prefix: "schedCreate" });
  wireSchedulePicker(host.querySelector("[data-sched-picker]"));
})();

async function createScheduleFromConsole() {
  const pickerHost = document.querySelector("#scheduleCreateWhenPicker [data-sched-picker]");
  const trigger = readSchedulePicker(pickerHost);
  const commandText = scheduleCommandInput.value.trim();
  if (!trigger || !commandText) {
    scheduleCreateState.textContent = !commandText
      ? "Please describe the task."
      : "Please pick a time or type one in 自然语言.";
    return;
  }
  const scheduledAction = buildScheduleActionFromText(commandText);
  scheduleCreateState.textContent = "Creating...";
  try {
    const result = await createSchedule({
      name: commandText.slice(0, 40),
      trigger,
      action: scheduledAction.action,
      executionMode: scheduledAction.executionMode,
      oneShot: Boolean(trigger.oneShot),
      title: "UCA 提醒",
      message: commandText,
      userCommand: commandText
    });
    scheduleCreateState.textContent = `Created · next ${formatDateTime(result.schedule?.next_run_at)}`;
    // Reset the picker by re-rendering it
    const host = document.querySelector("#scheduleCreateWhenPicker");
    if (host) {
      host.innerHTML = buildSchedulePickerHtml({ prefix: "schedCreate" });
      wireSchedulePicker(host.querySelector("[data-sched-picker]"));
    }
    scheduleCommandInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    scheduleCreateState.textContent = `Failed: ${error.message}`;
  }
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${state.serviceBaseUrl}${pathname}`, options);
  const payloadText = await response.text();
  const payload = payloadText ? JSON.parse(payloadText) : {};
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? pathname);
  return payload;
}

// UCA-126 Phase 7d: rich message cards (user / ai / system / tool_call).
function appendConsoleChatMessage(role, text, options = {}) {
  if (!consoleChatMessages || (!text && !options.allowEmpty)) return null;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();

  const wrapper = document.createElement("div");
  wrapper.className = `chat-msg ${role}`;

  if (role !== "system") {
    const avatar = document.createElement("div");
    avatar.className = `chat-msg-av ${role === "user" ? "user" : "ai"}`;
    avatar.textContent = role === "user" ? "我" : "AI";
    wrapper.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "chat-msg-body";

  if (options.header) {
    const head = document.createElement("div");
    head.className = "chat-msg-head";
    head.textContent = options.header;
    body.appendChild(head);
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-msg-bubble";
  renderConsoleChatBubbleContent(bubble, text);
  body.appendChild(bubble);

  // Timestamp footer — relative time visible, absolute time on hover.
  // Refreshed by refreshChatTimestamps() on a 30-second tick.
  if (role !== "system") {
    const ts = options.ts != null ? new Date(options.ts).getTime() : Date.now();
    const timeEl = document.createElement("time");
    timeEl.className = "chat-msg-time";
    timeEl.dataset.ts = String(ts);
    timeEl.title = formatDateTime(ts);
    timeEl.textContent = formatRelativeTime(ts);
    body.appendChild(timeEl);
  }

  // For user messages, add a tiny ↑/↓ nav so the user can jump between
  // their own prompts in a long thread. Hover-visible so it doesn't
  // crowd the layout when not in use.
  if (role === "user") {
    const nav = document.createElement("div");
    nav.className = "chat-msg-nav";
    nav.innerHTML = `
      <button type="button" class="chat-msg-nav-btn" data-nav="prev" title="上一个问题" aria-label="上一个问题">↑</button>
      <button type="button" class="chat-msg-nav-btn" data-nav="next" title="下一个问题" aria-label="下一个问题">↓</button>
    `;
    nav.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-nav]");
      if (!btn) return;
      navigateUserMessage(wrapper, btn.dataset.nav);
    });
    body.appendChild(nav);
  }

  if (role === "assistant" || role === "ai") {
    const actions = document.createElement("div");
    actions.className = "chat-msg-actions";
    const taskId = options.taskId ?? null;
    if (taskId) wrapper.dataset.taskId = taskId;
    const regenBtn = taskId
      ? `<button type="button" class="chat-msg-action" data-action="regen" title="用相同输入重新生成">↻ 重新生成</button>`
      : "";
    actions.innerHTML = `
      <button type="button" class="chat-msg-action" data-action="copy" title="Copy">复制</button>
      <button type="button" class="chat-msg-action" data-action="note" title="Add to note">＋ Note</button>
      ${regenBtn}
    `;
    actions.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const content = bubble.dataset.rawText || bubble.textContent || "";
      if (btn.dataset.action === "copy") {
        try { navigator.clipboard?.writeText?.(content); } catch { /* ignore */ }
        btn.textContent = "已复制";
        setTimeout(() => { btn.textContent = "复制"; }, 1200);
      } else if (btn.dataset.action === "note") {
        openNoteTargetPicker(content, btn);
      } else if (btn.dataset.action === "regen") {
        const tid = wrapper.dataset.taskId;
        if (!tid) return;
        void regenerateConsoleChatTask(tid, btn);
      }
    });
    body.appendChild(actions);
  }

  wrapper.appendChild(body);
  consoleChatMessages.appendChild(wrapper);
  consoleChatPin.maybeScrollToBottom();
  return wrapper;
}

// Jump between user-sent messages in a long thread. Click ↑ on a user
// bubble to scroll the previous user prompt into view; ↓ for the next.
// Wraps gracefully when at either end (no-op).
function navigateUserMessage(currentEl, direction) {
  if (!consoleChatMessages || !currentEl) return;
  const all = [...consoleChatMessages.querySelectorAll(".chat-msg.user")];
  const idx = all.indexOf(currentEl);
  if (idx === -1) return;
  const target = direction === "prev" ? all[idx - 1] : all[idx + 1];
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("chat-msg--flash");
    setTimeout(() => target.classList.remove("chat-msg--flash"), 1100);
  }
}

// Re-run the same task that produced this assistant message. Mirrors
// the task-detail Retry button but inlines it on the chat surface so
// the user doesn't have to leave the conversation. Backend handles the
// re-submission; the new task's events stream into the chat as usual.
async function regenerateConsoleChatTask(taskId, btn) {
  if (!taskId) return;
  const original = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "重新生成中…";
  }
  try {
    await retryTaskViaShell(taskId, { mode: "retry_same" });
    if (btn) btn.textContent = "已发起";
    setTimeout(() => {
      if (btn) { btn.disabled = false; btn.textContent = original ?? "↻ 重新生成"; }
    }, 1400);
    await refreshWorkspace?.();
  } catch (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "重试失败";
      setTimeout(() => { btn.textContent = original ?? "↻ 重新生成"; }, 1600);
    }
    showConsoleToast(`重新生成失败：${error?.message ?? error}`, { kind: "err" });
  }
}

function appendConsoleChatTextDelta(taskId, delta) {
  if (!taskId || !delta || !consoleChatMessages) return;
  closeConsoleChatThinkingCard();
  const nextText = `${consoleChatStreamingAnswer?.text ?? ""}${String(delta)}`;
  if (looksLikeInternalControlJsonText(nextText)) {
    if (consoleChatStreamingAnswer) {
      consoleChatStreamingAnswer.text = nextText;
      if (isInternalControlJsonText(nextText)) {
        consoleChatStreamingAnswer.wrapper?.remove?.();
        consoleChatStreamingAnswer = null;
      }
    }
    return;
  }
  if (!consoleChatStreamingAnswer || consoleChatStreamingAnswer.taskId !== taskId) {
    const wrapper = appendConsoleChatMessage("assistant", "", { allowEmpty: true, taskId });
    const bubble = wrapper?.querySelector(".chat-msg-bubble") ?? null;
    // Tag the bubble as streaming so the blinking caret CSS kicks in.
    // The class is removed in finalizeConsoleChatStreaming.
    bubble?.classList.add("streaming");
    consoleChatStreamingAnswer = {
      taskId,
      text: "",
      wrapper,
      bubble
    };
  }
  consoleChatStreamingAnswer.text += String(delta);
  if (consoleChatStreamingAnswer.bubble) {
    renderConsoleChatBubbleContent(consoleChatStreamingAnswer.bubble, consoleChatStreamingAnswer.text);
  }
  consoleChatPin.maybeScrollToBottom();
}

function finalizeConsoleChatStreaming(taskId, finalText = "") {
  if (!taskId || !consoleChatStreamingAnswer || consoleChatStreamingAnswer.taskId !== taskId) {
    return false;
  }
  const text = String(finalText || consoleChatStreamingAnswer.text || "").trim();
  if (isInternalControlJsonText(text)) {
    consoleChatStreamingAnswer.wrapper?.remove?.();
    consoleChatStreamingAnswer = null;
    return true;
  }
  if (text && consoleChatStreamingAnswer.bubble) {
    renderConsoleChatBubbleContent(consoleChatStreamingAnswer.bubble, text);
  }
  consoleChatStreamingAnswer.bubble?.classList.remove("streaming");
  consoleChatStreamingAnswer = null;
  return true;
}

// ── Selection-floating "+ Note" pill inside the chat feed ────────────────
// Single document-scoped listener — relies on the notes module exposing
// `window.lingxyNotes` once it boots. If the module isn't loaded yet we
// just no-op (the picker handles its own absence).
let chatSelectionPillEl = null;
function ensureChatSelectionPill() {
  if (chatSelectionPillEl) return chatSelectionPillEl;
  chatSelectionPillEl = document.createElement("button");
  chatSelectionPillEl.type = "button";
  chatSelectionPillEl.className = "chat-selection-pill";
  chatSelectionPillEl.textContent = "＋ Note";
  chatSelectionPillEl.hidden = true;
  document.body.appendChild(chatSelectionPillEl);
  chatSelectionPillEl.addEventListener("mousedown", (ev) => ev.preventDefault());
  chatSelectionPillEl.addEventListener("click", () => {
    const text = chatSelectionPillEl.dataset.selectedText || "";
    chatSelectionPillEl.hidden = true;
    if (text.trim()) openNoteTargetPicker(text, chatSelectionPillEl);
  });
  return chatSelectionPillEl;
}
document.addEventListener("selectionchange", () => {
  if (!consoleChatMessages) return;
  const sel = document.getSelection();
  const pill = ensureChatSelectionPill();
  if (!sel || sel.isCollapsed) { pill.hidden = true; return; }
  const text = sel.toString();
  if (!text || text.trim().length < 4) { pill.hidden = true; return; }
  const range = sel.getRangeAt(0);
  const within = consoleChatMessages.contains(range.commonAncestorContainer)
    || consoleChatMessages === range.commonAncestorContainer;
  if (!within) { pill.hidden = true; return; }
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) { pill.hidden = true; return; }
  pill.dataset.selectedText = text;
  pill.style.top = `${Math.max(8, rect.top + window.scrollY - 34)}px`;
  pill.style.left = `${Math.min(window.innerWidth - 90, rect.right + window.scrollX - 80)}px`;
  pill.hidden = false;
});

// Unified +Note picker — same backend round-trip as the overlay's
// openOverlayNotePicker so both surfaces behave identically:
//   - GET /notes              → recent destinations
//   - POST /notes/append-chip → append (or create new note + append)
// Previously this used window.lingxyNotes (local in-browser state)
// which only existed AFTER the user had visited the Notes tab; from a
// cold console the chip just landed on the clipboard with a "go to
// Notes" hint. The backend path doesn't depend on tab init.
async function openNoteTargetPicker(text, anchorEl) {
  if (!text || !text.trim()) return;
  let notes = [];
  try {
    const data = await fetchJson("/notes");
    notes = Array.isArray(data?.notes) ? data.notes : [];
  } catch { /* notes endpoint unavailable — still allow create-new */ }
  const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const popover = document.createElement("div");
  popover.className = "note-target-popover";
  popover.innerHTML = `
    <div class="ntp-head">添加到笔记</div>
    <div class="ntp-list">
      <button type="button" data-note-id="__new__" class="ntp-item ntp-item-new">＋ 新建笔记</button>
      ${notes.slice(0, 8).map((n) => {
        const snippet = stripTags(n.body_html || n.snippet || "").slice(0, 60);
        return `
          <button type="button" data-note-id="${escapeHtml(n.id)}" class="ntp-item">
            <span class="ntp-item-title">${escapeHtml(n.title || "Untitled note")}</span>
            <span class="ntp-item-snippet">${escapeHtml(snippet)}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
  document.body.appendChild(popover);
  const r = (anchorEl?.getBoundingClientRect?.()) || { left: 100, bottom: 100 };
  const left = Math.min(window.innerWidth - 280, Math.max(8, r.left + window.scrollX));
  const top = r.bottom + window.scrollY + 6;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  const close = () => { popover.remove(); document.removeEventListener("mousedown", outside, true); };
  const outside = (ev) => { if (!popover.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  // Submit helper — used by both the existing-note buttons and the
  // new-note title prompt below.
  const submitToNote = async (noteId, title = null) => {
    try {
      const result = await appendNoteChipViaShell({ noteId, text, sourceLabel: "From chat", title });
      const target = result?.note?.title || "笔记";
      showConsoleToast(result?.created ? `已新建：${target}` : `已添加到：${target}`, { kind: "ok" });
      try { window.lingxyNotes?.refresh?.({ preserveSelection: true }); } catch { /* ignore */ }
    } catch (err) {
      showConsoleToast(`添加失败：${err.message ?? err}`, { kind: "err" });
    }
    close();
  };

  popover.querySelectorAll("[data-note-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      // New-note flow — inline a title input so the user can name the
      // note before it's created. Empty title falls back to a default
      // server-side. Existing-note buttons skip this prompt entirely.
      if (noteId === "__new__") {
        const promptEl = document.createElement("div");
        promptEl.className = "ntp-new-prompt";
        promptEl.innerHTML = `
          <input type="text" class="ntp-title-input" placeholder="笔记标题（可选）" maxlength="80"/>
          <button type="button" class="ntp-title-confirm">创建</button>
        `;
        // Replace the picker's body with the prompt to keep the
        // popover compact. The user can press Esc or click outside
        // to cancel — handled by the existing outside-click listener.
        const list = popover.querySelector(".ntp-list");
        if (list) {
          list.innerHTML = "";
          list.appendChild(promptEl);
        }
        const titleInput = promptEl.querySelector(".ntp-title-input");
        const confirmBtn = promptEl.querySelector(".ntp-title-confirm");
        titleInput?.focus();
        const submit = () => {
          const title = titleInput?.value?.trim() || null;
          void submitToNote("__new__", title);
        };
        confirmBtn?.addEventListener("click", submit);
        titleInput?.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); submit(); }
        });
        return;
      }
      void submitToNote(noteId);
    });
  });
}

// UCA-177: premium two-row timeline card for tool invocations.
//   state — "running" | "ok" | "err" (default "ok" when outcome present,
//   else "running" when no outcome, else neutral).
function appendConsoleChatToolCall(toolName, args, outcome, options = {}) {
  if (!consoleChatMessages || !toolName) return;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();

  const inferredState = options.state
    ?? (options.error ? "err"
      : outcome != null ? "ok"
      : "running");
  const stateLabel = inferredState === "running" ? "RUNNING"
    : inferredState === "err" ? "FAILED"
    : "DONE";

  const card = document.createElement("div");
  card.className = `chat-tool-card is-${inferredState}`;
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `tool call ${toolName}`);

  const argsText = typeof args === "string"
    ? args
    : (args == null ? "" : JSON.stringify(args, null, 0));
  const argsPreview = argsText.length > 240 ? `${argsText.slice(0, 240)}…` : argsText;
  const outcomeText = outcome == null ? "" : String(outcome).slice(0, 140);
  const time = new Date();
  const timeText = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;

  const ICON = `<svg class="ttc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>`;

  card.innerHTML = `
    <div class="ttc-head">
      ${ICON}
      <span class="ttc-name">${escapeHtml(toolName)}</span>
      <span class="ttc-status">${stateLabel}</span>
      <time class="ttc-time" datetime="${time.toISOString()}">${timeText}</time>
    </div>
    <div class="ttc-args ${argsPreview ? "" : "is-empty"}">${escapeHtml(argsPreview)}</div>
    ${outcomeText
      ? `<div class="ttc-outcome"><span class="ttc-outcome-arrow">→</span><span class="ttc-outcome-text">${escapeHtml(outcomeText)}</span></div>`
      : ""}
  `;
  consoleChatMessages.appendChild(card);
  consoleChatPin.maybeScrollToBottom();
  return card;
}

function createConsoleChatToolCard(toolName, args, options = {}) {
  const id = `tool-${++consoleChatToolCardCounter}`;
  const card = appendConsoleChatToolCall(toolName, args, null, { ...options, state: options.state ?? "running" });
  if (card) {
    card.dataset.toolCardId = id;
    consoleChatToolCards.set(id, card);
  }
  return id;
}

function appendConsoleChatThinkingDelta(delta) {
  if (!consoleChatMessages || !delta) return;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();
  if (!consoleChatThinkingCard) {
    const card = document.createElement("details");
    card.className = "chat-thinking-card";
    card.open = true;
    card.innerHTML = `
      <summary class="cth-summary">
        <span class="cth-icon">🧠</span>
        <span class="cth-label">思考过程</span>
        <span class="cth-status">…</span>
      </summary>
      <div class="cth-body"></div>
    `;
    consoleChatMessages.appendChild(card);
    consoleChatThinkingCard = card;
    consoleChatThinkingText = "";
  }
  consoleChatThinkingText += String(delta);
  const body = consoleChatThinkingCard.querySelector(".cth-body");
  if (body) body.textContent = consoleChatThinkingText;
  consoleChatPin.maybeScrollToBottom();
}

function appendConsoleChatProgress(frame, textOverride = "") {
  if (!consoleChatMessages) return;
  if (frame?.id && consoleChatProgressEventIds.has(frame.id)) return;
  if (frame?.id) consoleChatProgressEventIds.add(frame.id);
  const summary = formatTaskEventSummary(frame);
  const text = String(textOverride || (
    frame?.event === "conversation_step"
      ? summary.body
      : `${summary.title}: ${summary.body}`
  )).trim();
  if (!text) return;
  appendConsoleChatMessage("system", text);
}

function closeConsoleChatThinkingCard() {
  if (!consoleChatThinkingCard) return;
  consoleChatThinkingCard.open = false;
  const status = consoleChatThinkingCard.querySelector(".cth-status");
  if (status) status.textContent = `${consoleChatThinkingText.length} chars`;
  consoleChatThinkingCard = null;
  consoleChatThinkingText = "";
}

function completeConsoleChatToolCard(id, toolName, args, outcome, options = {}) {
  const card = consoleChatToolCards.get(id);
  if (!card) {
    return appendConsoleChatToolCall(toolName, args, outcome, options);
  }
  const inferredState = options.state
    ?? (options.error ? "err"
      : outcome != null ? "ok"
      : "running");
  card.classList.remove("is-running", "is-ok", "is-err");
  card.classList.add(`is-${inferredState}`);

  const stateLabel = inferredState === "running" ? "RUNNING"
    : inferredState === "err" ? "FAILED"
    : "DONE";
  const argsText = typeof args === "string"
    ? args
    : (args == null ? "" : JSON.stringify(args, null, 0));
  const argsPreview = argsText.length > 240 ? `${argsText.slice(0, 240)}…` : argsText;
  const outcomeText = outcome == null ? "" : String(outcome).slice(0, 140);

  const nameEl = card.querySelector(".ttc-name");
  const statusEl = card.querySelector(".ttc-status");
  const argsEl = card.querySelector(".ttc-args");
  const outcomeEl = card.querySelector(".ttc-outcome");
  const outcomeTextEl = card.querySelector(".ttc-outcome-text");
  if (nameEl) nameEl.textContent = toolName;
  if (statusEl) statusEl.textContent = stateLabel;
  if (argsEl) {
    argsEl.textContent = argsPreview;
    argsEl.classList.toggle("is-empty", !argsPreview);
  }
  if (outcomeText) {
    if (outcomeTextEl) {
      outcomeTextEl.textContent = outcomeText;
    } else {
      const el = document.createElement("div");
      el.className = "ttc-outcome";
      el.innerHTML = `<span class="ttc-outcome-arrow">→</span><span class="ttc-outcome-text">${escapeHtml(outcomeText)}</span>`;
      card.appendChild(el);
    }
  } else if (outcomeEl) {
    outcomeEl.remove();
  }
  consoleChatPin.maybeScrollToBottom();
  return card;
}

async function appendConsoleChatFinalResult(taskId, payload = {}) {
  if (!taskId || consoleChatResultTaskIds.has(taskId)) return;
  const directText = String(
    payload.text
    ?? payload.summary
    ?? payload.message
    ?? ""
  ).trim();
  if (isInternalControlJsonText(directText)) {
    consoleChatResultTaskIds.add(taskId);
    return;
  }
  if (directText) {
    if (!finalizeConsoleChatStreaming(taskId, directText)) {
      appendConsoleChatMessage("assistant", directText, { taskId });
    }
    consoleChatResultTaskIds.add(taskId);
    return;
  }
  try {
    const detail = await fetchJson(`/task/${encodeURIComponent(taskId)}`);
    const task = detail?.task ?? detail ?? null;
    const settledText = String(
      task?.result_summary
      ?? task?.inline_result
      ?? task?.failure_user_message
      ?? ""
    ).trim();
    if (!settledText) return;
    if (!finalizeConsoleChatStreaming(taskId, settledText)) {
      appendConsoleChatMessage(task?.status === "failed" ? "system" : "assistant", settledText, { taskId });
    }
    consoleChatResultTaskIds.add(taskId);
  } catch {
    /* optional */
  }
}

function subscribeConsoleChatTask(taskId) {
  consoleChatEventStream?.close?.();
  consoleChatToolCards = new Map();
  consoleChatStreamingAnswer = null;
  consoleChatProgressEventIds = new Set();
  closeConsoleChatThinkingCard();
  consoleChatActiveTaskId = taskId;
  refreshConsoleChatSendBtnMode();
  consoleChatEventStream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(rawEvent) {
      const frame = toTaskEventFrame(rawEvent);
      const payload = frame.data ?? {};
      if (frame.event === "reasoning_delta") {
        appendConsoleChatThinkingDelta(payload.delta ?? "");
      } else if (frame.event === "pending_approval_created") {
        void surfaceApprovalPopup(payload, { taskId });
        appendConsoleChatProgress(frame);
        void refreshWorkspace();
      } else if (frame.event === "text_delta") {
        appendConsoleChatTextDelta(taskId, payload.delta ?? payload.text ?? "");
        consoleChatState.textContent = "Answering...";
      } else if (frame.event === "tool_call_proposed" || frame.event === "tool_call_started") {
        const toolName = payload.tool_id ?? payload.tool ?? "tool";
        const args = payload.args ?? payload.arguments ?? {};
        const id = createConsoleChatToolCard(toolName, args, { state: "running" });
        if (!payload.__consoleToolCardId) payload.__consoleToolCardId = id;
        consoleChatState.textContent = `Running ${toolName}...`;
        if (window.livePreview?.isFileGenTool?.(toolName)) {
          window.livePreview.openForTool({ toolName, args });
        }
      } else if (frame.event === "tool_input_delta") {
        const toolName = payload.tool_id ?? "";
        if (window.livePreview?.isFileGenTool?.(toolName)) {
          window.livePreview.appendDelta({ toolName, partialJson: payload.partial_json ?? "" });
        }
      } else if (frame.event === "tool_call_completed") {
        const toolName = payload.tool_id ?? payload.tool ?? "tool";
        const outcome = payload.observation ?? payload.text ?? payload.error ?? "";
        const candidate = [...consoleChatToolCards.entries()].reverse().find(([, card]) => {
          return card.querySelector(".ttc-name")?.textContent === toolName
            && card.querySelector(".ttc-status")?.textContent === "RUNNING";
        })?.[0] ?? null;
        completeConsoleChatToolCard(candidate, toolName, payload.args ?? {}, outcome, {
          state: payload.success === false ? "err" : "ok",
          error: payload.success === false
        });
        consoleChatState.textContent = payload.success === false ? `${toolName} failed` : `${toolName} done`;
        if (window.livePreview?.isFileGenTool?.(toolName)) {
          const artifactPath = payload.metadata?.path ?? payload.artifact_path ?? "";
          window.livePreview.commit({
            toolName,
            success: payload.success !== false,
            artifactPath,
            mime: payload.metadata?.mime_type ?? null,
            observation: outcome
          });
        }
      } else if (frame.event === "conversation_step") {
        const source = payload.source_event ?? "";
        if (!String(source).startsWith("tool_call")) {
          appendConsoleChatProgress(frame);
        }
      } else if ([
        "task_created",
        "accepted",
        "started",
        "provider_resolved",
        "planner_request_started",
        "final_composer_started",
        "sr_patch_applied",
        "background_context_added"
      ].includes(frame.event)) {
        appendConsoleChatProgress(frame);
      } else if (frame.event === "inline_result") {
        closeConsoleChatThinkingCard();
        if (!finalizeConsoleChatStreaming(taskId, payload.text ?? payload.message ?? "")) {
          appendConsoleChatMessage("assistant", payload.text ?? payload.message ?? "", { taskId });
        }
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Done.";
      } else if (frame.event === "failed") {
        closeConsoleChatThinkingCard();
        consoleChatStreamingAnswer = null;
        appendConsoleChatMessage("system", payload.message ?? "Task failed.");
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Failed.";
        if (consoleChatActiveTaskId === taskId) consoleChatActiveTaskId = null;
        refreshConsoleChatSendBtnMode();
      } else if (frame.event === "cancelled") {
        closeConsoleChatThinkingCard();
        consoleChatStreamingAnswer = null;
        appendConsoleChatMessage("system", payload.message ?? "任务已取消。");
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Cancelled.";
        if (consoleChatActiveTaskId === taskId) consoleChatActiveTaskId = null;
        refreshConsoleChatSendBtnMode();
      } else if (frame.event === "success" || frame.event === "partial_success") {
        void appendConsoleChatFinalResult(taskId, payload);
        consoleChatState.textContent = frame.event === "partial_success" ? "Partially done." : "Done.";
        if (consoleChatActiveTaskId === taskId) consoleChatActiveTaskId = null;
        refreshConsoleChatSendBtnMode();
      }
    },
    onError(error) {
      consoleChatState.textContent = `Stream failed: ${error.message}`;
    }
  });
}

function closeScheduleRunTaskWatcher(taskId) {
  scheduleRunTaskWatchers.get(taskId)?.close?.();
  scheduleRunTaskWatchers.delete(taskId);
}

function approvalIdOf(value = {}) {
  return value.approval_id ?? value.approvalId ?? value.id ?? null;
}

async function fetchApprovalRecord(approvalId) {
  if (!approvalId) return null;
  try {
    const response = await fetchJson("/approvals");
    return (response.approvals ?? []).find((item) => approvalIdOf(item) === approvalId) ?? null;
  } catch {
    return null;
  }
}

async function surfaceApprovalPopup(approvalLike = {}, { taskId = null } = {}) {
  const approvalId = approvalIdOf(approvalLike);
  if (!approvalId || surfacedApprovalPopupIds.has(approvalId)) return;
  if (surfacingApprovalPopupIds.has(approvalId)) return;
  surfacingApprovalPopupIds.add(approvalId);
  const fullApproval = await fetchApprovalRecord(approvalId);
  const approval = fullApproval ?? approvalLike;
  if (approval.status && approval.status !== "pending") {
    surfacingApprovalPopupIds.delete(approvalId);
    return;
  }
  const target = approval.proposed_target ?? approval.workflow_id ?? approvalLike.workflow_id ?? "";
  const preview = approval.preview_text ?? approval.summary ?? approvalLike.summary ?? "请先确认后再执行。";
  try {
    if (typeof window.ucaShell?.showPopupCard !== "function") return;
    await window.ucaShell.showPopupCard({
      kind: "approval",
      approvalId,
      taskId: taskId ?? approval.metadata?.task_id ?? approvalLike.task_id ?? null,
      title: target ? `等待确认：${target}` : "等待用户确认",
      lines: [preview],
      openWindow: "console"
    });
    surfacedApprovalPopupIds.add(approvalId);
  } catch {
    /* optional */
  } finally {
    surfacingApprovalPopupIds.delete(approvalId);
  }
}

function surfaceNewWorkspaceApprovals(approvals = []) {
  const pending = (approvals ?? []).filter((approval) => approval?.status === "pending");
  for (const approval of pending) {
    void surfaceApprovalPopup(approval, { taskId: approval.metadata?.task_id ?? null });
  }
}

async function approveApproval(approvalId, options = {}) {
  if (typeof window.ucaShell?.approveApproval !== "function") {
    throw new Error("Desktop approval bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.approveApproval({
      approvalId,
      overrides: options.overrides ?? null
    }),
    "Could not approve this action."
  );
}

async function rejectApproval(approvalId, options = {}) {
  if (typeof window.ucaShell?.rejectApproval !== "function") {
    throw new Error("Desktop approval bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.rejectApproval({
      approvalId,
      reason: options.reason ?? ""
    }),
    "Could not reject this action."
  );
}

function buildScheduleRunCompletionCopy(task = {}) {
  const status = task.status ?? "unknown";
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  const primaryArtifact = artifacts[0]?.path ?? null;
  const primaryLabel = primaryArtifact ? formatArtifactLabel(primaryArtifact) : "";
  const summary = String(
    task.result_summary
    ?? task.inline_result
    ?? task.failure_user_message
    ?? task.intent
    ?? task.user_command
    ?? ""
  ).trim();

  if (status === "failed") {
    return {
      kind: "error",
      title: "定时任务失败",
      body: summary || "任务执行失败。",
      lines: [summary || "任务执行失败。"]
    };
  }

  if (status === "cancelled") {
    return {
      kind: "error",
      title: "定时任务已取消",
      body: summary || "任务已取消。",
      lines: [summary || "任务已取消。"]
    };
  }

  if (artifacts.length > 0) {
    const suffix = artifacts.length > 1 ? `，共 ${artifacts.length} 个文件` : "";
    const body = primaryLabel
      ? `已生成 ${primaryLabel}${suffix}`
      : `已生成 ${artifacts.length} 个文件`;
    return {
      kind: "success",
      title: status === "partial_success" ? "定时任务部分完成" : "定时任务已完成",
      body,
      lines: [body, summary].filter(Boolean)
    };
  }

  const body = summary || (status === "partial_success" ? "任务已部分完成。" : "任务已完成。");
  return {
    kind: "success",
    title: status === "partial_success" ? "定时任务部分完成" : "定时任务已完成",
    body,
    lines: [body]
  };
}

function fireScheduleRunCompletionNotice(task = {}) {
  const taskId = task.task_id;
  if (!taskId || completedScheduleRunTaskIds.has(taskId)) return;
  completedScheduleRunTaskIds.add(taskId);
  const copy = buildScheduleRunCompletionCopy(task);
  let popupShown = false;
  try {
    window.ucaShell?.showPopupCard?.({
      kind: copy.kind,
      taskId,
      title: copy.title,
      lines: copy.lines,
      autoHideMs: copy.kind === "error" ? 12000 : 9000,
      dedupeKey: `schedule-run:${taskId}`
    });
    popupShown = true;
  } catch { /* optional */ }

  if (!popupShown) {
    try {
      window.ucaShell?.notify?.({
        kind: copy.kind,
        taskId,
        title: copy.title,
        body: copy.body,
        openWindow: "console",
        autoHideMs: copy.kind === "error" ? 12000 : 9000,
        dedupeKey: `schedule-run:${taskId}`
      });
    } catch { /* optional */ }
  }
}

function taskAlreadyDisplayedNotify(events = []) {
  return (events ?? []).some((event) => {
    if (event?.event_type !== "tool_call_completed") return false;
    const payload = event.payload ?? {};
    const toolId = payload.tool_id ?? payload.tool;
    return toolId === "notify" && payload.success === true;
  });
}

async function settleScheduleRunTask(taskId) {
  if (!taskId) return;
  closeScheduleRunTaskWatcher(taskId);
  try {
    const detail = await fetchJson(`/task/${encodeURIComponent(taskId)}`);
    const task = detail?.task ?? detail ?? null;
    const events = detail?.events ?? [];
    if (!task) return;
    if (taskAlreadyDisplayedNotify(events)) return;
    if (!["success", "partial_success", "failed", "cancelled"].includes(task.status)) return;
    fireScheduleRunCompletionNotice(task);
  } catch {
    /* optional */
  } finally {
    await refreshWorkspace();
  }
}

function watchScheduleRunTask(task = {}) {
  const taskId = task?.task_id;
  if (!taskId) return;
  if (["success", "partial_success", "failed", "cancelled"].includes(task.status)) {
    void settleScheduleRunTask(taskId);
    return;
  }
  if (scheduleRunTaskWatchers.has(taskId)) return;
  const stream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(rawEvent) {
      const frame = toTaskEventFrame(rawEvent);
      if (frame.event === "pending_approval_created") {
        void surfaceApprovalPopup(frame.data ?? {}, { taskId });
        void refreshWorkspace();
      }
      if (["success", "partial_success", "failed", "cancelled"].includes(frame.event)) {
        void settleScheduleRunTask(taskId);
      }
    },
    onError() {
      closeScheduleRunTaskWatcher(taskId);
      setTimeout(() => void settleScheduleRunTask(taskId), 1500);
    }
  });
  scheduleRunTaskWatchers.set(taskId, stream);
}

async function submitConsoleChat() {
  const text = consoleChatInput?.value?.trim() ?? "";
  if (!text) return;
  const attachedFilePaths = consoleChatAttachList.map((entry) => `${entry?.path ?? ""}`.trim()).filter(Boolean);
  const clientMessageId = cacheCreateClientMessageId();
  // G: when a conversation is active, we are RESUMING; when the user
  // started a blank chat, mint the conversation_id before /task so the
  // backend can create the durable conversation row immediately.
  if (!consoleActiveConversation?.conversation_id) {
    const title = text.replace(/\s+/g, " ").trim();
    consoleActiveConversation = cacheEnsureBackendFields({
      conversation_id: cacheCreateConversationId(),
      title: title.length > 36 ? `${title.slice(0, 36)}…` : title
    });
    renderConsoleChatHeader();
  }
  // No history is re-injected — backend already has it.
  const conversationId = consoleActiveConversation?.conversation_id ?? null;
  const conv = cacheEnsureBackendFields(consoleActiveConversation);
  if (conv) {
    conv.pendingByClientId.set(clientMessageId, { role: "user", content: text, ts: Date.now() });
  }
  appendConsoleChatUserMessage(text, clientMessageId);
  consoleChatInput.value = "";
  consoleChatState.textContent = "Submitting...";
  appendConsoleChatMessage("system", "已收到请求，正在创建任务…");
  try {
    const result = await fetchJson("/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceApp: "uca.console.chat",
        captureMode: "desktop_console_chat",
        sourceType: "clipboard",
        text: "",
        userCommand: text,
        executionMode: "interactive",
        background: true,
        client_message_id: clientMessageId,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        ...(attachedFilePaths.length > 0 ? { filePaths: attachedFilePaths } : {})
      })
    });
    const taskId = result.task?.task_id;
    consoleChatState.textContent = taskId ? `Running ${taskId}` : "Running...";
    if (taskId) {
      consoleChatResultTaskIds.delete(taskId);
      subscribeConsoleChatTask(taskId);
      appendConsoleChatMessage("system", "任务已创建，正在执行…");
    }
    // If the backend created a fresh conversation for this submit
    // (no conversation_id was sent), pick it up so subsequent submits
    // thread into the same conversation.
    const replyConvId = result.task?.conversation_id;
    if (replyConvId && replyConvId !== consoleActiveConversation?.conversation_id) {
      consoleActiveConversation = cacheEnsureBackendFields({ conversation_id: replyConvId });
      renderConsoleChatHeader();
    }
    // Phase 2: surface the new conversation in the sidebar
    // immediately. ensureConversationsCache() refetches from backend
    // so the new conversation_id (with auto-derived title from
    // first user command) appears.
    void refreshChatSidebar({ force: true });
    await refreshWorkspace();
    updateChatModelChip?.();
    consoleChatAttachList.length = 0;
    renderChatAttachments?.();
  } catch (error) {
    markConsoleChatPendingFailed(clientMessageId, error);
    consoleChatState.textContent = "Failed.";
  }
}

function appendConsoleChatUserMessage(content, clientMessageId) {
  if (!consoleChatMessages) return;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();
  const wrapper = document.createElement("div");
  wrapper.className = "console-chat-message console-chat-message-user pending";
  if (clientMessageId) wrapper.dataset.clientMessageId = clientMessageId;
  const body = document.createElement("div");
  body.className = "console-chat-message-body";
  renderConsoleChatBubbleContent(body, content);
  wrapper.appendChild(body);
  consoleChatMessages.appendChild(wrapper);
  consoleChatPin.maybeScrollToBottom();
}

function markConsoleChatPendingFailed(clientMessageId, error) {
  if (!clientMessageId) return;
  const conv = consoleActiveConversation;
  if (conv?.pendingByClientId instanceof Map) conv.pendingByClientId.delete(clientMessageId);
  const node = consoleChatMessages?.querySelector?.(
    `[data-client-message-id="${cacheCssEscape(clientMessageId)}"]`
  );
  if (node) {
    node.classList.remove("pending");
    node.classList.add("failed");
    node.dataset.status = "failed";
    if (error?.message) node.dataset.failureReason = String(error.message).slice(0, 200);
  }
}

function renderConsoleChatHeader() {
  const titleEl = document.querySelector("#consoleChatActiveTitle");
  if (!titleEl) return;
  if (!consoleActiveConversation?.conversation_id) {
    titleEl.textContent = "";
    titleEl.hidden = true;
    return;
  }
  const label = consoleActiveConversation.title
    || consoleActiveConversation.conversation_id.slice(0, 12);
  titleEl.textContent = `Continuing: ${label}`;
  titleEl.hidden = false;
}

const consoleChatMessageAdapter = {
  onReconcilePending(message, clientMessageId) {
    const node = consoleChatMessages?.querySelector?.(
      `[data-client-message-id="${cacheCssEscape(clientMessageId)}"]`
    );
    if (node) {
      node.dataset.messageId = message.message_id;
      node.dataset.seq = String(message.seq);
      node.classList.remove("pending");
    }
  },
  onAppend(message) {
    if (message.role === "user") {
      const wrapper = document.createElement("div");
      wrapper.className = "console-chat-message console-chat-message-user";
      wrapper.dataset.messageId = message.message_id;
      wrapper.dataset.seq = String(message.seq);
      const body = document.createElement("div");
      body.className = "console-chat-message-body";
      renderConsoleChatBubbleContent(body, message.content);
      wrapper.appendChild(body);
      consoleChatMessages.appendChild(wrapper);
    } else if (message.role === "assistant" || message.role === "system") {
      // Reuse the existing renderer for assistant/system bubbles.
      // Pass through any task_id the backend recorded so the replayed
      // bubble can also surface a Regenerate button. If the backend
      // didn't store one (older messages, system bubbles), the action
      // simply won't render — graceful fallback.
      appendConsoleChatMessage(message.role, message.content, {
        taskId: message.task_id ?? message.taskId ?? null
      });
      const last = consoleChatMessages?.lastElementChild;
      if (last && last.dataset) {
        last.dataset.messageId = message.message_id;
        last.dataset.seq = String(message.seq);
      }
    }
    consoleChatPin.maybeScrollToBottom();
  },
  onSkip() { /* tool_summary is backend-only history; the timeline owns it */ }
};

async function loadConsoleConversationFromBackend(conversationId) {
  if (!conversationId) return;
  const detail = await cacheFetchConversationDetail(fetch.bind(globalThis), state.serviceBaseUrl, conversationId);
  if (!detail?.conversation) return;
  consoleActiveConversation = cacheEnsureBackendFields({
    conversation_id: detail.conversation.conversation_id,
    title: detail.conversation.title,
    project_id: detail.conversation.project_id
  });
  if (consoleChatMessages) {
    // Defensive: if a streaming answer is in flight, drop its reference
    // before wiping so future text_delta frames don't keep writing into
    // a detached node and silently lose the user's reply. The wipe
    // itself is intentional — switching conversations should hard-reset.
    if (consoleChatStreamingAnswer) {
      consoleChatStreamingAnswer.bubble?.classList.remove("streaming");
      consoleChatStreamingAnswer = null;
    }
    consoleChatMessages.innerHTML = "";
    consoleChatMessages.scrollTop = 0;
  }
  cacheApplyBatch(consoleActiveConversation, detail, consoleChatMessageAdapter);
  renderConsoleChatHeader();
  switchTab("chat");
  // Update the sidebar's active highlight to track the just-loaded
  // conversation.
  renderChatSidebar();
}

function clearConsoleActiveConversation() {
  consoleActiveConversation = null;
  renderConsoleChatHeader();
  renderChatSidebar();
}

/* ═══════════════════════════════════════════════
   IA Phase 2 — Chat sidebar
   Renders the conversation list inside the Chat tab. Stays in sync
   with conversationsState.items (the same cache the Conversations
   panel uses). Click any row → load into the chat shell. The "+ New"
   button reuses the existing #consoleChatNewBtn flow.
   ═══════════════════════════════════════════════ */
let chatSidebarSearchTerm = "";
let chatSidebarSearchDebounce = null;

async function fetchConversationsList({ limit = 100, archived = "false" } = {}) {
  return cacheFetchConversations(fetch.bind(globalThis), state.serviceBaseUrl, { limit, archived });
}

async function ensureConversationsCache({ force = false, limit = 100, archived = "false" } = {}) {
  if (!force && Array.isArray(conversationsState?.items) && conversationsState.items.length > 0) {
    return conversationsState.items;
  }
  try {
    const items = await fetchConversationsList({ limit, archived });
    if (conversationsState) {
      conversationsState.items = items;
    }
    return items;
  } catch { /* keep cache empty — sidebar shows the empty hint */ }
  return conversationsState?.items ?? [];
}

function renderChatSidebar() {
  const listEl = document.querySelector("#chatSidebarList");
  if (!listEl) return;
  const items = (conversationsState?.items ?? []);
  const activeId = consoleActiveConversation?.conversation_id ?? null;
  listEl.innerHTML = renderChatSidebarListHtml({
    items,
    searchTerm: chatSidebarSearchTerm,
    activeConversationId: activeId
  });
  for (const btn of listEl.querySelectorAll("[data-chat-sidebar-id]")) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.chatSidebarId;
      if (!id || id === activeId) return;
      void loadConsoleConversationFromBackend(id);
    });
  }
}

async function refreshChatSidebar({ force = false } = {}) {
  await ensureConversationsCache({ force });
  renderChatSidebar();
}

function formatDateTime(value) {
  return formatSharedDateTime(value);
}

function formatMoney(value) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php",
  ".sh", ".ps1", ".bat", ".sql", ".yaml", ".yml", ".toml", ".ini", ".xml"
]);

const PROJECT_STORE_KEY = "uca.overlay.projects.v3";
const PROJECT_COLORS = ["#6366f1", "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6"];

function formatArtifactLabel(artifactPath = "") {
  return formatSharedArtifactLabel(artifactPath, {
    labels: {
      ".xlsx": "Excel",
      ".pdf": "PDF"
    },
    codeExtensions: CODE_EXTENSIONS
  });
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
function isImageArtifactPath(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => p.endsWith(ext));
}
function imageMimeFor(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".bmp")) return "image/bmp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function isPreviewableArtifactPath(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  if ([".md", ".txt", ".json", ".csv", ".html", ".htm"].some((ext) => p.endsWith(ext))) return true;
  if (isImageArtifactPath(p)) return true;
  for (const ext of CODE_EXTENSIONS) {
    if (p.endsWith(ext)) return true;
  }
  return false;
}

function basenameOf(filePath = "") {
  return `${filePath}`.split(/[\\/]/).pop() || filePath;
}

function dirnameOf(filePath = "") {
  const idx = `${filePath}`.lastIndexOf("\\") >= 0
    ? `${filePath}`.lastIndexOf("\\")
    : `${filePath}`.lastIndexOf("/");
  return idx >= 0 ? `${filePath}`.slice(0, idx) : "";
}

function normalisePreviewText(rawText = "") {
  return `${rawText}`
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderEmpty(container, message) {
  container.innerHTML = `<p class="muted" style="margin:0;font-size:12px;">${escapeHtml(message)}</p>`;
}

function setRuntimeBadge(ok, message) {
  // UCA-P0-D: the topbar runtimeState pill has been retired. The rail's
  // sys indicator at the bottom is now the single source of truth for
  // runtime health — ok / offline / error all surface there instead of
  // clinging to the "Tasks" title where they read as a page-level state.
  // The legacy runtimeState element may still exist during hot-reloads
  // or on older shells, so we defensively hide it when present.
  if (runtimeState) runtimeState.hidden = true;
  const railSys = document.querySelector("#railSys");
  const railSysText = document.querySelector("#railSysText");
  if (railSys && railSysText) {
    railSysText.textContent = ok ? "Runtime ready" : (message || "Runtime offline");
    railSys.classList.toggle("rail-sys--err", !ok);
    railSys.style.opacity = "1";
  }
  // Update the rail endpoint line too.
  const railEndpoint = document.querySelector("#railEndpoint");
  if (railEndpoint && ok) {
    try {
      const u = new URL(state.serviceBaseUrl);
      railEndpoint.textContent = `${u.hostname}:${u.port || 80}`;
    } catch { /* keep default */ }
  }
}

// UCA-117: mirror the active chat-routed model into the topbar runtime pill.
function updateTopRuntimePill() {
  const el = document.querySelector("#topRuntimeModel");
  if (!el) return;
  const route = (state.workspace?.providers ?? []).find((p) => p?.available && p?.configured);
  el.textContent = route?.model ?? route?.provider_id ?? "runtime";
}

/* ═══════════════════════════════════════════════
   RENDER FUNCTIONS
   ═══════════════════════════════════════════════ */

function computeSummary(tasks, budget) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    running: tasks.filter((t) => ["running", "cancelling"].includes(t.status)).length,
    queued: tasks.filter((t) => t.status === "queued").length,
    todaySuccess: tasks.filter((t) => t.status === "success" && `${t.updated_at ?? t.created_at ?? ""}`.startsWith(today)).length,
    monthlySpend: budget?.spent?.this_month_usd ?? 0
  };
}

// UCA-108: render a 4-card stat strip. The "Today" card embeds an SVG
// sparkline of completed tasks bucketed into the last 15 hours — a
// rough-but-real signal of recent throughput. The other three cards are
// plain numbers; "Spend" shows the monthly $ total and a "this month"
// subtitle so the denominator is explicit.
function buildTodaySparkline(tasks) {
  const now = Date.now();
  const bucketMs = 60 * 60 * 1000; // 1 hour per bucket
  const buckets = new Array(15).fill(0);
  for (const task of tasks) {
    if (task.status !== "success") continue;
    const when = Date.parse(task.updated_at ?? task.created_at ?? "");
    if (Number.isNaN(when)) continue;
    const ageH = Math.floor((now - when) / bucketMs);
    if (ageH < 0 || ageH >= 15) continue;
    buckets[14 - ageH] += 1;
  }
  const max = Math.max(1, ...buckets);
  const W = 100;
  const H = 28;
  const step = W / (buckets.length - 1);
  const pts = buckets.map((v, i) => [i * step, H - (v / max) * (H - 4) - 2]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fill = `M0,${H} ${pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} L${W},${H} Z`;
  return `
    <svg class="stat-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="stat-spark-fill" d="${fill}"/>
      <path class="stat-spark-line" d="${line}"/>
    </svg>
  `;
}

function renderSummary() {
  const tasks = state.workspace.tasks ?? [];
  const s = computeSummary(tasks, state.workspace.budget);
  const running = s.running ?? 0;
  const queued = s.queued ?? 0;
  const spend = s.monthlySpend ?? 0;
  // Rail badge — show in-flight count so users notice from any tab
  // when something is still running. Hides at zero. The .stat-strip
  // already shows the same numbers in detail; this is the at-a-glance
  // peripheral signal.
  const railBadge = document.getElementById("railBadgeTasks");
  if (railBadge) {
    const live = running + queued;
    if (live > 0) {
      railBadge.textContent = String(live);
      railBadge.hidden = false;
    } else {
      railBadge.hidden = true;
    }
  }
  // Idle mode: nothing in motion AND no money burned this month. Collapse
  // the 4-card strip to a thin summary line so zero-value cards stop
  // dominating the page. Today's success count + sparkline stay visible
  // because they still carry signal even when the queue is empty.
  const isIdle = running === 0 && queued === 0 && spend === 0;
  if (isIdle) {
    summaryGrid.classList.add("stat-strip--idle");
    summaryGrid.innerHTML = `
      <div class="stat-idle">
        <span class="stat-idle-dot" aria-hidden="true"></span>
        <span class="stat-idle-label">Idle — no active work</span>
        <span class="stat-idle-sep" aria-hidden="true"></span>
        <span class="stat-idle-metric"><strong>${escapeHtml(String(s.todaySuccess))}</strong> succeeded today</span>
        <span class="stat-idle-sep" aria-hidden="true"></span>
        <span class="stat-idle-metric stat-idle-metric--muted">${escapeHtml(formatMoney(spend))} this month</span>
      </div>
    `;
    return;
  }
  summaryGrid.classList.remove("stat-strip--idle");
  const cards = [
    { label: "Running", value: running, sub: "Active right now" },
    { label: "Queued", value: queued, sub: "Waiting for a worker" },
    { label: "Today", value: s.todaySuccess, sub: "Succeeded today", spark: buildTodaySparkline(tasks) },
    { label: "Spend", value: formatMoney(spend), sub: "This month" }
  ];
  summaryGrid.innerHTML = cards.map((c) => `
    <div class="stat-card">
      <div class="stat-card-label">${escapeHtml(c.label)}</div>
      <div class="stat-card-value">${escapeHtml(String(c.value))}</div>
      <div class="stat-card-sub">${escapeHtml(c.sub)}</div>
      ${c.spark ?? ""}
    </div>
  `).join("");
}

function renderOnboarding() {
  const kimi = state.workspace.health?.kimi ?? state.workspace.codeCliAdapters.find((i) => i.id === "kimi-code-cli") ?? null;
  const providerReady = state.workspace.providers.some((p) => p.available && p.configured);
  const tasks = state.workspace.tasks ?? [];
  const hasFileFlow = tasks.some((t) => ["file", "file_group"].includes(t.source_type));
  const hasBrowserFlow = tasks.some((t) => ["text_selection", "image", "webpage", "link"].includes(t.source_type));
  const steps = [
    { title: "Desktop UCA", status: "ready", detail: "Running in Electron shell." },
    { title: "Local Runtime", status: state.workspace.health?.ok ? "ready" : "action_needed", detail: state.workspace.health?.ok ? `Connected ${state.serviceBaseUrl}` : "Not connected." },
    { title: "Kimi Code CLI", status: kimi?.available ? "ready" : kimi?.configured ? "warning" : "action_needed", detail: kimi?.command ?? kimi?.detail ?? (providerReady ? "Cloud provider available." : "Install Kimi Code CLI first.") },
    { title: "File Entry", status: hasFileFlow ? "ready" : "recommended", detail: hasFileFlow ? "File entry tasks detected." : "Right-click files to start." },
    { title: "Browser Extension", status: hasBrowserFlow ? "ready" : "optional", detail: hasBrowserFlow ? "Web tasks detected." : "Enable for web context capture." }
  ];

  const hasBlocking = steps.some((s) => s.status === "action_needed");
  const hasRecommended = steps.some((s) => s.status === "recommended");
  onboardingState.textContent = hasBlocking ? "Action needed" : hasRecommended ? "Recommended" : "Ready";
  onboardingState.className = `chip ${hasBlocking ? "danger" : hasRecommended ? "warning" : "ready"}`;
  wizardList.innerHTML = steps.map((step, i) => `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${i + 1}. ${escapeHtml(step.title)}</strong>
        <span class="chip ${step.status === "ready" ? "ready" : step.status === "optional" ? "muted" : step.status === "recommended" ? "warning" : "danger"}">${escapeHtml(step.status)}</span>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:12px;">${escapeHtml(step.detail)}</p>
    </div>
  `).join("");
}

function renderIntegrations() {
  const health = state.workspace.health ?? {};
  const kimi = health.kimi ?? state.workspace.codeCliAdapters.find((i) => i.id === "kimi-code-cli") ?? null;
  const mcpCount = state.workspace.mcpServers?.length ?? 0;
  const skillCount = state.workspace.skills?.length ?? 0;
  const cards = [
    { title: "Kimi Code CLI", status: kimi?.available ? "ready" : kimi?.configured ? "warning" : "danger", detail: kimi?.command ?? kimi?.detail ?? "Primary execution path." },
    ...state.workspace.providers.slice(0, 3).map((p) => ({ title: p.displayName, status: p.available ? "ready" : p.configured ? "warning" : "danger", detail: p.detail ?? p.id })),
    { title: "MCP Servers", status: mcpCount > 0 ? "ready" : "muted", detail: mcpCount > 0 ? `${mcpCount} configured` : "None configured" },
    { title: "Skills", status: skillCount > 0 ? "ready" : "muted", detail: skillCount > 0 ? `${skillCount} discovered` : "None discovered" }
  ];
  integrationList.innerHTML = cards.map((c) => `
    <div class="integration-item" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(c.title)}</strong>
        <span class="chip ${c.status}">${escapeHtml(c.status)}</span>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:12px;">${escapeHtml(c.detail)}</p>
    </div>
  `).join("");
}

function renderEmailAccounts() {
  const accounts = state.workspace.emailAccounts ?? [];
  emailAccountCount.textContent = `${accounts.length}`;
  if (accounts.length === 0) {
    renderEmpty(emailAccountList, "No email accounts configured.");
    return;
  }
  emailAccountList.innerHTML = accounts.map((account) => `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(account.displayName ?? account.email ?? account.id)}</strong>
        <span class="chip ${account.enabled ? "ready" : "muted"}">${account.enabled ? "enabled" : "disabled"}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(account.email ?? "")} · ${escapeHtml(account.provider ?? "imap")}</p>
      <div class="toolbar" style="margin-top:6px;">
        <button class="btn btn-sm btn-danger" data-email-delete="${escapeHtml(account.id)}">Delete</button>
      </div>
    </div>
  `).join("");

  for (const btn of emailAccountList.querySelectorAll("[data-email-delete]")) {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.emailDelete;
      if (!id) return;
      emailAccountState.textContent = "Deleting...";
      try {
        await deleteEmailAccountViaShell(id);
        emailAccountState.textContent = "Deleted.";
        await refreshWorkspace();
      } catch (error) {
        emailAccountState.textContent = `Failed: ${error.message}`;
      }
    });
  }
}

function renderEmailDigestSettings() {
  const settings = state.workspace.emailDigestSettings ?? {};
  const enabled = settings.enabled !== false;
  if (emailDigestEnabled) emailDigestEnabled.checked = enabled;
  if (connDigestEnabled) connDigestEnabled.checked = enabled;
  if (emailDigestWindowStart) emailDigestWindowStart.value = settings.windowStart ?? "06:00";
  if (emailDigestWindowEnd) emailDigestWindowEnd.value = settings.windowEnd ?? "12:00";
  if (emailDigestSkipWeekends) emailDigestSkipWeekends.checked = Boolean(settings.skipWeekends);
}

function renderMcpServers() {
  const servers = state.workspace.mcpServers ?? [];
  mcpServerCount.textContent = `${servers.length}`;
  if (servers.length === 0) {
    renderEmpty(mcpServerList, "No MCP servers configured.");
    return;
  }
  mcpServerList.innerHTML = servers.map((server) => `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(server.displayName ?? server.id)}</strong>
        <span class="chip ${getMcpStatusView(server).className}">${escapeHtml(getMcpStatusView(server).label)}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(server.transport ?? "stdio")} · ${escapeHtml(server.command ?? server.url ?? "n/a")}</p>
      <div class="toolbar" style="margin-top:6px;">
        <button class="btn btn-sm btn-danger" data-mcp-delete="${escapeHtml(server.id)}">Delete</button>
      </div>
    </div>
  `).join("");

  for (const btn of mcpServerList.querySelectorAll("[data-mcp-delete]")) {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mcpDelete;
      if (!id) return;
      mcpServerState.textContent = "Deleting...";
      try {
        await deleteMcpServer(id);
        mcpServerState.textContent = "Deleted.";
        await refreshWorkspace();
      } catch (error) {
        mcpServerState.textContent = `Failed: ${error.message}`;
      }
    });
  }
}

function renderSkillRegistries() {
  const registries = state.workspace.skillRegistries ?? [];
  const skills = state.workspace.skills ?? [];
  const knownSkillCount = skills.length || registries.reduce((total, registry) => total + Number(registry.skillCount ?? 0), 0);
  skillRegistryCount.textContent = `${knownSkillCount}`;
  if (registries.length === 0 && skills.length === 0) {
    renderEmpty(skillRegistryList, "No skill registries or skills discovered.");
    return;
  }
  const registryCards = registries.map((registry) => `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(registry.displayName ?? registry.id)}</strong>
        <span class="chip ${registry.available ? "ready" : "warning"}">${escapeHtml(registry.available ? "ready" : "unavailable")}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(registry.rootPath ?? "n/a")} · ${escapeHtml(registry.skillCount ?? 0)} skills</p>
      <div class="toolbar" style="margin-top:6px;">
        <button class="btn btn-sm btn-danger" data-skill-registry-delete="${escapeHtml(registry.id)}">Delete</button>
      </div>
    </div>
  `).join("");
  const skillCards = skills.map((skill) => `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(skill.displayName ?? skill.name ?? skill.id ?? "Unnamed skill")}</strong>
        <span class="chip ready">skill</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">
        ${escapeHtml(skill.tags?.[0] ?? skill.registryId ?? "local")} · ${escapeHtml(skill.entryPath ?? skill.filePath ?? skill.path ?? "n/a")}
      </p>
      ${skill.description ? `<p style="margin-top:6px;font-size:12px;">${escapeHtml(skill.description)}</p>` : ""}
      ${skill.entryPath ? `<div class="toolbar" style="margin-top:8px;"><button class="btn" data-skill-edit="${escapeHtml(skill.entryPath)}" type="button">Edit</button></div>` : ""}
    </div>
  `).join("");
  skillRegistryList.innerHTML = `
    ${registryCards}
    ${skills.length ? `
      <div class="section-label" style="margin-top:8px;">Discovered skills · ${escapeHtml(skills.length)}</div>
      ${skillCards}
    ` : ""}
  `;

  for (const btn of skillRegistryList.querySelectorAll("[data-skill-registry-delete]")) {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.skillRegistryDelete;
      if (!id) return;
      skillRegistryState.textContent = "Deleting...";
      try {
        await deleteSkillRegistryViaShell(id);
        skillRegistryState.textContent = "Deleted.";
        await refreshWorkspace();
      } catch (error) {
        skillRegistryState.textContent = `Failed: ${error.message}`;
      }
    });
  }

  for (const btn of skillRegistryList.querySelectorAll("[data-skill-edit]")) {
    btn.addEventListener("click", () => void openSkillEditor(btn.dataset.skillEdit));
  }
}

async function openSkillEditor(entryPath) {
  if (!entryPath || !skillEditModal || !skillEditText) return;
  editingSkillPath = entryPath;
  skillEditState.textContent = "Loading...";
  skillEditPath.textContent = entryPath;
  skillEditModal.style.display = "flex";
  try {
    const payload = await fetchJson(`/skills/read?entryPath=${encodeURIComponent(entryPath)}`);
    skillEditText.value = payload.markdown ?? "";
    skillEditState.textContent = "Loaded.";
    skillEditText.focus();
  } catch (error) {
    skillEditState.textContent = `Failed: ${error.message}`;
  }
}

function closeSkillEditor() {
  editingSkillPath = null;
  if (skillEditModal) skillEditModal.style.display = "none";
  if (skillEditText) skillEditText.value = "";
  if (skillEditPath) skillEditPath.textContent = "";
  if (skillEditState) skillEditState.textContent = "";
}

function renderCodeCliAdapters() {
  const adapters = state.workspace.codeCliAdapters ?? [];
  codeCliAdapterCount.textContent = `${adapters.length}`;
  if (adapters.length === 0) {
    renderEmpty(codeCliAdapterList, "No code CLI adapters configured.");
    return;
  }
  codeCliAdapterList.innerHTML = adapters.map((adapter) => `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(adapter.displayName ?? adapter.id)}</strong>
        <span class="chip ${adapter.available ? "ready" : adapter.configured ? "warning" : "muted"}">${escapeHtml(adapter.available ? "ready" : adapter.configured ? "configured" : "missing")}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(adapter.executable ?? adapter.command ?? "n/a")} · ${escapeHtml(adapter.transport ?? "stream_json_print")}</p>
      <div class="toolbar" style="margin-top:6px;">
        <button class="btn btn-sm btn-danger" data-code-cli-delete="${escapeHtml(adapter.id)}">Delete</button>
      </div>
    </div>
  `).join("");

  for (const btn of codeCliAdapterList.querySelectorAll("[data-code-cli-delete]")) {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.codeCliDelete;
      if (!id) return;
      codeCliAdapterState.textContent = "Deleting...";
      try {
        await deleteCodeCliAdapterViaShell(id);
        codeCliAdapterState.textContent = "Deleted.";
        await refreshWorkspace();
      } catch (error) {
        codeCliAdapterState.textContent = `Failed: ${error.message}`;
      }
    });
  }
}
// ── Provider + routing state ──
let customProviders = [];
let taskRouting = {};
const providerModelOptionsCache = new Map();
const providerModelOptionsLoading = new Set();

function providerModelOptionsExpired(meta = null) {
  if (!meta?.expiresAt) return false;
  const expiresAt = Date.parse(meta.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

const TASK_TYPES = [
  { id: "chat", label: "Chat / Q&A", desc: "General conversation, summarize, translate, explain" },
  { id: "router", label: "Semantic Router", desc: "Optional fast classifier; leave unselected to inherit Chat / Q&A" },
  { id: "embedding", label: "Embedding / RAG", desc: "Optional vector memory model; leave unselected to use the Chat provider fallback" },
  { id: "vision", label: "Vision / Image", desc: "Image analysis, screenshot understanding" },
  { id: "file_analysis", label: "File Analysis", desc: "Deep file processing, report generation (uses the routed provider)" },
  { id: "audio_transcription", label: "Audio Transcription", desc: "Speech-to-text for recording notes and system audio" }
];

// Mirrors providerCanVision() in multi-modal-executor.mjs. Modern
// agentic code CLIs (Claude Code / Codex / Kimi Code / Gemini CLI /
// etc) all have a Read tool so they handle images via file paths in
// the prompt — we trust them by default. Only kind:"ollama" with a
// text-only model is flagged as "can't see images", because those
// models genuinely lack a vision layer.
function providerCanVisionFrontend(provider) {
  if (!provider) return false;
  const hasApiKey = Boolean(provider.apiKey || provider.apiKeyRef || provider.apiKeyConfigured);
  if (provider.supportsVision === true) return true;
  if (provider.supportsVision === false) return false;
  if (provider.kind === "anthropic" && hasApiKey) return true;
  if (provider.kind === "openai" && hasApiKey) {
    const fp = `${provider.baseUrl ?? ""} ${provider.defaultModel ?? ""} ${provider.name ?? ""}`.toLowerCase();
    return /api\.openai\.com|generativelanguage|gemini|glm|qwen|pixtral|mistral|openrouter|siliconflow|gpt-5|gpt-4o|gpt-4-vision|claude-3|claude-sonnet|claude-opus|doubao|ark|volces/.test(fp);
  }
  if (provider.kind === "code_cli") return true;
  if (provider.kind === "ollama") {
    const m = `${provider.defaultModel ?? ""}`.toLowerCase();
    return /llava|llama-?3\.2.*vision|qwen.*vl|minicpm.*v|bakllava/.test(m);
  }
  return false;
}

function uniqueModelChoices(choices = []) {
  const seen = new Set();
  const out = [];
  for (const choice of choices) {
    const id = `${choice?.id ?? choice ?? ""}`.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: `${choice?.label ?? (id || "(CLI 自行管理)")}`.trim()
    });
  }
  return out;
}

function cachedModelChoicesForProvider(provider) {
  if (!provider?.id) return null;
  const cached = providerModelOptionsCache.get(provider.id);
  if (providerModelOptionsExpired(cached)) return null;
  if (!cached?.models?.length) return null;
  return uniqueModelChoices(cached.models);
}

async function loadProviderModelOptions(providerId) {
  const cached = providerModelOptionsCache.get(providerId);
  if (!providerId || (!providerModelOptionsExpired(cached) && providerModelOptionsCache.has(providerId)) || providerModelOptionsLoading.has(providerId)) return;
  providerModelOptionsLoading.add(providerId);
  try {
    const refresh = providerModelOptionsExpired(cached) ? "&refresh=1" : "";
    const data = await fetchJson(`/config/provider-model-options?providerId=${encodeURIComponent(providerId)}${refresh}`);
    if (data.option) providerModelOptionsCache.set(providerId, data.option);
  } catch (error) {
    const fetchedAt = new Date().toISOString();
    providerModelOptionsCache.set(providerId, {
      source: "unavailable",
      models: [],
      reasoningEfforts: [],
      error: error.message,
      fetchedAt,
      expiresAt: new Date(Date.parse(fetchedAt) + 60_000).toISOString()
    });
  } finally {
    providerModelOptionsLoading.delete(providerId);
    renderTaskRouting();
  }
}

async function prefetchProviderModelOptions({ refresh = false } = {}) {
  if (!customProviders.length) return;
  const query = refresh ? "?refresh=1" : "";
  for (const provider of customProviders) {
    providerModelOptionsLoading.add(provider.id);
  }
  try {
    const data = await fetchJson(`/config/provider-model-options${query}`);
    for (const provider of customProviders) {
      const option = data.options?.[provider.id];
      if (option) providerModelOptionsCache.set(provider.id, option);
    }
  } catch (error) {
    console.warn("Failed to prefetch provider model options", error);
  } finally {
    for (const provider of customProviders) {
      providerModelOptionsLoading.delete(provider.id);
    }
    renderTaskRouting();
  }
}

function modelChoicesForProvider(provider, taskType = "chat") {
  if (!provider) return [];
  const cachedChoices = cachedModelChoicesForProvider(provider);
  if (cachedChoices?.length) {
    if (provider.kind === "code_cli") {
      const hasCliManaged = cachedChoices.some((choice) => choice.id === "");
      return uniqueModelChoices([
        ...(hasCliManaged ? [] : [{ id: "", label: "(CLI 自行管理)" }]),
        ...cachedChoices
      ]);
    }
    return uniqueModelChoices([
      ...cachedChoices,
      ...providerModelPresets(provider, taskType).map((id) => ({ id, label: id }))
    ]);
  }

  if (provider.kind === "code_cli") return codeCliModelChoices(provider);
  return providerModelPresets(provider, taskType).map((id) => ({ id, label: id }));
}

function modeOptionsForModel(provider, model = "") {
  return catalogModeOptionsForProvider(provider, model);
}

function defaultModelForProvider(provider, taskType = "chat") {
  // For code_cli we default to "(CLI-managed)" which is the empty string —
  // that's intentional: it means "don't pass --model, let the CLI decide".
  if (provider?.kind === "code_cli") return "";
  if (provider?.kind === "openai" && taskType === "audio_transcription") return "whisper-1";
  return providerModelPresets(provider, taskType)[0] ?? "";
}

// Reasoning / thinking knob. The shared provider catalog owns the canonical
// option set so the renderer, config sanitiser, and request builders all stay
// in sync for OpenAI, Doubao, and Codex.
function reasoningEffortOptions(provider, model = "") {
  if (!provider) return [];
  return catalogReasoningOptionsForProvider(provider, model);
}

function supportsReasoningEffort(provider, model = "") {
  return reasoningEffortOptions(provider, model).length > 0;
}

function modeForModel(provider, model, currentMode = "") {
  const options = modeOptionsForModel(provider, model);
  if (options.some((option) => option.id === currentMode)) return currentMode;
  return options.find((option) => option.model === model)?.id ?? "default";
}

function modelForMode(provider, currentModel, mode) {
  const option = modeOptionsForModel(provider, currentModel).find((entry) => entry.id === mode);
  return option?.model ?? currentModel ?? "";
}

async function loadProvidersAndRouting() {
  try {
    const data = await fetchJson("/config/providers");
    customProviders = data.providers ?? [];
    taskRouting = data.taskRouting ?? {};
    providerModelOptionsCache.clear();
    providerModelOptionsLoading.clear();
    renderProvidersList();
    renderTaskRouting();
    void prefetchProviderModelOptions();
  } catch (error) {
    console.error("Failed to load providers", error);
  }
}

function renderProvidersList() {
  const el = document.getElementById("providersList");
  if (!el) return;

  if (customProviders.length === 0) {
    el.innerHTML = `<div style="padding:14px;border-radius:10px;background:var(--surface-strong);border:1px dashed var(--line);text-align:center;">
      <p class="muted" style="font-size:12px;margin:0;">No providers configured. Click "+ Add Provider" to start.</p>
    </div>`;
    return;
  }

  el.innerHTML = customProviders.map((p) => {
    const isCli = p.kind === "code_cli";
    const isActive = isCli ? Boolean(p.command) : (p.kind === "ollama" || Boolean(p.apiKey || p.apiKeyRef || p.apiKeyConfigured));
    const kindLabel = { anthropic: "Anthropic", openai: "OpenAI compat", ollama: "Ollama local", code_cli: "Code CLI" }[p.kind] ?? p.kind;
    const subtitle = isCli ? (p.command || "no command") : (p.baseUrl || "default URL");
    return `
      <div style="padding:12px;border-radius:10px;background:var(--surface-strong);border:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <strong style="font-size:13px;">${escapeHtml(p.name)}</strong>
            <span class="chip ${isActive ? "ready" : "muted"}" style="font-size:10px;">${isActive ? "Active" : (isCli ? "No path" : "No key")}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px;">${escapeHtml(kindLabel)} · ${escapeHtml(subtitle)}</div>
          ${p.defaultModel ? `<div style="font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:2px;">${escapeHtml(p.defaultModel)}</div>` : ""}
        </div>
        <div class="toolbar">
          <button class="btn btn-ghost" type="button" data-edit-provider="${escapeHtml(p.id)}">Edit</button>
          <button class="btn btn-sm btn-danger" type="button" data-delete-provider="${escapeHtml(p.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  for (const btn of el.querySelectorAll("[data-edit-provider]")) {
    btn.addEventListener("click", () => openProviderModal(btn.dataset.editProvider));
  }
  for (const btn of el.querySelectorAll("[data-delete-provider]")) {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this provider?")) return;
      await deleteProviderViaShell(btn.dataset.deleteProvider);
      await loadProvidersAndRouting();
    });
  }
}

function renderTaskRouting() {
  const el = document.getElementById("taskRoutingForm");
  if (!el) return;

  // Always render task routing — even with no providers, show empty selects with "+ Add provider" hint
  const noProviders = customProviders.length === 0;

  el.innerHTML = TASK_TYPES.map((task) => {
    const route = taskRouting[task.id] ?? {};
    // For the Vision task, mark which providers can actually read
    // images. The backend will auto-switch if the user picks a
    // non-vision one (UCA-148), but flagging up front saves a round-
    // trip for users paying attention.
    const isVisionTask = task.id === "vision";
    const providerOptions = ['<option value="">— Select provider —</option>']
      .concat(customProviders.map((p) => {
        const suffix = isVisionTask
          ? providerCanVisionFrontend(p) ? " 👁" : " (text-only)"
          : "";
        return `<option value="${escapeHtml(p.id)}" ${route.providerId === p.id ? "selected" : ""}>${escapeHtml(p.name)} (${escapeHtml(p.kind)})${suffix}</option>`;
      }))
      .join("");

    const selectedProvider = customProviders.find((p) => p.id === route.providerId);
    const isVisionMisconfig = isVisionTask && selectedProvider && !providerCanVisionFrontend(selectedProvider);
    const modelValue = route.model ?? "";
    const isCli = selectedProvider?.kind === "code_cli";
    if (selectedProvider?.id && !providerModelOptionsCache.has(selectedProvider.id)) {
      void loadProviderModelOptions(selectedProvider.id);
    } else if (selectedProvider?.id && providerModelOptionsExpired(providerModelOptionsCache.get(selectedProvider.id))) {
      void loadProviderModelOptions(selectedProvider.id);
    }

    // For code_cli we render labelled choices (id + label). For API kinds we
    // keep the old "preset as plain string" flow since those model IDs are
    // the display text.
    let modelOptions = "";
    const rawOptionMeta = selectedProvider?.id ? providerModelOptionsCache.get(selectedProvider.id) : null;
    const optionMeta = providerModelOptionsExpired(rawOptionMeta) ? null : rawOptionMeta;
    const optionLoading = selectedProvider?.id ? providerModelOptionsLoading.has(selectedProvider.id) : false;
    if (selectedProvider) {
      if (isCli) {
        const choices = modelChoicesForProvider(selectedProvider, task.id);
        const hasSavedChoice = choices.some((c) => c.id === modelValue);
        const preamble = !hasSavedChoice && modelValue
          ? `<option value="${escapeHtml(modelValue)}" selected>${escapeHtml(modelValue)} (保存值)</option>`
          : "";
        modelOptions = preamble + choices.map((c) =>
          `<option value="${escapeHtml(c.id)}" ${c.id === modelValue ? "selected" : ""}>${escapeHtml(c.label)}</option>`
        ).join("") + `<option value="__custom__" style="font-style:italic;">✏️ 自定义…</option>`;
      } else {
        const choices = modelChoicesForProvider(selectedProvider, task.id);
        const allModelChoices = uniqueModelChoices([{ id: modelValue, label: modelValue }, ...choices]);
        modelOptions = allModelChoices.map((m) =>
          `<option value="${escapeHtml(m.id)}" ${m.id === modelValue ? "selected" : ""}>${escapeHtml(m.label)}</option>`
        ).join("") + `<option value="__custom__" style="font-style:italic;">✏️ 自定义…</option>`;
      }
    }
    const modelMeta = selectedProvider
      ? optionLoading
        ? "正在刷新模型列表..."
        : optionMeta?.dynamic
          ? `模型列表来自 ${optionMeta.source}${optionMeta.stale ? "（缓存回退）" : ""}${optionMeta.truncated ? "（已截断）" : ""}`
          : optionMeta?.error
            ? `模型列表使用兜底：${optionMeta.error}`
            : "模型列表使用内置兜底"
      : "";

    const modeValue = modeForModel(selectedProvider, modelValue, route.mode ?? "");
    const modeOpts = selectedProvider
      ? modeOptionsForModel(selectedProvider, modelValue || defaultModelForProvider(selectedProvider, task.id))
      : [];
    const modeOptionsHtml = modeOpts.map((mode) =>
      `<option value="${escapeHtml(mode.id)}" ${modeValue === mode.id ? "selected" : ""}>${escapeHtml(mode.label)}</option>`
    ).join("");
    // Hide the Mode select entirely for code_cli (it's always an inert
    // placeholder now that labels live in the model dropdown).
    const hideMode = isCli || modeOpts.length <= 1;

    // Reasoning / thinking knob (Codex, Doubao, GPT-5/o-series). Renders in
    // the slot where Mode would otherwise be, so the grid keeps 3 columns.
    const reasoningOpts = reasoningEffortOptions(selectedProvider, modelValue);
    const showReasoning = reasoningOpts.length > 0;
    const reasoningValue = route.reasoningEffort === "extra_high" ? "xhigh" : (route.reasoningEffort ?? "");
    const reasoningOptionsHtml = reasoningOpts.map((opt) =>
      `<option value="${escapeHtml(opt.id)}" ${opt.id === reasoningValue ? "selected" : ""}>${escapeHtml(opt.label)}</option>`
    ).join("");

    return `
      <div style="padding:12px;border-radius:10px;background:var(--surface-strong);border:1px solid var(--line);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <strong style="font-size:13px;">${escapeHtml(task.label)}</strong>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">${escapeHtml(task.desc)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">
          <select data-routing-provider="${escapeHtml(task.id)}" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);" ${noProviders ? "disabled" : ""}>${providerOptions}</select>
          <select data-routing-model="${escapeHtml(task.id)}" title="Model" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);" ${noProviders || !selectedProvider ? "disabled" : ""}>${modelOptions}</select>
          ${showReasoning ? `<select data-routing-reasoning="${escapeHtml(task.id)}" title="Reasoning effort" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);">${reasoningOptionsHtml}</select>` : ""}
          ${!hideMode && !showReasoning ? `<select data-routing-mode="${escapeHtml(task.id)}" title="Mode" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);" ${noProviders || !selectedProvider ? "disabled" : ""}>${modeOptionsHtml}</select>` : ""}
        </div>
        ${modelMeta ? `<div style="font-size:10px;color:var(--muted);margin-top:6px;">${escapeHtml(modelMeta)}</div>` : ""}
        ${isVisionMisconfig ? `<div style="font-size:11px;color:var(--warn);margin-top:6px;line-height:1.4;">⚠️ 这个 provider 可能不支持图片（例如 Ollama 用的是纯文本模型）。如果它实际能读图，加 <code>supportsVision: true</code> 覆盖。</div>` : ""}
      </div>
    `;
  }).join("") + (noProviders ? `
    <div style="padding:14px;border-radius:10px;background:var(--accent-soft);border:1px dashed var(--accent);text-align:center;margin-top:4px;">
      <p style="font-size:12px;margin:0 0 8px;color:var(--ink-soft);">No providers added yet. Add one to enable routing.</p>
      <button id="routingAddProviderBtn" type="button" class="btn btn-primary" style="font-size:12px;">+ Add Provider</button>
    </div>
  ` : "");

  document.getElementById("routingAddProviderBtn")?.addEventListener("click", () => openProviderModal());

  // re-render model options when provider changes
  for (const sel of el.querySelectorAll("[data-routing-provider]")) {
    sel.addEventListener("change", () => {
      const taskId = sel.dataset.routingProvider;
      const provider = customProviders.find((p) => p.id === sel.value);
      const model = provider ? defaultModelForProvider(provider, taskId) : "";
      const next = {
        providerId: sel.value,
        model,
        mode: provider ? modeForModel(provider, model, "") : ""
      };
      // Preserve prior reasoningEffort only when the new provider still
      // supports it with the same model (Codex↔Codex, Doubao↔Doubao,
      // GPT-5↔GPT-5). Otherwise drop it so stale params don't leak across.
      const previous = taskRouting[taskId] ?? {};
      if (provider && supportsReasoningEffort(provider, model) && previous.reasoningEffort) {
        next.reasoningEffort = previous.reasoningEffort;
      }
      taskRouting[taskId] = next;
      renderTaskRouting();
    });
  }
  for (const sel of el.querySelectorAll("[data-routing-reasoning]")) {
    sel.addEventListener("change", () => {
      const taskId = sel.dataset.routingReasoning;
      const route = taskRouting[taskId] ?? {};
      const next = { ...route };
      if (sel.value) next.reasoningEffort = sel.value;
      else delete next.reasoningEffort;
      taskRouting[taskId] = next;
      renderTaskRouting();
    });
  }
  for (const sel of el.querySelectorAll("[data-routing-model]")) {
    sel.addEventListener("change", () => {
      const taskId = sel.dataset.routingModel;
      const route = taskRouting[taskId] ?? {};
      const provider = customProviders.find((p) => p.id === route.providerId);

      let model = sel.value;
      if (model === "__custom__") {
        const custom = globalThis.prompt?.("输入自定义模型名称：", route.model ?? "");
        if (custom && custom.trim()) {
          model = custom.trim();
        } else {
          // Cancel — revert select to the previous saved value.
          sel.value = route.model ?? "";
          return;
        }
      }

      taskRouting[taskId] = {
        ...route,
        model,
        mode: modeForModel(provider, model, "")
      };
      renderTaskRouting();
    });
  }
  for (const sel of el.querySelectorAll("[data-routing-mode]")) {
    sel.addEventListener("change", () => {
      const taskId = sel.dataset.routingMode;
      const route = taskRouting[taskId] ?? {};
      const provider = customProviders.find((p) => p.id === route.providerId);
      const model = modelForMode(provider, route.model, sel.value);
      taskRouting[taskId] = { ...route, model, mode: sel.value };
      renderTaskRouting();
    });
  }
}

function toggleProviderFieldsByKind(kind) {
  const apiFields = document.getElementById("provApiFields");
  const cliFields = document.getElementById("provCliFields");
  const isCli = kind === "code_cli";
  if (apiFields) apiFields.style.display = isCli ? "none" : "flex";
  if (cliFields) cliFields.style.display = isCli ? "flex" : "none";
}

// Render the quick-template chip row inside the Add Provider modal. Clicking
// a chip prefills kind / baseUrl / defaultModel / suggested name; the user
// only needs to paste their API key. Templates are a union of popular
// OpenAI-compatible endpoints plus native Anthropic / Ollama.
function renderProviderQuickTemplates() {
  const host = document.getElementById("provQuickTemplates");
  if (!host) return;
  host.innerHTML = BUILTIN_API_TEMPLATES.map((tpl) =>
    `<button type="button" data-tpl-id="${escapeHtml(tpl.id)}" style="font-size:11px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface-strong);color:var(--ink-soft);cursor:pointer;">${escapeHtml(tpl.label)}</button>`
  ).join("");
  for (const btn of host.querySelectorAll("[data-tpl-id]")) {
    btn.addEventListener("click", () => {
      const tpl = BUILTIN_API_TEMPLATES.find((t) => t.id === btn.dataset.tplId);
      if (!tpl) return;
      const nameEl = document.getElementById("provName");
      const kindEl = document.getElementById("provKind");
      const baseUrlEl = document.getElementById("provBaseUrl");
      const defaultModelEl = document.getElementById("provDefaultModel");
      if (nameEl && !nameEl.value.trim()) nameEl.value = tpl.label;
      if (kindEl) kindEl.value = tpl.kind;
      if (baseUrlEl) baseUrlEl.value = tpl.baseUrl;
      if (defaultModelEl) defaultModelEl.value = tpl.defaultModel;
      toggleProviderFieldsByKind(tpl.kind);
      // Nudge the API-key input so user knows that's their next step.
      document.getElementById("provApiKey")?.focus();
    });
  }
}

function openProviderModal(editId = null) {
  const modal = document.getElementById("providerModal");
  const original = document.getElementById("provEditOriginalId");
  const name = document.getElementById("provName");
  const kind = document.getElementById("provKind");
  const baseUrl = document.getElementById("provBaseUrl");
  const apiKey = document.getElementById("provApiKey");
  const command = document.getElementById("provCommand");
  const args = document.getElementById("provArgs");
  const transport = document.getElementById("provTransport");
  const defaultModel = document.getElementById("provDefaultModel");

  renderProviderQuickTemplates();

  if (editId) {
    const existing = customProviders.find((p) => p.id === editId);
    if (existing) {
      original.value = existing.id;
      name.value = existing.name ?? "";
      kind.value = existing.kind ?? "anthropic";
      baseUrl.value = existing.baseUrl ?? "";
      apiKey.value = existing.apiKey ?? "";
      apiKey.placeholder = (existing.apiKey || existing.apiKeyRef || existing.apiKeyConfigured)
        ? "Stored key configured; leave blank to keep"
        : "sk-...";
      command.value = existing.command ?? "";
      args.value = (existing.args ?? []).join(" ");
      transport.value = existing.transport ?? "stream_json_print";
      defaultModel.value = existing.defaultModel ?? "";
    }
  } else {
    original.value = "";
    name.value = "";
    kind.value = "anthropic";
    baseUrl.value = "https://api.anthropic.com";
    apiKey.value = "";
    apiKey.placeholder = "sk-...";
    command.value = "";
    args.value = "";
    transport.value = "stream_json_print";
    defaultModel.value = "";
  }

  toggleProviderFieldsByKind(kind.value);
  modal.style.display = "flex";
  setTimeout(() => name.focus(), 50);
}

function closeProviderModal() {
  document.getElementById("providerModal").style.display = "none";
}

document.getElementById("addProviderBtn")?.addEventListener("click", () => openProviderModal());
document.getElementById("provCancelBtn")?.addEventListener("click", closeProviderModal);

// Auto-detect installed code CLIs
document.getElementById("provDetectCliBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("provDetectCliBtn");
  const results = document.getElementById("provDetectResults");
  btn.disabled = true;
  btn.textContent = "Scanning...";
  try {
    const data = await fetchJson("/config/detect-clis");
    const clis = data.clis ?? [];
    if (clis.length === 0) {
      results.style.display = "block";
      results.innerHTML = `<p class="muted" style="font-size:11px;margin:4px 0;">No CLIs found. Common paths checked: %USERPROFILE%\\.local\\bin, npm global, scoop, Program Files. Enter the path manually below.</p>`;
    } else {
      results.style.display = "block";
      results.innerHTML = `<div class="stack" style="gap:6px;">${clis.map((c, i) => `
        <button type="button" data-cli-index="${i}" style="text-align:left;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface-strong);cursor:pointer;font-size:12px;">
          <strong>${escapeHtml(c.name)}</strong>
          ${c.version ? `<span class="muted" style="font-size:10px;margin-left:6px;">${escapeHtml(c.version)}</span>` : ""}
          <div class="muted" style="font-size:10px;font-family:var(--font-mono);margin-top:2px;">${escapeHtml(c.command)}</div>
        </button>
      `).join("")}</div>`;

      // store for click handlers
      window.__detectedClis = clis;
      for (const optBtn of results.querySelectorAll("[data-cli-index]")) {
        optBtn.addEventListener("click", () => {
          const cli = window.__detectedClis[Number(optBtn.dataset.cliIndex)];
          if (!cli) return;
          if (!document.getElementById("provName").value) document.getElementById("provName").value = cli.name;
          document.getElementById("provCommand").value = cli.command;
          document.getElementById("provArgs").value = (cli.args ?? []).join(" ");
          document.getElementById("provTransport").value = cli.transport ?? "stream_json_print";
          if (!document.getElementById("provDefaultModel").value && cli.defaultModel) {
            document.getElementById("provDefaultModel").value = cli.defaultModel;
          }
          results.style.display = "none";
        });
      }
    }
  } catch (error) {
    results.style.display = "block";
    results.innerHTML = `<p class="muted" style="font-size:11px;margin:4px 0;color:var(--danger);">Detection failed: ${escapeHtml(error.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Auto-detect installed CLIs";
  }
});

// auto-fill base URL + toggle fields when kind changes
document.getElementById("provKind")?.addEventListener("change", (e) => {
  const v = e.target.value;
  toggleProviderFieldsByKind(v);
  const baseUrl = document.getElementById("provBaseUrl");
  if (v !== "code_cli" && (!baseUrl.value || ["https://api.anthropic.com", "https://api.openai.com/v1", "http://127.0.0.1:11434"].includes(baseUrl.value))) {
    baseUrl.value = {
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com/v1",
      ollama: "http://127.0.0.1:11434"
    }[v] ?? "";
  }
  // auto-trigger CLI detection when switching to Code CLI mode if command is empty
  if (v === "code_cli" && !document.getElementById("provCommand").value) {
    document.getElementById("provDetectCliBtn")?.click();
  }
});

document.getElementById("providerEditForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const original = document.getElementById("provEditOriginalId").value;
  const name = document.getElementById("provName").value.trim();
  const kind = document.getElementById("provKind").value;
  const id = original || `${kind}.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.${Date.now().toString(36).slice(-4)}`;

  const payload = {
    id,
    name,
    kind,
    defaultModel: document.getElementById("provDefaultModel").value.trim()
  };

  if (kind === "code_cli") {
    payload.command = document.getElementById("provCommand").value.trim();
    const argsRaw = document.getElementById("provArgs").value.trim();
    payload.args = argsRaw ? argsRaw.split(/\s+/) : [];
    payload.transport = document.getElementById("provTransport").value;
  } else {
    payload.baseUrl = document.getElementById("provBaseUrl").value.trim();
    const apiKey = document.getElementById("provApiKey").value.trim();
    if (apiKey) payload.apiKey = apiKey;
  }

  await saveProviderViaShell(payload);
  closeProviderModal();
  await loadProvidersAndRouting();
});

document.getElementById("saveRoutingBtn")?.addEventListener("click", async () => {
  const stateEl = document.getElementById("routingSaveState");
  stateEl.textContent = "Saving...";
  try {
    await updateRoutingConfigViaShell(taskRouting);
    stateEl.textContent = "Saved.";
    setTimeout(() => { stateEl.textContent = ""; }, 2000);
  } catch (error) {
    stateEl.textContent = `Failed: ${error.message}`;
  }
});

function renderOfficeAddinSetupStatus(status) {
  if (!officeAddinSetupState) {
    return;
  }

  if (!status) {
    officeAddinSetupState.textContent = "Not checked yet.";
    return;
  }

  const manifestSummary = (status.manifests ?? [])
    .map((manifest) => `${manifest.host}: ${manifest.targetExists ? "ready" : "missing"}`)
    .join(" · ");
  const readyText = status.ok ? "Ready" : "Needs setup";
  const adminText = status.isAdministrator ? "admin" : "standard user";
  const shareUrl = status.shareUrl ?? "\\\\<computer>\\UCAOfficeAddins";
  const refreshText = status.clearInstalledExtensions === 1 ? "refresh: queued" : "refresh: not queued";
  const cacheText = status.cacheReset
    ? "cache: reset"
    : (status.officeWefCacheExists && status.officeWefCacheItemCount > 0 ? "cache: present" : "cache: clear");
  const runningHosts = (status.runningOfficeHosts ?? []).length > 0 ? ` · close: ${status.runningOfficeHosts.join(", ")}` : "";
  officeAddinSetupState.textContent = `${readyText} · ${shareUrl} · share: ${status.shareExists ? "yes" : "no"} · readable: ${status.shareReadable ? "yes" : "no"} · trusted: ${status.registryTrusted ? "yes" : "no"} · ${refreshText} · ${cacheText} · ${adminText}${manifestSummary ? ` · ${manifestSummary}` : ""}${runningHosts}`;
  officeAddinSetupState.className = status.ok ? "muted ready-text" : "muted";
}

async function refreshOfficeAddinSetupStatus() {
  if (!officeAddinSetupState) {
    return;
  }
  officeAddinSetupState.textContent = "Checking Office Add-in setup...";
  try {
    const status = await fetchJson("/setup/office-addins/status");
    renderOfficeAddinSetupStatus(status);
  } catch (error) {
    officeAddinSetupState.textContent = `Check failed: ${error.message}`;
  }
}

async function configureOfficeAddins() {
  if (!officeAddinSetupState) {
    return;
  }
  setupOfficeAddinsButton.disabled = true;
  officeAddinSetupState.textContent = "Configuring... You may see a Windows administrator prompt.";
  try {
    const status = await setupOfficeAddinsViaShell({
      elevate: true,
      resetCache: true
    });
    renderOfficeAddinSetupStatus(status);
  } catch (error) {
    officeAddinSetupState.textContent = `Configure failed: ${error.message}`;
  } finally {
    setupOfficeAddinsButton.disabled = false;
  }
}

// UCA-108: Which filter a task matches. The "errors" bucket covers the
// handful of failure-ish statuses the runtime emits; "running" also
// captures "cancelling" since the UI treats that as still in flight.
function taskMatchesFilter(task, filter) {
  if (filter === "all") return true;
  if (filter === "running") return ["running", "cancelling"].includes(task.status);
  if (filter === "queued") return task.status === "queued";
  if (filter === "success") return task.status === "success";
  if (filter === "errors") return ["failed", "cancelled", "partial_success"].includes(task.status);
  return true;
}

// UCA-121: date + source filters replace the retired Memory tab.
// dateFilter: "all" | "today" | "7d" | "30d"
function taskMatchesDate(task, dateFilter) {
  if (!dateFilter || dateFilter === "all") return true;
  const raw = task.created_at ?? task.updated_at ?? "";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return true;  // don't hide tasks with missing timestamps
  const now = Date.now();
  if (dateFilter === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return ts >= startOfDay.getTime();
  }
  if (dateFilter === "7d")  return (now - ts) <= 7  * 24 * 60 * 60 * 1000;
  if (dateFilter === "30d") return (now - ts) <= 30 * 24 * 60 * 60 * 1000;
  return true;
}

// sourceFilter: "all" or one of the aggregated values from taskSourceCandidates().
function taskMatchesSource(task, sourceFilter) {
  if (!sourceFilter || sourceFilter === "all") return true;
  const src = task.source_type ?? task.executor ?? "";
  return src === sourceFilter;
}

// Aggregate the unique source values present in the current task set.
// Order: overlay / chat / schedule / email / cli / mcp / api / other.
function taskSourceCandidates(tasks) {
  const seen = new Set();
  for (const t of tasks) {
    const src = t.source_type ?? t.executor ?? "";
    if (src) seen.add(src);
  }
  const preferred = ["overlay", "chat", "schedule", "email", "cli", "mcp", "api"];
  const ordered = preferred.filter((s) => seen.has(s));
  for (const s of [...seen].sort()) if (!ordered.includes(s)) ordered.push(s);
  return ordered;
}

function countTasksByFilter(tasks) {
  return {
    all: tasks.length,
    running: tasks.filter((t) => taskMatchesFilter(t, "running")).length,
    queued: tasks.filter((t) => taskMatchesFilter(t, "queued")).length,
    success: tasks.filter((t) => taskMatchesFilter(t, "success")).length,
    errors: tasks.filter((t) => taskMatchesFilter(t, "errors")).length
  };
}

function renderTasks() {
  const allTasks = state.workspace.tasks ?? [];
  // Update filter chip counts from the unfiltered list so every chip
  // always shows its real matchable set, not whatever the current
  // filter happens to display.
  const counts = countTasksByFilter(allTasks);
  for (const el of document.querySelectorAll("[data-count-for]")) {
    const bucket = el.dataset.countFor;
    el.textContent = `${counts[bucket] ?? 0}`;
  }

  // UCA-121: rebuild the source-filter chip row from the current tasks
  // so sources surface only when there's at least one task in that source.
  const sourceChipRow = document.querySelector("#taskSourceFilterChips");
  if (sourceChipRow) {
    const sources = taskSourceCandidates(allTasks);
    const allChip = sourceChipRow.querySelector('[data-source="all"]');
    const existing = [...sourceChipRow.querySelectorAll('[data-source]:not([data-source="all"])')];
    const existingSet = new Set(existing.map((b) => b.dataset.source));
    // Add missing source chips.
    for (const s of sources) {
      if (existingSet.has(s)) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.dataset.source = s;
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = s;
      btn.addEventListener("click", () => handleTaskSourceChip(btn));
      sourceChipRow.appendChild(btn);
    }
    // Remove stale chips whose source no longer exists.
    for (const b of existing) {
      if (!sources.includes(b.dataset.source)) b.remove();
    }
    // If the currently-selected source no longer exists, fall back to "all".
    if (state.taskSourceFilter !== "all" && !sources.includes(state.taskSourceFilter)) {
      state.taskSourceFilter = "all";
      sourceChipRow.querySelectorAll(".filter-chip").forEach((b) =>
        b.setAttribute("aria-pressed", b.dataset.source === "all" ? "true" : "false")
      );
    }
  }

  // Apply filter + search + date + source (all AND'd).
  const filter = state.taskFilter ?? "all";
  const search = (state.taskSearch ?? "").trim().toLowerCase();
  const dateFilter = state.taskDateFilter ?? "all";
  const sourceFilter = state.taskSourceFilter ?? "all";
  let tasks = allTasks.filter((t) =>
    taskMatchesFilter(t, filter)
    && taskMatchesDate(t, dateFilter)
    && taskMatchesSource(t, sourceFilter)
  );
  if (search) {
    tasks = tasks.filter((t) =>
      (t.user_command ?? "").toLowerCase().includes(search)
      || (t.intent ?? "").toLowerCase().includes(search)
      || (t.task_id ?? "").toLowerCase().includes(search)
    );
  }

  taskCount.textContent = `${tasks.length}`;
  if (tasks.length === 0) {
    if (allTasks.length === 0) {
      // First-run friendly empty state — give them a clear next step.
      // The page-head already has "New task" + Refresh; this just
      // mirrors them inside the empty list so the user notices.
      taskList.innerHTML = `
        <div class="empty-state" style="text-align:center;padding:28px 16px;">
          <p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.55;">
            还没有任何任务。Ctrl+K 打开命令面板，或点 Chat 直接对话。
          </p>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-primary" id="taskListEmptyNewBtn" title="Ctrl+K">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              新建任务
            </button>
            <button type="button" class="btn btn-sm" id="taskListEmptyChatBtn">
              去 Chat
            </button>
          </div>
        </div>
      `;
      taskList.querySelector("#taskListEmptyNewBtn")?.addEventListener("click", () => {
        document.querySelector("#tasksNewBtn")?.click();
      });
      taskList.querySelector("#taskListEmptyChatBtn")?.addEventListener("click", () => {
        switchTab("chat");
      });
      state.selectedTaskId = null;
      renderTaskDetail(null);
    } else {
      // Filter / search hides everything but raw data exists — keep
      // it minimal, the user is in active filter mode.
      renderEmpty(taskList, `No tasks match this filter${search ? ` + search "${search}"` : ""}.`);
    }
    return;
  }

  if (!state.selectedTaskId || !tasks.some((t) => t.task_id === state.selectedTaskId)) {
    state.selectedTaskId = tasks[0].task_id;
  }

  const entries = buildTaskListEntries(tasks);
  // Cache signature so we can skip the rebuild when nothing material
  // has changed. Without this, the 6s refresh tick rebuilds the entire
  // task list every time and every hover / click target gets the
  // "flash" the user complained about. Compare a compact signature of
  // (id, status, sub_status, child_count) — anything else is metadata
  // that doesn't need a re-render.
  const sig = taskListSignature(entries);
  if (taskList._lastSig === sig && taskList.children.length > 0) {
    // Nothing visibly changed; skip the destructive rebuild. Selection
    // state is also unchanged because state.selectedTaskId is the
    // same.
  } else {
  taskList._lastSig = sig;
  // Preserve scroll position across the rebuild.
  const prevScroll = taskList.scrollTop;
  taskList.innerHTML = entries.map((entry) =>
    renderTaskListItemHtml({ ...entry, selectedTaskId: state.selectedTaskId })
  ).join("");
  // Restore scroll position so the user's place isn't reset on the
  // 6s refresh tick. Pin to bottom if they were already there.
  taskList.scrollTop = prevScroll;
  // Re-attach click handlers — only needed when we actually rebuilt.
  // (The skip branch keeps existing buttons + their listeners.)
  for (const btn of taskList.querySelectorAll("[data-task-id]")) {
    btn.addEventListener("click", () => {
      state.selectedTaskId = btn.dataset.taskId;
      renderTasks();
      void refreshTaskDetail();
    });
  }
  }
}

function renderTaskChildren(detail) {
  const task = detail?.task ?? {};
  const childIds = Array.isArray(task.child_task_ids) ? task.child_task_ids : [];
  taskChildCount.textContent = `${childIds.length}`;

  if (childIds.length === 0) {
    taskChildList.innerHTML = "";
    setTaskDetailPanelVisible("taskSubtasksPanel", false);
    return;
  }
  setTaskDetailPanelVisible("taskSubtasksPanel", true);

  // UCA-125 Phase 2c: v3 subtask-row — circle .st-num badge + title +
  // status pill + mono duration meta. Replaces the old two-line
  // "#N · title / executor · source_type" layout with a single scan-
  // friendly row.
  const childEntries = childIds.map((childId, index) => {
    const child = state.workspace.tasks.find((t) => t.task_id === childId) ?? { task_id: childId };
    const label = child.user_command ?? child.intent ?? child.task_id ?? "Subtask";
    const childIndex = Number.isInteger(child.child_index) ? child.child_index + 1 : index + 1;
    const status = child.status ?? "unknown";
    const pillClass = status === "success" ? "pill pill-ok"
      : status === "failed" ? "pill pill-err"
        : status === "queued" ? "pill pill-queue"
          : status === "running" || status === "cancelling" ? "pill pill-run"
            : "pill pill-neutral";
    const durationText = child.elapsed_ms
      ? child.elapsed_ms >= 1000
        ? `${(child.elapsed_ms / 1000).toFixed(1)}s`
        : `${child.elapsed_ms}ms`
      : "";
    return `
      <button class="subtask-row" data-child-task-id="${escapeHtml(childId)}" type="button">
        <span class="st-num">${childIndex}</span>
        <span class="st-title">${escapeHtml(label)}</span>
        <span class="${pillClass}">${escapeHtml(status)}</span>
        ${durationText ? `<span class="st-meta">${escapeHtml(durationText)}</span>` : ""}
      </button>
    `;
  }).join("");

  taskChildList.innerHTML = childEntries;
  for (const btn of taskChildList.querySelectorAll("[data-child-task-id]")) {
    btn.addEventListener("click", () => {
      state.selectedTaskId = btn.dataset.childTaskId;
      renderTasks();
      void refreshTaskDetail();
    });
  }
}

/* ── Artifact selection ── */
async function loadArtifactPreviewText(artifactPath) {
  if (!artifactPath) return { text: "Select an artifact to preview.", kind: "empty" };
  if (isImageArtifactPath(artifactPath)) {
    try {
      const dataUrl = await window.ucaShell.readFileAsDataUrl(artifactPath, imageMimeFor(artifactPath));
      return { text: "", kind: "image", dataUrl };
    } catch (error) {
      return { text: `Image preview failed: ${error?.message ?? error}`, kind: "error" };
    }
  }
  if (!isPreviewableArtifactPath(artifactPath)) {
    return { text: "This file type can't be previewed inline — use Open to view it externally.", kind: "external" };
  }
  try {
    const raw = await window.ucaShell.readTextFile(artifactPath, 4000);
    const content = normalisePreviewText(raw).slice(0, 3000);
    return { text: content || "(file is empty)", kind: "ok" };
  } catch (error) {
    return { text: `Preview failed: ${error?.message ?? error}`, kind: "error" };
  }
}

function renderArtifactReport(artifactPath, artifacts) {
  const report = document.querySelector("#taskArtifactReport");
  const icon = document.querySelector("#taskArtifactReportIcon");
  const name = document.querySelector("#taskArtifactReportName");
  const pathEl = document.querySelector("#taskArtifactReportPath");
  if (!report || !name || !pathEl || !icon) return;
  if (!artifactPath) {
    report.setAttribute("hidden", "");
    return;
  }
  report.removeAttribute("hidden");
  const label = formatArtifactLabel(artifactPath);
  const ext = artifactExtension(artifactPath);
  icon.className = `artifact-icon ${artifactIconClass(ext)}`;
  icon.textContent = artifactIconText(artifactPath);
  name.textContent = label;
  pathEl.textContent = artifactPath;
  // The visible button row uses the existing IDs, so wiring from the
  // previous placement still works.
  const show = !!artifactPath;
  openTaskArtifactButton.hidden = !show;
  copyTaskArtifactPathButton.hidden = !show;
  useTaskArtifactContextButton.hidden = !show;
}

async function selectTaskArtifact(artifactPath) {
  state.selectedTaskArtifactPath = artifactPath ?? null;
  renderArtifactReport(artifactPath, state.selectedTaskDetail?.artifacts ?? []);
  // Show a loading state immediately so the user knows their click
  // registered; swap to actual content when fs read returns.
  taskArtifactPreview.innerHTML = "";
  taskArtifactPreview.textContent = "正在加载预览…";
  taskArtifactPreview.classList.add("loading");
  taskArtifactPreview.classList.remove("external-only", "image");
  const result = await loadArtifactPreviewText(state.selectedTaskArtifactPath);
  if (state.selectedTaskArtifactPath !== artifactPath) return; // user moved on
  taskArtifactPreview.classList.remove("loading", "external-only", "image");
  if (result.kind === "image" && result.dataUrl) {
    taskArtifactPreview.classList.add("image");
    taskArtifactPreview.textContent = "";
    const img = document.createElement("img");
    img.src = result.dataUrl;
    img.alt = artifactPath;
    taskArtifactPreview.appendChild(img);
  } else {
    taskArtifactPreview.textContent = result.text;
    if (result.kind === "external") taskArtifactPreview.classList.add("external-only");
  }
  state.lastAutoPreviewedPath = artifactPath;
  renderTaskArtifacts(state.selectedTaskDetail);
}

function renderTaskArtifacts(detail) {
  const artifacts = detail?.artifacts ?? [];
  taskArtifactCount.textContent = `${artifacts.length}`;

  if (artifacts.length === 0) {
    state.selectedTaskArtifactPath = null;
    taskArtifactList.innerHTML = "";
    renderArtifactReport(null, []);
    setTaskDetailPanelVisible("taskArtifactsPanel", false);
    return;
  }
  setTaskDetailPanelVisible("taskArtifactsPanel", true);

  // Auto-select + auto-preview the primary artifact when the user lands
  // on this task for the first time. This is the "task report" flow —
  // a successful task with a generated file should show its content
  // without requiring a click. We delegate to selectTaskArtifact so the
  // preview pane gets the same loading state + header rendering as a
  // manual click would.
  const primaryPath = artifacts[0].path;
  const needsAutoSelect = !state.selectedTaskArtifactPath || !artifacts.some((a) => a.path === state.selectedTaskArtifactPath);
  if (needsAutoSelect && state.lastAutoPreviewedPath !== primaryPath) {
    // selectTaskArtifact will also re-enter renderTaskArtifacts once
    // the preview resolves — the re-entry falls through both guards
    // above (selectedTaskArtifactPath set, lastAutoPreviewedPath set)
    // so there is no loop.
    void selectTaskArtifact(primaryPath);
  } else if (needsAutoSelect) {
    state.selectedTaskArtifactPath = primaryPath;
  }
  // Always keep the report header in sync with whichever artifact is
  // currently selected (manual click sets selectedTaskArtifactPath
  // directly).
  renderArtifactReport(state.selectedTaskArtifactPath, artifacts);

  // When the task produced exactly one artifact the report card above
  // already shows it — rendering the same file as a list row below is
  // pure visual duplication. Hide the list in that case.
  if (artifacts.length < 2) {
    taskArtifactList.innerHTML = "";
    return;
  }

  // UCA-125 Phase 2d: artifact rows gain per-row Open/Reveal/Copy-path
  // buttons (v3 style) so each artifact is directly actionable without
  // having to select it first. The shared preview below still reflects
  // the currently focused artifact for quick inline inspection.
  taskArtifactList.innerHTML = renderTaskArtifactRowsHtml(artifacts, {
    selectedPath: state.selectedTaskArtifactPath,
    labelForPath: formatArtifactLabel
  });

  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-select]")) {
    btn.addEventListener("click", () => void selectTaskArtifact(btn.dataset.artifactPath));
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-open]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      // UCA-182 Phase 7: prefer the in-app preview panel. If the
      // format has no handler the panel returns false and we fall
      // through to a native "open with" call.
      const p = btn.dataset.artifactPath;
      if (window.livePreview?.openForFile?.({ filePath: p })) return;
      await window.ucaShell.openPath(p);
    });
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-reveal]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        if (typeof window.ucaShell.showItemInFolder === "function") {
          await window.ucaShell.showItemInFolder(btn.dataset.artifactPath);
        } else {
          await window.ucaShell.openPath(btn.dataset.artifactPath);
        }
      }
      catch { await window.ucaShell.openPath(btn.dataset.artifactPath); }
    });
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-copy]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await window.ucaShell.writeClipboardText(btn.dataset.artifactPath);
    });
  }

  // Visibility + actions are owned by renderArtifactReport() now —
  // called above once selection is stable.
}

/* ═══════════════════════════════════════════════
   FILES TAB — global artifact manager
   ═══════════════════════════════════════════════ */

const filesListEl = document.querySelector("#filesList");
const filesCountEl = document.querySelector("#filesCount");
const filesFilterInput = document.querySelector("#filesFilterInput");
const filesPreviewBody = document.querySelector("#filesPreviewBody");
const filesPreviewLabel = document.querySelector("#filesPreviewLabel");
const filesPreviewMeta = document.querySelector("#filesPreviewMeta");
const filesOpenBtn = document.querySelector("#filesOpenBtn");
const filesRevealBtn = document.querySelector("#filesRevealBtn");
const filesCopyPathBtn = document.querySelector("#filesCopyPathBtn");
const filesRefreshBtn = document.querySelector("#filesRefreshBtn");

let filesAllArtifacts = [];   // [{ taskId, taskCommand, path, label, createdAt }]
let filesSelectedPath = null;
let filesFilterText = "";

async function loadAllArtifacts() {
  const tasksList = state.workspace.tasks ?? [];
  const completed = tasksList.filter((t) => t.status === "success" || t.status === "partial_success");
  const collected = [];

  // Fetch task details (which include artifacts) in parallel — capped at 30 most recent
  const recent = completed.slice(0, 30);
  await Promise.all(recent.map(async (taskSummary) => {
    try {
      const detail = await fetchJson(`/task/${taskSummary.task_id}`);
      const artifacts = detail?.artifacts ?? [];
      for (const art of artifacts) {
        collected.push({
          taskId: taskSummary.task_id,
          taskCommand: taskSummary.user_command ?? "",
          path: art.path,
          label: formatArtifactLabel(art.path),
          name: basenameOf(art.path),
          createdAt: taskSummary.updated_at ?? taskSummary.created_at ?? null
        });
      }
    } catch { /* ignore single-task failure */ }
  }));

  collected.sort((a, b) => `${b.createdAt ?? ""}`.localeCompare(`${a.createdAt ?? ""}`));
  filesAllArtifacts = collected;
  renderFilesList();
}

function renderFilesList() {
  if (!filesListEl) return;
  const visible = filterFileArtifacts(filesAllArtifacts, filesFilterText);

  filesCountEl.textContent = `${visible.length}`;

  filesListEl.innerHTML = renderFilesListHtml({
    visibleArtifacts: visible,
    allArtifacts: filesAllArtifacts,
    selectedPath: filesSelectedPath
  });

  for (const btn of filesListEl.querySelectorAll("[data-file-path]")) {
    btn.addEventListener("click", () => void selectFileArtifact(btn.dataset.filePath));
    btn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void selectFileArtifact(btn.dataset.filePath);
      }
    });
  }
}

async function selectFileArtifact(filePath) {
  filesSelectedPath = filePath;
  renderFilesList();
  filesOpenBtn.hidden = false;
  filesRevealBtn.hidden = false;
  filesCopyPathBtn.hidden = false;
  filesPreviewLabel.textContent = `Preview · ${basenameOf(filePath)}`;
  filesPreviewMeta.textContent = filePath;

  if (isPreviewableArtifactPath(filePath)) {
    try {
      const raw = await window.ucaShell.readTextFile(filePath, 12_000);
      filesPreviewBody.textContent = raw || "(empty file)";
      filesPreviewBody.classList.remove("muted");
    } catch (error) {
      filesPreviewBody.textContent = `Cannot read: ${error.message}`;
      filesPreviewBody.classList.add("muted");
    }
  } else {
    filesPreviewBody.textContent = "Binary or unsupported preview — open externally.";
    filesPreviewBody.classList.add("muted");
  }
}

filesFilterInput?.addEventListener("input", (event) => {
  filesFilterText = event.target.value;
  renderFilesList();
});

filesRefreshBtn?.addEventListener("click", () => void loadAllArtifacts());

filesOpenBtn?.addEventListener("click", async () => {
  if (filesSelectedPath) await window.ucaShell.openPath(filesSelectedPath);
});

filesRevealBtn?.addEventListener("click", async () => {
  if (!filesSelectedPath) return;
  const dir = dirnameOf(filesSelectedPath);
  if (dir) await window.ucaShell.openPath(dir);
});

filesCopyPathBtn?.addEventListener("click", async () => {
  if (!filesSelectedPath) return;
  await window.ucaShell.writeClipboardText(filesSelectedPath);
  filesPreviewLabel.textContent = "Path copied to clipboard";
  setTimeout(() => {
    if (filesSelectedPath) filesPreviewLabel.textContent = `Preview · ${basenameOf(filesSelectedPath)}`;
  }, 1200);
});

// UCA-125 Phase 2b: show/hide helpers for the split detail panels.
// Each subtasks/artifacts/timeline section is its own .panel card now,
// so empty sections just stay hidden instead of rendering a stacked
// "No X yet." placeholder.
// Render the "Recent conversations" panel that fills the Tasks tab's
// right pane when no task is selected. Reuses the conversations cache
// (loadConversationsTab populates it); fetches lazily if empty so the
// list shows up on first visit without forcing a Conversations tab
// click. Click any row → loads that conversation into Chat tab.
async function renderTaskRecentConversations() {
  const listEl = document.querySelector("#taskRecentConversationsList");
  const countEl = document.querySelector("#taskRecentConversationsCount");
  if (!listEl) return;
  listEl.innerHTML = `<p class="muted" style="font-size:12px;">Loading…</p>`;
  let items = [];
  try {
    items = await ensureConversationsCache({ force: true, limit: 100 });
  } catch {
    listEl.innerHTML = `<p class="muted" style="font-size:12px;">Couldn't load conversations.</p>`;
    if (countEl) countEl.textContent = "0";
    return;
  }
  if (countEl) countEl.textContent = String(items.length);
  if (items.length === 0) {
    listEl.innerHTML = `<p class="muted" style="font-size:12px;">还没有任何对话。从 Chat tab 开始第一条吧。</p>`;
    return;
  }
  // Take top ~10. Each row has the same dual-button shape used in
  // Conversations / Projects so the user can preview (click main) or
  // jump-to-chat (click ↗ resume).
  const top = items.slice(0, 10);
  listEl.innerHTML = top.map((c) => `
    <div class="history-item-row">
      <button class="history-item history-item--main" data-recent-conversation-id="${escapeHtml(c.conversation_id)}" style="text-align:left;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <strong style="font-size:13px;">${escapeHtml(c.title || c.conversation_id.slice(0, 24))}</strong>
          <span class="muted" style="font-size:11px;">${c.message_count}m · ${c.task_count}t</span>
        </div>
        <p class="muted" style="margin-top:4px;font-size:11px;">${escapeHtml(formatDateTime(c.updated_at))}</p>
      </button>
      <button class="history-item-resume" type="button"
              data-recent-resume-id="${escapeHtml(c.conversation_id)}"
              title="在 Chat 标签继续此对话" aria-label="继续对话">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
        </svg>
      </button>
    </div>
  `).join("");
  for (const btn of listEl.querySelectorAll("[data-recent-conversation-id]")) {
    btn.addEventListener("click", () => {
      const convId = btn.dataset.recentConversationId;
      if (!convId) return;
      // Switch to the Conversations tab and select this conversation.
      // Used to be a no-op on the standalone Conversations tab (now
      // hidden) — the panel HTML is still in DOM so this still resolves.
      conversationsState.selectedId = convId;
      void loadConversationDetail(convId);
      switchTab("conversations");
    });
  }
  for (const btn of listEl.querySelectorAll("[data-recent-resume-id]")) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const convId = btn.dataset.recentResumeId;
      if (!convId) return;
      void loadConsoleConversationFromBackend(convId);
      showConsoleToast("已加载对话，可继续输入", { kind: "ok" });
    });
  }
}

function setTaskDetailPanelVisible(id, visible) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  if (visible) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

function renderTaskDetail(detail) {
  if (!detail) {
    selectedTaskEventController.close();
    state.selectedTaskDetail = null;
    // Hide the placeholder text — we now fill the empty pane with the
    // Recent Conversations panel below.
    taskDetailSummary.innerHTML = "";
    taskTimeline.innerHTML = "";
    setTaskDetailPanelVisible("taskSubtasksPanel", false);
    setTaskDetailPanelVisible("taskArtifactsPanel", false);
    setTaskDetailPanelVisible("taskTimelinePanel", false);
    setTaskDetailPanelVisible("taskRecentConversationsPanel", true);
    renderTaskArtifacts(null);
    renderTaskChildren(null);
    void renderTaskRecentConversations();
    retryTaskButton.disabled = true;
    cancelTaskButton.disabled = true;
    if (deleteTaskButton) deleteTaskButton.disabled = true;
    return;
  }
  // A task is selected — hide the recent-conversations panel so the
  // detail panels (summary / subtasks / artifacts / timeline) own the
  // pane.
  setTaskDetailPanelVisible("taskRecentConversationsPanel", false);

  state.selectedTaskDetail = detail;
  const task = detail.task ?? {};
  const { descriptor: providerDescriptor, downgraded } = extractTaskProviderInfo(detail);
  const failBlock = task.failure_category ? `
    <div style="padding:8px 10px;border-radius:8px;background:var(--err-soft);border:1px solid var(--err);margin-top:8px;">
      <strong style="font-size:12px;color:var(--err);">Failed</strong>
      <p class="muted" style="margin:4px 0 0;font-size:12px;">${escapeHtml(task.failure_user_message ?? task.failure_category)}</p>
    </div>
  ` : "";
  const parentLink = isCompositeChildTask(task) ? `
    <span>父任务：
      <button class="btn btn-ghost" data-parent-task-id="${escapeHtml(task.parent_task_id)}" style="padding:0 6px;font-size:11px;">← 返回</button>
    </span>
  ` : "";
  // Task answer block — surfaces the executor's final text. New tasks
  // persist this on task.result_summary (UCA-136). For legacy tasks
  // that pre-date that fix we fall back to scanning the event stream
  // for the last inline_result / success payload so users opening old
  // records still see what the agent actually produced.
  let answerText = task.result_summary ?? "";
  if (!answerText && Array.isArray(detail.events)) {
    for (let i = detail.events.length - 1; i >= 0; i--) {
      const ev = detail.events[i];
      if ((ev?.event_type === "inline_result" || ev?.event_type === "success")
          && typeof ev.payload?.text === "string" && ev.payload.text.trim()) {
        answerText = ev.payload.text.trim();
        break;
      }
    }
  }
  const resultSummaryBlock = answerText ? `
    <div class="task-answer">
      <div class="task-answer-label">Result<span class="zh">结果</span></div>
      <div class="task-answer-body">${escapeHtml(answerText)}</div>
    </div>
  ` : "";
  // UCA-122: v3 detail-hero + KV grid. Hero shows title + status pill +
  // task ID tag + subtitle meta. KV grid spreads the metadata that
  // previously cramped into a single line into 8 labeled cells.
  const statusPillClass = task.status === "success" ? "pill pill-ok"
    : task.status === "failed" ? "pill pill-err"
      : task.status === "queued" ? "pill pill-queue"
        : task.status === "running" || task.status === "cancelling" ? "pill pill-run"
          : "pill pill-neutral";
  const provider = providerDescriptor?.provider_name ?? providerDescriptor?.provider_id ?? "—";
  const model = providerDescriptor?.model ?? "—";
  const transport = providerDescriptor?.transport ?? "—";
  const source = task.context_packet?.source_type ?? task.source_app ?? "—";
  const duration = task.elapsed_ms ? `${(task.elapsed_ms / 1000).toFixed(1)}s` : "—";
  const tokensUsed = task.tokens_used ?? task.usage?.total_tokens ?? null;
  const canRetry = !!task.retryable;
  const canCancel = ["queued", "running", "cancelling"].includes(task.status);
  // UCA-125 Phase 2b: action buttons live INSIDE the hero now (v3 style)
  // so they're visually grouped with the title/status they act on. The
  // hidden legacy #retryTaskButton / #cancelTaskButton / #deleteTaskButton
  // in console.html still carry the wired click handlers; the hero buttons
  // just proxy-click them.
  const heroActions = `
    <div class="detail-hero-actions">
      <button type="button" class="btn btn-sm" data-task-act="retry" ${canRetry ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Retry
      </button>
      <button type="button" class="btn btn-sm ${canCancel ? "btn-stop" : "btn-ghost"}" data-task-act="cancel" ${canCancel ? "" : "disabled"} title="${canCancel ? "停止此任务" : "Cancel"}">${canCancel ? "停止" : "Cancel"}</button>
      <div style="flex:1"></div>
      <button type="button" class="btn btn-sm btn-danger" data-task-act="delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
        Delete
      </button>
    </div>
  `;
  taskDetailSummary.innerHTML = `
    <div class="detail-hero">
      <div class="btn-group" style="margin-bottom:8px;">
        <span class="${statusPillClass}">${escapeHtml(task.status ?? "unknown")}</span>
        <span class="tag">${escapeHtml(task.task_id)}</span>
        ${parentLink ? `<span class="tag">child of ${escapeHtml(task.parent_task_id)}</span>` : ""}
      </div>
      <h2>${escapeHtml(task.user_command ?? task.intent ?? task.task_id)}</h2>
      <div class="detail-hero-meta">
        <span>Started ${escapeHtml(formatDateTime(task.created_at))}</span>
        ${task.retry_count ? `<span>Retry ${escapeHtml(task.retry_count)}</span>` : ""}
        ${parentLink}
      </div>
      ${renderTaskKvGrid({ provider, model, executor: task.executor, source, retry: task.retry_count, cost: task.cost_usd, duration, transport }, { formatMoney })}
      ${tokensUsed ? `<div class="muted" style="font-size:11px;margin-top:10px;font-family:var(--font-mono);">tokens: ${escapeHtml(tokensUsed)}</div>` : ""}
      ${heroActions}
    </div>
    ${renderDowngradedWarning(downgraded)}
    ${failBlock}
    ${resultSummaryBlock}
  `;
  for (const btn of taskDetailSummary.querySelectorAll("[data-parent-task-id]")) {
    btn.addEventListener("click", () => {
      state.selectedTaskId = btn.dataset.parentTaskId;
      renderTasks();
      void refreshTaskDetail();
    });
  }
  // Hero action proxies → trigger the existing hidden buttons that carry
  // the real click handlers.
  for (const btn of taskDetailSummary.querySelectorAll("[data-task-act]")) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.taskAct === "retry" ? retryTaskButton
        : btn.dataset.taskAct === "cancel" ? cancelTaskButton
          : btn.dataset.taskAct === "delete" ? deleteTaskButton
            : null;
      if (target && !target.disabled) target.click();
    });
  }
  const events = detail.events ?? [];
  if (events.length > 0) {
    // Walk events in order so each entry can render its derived step
    // index ("第 3/N 步") even when the backend emits no step_index.
    // Total comes from the highest step_total payload we see, falling
    // back to the final step_started count once the run is over.
    let stepIndex = 0;
    let stepTotal = 0;
    const stepIndexByEvent = new Map();
    for (const ev of events) {
      const type = ev?.event_type ?? ev?.event ?? "";
      const payload = ev?.payload ?? ev?.data ?? {};
      const totalHint = Number(payload?.step_total ?? 0);
      if (Number.isFinite(totalHint) && totalHint > stepTotal) stepTotal = totalHint;
      if (type === "step_started") {
        stepIndex += 1;
        stepIndexByEvent.set(ev, stepIndex);
      } else if (type === "step_finished") {
        stepIndexByEvent.set(ev, stepIndex);
      }
    }
    if (!stepTotal && stepIndex > 0) stepTotal = stepIndex;
    taskTimeline.innerHTML = events.map((ev) => renderTimelineEntry(ev, {
      step: { index: stepIndexByEvent.get(ev) ?? 0, total: stepTotal }
    })).join("");
    setTaskDetailPanelVisible("taskTimelinePanel", true);
  } else {
    taskTimeline.innerHTML = "";
    setTaskDetailPanelVisible("taskTimelinePanel", false);
  }
  renderTaskArtifacts(detail);
  renderTaskChildren(detail);
  retryTaskButton.disabled = !canRetry;
  cancelTaskButton.disabled = !canCancel;
  if (deleteTaskButton) deleteTaskButton.disabled = false;
}

async function refreshTaskDetail() {
  if (!state.selectedTaskId) {
    selectedTaskEventController.close();
    renderTaskDetail(null);
    return;
  }
  const v = ++state.detailVersion;
  taskDetailSummary.innerHTML = `
    <div aria-label="Loading task details" role="status">
      <div class="skeleton skeleton-line wide"></div>
      <div class="skeleton skeleton-line mid"></div>
      <div class="skeleton skeleton-line narrow"></div>
    </div>
  `;
  try {
    const detail = await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}`);
    if (v !== state.detailVersion) return;
    selectedTaskEventController.ensure(state.selectedTaskId);
    renderTaskDetail(detail);
  } catch (error) {
    if (v !== state.detailVersion) return;
    state.selectedTaskDetail = null;
    taskDetailSummary.innerHTML = `<p class="muted" style="font-size:12px;">Failed: ${escapeHtml(error.message)}</p>`;
    taskTimeline.innerHTML = "";
    renderTaskArtifacts(null);
  }
}

function renderApprovals() {
  const approvals = (state.workspace.approvals ?? []).filter((approval) => approval.status === "pending");
  approvalCount.textContent = `${approvals.length}`;
  // Rail badge — pending approvals are urgent (the agent is blocked
  // waiting for the user). Surface a count badge on the Schedules
  // rail item so the user notices even from another tab.
  const railBadge = document.getElementById("railBadgeApprovals");
  if (railBadge) {
    if (approvals.length > 0) {
      railBadge.textContent = String(approvals.length);
      railBadge.hidden = false;
    } else {
      railBadge.hidden = true;
    }
  }
  if (approvals.length === 0) {
    renderEmpty(approvalList, "No pending approvals.");
    return;
  }
  // Skip-render guard: approval items carry editable input fields
  // (override forms). If the user is typing in one, don't wipe their
  // input on the 6s refresh tick.
  if (shouldSkipRender(approvalList)) return;

  approvalList.innerHTML = approvals.map((a) => renderApprovalItem(a)).join("");

  // Plain Approve (no overrides).
  for (const btn of approvalList.querySelectorAll("[data-approve-id]")) {
    btn.addEventListener("click", async () => {
      await approveApproval(btn.dataset.approveId);
      await refreshWorkspace();
    });
  }
  for (const btn of approvalList.querySelectorAll("[data-reject-id]")) {
    btn.addEventListener("click", async () => {
      await rejectApproval(btn.dataset.rejectId, { reason: "rejected_in_console" });
      await refreshWorkspace();
    });
  }
  // UCA-103 Save & Approve: collect edited field values and send as overrides.
  for (const btn of approvalList.querySelectorAll("[data-save-approve-id]")) {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveApproveId;
      const container = approvalList.querySelector(`[data-approval-fields="${id}"]`);
      const overrides = {};
      if (container) {
        for (const input of container.querySelectorAll("[data-field-key]")) {
          const key = input.dataset.fieldKey;
          let value = input.value;
          if (input.dataset.fieldKind === "list") {
            value = value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
          }
          overrides[key] = value;
        }
      }
      await approveApproval(id, { overrides });
      await refreshWorkspace();
    });
  }
}

// UCA-103: Render a single approval. When the approval's proposed_params
// look like an editable payload (e.g. send_email with to/subject/body, or a
// connector_workflow_run with an .input object), we expose inline form
// fields pre-filled with current values plus a Save & Approve button.
// Existing Approve / Reject buttons remain as the quick-path.
function renderApprovalItem(a) {
  const editableFields = deriveEditableApprovalFields(a);
  const statusChip = a.status === "approved" ? "ready" : a.status === "rejected" ? "danger" : "warning";
  const disabled = a.status !== "pending";
  const fieldsHtml = editableFields.length > 0
    ? `
      <div class="approval-fields" data-approval-fields="${escapeHtml(a.approval_id)}" style="margin-top:10px;display:grid;gap:8px;">
        ${editableFields.map((f) => `
          <label style="display:block;font-size:11px;color:var(--muted);font-weight:600;">
            ${escapeHtml(f.label)}
            ${f.kind === "textarea"
              ? `<textarea data-field-key="${escapeHtml(f.key)}" rows="4" style="margin-top:4px;font-size:12px;">${escapeHtml(f.value)}</textarea>`
              : `<input data-field-key="${escapeHtml(f.key)}" data-field-kind="${escapeHtml(f.kind)}" type="text" value="${escapeHtml(f.value)}" style="margin-top:4px;font-size:12px;" />`}
          </label>
        `).join("")}
      </div>
    `
    : "";
  const saveButton = editableFields.length > 0 && !disabled
    ? `<button class="btn btn-primary" data-save-approve-id="${escapeHtml(a.approval_id)}">Save &amp; Approve</button>`
    : "";
  return `
    <div class="approval-item">
      <div class="row">
        <div>
          <h4>${escapeHtml(a.proposed_target ?? a.proposed_action ?? "Pending action")}</h4>
          <p class="muted">${escapeHtml(a.source_type ?? "unknown")} · ${escapeHtml(a.status)}</p>
        </div>
        <span class="chip ${statusChip}">${escapeHtml(a.status)}</span>
      </div>
      <p class="muted" style="margin-top:6px;">${escapeHtml(a.preview_text ?? "No preview")}</p>
      ${fieldsHtml}
      <div class="row wrap" style="margin-top:10px;">
        <span class="muted" style="font-size:11px;">Expires: ${escapeHtml(formatDateTime(a.expires_at))}</span>
        <div class="toolbar">
          ${saveButton}
          <button class="btn" data-approve-id="${escapeHtml(a.approval_id)}" ${disabled ? "disabled" : ""}>Approve</button>
          <button class="btn btn-sm btn-danger" data-reject-id="${escapeHtml(a.approval_id)}" ${disabled ? "disabled" : ""}>Reject</button>
        </div>
      </div>
    </div>
  `;
}

// Inspect proposed_params and decide whether there are fields the user
// should be able to edit before approving. Returns an array of
// {key, label, kind, value} (kind ∈ "text"|"textarea"|"list").
function deriveEditableApprovalFields(approval) {
  if (!approval || approval.status !== "pending") return [];
  const params = approval.proposed_params ?? {};
  // connector_workflow_run packages its real input under params.input
  const payload = (params.input && typeof params.input === "object") ? params.input : params;

  const fields = [];
  const seen = new Set();
  const addField = (key, label, kind, raw) => {
    if (seen.has(key)) return;
    if (raw === undefined || raw === null) return;
    let value = raw;
    if (Array.isArray(raw)) {
      if (kind !== "list") return;
      value = raw.join(", ");
    } else if (typeof raw === "object") {
      return;
    } else {
      value = String(raw);
    }
    fields.push({ key, label, kind, value });
    seen.add(key);
  };

  // Email-like payload
  addField("to", "收件人 (逗号分隔)", "list", payload.to);
  addField("cc", "CC", "list", payload.cc);
  addField("bcc", "BCC", "list", payload.bcc);
  addField("subject", "主题", "text", payload.subject);
  addField("body", "正文", "textarea", payload.body ?? payload.text);

  // Calendar-like payload
  addField("title", "事件标题", "text", payload.title);
  addField("startTime", "开始时间 (ISO)", "text", payload.startTime ?? payload.start_time);
  addField("endTime", "结束时间 (ISO)", "text", payload.endTime ?? payload.end_time);
  addField("location", "地点", "text", payload.location);
  addField("description", "描述", "textarea", payload.description);

  return fields;
}

// UCA-046: schedule view mode — "list" (default) / "week" / "month"
let scheduleViewMode = "list";
const scheduleCalendar = document.querySelector("#scheduleCalendar");

// UCA-125 Phase 7b: search + per-group collapse state (persisted).
let scheduleSearch = "";
const scheduleGroupCollapsed = (() => {
  try {
    const raw = localStorage.getItem("lingxy.schedules.collapsed");
    if (raw) return { active: false, paused: false, completed: true, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { active: false, paused: false, completed: true };
})();
function persistScheduleGroupCollapsed() {
  try { localStorage.setItem("lingxy.schedules.collapsed", JSON.stringify(scheduleGroupCollapsed)); } catch { /* ignore */ }
}

for (const btn of document.querySelectorAll("[data-schedule-view]")) {
  btn.addEventListener("click", () => {
    scheduleViewMode = btn.dataset.scheduleView;
    renderSchedules();
  });
}
if (scheduleSearchInput) {
  scheduleSearchInput.addEventListener("input", () => {
    scheduleSearch = scheduleSearchInput.value.trim().toLowerCase();
    renderSchedules();
  });
}

function renderScheduleCalendarGrid(schedules, mode) {
  const now = new Date();
  const cells = [];

  if (mode === "week") {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    for (let d = 0; d < 7; d++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + d);
      cells.push(day);
    }
  } else {
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
    for (let d = 1; d <= endOfMonth.getDate(); d++) {
      cells.push(new Date(year, month, d));
    }
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const header = mode === "week"
    ? cells.map((d) => `<div class="cal-header">${dayNames[d.getDay()]} ${d.getDate()}</div>`).join("")
    : dayNames.map((n) => `<div class="cal-header">${n}</div>`).join("");

  const firstDay = cells[0]?.getDay() ?? 0;
  const padCells = mode === "month" ? Array.from({ length: firstDay }, () => '<div class="cal-cell empty"></div>').join("") : "";

  const gridCells = cells.map((day) => {
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
    const daySchedules = schedules.filter((s) => {
      if (!s.next_run_at) return false;
      const runAt = new Date(s.next_run_at);
      return runAt >= dayStart && runAt <= dayEnd;
    });
    const isToday = day.toDateString() === now.toDateString();
    const entries = daySchedules.slice(0, 3).map((s) => {
      const color = s.color || s.metadata?.color || "var(--accent)";
      return `<div class="cal-entry" data-schedule-ref="${escapeHtml(s.schedule_id)}" style="border-left:3px solid ${escapeHtml(color)};padding:2px 4px;font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2);" title="${escapeHtml(s.name)} — click to view">${escapeHtml(s.name)}</div>`;
    }).join("");
    const overflow = daySchedules.length > 3 ? `<div style="font-size:9px;color:var(--muted);">+${daySchedules.length - 3} more</div>` : "";
    return `<div class="cal-cell${isToday ? " today" : ""}" style="min-height:${mode === "week" ? "80" : "60"}px;padding:4px;border:1px solid var(--line);border-radius:6px;${isToday ? "background:var(--accent-soft);" : ""}"><div style="font-size:10px;font-weight:500;color:${isToday ? "var(--accent)" : "var(--muted)"};">${day.getDate()}</div>${entries}${overflow}</div>`;
  }).join("");

  // UCA-125: Week shows date range, Month shows year-month label.
  const calHeaderLabel = mode === "week"
    ? `${cells[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${cells[cells.length - 1].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : now.toLocaleDateString(undefined, { year: "numeric", month: "long" });

  scheduleCalendar.style.display = "block";
  scheduleCalendar.innerHTML = `
    <div class="cal-title" style="font-size:12px;font-weight:600;color:var(--ink-2);margin:0 0 8px;">${escapeHtml(calHeaderLabel)}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:11px;">
      ${header}
      ${padCells}
      ${gridCells}
    </div>
  `;

  // UCA-125 Phase 7b: clicking a calendar entry switches to list mode and
  // scrolls the matching sched-row into view with a highlight flash.
  for (const node of scheduleCalendar.querySelectorAll("[data-schedule-ref]")) {
    node.addEventListener("click", (ev) => {
      ev.stopPropagation();
      focusScheduleInList(node.dataset.scheduleRef);
    });
  }
}

function focusScheduleInList(scheduleId) {
  if (!scheduleId) return;
  // Switch to list view so the row is visible, then scroll + highlight.
  if (scheduleViewMode !== "list") {
    scheduleViewMode = "list";
    renderSchedules();
  }
  // Expand all groups so the match is reachable.
  Object.keys(scheduleGroupCollapsed).forEach((k) => { scheduleGroupCollapsed[k] = false; });
  persistScheduleGroupCollapsed();
  renderSchedules();
  requestAnimationFrame(() => {
    const row = scheduleList.querySelector(`[data-schedule-row="${CSS.escape(scheduleId)}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("is-highlighted");
    setTimeout(() => row.classList.remove("is-highlighted"), 1500);
  });
}

// UCA-125 Phase 7b helpers
function isOneShotScheduleRow(s) {
  return s?.trigger_type === "at" || s?.metadata?.one_shot === true;
}

function scheduleRunAtIsPast(s) {
  const ts = Date.parse(s?.trigger_config?.run_at ?? s?.trigger_config?.at ?? "");
  return Number.isFinite(ts) && ts <= Date.now();
}

function isTerminalOneShotScheduleRow(s) {
  return isOneShotScheduleRow(s)
    && !s.next_run_at
    && (Boolean(s.last_run_at) || Number(s.run_count ?? 0) > 0 || !s.enabled || scheduleRunAtIsPast(s));
}

function terminalOneShotLabel(s) {
  if (!isTerminalOneShotScheduleRow(s)) return null;
  return s.last_run_at || Number(s.run_count ?? 0) > 0 ? "completed" : "expired";
}

function scheduleBucket(s) {
  if (s.completed_at || isTerminalOneShotScheduleRow(s)) return "completed";
  if (!s.enabled) return "paused";
  return "active";
}
function scheduleMatchesSearch(s, q) {
  if (!q) return true;
  const hay = [
    s.name,
    s.description,
    s.schedule_id,
    s.trigger_type,
    s.category,
    s.metadata?.category,
    s.last_run_status,
    s.action_target,
    s.action_params?.userCommand,
    s.action_params?.contextText,
    scheduleRecipients(s).join(" ")
  ]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

const SCHEDULE_EMAIL_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function uniqueScheduleEmails(values) {
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const matches = String(value ?? "").match(SCHEDULE_EMAIL_REGEX) ?? [];
    for (const email of matches) {
      const normalized = email.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        emails.push(email);
      }
    }
  }
  return emails;
}

function recipientSegments(text = "") {
  const value = String(text ?? "");
  if (!value) return [];
  const segments = [];
  const markerPattern = /(?:收件人|发送到|发给|寄给|email\s+to|send\s+to|\bto\b)\s*[:：]?\s*/gi;
  for (const match of value.matchAll(markerPattern)) {
    const rest = value.slice(match.index + match[0].length);
    const stop = rest.search(/(?:主题|subject|正文|body|内容|，邮件|。|\n)/i);
    segments.push(stop >= 0 ? rest.slice(0, stop) : rest);
  }
  return segments;
}

function scheduleRecipients(schedule = {}) {
  const params = schedule.action_params ?? {};
  const input = params.input ?? {};
  const explicit = [
    params.to,
    params.cc,
    params.bcc,
    params.recipient,
    params.recipients,
    input.to,
    input.cc,
    input.bcc,
    input.recipient,
    input.recipients
  ];
  const explicitEmails = uniqueScheduleEmails(explicit.flatMap((value) => Array.isArray(value) ? value : [value]));
  if (explicitEmails.length) return explicitEmails;

  const textSources = [
    schedule.description,
    params.userCommand,
    params.contextText,
    params.command,
    schedule.action_target
  ];
  const segmentEmails = uniqueScheduleEmails(textSources.flatMap(recipientSegments));
  if (segmentEmails.length) return segmentEmails;

  return uniqueScheduleEmails([schedule.description]);
}

function scheduleActionPreview(schedule = {}) {
  const params = schedule.action_params ?? {};
  const text = params.userCommand
    ?? params.command
    ?? params.contextText
    ?? schedule.description
    ?? schedule.action_target
    ?? "";
  return String(text).replace(/\s+/g, " ").trim();
}

function clipSchedulePreview(text, max = 170) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function renderScheduleActionSummary(s) {
  const recipients = scheduleRecipients(s);
  const preview = scheduleActionPreview(s);
  const hasSummary = recipients.length || preview;
  if (!hasSummary) return "";
  const recipientHtml = recipients.length
    ? `<div class="sched-action-summary"><span class="sched-action-label">收件人</span>${recipients.map((email) => `<span class="tag">${escapeHtml(email)}</span>`).join("")}</div>`
    : "";
  const previewHtml = preview
    ? `<div class="sched-action-summary"><span class="sched-action-label">执行</span><span class="sched-action-text" title="${escapeHtml(preview)}">${escapeHtml(clipSchedulePreview(preview))}</span></div>`
    : "";
  return `${recipientHtml}${previewHtml}`;
}
// "Last:" meta — show time and colored status. When the last run
// failed AND we know which task it produced, wrap the status in a
// clickable button so the user can jump straight to the task detail
// and see the failure_user_message / timeline events.
function formatScheduleLastRun(s) {
  if (!s.last_run_at) return "<span class=\"muted\">Last: never</span>";
  const timeText = escapeHtml(formatDateTime(s.last_run_at));
  const status = s.last_run_status;
  if (!status) return `<span>Last: ${timeText}</span>`;
  const cls = status === "success" ? "ok" : (status === "failed" ? "err" : "muted");
  const statusLabel = escapeHtml(status);
  if (status === "failed" && s.last_run_task_id) {
    return `<span>Last: ${timeText} · <button type="button" class="sched-last-link sched-last-${cls}" data-sched-task-jump="${escapeHtml(s.last_run_task_id)}">${statusLabel}</button></span>`;
  }
  return `<span>Last: ${timeText} · <span class="sched-last-${cls}">${statusLabel}</span></span>`;
}

function renderScheduleRow(s) {
  const color = s.color || s.metadata?.color || "";
  const categoryLabel = s.category || s.metadata?.category || "";
  const enabledChecked = s.enabled ? " checked" : "";
  const bucket = scheduleBucket(s);
  const stateClass = bucket === "completed" ? " is-completed" : (bucket === "paused" ? " is-paused" : "");
  const runLabel = bucket === "completed" ? "Re-run" : "Run now";
  const terminalLabel = terminalOneShotLabel(s);
  const statePill = bucket === "completed"
    ? `<span class="pill pill-neutral">${escapeHtml(terminalLabel ?? "completed")}</span>`
    : (bucket === "paused" ? `<span class="pill pill-neutral">paused</span>` : "");
  return `
    <div class="sched-row${stateClass}" data-schedule-row="${escapeHtml(s.schedule_id)}" style="${color ? `border-left:3px solid ${escapeHtml(color)};` : ""}">
      <label class="toggle" title="${s.enabled ? "Disable" : "Enable"}">
        <input type="checkbox"${enabledChecked} data-toggle-schedule-id="${escapeHtml(s.schedule_id)}" data-enabled="${s.enabled ? "false" : "true"}"/>
        <span class="toggle-track"></span>
      </label>
      <div style="flex:1;min-width:0;">
        <div class="sched-title">${escapeHtml(s.name ?? s.schedule_id)}</div>
        <div class="sched-meta">
          ${categoryLabel ? `<span class="tag">${escapeHtml(categoryLabel)}</span>` : ""}
          <span class="tag">${escapeHtml(s.trigger_type ?? "manual")}</span>
          <span>Next: ${escapeHtml(formatDateTime(s.next_run_at))}</span>
          ${formatScheduleLastRun(s)}
          ${statePill}
        </div>
        ${renderScheduleActionSummary(s)}
      </div>
      <div class="sched-actions btn-group">
        <button class="btn btn-sm btn-ghost" data-edit-schedule-id="${escapeHtml(s.schedule_id)}" title="重命名">编辑</button>
        <button class="btn btn-sm" data-run-schedule-id="${escapeHtml(s.schedule_id)}">${runLabel}</button>
        <button class="btn btn-sm btn-danger" data-delete-schedule-id="${escapeHtml(s.schedule_id)}">Delete</button>
      </div>
    </div>
  `;
}

// In-place schedule edit — supports renaming AND rewriting the
// trigger time. Pops a small popover anchored to the row with two
// inputs (name + when). Save sends both fields; backend honours
// whichever changed. Empty "when" field skips the trigger update so
// the user can rename without re-parsing the time.
function handleScheduleRowEdit(scheduleId, anchorBtn) {
  if (!scheduleId) return;
  const currentSchedule = (state.workspace.schedules ?? []).find((item) => item.schedule_id === scheduleId) ?? null;
  const row = anchorBtn?.closest?.(".sched-row");
  if (!row) return;
  const titleEl = row.querySelector(".sched-title");
  const metaEl = row.querySelector(".sched-meta");
  if (!titleEl) return;
  // Capture current values from the rendered row.
  const currentName = (titleEl.textContent || "").trim();
  const currentCommand = (currentSchedule?.action_params?.userCommand
    ?? currentSchedule?.action_params?.command
    ?? currentSchedule?.description
    ?? "").trim();
  // The "Next: …" text is the human-friendly form; we don't fill the
  // input with it (date strings aren't natural-language enough). Leave
  // the trigger input blank and use placeholder for guidance.
  const originalTitleHtml = titleEl.innerHTML;
  const originalMetaHtml = metaEl?.innerHTML ?? "";
  titleEl.innerHTML = `
    <div class="sched-row-edit">
      <input type="text" class="sched-row-edit-input" maxlength="120" value="${escapeHtml(currentName)}" placeholder="计划名称"/>
    </div>
  `;
  // Inject a second row under .sched-meta for the trigger picker so
  // the layout stays compact even while editing. The picker carries
  // its own tabs (自然语言 / 每天 / 每周 / 一次) — empty / unfilled
  // fields are interpreted as "no trigger change".
  if (metaEl) {
    metaEl.innerHTML = `
      <div class="sched-row-edit-trigger">
        ${currentSchedule?.action_type === "task" ? `
          <textarea class="sched-row-edit-command" rows="3" placeholder="执行内容">${escapeHtml(currentCommand)}</textarea>
        ` : ""}
        <div class="sched-row-edit-trigger-picker">${buildSchedulePickerHtml({ prefix: `schedEdit_${scheduleId}` })}</div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn btn-sm btn-primary sched-row-edit-save">保存</button>
          <button type="button" class="btn btn-sm btn-ghost sched-row-edit-cancel">取消</button>
        </div>
        <div class="sched-row-edit-hint muted" style="font-size:11px;">触发时间留空保持不变；执行内容会同步到真正运行的任务 payload。</div>
      </div>
    `;
    wireSchedulePicker(metaEl.querySelector("[data-sched-picker]"));
  }
  const nameInput = titleEl.querySelector(".sched-row-edit-input");
  const commandInput = metaEl?.querySelector(".sched-row-edit-command");
  const pickerRoot = metaEl?.querySelector("[data-sched-picker]");
  const saveBtn = metaEl?.querySelector(".sched-row-edit-save");
  const cancelBtn = metaEl?.querySelector(".sched-row-edit-cancel");
  nameInput?.focus();
  nameInput?.setSelectionRange(0, nameInput.value.length);
  const restore = () => {
    titleEl.innerHTML = originalTitleHtml;
    if (metaEl) metaEl.innerHTML = originalMetaHtml;
  };
  cancelBtn?.addEventListener("click", restore);
  const onKey = (ev) => {
    if (ev.key === "Escape") restore();
    // Don't auto-submit on Enter from the picker — Enter inside time/
    // datetime inputs has native semantics. Only the name input
    // submits on Enter.
  };
  nameInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") restore();
    if (ev.key === "Enter") { ev.preventDefault(); saveBtn?.click(); }
  });
  saveBtn?.addEventListener("click", async () => {
    const newName = nameInput?.value?.trim() ?? "";
    const newCommand = commandInput?.value?.trim() ?? "";
    const pickerTrigger = readSchedulePicker(pickerRoot);
    if (!newName) { showConsoleToast("名称不能为空", { kind: "err" }); return; }
    if (commandInput && !newCommand) { showConsoleToast("执行内容不能为空", { kind: "err" }); return; }
    const patch = {};
    if (newName !== currentName) patch.name = newName;
    if (commandInput && newCommand !== currentCommand) patch.userCommand = newCommand;
    if (pickerTrigger) patch.trigger = pickerTrigger;
    if (Object.keys(patch).length === 0) {
      // Nothing actually changed; just close the editor.
      restore();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    try {
      await updateSchedule(scheduleId, patch);
      const labels = [];
      if (patch.name) labels.push("名称");
      if (patch.userCommand) labels.push("执行内容");
      if (patch.trigger) labels.push("触发时间");
      showConsoleToast(`已更新${labels.join(" + ")}`, { kind: "ok" });
      // Tear down the inline edit BEFORE refreshWorkspace runs.
      // Otherwise renderSchedules' skip-guard sees .sched-row-edit
      // still in DOM and bails out — leaving the row stuck in
      // "保存中…" forever. restore() puts the old row HTML back; the
      // very next render replaces it with the fresh saved data.
      restore();
      await refreshWorkspace();
    } catch (err) {
      showConsoleToast(`保存失败：${err?.message ?? err}`, { kind: "err" });
      restore();
    }
  });
}

// Generic guard for the "wholesale innerHTML rebuild" pattern: skip
// the render if (a) an inline edit popover is open inside the
// container, OR (b) the user is currently typing into an input
// inside it. Either way, the next refreshWorkspace tick will catch
// up after they finish.
function shouldSkipRender(container, editSelector = "") {
  if (!container) return false;
  if (editSelector && container.querySelector(editSelector)) return true;
  const active = document.activeElement;
  if (active && container.contains(active)) {
    const tag = (active.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select"
        || active.getAttribute?.("contenteditable") === "true") {
      return true;
    }
  }
  return false;
}

function renderSchedules() {
  // Skip-render guard: if the user is in the middle of editing a row
  // (rename / change trigger), the 6s refreshWorkspace tick would
  // wipe the inline form mid-edit and the user loses their text.
  // The next tick will catch up after they save / cancel.
  if (shouldSkipRender(scheduleList, ".sched-row-edit")) return;
  const schedules = state.workspace.schedules ?? [];
  scheduleCount.textContent = `${schedules.length}`;
  if (schedules.length === 0) {
    // First-run friendly empty state — give the user an inline
    // "Create one" button instead of just a muted line. Reaches into
    // the same #scheduleNewBtn that opens the create form so the
    // wiring stays single-source.
    scheduleList.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:32px 20px;">
        <p class="muted" style="margin:0 0 14px;font-size:13px;">还没有定时任务。把"每天 9 点提醒我喝水"或"每周一发周报"写进来 — AI 到点自动跑。</p>
        <button type="button" class="btn btn-sm btn-primary" id="scheduleEmptyCreateBtn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          创建第一个定时
        </button>
      </div>
    `;
    scheduleList.querySelector("#scheduleEmptyCreateBtn")?.addEventListener("click", () => {
      document.querySelector("#scheduleNewBtn")?.click();
    });
    if (scheduleCalendar) scheduleCalendar.style.display = "none";
    return;
  }

  // Highlight the active view-mode button. .active is kept for
  // legacy CSS; aria-pressed drives the new .view-toggle styling.
  for (const btn of document.querySelectorAll("[data-schedule-view]")) {
    const on = btn.dataset.scheduleView === scheduleViewMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  if (scheduleViewMode === "week" || scheduleViewMode === "month") {
    renderScheduleCalendarGrid(schedules, scheduleViewMode);
  } else {
    if (scheduleCalendar) scheduleCalendar.style.display = "none";
  }

  // Partition into active / paused / completed, filter by search.
  const filtered = schedules.filter((s) => scheduleMatchesSearch(s, scheduleSearch));
  const groups = { active: [], paused: [], completed: [] };
  for (const s of filtered) groups[scheduleBucket(s)].push(s);

  const groupSpec = [
    { key: "active",    label: "Active",    zh: "启用中" },
    { key: "paused",    label: "Paused",    zh: "已暂停" },
    { key: "completed", label: "Completed", zh: "已完成" }
  ];

  const showingEmpty = filtered.length === 0;
  if (showingEmpty) {
    scheduleList.innerHTML = `<div class="empty-state">No schedules match "${escapeHtml(scheduleSearch)}".</div>`;
  } else {
    scheduleList.innerHTML = groupSpec
      .filter((g) => groups[g.key].length > 0)
      .map((g) => {
        const collapsed = scheduleGroupCollapsed[g.key] === true;
        const rows = groups[g.key].map(renderScheduleRow).join("");
        return `
          <div class="sched-group" data-sched-group="${g.key}" data-collapsed="${collapsed ? "true" : "false"}">
            <div class="sched-group-head" data-sched-group-toggle="${g.key}" role="button" tabindex="0" aria-expanded="${collapsed ? "false" : "true"}">
              <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              <span>${g.label}<span class="zh">${g.zh}</span></span>
              <span class="count">· ${groups[g.key].length}</span>
            </div>
            <div class="sched-group-body">${rows}</div>
          </div>
        `;
      }).join("");
  }

  for (const head of scheduleList.querySelectorAll("[data-sched-group-toggle]")) {
    const toggle = () => {
      const key = head.dataset.schedGroupToggle;
      scheduleGroupCollapsed[key] = !scheduleGroupCollapsed[key];
      persistScheduleGroupCollapsed();
      const group = head.closest(".sched-group");
      if (group) {
        const collapsed = scheduleGroupCollapsed[key] === true;
        group.dataset.collapsed = collapsed ? "true" : "false";
        head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });
  }

  for (const btn of scheduleList.querySelectorAll("[data-run-schedule-id]")) {
    btn.addEventListener("click", async () => {
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Running...";
      try {
        const result = await runScheduleNow(btn.dataset.runScheduleId, { source: "desktop_console", bypassDedupe: true });
        watchScheduleRunTask(result?.task ?? null);
        if (result?.status === "pending_approval") {
          try {
            window.ucaShell?.showPopupCard?.({
              kind: "approval",
              approvalId: result?.approval?.approval_id ?? result?.approval?.approvalId ?? null,
              taskId: result?.task?.task_id ?? null,
              title: "定时任务等待审批",
              lines: [result?.approval?.preview_text ?? "请先审批后再执行。"],
              autoHideMs: 9000
            });
          } catch { /* optional */ }
        }
        await refreshWorkspace();
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  }

  for (const input of scheduleList.querySelectorAll("[data-toggle-schedule-id]")) {
    input.addEventListener("click", async () => {
      await updateSchedule(input.dataset.toggleScheduleId, { enabled: input.dataset.enabled === "true" });
      await refreshWorkspace();
    });
  }

  for (const btn of scheduleList.querySelectorAll("[data-delete-schedule-id]")) {
    btn.addEventListener("click", async () => {
      await deleteSchedule(btn.dataset.deleteScheduleId);
      await refreshWorkspace();
    });
  }
  for (const btn of scheduleList.querySelectorAll("[data-edit-schedule-id]")) {
    btn.addEventListener("click", () => {
      handleScheduleRowEdit(btn.dataset.editScheduleId, btn);
    });
  }

  // Clicking the colored "failed" status on a sched-row jumps to the
  // corresponding task detail so the user can read the actual failure
  // message + timeline without hunting through Tasks.
  for (const btn of scheduleList.querySelectorAll("[data-sched-task-jump]")) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const taskId = btn.dataset.schedTaskJump;
      if (!taskId) return;
      state.selectedTaskId = taskId;
      switchTab("tasks");
      renderTasks();
      void refreshTaskDetail();
    });
  }
}

async function loadTemplatePreview(templateId) {
  if (!templateId) { templatePreview.textContent = "Select a template."; return; }
  try {
    const [tp, ep] = await Promise.all([
      fetchJson(`/templates/${encodeURIComponent(templateId)}`),
      fetchJson(`/templates/${encodeURIComponent(templateId)}/export`)
    ]);
    const t = tp.template ?? null;
    templatePreview.textContent = ep.raw ?? "No export content.";
    templateImportInput.value = ep.raw ?? "";
    templateNameInput.value = t?.name ?? "";
    templatePromptInput.value = t?.steps?.find((s) => s.kind === "executor")?.inputs?.prompt ?? "";
    deleteTemplateButton.disabled = t?.template_origin !== "user";
  } catch (error) {
    templatePreview.textContent = `Failed: ${error.message}`;
  }
}

async function selectTemplate(templateId) {
  state.selectedTemplateId = templateId;
  renderTemplates();
  await loadTemplatePreview(templateId);
}

function renderTemplates() {
  const templates = state.workspace.templates ?? [];
  templateCount.textContent = `${templates.length}`;
  if (templates.length === 0) {
    renderEmpty(templateList, "No templates.");
    state.selectedTemplateId = null;
    templatePreview.textContent = "Select a template.";
    deleteTemplateButton.disabled = true;
    return;
  }

  if (!state.selectedTemplateId || !templates.some((t) => t.id === state.selectedTemplateId)) {
    state.selectedTemplateId = templates[0].id;
  }

  templateList.innerHTML = templates.map((t) => `
    <button class="template-item ${t.id === state.selectedTemplateId ? "selected" : ""}" data-template-id="${escapeHtml(t.id)}" style="text-align:left;">
      <div class="row">
        <div>
          <h4>${escapeHtml(t.name)}</h4>
          <p class="muted">${escapeHtml(t.id)}</p>
        </div>
        <span class="chip ${t.template_origin === "user" ? "ready" : "warning"}">${escapeHtml(t.template_origin ?? "builtin")}</span>
      </div>
    </button>
  `).join("");

  for (const btn of templateList.querySelectorAll("[data-template-id]")) {
    btn.addEventListener("click", () => void selectTemplate(btn.dataset.templateId));
  }
}

function renderDagExecutions() {
  // DAG editor UI retired — renderer stays no-op when DOM isn't present.
  if (!dagExecutionList) return;
  const executions = state.workspace.dagExecutions ?? [];
  if (dagExecutionCount) dagExecutionCount.textContent = `${executions.length}`;
  if (!state.selectedDagExecutionId || !executions.some((e) => e.execution_id === state.selectedDagExecutionId)) {
    state.selectedDagExecutionId = executions[0]?.execution_id ?? null;
  }
  if (executions.length === 0) {
    renderEmpty(dagExecutionList, "No DAG executions.");
    return;
  }

  dagExecutionList.innerHTML = executions.map((e) => {
    const sel = e.execution_id === state.selectedDagExecutionId;
    return `
      <div class="timeline-item ${sel ? "selected" : ""}">
        <div class="row">
          <strong style="font-size:12px;">${escapeHtml(e.execution_id)}</strong>
          <span class="chip ${e.status === "success" ? "ready" : e.status === "failed" ? "danger" : "warning"}">${escapeHtml(e.status)}</span>
        </div>
        <p class="muted" style="margin-top:4px;font-size:11px;">Nodes: ${escapeHtml(e.graph?.nodes?.length ?? 0)} · ${escapeHtml(formatDateTime(e.updated_at))}</p>
        <div class="toolbar" style="margin-top:6px;">
          <button class="btn" data-view-dag-id="${escapeHtml(e.execution_id)}">View</button>
          <button class="btn btn-ghost" data-resume-dag-id="${escapeHtml(e.execution_id)}" ${e.status !== "failed" ? "disabled" : ""}>Resume</button>
        </div>
      </div>
    `;
  }).join("");

  for (const btn of dagExecutionList.querySelectorAll("[data-view-dag-id]")) {
    btn.addEventListener("click", () => {
      const e = executions.find((x) => x.execution_id === btn.dataset.viewDagId);
      if (!e) return;
      state.selectedDagExecutionId = e.execution_id;
      dagEditorInput.value = JSON.stringify(e.graph ?? buildSampleDag(), null, 2);
      dagPreview.textContent = JSON.stringify({ execution_id: e.execution_id, status: e.status, statuses: e.statuses ?? {}, failedNodeId: e.failedNodeId ?? e.failed_node_id ?? null }, null, 2);
      renderDagExecutions();
    });
  }

  for (const btn of dagExecutionList.querySelectorAll("[data-resume-dag-id]")) {
    btn.addEventListener("click", async () => {
      dagPreview.textContent = "Resuming...";
      try {
        const result = await resumeDagExecutionViaShell(btn.dataset.resumeDagId);
        dagPreview.textContent = JSON.stringify(result.execution ?? result, null, 2);
        await refreshWorkspace();
      } catch (error) {
        dagPreview.textContent = `Failed: ${error.message}`;
      }
    });
  }
}

function renderBudget() {
  const b = state.workspace.budget ?? { limits: {}, spent: {} };
  const entries = [
    ["Monthly Limit", formatMoney(b.limits?.monthly_usd_limit ?? 0)],
    ["Per Task", formatMoney(b.limits?.per_task_usd_limit ?? 0)],
    ["This Month", formatMoney(b.spent?.this_month_usd ?? 0)],
    ["Tokens In", `${b.spent?.this_month_tokens_in ?? 0}`]
  ];
  budgetSummary.innerHTML = entries.map(([l, v]) => `
    <div class="summary-tile"><span class="muted" style="font-size:11px;">${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong></div>
  `).join("");
  monthlyBudgetInput.value = `${b.limits?.monthly_usd_limit ?? ""}`;
}

// UCA-121: renderHistory retired. The "search past tasks" UX now
// lives in the Tasks page via date + source filters (see
// taskMatchesFilter below). state.workspace.history kept as an
// empty array so anything that still reads it sees a no-op.

function buildDefaultProjectStore() {
  return buildDefaultProjectStoreBase({ defaultColor: PROJECT_COLORS[0] });
}

function normalizeProjectStore(store) {
  return normalizeProjectStoreBase(store, { defaultColor: PROJECT_COLORS[0] });
}

function mergeProjectStores(localStore, remoteStore) {
  return mergeProjectStoresBase(localStore, remoteStore, { defaultColor: PROJECT_COLORS[0] });
}

function loadConsoleProjectStore() {
  try {
    const raw = localStorage.getItem(PROJECT_STORE_KEY);
    if (!raw) return state.projectStore ?? buildDefaultProjectStore();
    return normalizeProjectStore(JSON.parse(raw));
  } catch {
    return buildDefaultProjectStore();
  }
}

function saveConsoleProjectStore(store) {
  const normalized = normalizeProjectStore(store);
  normalized.updatedAt = Date.now();
  state.projectStore = normalized;
  localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(normalized));
  void saveConsoleProjectStoreToService(normalized);
}

async function saveConsoleProjectStoreToService(store) {
  try {
    await saveProjectStoreViaShell(normalizeProjectStore(store));
    state.projectStoreRemoteReady = true;
  } catch {
    state.projectStoreRemoteReady = false;
  }
}

async function syncConsoleProjectStoreFromService({ rerender = false } = {}) {
  if (state.projectStoreSyncing) return;
  state.projectStoreSyncing = true;
  try {
    const local = state.projectStore ?? loadConsoleProjectStore();
    const payload = await fetchJson("/projects/store");
    const merged = mergeProjectStores(local, payload.store);
    state.projectStore = merged;
    localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(merged));
    await saveConsoleProjectStoreToService(merged);
    if (rerender) renderProjectsWorkspace();
  } catch {
    state.projectStore = state.projectStore ?? loadConsoleProjectStore();
  } finally {
    state.projectStoreSyncing = false;
  }
}

function renderProjectsWorkspace() {
  if (!projectList || !projectConversationList) return;
  const store = state.projectStore ?? loadConsoleProjectStore();
  state.projectStore = store;
  const projects = store.projects ?? [];
  if (!state.selectedProjectId || !projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = store.currentProjectId || projects[0]?.id || DEFAULT_PROJECT_ID;
  }
  const selectedProject = projects.find((project) => project.id === state.selectedProjectId) ?? projects[0] ?? null;
  const conversations = (store.conversations ?? [])
    .filter((conversation) => conversation.projectId === selectedProject?.id)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (!state.selectedProjectConversationId || !conversations.some((conversation) => conversation.id === state.selectedProjectConversationId)) {
    state.selectedProjectConversationId = conversations[0]?.id ?? null;
  }
  const selectedConversation = conversations.find((conversation) => conversation.id === state.selectedProjectConversationId) ?? null;

  projectCount.textContent = `${projects.length}`;
  projectConversationCount.textContent = `${conversations.length}`;
  projectConversationPreview.textContent = formatProjectConversationPreview(selectedConversation);

  projectList.innerHTML = renderProjectListHtml({
    projects,
    conversations: store.conversations ?? [],
    selectedProjectId: selectedProject?.id,
    defaultColor: PROJECT_COLORS[0]
  });

  projectConversationList.innerHTML = renderProjectConversationListHtml({
    conversations,
    selectedConversationId: selectedConversation?.id
  });

  for (const btn of projectList.querySelectorAll("[data-project-id]")) {
    btn.addEventListener("click", () => {
      state.selectedProjectId = btn.dataset.projectId;
      state.selectedProjectConversationId = null;
      store.currentProjectId = state.selectedProjectId;
      store.currentConversationId = null;
      saveConsoleProjectStore(store);
      renderProjectsWorkspace();
    });
  }
  for (const btn of projectConversationList.querySelectorAll("[data-project-conversation-id]")) {
    btn.addEventListener("click", () => {
      state.selectedProjectConversationId = btn.dataset.projectConversationId;
      store.currentConversationId = state.selectedProjectConversationId;
      store.currentProjectId = state.selectedProjectId || store.currentProjectId;
      saveConsoleProjectStore(store);
      renderProjectsWorkspace();
    });
  }
  for (const btn of projectConversationList.querySelectorAll("[data-resume-project-conversation-id]")) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const convId = btn.dataset.resumeProjectConversationId;
      if (!convId) return;
      void loadConsoleConversationFromBackend(convId);
      showConsoleToast("已加载对话，可继续输入", { kind: "ok" });
    });
  }
}

function renderPrivacy() {
  const sec = state.workspace.security ?? { global_kill_switch: false, offline_mode: false, presenter_mode: false, field_redaction: { enabled_rules: [] }, data_retention: {} };
  killSwitchToggle.checked = Boolean(sec.global_kill_switch);
  offlineModeToggle.checked = Boolean(sec.offline_mode);
  presenterModeToggle.checked = Boolean(sec.presenter_mode);
  killSwitchToggle.disabled = state.updatingSecurity;
  offlineModeToggle.disabled = state.updatingSecurity;
  presenterModeToggle.disabled = state.updatingSecurity;

  const rules = sec.field_redaction?.enabled_rules ?? [];
  redactionRuleList.innerHTML = rules.length > 0
    ? rules.map((r) => `<div class="surface" style="padding:8px 10px;"><strong style="font-size:12px;">${escapeHtml(r)}</strong></div>`).join("")
    : `<p class="muted" style="font-size:12px;">No redaction rules.</p>`;

  const retEntries = Object.entries(sec.data_retention ?? {});
  retentionList.innerHTML = retEntries.length > 0
    ? retEntries.map(([k, v]) => `<div class="surface" style="padding:8px 10px;"><div class="row"><strong style="font-size:12px;">${escapeHtml(k)}</strong><span class="muted" style="font-size:11px;">${escapeHtml(v)}</span></div></div>`).join("")
    : `<p class="muted" style="font-size:12px;">No retention policies.</p>`;
}

function renderAudit() {
  const entries = state.workspace.audit ?? [];
  auditCount.textContent = `${entries.length}`;
  if (entries.length === 0) {
    renderEmpty(auditList, "No audit entries.");
    return;
  }
  auditList.innerHTML = entries.slice(0, 24).map((e) => `
    <div class="timeline-item">
      <div class="row"><strong style="font-size:12px;">${escapeHtml(e.event_subtype ?? "event")}</strong><span class="muted" style="font-size:11px;">${escapeHtml(formatDateTime(e.ts))}</span></div>
      <p class="muted" style="margin-top:4px;font-size:11px;">task: ${escapeHtml(e.task_id ?? "n/a")}</p>
    </div>
  `).join("");
}

// Populate the "预览 Preview" settings section with the live provider
// roster, preview strategy, registry metrics and cache stats.
async function renderPreviewSettings() {
  const formatsEl = document.getElementById("previewFormatsList");
  const strategyEl = document.getElementById("previewStrategyInfo");
  const metricsEl = document.getElementById("previewMetrics");
  const cacheEl = document.getElementById("previewCacheInfo");
  if (!formatsEl || !strategyEl || !metricsEl || !cacheEl) return;
  formatsEl.innerHTML = `<div class="muted" style="font-size:12px;">Loading…</div>`;
  try {
    const status = await fetchJson("/preview/status");
    const formats = status.providers ?? [];
    formatsEl.innerHTML = formats.length
      ? formats.map((p) => `
        <div class="row" style="justify-content:space-between;font-size:12px;padding:4px 0;">
          <span><strong>${escapeHtml(p.id)}</strong> <span class="muted">(${(p.extensions ?? []).join(" ")})</span></span>
          <span class="muted">priority ${p.priority}</span>
        </div>`).join("")
      : `<div class="muted" style="font-size:12px;">无已注册的 Provider。</div>`;

    strategyEl.innerHTML = `
      <div>生成的 Office 文件优先使用 sidecar HTML 预览。</div>
      <div>外部 docx / xlsx / pdf 使用各自 provider；外部 pptx 使用坐标解析预览。</div>`;

    const m = status.metrics ?? {};
    const hitRate = m.renders > 0 ? ((m.cacheHits / m.renders) * 100).toFixed(1) : "—";
    const byProvider = m.byProvider ?? {};
    metricsEl.innerHTML = `
      <div>总渲染次数: ${m.renders ?? 0}</div>
      <div>缓存命中: ${m.cacheHits ?? 0} · 命中率 ${hitRate}${typeof hitRate === "string" && hitRate !== "—" ? "%" : ""}</div>
      <div style="margin-top:6px;">${Object.entries(byProvider).map(([id, stats]) =>
        `<div>• ${escapeHtml(id)}: ${stats.hits} 次 · 平均 ${stats.hits > 0 ? (stats.renderMs / Math.max(1, stats.hits - stats.cacheHits)).toFixed(0) : "—"} ms · ${stats.errors ?? 0} 错误</div>`
      ).join("") || '<span class="muted">暂无指标。</span>'}</div>`;

    const cache = status.cache ?? {};
    cacheEl.innerHTML = `
      <div>路径: <code style="font-size:11px;">${escapeHtml(cache.dir ?? "—")}</code></div>
      <div>${cache.files ?? 0} 个缓存文件 · ${formatBytesSimple(cache.bytes ?? 0)}</div>`;
  } catch (error) {
    formatsEl.innerHTML = `<div class="muted" style="font-size:12px;color:#b45309;">运行时未就绪: ${escapeHtml(error.message)}</div>`;
    strategyEl.textContent = "";
    metricsEl.textContent = "";
    cacheEl.textContent = "";
  }
}

function formatBytesSimple(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// UCA-182 Phase 11: populate the 最近失败任务 settings panel.
// Fetches /tasks/failed (recent 20) and lets the user click a row to
// stream the full per-task jsonl log from /task/<id>/log.
async function renderFailedTasks() {
  const listEl = document.getElementById("failedTasksList");
  const viewerEl = document.getElementById("failedTaskLogViewer");
  if (!listEl) return;
  listEl.innerHTML = `<div class="muted" style="font-size:12px;">Loading…</div>`;
  try {
    const resp = await fetchJson("/tasks/failed");
    const items = resp.failed ?? [];
    if (items.length === 0) {
      listEl.innerHTML = `<div class="muted" style="font-size:12px;">最近没有失败任务。</div>`;
      return;
    }
    listEl.innerHTML = items.map((t) => `
      <div class="surface" style="padding:8px 10px;cursor:pointer;" data-failed-task="${escapeHtml(t.task_id)}">
        <div class="row" style="justify-content:space-between;gap:8px;">
          <strong style="font-size:12px;">${escapeHtml(t.task_id.slice(0, 28))}</strong>
          <span class="muted" style="font-size:11px;">${escapeHtml(formatDateTime(t.updated_at ?? t.created_at))}</span>
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:3px;">${escapeHtml((t.user_command ?? "").slice(0, 140))}</div>
        ${t.failure_user_message ? `<div style="font-size:11px;margin-top:4px;color:#b45309;">${escapeHtml(String(t.failure_user_message).slice(0, 240))}</div>` : ""}
      </div>`).join("");
    for (const row of listEl.querySelectorAll("[data-failed-task]")) {
      row.addEventListener("click", async () => {
        const taskId = row.dataset.failedTask;
        if (!taskId || !viewerEl) return;
        viewerEl.style.display = "block";
        viewerEl.textContent = `加载 ${taskId} 事件流…`;
        try {
          const log = await fetchJson(`/task/${encodeURIComponent(taskId)}/log`);
          const events = log.events ?? [];
          if (events.length === 0) {
            viewerEl.textContent = `任务 ${taskId} 无持久化事件（早于 Phase 11 或事件已清理）。`;
            return;
          }
          viewerEl.innerHTML = events.map((e) => `
            <div style="border-bottom:1px solid var(--line);padding:4px 0;">
              <span style="color:var(--muted);">[${escapeHtml(formatDateTime(e.ts))}]</span>
              <strong>${escapeHtml(e.event_type)}</strong>
              <pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;font-size:10.5px;color:var(--muted);">${escapeHtml(JSON.stringify(e.payload ?? {}, null, 0).slice(0, 600))}</pre>
            </div>`).join("");
        } catch (error) {
          viewerEl.textContent = `加载失败：${error.message}`;
        }
      });
    }
  } catch (error) {
    listEl.innerHTML = `<div class="muted" style="font-size:12px;color:#b45309;">加载失败：${escapeHtml(error.message)}</div>`;
  }
}

document.getElementById("failedTasksRefreshBtn")?.addEventListener("click", () => {
  void renderFailedTasks();
});

async function updateSecurityConfig(patch, label) {
  privacyState.textContent = `Updating ${label}...`;
  state.updatingSecurity = true;
  renderPrivacy();
  try {
    if (typeof window.ucaShell?.updateSecurityState !== "function") {
      throw new Error("Desktop security settings bridge unavailable.");
    }
    const payload = assertShellResult(
      await window.ucaShell.updateSecurityState(patch),
      "Could not update security settings."
    );
    state.workspace.security = payload.security ?? state.workspace.security;
    privacyState.textContent = `${label} updated`;
    renderPrivacy();
    await refreshWorkspace();
  } catch (error) {
    privacyState.textContent = `Failed: ${error.message}`;
  } finally {
    state.updatingSecurity = false;
    renderPrivacy();
  }
}

/* ═══════════════════════════════════════════════
   UCA-048: OUTPUT PATH + FEATURE TOGGLES
   ═══════════════════════════════════════════════ */

const FEATURE_DEFINITIONS = [
  { id: "translation",                label: "翻译",             description: "免费翻译功能" },
  { id: "voice_input",                label: "语音输入",          description: "Overlay 语音识别" },
  { id: "email_monitoring",           label: "邮件监测",          description: "IMAP/Graph 邮件轮询" },
  { id: "morning_digest",             label: "早晨邮件汇总",       description: "每日早晨自动汇总" },
  { id: "inline_web_result",          label: "网页内联结果",       description: "浏览器选区内联显示" },
  { id: "active_window_probe",        label: "活动窗口探测",       description: "热键唤起时检测当前窗口" },
  { id: "web_search_fetch",           label: "网络搜索",          description: "AI 自动搜索" },
  { id: "multi_intent_decomposition", label: "多意图分解",         description: "一句话拆成多子任务" },
  { id: "schedule_reminders",         label: "定时提醒",          description: "Schedule 提前通知" },
  { id: "projects_and_history",       label: "项目与历史",         description: "多项目 + 历史会话" }
];

function renderFeatureToggles() {
  const list = document.getElementById("featureToggleList");
  if (!list) return;
  const config = state.workspace?.health?.config ?? {};
  const features = config.features ?? {};

  list.innerHTML = FEATURE_DEFINITIONS.map((def) => {
    const enabled = features[def.id]?.enabled !== false;
    return `
      <label id="${escapeHtml(`features.${def.id}`)}" class="switch-row" style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;">
        <input type="checkbox" class="switch-control" data-feature-id="${escapeHtml(def.id)}" ${enabled ? "checked" : ""}>
        <div>
          <strong style="font-size:13px;">${escapeHtml(def.label)}</strong>
          <span class="muted" style="font-size:11px;margin-left:6px;">${escapeHtml(def.description)}</span>
        </div>
      </label>
    `;
  }).join("");
}

function renderOutputDir() {
  const input = document.getElementById("outputDirInput");
  if (!input) return;
  const config = state.workspace?.health?.config ?? {};
  const dir = config.output?.defaultDir ?? "";
  if (!input.value) input.value = dir;
}

document.getElementById("outputDirDefaultBtn")?.addEventListener("click", () => {
  const input = document.getElementById("outputDirInput");
  if (input) input.value = "";
});

document.getElementById("saveOutputDirBtn")?.addEventListener("click", async () => {
  const input = document.getElementById("outputDirInput");
  const stateLabel = document.getElementById("outputDirSaveState");
  const dir = input?.value?.trim() || "";
  try {
    await updateOutputConfigViaShell({ defaultDir: dir, autoCreateDirs: true });
    if (stateLabel) stateLabel.textContent = "Saved.";
  } catch (error) {
    if (stateLabel) stateLabel.textContent = `Failed: ${error.message}`;
  }
});

document.getElementById("saveFeatureTogglesBtn")?.addEventListener("click", async () => {
  const stateLabel = document.getElementById("featureTogglesSaveState");
  const toggles = {};
  for (const input of document.querySelectorAll("[data-feature-id]")) {
    toggles[input.dataset.featureId] = { enabled: input.checked };
  }
  try {
    await updateFeatureConfigViaShell(toggles);
    if (state.workspace.health?.config) {
      state.workspace.health.config.features = toggles;
    }
    if (Object.prototype.hasOwnProperty.call(toggles, "morning_digest")) {
      state.workspace.emailDigestSettings = {
        ...(state.workspace.emailDigestSettings ?? {}),
        enabled: toggles.morning_digest.enabled
      };
      renderEmailDigestSettings();
    }
    if (stateLabel) stateLabel.textContent = "Saved.";
  } catch (error) {
    if (stateLabel) stateLabel.textContent = `Failed: ${error.message}`;
  }
});

/* ═══════════════════════════════════════════════
   WORKSPACE REFRESH
   ═══════════════════════════════════════════════ */

async function refreshWorkspace() {
  try {
    const shell = await window.ucaShell.getShellStatus();
    state.serviceBaseUrl = shell.serviceBaseUrl ?? state.serviceBaseUrl;

    // UCA-121: /history/search call retired along with the Memory tab.
    const [health, tasksP, approvalsP, schedulesP, templatesP, budgetP, securityP, auditP, dagP, providersP, cliP, mcpP, skillsP, emailP, emailSettingsP] = await Promise.all([
      fetchJson("/health"),
      fetchJson("/tasks"),
      fetchJson("/approvals"),
      fetchJson("/schedules"),
      fetchJson("/templates"),
      fetchJson("/budget"),
      fetchJson("/security/state"),
      fetchJson("/audit-log"),
      fetchJson("/dag/executions"),
      fetchJson("/ai/providers"),
      fetchJson("/ai/code-cli"),
      fetchJson("/ai/mcp"),
      fetchJson("/ai/skills"),
      fetchJson("/config/email/accounts"),
      fetchJson("/config/email/settings")
    ]);

    state.workspace = {
      health,
      tasks: tasksP.tasks ?? [],
      approvals: approvalsP.approvals ?? [],
      schedules: schedulesP.schedules ?? [],
      templates: templatesP.templates ?? [],
      budget: budgetP.budget ?? null,
      providers: providersP.providers ?? [],
      codeCliAdapters: cliP.adapters ?? [],
      mcpServers: mcpP.servers ?? [],
      skillRegistries: skillsP.registries ?? [],
      skills: skillsP.skills ?? [],
      emailAccounts: emailP.accounts ?? [],
      emailDigestSettings: emailSettingsP.settings ?? {},
      history: [], // UCA-121: retired
      security: securityP.security ?? null,
      audit: auditP.entries ?? [],
      dagExecutions: dagP.executions ?? []
    };
    surfaceNewWorkspaceApprovals(state.workspace.approvals);

    setRuntimeBadge(true, `Connected · ${state.serviceBaseUrl}`);
    updateTopRuntimePill();
    renderSummary();
    renderOnboarding();
    renderIntegrations();
    // providers + routing loaded separately via loadProvidersAndRouting()
    renderTasks();
    renderApprovals();
    renderSchedules();
    renderTemplates();
    renderDagExecutions();
    renderBudget();
    // UCA-121: renderHistory() retired
    renderProjectsWorkspace();
    void syncConsoleProjectStoreFromService({ rerender: true });
    renderPrivacy();
    renderAudit();
    void renderPreviewSettings();
    void renderFailedTasks();
    renderMcpServers();
    renderSkillRegistries();
    renderCodeCliAdapters();
    renderEmailAccounts();
    renderEmailDigestSettings();
    renderFeatureToggles();
    renderOutputDir();
    void loadAllArtifacts();
    await Promise.all([refreshTaskDetail(), loadTemplatePreview(state.selectedTemplateId)]);
  } catch (error) {
    setRuntimeBadge(false, `Unavailable · ${error.message}`);
  }
}

/* ═══════════════════════════════════════════════
   EVENT BINDINGS
   ═══════════════════════════════════════════════ */

taskComposer.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitState.textContent = "Submitting...";
  try {
    const result = await fetchJson("/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceApp: "uca.console.desktop",
        captureMode: "desktop_console",
        sourceType: "clipboard",
        text: "",
        userCommand: commandInput.value || "Process this text",
        executionMode: "interactive"
      })
    });
    submitState.textContent = `Submitted ${result.task.task_id}`;
    commandInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    submitState.textContent = `Failed: ${error.message}`;
  }
});

// UCA-108: task filter chips + search input wire-up.
for (const chip of document.querySelectorAll("#taskFilterChips .filter-chip")) {
  chip.addEventListener("click", () => {
    const nextFilter = chip.dataset.filter ?? "all";
    state.taskFilter = nextFilter;
    for (const other of document.querySelectorAll("#taskFilterChips .filter-chip")) {
      other.setAttribute("aria-pressed", other === chip ? "true" : "false");
    }
    renderTasks();
  });
}
document.querySelector("#taskSearchInput")?.addEventListener("input", (event) => {
  state.taskSearch = event.target.value ?? "";
  renderTasks();
});

// UCA-121: date filter chips (All / Today / 7d / 30d).
for (const chip of document.querySelectorAll("#taskDateFilterChips .filter-chip")) {
  chip.addEventListener("click", () => {
    state.taskDateFilter = chip.dataset.date ?? "all";
    for (const other of document.querySelectorAll("#taskDateFilterChips .filter-chip")) {
      other.setAttribute("aria-pressed", other === chip ? "true" : "false");
    }
    renderTasks();
    updateTasksAdvFilterBadge();
  });
}
// Source chips are dynamic; shared handler used for both the static "All"
// chip and the JS-generated per-source chips.
function handleTaskSourceChip(chip) {
  state.taskSourceFilter = chip.dataset.source ?? "all";
  for (const other of document.querySelectorAll("#taskSourceFilterChips .filter-chip")) {
    other.setAttribute("aria-pressed", other === chip ? "true" : "false");
  }
  renderTasks();
  updateTasksAdvFilterBadge();
}
document.querySelector('#taskSourceFilterChips .filter-chip[data-source="all"]')
  ?.addEventListener("click", (event) => handleTaskSourceChip(event.currentTarget));

// UCA-125 Phase 2a: Advanced filter popover — date + source chips live
// here now. Toggle on button click, close on outside click / Esc, and
// surface a count badge when any non-default filter is active.
const tasksAdvFilterBtn = document.querySelector("#tasksAdvFilterBtn");
const tasksAdvFilterPanel = document.querySelector("#tasksAdvFilter");
const tasksAdvFilterCount = document.querySelector("#tasksAdvFilterCount");
function setTasksAdvFilterOpen(open) {
  if (!tasksAdvFilterBtn || !tasksAdvFilterPanel) return;
  if (open) {
    tasksAdvFilterPanel.removeAttribute("hidden");
    tasksAdvFilterBtn.setAttribute("aria-expanded", "true");
  } else {
    tasksAdvFilterPanel.setAttribute("hidden", "");
    tasksAdvFilterBtn.setAttribute("aria-expanded", "false");
  }
}
function updateTasksAdvFilterBadge() {
  if (!tasksAdvFilterCount) return;
  let active = 0;
  if (state.taskDateFilter && state.taskDateFilter !== "all") active += 1;
  if (state.taskSourceFilter && state.taskSourceFilter !== "all") active += 1;
  if (active > 0) {
    tasksAdvFilterCount.textContent = String(active);
    tasksAdvFilterCount.removeAttribute("hidden");
  } else {
    tasksAdvFilterCount.setAttribute("hidden", "");
  }
}
tasksAdvFilterBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  setTasksAdvFilterOpen(tasksAdvFilterPanel?.hasAttribute("hidden"));
});
document.addEventListener("click", (event) => {
  if (!tasksAdvFilterPanel || tasksAdvFilterPanel.hasAttribute("hidden")) return;
  if (tasksAdvFilterPanel.contains(event.target) || tasksAdvFilterBtn?.contains(event.target)) return;
  setTasksAdvFilterOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && tasksAdvFilterPanel && !tasksAdvFilterPanel.hasAttribute("hidden")) {
    setTasksAdvFilterOpen(false);
  }
});

refreshButton.addEventListener("click", () => void refreshWorkspace());
openOverlayButton.addEventListener("click", async () => await window.ucaShell.showWindow("overlay"));

/* ── Desktop location chip ──────────────────────────────────────────────
 * Hooks the Windows-side geolocator (System.Device.Location via PowerShell
 * in the service). Three states:
 *   - unknown         → click to fetch
 *   - has fix         → tooltip shows city; click again to refresh, shift-click to clear
 *   - denied/unavail  → guides user to ms-settings:privacy-location
 *
 * Reads /location on boot to sync the icon's tooltip with whatever fix the
 * service already has (could be a browser-pushed fix from earlier).
 */
function describeLocationReason(reason) {
  switch (reason) {
    case "denied":
      return "Windows 拒绝了位置访问。请在 设置 → 隐私和安全性 → 定位 中打开「定位服务」和「让桌面应用访问你的位置」。";
    case "unavailable":
      return "Windows 定位服务已开启但当前没有可用读数（无 GPS、无 Wi-Fi 定位）。换个网络或稍后再试。";
    case "timeout":
      return "Windows 定位查询超时（>12s）。再试一次。";
    case "unsupported_platform":
      return "桌面定位仅支持 Windows。在 Mac/Linux 请改用浏览器侧栏的 📍 按钮。";
    default:
      return `查询失败：${reason}`;
  }
}

async function refreshDesktopLocationChip() {
  if (!locationButton) return;
  try {
    const r = await fetchJson("/location");
    const loc = r?.location;
    if (loc) {
      const where = loc.city
        ? `${loc.city}${loc.country ? `, ${loc.country}` : ""}`
        : `${loc.latitude?.toFixed?.(3) ?? "?"}, ${loc.longitude?.toFixed?.(3) ?? "?"}`;
      const acc = typeof loc.accuracyMeters === "number" ? `, ±${Math.round(loc.accuracyMeters)}m` : "";
      locationButton.title = `定位：${where} (${loc.timezone}${acc}, source=${loc.source ?? "?"}). Shift+点击 清除`;
      locationButton.dataset.granted = "1";
    } else {
      locationButton.title = "启用 Windows 定位（用于地点相关查询和触发器）。点击调用系统定位服务";
      delete locationButton.dataset.granted;
    }
  } catch {
    /* desktop service down — leave default tooltip */
  }
}

locationButton?.addEventListener("click", async (event) => {
  if (!locationButton) return;
  if (event.shiftKey) {
    try {
      await fetchJson("/location", { method: "DELETE" });
      locationButton.title = "已清除桌面定位";
      delete locationButton.dataset.granted;
    } catch (err) {
      locationButton.title = `清除失败：${err.message}`;
    }
    return;
  }
  const original = locationButton.title;
  locationButton.title = "查询 Windows 定位中…";
  try {
    const r = await fetchJson("/location/windows", { method: "POST" });
    if (r?.ok) {
      const loc = r.location;
      const where = loc.city ? `${loc.city}${loc.country ? `, ${loc.country}` : ""}` : `${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}`;
      const acc = typeof loc.accuracyMeters === "number" ? `, ±${Math.round(loc.accuracyMeters)}m` : "";
      locationButton.title = `定位：${where} (${loc.timezone}${acc}). Shift+点击 清除`;
      locationButton.dataset.granted = "1";
    } else {
      const reason = r?.reason ?? "unknown";
      locationButton.title = describeLocationReason(reason);
      if (reason === "denied" && window.ucaShell?.openExternal) {
        window.ucaShell.openExternal("ms-settings:privacy-location").catch(() => {});
      }
    }
  } catch (err) {
    locationButton.title = original;
    console.warn("[location] fetch failed", err);
  }
});

// Hydrate on boot so the icon tooltip shows the current state immediately.
void refreshDesktopLocationChip();

// UCA-104: keyboard-shortcut cheatsheet — open with Ctrl+/ or the ? button,
// close with Esc / backdrop click / × button.
const cheatsheetBackdrop = document.querySelector("#cheatsheetBackdrop");
const cheatsheetButton = document.querySelector("#cheatsheetButton");
const cheatsheetCloseButton = document.querySelector("#cheatsheetCloseButton");
function toggleCheatsheet(show) {
  if (!cheatsheetBackdrop) return;
  const next = show ?? cheatsheetBackdrop.hasAttribute("hidden");
  if (next) {
    cheatsheetBackdrop.removeAttribute("hidden");
    cheatsheetCloseButton?.focus();
  } else {
    cheatsheetBackdrop.setAttribute("hidden", "");
  }
}
cheatsheetButton?.addEventListener("click", () => toggleCheatsheet(true));
cheatsheetCloseButton?.addEventListener("click", () => toggleCheatsheet(false));
cheatsheetBackdrop?.addEventListener("click", (event) => {
  if (event.target === cheatsheetBackdrop) toggleCheatsheet(false);
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "/") {
    event.preventDefault();
    toggleCheatsheet();
  } else if (event.key === "Escape" && cheatsheetBackdrop && !cheatsheetBackdrop.hasAttribute("hidden")) {
    event.preventDefault();
    toggleCheatsheet(false);
  }
});

// UCA-110 (Phase 4e): Console-internal command palette (Ctrl+K).
// Quick-submit path for tasks, reusing the same /task endpoint the
// taskComposer submits to. Quick-action chips prefill the input with
// a template; ↑↓ navigate the recent-tasks list; ↵ submits.
(() => {
  const backdrop = document.querySelector("#paletteBackdrop");
  const searchInput = document.querySelector("#paletteSearchInput");
  const recentList = document.querySelector("#paletteRecent");
  const greeting = document.querySelector("#paletteGreeting");
  const modelPill = document.querySelector("#paletteModelPill");
  if (!backdrop || !searchInput) return;

  const QUICK_TEMPLATES = {
    "new-chat": "",
    translate: "Translate the following to English: ",
    summarize: "Summarize: ",
    explain: "Explain in simple terms: ",
    schedule: "In 5 minutes, remind me to "
  };

  let activeIndex = -1; // -1 means "submit the search text, not a list item"
  let items = [];

  function refreshItems() {
    const tasks = (state.workspace.tasks ?? []).slice(0, 8);
    items = tasks.map((t) => ({
      title: t.user_command ?? t.intent ?? "(untitled)",
      sub: `${t.executor ?? "—"} · ${t.status ?? ""}`,
      taskId: t.task_id
    }));
    recentList.innerHTML = items.length === 0
      ? `<p class="muted" style="padding:12px 20px;font-size:12px;">No recent tasks.</p>`
      : items.map((it, i) => `
          <button type="button" class="palette-item${i === activeIndex ? " palette-item--active" : ""}" data-palette-idx="${i}">
            <svg class="palette-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span class="palette-item-main">
              <span class="palette-item-title">${escapeHtml(it.title)}</span>
              <span class="palette-item-sub">${escapeHtml(it.sub)}</span>
            </span>
          </button>
        `).join("");
    for (const btn of recentList.querySelectorAll("[data-palette-idx]")) {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.paletteIdx);
        if (Number.isFinite(idx) && items[idx]) {
          state.selectedTaskId = items[idx].taskId;
          switchTab("tasks");
          renderTasks();
          void refreshTaskDetail();
          setOpen(false);
        }
      });
    }
  }

  function refreshModelPill() {
    // Best-effort: prefer the chat routing's configured model, fall
    // back to any configured provider, otherwise hide the pill.
    const route = state.workspace?.providers?.find?.((p) => p?.available && p?.configured);
    const label = route?.model ?? route?.provider_id ?? null;
    if (!label) { modelPill.textContent = ""; modelPill.style.display = "none"; return; }
    modelPill.textContent = label;
    modelPill.style.display = "inline-flex";
  }

  function setOpen(open) {
    const next = open ?? backdrop.hasAttribute("hidden");
    if (next) {
      backdrop.removeAttribute("hidden");
      activeIndex = -1;
      refreshItems();
      refreshModelPill();
      setTimeout(() => searchInput.focus(), 0);
    } else {
      backdrop.setAttribute("hidden", "");
    }
  }

  function highlight(idx) {
    activeIndex = items.length === 0 ? -1 : Math.max(-1, Math.min(items.length - 1, idx));
    for (const el of recentList.querySelectorAll(".palette-item")) {
      el.classList.toggle("palette-item--active", Number(el.dataset.paletteIdx) === activeIndex);
    }
  }

  async function submitPrompt() {
    const text = searchInput.value.trim();
    if (!text) return;
    try {
      // Backend submitTaskFromBody expects camelCase field names
      // (userCommand / sourceApp). Prior snake_case payload silently
      // failed the empty-command guard — server returned
      // { ok:false, error:"missing_user_command" } and nothing reached
      // the task store, so New task appeared to do nothing.
      const result = await fetchJson("/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCommand: text, sourceApp: "console.palette" })
      });
      if (result && result.ok === false) {
        greeting.textContent = result.message || result.error || "Submission failed.";
        return;
      }
      if (result && result.type === "clarification_needed") {
        greeting.textContent = result.question || "Please clarify.";
        return;
      }
      searchInput.value = "";
      setOpen(false);
      await refreshWorkspace();
      switchTab("tasks");
    } catch (error) {
      // Keep the palette open on error so the user can retry without
      // re-typing; surface the message via the greeting area.
      greeting.textContent = `Submission failed: ${error.message}`;
    }
  }

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) setOpen(false);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); highlight(activeIndex + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); highlight(activeIndex - 1); }
    else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        state.selectedTaskId = items[activeIndex].taskId;
        switchTab("tasks");
        renderTasks();
        void refreshTaskDetail();
        setOpen(false);
      } else {
        void submitPrompt();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  });

  for (const chip of document.querySelectorAll(".palette-chip[data-quick]")) {
    chip.addEventListener("click", () => {
      const template = QUICK_TEMPLATES[chip.dataset.quick] ?? "";
      searchInput.value = template;
      searchInput.focus();
      if (template) searchInput.setSelectionRange(template.length, template.length);
    });
  }

  // UCA-117: the v3 topbar's search pill is the primary palette trigger.
  document.querySelector("#openPaletteBtn")?.addEventListener("click", () => setOpen(true));
  // UCA-125 Phase 3 follow-up: Tasks page-head "+ New task" opens the
  // same palette — a new task starts as a command/prompt entry, not a
  // separate form. Ctrl+K remains the canonical shortcut.
  document.querySelector("#tasksNewBtn")?.addEventListener("click", () => setOpen(true));

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && (event.key === "k" || event.key === "K")) {
      event.preventDefault();
      setOpen();
    } else if (event.key === "Escape" && !backdrop.hasAttribute("hidden")) {
      // Only handle escape when we own the topmost modal (cheatsheet/
      // tweaks handlers already guard with their own hidden checks).
      event.preventDefault();
      setOpen(false);
    }
  });
})();

consoleChatForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  // Dual-purpose: when a task is running, the Send button is showing
  // "停止" — click cancels instead of submitting a new message.
  if (consoleChatActiveTaskId) {
    void cancelConsoleChatActiveTask();
    return;
  }
  void submitConsoleChat();
});
consoleChatInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (consoleChatActiveTaskId) {
      // Enter while a task runs is intentionally NOT a stop signal —
      // the user might be typing the next prompt mid-stream. The
      // explicit Stop button is the only way to cancel.
      showConsoleToast("任务正在运行，点击「停止」取消", { kind: "info" });
      return;
    }
    void submitConsoleChat();
  }
});

retryTaskButton.addEventListener("click", async () => {
  if (!state.selectedTaskId) return;
  await retryTaskViaShell(state.selectedTaskId, { mode: "retry_same" });
  await refreshWorkspace();
});

// Track whether we already asked to cancel this task once. Second
// click on the (now visible) red "停止" button escalates to force —
// matches the overlay / console-chat Stop semantics.
let consoleTaskCancellationRequestedId = null;
cancelTaskButton.addEventListener("click", async () => {
  if (!state.selectedTaskId) return;
  const taskId = state.selectedTaskId;
  const force = consoleTaskCancellationRequestedId === taskId;
  consoleTaskCancellationRequestedId = taskId;
  try {
    await cancelTaskViaShell(taskId, { force });
    showConsoleToast(force ? "已强制取消" : "已请求取消任务", { kind: force ? "ok" : "info" });
  } catch (error) {
    showConsoleToast(`取消失败：${error?.message ?? error}`, { kind: "err" });
  }
  await refreshWorkspace();
});

const deleteTaskButton = document.getElementById("deleteTaskButton");
deleteTaskButton?.addEventListener("click", async () => {
  if (!state.selectedTaskId) return;
  await deleteTaskViaShell(state.selectedTaskId);
  state.selectedTaskId = null;
  await refreshWorkspace();
});

openTaskArtifactButton.addEventListener("click", async () => {
  if (state.selectedTaskArtifactPath) await window.ucaShell.openPath(state.selectedTaskArtifactPath);
});

copyTaskArtifactPathButton.addEventListener("click", async () => {
  if (state.selectedTaskArtifactPath) await window.ucaShell.writeClipboardText(state.selectedTaskArtifactPath);
});

useTaskArtifactContextButton.addEventListener("click", async () => {
  if (!state.selectedTaskArtifactPath) return;
  if (isPreviewableArtifactPath(state.selectedTaskArtifactPath)) {
    try {
      const raw = await window.ucaShell.readTextFile(state.selectedTaskArtifactPath, 4000);
      commandInput.value = normalisePreviewText(raw).slice(0, 2400);
    } catch {
      commandInput.value = `Process this file: ${state.selectedTaskArtifactPath}`;
    }
  } else {
    commandInput.value = `Process this file: ${state.selectedTaskArtifactPath}`;
  }
  commandInput.focus();
});

templateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  templateState.textContent = "Saving...";
  try {
    const active = state.workspace.templates.find((t) => t.id === state.selectedTemplateId) ?? null;
    const name = templateNameInput.value.trim();
    const prompt = templatePromptInput.value.trim();
    const id = active?.template_origin === "user" && active?.id ? active.id : `user.${slugify(name)}`;
    const template = { schema_version: "1.0", id, name: name || "Unnamed", version: active?.version ?? "1.0.0", steps: [{ id: "draft", kind: "executor", target: "fast", inputs: { prompt } }] };
    await saveTemplateViaShell(template);
    templateState.textContent = `Saved ${template.id}`;
    state.selectedTemplateId = template.id;
    await refreshWorkspace();
  } catch (error) {
    templateState.textContent = `Failed: ${error.message}`;
  }
});

importTemplateButton.addEventListener("click", async () => {
  const raw = templateImportInput.value.trim();
  if (!raw) { templateState.textContent = "Paste JSON first"; return; }
  templateState.textContent = "Importing...";
  try {
    await importTemplateViaShell(raw);
    templateState.textContent = "Imported";
    templateImportInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    templateState.textContent = `Failed: ${error.message}`;
  }
});

deleteTemplateButton.addEventListener("click", async () => {
  if (!state.selectedTemplateId) return;
  try {
    await deleteTemplateViaShell(state.selectedTemplateId);
    templateState.textContent = "Deleted";
    state.selectedTemplateId = null;
    templateNameInput.value = "";
    templatePromptInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    templateState.textContent = `Failed: ${error.message}`;
  }
});

budgetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  budgetState.textContent = "Updating...";
  try {
    if (typeof window.ucaShell?.updateBudget !== "function") {
      throw new Error("Desktop budget bridge unavailable.");
    }
    await assertShellResult(
      await window.ucaShell.updateBudget({ limits: { monthly_usd_limit: Number(monthlyBudgetInput.value || 0) } }),
      "Could not update budget."
    );
    budgetState.textContent = "Updated";
    await refreshWorkspace();
  } catch (error) {
    budgetState.textContent = `Failed: ${error.message}`;
  }
});

// UCA-121: historyForm submit handler retired (form removed from DOM).

// UCA-125 Phase 3-4: page-head "+ New project" button focuses the
// inline name input (faster than hunting for the form in the left col).
document.querySelector("#projectNewBtn")?.addEventListener("click", () => {
  projectNameInput?.focus();
  projectNameInput?.select?.();
});

// "+ New chat" — clear the current thread and the active conversation
// reference so the next submit creates a fresh conversation_id rather
// than continuing to thread into the previously-resumed one.
function startNewConsoleChat() {
  consoleChatEventStream?.close?.();
  consoleChatEventStream = null;
  consoleChatToolCards = new Map();
  consoleChatStreamingAnswer = null;
  closeConsoleChatThinkingCard();
  consoleChatResultTaskIds = new Set();
  clearConsoleActiveConversation();
  if (consoleChatMessages) {
    consoleChatMessages.innerHTML = `<div class="console-chat-empty">没有对话 — 开始一个吧。</div>`;
  }
  const input = document.querySelector("#consoleChatInput");
  if (input) { input.value = ""; input.focus(); }
  if (consoleChatState) consoleChatState.textContent = "";
  renderChatSidebar();
}

document.querySelector("#consoleChatNewBtn")?.addEventListener("click", startNewConsoleChat);
document.querySelector("#chatSidebarNewBtn")?.addEventListener("click", startNewConsoleChat);

// Sidebar collapse toggle. Persisted in localStorage so refreshing
// keeps the user's preference. Two buttons drive the same state:
// the chevron in the sidebar header (collapse) and the floating
// arrow at the chat shell's left edge (expand).
const CHAT_SIDEBAR_COLLAPSED_KEY = "lingxy.chatSidebar.collapsed";
function applyChatSidebarCollapsed(collapsed) {
  const layout = document.querySelector("#panel-chat .chat-layout");
  if (!layout) return;
  layout.classList.toggle("sidebar-collapsed", Boolean(collapsed));
  const toggleBtn = document.querySelector("#chatSidebarToggleBtn");
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggleBtn.setAttribute("title", collapsed ? "展开侧栏" : "收起侧栏");
  }
  const expandBtn = document.querySelector("#chatSidebarExpandBtn");
  if (expandBtn) expandBtn.hidden = !collapsed;
  try { localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* sandbox */ }
}
function toggleChatSidebar() {
  const layout = document.querySelector("#panel-chat .chat-layout");
  applyChatSidebarCollapsed(!layout?.classList.contains("sidebar-collapsed"));
}
document.querySelector("#chatSidebarToggleBtn")?.addEventListener("click", toggleChatSidebar);
document.querySelector("#chatSidebarExpandBtn")?.addEventListener("click", toggleChatSidebar);
// Restore preference at boot.
try {
  const initialCollapsed = localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_KEY) === "1";
  if (initialCollapsed) applyChatSidebarCollapsed(true);
} catch { /* ignore */ }

// Sidebar search — debounced so each keystroke doesn't redraw the list.
document.querySelector("#chatSidebarSearch")?.addEventListener("input", (event) => {
  chatSidebarSearchTerm = event.target.value ?? "";
  if (chatSidebarSearchDebounce) clearTimeout(chatSidebarSearchDebounce);
  chatSidebarSearchDebounce = setTimeout(() => {
    chatSidebarSearchDebounce = null;
    renderChatSidebar();
  }, 120);
});

projectCreateForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = projectNameInput.value.trim();
  if (!name) {
    projectState.textContent = "Project name required.";
    return;
  }
  const store = loadConsoleProjectStore();
  const project = buildProject({
    id: createProjectId(),
    name,
    color: PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length],
    metadata: {}
  });
  store.projects.push(project);
  store.currentProjectId = project.id;
  saveConsoleProjectStore(store);
  state.selectedProjectId = project.id;
  state.selectedProjectConversationId = null;
  projectNameInput.value = "";
  projectState.textContent = "Project created.";
  renderProjectsWorkspace();
});

scheduleForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createScheduleFromConsole();
});

// UCA-125 follow-up: page-head "+ New schedule" toggles the create
// panel. Close on × / Esc / successful submit so the list view stays
// uncluttered when browsing existing schedules.
(function initScheduleCreateToggle() {
  const newBtn = document.querySelector("#scheduleNewBtn");
  const panel = document.querySelector("#scheduleCreatePanel");
  const closeBtn = document.querySelector("#scheduleCreateCloseBtn");
  if (!newBtn || !panel) return;
  const setOpen = (open) => {
    if (open) {
      panel.removeAttribute("hidden");
      newBtn.setAttribute("aria-expanded", "true");
      document.querySelector("#scheduleWhenInput")?.focus();
    } else {
      panel.setAttribute("hidden", "");
      newBtn.setAttribute("aria-expanded", "false");
    }
  };
  newBtn.addEventListener("click", () => setOpen(panel.hasAttribute("hidden")));
  closeBtn?.addEventListener("click", () => setOpen(false));
  scheduleForm?.addEventListener("submit", () => {
    // Small delay so the user sees the "created" state before we close.
    setTimeout(() => setOpen(false), 400);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hasAttribute("hidden") && document.activeElement?.closest("#scheduleCreatePanel")) {
      setOpen(false);
    }
  });
})();

mcpServerRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
skillRegistryRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
codeCliAdapterRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
emailAccountRefreshBtn?.addEventListener("click", () => void refreshWorkspace());

// UCA-126: custom MCP server form lives in Connectors page now. Toggle
// its visibility from the "+ Add custom server" button; close on Cancel
// or Esc.
(function initMcpServerAddToggle() {
  const toggleBtn = document.querySelector("#mcpServerAddToggle");
  const wrap = document.querySelector("#mcpServerFormWrap");
  const cancelBtn = document.querySelector("#mcpServerCancelBtn");
  if (!toggleBtn || !wrap) return;
  const setOpen = (open) => {
    if (open) {
      wrap.removeAttribute("hidden");
      toggleBtn.setAttribute("aria-expanded", "true");
      document.querySelector("#mcpServerId")?.focus();
    } else {
      wrap.setAttribute("hidden", "");
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  };
  toggleBtn.addEventListener("click", () => setOpen(wrap.hasAttribute("hidden")));
  cancelBtn?.addEventListener("click", () => setOpen(false));
})();

function closeMcpServerFormSoon() {
  setTimeout(() => {
    document.querySelector("#mcpServerFormWrap")?.setAttribute("hidden", "");
    document.querySelector("#mcpServerAddToggle")?.setAttribute("aria-expanded", "false");
  }, 400);
}

function setPreflightState(el, kind, text) {
  if (!el) return;
  el.classList.remove("preflight-state--ok", "preflight-state--err", "preflight-state--pending");
  el.classList.add("preflight-state", `preflight-state--${kind}`);
  const label = kind === "ok" ? "OK" : kind === "err" ? "!" : "...";
  el.textContent = `${label} ${text}`;
}

const PREFLIGHT_FIELD_KEYS = {
  mcp: {
    id: "mcp-id",
    source: "mcp-source",
    packageDir: "mcp-packageDir",
    transport: "mcp-transport",
    command: "mcp-command",
    url: "mcp-command"
  },
  skill: {
    id: "skill-id",
    rootPath: "skill-rootPath"
  }
};

function normalizePreflightError(error) {
  if (!error || typeof error === "string") {
    return { field: null, message: error || "Invalid configuration." };
  }
  return {
    field: error.field ?? null,
    message: error.message ?? "Invalid configuration."
  };
}

function clearFieldErrors(formEl) {
  formEl?.querySelectorAll(".field-error").forEach((el) => el.remove());
}

function showFieldError(fieldKey, message) {
  const wrapper = document.querySelector(`[data-preflight-field="${fieldKey}"]`);
  if (!wrapper) return false;
  let errEl = wrapper.querySelector(".field-error");
  if (!errEl) {
    errEl = document.createElement("div");
    errEl.className = "field-error";
    wrapper.appendChild(errEl);
  }
  errEl.textContent = message;
  return true;
}

function showPreflightErrors({ formEl, kind, stateEl, errors, fallback }) {
  clearFieldErrors(formEl);
  const globalMessages = [];
  let fieldErrorCount = 0;
  for (const rawError of errors ?? []) {
    const error = normalizePreflightError(rawError);
    const fieldKey = PREFLIGHT_FIELD_KEYS[kind]?.[error.field];
    if (fieldKey && showFieldError(fieldKey, error.message)) {
      fieldErrorCount += 1;
      continue;
    }
    globalMessages.push(error.message);
  }
  if (fieldErrorCount > 0 && globalMessages.length === 0) {
    setPreflightState(stateEl, "err", "Invalid: fix highlighted fields.");
    return;
  }
  setPreflightState(stateEl, "err", `Invalid: ${globalMessages.join("; ") || fallback}`);
}

function buildMcpServerPayloadFromForm() {
  const id = mcpServerId.value.trim();
  const displayName = mcpServerName.value.trim();
  const transport = mcpTransport.value;
  const commandOrUrl = mcpCommand.value.trim();
  return {
    id,
    displayName: displayName || id,
    transport,
    command: transport === "stdio" ? commandOrUrl : null,
    args: transport === "stdio" ? mcpArgs.value.trim().split(/\s+/).filter(Boolean) : [],
    url: transport !== "stdio" ? commandOrUrl : null
  };
}

function formatMcpPreflightErrors(errors = []) {
  return errors.length
    ? errors.map((error) => normalizePreflightError(error).message).join("; ")
    : "Invalid MCP server config.";
}

async function preflightMcpServerConfig() {
  return fetchJson("/config/mcp/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMcpServerPayloadFromForm())
  });
}

async function planMcpInstallSource() {
  return fetchJson("/config/mcp/install/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: mcpInstallSource?.value?.trim() ?? "",
      id: mcpServerId?.value?.trim() ?? ""
    })
  });
}

async function runMcpInstallSource() {
  if (typeof window.ucaShell?.runMcpInstall !== "function") {
    throw new Error("Desktop install bridge unavailable.");
  }
  return window.ucaShell.runMcpInstall({
    source: mcpInstallSource?.value?.trim() ?? "",
    id: mcpServerId?.value?.trim() ?? ""
  });
}

async function previewMcpInstallCandidate() {
  if (typeof window.ucaShell?.previewMcpInstall !== "function") {
    throw new Error("Desktop preview bridge unavailable.");
  }
  return window.ucaShell.previewMcpInstall({
    packageDir: mcpInstallPackageDir?.value?.trim() ?? "",
    id: mcpServerId?.value?.trim() ?? ""
  });
}

function assertShellResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.message ?? result.error ?? fallback);
  }
  return result ?? {};
}

async function createSchedule(payload) {
  if (typeof window.ucaShell?.createSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.createSchedule(payload),
    "Could not create schedule."
  );
}

async function updateSchedule(scheduleId, patch) {
  if (typeof window.ucaShell?.updateSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.updateSchedule({ scheduleId, patch }),
    "Could not update schedule."
  );
}

async function deleteSchedule(scheduleId) {
  if (typeof window.ucaShell?.deleteSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteSchedule(scheduleId),
    "Could not delete schedule."
  );
}

async function runScheduleNow(scheduleId, triggerPayload = {}) {
  if (typeof window.ucaShell?.runSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.runSchedule({ scheduleId, triggerPayload }),
    "Could not run schedule."
  );
}

async function saveTemplateViaShell(template) {
  if (typeof window.ucaShell?.saveTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveTemplate({ template }),
    "Could not save template."
  );
}

async function importTemplateViaShell(raw) {
  if (typeof window.ucaShell?.importTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.importTemplate({ raw }),
    "Could not import template."
  );
}

async function deleteTemplateViaShell(templateId) {
  if (typeof window.ucaShell?.deleteTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteTemplate(templateId),
    "Could not delete template."
  );
}

async function resumeDagExecutionViaShell(executionId) {
  if (typeof window.ucaShell?.resumeDagExecution !== "function") {
    throw new Error("Desktop DAG bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.resumeDagExecution(executionId),
    "Could not resume DAG execution."
  );
}

async function saveProviderViaShell(provider) {
  if (typeof window.ucaShell?.saveProvider !== "function") {
    throw new Error("Desktop provider config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveProvider(provider),
    "Could not save provider."
  );
}

async function deleteProviderViaShell(providerId) {
  if (typeof window.ucaShell?.deleteProvider !== "function") {
    throw new Error("Desktop provider config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteProvider(providerId),
    "Could not delete provider."
  );
}

async function saveCodeCliAdapterViaShell(adapter) {
  if (typeof window.ucaShell?.saveCodeCliAdapter !== "function") {
    throw new Error("Desktop Code CLI adapter bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveCodeCliAdapter(adapter),
    "Could not save Code CLI adapter."
  );
}

async function deleteCodeCliAdapterViaShell(adapterId) {
  if (typeof window.ucaShell?.deleteCodeCliAdapter !== "function") {
    throw new Error("Desktop Code CLI adapter bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteCodeCliAdapter(adapterId),
    "Could not delete Code CLI adapter."
  );
}

async function saveSkillRegistryViaShell(registry) {
  if (typeof window.ucaShell?.saveSkillRegistry !== "function") {
    throw new Error("Desktop skill registry bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveSkillRegistry(registry),
    "Could not save skill registry."
  );
}

async function deleteSkillRegistryViaShell(registryId) {
  if (typeof window.ucaShell?.deleteSkillRegistry !== "function") {
    throw new Error("Desktop skill registry bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteSkillRegistry(registryId),
    "Could not delete skill registry."
  );
}

async function writeSkillMarkdownViaShell(entryPath, markdown) {
  if (typeof window.ucaShell?.writeSkillMarkdown !== "function") {
    throw new Error("Desktop skill editor bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.writeSkillMarkdown({ entryPath, markdown }),
    "Could not save skill markdown."
  );
}

async function updateRoutingConfigViaShell(routing) {
  if (typeof window.ucaShell?.updateRoutingConfig !== "function") {
    throw new Error("Desktop routing config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.updateRoutingConfig(routing),
    "Could not save routing config."
  );
}

async function updateOutputConfigViaShell(output) {
  if (typeof window.ucaShell?.updateOutputConfig !== "function") {
    throw new Error("Desktop output config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.updateOutputConfig(output),
    "Could not save output config."
  );
}

async function updateFeatureConfigViaShell(features) {
  if (typeof window.ucaShell?.updateFeatureConfig !== "function") {
    throw new Error("Desktop feature config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.updateFeatureConfig(features),
    "Could not save feature config."
  );
}

async function updateEmailSettingsViaShell(settings) {
  if (typeof window.ucaShell?.updateEmailSettings !== "function") {
    throw new Error("Desktop email settings bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.updateEmailSettings(settings),
    "Could not save email settings."
  );
}

async function saveEmailAccountViaShell(account) {
  if (typeof window.ucaShell?.saveEmailAccount !== "function") {
    throw new Error("Desktop email account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveEmailAccount(account),
    "Could not save email account."
  );
}

async function deleteEmailAccountViaShell(accountId) {
  if (typeof window.ucaShell?.deleteEmailAccount !== "function") {
    throw new Error("Desktop email account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteEmailAccount(accountId),
    "Could not delete email account."
  );
}

async function checkEmailDigestViaShell(payload = {}) {
  if (typeof window.ucaShell?.checkEmailDigest !== "function") {
    throw new Error("Desktop email digest bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.checkEmailDigest(payload),
    "Could not run email digest check."
  );
}

async function saveNotesViaShell(notes) {
  if (typeof window.ucaShell?.saveNotes !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveNotes(notes),
    "Could not save notes."
  );
}

async function upsertNoteViaShell(note) {
  if (typeof window.ucaShell?.upsertNote !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.upsertNote(note),
    "Could not save note."
  );
}

async function deleteNoteViaShell(noteId) {
  if (typeof window.ucaShell?.deleteNote !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteNote(noteId),
    "Could not delete note."
  );
}

async function appendNoteChipViaShell(payload) {
  if (typeof window.ucaShell?.appendNoteChip !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.appendNoteChip(payload),
    "Could not append note chip."
  );
}

async function saveProjectStoreViaShell(store) {
  if (typeof window.ucaShell?.saveProjectStore !== "function") {
    throw new Error("Desktop project store bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveProjectStore(store),
    "Could not save project store."
  );
}

async function clearPreviewCacheViaShell() {
  if (typeof window.ucaShell?.clearPreviewCache !== "function") {
    throw new Error("Desktop preview cache bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.clearPreviewCache(),
    "Could not clear preview cache."
  );
}

async function setupOfficeAddinsViaShell(payload) {
  if (typeof window.ucaShell?.setupOfficeAddins !== "function") {
    throw new Error("Desktop Office add-in setup bridge unavailable.");
  }
  const result = await window.ucaShell.setupOfficeAddins(payload ?? {});
  if (result?.ok === false && result?.error) {
    throw new Error(result.message ?? result.error ?? "Could not configure Office add-ins.");
  }
  return result ?? {};
}

async function renameConnectedAccountViaShell(accountId, displayName) {
  if (typeof window.ucaShell?.renameConnectedAccount !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.renameConnectedAccount(accountId, displayName),
    "Could not rename connected account."
  );
}

async function setConnectedAccountDefaultViaShell(accountId, purpose) {
  if (typeof window.ucaShell?.setConnectedAccountDefault !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.setConnectedAccountDefault(accountId, purpose),
    "Could not update connected account default."
  );
}

async function disconnectConnectedAccountViaShell(accountId) {
  if (typeof window.ucaShell?.disconnectConnectedAccount !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.disconnectConnectedAccount(accountId),
    "Could not disconnect connected account."
  );
}

async function disconnectConnectorAccountViaShell(type) {
  if (typeof window.ucaShell?.disconnectConnectorAccount !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.disconnectConnectorAccount(type),
    "Could not disconnect connector account."
  );
}

async function saveConnectorAccountConfigViaShell(type, config) {
  if (typeof window.ucaShell?.saveConnectorAccountConfig !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveConnectorAccountConfig(type, config),
    "Could not save connector account config."
  );
}

async function cancelTaskViaShell(taskId, options = {}) {
  if (typeof window.ucaShell?.cancelTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.cancelTask(taskId, { force: options.force === true }),
    "Could not cancel task."
  );
}

async function retryTaskViaShell(taskId, options = {}) {
  if (typeof window.ucaShell?.retryTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.retryTask(taskId, options),
    "Could not retry task."
  );
}

async function deleteTaskViaShell(taskId) {
  if (typeof window.ucaShell?.deleteTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteTask(taskId),
    "Could not delete task."
  );
}

async function saveMcpServer(server) {
  if (typeof window.ucaShell?.saveMcpServer !== "function") {
    throw new Error("Desktop MCP config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveMcpServer(server),
    "Could not save MCP server."
  );
}

async function deleteMcpServer(id) {
  if (typeof window.ucaShell?.deleteMcpServer !== "function") {
    throw new Error("Desktop MCP config bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.deleteMcpServer(id),
    "Could not delete MCP server."
  );
}

async function toggleMcpServer(id, enabled) {
  if (typeof window.ucaShell?.toggleMcpServer !== "function") {
    throw new Error("Desktop MCP runtime bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.toggleMcpServer({ id, enabled }),
    "Could not update MCP server."
  );
}

async function saveMcpServerConfig({ id, key, value }) {
  if (typeof window.ucaShell?.saveMcpServerConfig !== "function") {
    throw new Error("Desktop MCP runtime bridge unavailable.");
  }
  return assertShellResult(
    await window.ucaShell.saveMcpServerConfig({ id, key, value }),
    "Could not save MCP server config."
  );
}

function applyMcpInstallPreviewToForm(result = {}, { label = "Preview ready" } = {}) {
  const server = result.server ?? {};
  const transport = server.transport ?? "stdio";
  mcpServerId.value = server.id ?? "";
  mcpServerName.value = server.displayName ?? server.id ?? "";
  mcpTransport.value = transport;
  mcpCommand.value = transport === "stdio" ? (server.command ?? "") : (server.url ?? "");
  mcpArgs.value = Array.isArray(server.args) ? server.args.join(" ") : "";
  if (mcpInstallPreviewSummary) {
    const source = result.source ? `source: ${result.source}` : "source: unknown";
    const argsSource = result.detection?.sourceOfArgs ? `args: ${result.detection.sourceOfArgs}` : "args: review";
    mcpInstallPreviewSummary.textContent = `${label} (${source}; ${argsSource}). Review fields before saving.`;
    mcpInstallPreviewSummary.hidden = false;
  }
}

function applyMcpInstallPlanToForm(result = {}) {
  if (mcpInstallPackageDir && result.packageDir) {
    mcpInstallPackageDir.value = result.packageDir;
  }
  if (mcpInstallPlanSummary) {
    const source = result.sourceType ? `source: ${result.sourceType}` : "source: planned";
    const scripts = result.allowScripts ? "package scripts allowed" : "package scripts disabled";
    mcpInstallPlanSummary.textContent = `Plan ready (${source}; ${scripts}). Package directory copied below; install is not executed here.`;
    mcpInstallPlanSummary.hidden = false;
  }
}

mcpInstallPlanBtn?.addEventListener("click", async () => {
  clearFieldErrors(mcpServerForm);
  if (mcpInstallPlanSummary) {
    mcpInstallPlanSummary.hidden = true;
    mcpInstallPlanSummary.textContent = "";
  }
  setPreflightState(mcpInstallPlanState, "pending", "Planning...");
  try {
    const result = await planMcpInstallSource();
    if (!result.ok) {
      showPreflightErrors({
        formEl: mcpServerForm,
        kind: "mcp",
        stateEl: mcpInstallPlanState,
        errors: result.errors,
        fallback: "Could not build an MCP install plan."
      });
      return;
    }
    applyMcpInstallPlanToForm(result);
    setPreflightState(mcpInstallPlanState, "ok", "Plan ready. Install is not executed here.");
  } catch (error) {
    setPreflightState(mcpInstallPlanState, "err", `Failed: ${error.message}`);
  }
});

mcpInstallRunBtn?.addEventListener("click", async () => {
  clearFieldErrors(mcpServerForm);
  if (mcpInstallPreviewSummary) {
    mcpInstallPreviewSummary.hidden = true;
    mcpInstallPreviewSummary.textContent = "";
  }
  setPreflightState(mcpInstallRunState, "pending", "Installing...");
  mcpInstallRunBtn.disabled = true;
  try {
    const result = await runMcpInstallSource();
    if (!result.ok) {
      showPreflightErrors({
        formEl: mcpServerForm,
        kind: "mcp",
        stateEl: mcpInstallRunState,
        errors: result.errors,
        fallback: result.message ?? result.error ?? "Could not install this MCP package."
      });
      return;
    }
    if (mcpInstallPackageDir && result.packageDir) {
      mcpInstallPackageDir.value = result.packageDir;
    }
    applyMcpInstallPreviewToForm(result, { label: "Installed package detected" });
    setPreflightState(mcpInstallRunState, "ok", "Installed. Review fields before saving.");
  } catch (error) {
    setPreflightState(mcpInstallRunState, "err", `Failed: ${error.message}`);
  } finally {
    mcpInstallRunBtn.disabled = false;
  }
});

mcpInstallPreviewBtn?.addEventListener("click", async () => {
  clearFieldErrors(mcpServerForm);
  if (mcpInstallPreviewSummary) {
    mcpInstallPreviewSummary.hidden = true;
    mcpInstallPreviewSummary.textContent = "";
  }
  setPreflightState(mcpInstallPreviewState, "pending", "Previewing...");
  try {
    const result = await previewMcpInstallCandidate();
    if (!result.ok) {
      showPreflightErrors({
        formEl: mcpServerForm,
        kind: "mcp",
        stateEl: mcpInstallPreviewState,
        errors: result.errors,
        fallback: "Could not detect an MCP server from this package."
      });
      return;
    }
    applyMcpInstallPreviewToForm(result);
    setPreflightState(mcpInstallPreviewState, "ok", "Preview ready. Review fields before saving.");
  } catch (error) {
    setPreflightState(mcpInstallPreviewState, "err", `Failed: ${error.message}`);
  }
});

mcpServerTestBtn?.addEventListener("click", async () => {
  clearFieldErrors(mcpServerForm);
  setPreflightState(mcpServerState, "pending", "Testing...");
  try {
    const result = await preflightMcpServerConfig();
    if (!result.ok) {
      showPreflightErrors({
        formEl: mcpServerForm,
        kind: "mcp",
        stateEl: mcpServerState,
        errors: result.errors,
        fallback: formatMcpPreflightErrors(result.errors)
      });
      return;
    }
    setPreflightState(mcpServerState, "ok", "Valid configuration. Actual startup tested when MCP first starts.");
  } catch (error) {
    setPreflightState(mcpServerState, "err", `Failed: ${error.message}`);
  }
});

mcpServerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors(mcpServerForm);
  setPreflightState(mcpServerState, "pending", "Testing...");
  try {
    const result = await preflightMcpServerConfig();
    if (!result.ok) {
      showPreflightErrors({
        formEl: mcpServerForm,
        kind: "mcp",
        stateEl: mcpServerState,
        errors: result.errors,
        fallback: formatMcpPreflightErrors(result.errors)
      });
      return;
    }
    setPreflightState(mcpServerState, "pending", "Saving...");
    await saveMcpServer(result.server);
    setPreflightState(mcpServerState, "ok", "Saved.");
    mcpServerId.value = "";
    mcpServerName.value = "";
    mcpCommand.value = "";
    mcpArgs.value = "";
    if (mcpInstallSource) mcpInstallSource.value = "";
    if (mcpInstallPlanSummary) {
      mcpInstallPlanSummary.hidden = true;
      mcpInstallPlanSummary.textContent = "";
    }
    if (mcpInstallRunState) {
      mcpInstallRunState.textContent = "";
      mcpInstallRunState.classList.remove("preflight-state--ok", "preflight-state--err", "preflight-state--pending");
    }
    if (mcpInstallPackageDir) mcpInstallPackageDir.value = "";
    if (mcpInstallPreviewSummary) {
      mcpInstallPreviewSummary.hidden = true;
      mcpInstallPreviewSummary.textContent = "";
    }
    await refreshWorkspace();
    closeMcpServerFormSoon();
  } catch (error) {
    setPreflightState(mcpServerState, "err", `Failed: ${error.message}`);
  }
});

function buildSkillRegistryPayloadFromForm() {
  const id = skillRegistryId.value.trim();
  const displayName = skillRegistryName.value.trim();
  const rootPath = skillRegistryPath.value.trim();
  return {
    id,
    displayName: displayName || id,
    rootPath
  };
}

function formatSkillPreflightErrors(errors = []) {
  return errors.length
    ? errors.map((error) => normalizePreflightError(error).message).join("; ")
    : "Invalid skill registry.";
}

async function preflightSkillRegistryConfig() {
  return fetchJson("/config/skills/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSkillRegistryPayloadFromForm())
  });
}

skillRegistryTestBtn?.addEventListener("click", async () => {
  clearFieldErrors(skillRegistryForm);
  setPreflightState(skillRegistryState, "pending", "Testing...");
  try {
    const result = await preflightSkillRegistryConfig();
    if (!result.ok) {
      showPreflightErrors({
        formEl: skillRegistryForm,
        kind: "skill",
        stateEl: skillRegistryState,
        errors: result.errors,
        fallback: formatSkillPreflightErrors(result.errors)
      });
      return;
    }
    setPreflightState(skillRegistryState, "ok", `Valid. ${result.skillCount ?? 0} skill(s) found at this path.`);
  } catch (error) {
    setPreflightState(skillRegistryState, "err", `Failed: ${error.message}`);
  }
});

skillRegistryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors(skillRegistryForm);
  setPreflightState(skillRegistryState, "pending", "Testing...");
  try {
    const result = await preflightSkillRegistryConfig();
    if (!result.ok) {
      showPreflightErrors({
        formEl: skillRegistryForm,
        kind: "skill",
        stateEl: skillRegistryState,
        errors: result.errors,
        fallback: formatSkillPreflightErrors(result.errors)
      });
      return;
    }
    setPreflightState(skillRegistryState, "pending", "Saving...");
    await saveSkillRegistryViaShell(result.registry);
    setPreflightState(skillRegistryState, "ok", "Saved.");
    skillRegistryId.value = "";
    skillRegistryName.value = "";
    skillRegistryPath.value = "";
    await refreshWorkspace();
  } catch (error) {
    setPreflightState(skillRegistryState, "err", `Failed: ${error.message}`);
  }
});

skillEditCloseBtn?.addEventListener("click", closeSkillEditor);
skillEditModal?.addEventListener("click", (event) => {
  if (event.target === skillEditModal) closeSkillEditor();
});
skillEditSaveBtn?.addEventListener("click", async () => {
  if (!editingSkillPath || !skillEditText) return;
  skillEditState.textContent = "Saving...";
  try {
    await writeSkillMarkdownViaShell(editingSkillPath, skillEditText.value);
    skillEditState.textContent = "Saved.";
    await refreshWorkspace();
  } catch (error) {
    skillEditState.textContent = `Failed: ${error.message}`;
  }
});

codeCliAdapterForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = codeCliAdapterId.value.trim();
  const displayName = codeCliAdapterName.value.trim();
  const command = codeCliAdapterCommand.value.trim();
  if (!id || !command) {
    codeCliAdapterState.textContent = "ID and command required.";
    return;
  }
  const args = codeCliAdapterArgs.value.trim()
    ? codeCliAdapterArgs.value.trim().split(/\s+/).filter(Boolean)
    : [];
  const mcpFiles = codeCliAdapterMcpFiles.value.trim()
    ? codeCliAdapterMcpFiles.value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const payload = {
    id,
    displayName: displayName || id,
    command,
    args,
    transport: codeCliAdapterTransport.value,
    defaultModel: codeCliAdapterModel.value.trim(),
    mcpConfigFiles: mcpFiles
  };
  codeCliAdapterState.textContent = "Saving...";
  try {
    await saveCodeCliAdapterViaShell(payload);
    codeCliAdapterState.textContent = "Saved.";
    codeCliAdapterId.value = "";
    codeCliAdapterName.value = "";
    codeCliAdapterCommand.value = "";
    codeCliAdapterModel.value = "";
    codeCliAdapterArgs.value = "";
    codeCliAdapterMcpFiles.value = "";
    await refreshWorkspace();
  } catch (error) {
    codeCliAdapterState.textContent = `Failed: ${error.message}`;
  }
});

emailAccountForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = emailAccountId.value.trim();
  const email = emailAccountEmail.value.trim();
  if (!id || !email) {
    emailAccountState.textContent = "ID and email required.";
    return;
  }
  const payload = {
    id,
    email,
    displayName: emailAccountName.value.trim() || email,
    provider: emailAccountProvider.value,
    authType: emailAccountAuthType.value,
    imapHost: emailAccountHost.value.trim(),
    imapPort: emailAccountPort.value.trim() ? Number(emailAccountPort.value.trim()) : 993,
    credentials: emailAccountSecret.value.trim()
      ? { secret: emailAccountSecret.value.trim() }
      : null
  };
  emailAccountState.textContent = "Saving...";
  try {
    await saveEmailAccountViaShell(payload);
    emailAccountState.textContent = "Saved.";
    emailAccountId.value = "";
    emailAccountEmail.value = "";
    emailAccountName.value = "";
    emailAccountHost.value = "";
    emailAccountPort.value = "";
    emailAccountSecret.value = "";
    await refreshWorkspace();
  } catch (error) {
    emailAccountState.textContent = `Failed: ${error.message}`;
  }
});

emailDigestSaveBtn?.addEventListener("click", async () => {
  const windowStart = emailDigestWindowStart.value || "06:00";
  const windowEnd = emailDigestWindowEnd.value || "12:00";
  const payload = {
    enabled: emailDigestEnabled.checked,
    windowStart,
    windowEnd,
    skipWeekends: emailDigestSkipWeekends.checked
  };
  emailDigestState.textContent = "Saving...";
  try {
    const result = await updateEmailSettingsViaShell(payload);
    state.workspace.emailDigestSettings = result.settings ?? payload;
    if (state.workspace.health?.config?.features) {
      state.workspace.health.config.features.morning_digest = { enabled: payload.enabled };
    }
    emailDigestState.textContent = "Saved.";
    renderEmailDigestSettings();
    renderFeatureToggles();
  } catch (error) {
    emailDigestState.textContent = `Failed: ${error.message}`;
  }
});

// DAG editor retired from the UI (UCA-126); wiring stays null-safe so the
// backend APIs (/dag/preview, /dag/execute/:id/resume) remain reachable
// from scripts or future surfaces without crashing when the DOM is absent.
previewDagButton?.addEventListener("click", async () => {
  const raw = dagEditorInput?.value.trim() ?? "";
  if (!raw) { if (dagPreview) dagPreview.textContent = "Enter DAG JSON first."; return; }
  if (dagPreview) dagPreview.textContent = "Validating...";
  try {
    const graph = JSON.parse(raw);
    const result = await fetchJson("/dag/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph }) });
    if (dagPreview) dagPreview.textContent = JSON.stringify(result.validation ?? result, null, 2);
  } catch (error) {
    if (dagPreview) dagPreview.textContent = `Failed: ${error.message}`;
  }
});

loadSampleDagButton?.addEventListener("click", () => {
  if (dagEditorInput) dagEditorInput.value = JSON.stringify(buildSampleDag(), null, 2);
  if (dagPreview) dagPreview.textContent = "Sample DAG loaded.";
});

killSwitchToggle.addEventListener("change", async () => await updateSecurityConfig({ global_kill_switch: killSwitchToggle.checked }, "Kill switch"));
offlineModeToggle.addEventListener("change", async () => await updateSecurityConfig({ offline_mode: offlineModeToggle.checked }, "Offline mode"));
presenterModeToggle.addEventListener("change", async () => await updateSecurityConfig({ presenter_mode: presenterModeToggle.checked }, "Presenter mode"));

// load custom providers + task routing on startup
loadProvidersAndRouting();

window.ucaShell.onShortcutTriggered((payload) => {
  submitState.textContent = `Shortcut: ${payload.shortcutId}`;
});

window.ucaShell.onShellReady(() => void refreshWorkspace());

window.ucaShell?.onPopupCardResolved?.((payload) => {
  if (payload?.kind === "approval") {
    void refreshWorkspace();
  }
});

window.ucaShell.onWindowFocused((payload) => {
  if (payload.windowId === "console") void refreshWorkspace();
});

checkOfficeAddinsButton?.addEventListener("click", () => {
  void refreshOfficeAddinSetupStatus();
});

setupOfficeAddinsButton?.addEventListener("click", () => {
  void configureOfficeAddins();
});

if (dagEditorInput) dagEditorInput.value = JSON.stringify(buildSampleDag(), null, 2);
void refreshWorkspace();
void refreshOfficeAddinSetupStatus();
// Phase 2: hydrate the chat sidebar at startup so a user who opens
// directly into Chat tab (saved view) doesn't see "no conversations
// yet" placeholder while their actual list loads in the background.
void refreshChatSidebar();
setInterval(() => void refreshWorkspace(), 6000);
// Refresh sidebar periodically too — picks up conversations created
// in the overlay while console is open. Cheap (just hits /conversations
// and re-renders if the cache changed).
setInterval(() => void refreshChatSidebar({ force: true }), 30_000);

// Promote chat-bubble timestamps from "刚刚" → "1 分钟前" → … without
// re-rendering the message. Cheap; only walks visible <time> nodes.
function refreshChatTimestamps() {
  if (!consoleChatMessages) return;
  for (const el of consoleChatMessages.querySelectorAll(".chat-msg-time[data-ts]")) {
    const ts = Number(el.dataset.ts);
    if (!Number.isFinite(ts)) continue;
    const next = formatRelativeTime(ts);
    if (el.textContent !== next) el.textContent = next;
  }
}
setInterval(refreshChatTimestamps, 30_000);

/* ═══════════════════════════════════════════════
   UCA-070: CONNECTORS TAB
   ═══════════════════════════════════════════════ */

const connEmailList = document.querySelector("#connEmailList");
const connEmailState = document.querySelector("#connEmailState");
const connDigestEnabled = document.querySelector("#connDigestEnabled");
const connDigestTestBtn = document.querySelector("#connDigestTestBtn");
const connDigestTestState = document.querySelector("#connDigestTestState");
const connectorsMcpList = document.querySelector("#connectorsMcpList");
const connectorsMcpRefreshBtn = document.querySelector("#connectorsMcpRefreshBtn");

const EMAIL_PROVIDER_META = {
  gmail:   { cls: "gmail",   glyph: "G",   tag: "Gmail" },
  outlook: { cls: "outlook", glyph: "O",   tag: "Outlook" },
  graph:   { cls: "outlook", glyph: "O",   tag: "Graph" },
  qq:      { cls: "qq",      glyph: "Q",   tag: "QQ" },
  "163":   { cls: "imap",    glyph: "163", tag: "163" },
  imap:    { cls: "imap",    glyph: "✉",   tag: "IMAP" }
};

function renderConnEmailAccounts(accounts) {
  if (!connEmailList) return;
  connEmailList.className = "conn-grid conn-grid--compact";
  // v3 spec: compact 4-column cards. Header = logo + name/email + toggle.
  // Footer = synced pill + unread count (or auth-expired + Re-auth).
  // The "+ Add IMAP" tile is always the trailing card so users see it
  // as part of the grid rather than hunting for a separate button.
  const list = accounts ?? [];
  const cards = list.map((acc) => {
    const meta = EMAIL_PROVIDER_META[acc.provider] ?? EMAIL_PROVIDER_META.imap;
    const name = escapeHtml(acc.displayName ?? `${meta.tag} · ${acc.email ?? acc.id}`);
    const email = escapeHtml(acc.email ?? "");
    const statusOk = acc.status !== "auth_expired";
    const statusPill = statusOk
      ? `<span class="pill pill-ok">synced</span>`
      : `<span class="pill pill-warn">auth expired</span>`;
    const trailing = statusOk
      ? (Number.isFinite(acc.unreadCount) ? `<span class="muted">${acc.unreadCount} unread</span>` : "")
      : `<button class="btn btn-sm btn-ghost" data-email-reauth="${escapeHtml(acc.id)}">Re-auth</button>`;
    return `
      <div class="conn-card">
        <div class="conn-card-head">
          <div class="conn-logo ${meta.cls}">${meta.glyph}</div>
          <div class="conn-info">
            <div class="conn-name">${name}</div>
            <div class="conn-desc">${email}</div>
          </div>
          <label class="toggle" title="Enable inbox">
            <input type="checkbox" ${acc.enabled !== false ? "checked" : ""} data-email-enable="${escapeHtml(acc.id)}">
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="conn-foot">
          ${statusPill}
          <span class="conn-foot-trailing">${trailing || ""}</span>
        </div>
        <button class="conn-card-remove" type="button" data-delete-email="${escapeHtml(acc.id)}" title="Remove" aria-label="Remove account">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  });
  // "+ Add IMAP" tile — opens the Browse catalog drawer scoped to email.
  cards.push(`
    <button class="conn-card conn-card--add" type="button" id="connEmailAddTile">
      <div class="conn-card-head">
        <div class="conn-logo imap">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
        </div>
        <div class="conn-info">
          <div class="conn-name">+ Add inbox</div>
          <div class="conn-desc">Gmail · Outlook · QQ · 163 · IMAP</div>
        </div>
      </div>
      <div class="conn-foot"><span class="muted">Configure…</span></div>
    </button>
  `);
  connEmailList.innerHTML = cards.join("");
  connEmailList.querySelector("#connEmailAddTile")?.addEventListener("click", () => {
    document.querySelector("#connBrowseBtn")?.click();
    // Preselect the "email" filter chip if present.
    document.querySelector('[data-conn-cat="email"]')?.click();
  });
  connEmailList.querySelectorAll("[data-delete-email]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.deleteEmail;
      try {
        await deleteEmailAccountViaShell(id);
        await loadConnectorsTab();
      } catch (err) {
        if (connEmailState) connEmailState.textContent = `Error: ${err.message}`;
      }
    });
  });
}

const MCP_SERVER_META = {
  "mcp-filesystem": { title: "Filesystem", desc: "Read and write files in allowed local directories.", logoClass: "fs" },
  "mcp-memory":     { title: "Memory", desc: "Persistent graph memory for agentic tasks.", logoClass: "mem" },
  "mcp-brave-search": { title: "Brave Search", desc: "Web search through Brave Search API.", configKey: "BRAVE_API_KEY", configLabel: "Brave API Key", configPlaceholder: "BSA...", logoClass: "brave" },
  "mcp-puppeteer":  { title: "Browser Automation", desc: "Puppeteer-powered browser actions for agentic workflows.", logoClass: "browser" },
  "local-fs":       { title: "Legacy Local FS", desc: "Deprecated. Use Filesystem instead.", logoClass: "imap" },
  "figma":          { title: "Figma", desc: "Design context through an external Figma MCP plugin.", guideUrl: "https://www.figma.com/", logoClass: "figma" }
};

// UCA-125 follow-up: SVG badge glyphs for MCP logos (conn-logo uses a
// square tile; these fill it with a recognisable icon instead of a blank).
const MCP_LOGO_SVG = {
  fs:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/></svg>`,
  mem:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/><path d="M12 7v5l3 2"/></svg>`,
  brave:   `B`,
  browser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>`,
  figma:   `F`,
  github:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12a12 12 0 0 0 8.2 11.38c.6.11.82-.26.82-.58v-2.15C5.66 21.3 5 19 5 19c-.55-1.38-1.33-1.75-1.33-1.75-1.08-.74.08-.72.08-.72 1.2.08 1.84 1.23 1.84 1.23 1.07 1.82 2.8 1.3 3.49.99.1-.77.42-1.3.76-1.6-2.67-.3-5.48-1.33-5.48-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0 0 24 12c0-6.63-5.37-12-12-12Z"/></svg>`,
  slack:   `#`,
  imap:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/></svg>`
};

const EXTRA_PLUGIN_OPTIONS = [
  { id: "github", title: "GitHub", desc: "Repository issues, pull requests, and code search.", status: "Coming soon", logoClass: "github" },
  { id: "notion", title: "Notion", desc: "Pages, databases, and workspace notes.", status: "Coming soon", logoClass: "mem" },
  { id: "slack", title: "Slack", desc: "Channel messages and team workflow actions.", status: "Coming soon", logoClass: "slack" },
  { id: "gdrive", title: "Google Drive", desc: "Docs and Drive file context.", status: "Coming soon", logoClass: "fs" }
];

function getMcpStatusView(server) {
  if (server.detail === "legacy_stub_use_mcp_filesystem") {
    return { label: "已弃用", className: "muted" };
  }
  if (server.detail === "external_plugin_required") {
    return { label: "需插件", className: "muted" };
  }
  if (server.available && server.enabled) {
    return { label: "运行中", className: "ready" };
  }
  if (server.detail === "disabled" || (server.configured && !server.enabled)) {
    return { label: "可安装", className: "muted" };
  }
  if (!server.available) {
    return { label: "未安装", className: "error" };
  }
  return { label: "已关闭", className: "" };
}

function renderConnectorsMcpServers(servers) {
  if (!connectorsMcpList) return;
  connectorsMcpList.innerHTML = "";

  // UCA-126: v3 MCP card layout —
  //   ┌─────────────────────────────────────────┐
  //   │ [logo] name         ●         [toggle]  │
  //   │ one-line description                    │
  //   │ ─────────────────────────────────────── │
  //   │ transport · command args  (mono)        │
  //   └─────────────────────────────────────────┘
  // Toggle switch replaces the Install/Disable button; transport info
  // moves to the bottom as compact mono-font meta. Configure / Guide
  // live in a hover-revealed action row to keep the card quiet at rest.
  for (const s of servers ?? []) {
    const meta = MCP_SERVER_META[s.id] ?? { title: s.displayName ?? s.id, desc: s.id, logoClass: "imap" };
    const sourceView = getMcpSourceView(s);
    const status = getMcpStatusView(s);
    const statusLabel = sourceView.readOnly ? sourceView.label : status.label;
    const statusClass = sourceView.readOnly ? sourceView.className : status.className;
    const hasCfg = !!meta.configKey;
    const needsConfig = hasCfg && !s.enabled;
    const canInstall = Boolean(s.configured || s.available || needsConfig);
    const installed = s.available && s.enabled;
    const cardId = `mcp-card-${s.id}`;
    const logoClass = meta.logoClass ?? "imap";
    const logoGlyph = MCP_LOGO_SVG[logoClass] ?? "?";
    const transportLine = s.transport
      ? `${s.transport}${s.command ? ` · ${s.command}` : ""}${s.url ? ` · ${s.url}` : ""}${Array.isArray(s.args) && s.args.length ? " " + s.args.join(" ") : ""}`
      : "";

    const card = document.createElement("div");
    card.className = `mcp-card mcp-card--v3 ${canInstall ? "" : "unavailable"}`;
    card.id = cardId;
    const configBtn = hasCfg ? `<button class="btn btn-sm btn-ghost" data-mcp-config="${escapeHtml(s.id)}">${needsConfig ? "Configure" : "Configure"}</button>` : "";
    const guideBtn = meta.guideUrl ? `<button class="btn btn-sm btn-ghost" data-plugin-guide="${escapeHtml(meta.guideUrl)}">Guide</button>` : "";
    const needsConfigBadge = needsConfig ? `<span class="pill pill-warn mcp-needs-config">需配置</span>` : "";
    // Headline action: when not yet installed, render an explicit
    // "安装" button instead of (only) a toggle. The toggle was being
    // misread as a "settings switch" — users didn't realise flipping
    // it was the install action. The primary button is the
    // unambiguous affordance; the toggle still appears for already-
    // installed servers as the on/off control.
    const headlineAction = sourceView.readOnly
      ? `<span class="pill pill-neutral" title="${escapeHtml(sourceView.tooltip)}">${escapeHtml(statusLabel)}</span>`
      : installed
      ? `<label class="toggle" title="禁用">
           <input type="checkbox" checked data-mcp-install="${escapeHtml(s.id)}" data-mcp-enabled="false">
           <span class="toggle-track"></span>
         </label>`
      : canInstall
        ? `<button class="btn btn-sm btn-primary mcp-install-btn"
                   data-mcp-install-click="${escapeHtml(s.id)}"
                   title="${needsConfig ? "需要先配置凭据" : "安装并启用此 MCP 服务"}">
             ${needsConfig ? "配置并安装" : "安装"}
           </button>`
        : `<span class="pill pill-neutral" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>`;
    card.innerHTML = `
      <div class="mcp-card-head">
        <div class="conn-logo ${logoClass} mcp-card-logo">${logoGlyph}</div>
        <div class="mcp-card-info">
          <div class="mcp-name">${escapeHtml(meta.title ?? s.displayName ?? s.id)}</div>
          <div class="mcp-card-desc">${escapeHtml(meta.desc ?? "")}</div>
        </div>
        <span class="mcp-status-dot ${statusClass}" title="${statusLabel}"></span>
        ${headlineAction}
      </div>
      ${transportLine ? `<div class="mcp-transport">${escapeHtml(transportLine)}</div>` : ""}
      ${(hasCfg || meta.guideUrl || needsConfigBadge) ? `
      <div class="mcp-card-actions">
        ${needsConfigBadge}
        <div style="flex:1;"></div>
        ${guideBtn}${configBtn}
      </div>` : ""}
      ${hasCfg ? `
      <div class="mcp-server-config" id="mcp-cfg-${s.id}">
        <label style="font-size:12px;font-weight:500;">${meta.configLabel}</label>
        <div class="mcp-cfg-row">
          <input type="password" id="mcp-cfg-val-${s.id}" placeholder="${meta.configPlaceholder ?? ''}" class="mcp-cfg-input">
          <button class="btn btn-sm" data-mcp-cfg-save="${s.id}">保存</button>
        </div>
        <div class="mcp-cfg-state" id="mcp-cfg-state-${s.id}"></div>
      </div>` : ""}
    `;
    connectorsMcpList.appendChild(card);
  }

  for (const option of EXTRA_PLUGIN_OPTIONS) {
    const logoClass = option.logoClass ?? "imap";
    const logoGlyph = MCP_LOGO_SVG[logoClass] ?? "?";
    const card = document.createElement("div");
    card.className = "mcp-card mcp-card--v3 unavailable";
    card.innerHTML = `
      <div class="mcp-card-head">
        <div class="conn-logo ${logoClass} mcp-card-logo">${logoGlyph}</div>
        <div class="mcp-card-info">
          <div class="mcp-name">${escapeHtml(option.title)}</div>
          <div class="mcp-card-desc">${escapeHtml(option.desc)}</div>
        </div>
        <span class="pill pill-neutral">${escapeHtml(option.status)}</span>
      </div>
    `;
    connectorsMcpList.appendChild(card);
  }

  // UCA-126: toggle switch replaces the Install/Disable button. Clicking
  // checkbox fires "change"; if the server needs configuration first we
  // open the config panel instead of flipping the API.
  connectorsMcpList.querySelectorAll("[data-mcp-install]").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.dataset.mcpInstall;
      const wantEnabled = input.checked;
      const meta = MCP_SERVER_META[id] ?? {};
      const cfgDiv = document.getElementById(`mcp-cfg-${id}`);
      // If turning ON a server that needs config but has none, divert
      // to the config flow and snap the toggle back off.
      if (wantEnabled && meta.configKey && cfgDiv && input.dataset.mcpEnabled === "true") {
        input.checked = false;
        cfgDiv.classList.add("open");
        return;
      }
      input.disabled = true;
      try {
        await toggleMcpServer(id, wantEnabled);
        await loadConnectorsTab();
      } catch {
        input.disabled = false;
        input.checked = !wantEnabled;
      }
    });
  });

  // Wire the explicit "安装" / "配置并安装" button on un-installed
  // cards. Mirrors the toggle's flow: needs-config → opens config
  // panel (so the user can paste credentials and Save); ready →
  // PATCH the toggle endpoint with enabled=true.
  connectorsMcpList.querySelectorAll("[data-mcp-install-click]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mcpInstallClick;
      if (!id) return;
      const meta = MCP_SERVER_META[id] ?? {};
      const cfgDiv = document.getElementById(`mcp-cfg-${id}`);
      if (meta.configKey && cfgDiv) {
        cfgDiv.classList.add("open");
        cfgDiv.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById(`mcp-cfg-val-${id}`)?.focus();
        return;
      }
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "安装中…";
      try {
        await toggleMcpServer(id, true);
        await loadConnectorsTab();
        showConsoleToast(`已安装：${meta.title ?? id}`, { kind: "ok" });
      } catch (error) {
        btn.disabled = false;
        btn.textContent = original;
        showConsoleToast(`安装失败：${error?.message ?? error}`, { kind: "err" });
      }
    });
  });

  connectorsMcpList.querySelectorAll("[data-plugin-guide]").forEach((button) => {
    button.addEventListener("click", () => {
      const url = button.dataset.pluginGuide;
      if (url) void window.ucaShell?.openExternal?.(url);
    });
  });

  // Wire config expand buttons
  connectorsMcpList.querySelectorAll("[data-mcp-config]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.mcpConfig;
      const cfgDiv = document.getElementById(`mcp-cfg-${id}`);
      if (cfgDiv) cfgDiv.classList.toggle("open");
    });
  });

  // Wire config save buttons
  connectorsMcpList.querySelectorAll("[data-mcp-cfg-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mcpCfgSave;
      const val = document.getElementById(`mcp-cfg-val-${id}`)?.value?.trim();
      const stateEl = document.getElementById(`mcp-cfg-state-${id}`);
      if (!val) { if (stateEl) stateEl.textContent = "请输入值"; return; }
      if (stateEl) stateEl.textContent = "保存中…";
      try {
        await saveMcpServerConfig({ id, key: MCP_SERVER_META[id]?.configKey, value: val });
        if (stateEl) { stateEl.textContent = "已保存 ✓"; setTimeout(() => { stateEl.textContent = ""; }, 2000); }
        // Also enable the server after saving API key
        await toggleMcpServer(id, true);
        await loadConnectorsTab();
      } catch (err) {
        if (stateEl) stateEl.textContent = `Error: ${err.message}`;
      }
    });
  });
}

/* ═══════════════════════════════════════════════
   CONVERSATIONS VIEWER (read-only, P6)
   ═══════════════════════════════════════════════ */

const conversationsState = {
  items: [],
  selectedId: null,
  detail: null,
  showArchived: false
};

function renderConversationsList() {
  const listEl = document.querySelector("#conversationsList");
  const countEl = document.querySelector("#conversationsCount");
  if (!listEl) return;
  if (countEl) countEl.textContent = String(conversationsState.items.length);
  listEl.innerHTML = renderConversationsListHtml({
    items: conversationsState.items,
    selectedId: conversationsState.selectedId
  });
  for (const btn of listEl.querySelectorAll("[data-conversation-id]")) {
    btn.addEventListener("click", () => {
      conversationsState.selectedId = btn.dataset.conversationId;
      renderConversationsList();
      void loadConversationDetail(conversationsState.selectedId);
    });
  }
  for (const btn of listEl.querySelectorAll("[data-resume-conversation-id]")) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const convId = btn.dataset.resumeConversationId;
      if (!convId) return;
      // Switching to the chat tab is intentional — the user just asked
      // to "continue" so leaving them on the conversations list would
      // be confusing. loadConsoleConversationFromBackend handles tab
      // switching internally (see end of that function).
      void loadConsoleConversationFromBackend(convId);
      showConsoleToast("已加载对话，可继续输入", { kind: "ok" });
    });
  }
}

function renderConversationDetail() {
  const titleEl = document.querySelector("#conversationsDetailTitle");
  const metaEl = document.querySelector("#conversationsDetailMeta");
  const bodyEl = document.querySelector("#conversationsDetailBody");
  if (!titleEl || !bodyEl) return;
  const view = renderConversationDetailView(conversationsState.detail);
  titleEl.textContent = view.title;
  if (metaEl) metaEl.textContent = view.meta;
  bodyEl.innerHTML = view.bodyHtml;
  bindConversationsContinueButton();
}

function bindConversationsContinueButton() {
  const btn = document.querySelector("#conversationsContinueBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const convId = btn.dataset.conversationId;
    if (!convId) return;
    void loadConsoleConversationFromBackend(convId);
  });
}

async function loadConversationDetail(conversationId) {
  try {
    const detail = await cacheFetchConversationDetail(fetch.bind(globalThis), state.serviceBaseUrl, conversationId);
    if (!detail?.conversation) {
      conversationsState.detail = null;
      renderConversationDetail();
      return;
    }
    conversationsState.detail = detail;
    renderConversationDetail();
  } catch (err) {
    conversationsState.detail = null;
    renderConversationDetail();
  }
}

async function loadConversationsTab() {
  const listEl = document.querySelector("#conversationsList");
  if (listEl) listEl.innerHTML = `<p class="muted" style="font-size:12px;">Loading…</p>`;
  try {
    const archived = conversationsState.showArchived ? "any" : "0";
    conversationsState.items = await fetchConversationsList({ limit: 200, archived });
    if (!conversationsState.items.some((c) => c.conversation_id === conversationsState.selectedId)) {
      conversationsState.selectedId = conversationsState.items[0]?.conversation_id ?? null;
      conversationsState.detail = null;
    }
    renderConversationsList();
    if (conversationsState.selectedId) {
      await loadConversationDetail(conversationsState.selectedId);
    } else {
      renderConversationDetail();
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = `<p class="muted" style="font-size:12px;">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

document.querySelector("#conversationsRefreshBtn")?.addEventListener("click", () => {
  void loadConversationsTab();
});
document.querySelector("#conversationsShowArchived")?.addEventListener("change", (ev) => {
  conversationsState.showArchived = ev.target.checked;
  void loadConversationsTab();
});

async function loadConnectorsTab() {
  try {
    const [accountsResp, mcpResp, settingsResp, acResp, connectedResp] = await Promise.all([
      fetch(`${state.serviceBaseUrl}/config/email/accounts`),
      fetch(`${state.serviceBaseUrl}/ai/mcp`),
      fetch(`${state.serviceBaseUrl}/config/email/settings`),
      fetch(`${state.serviceBaseUrl}/connectors/accounts`),
      fetch(`${state.serviceBaseUrl}/connectors/connected-accounts`)
    ]);
    if (accountsResp.ok) {
      const { accounts } = await accountsResp.json();
      renderConnEmailAccounts(accounts);
    }
    if (mcpResp.ok) {
      const data = await mcpResp.json();
      renderConnectorsMcpServers(data.servers ?? []);
    }
    if (settingsResp.ok) {
      const { settings } = await settingsResp.json();
      if (connDigestEnabled) connDigestEnabled.checked = settings.enabled !== false;
    }
    if (acResp.ok) {
      const { connectors } = await acResp.json();
      let connectedAccounts = [];
      if (connectedResp.ok) {
        const connected = await connectedResp.json();
        connectedAccounts = connected.accounts ?? [];
      }
      renderAccountConnectors(connectors ?? [], connectedAccounts);
    }
  } catch (err) {
    if (connEmailList) connEmailList.innerHTML = `<p class='muted' style='font-size:12px;'>Could not load: ${err.message}</p>`;
  }
}

// ── Account Connectors (Microsoft 365 / Google) ───────────────────────────────

const ACCOUNT_CONNECTOR_META = {
  microsoft: {
    label: "Microsoft 365",
    logo: "Ⓜ",
    logoClass: "microsoft",
    desc: "OneDrive 文件 · Outlook 邮件 · 日历",
    scopes: "Files.Read、Mail.Read、Calendars.Read",
    setupTitle: "注册 Azure AD 应用（免费）",
    setupSteps: [
      "打开 Azure 门户 → 应用注册 → 新建注册",
      "受支持账户类型选\"任何组织目录中的账户和个人 Microsoft 账户\"",
      "重定向 URI 选 Public client/native，填 http://localhost:4310/auth/callback",
      "注册完成后，将\"应用程序(客户端) ID\"粘贴到下方",
      "Microsoft PKCE 流无需客户端密码"
    ],
    setupUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    needsSecret: false
  },
  google: {
    label: "Google",
    logo: "G",
    logoClass: "google",
    desc: "Google Drive 文件 · Gmail · 日历",
    scopes: "drive.readonly、gmail.readonly、calendar.readonly",
    setupTitle: "创建 Google OAuth 应用（免费）",
    setupSteps: [
      "打开 Google Cloud Console → API 和服务 → 凭据",
      "创建凭据 → OAuth 客户端 ID → 类型选\"桌面应用\"",
      "将 http://localhost:4310/auth/callback 加入已授权的重定向 URI",
      "复制客户端 ID 和客户端密码粘贴到下方",
      "在 OAuth 同意屏幕里添加你自己的邮箱为测试用户"
    ],
    setupUrl: "https://console.cloud.google.com/apis/credentials",
    needsSecret: true
  }
};

let _acConfigOpen = {};   // { microsoft: bool, google: bool }

async function renderAccountConnectors(connectors, connectedAccounts = []) {
  const list = document.getElementById("accountConnectorsList");
  if (!list) return;
  // Skip-render guard: don't wipe an inline rename input mid-edit.
  if (shouldSkipRender(list, ".conn-row-edit")) return;
  list.innerHTML = "";
  // UCA-127: connector cards collapsed into single-line .conn-row entries
  // grouped under "Connected" / "Available providers" section labels
  // (settings-style). Bulky cards, capability tag strips, and per-card
  // default buttons now hide behind a ⋯ menu. Files/mail/calendar previews
  // live in the Inbox tab; this page is only the connection ledger.
  list.className = "conn-section-group";

  if (connectedAccounts.length > 0) {
    const connectedLabel = document.createElement("div");
    connectedLabel.className = "conn-section-label";
    connectedLabel.innerHTML = `Connected<span class="zh">已连接</span><span class="count">${connectedAccounts.length}</span>`;
    list.appendChild(connectedLabel);

    for (const account of connectedAccounts) {
      const meta = ACCOUNT_CONNECTOR_META[account.provider] ?? { label: account.provider, logo: "●", logoClass: "" };
      const caps = account.capabilities ?? {};
      const capLabels = [
        ["emailRead", "邮件读"],
        ["emailWrite", "邮件写"],
        ["fileRead", "文件读"],
        ["fileWrite", "文件写"],
        ["calendarRead", "日历读"],
        ["calendarWrite", "日历写"]
      ].filter(([key]) => caps[key]).map(([, label]) => label);
      const defaults = [
        account.isDefaultForEmail ? "邮箱默认" : null,
        account.isDefaultForFiles ? "文件默认" : null,
        account.isDefaultForCalendar ? "日历默认" : null
      ].filter(Boolean);
      const statusOn = account.tokenStatus === "active";
      const row = document.createElement("div");
      row.className = "conn-row";
      row.innerHTML = `
        <div class="conn-row-logo acc-logo ${meta.logoClass}">${meta.logo}</div>
        <div class="conn-row-main">
          <div class="conn-row-title">
            ${escapeHtml(account.displayName ?? account.email ?? meta.label)}
            ${defaults.map((label) => `<span class="pill pill-ok">${escapeHtml(label)}</span>`).join("")}
          </div>
          <div class="conn-row-sub">${escapeHtml(meta.label)} · ${escapeHtml(account.email ?? "")}${capLabels.length ? " · " + capLabels.slice(0, 4).join("/") : ""}</div>
        </div>
        <span class="conn-row-status">
          <span class="conn-row-status-dot ${statusOn ? "on" : "warn"}" title="${escapeHtml(account.tokenStatus ?? "")}"></span>
          ${statusOn ? "active" : escapeHtml(account.tokenStatus ?? "offline")}
        </span>
        <div class="conn-row-actions">
          <button class="btn btn-sm btn-ghost" data-connected-edit="${escapeHtml(account.id)}" title="重命名显示名">编辑</button>
          <button class="btn btn-sm btn-ghost" data-connected-reauth="${escapeHtml(account.id)}">重新授权</button>
          <button class="btn btn-sm btn-danger" data-connected-delete="${escapeHtml(account.id)}">断开</button>
          <div class="acc-more" data-acc-more-root>
            <button class="icon-btn acc-more-btn" type="button" data-acc-more-toggle aria-label="更多选项" title="更多">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
            <div class="acc-more-menu" hidden>
              <button class="acc-more-item" data-connected-default="${escapeHtml(account.id)}" data-purpose="email">设为邮箱默认</button>
              <button class="acc-more-item" data-connected-default="${escapeHtml(account.id)}" data-purpose="files">设为文件默认</button>
              <button class="acc-more-item" data-connected-default="${escapeHtml(account.id)}" data-purpose="calendar">设为日历默认</button>
            </div>
          </div>
        </div>
      `;
      list.appendChild(row);
      const moreRoot = row.querySelector("[data-acc-more-root]");
      const moreBtn = row.querySelector("[data-acc-more-toggle]");
      const moreMenu = row.querySelector(".acc-more-menu");
      moreBtn?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        moreMenu?.toggleAttribute("hidden");
      });
      document.addEventListener("click", (ev) => {
        if (!moreRoot?.contains(ev.target) && moreMenu && !moreMenu.hasAttribute("hidden")) {
          moreMenu.setAttribute("hidden", "");
        }
      });
    }
  }

  // Available providers section
  const availLabel = document.createElement("div");
  availLabel.className = "conn-section-label";
  availLabel.innerHTML = `Available providers<span class="zh">可添加</span><span class="count">${connectors.filter((c) => ACCOUNT_CONNECTOR_META[c.type]).length}</span>`;
  list.appendChild(availLabel);

  for (const connector of connectors) {
    const meta = ACCOUNT_CONNECTOR_META[connector.type];
    if (!meta) continue;
    const type = connector.type;
    const statusOn = connector.connected;
    const statusText = connector.connected
      ? (connector.email ?? "已连接")
      : connector.configured
        ? "未连接"
        : "需要配置 Client ID";
    const connectBtn = connector.connected
      ? `<button class="btn btn-sm btn-ghost" data-ac-disconnect="${type}">断开</button>`
      : `<button class="btn btn-sm btn-primary" data-ac-connect="${type}" ${connector.configured ? "" : "disabled"}>授权登录</button>`;

    const row = document.createElement("div");
    row.className = "conn-row";
    row.dataset.acType = type;
    row.innerHTML = `
      <div class="conn-row-logo acc-logo ${meta.logoClass}">${meta.logo}</div>
      <div class="conn-row-main">
        <div class="conn-row-title">${escapeHtml(meta.label)}</div>
        <div class="conn-row-sub">${connector.connected ? escapeHtml(statusText) : escapeHtml(meta.desc)}</div>
      </div>
      <span class="conn-row-status">
        <span class="conn-row-status-dot ${statusOn ? "on" : ""}" title="${escapeHtml(statusText)}"></span>
        ${statusOn ? "connected" : "not connected"}
      </span>
      <div class="conn-row-actions">
        ${connectBtn}
        <button class="btn btn-sm btn-ghost" data-ac-config-toggle="${type}">${_acConfigOpen[type] ? "收起" : "配置"}</button>
      </div>
    `;

    // ── Config panel (shown when user clicks "配置") ──
    if (_acConfigOpen[type]) {
      let cfgData = { clientId: "", hasClientSecret: false };
      try {
        const r = await fetch(`${state.serviceBaseUrl}/connectors/accounts/${type}/config`);
        if (r.ok) cfgData = await r.json();
      } catch { /* ignore */ }

      const configPanel = document.createElement("div");
      configPanel.className = "acc-config-panel";
      configPanel.innerHTML = `
        <details style="font-size:12px;color:var(--muted);">
          <summary style="cursor:pointer;font-weight:600;color:var(--text);">${escapeHtml(meta.setupTitle)}</summary>
          <ol style="margin:8px 0 0 16px;padding:0;line-height:1.7;">
            ${meta.setupSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ol>
          <a href="#" data-external-url="${escapeHtml(meta.setupUrl)}" style="font-size:11px;color:var(--accent);">打开 ${meta.label} 开发者控制台 →</a>
        </details>
        <div>
          <label>Client ID</label>
          <input type="text" data-ac-field="clientId" placeholder="粘贴 Client ID…" value="${escapeHtml(cfgData.clientId)}" autocomplete="off">
        </div>
        ${meta.needsSecret ? `
        <div>
          <label>Client Secret</label>
          <input type="password" data-ac-field="clientSecret" placeholder="${cfgData.hasClientSecret ? "（已保存）" : "粘贴 Client Secret…"}" autocomplete="new-password">
        </div>` : `<p style="font-size:11px;color:var(--muted);margin:0;">✓ Microsoft PKCE 流无需 Client Secret</p>`}
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-primary" data-ac-save-config="${type}" style="font-size:12px;padding:5px 14px;">保存</button>
          <span data-ac-config-status style="font-size:12px;color:var(--muted);"></span>
        </div>
      `;
      // UCA-127: config panel attaches as a sibling row below the conn-row
      // (full-width), so the row stays one line even when configuring.
      configPanel.style.cssText = "padding:12px 14px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-sm);margin-top:-2px;display:flex;flex-direction:column;gap:10px;";
      list.appendChild(row);
      list.appendChild(configPanel);
      continue;
    }

    // UCA-126: resource-strip (files/mail/calendar preview) retired from
    // connector cards. Those previews now live in the dedicated Inbox tab
    // with a sidebar account switcher — keeps Connectors cards focused on
    // connection status alone.

    list.appendChild(row);
  }

  // Wire events
  list.querySelectorAll("[data-ac-connect]").forEach((btn) => {
    btn.addEventListener("click", () => handleAccountConnect(btn.dataset.acConnect));
  });
  list.querySelectorAll("[data-ac-disconnect]").forEach((btn) => {
    btn.addEventListener("click", () => handleAccountDisconnect(btn.dataset.acDisconnect));
  });
  list.querySelectorAll("[data-ac-config-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.acConfigToggle;
      _acConfigOpen[type] = !_acConfigOpen[type];
      void loadConnectorsTab();
    });
  });
  list.querySelectorAll("[data-ac-save-config]").forEach((btn) => {
    btn.addEventListener("click", () => handleAccountConfigSave(btn.dataset.acSaveConfig, btn.closest(".acc-config-panel")));
  });
  list.querySelectorAll("[data-external-url]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.ucaShell?.openExternal?.(a.dataset.externalUrl);
    });
  });
  // UCA-126: [data-ac-res] wiring retired with the resource-strip.
  list.querySelectorAll("[data-connected-default]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleConnectedAccountDefault(btn.dataset.connectedDefault, btn.dataset.purpose);
    });
  });
  list.querySelectorAll("[data-connected-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleConnectedAccountDisconnect(btn.dataset.connectedDelete);
    });
  });
  list.querySelectorAll("[data-connected-reauth]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleConnectedAccountReauth(btn.dataset.connectedReauth);
    });
  });
  list.querySelectorAll("[data-connected-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handleConnectedAccountEdit(btn.dataset.connectedEdit, btn);
    });
  });

  // UCA-126: Inbox tab handles its own preview loading; no auto-load here.
}

// In-place rename: replace the row's title with an input + save / cancel
// buttons. Submit goes through the desktop shell bridge so the main process
// can attach the local desktop actor header.
function handleConnectedAccountEdit(accountId, anchorBtn) {
  if (!accountId) return;
  const row = anchorBtn?.closest?.(".conn-row");
  const titleEl = row?.querySelector(".conn-row-title");
  if (!row || !titleEl) return;
  // Capture original so cancel can restore.
  const originalTitleHtml = titleEl.innerHTML;
  const currentName = (titleEl.textContent || "").trim();
  const editHtml = `
    <div class="conn-row-edit">
      <input type="text" class="conn-row-edit-input" maxlength="80"
             value="${escapeHtml(currentName)}" placeholder="显示名（最多 80 字符）"/>
      <button type="button" class="btn btn-sm btn-primary conn-row-edit-save">保存</button>
      <button type="button" class="btn btn-sm btn-ghost conn-row-edit-cancel">取消</button>
    </div>
  `;
  titleEl.innerHTML = editHtml;
  const input = titleEl.querySelector(".conn-row-edit-input");
  const saveBtn = titleEl.querySelector(".conn-row-edit-save");
  const cancelBtn = titleEl.querySelector(".conn-row-edit-cancel");
  input?.focus();
  input?.setSelectionRange(0, input.value.length);
  const restore = () => { titleEl.innerHTML = originalTitleHtml; };
  cancelBtn?.addEventListener("click", restore);
  input?.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") restore();
    if (ev.key === "Enter") { ev.preventDefault(); saveBtn?.click(); }
  });
  saveBtn?.addEventListener("click", async () => {
    const value = input?.value?.trim() ?? "";
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    try {
      await renameConnectedAccountViaShell(accountId, value);
      showConsoleToast("已更新显示名", { kind: "ok" });
      // Tear down the inline rename BEFORE the loadConnectorsTab
      // re-render runs — otherwise the skip-render guard on
      // renderAccountConnectors sees .conn-row-edit still present
      // and the row is stuck in "保存中…".
      titleEl.innerHTML = originalTitleHtml;
      void loadConnectorsTab();
    } catch (err) {
      showConsoleToast(`保存失败：${err?.message ?? err}`, { kind: "err" });
      saveBtn.disabled = false;
      saveBtn.textContent = "保存";
    }
  });
}

async function handleConnectedAccountDefault(accountId, purpose) {
  if (!accountId || !purpose) return;
  try {
    await setConnectedAccountDefaultViaShell(accountId, purpose);
    showConsoleToast("已更新默认账户", { kind: "ok" });
    void loadConnectorsTab();
  } catch (err) {
    showConsoleToast(`更新失败：${err?.message ?? err}`, { kind: "err" });
  }
}

async function handleConnectedAccountDisconnect(accountId) {
  if (!accountId) return;
  if (!confirm("断开这个已连接账户？已缓存的 token 将被删除。")) return;
  try {
    await disconnectConnectedAccountViaShell(accountId);
    showConsoleToast("已断开账户", { kind: "ok" });
    void loadConnectorsTab();
  } catch (err) {
    showConsoleToast(`断开失败：${err?.message ?? err}`, { kind: "err" });
  }
}

async function handleConnectedAccountReauth(accountId) {
  if (!accountId) return;
  const r = await fetch(`${state.serviceBaseUrl}/connectors/connected-accounts/${encodeURIComponent(accountId)}/reauth/start`, {
    method: "POST"
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    alert(data.message ?? data.error ?? "启动重新授权失败。");
    return;
  }
  if (data.authUrl) {
    if (window.ucaShell?.openExternal) await window.ucaShell.openExternal(data.authUrl);
    else window.open(data.authUrl, "_blank");
  }
}

async function handleAccountConnect(type) {
  try {
    const r = await fetch(`${state.serviceBaseUrl}/connectors/accounts/${type}/auth/start`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) {
      alert(data.message ?? data.error ?? "启动授权失败，请先配置 Client ID。");
      _acConfigOpen[type] = true;
      void loadConnectorsTab();
      return;
    }
    // Open the OAuth URL in the system browser
    if (window.ucaShell?.openExternal) {
      await window.ucaShell.openExternal(data.authUrl);
    } else {
      window.open(data.authUrl, "_blank");
    }
    // Poll for completion
    const btn = document.querySelector(`[data-ac-connect="${type}"]`);
    if (btn) { btn.textContent = "等待授权…"; btn.disabled = true; }
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      if (tries > 60) { clearInterval(poll); void loadConnectorsTab(); return; }
      try {
        const sr = await fetch(`${state.serviceBaseUrl}/connectors/accounts`);
        if (!sr.ok) return;
        const { connectors } = await sr.json();
        const c = connectors.find((x) => x.type === type);
        if (c?.connected) { clearInterval(poll); void loadConnectorsTab(); }
      } catch { /* retry */ }
    }, 2000);
  } catch (err) {
    alert(`授权失败: ${err.message}`);
  }
}

async function handleAccountDisconnect(type) {
  if (!confirm(`断开 ${ACCOUNT_CONNECTOR_META[type]?.label ?? type} 连接？已缓存的 token 将被删除。`)) return;
  try {
    await disconnectConnectorAccountViaShell(type);
    showConsoleToast("已断开连接", { kind: "ok" });
    void loadConnectorsTab();
  } catch (err) {
    showConsoleToast(`断开失败：${err?.message ?? err}`, { kind: "err" });
  }
}

async function handleAccountConfigSave(type, panel) {
  const status = panel?.querySelector("[data-ac-config-status]");
  const clientId = panel?.querySelector("[data-ac-field='clientId']")?.value?.trim() ?? "";
  const clientSecret = panel?.querySelector("[data-ac-field='clientSecret']")?.value?.trim() ?? "";
  const body = { clientId };
  if (clientSecret) body.clientSecret = clientSecret;
  try {
    await saveConnectorAccountConfigViaShell(type, body);
    if (status) { status.textContent = "✓ 已保存"; setTimeout(() => { if (status) status.textContent = ""; }, 2000); }
    void loadConnectorsTab();
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message}`;
  }
}

// ═══════════════════════════════════════════════
//   UCA-126: INBOX TAB — account switcher + files/mail/calendar
// ═══════════════════════════════════════════════
const _inboxState = {
  accounts: [],              // merged: OAuth connected-accounts + IMAP email accounts
  activeAccountId: null,     // selected sidebar account
  activeTab: "files",        // 'files' | 'emails' | 'calendar'
  expandedEmailId: null,     // id of the email whose body is inline-expanded
  accountsLoadedAt: 0,
  accountsPromise: null,
  resourceCache: new Map(),
  forceNext: false,
  // Cache full-body fetches keyed by email id so they survive list
  // re-fetches (Gmail list only returns snippets; a separate
  // /messages/:id call gets the real body).
  fullBodyCache: new Map(),  // id → plain text body
  htmlBodyCache: new Map(),  // id → raw HTML body (when available)
  bodyViewMode: new Map()    // id → "text" | "html" (user toggle; default "html" when html exists)
};
const INBOX_ACCOUNTS_TTL_MS = 30_000;
const INBOX_RESOURCE_TTL_MS = 20_000;

async function loadInboxTab({ force = false } = {}) {
  // UCA-128: Inbox sidebar merges TWO backends:
  //   1) /connectors/connected-accounts — OAuth (Google Workspace /
  //      Microsoft 365). Exposes files, mail, and calendar.
  //   2) /config/email/accounts — IMAP mailboxes (Gmail IMAP, Outlook
  //      IMAP, QQ, 163, custom). Mail only, no files/calendar.
  // Before this fix the 163/QQ/IMAP accounts were silently missing
  // because the sidebar only pulled from endpoint #1.
  if (force) {
    _inboxState.forceNext = true;
    _inboxState.resourceCache.clear();
  }
  const freshEnough = !force
    && _inboxState.accounts.length > 0
    && (Date.now() - _inboxState.accountsLoadedAt) < INBOX_ACCOUNTS_TTL_MS;
  if (!freshEnough) {
    if (!_inboxState.accountsPromise) {
      _inboxState.accountsPromise = (async () => {
        const accounts = [];
        const [oauthResult, imapResult] = await Promise.allSettled([
          fetch(`${state.serviceBaseUrl}/connectors/connected-accounts`),
          fetch(`${state.serviceBaseUrl}/config/email/accounts`)
        ]);
        if (oauthResult.status === "fulfilled" && oauthResult.value.ok) {
          const data = await oauthResult.value.json();
          for (const acc of data.accounts ?? []) {
            accounts.push({ ...acc, _kind: "oauth" });
          }
        }
        if (imapResult.status === "fulfilled" && imapResult.value.ok) {
          const data = await imapResult.value.json();
          for (const acc of data.accounts ?? []) {
            accounts.push({
              id: `email:${acc.id}`,
              provider: acc.provider ?? "imap",
              email: acc.email,
              displayName: acc.displayName ?? acc.email ?? acc.id,
              tokenStatus: "active",
              imapHost: acc.imapHost,
              _kind: "imap",
              _rawId: acc.id
            });
          }
        }
        _inboxState.accounts = accounts;
        _inboxState.accountsLoadedAt = Date.now();
      })().finally(() => {
        _inboxState.accountsPromise = null;
      });
    }
    await _inboxState.accountsPromise;
  }
  if (!_inboxState.activeAccountId || !_inboxState.accounts.some((a) => a.id === _inboxState.activeAccountId)) {
    _inboxState.activeAccountId = _inboxState.accounts[0]?.id ?? null;
  }
  renderInboxAccounts();
  renderInboxContent();
}

// Render an email's raw HTML body inside a sandboxed iframe with a
// strict CSP. The sandbox="" empty attribute blocks scripts, forms,
// popups, navigation, and plugins; the inline CSP meta blocks all
// external resources so tracking pixels / remote images / remote
// CSS never fire — the user reads content without beaconing home.
// Inline styles and data: URIs stay allowed so the email still looks
// roughly like what the sender intended.
function renderEmailHtmlFrame(emailId, rawHtml) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;";
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.55;color:#1a1917;background:#ffffff;word-break:break-word}a{color:#b85c2a}img{max-width:100%;height:auto}table{max-width:100%!important}</style></head><body>${rawHtml}</body></html>`;
  // srcdoc needs double-quotes escaped for the attribute value.
  const escaped = doc.replace(/"/g, "&quot;");
  return `<iframe class="inbox-item-body-html" data-email-html-frame="${escapeHtml(emailId)}" sandbox="" srcdoc="${escaped}" referrerpolicy="no-referrer"></iframe>`;
}

// UCA-128: per-provider logo fallback for IMAP accounts so they render
// the same logo treatment as OAuth accounts (Gmail red, Outlook blue,
// QQ cyan, etc).
const IMAP_PROVIDER_LOGOS = {
  gmail:   { cls: "gmail",   logo: "G" },
  outlook: { cls: "outlook", logo: "O" },
  graph:   { cls: "outlook", logo: "O" },
  qq:      { cls: "qq",      logo: "Q" },
  "163":   { cls: "imap",    logo: "163" },
  imap:    { cls: "imap",    logo: "✉" }
};

function renderInboxAccounts() {
  const list = document.querySelector("#inboxAccountList");
  if (!list) return;
  if (_inboxState.accounts.length === 0) {
    // Empty state — give the user a one-click jump to Connectors so
    // they don't have to find the rail item manually. Previously this
    // was a static muted line of text.
    list.innerHTML = `
      <div class="inbox-empty-accounts" style="padding:18px 16px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
        <p class="muted" style="margin:0;font-size:12px;line-height:1.5;">尚未连接账户。连接邮箱、文件、日历后，这里能直接预览。</p>
        <button type="button" class="btn btn-sm btn-primary" id="inboxGoConnectorsBtn">
          去 Connectors 添加<span class="zh">·</span><span>Connect</span>
        </button>
      </div>
    `;
    list.querySelector("#inboxGoConnectorsBtn")?.addEventListener("click", () => {
      switchTab("connectors");
    });
    return;
  }
  list.innerHTML = _inboxState.accounts.map((account) => {
    const isImap = account._kind === "imap";
    const oauthMeta = ACCOUNT_CONNECTOR_META[account.provider];
    const imapMeta = IMAP_PROVIDER_LOGOS[account.provider] ?? IMAP_PROVIDER_LOGOS.imap;
    const meta = oauthMeta ?? { label: account.provider, logo: imapMeta.logo, logoClass: imapMeta.cls };
    const isActive = account.id === _inboxState.activeAccountId;
    const statusClass = account.tokenStatus === "active" ? "" : "offline";
    const kindLabel = isImap ? `IMAP` : (meta.label ?? account.provider);
    return `
      <button class="inbox-account ${isActive ? "active" : ""}" data-inbox-account="${escapeHtml(account.id)}" type="button">
        <div class="inbox-account-logo acc-logo ${meta.logoClass}">${meta.logo}</div>
        <div class="inbox-account-info">
          <div class="inbox-account-name">${escapeHtml(account.displayName ?? account.email ?? meta.label)}</div>
          <div class="inbox-account-email">${escapeHtml(account.email ?? "")}${isImap ? ` · ${escapeHtml(kindLabel)}` : ""}</div>
        </div>
        <span class="inbox-account-status ${statusClass}" title="${escapeHtml(account.tokenStatus ?? "")}"></span>
      </button>
    `;
  }).join("");
  list.querySelectorAll("[data-inbox-account]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (_inboxState.activeAccountId !== btn.dataset.inboxAccount) {
        // Collapse any expanded email so the new account starts clean.
        _inboxState.expandedEmailId = null;
      }
      _inboxState.activeAccountId = btn.dataset.inboxAccount;
      renderInboxAccounts();
      renderInboxContent();
    });
  });
}

async function renderInboxContent() {
  const content = document.querySelector("#inboxContent");
  const label = document.querySelector("#inboxAccountLabel");
  if (!content) return;
  const account = _inboxState.accounts.find((a) => a.id === _inboxState.activeAccountId);
  if (!account) {
    content.innerHTML = `<p class="inbox-empty">选择一个账户开始浏览。</p>`;
    if (label) label.textContent = "—";
    return;
  }
  if (label) label.textContent = account.displayName ?? account.email ?? account.provider;

  // IMAP accounts (163 / QQ / Gmail-IMAP / Outlook-IMAP / custom) only
  // expose mail — disable Files + Calendar tabs and force Mail.
  const isImap = account._kind === "imap";
  document.querySelectorAll("[data-inbox-res]").forEach((btn) => {
    const res = btn.dataset.inboxRes;
    if (isImap && (res === "files" || res === "calendar")) {
      btn.setAttribute("disabled", "");
      btn.title = "IMAP 账户只支持邮件";
    } else {
      btn.removeAttribute("disabled");
      btn.removeAttribute("title");
    }
    btn.setAttribute("aria-pressed", res === _inboxState.activeTab ? "true" : "false");
  });
  if (isImap && _inboxState.activeTab !== "emails") {
    _inboxState.activeTab = "emails";
    document.querySelectorAll("[data-inbox-res]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.inboxRes === "emails" ? "true" : "false");
    });
  }

  function renderInboxPayload(data) {
    if (isImap && data.reason) {
      content.innerHTML = `
        <div class="inbox-empty" style="padding:32px 24px;">
          <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px;">
            无法连接到邮箱服务器
          </div>
          <div style="max-width:440px;margin:0 auto;line-height:1.6;font-size:12px;">
            ${escapeHtml(data.reason)}<br/>
            <span class="muted">检查 Connectors 页的 IMAP host / 授权码，或稍后重试。</span>
          </div>
        </div>
      `;
      return;
    }

    if (_inboxState.activeTab === "files") {
      const files = data.files ?? [];
      if (!files.length) { content.innerHTML = `<p class="inbox-empty">该账户没有可预览的文件。</p>`; return; }
      content.innerHTML = files.map((f) => `
        <button class="inbox-item" type="button" data-external-url="${escapeHtml(f.url ?? "")}">
          <span class="inbox-item-icon">${f.isFolder ? "📁" : "📄"}</span>
          <div class="inbox-item-main">
            <div class="inbox-item-title">${escapeHtml(f.name ?? "(untitled)")}</div>
            <div class="inbox-item-meta">${escapeHtml(f.path ?? f.url ?? "")}</div>
          </div>
          <span class="inbox-item-time">${f.modified ? new Date(f.modified).toLocaleDateString("zh-CN") : ""}</span>
        </button>
      `).join("");
    } else if (_inboxState.activeTab === "emails") {
      const emails = data.emails ?? data.messages ?? [];
      if (!emails.length) { content.innerHTML = `<p class="inbox-empty">该账户暂无邮件。</p>`; return; }
      const expandedId = _inboxState.expandedEmailId;
      content.innerHTML = emails.map((m) => {
        const isExpanded = expandedId === m.id;
        const body = _inboxState.fullBodyCache.get(m.id) ?? m.bodyText ?? m.preview ?? "";
        const htmlBody = _inboxState.htmlBodyCache.get(m.id) ?? m.bodyHtml ?? "";
        const hasHtml = htmlBody && htmlBody.length > 0;
        const viewMode = _inboxState.bodyViewMode.get(m.id) ?? (hasHtml ? "html" : "text");
        const receivedLine = m.received ? new Date(m.received).toLocaleString("zh-CN", {
          year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        }) : "";
        const fromLine = [m.fromName, m.from].filter(Boolean).map(escapeHtml).join(" &lt;") + (m.fromName && m.from ? "&gt;" : "");
        let bodyMarkup;
        if (!isExpanded) {
          bodyMarkup = "";
        } else if (viewMode === "html" && hasHtml) {
          bodyMarkup = renderEmailHtmlFrame(m.id, htmlBody);
        } else if (body) {
          bodyMarkup = `<pre class="inbox-item-body-text">${escapeHtml(body)}</pre>`;
        } else {
          bodyMarkup = `<pre class="inbox-item-body-text"><span class="muted">（此邮件没有可预览的文本正文）</span></pre>`;
        }
        const toggleMarkup = isExpanded && hasHtml ? `
          <div class="inbox-item-body-toggle">
            <button type="button" class="seg-btn ${viewMode === "html" ? "active" : ""}" data-email-view="html" data-email-id="${escapeHtml(m.id)}">Rich</button>
            <button type="button" class="seg-btn ${viewMode === "text" ? "active" : ""}" data-email-view="text" data-email-id="${escapeHtml(m.id)}">Plain</button>
          </div>
        ` : "";
        return `
          <button class="inbox-item ${isExpanded ? "inbox-item--expanded" : ""}" type="button" data-email-id="${escapeHtml(m.id ?? "")}">
            <span class="inbox-item-icon">${m.isRead ? "○" : "●"}</span>
            <div class="inbox-item-main">
              <div class="inbox-item-title ${m.isRead ? "" : "unread"}">${escapeHtml(m.subject ?? "(无主题)")}</div>
              <div class="inbox-item-meta">${escapeHtml(m.fromName ?? m.from ?? "")}${!isExpanded && m.preview ? " — " + escapeHtml(m.preview) : ""}</div>
            </div>
            <span class="inbox-item-time">${m.received ? new Date(m.received).toLocaleDateString("zh-CN") : ""}</span>
          </button>
          ${isExpanded ? `
            <div class="inbox-item-body">
              <div class="inbox-item-body-head">
                <div><strong>${escapeHtml(m.subject ?? "(无主题)")}</strong></div>
                <div class="muted">From ${fromLine || "(unknown)"}${receivedLine ? ` · ${escapeHtml(receivedLine)}` : ""}</div>
                ${toggleMarkup}
              </div>
              ${bodyMarkup}
            </div>
          ` : ""}
        `;
      }).join("");
      content.querySelectorAll("[data-email-view]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          _inboxState.bodyViewMode.set(btn.dataset.emailId, btn.dataset.emailView);
          renderInboxContent();
        });
      });
      content.querySelectorAll("[data-email-id]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.emailId;
          const willExpand = _inboxState.expandedEmailId !== id;
          _inboxState.expandedEmailId = willExpand ? id : null;
          renderInboxContent();
          const oauthSupportsFullBody = account._kind !== "imap" && (account.provider === "google" || account.provider === "microsoft");
          if (willExpand && oauthSupportsFullBody && !_inboxState.fullBodyCache.has(id)) {
            try {
              const r = await fetch(`${state.serviceBaseUrl}/connectors/accounts/${account.provider}/messages/${encodeURIComponent(id)}`);
              if (!r.ok) return;
              const payload = await r.json();
              if (payload.status !== "success" || !payload.data) return;
              if (payload.data.bodyText) _inboxState.fullBodyCache.set(id, payload.data.bodyText);
              if (payload.data.bodyHtml) _inboxState.htmlBodyCache.set(id, payload.data.bodyHtml);
              if (_inboxState.expandedEmailId === id) renderInboxContent();
            } catch { /* silent */ }
          }
        });
      });
    } else {
      const events = data.events ?? [];
      if (!events.length) { content.innerHTML = `<p class="inbox-empty">近期无日程。</p>`; return; }
      content.innerHTML = events.map((e) => `
        <button class="inbox-item" type="button">
          <span class="inbox-item-icon">📅</span>
          <div class="inbox-item-main">
            <div class="inbox-item-title">${escapeHtml(e.title ?? "(无标题)")}</div>
            <div class="inbox-item-meta">${e.location ? escapeHtml(e.location) : ""}</div>
          </div>
          <span class="inbox-item-time">${e.start ? new Date(e.start).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
        </button>
      `).join("");
    }
    content.querySelectorAll("[data-external-url]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (btn.dataset.externalUrl) window.ucaShell?.openExternal?.(btn.dataset.externalUrl);
      });
    });
  }

  content.innerHTML = `<p class="inbox-empty">加载中…</p>`;
  try {
    let url;
    if (isImap) {
      // IMAP: only mail is supported. The backend endpoint returns either
      // { messages } on success or { messages: [], reason } on a known
      // soft failure (missing credentials / connection refused).
      const refresh = _inboxState.forceNext ? "&refresh=1" : "";
      _inboxState.forceNext = false;
      url = `${state.serviceBaseUrl}/config/email/accounts/${encodeURIComponent(account._rawId)}/messages?limit=30${refresh}`;
    } else {
      const provider = account.provider;
      if (_inboxState.activeTab === "files") url = `${state.serviceBaseUrl}/connectors/accounts/${provider}/files?limit=30`;
      else if (_inboxState.activeTab === "emails") url = `${state.serviceBaseUrl}/connectors/accounts/${provider}/emails?limit=30`;
      else url = `${state.serviceBaseUrl}/connectors/accounts/${provider}/calendar?limit=30`;
    }

    const cacheKey = `${account.id}:${_inboxState.activeTab}:${url}`;
    const cached = _inboxState.forceNext ? null : _inboxState.resourceCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < INBOX_RESOURCE_TTL_MS) {
      renderInboxPayload(cached.data);
      return;
    }

    const r = await fetch(url);
    let data = null;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    if (!r.ok) {
      const detail = data?.message || data?.error || data?.reason || `加载失败 (${r.status})`;
      content.innerHTML = `<p class="inbox-empty">${escapeHtml(detail)}</p>`;
      return;
    }
    _inboxState.resourceCache.set(cacheKey, { ts: Date.now(), data });
    renderInboxPayload(data);
  } catch (err) {
    content.innerHTML = `<p class="inbox-empty">Error: ${escapeHtml(err.message)}</p>`;
  }
}

// Wire the resource seg-control + refresh button once.
(function initInboxResourceToggle() {
  document.querySelectorAll("[data-inbox-res]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Respect disabled state so clicks on Files/Calendar for IMAP
      // accounts are no-ops (the buttons are visually dimmed too).
      if (btn.hasAttribute("disabled")) return;
      _inboxState.activeTab = btn.dataset.inboxRes;
      _inboxState.expandedEmailId = null; // collapse on tab switch
      renderInboxContent();
    });
  });
  // Explicit refresh: pass the force flag so the short-lived inbox caches are
  // bypassed. Ordinary account-switch / tab-switch renders keep the
  // cached fast path.
  document.querySelector("#inboxRefreshBtn")?.addEventListener("click", () => {
    void loadInboxTab({ force: true });
  });
})();

// ── Email provider cards ──────────────────────────────────────
const IMAP_PRESETS = {
  gmail:   { host: "imap.gmail.com",        port: 993, passLabel: "App 专用密码", hint: "需在 Google 账户开启两步验证后生成应用专用密码", setupUrl: "https://myaccount.google.com/apppasswords", steps: ["打开 Google Account → Security。", "开启 2-Step Verification。", "进入 App passwords，创建 Mail 专用密码。", "把生成的 16 位密码粘贴到这里。"] },
  outlook: { host: "imap-mail.outlook.com", port: 993, passLabel: "密码 / App Password", hint: "Microsoft 账户启用双重验证时，需要创建 App password。", setupUrl: "https://account.live.com/proofs/manage/additional", steps: ["打开 Microsoft account security。", "如果开启了双重验证，创建 App password。", "如果组织账号禁用了 IMAP，需要管理员在 Exchange/Graph 里开启。"] },
  qq:      { host: "imap.qq.com",           port: 993, passLabel: "授权码", hint: "在 QQ 邮箱设置 → 账户 → IMAP → 开启 → 生成授权码", setupUrl: "https://mail.qq.com/", steps: ["登录 QQ 邮箱网页版。", "进入设置 → 账户。", "开启 IMAP/SMTP 服务。", "按提示发送短信后复制授权码。"] },
  "163":   { host: "imap.163.com",          port: 993, passLabel: "授权密码", hint: "在 163 邮箱设置 → POP3/SMTP/IMAP → 开启 → 生成授权密码", setupUrl: "https://mail.163.com/", steps: ["登录 163 邮箱网页版。", "进入设置 → POP3/SMTP/IMAP。", "开启 IMAP 服务。", "生成并复制客户端授权密码。"] },
  other:   { host: "",                       port: 993, passLabel: "密码 / App password", hint: "如果不确定 IMAP 信息，搜索“你的邮箱服务商 IMAP 设置”。", setupUrl: "", steps: ["找到邮箱服务商的 IMAP 设置页面。", "确认 IMAP host、端口 993、SSL/TLS 已开启。", "优先使用 App password 或授权码，不要使用网页登录密码。"] }
};

const PROVIDER_NAMES = {
  gmail: "Gmail", outlook: "Outlook / Hotmail", qq: "QQ Mail", "163": "163 Mail", other: "IMAP 邮箱"
};

let _currentEmailProvider = null;

function renderEmailSetupGuide(provider, preset) {
  const guide = document.getElementById("connEmailSetupGuide");
  if (!guide) return;
  const setupLink = preset.setupUrl
    ? `<button type="button" class="btn btn-ghost" data-email-setup-url="${escapeHtml(preset.setupUrl)}">打开网页登录/设置页面</button>`
    : "";
  guide.style.display = "";
  guide.innerHTML = `
    <strong>${escapeHtml(PROVIDER_NAMES[provider] ?? provider)} setup</strong>
    <p style="margin:6px 0 0;">当前版本还没有接完整 OAuth 网页登录授权流，所以这里使用 IMAP 授权码 / App password。这样比输入网页登录密码更安全，也更容易撤销。</p>
    <ol>${(preset.steps ?? []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    <div class="toolbar" style="margin-top:8px;">${setupLink}</div>
  `;
  guide.querySelector("[data-email-setup-url]")?.addEventListener("click", (event) => {
    const url = event.currentTarget.dataset.emailSetupUrl;
    if (url) void window.ucaShell?.openExternal?.(url);
  });
}

document.querySelectorAll(".conn-provider-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const provider = btn.dataset.provider;
    _currentEmailProvider = provider;
    const preset = IMAP_PRESETS[provider] ?? IMAP_PRESETS.other;
    const formTitle = document.getElementById("connEmailFormTitle");
    const picker = document.getElementById("connEmailPicker");
    const inlineForm = document.getElementById("connEmailInlineForm");
    const hostRow = document.getElementById("connEmailHostRow");
    const passLabel = document.getElementById("connEmailPasswordLabel");
    const hint = document.getElementById("connEmailPasswordHint");
    const hostInput = document.getElementById("connEmailImapHost");
    const addrInput = document.getElementById("connEmailAddress");

    if (formTitle) formTitle.textContent = `连接 ${PROVIDER_NAMES[provider] ?? provider}`;
    if (passLabel) passLabel.textContent = preset.passLabel;
    if (hint) hint.textContent = preset.hint;
    renderEmailSetupGuide(provider, preset);
    if (hostInput) hostInput.value = preset.host;
    if (hostRow) hostRow.style.display = provider === "other" ? "" : "none";
    if (addrInput) { addrInput.value = ""; addrInput.placeholder = provider === "other" ? "you@example.com" : `you@${provider === "163" ? "163.com" : provider + ".com"}`; }
    if (document.getElementById("connEmailPassword")) document.getElementById("connEmailPassword").value = "";
    if (connEmailState) connEmailState.textContent = "";

    if (picker) picker.style.display = "none";
    if (inlineForm) inlineForm.style.display = "";
    if (addrInput) addrInput.focus();
  });
});

document.getElementById("connEmailCancelBtn")?.addEventListener("click", () => {
  const picker = document.getElementById("connEmailPicker");
  const inlineForm = document.getElementById("connEmailInlineForm");
  if (picker) picker.style.display = "";
  if (inlineForm) inlineForm.style.display = "none";
  if (connEmailState) connEmailState.textContent = "";
  _currentEmailProvider = null;
});

// ═══════════════════════════════════════════════
//   UCA-127: CONNECTOR CATALOG DRAWER
// -------------------------------------------------
//   A right-side drawer that unifies discovery across accounts, email
//   providers, and MCP tools. Clicking a card fires the matching flow
//   (auth start / reveal email form / open MCP install button).
// ═══════════════════════════════════════════════
(function initConnBrowse() {
  const back = document.querySelector("#connBrowseBack");
  const openBtn = document.querySelector("#connBrowseBtn");
  const closeBtn = document.querySelector("#connBrowseCloseBtn");
  const searchInput = document.querySelector("#connBrowseSearch");
  const grid = document.querySelector("#connBrowseGrid");
  const filtersEl = document.querySelector("#connBrowseFilters");
  if (!back || !openBtn || !grid) return;

  // Static catalog — sourced from the same meta tables the inline
  // lists already use so we don't drift. Each entry carries:
  //   id / title / desc / category / logoClass / action (callback)
  const buildCatalog = () => {
    const entries = [];
    // Account providers (ACCOUNT_CONNECTOR_META — google/microsoft)
    for (const [type, meta] of Object.entries(ACCOUNT_CONNECTOR_META ?? {})) {
      entries.push({
        id: `account-${type}`,
        title: meta.label,
        desc: meta.desc ?? "Single sign-on for files, mail, and calendar.",
        category: "account",
        logoClass: meta.logoClass,
        logoText: meta.logo,
        action: () => handleAccountConnect(type),
        badge: "OAuth"
      });
    }
    // Email providers (IMAP_PRESETS)
    const emailMeta = [
      { provider: "gmail",   title: "Gmail",   desc: "IMAP with App password. Ideal for inbox monitoring.", logoClass: "gmail",   logoText: "G" },
      { provider: "outlook", title: "Outlook / Hotmail", desc: "Microsoft consumer / 365 via IMAP.",         logoClass: "outlook", logoText: "O" },
      { provider: "qq",      title: "QQ Mail", desc: "中国腾讯邮箱 via IMAP + 授权码.",                        logoClass: "qq",      logoText: "Q" },
      { provider: "163",     title: "163 Mail", desc: "网易邮箱 via IMAP + 授权码.",                           logoClass: "imap",    logoText: "163" },
      { provider: "other",   title: "Custom IMAP", desc: "Any IMAP-compatible mail server.",                 logoClass: "imap",    logoText: "✉" }
    ];
    for (const m of emailMeta) {
      entries.push({
        id: `email-${m.provider}`,
        title: m.title,
        desc: m.desc,
        category: "email",
        logoClass: m.logoClass,
        logoText: m.logoText,
        action: () => {
          // Programmatically click the hidden picker button so the
          // existing form-show logic runs unchanged.
          close();
          const btn = document.querySelector(`.conn-provider-btn[data-provider="${m.provider}"]`);
          btn?.click();
          document.querySelector("#panel-connectors")?.scrollIntoView({ behavior: "smooth", block: "start" });
          // Make the picker visible so the form appears.
          const picker = document.querySelector("#connEmailPicker");
          if (picker) { picker.removeAttribute("hidden"); picker.style.display = "none"; }
        },
        badge: "IMAP"
      });
    }
    // MCP tools
    for (const [id, meta] of Object.entries(MCP_SERVER_META ?? {})) {
      const logoClass = meta.logoClass ?? "imap";
      entries.push({
        id: `mcp-${id}`,
        title: meta.title,
        desc: meta.desc ?? "",
        category: "mcp",
        logoClass,
        logoText: MCP_LOGO_SVG[logoClass] ?? "?",
        action: () => {
          close();
          // Scroll to MCP panel and focus the card.
          const card = document.getElementById(`mcp-card-${id}`);
          if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.transition = "background 600ms";
            card.style.background = "var(--accent-soft)";
            setTimeout(() => { card.style.background = ""; }, 1200);
          }
        },
        badge: "MCP"
      });
    }
    return entries;
  };

  const open = () => {
    back.classList.add("open");
    render();
    setTimeout(() => searchInput?.focus(), 120);
  };
  const close = () => {
    back.classList.remove("open");
  };

  let activeCategory = "all";
  let searchText = "";

  const render = () => {
    const entries = buildCatalog()
      .filter((e) => activeCategory === "all" || e.category === activeCategory)
      .filter((e) => {
        if (!searchText) return true;
        const q = searchText.toLowerCase();
        return e.title.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q) || e.category.includes(q);
      });
    if (entries.length === 0) {
      grid.innerHTML = `<p class="muted" style="padding:28px 0;text-align:center;grid-column:1/-1;">没有匹配的连接器。</p>`;
      return;
    }
    grid.innerHTML = entries.map((e) => `
      <button class="conn-browse-card" type="button" data-conn-entry="${escapeHtml(e.id)}">
        <div class="conn-browse-card-logo acc-logo ${e.logoClass}">${e.logoText ?? ""}</div>
        <div class="conn-browse-card-main">
          <div class="conn-browse-card-title">
            ${escapeHtml(e.title)}
            ${e.badge ? `<span class="pill pill-neutral">${escapeHtml(e.badge)}</span>` : ""}
          </div>
          <div class="conn-browse-card-desc">${escapeHtml(e.desc)}</div>
        </div>
        <span class="conn-browse-card-add" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </span>
      </button>
    `).join("");
    grid.querySelectorAll("[data-conn-entry]").forEach((btn) => {
      const entry = entries.find((e) => e.id === btn.dataset.connEntry);
      btn.addEventListener("click", () => entry?.action?.());
    });
  };

  openBtn.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  back.addEventListener("click", (ev) => {
    // backdrop click (outside the aside) closes.
    if (ev.target === back) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && back.classList.contains("open")) close();
  });
  searchInput?.addEventListener("input", (ev) => {
    searchText = ev.target.value ?? "";
    render();
  });
  filtersEl?.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeCategory = chip.dataset.connCat ?? "all";
      filtersEl.querySelectorAll(".filter-chip").forEach((c) => c.setAttribute("aria-pressed", c === chip ? "true" : "false"));
      render();
    });
  });
})();

document.getElementById("connEmailConnectBtn")?.addEventListener("click", async () => {
  const provider = _currentEmailProvider ?? "other";
  const preset = IMAP_PRESETS[provider] ?? IMAP_PRESETS.other;
  const email = document.getElementById("connEmailAddress")?.value.trim();
  const password = document.getElementById("connEmailPassword")?.value;
  const host = document.getElementById("connEmailImapHost")?.value.trim() || preset.host;
  if (!email) { if (connEmailState) connEmailState.textContent = "请输入邮箱地址"; return; }
  if (!password) { if (connEmailState) connEmailState.textContent = "请输入密码 / 授权码"; return; }
  if (connEmailState) connEmailState.textContent = "连接中…";
  if (document.getElementById("connEmailConnectBtn")) document.getElementById("connEmailConnectBtn").disabled = true;
  try {
    const id = email.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
    await saveEmailAccountViaShell({
      id,
      email,
      provider: provider === "other" ? "imap" : provider === "outlook" ? "imap" : provider === "gmail" ? "imap" : provider === "qq" ? "imap" : provider === "163" ? "imap" : "imap",
      displayName: email,
      imapHost: host,
      imapPort: preset.port,
      credentials: { username: email, password }
    });
    const picker = document.getElementById("connEmailPicker");
    const inlineForm = document.getElementById("connEmailInlineForm");
    if (picker) picker.style.display = "";
    if (inlineForm) inlineForm.style.display = "none";
    if (connEmailState) { connEmailState.textContent = ""; }
    _currentEmailProvider = null;
    await loadConnectorsTab();
  } catch (err) {
    if (connEmailState) connEmailState.textContent = `连接失败: ${err.message}`;
  } finally {
    if (document.getElementById("connEmailConnectBtn")) document.getElementById("connEmailConnectBtn").disabled = false;
  }
});

connDigestTestBtn?.addEventListener("click", async () => {
  if (connDigestTestState) connDigestTestState.textContent = "Sending digest…";
  try {
    const data = await checkEmailDigestViaShell({ force: true });
    if (connDigestTestState) {
      connDigestTestState.textContent = data.sent
        ? (data.forced ? "Digest sent (manual test)." : "Digest sent!")
        : (data.reason ?? "No digest sent.");
      setTimeout(() => { connDigestTestState.textContent = ""; }, 4000);
    }
  } catch (err) {
    if (connDigestTestState) connDigestTestState.textContent = `Error: ${err.message}`;
  }
});

connDigestEnabled?.addEventListener("change", async () => {
  try {
    const result = await updateEmailSettingsViaShell({
      ...(state.workspace.emailDigestSettings ?? {}),
      enabled: connDigestEnabled.checked
    });
    state.workspace.emailDigestSettings = result.settings ?? state.workspace.emailDigestSettings;
    if (state.workspace.health?.config?.features) {
      state.workspace.health.config.features.morning_digest = { enabled: connDigestEnabled.checked };
    }
    renderEmailDigestSettings();
    renderFeatureToggles();
  } catch (error) {
    if (connDigestTestState) connDigestTestState.textContent = `Error: ${error.message}`;
  }
});

connectorsMcpRefreshBtn?.addEventListener("click", () => { void loadConnectorsTab(); });

// UCA-126 Phase 7d: chat composer richness — attachments, voice trigger,
// model chip label. Attach is local-file-picker + chips (passed into task
// context). Voice defers to the existing overlay voice mode via hotkey.

// Cache data: URLs for image attachments so re-rendering the chip row
// (e.g. on add / remove) doesn't re-read the file. Path → data URL.
const attachThumbnailCache = new Map();

async function loadAttachmentThumbnail(filePath) {
  if (!filePath || attachThumbnailCache.has(filePath)) {
    return attachThumbnailCache.get(filePath) ?? null;
  }
  if (!isImageArtifactPath(filePath) || !window.ucaShell?.readFileAsDataUrl) return null;
  // Pre-mark with null so concurrent calls don't race. Real value
  // overwrites on success; failure leaves null and won't retry.
  attachThumbnailCache.set(filePath, null);
  try {
    const dataUrl = await window.ucaShell.readFileAsDataUrl(filePath, imageMimeFor(filePath));
    attachThumbnailCache.set(filePath, dataUrl);
    return dataUrl;
  } catch (error) {
    // Surface the reason for the dev — silent failures here used to
    // leave the user with an empty thumb slot and no idea why.
    console.warn("[attach-thumb] readFileAsDataUrl failed", filePath, error?.message ?? error);
    return null;
  }
}

// Fallback placeholder shown inside .chip-attach-thumb when the data
// URL hasn't loaded (or failed). Keeps the chip looking like an image
// chip even before / without the real thumbnail.
const ATTACH_THUMB_PLACEHOLDER = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="9" r="1.5"/>
    <path d="m21 15-5-5L5 21"/>
  </svg>
`;

function renderChatAttachments() {
  if (!consoleChatAttachments) return;
  if (consoleChatAttachList.length === 0) {
    consoleChatAttachments.hidden = true;
    consoleChatAttachments.innerHTML = "";
    return;
  }
  consoleChatAttachments.hidden = false;
  consoleChatAttachments.innerHTML = consoleChatAttachList.map((entry, idx) => {
    const filePath = entry?.path ?? "";
    const isImage = isImageArtifactPath(filePath);
    const cached = isImage ? attachThumbnailCache.get(filePath) : null;
    if (isImage) {
      // Image chip — square thumb on the left, name + remove on the
      // right. The img fills lazily once readFileAsDataUrl resolves.
      // Until then the placeholder icon shows so the box is never
      // empty (otherwise users wonder if the upload broke).
      const thumbInner = cached
        ? `<img src="${escapeHtml(cached)}" alt="">`
        : ATTACH_THUMB_PLACEHOLDER;
      return `
        <span class="chip-attach chip-attach--image" data-path="${escapeHtml(filePath)}">
          <span class="chip-attach-thumb">${thumbInner}</span>
          <span class="chip-attach-name">${escapeHtml(entry?.name ?? "")}</span>
          <button type="button" data-remove-attach="${idx}" aria-label="Remove">×</button>
        </span>
      `;
    }
    return `
      <span class="chip-attach">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        <span>${escapeHtml(entry?.name ?? "")}</span>
        <button type="button" data-remove-attach="${idx}" aria-label="Remove">×</button>
      </span>
    `;
  }).join("");
  for (const btn of consoleChatAttachments.querySelectorAll("[data-remove-attach]")) {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeAttach);
      if (Number.isInteger(idx)) {
        consoleChatAttachList.splice(idx, 1);
        renderChatAttachments();
      }
    });
  }
  // Lazy-load thumbnails that aren't cached yet. The placeholder icon
  // is in place from the initial render; this swaps it for the real
  // image once readFileAsDataUrl resolves. If the load fails the
  // placeholder simply stays — better than an empty box.
  for (const chip of consoleChatAttachments.querySelectorAll(".chip-attach--image")) {
    const filePath = chip.dataset.path;
    if (!filePath || chip.querySelector("img")) continue;
    void loadAttachmentThumbnail(filePath).then((dataUrl) => {
      if (!dataUrl) return;
      const thumb = chip.querySelector(".chip-attach-thumb");
      if (!thumb || thumb.querySelector("img")) return;
      // Replace the placeholder svg with the real image.
      thumb.innerHTML = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "";
      thumb.appendChild(img);
    });
  }
}

consoleChatAttachBtn?.addEventListener("click", () => {
  consoleChatAttachInput?.click();
});

const consoleChatNoteBtn = document.querySelector("#consoleChatNoteBtn");
consoleChatNoteBtn?.addEventListener("click", () => {
  // Need notes module booted to read note bodies — touch the panel once
  // to lazily init (matches the tab-switch flow in initNotesIfNeeded).
  if (typeof initNotesIfNeeded === "function") initNotesIfNeeded();
  const api = window.lingxyNotes;
  if (!api) return;
  const notes = api.list();
  if (notes.length === 0) {
    showConsoleToast("还没有笔记 — 在 Notes 标签新建一条", { kind: "info" });
    return;
  }
  const popover = document.createElement("div");
  popover.className = "note-target-popover";
  popover.innerHTML = `
    <div class="ntp-head">从笔记插入</div>
    <div class="ntp-list">
      ${notes.slice(0, 8).map((n) => `
        <button type="button" data-note-id="${escapeHtml(n.id)}" class="ntp-item">
          <span class="ntp-item-title">${escapeHtml(n.title)}</span>
          <span class="ntp-item-snippet">${escapeHtml(n.snippet)}</span>
        </button>
      `).join("")}
    </div>
  `;
  document.body.appendChild(popover);
  const r = consoleChatNoteBtn.getBoundingClientRect();
  popover.style.left = `${Math.max(8, r.left + window.scrollX)}px`;
  popover.style.top = `${r.top + window.scrollY - 8 - popover.offsetHeight}px`;
  // After mount we know the height — re-position above the button.
  popover.style.top = `${r.top + window.scrollY - popover.offsetHeight - 6}px`;
  const close = () => { popover.remove(); document.removeEventListener("mousedown", outside, true); };
  const outside = (ev) => { if (!popover.contains(ev.target) && ev.target !== consoleChatNoteBtn) close(); };
  setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  popover.querySelectorAll("[data-note-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = api.bodyText(btn.dataset.noteId).trim();
      if (text && consoleChatInput) {
        const start = consoleChatInput.selectionStart ?? consoleChatInput.value.length;
        const end = consoleChatInput.selectionEnd ?? start;
        const before = consoleChatInput.value.slice(0, start);
        const after = consoleChatInput.value.slice(end);
        const insert = (before && !before.endsWith("\n") ? "\n" : "") + text + "\n";
        consoleChatInput.value = before + insert + after;
        const cursor = (before + insert).length;
        consoleChatInput.setSelectionRange(cursor, cursor);
        consoleChatInput.focus();
      }
      close();
    });
  });
});
consoleChatAttachInput?.addEventListener("change", () => {
  const files = Array.from(consoleChatAttachInput.files ?? []);
  const resolvedPaths = window.ucaShell?.resolveDroppedFilePaths?.(files) ?? [];
  for (const [index, f] of files.entries()) {
    consoleChatAttachList.push({
      name: f.name,
      path: resolvedPaths[index] || f.path || ""
    });
  }
  consoleChatAttachInput.value = "";
  renderChatAttachments();
});

// Drag-and-drop attach. The shell-level handlers (drop-guard.js) already
// preventDefault any file drag, so the OS won't try to open dropped
// files. We just layer a visual drop-zone over the chat-shell + route
// drops into the existing attach list. The dragenter/leave counter
// handles bubbling through child bubbles without the zone flickering.
(function wireConsoleChatDropZone() {
  const shell = document.querySelector(".console-chat-shell");
  const zone = document.querySelector("#consoleChatDropZone");
  if (!shell || !zone) return;
  const hasFilePayload = (event) => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i += 1) if (types[i] === "Files") return true;
    return false;
  };
  let counter = 0;
  shell.addEventListener("dragenter", (event) => {
    if (!hasFilePayload(event)) return;
    counter += 1;
    zone.hidden = false;
  });
  shell.addEventListener("dragleave", (event) => {
    if (!hasFilePayload(event)) return;
    counter -= 1;
    if (counter <= 0) { counter = 0; zone.hidden = true; }
  });
  shell.addEventListener("dragover", (event) => {
    if (hasFilePayload(event)) event.preventDefault();
  });
  shell.addEventListener("drop", (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    counter = 0;
    zone.hidden = true;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const paths = window.ucaShell?.resolveDroppedFilePaths?.(files) ?? [];
    for (const [i, f] of files.entries()) {
      consoleChatAttachList.push({
        name: f.name,
        path: paths[i] || f.path || ""
      });
    }
    renderChatAttachments();
  });
})();

consoleChatVoiceBtn?.addEventListener("click", () => {
  // Defer to the existing overlay voice mode (Ctrl+Shift+V). The preload
  // bridge exposes a helper when available; otherwise surface a hint.
  if (window.ucaBridge?.openOverlayInVoiceMode) {
    window.ucaBridge.openOverlayInVoiceMode();
  } else {
    showConsoleToast("按 Ctrl+Shift+V 开启语音", { kind: "info" });
  }
});

function updateChatModelChip() {
  if (!consoleChatModelChipLabel) return;
  const routing = state.workspace?.routing ?? {};
  const chatTask = Array.isArray(routing.tasks) ? routing.tasks.find((t) => t?.id === "chat" || t?.id === "chat.reply") : null;
  const label = chatTask?.model || routing.default_model || "auto";
  consoleChatModelChipLabel.textContent = String(label).slice(0, 28);
}
updateChatModelChip();

// UCA-125 Phase 7c: generic foldable panel-section.
// Any <section class="panel-section" data-foldable="true"> can be folded
// by clicking its header. Collapse state is persisted in localStorage
// under lingxy.panel-section.collapsed keyed by the section's aria-labelledby
// id (so the same section stays collapsed between reloads).
const FOLD_STORAGE_KEY = "lingxy.panel-section.collapsed";
function loadFoldState() {
  try {
    const raw = localStorage.getItem(FOLD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveFoldState(map) {
  try { localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
function wireFoldable(section, headerSelector) {
  const state = loadFoldState();
  const key = section.id || section.getAttribute("aria-labelledby") || null;
  if (key && state[key] === true) section.setAttribute("data-collapsed", "true");
  const header = section.querySelector(headerSelector);
  if (!header) return;
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  const toggle = (ev) => {
    if (ev.target.closest("button, input, select, textarea, label.toggle, [data-no-fold]")) return;
    const collapsed = section.getAttribute("data-collapsed") === "true";
    section.setAttribute("data-collapsed", collapsed ? "false" : "true");
    if (key) {
      const latest = loadFoldState();
      if (collapsed) delete latest[key]; else latest[key] = true;
      saveFoldState(latest);
    }
    header.setAttribute("aria-expanded", collapsed ? "true" : "false");
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      if (ev.target.closest("button, input, select, textarea")) return;
      ev.preventDefault();
      toggle(ev);
    }
  });
  header.setAttribute("aria-expanded", section.getAttribute("data-collapsed") === "true" ? "false" : "true");
}
function initFoldablePanelSections() {
  for (const section of document.querySelectorAll('.panel-section[data-foldable="true"]')) {
    wireFoldable(section, ":scope > .panel-section-header");
  }
  for (const group of document.querySelectorAll('.settings-group[data-foldable="true"]')) {
    wireFoldable(group, ":scope > .settings-group-head");
  }
}
initFoldablePanelSections();

// UCA-125 Phase 3-3: Settings sub-nav — clicking an anchor un-collapses
// the target foldable (if any), scrolls it into view, and moves the
// "active" highlight to the clicked link. IntersectionObserver then
// tracks which panel is in view during manual scrolling so the nav
// reflects the current section without needing extra clicks.
(function initSettingsNav() {
  const navLinks = Array.from(document.querySelectorAll(".settings-nav [data-settings-nav]"));
  if (navLinks.length === 0) return;
  const setActive = (id) => {
    for (const link of navLinks) {
      link.classList.toggle("active", link.dataset.settingsNav === id);
    }
  };
  for (const link of navLinks) {
    link.addEventListener("click", (ev) => {
      const id = link.dataset.settingsNav;
      const target = document.querySelector(`#${CSS.escape(id)}`);
      if (!target) return;
      ev.preventDefault();
      if (target.getAttribute("data-foldable") === "true" && target.getAttribute("data-collapsed") === "true") {
        target.setAttribute("data-collapsed", "false");
        const head = target.querySelector(":scope > .settings-group-head, :scope > .panel-section-header");
        if (head) head.setAttribute("aria-expanded", "true");
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
    });
  }
  const panels = navLinks
    .map((l) => document.querySelector(`#${CSS.escape(l.dataset.settingsNav)}`))
    .filter(Boolean);
  if (panels.length > 0 && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-20% 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] });
    for (const p of panels) io.observe(p);
  }
})();

/* ═══════════════════════════════════════════════════════════════════════════
   UCA-178: QUICK NOTES
   A lightweight notepad with formatting, tables/images/links, timestamps
   (light gray), chat-to-note adoption, voice input, and share/export.
   Persists locally via localStorage so it works offline and does not
   depend on the service being up.
   ═══════════════════════════════════════════════════════════════════════════ */
let notesReady = false;
function initNotesIfNeeded() {
  if (notesReady) {
    window.lingxyNotes?.refresh?.({ preserveSelection: true });
    return;
  }
  notesReady = true;
  initQuickNotes();
}

function initQuickNotes() {
  const LS_KEY = "lingxy.notes.v1";
  const LS_SELECTED = "lingxy.notes.selected";
  const LS_FONT_FAMILY = "lingxy.notes.fontFamily";
  const LS_FONT_SIZE = "lingxy.notes.fontSize";
  const LS_COLLAPSED_GROUPS = "lingxy.notes.collapsedGroups";

  const panel = document.getElementById("panel-notes");
  if (!panel) return;
  const listEl = panel.querySelector("#notesList");
  const emptyEl = panel.querySelector("#notesEmpty");
  const countLabel = panel.querySelector("#notesCountLabel");
  const searchInput = panel.querySelector("#notesSearchInput");
  const titleInput = panel.querySelector("#noteTitleInput");
  const createdTs = panel.querySelector("#noteCreatedTs");
  const updatedTs = panel.querySelector("#noteUpdatedTs");
  const bodyEl = panel.querySelector("#noteBody");
  const toolbar = panel.querySelector(".notes-toolbar");
  const fontSizeSel = panel.querySelector("#noteFontSize");
  const fontFamilySel = panel.querySelector("#noteFontFamily");
  const newBtn = panel.querySelector("#notesNewBtn");
  const deleteBtn = panel.querySelector("#noteDeleteBtn");
  const groupInput = panel.querySelector("#noteGroupInput");
  const groupPickerBtn = panel.querySelector("#noteGroupPickerBtn");
  const multiActions = panel.querySelector("#notesMultiActions");
  const multiCount = panel.querySelector("#notesMultiCount");
  const mergeBtn = panel.querySelector("#notesMergeBtn");
  const groupBtn = panel.querySelector("#notesGroupBtn");
  const multiCancelBtn = panel.querySelector("#notesMultiCancelBtn");
  const shareBtn = panel.querySelector("#noteShareBtn");
  const adoptFromChatBtn = panel.querySelector("#noteAdoptFromChatBtn");
  const voiceBtn = panel.querySelector("#noteVoiceBtn");
  const chatInput = panel.querySelector("#noteChatInput");
  const chatSendBtn = panel.querySelector("#noteChatSendBtn");
  const chatLog = panel.querySelector("#noteChatLog");

  if (!listEl || !bodyEl) return;
  bodyEl.setAttribute("data-placeholder", "Start typing, or paste an image, or say something into the mic…");

  // Capture the global runtime base URL before shadowing with our local state.
  const runtimeBaseUrl = (() => {
    try { return (window.__lingxyRuntimeBaseUrl) || document.querySelector("html")?.dataset?.runtimeUrl || null; }
    catch { return null; }
  })() ?? (typeof state === "object" && state?.serviceBaseUrl) ?? "http://127.0.0.1:4310";

  // ── Server-side notes sync (authoritative store) ──────────────────────
  // The runtime JSON store is authoritative. localStorage is now only a
  // first-paint cache so cross-window changes are never overwritten by an
  // older console snapshot.
  async function fetchNotesFromServer() {
    try {
      const resp = await fetch(`${runtimeBaseUrl}/notes`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return Array.isArray(data?.notes) ? data.notes : null;
    } catch { return null; }
  }
  async function seedNotesToServer(notes) {
    try {
      await saveNotesViaShell(notes);
    } catch { /* offline — localStorage cache still kept for next boot */ }
  }

  async function upsertNoteOnServer(note) {
    try {
      const data = await upsertNoteViaShell(note);
      return data?.note ?? note;
    } catch {
      return note;
    }
  }

  async function deleteNoteOnServer(id) {
    try {
      await deleteNoteViaShell(id);
    } catch { /* ignore */ }
  }

  async function appendChipOnServer({ noteId, text, sourceLabel = null }) {
    return appendNoteChipViaShell({ noteId, text, sourceLabel });
  }

  // ── Storage ────────────────────────────────────────────────────────────
  const notesState = {
    notes: loadNotes(),
    selectedId: (() => { try { return localStorage.getItem(LS_SELECTED); } catch { return null; } })(),
    searchQuery: "",
    saveTimer: null,
    pendingChatAdoption: null,
    selectedIds: new Set(),
    collapsedGroups: loadCollapsedGroups(),
    refreshToken: 0
  };

  function loadCollapsedGroups() {
    try {
      const raw = localStorage.getItem(LS_COLLAPSED_GROUPS);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
  function saveCollapsedGroups() {
    try { localStorage.setItem(LS_COLLAPSED_GROUPS, JSON.stringify([...notesState.collapsedGroups])); } catch { /* ignore */ }
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function saveNotes() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(notesState.notes)); } catch { /* ignore */ }
  }
  function rememberSelection(id) {
    try { localStorage.setItem(LS_SELECTED, id ?? ""); } catch { /* ignore */ }
  }

  function replaceNotes(nextNotes, { preserveSelection = true } = {}) {
    const prevSelected = preserveSelection ? notesState.selectedId : null;
    notesState.notes = Array.isArray(nextNotes) ? nextNotes : [];
    saveNotes();
    if (preserveSelection && prevSelected && notesState.notes.some((n) => n.id === prevSelected)) {
      notesState.selectedId = prevSelected;
    } else if (!notesState.notes.some((n) => n.id === notesState.selectedId)) {
      notesState.selectedId = notesState.notes[0]?.id ?? null;
    }
    rememberSelection(notesState.selectedId);
    renderList();
    renderEditor();
    updateRailBadge();
  }

  function upsertLocalNote(note) {
    if (!note?.id) return null;
    const idx = notesState.notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) notesState.notes[idx] = note;
    else notesState.notes.unshift(note);
    saveNotes();
    return note;
  }

  function removeLocalNote(id) {
    notesState.notes = notesState.notes.filter((n) => n.id !== id);
    saveNotes();
  }

  async function refreshNotesFromServer({ preserveSelection = true } = {}) {
    const refreshToken = ++notesState.refreshToken;
    const remote = await fetchNotesFromServer();
    if (!remote) return false;
    if (refreshToken !== notesState.refreshToken) return false;
    replaceNotes(remote, { preserveSelection });
    return true;
  }

  function knownGroups() {
    const set = new Set();
    for (const n of notesState.notes) {
      const g = (n.group || "").trim();
      if (g) set.add(g);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  function currentNote() {
    return notesState.notes.find((n) => n.id === notesState.selectedId) ?? null;
  }

  function ensureSelection() {
    if (!currentNote()) {
      if (notesState.notes.length > 0) {
        notesState.selectedId = notesState.notes[0].id;
      } else {
        const fresh = makeNote();
        notesState.notes.unshift(fresh);
        notesState.selectedId = fresh.id;
        saveNotes();
        void upsertNoteOnServer(fresh).then((saved) => {
          upsertLocalNote(saved);
          renderList();
          renderEditor();
        });
      }
      rememberSelection(notesState.selectedId);
    }
  }

  // ── List render ────────────────────────────────────────────────────────
  function sortedFiltered() {
    const q = notesState.searchQuery.trim().toLowerCase();
    const matches = (n) => !q
      || (n.title || "").toLowerCase().includes(q)
      || stripHtml(n.body_html || "").toLowerCase().includes(q);
    return [...notesState.notes].filter(matches)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }

  function renderList() {
    const items = sortedFiltered();
    countLabel.textContent = `${items.length}`;
    listEl.innerHTML = "";
    refreshGroupOptions();
    refreshMultiActions();
    if (items.length === 0) {
      listEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    listEl.hidden = false;
    emptyEl.hidden = true;

    // Bucket by group. Ungrouped goes first; named groups sorted alpha.
    const buckets = new Map();
    for (const n of items) {
      const key = (n.group || "").trim();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(n);
    }
    const ordered = [
      ...(buckets.has("") ? [["", buckets.get("")]] : []),
      ...[...buckets.entries()].filter(([k]) => k !== "").sort(([a], [b]) => a.localeCompare(b))
    ];
    const showHeaders = ordered.some(([k]) => k !== "");

    for (const [groupKey, groupItems] of ordered) {
      if (showHeaders) {
        const collapsed = groupKey !== "" && notesState.collapsedGroups.has(groupKey);
        const header = document.createElement("button");
        header.type = "button";
        header.className = "notes-group-header" + (collapsed ? " is-collapsed" : "");
        header.innerHTML = `
          <span class="ngh-caret">▾</span>
          <span class="ngh-name">${escapeHtml(groupKey || "未分组")}</span>
          <span class="ngh-count">${groupItems.length}</span>
        `;
        header.addEventListener("click", () => {
          if (groupKey === "") return;
          if (notesState.collapsedGroups.has(groupKey)) notesState.collapsedGroups.delete(groupKey);
          else notesState.collapsedGroups.add(groupKey);
          saveCollapsedGroups();
          renderList();
        });
        listEl.appendChild(header);
        if (collapsed) continue;
      }
      for (const n of groupItems) {
        const btn = document.createElement("button");
        btn.type = "button";
        const isSelected = notesState.selectedIds.has(n.id);
        btn.className = "note-item"
          + (n.id === notesState.selectedId ? " is-active" : "")
          + (isSelected ? " is-multi-selected" : "");
        btn.dataset.noteId = n.id;
        btn.innerHTML = `
          <div class="note-item-title">${escapeHtml(n.title || "Untitled note")}</div>
          <div class="note-item-snippet">${escapeHtml(stripHtml(n.body_html).slice(0, 110) || "Empty note")}</div>
          <div class="note-item-ts">${escapeHtml(fmtRel(n.updated_at))}</div>
        `;
        btn.addEventListener("click", (ev) => {
          // Ctrl/Cmd + click → toggle multi-select. Plain click → open.
          if (ev.ctrlKey || ev.metaKey) {
            if (notesState.selectedIds.has(n.id)) notesState.selectedIds.delete(n.id);
            else notesState.selectedIds.add(n.id);
            renderList();
            return;
          }
          // If we're in multi-select mode, plain click also toggles.
          if (notesState.selectedIds.size > 0) {
            if (notesState.selectedIds.has(n.id)) notesState.selectedIds.delete(n.id);
            else notesState.selectedIds.add(n.id);
            renderList();
            return;
          }
          selectNote(n.id);
        });
        listEl.appendChild(btn);
      }
    }
    updateRailBadge();
  }

  function refreshGroupOptions() {
    // No-op now that the picker is a click-dropdown built on demand
    // (see openGroupPicker). Kept as a stub so renderList() doesn't have
    // to special-case the old datalist callers.
  }

  function openGroupPicker(anchorEl) {
    const groups = knownGroups();
    document.querySelector(".note-target-popover.is-group-picker")?.remove();
    const popover = document.createElement("div");
    popover.className = "note-target-popover is-group-picker";
    popover.innerHTML = `
      <div class="ntp-head">选择分组</div>
      <div class="ntp-list">
        <button type="button" data-group-pick="" class="ntp-item">
          <span class="ntp-item-title">未分组</span>
        </button>
        ${groups.map((g) => `
          <button type="button" data-group-pick="${escapeHtml(g)}" class="ntp-item">
            <span class="ntp-item-title">${escapeHtml(g)}</span>
          </button>
        `).join("")}
        <button type="button" data-group-pick="__new__" class="ntp-item ntp-item-new">＋ 新建分组…</button>
      </div>
    `;
    document.body.appendChild(popover);
    const r = anchorEl.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 280, Math.max(8, r.left + window.scrollX));
    popover.style.left = `${left}px`;
    popover.style.top = `${r.bottom + window.scrollY + 4}px`;
    const close = () => { popover.remove(); document.removeEventListener("mousedown", outside, true); };
    const outside = (ev) => { if (!popover.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
    popover.querySelectorAll("[data-group-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        let value = btn.dataset.groupPick;
        if (value === "__new__") {
          const created = (prompt("新分组名称:", "") || "").trim();
          if (!created) { close(); return; }
          value = created;
        }
        applyGroupToCurrent(value);
        close();
      });
    });
  }

  function applyGroupToCurrent(value) {
    const note = currentNote();
    if (!note) return;
    note.group = (value || "").trim();
    note.updated_at = nowIso();
    if (groupInput) groupInput.value = note.group;
    saveNotes();
    renderList();
    void upsertNoteOnServer(note).then((saved) => {
      upsertLocalNote(saved);
      renderList();
      renderEditor();
    });
  }

  function refreshMultiActions() {
    if (!multiActions) return;
    const n = notesState.selectedIds.size;
    multiActions.hidden = n === 0;
    if (multiCount) multiCount.textContent = `${n} selected`;
  }

  function updateRailBadge() {
    const badge = document.getElementById("railBadgeNotes");
    if (!badge) return;
    const n = notesState.notes.length;
    if (n > 0) { badge.textContent = String(n); badge.hidden = false; }
    else { badge.hidden = true; }
  }

  // ── Editor render ──────────────────────────────────────────────────────
  function renderEditor() {
    const note = currentNote();
    if (!note) return;
    titleInput.value = note.title || "";
    bodyEl.innerHTML = note.body_html || "";
    if (groupInput) groupInput.value = note.group || "";
    createdTs.textContent = `Created ${fmtAbsolute(note.created_at)}`;
    updatedTs.textContent = `Edited ${fmtRel(note.updated_at)}`;
    applyFontFamily(readFontFamily());
    applyFontSize(readFontSize());
  }

  function readFontFamily() {
    try { return localStorage.getItem(LS_FONT_FAMILY) || "sans"; } catch { return "sans"; }
  }
  function readFontSize() {
    try { return Number(localStorage.getItem(LS_FONT_SIZE)) || 14; } catch { return 14; }
  }
  function applyFontFamily(fam) {
    bodyEl.setAttribute("data-font-family", fam);
    if (fontFamilySel) fontFamilySel.value = fam;
    try { localStorage.setItem(LS_FONT_FAMILY, fam); } catch { /* ignore */ }
  }
  function applyFontSize(size) {
    bodyEl.style.fontSize = `${size}px`;
    // Chrome's contenteditable bakes inline `style="font-size: …"` into
    // <span> wrappers during paste/typing. Those win over the body's
    // inline font-size via specificity, so the dropdown change appears
    // to do nothing. Sweep the editor and clear any inline font-size
    // (and the related font-* shorthand) — the body's inline rule
    // then takes over via inheritance. Chip content is force-inherited
    // via CSS, so this pass is for plain user-typed paragraphs.
    try {
      for (const el of bodyEl.querySelectorAll("[style*='font-size']")) {
        el.style.removeProperty("font-size");
        if (!el.getAttribute("style")) el.removeAttribute("style");
      }
    } catch { /* ignore — contenteditable can be in odd states */ }
    if (fontSizeSel) fontSizeSel.value = String(size);
    try { localStorage.setItem(LS_FONT_SIZE, String(size)); } catch { /* ignore */ }
  }

  function selectNote(id) {
    notesState.selectedId = id;
    rememberSelection(id);
    renderList();
    renderEditor();
  }

  // ── Save (debounced) ──────────────────────────────────────────────────
  function scheduleSave() {
    if (notesState.saveTimer) clearTimeout(notesState.saveTimer);
    notesState.saveTimer = setTimeout(() => {
      const note = currentNote();
      if (!note) return;
      const prevLen = (note.body_html || "").length;
      note.title = titleInput.value;
      note.body_html = bodyEl.innerHTML;
      note.updated_at = nowIso();
      // keep a light edit log (capped at 50) so future UI can show activity
      note.history = note.history || [];
      note.history.push({ ts: note.updated_at, bytes: note.body_html.length - prevLen });
      if (note.history.length > 50) note.history = note.history.slice(-50);
      saveNotes();
      updatedTs.textContent = `Edited ${fmtRel(note.updated_at)}`;
      renderList();
      void upsertNoteOnServer(note).then((saved) => {
        upsertLocalNote(saved);
        renderList();
        if (saved.id === currentNote()?.id) renderEditor();
      });
    }, 350);
  }

  titleInput.addEventListener("input", scheduleSave);
  bodyEl.addEventListener("input", scheduleSave);

  // ── Group input ───────────────────────────────────────────────────────
  groupInput?.addEventListener("change", () => applyGroupToCurrent(groupInput.value));
  groupPickerBtn?.addEventListener("click", () => openGroupPicker(groupPickerBtn));
  // Clicking the chip area (not just the arrow) opens the picker too —
  // the input still works for free-text entry.
  groupInput?.addEventListener("focus", () => openGroupPicker(groupPickerBtn ?? groupInput));

  // ── Multi-select actions ──────────────────────────────────────────────
  multiCancelBtn?.addEventListener("click", () => {
    notesState.selectedIds.clear();
    renderList();
  });

  groupBtn?.addEventListener("click", () => {
    if (notesState.selectedIds.size === 0) return;
    const target = prompt("移到分组（留空 = 取消分组）:", "");
    if (target === null) return;
    const group = target.trim();
    const changed = [];
    for (const id of notesState.selectedIds) {
      const n = notesState.notes.find((x) => x.id === id);
      if (n) {
        n.group = group;
        n.updated_at = nowIso();
        changed.push({ ...n });
      }
    }
    saveNotes();
    notesState.selectedIds.clear();
    renderList();
    renderEditor();
    void Promise.all(changed.map((note) => upsertNoteOnServer(note)));
  });

  mergeBtn?.addEventListener("click", () => {
    if (notesState.selectedIds.size < 2) {
      toastNote("至少选择两条笔记才能合并");
      return;
    }
    if (!confirm(`合并 ${notesState.selectedIds.size} 条笔记为一条新笔记？原笔记将被删除。`)) return;
    mergeSelected();
  });

  function mergeSelected() {
    const picked = notesState.notes
      .filter((n) => notesState.selectedIds.has(n.id))
      .sort((a, b) => (a.updated_at || "").localeCompare(b.updated_at || ""));
    if (picked.length < 2) return;
    const merged = makeNote();
    merged.title = picked[0].title || picked.find((n) => n.title)?.title || "Merged note";
    merged.group = picked[0].group || "";
    const parts = [];
    for (const n of picked) {
      const stamp = `<div class="note-stamp" contenteditable="false">${escapeHtml(n.title || "Untitled note")} · ${escapeHtml(fmtAbsolute(n.updated_at))}</div>`;
      parts.push(stamp + (n.body_html || ""));
    }
    merged.body_html = parts.join('<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">');
    const removedIds = [...notesState.selectedIds];
    notesState.notes = notesState.notes.filter((n) => !notesState.selectedIds.has(n.id));
    notesState.notes.unshift(merged);
    notesState.selectedId = merged.id;
    notesState.selectedIds.clear();
    saveNotes();
    rememberSelection(merged.id);
    renderList();
    renderEditor();
    void Promise.all([
      upsertNoteOnServer(merged),
      ...removedIds.map((id) => deleteNoteOnServer(id))
    ]);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────
  toolbar?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-cmd]");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    bodyEl.focus();
    runFormatCommand(cmd);
    scheduleSave();
  });

  function runFormatCommand(cmd) {
    if (!cmd) return;
    if (cmd.startsWith("formatBlock:")) {
      const tag = cmd.split(":")[1];
      document.execCommand("formatBlock", false, tag);
      return;
    }
    if (cmd === "link") {
      const url = prompt("Link URL:");
      if (!url) return;
      document.execCommand("createLink", false, url);
      return;
    }
    if (cmd === "image") {
      const url = prompt("Image URL (or leave blank to pick a file):");
      if (url) { document.execCommand("insertImage", false, url); return; }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          document.execCommand("insertImage", false, reader.result);
          scheduleSave();
        };
        reader.readAsDataURL(file);
      });
      input.click();
      return;
    }
    if (cmd === "table") {
      const rows = 3, cols = 3;
      const cells = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, () => r === 0 ? "<th>&nbsp;</th>" : "<td>&nbsp;</td>").join("")
      ).map((r) => `<tr>${r}</tr>`).join("");
      document.execCommand("insertHTML", false, `<table>${cells}</table><p><br></p>`);
      return;
    }
    if (cmd === "stamp") {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      document.execCommand("insertHTML", false, `<span class="note-stamp" contenteditable="false">${escapeHtml(stamp)}</span>&nbsp;`);
      return;
    }
    document.execCommand(cmd, false, null);
  }

  fontSizeSel?.addEventListener("change", () => applyFontSize(Number(fontSizeSel.value) || 14));
  fontFamilySel?.addEventListener("change", () => applyFontFamily(fontFamilySel.value));

  // Paste image (image + clipboard data as image blob).
  bodyEl.addEventListener("paste", (ev) => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        ev.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          document.execCommand("insertImage", false, reader.result);
          scheduleSave();
        };
        reader.readAsDataURL(item.getAsFile());
        return;
      }
    }
  });

  // ── New / delete ──────────────────────────────────────────────────────
  newBtn?.addEventListener("click", () => {
    const fresh = makeNote();
    notesState.notes.unshift(fresh);
    notesState.selectedId = fresh.id;
    saveNotes();
    rememberSelection(fresh.id);
    renderList();
    renderEditor();
    titleInput.focus();
    void upsertNoteOnServer(fresh).then((saved) => {
      upsertLocalNote(saved);
      renderList();
      renderEditor();
    });
  });

  deleteBtn?.addEventListener("click", () => {
    const note = currentNote();
    if (!note) return;
    if (!confirm(`Delete "${note.title || "Untitled note"}"?`)) return;
    removeLocalNote(note.id);
    saveNotes();
    ensureSelection();
    renderList();
    renderEditor();
    void deleteNoteOnServer(note.id);
  });

  // ── Search ────────────────────────────────────────────────────────────
  searchInput?.addEventListener("input", () => {
    notesState.searchQuery = searchInput.value || "";
    renderList();
  });

  // ── Share / export ────────────────────────────────────────────────────
  shareBtn?.addEventListener("click", () => openShareDialog());

  function openShareDialog() {
    const note = currentNote();
    if (!note) return;
    const backdrop = document.createElement("div");
    backdrop.className = "notes-share-backdrop";
    backdrop.innerHTML = `
      <div class="notes-share-dialog" role="dialog" aria-modal="true" aria-label="Share note">
        <h2>Share note</h2>
        <div class="notes-share-sub">${escapeHtml(note.title || "Untitled note")}</div>
        <label class="notes-share-row">
          <input type="checkbox" id="shareWithTs" checked>
          <span>Include timestamps (created + last edited)</span>
        </label>
        <label class="notes-share-row">
          <input type="checkbox" id="shareInline">
          <span>Inline timestamp stamps inserted in body</span>
        </label>
        <div class="notes-share-actions">
          <button class="btn btn-sm btn-ghost" data-share="cancel">Cancel</button>
          <button class="btn btn-sm btn-ghost" data-share="copy-md">Copy as Markdown</button>
          <button class="btn btn-sm btn-ghost" data-share="copy-text">Copy as text</button>
          <button class="btn btn-sm btn-ghost" data-share="download-md">Download .md</button>
          <button class="btn btn-sm btn-primary" data-share="download-html">Download .html</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    const cb = backdrop.querySelector("#shareWithTs");
    const cbInline = backdrop.querySelector("#shareInline");

    backdrop.querySelectorAll("[data-share]").forEach((b) => {
      b.addEventListener("click", () => {
        const action = b.dataset.share;
        if (action === "cancel") { close(); return; }
        const opts = { withTimestamps: cb.checked, keepInlineStamps: cbInline.checked };
        if (action === "copy-md") copyToClipboard(exportAsMarkdown(note, opts));
        else if (action === "copy-text") copyToClipboard(exportAsText(note, opts));
        else if (action === "download-md") downloadFile(exportAsMarkdown(note, opts), noteFilename(note, "md"), "text/markdown");
        else if (action === "download-html") downloadFile(exportAsHtml(note, opts), noteFilename(note, "html"), "text/html");
        close();
      });
    });
  }

  function copyToClipboard(text) {
    try {
      navigator.clipboard?.writeText?.(text);
    } catch { /* ignore */ }
  }
  function downloadFile(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Adopt from chat ───────────────────────────────────────────────────
  adoptFromChatBtn?.addEventListener("click", () => adoptLastChatReply());

  function adoptLastChatReply() {
    // Pull the last assistant bubble out of #consoleChatMessages if present.
    const feed = document.querySelector("#consoleChatMessages");
    if (!feed) { toastNote("No chat to adopt from"); return; }
    const msgs = feed.querySelectorAll(".chat-msg.assistant .chat-msg-bubble, .chat-msg.ai .chat-msg-bubble");
    const last = msgs[msgs.length - 1];
    if (!last) { toastNote("No assistant reply yet"); return; }
    appendAdoptedChip(last.dataset.rawText || last.textContent || "");
  }

  function appendAdoptedChip(text) {
    const note = currentNote();
    if (!note) return;
    void appendChipToNoteRecord(note, text);
    bodyEl.focus();
  }

  // Append text as a "note-chat-chip" block to a note record. Always
  // updates body_html + saves; if the target IS the currently-loaded
  // note, also mirrors into the live editor DOM so the user sees the
  // chip without a re-render. Previously the active-note branch only
  // touched the DOM and never persisted, so on next reload the chip
  // disappeared (UCA-181 bug).
  async function appendChipToNoteRecord(note, text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    try {
      const result = await appendChipOnServer({
        noteId: note.id,
        text: trimmed,
        sourceLabel: "From chat"
      });
      const savedNote = result?.note ?? note;
      upsertLocalNote(savedNote);
      if (savedNote.id !== notesState.selectedId) {
        notesState.selectedId = savedNote.id;
        rememberSelection(savedNote.id);
      }
      renderList();
      renderEditor();
      return savedNote;
    } catch {
      const safe = escapeHtml(trimmed);
      const chipHtml = `<div class="note-chat-chip">${safe}</div><p><br></p>`;
      note.body_html = (note.body_html || "") + chipHtml;
      note.updated_at = nowIso();
      saveNotes();
      renderList();
      renderEditor();
      return note;
    }
  }

  // ── Public API for the chat composer / selection pill ─────────────────
  window.lingxyNotes = {
    list() {
      return [...notesState.notes]
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
        .map((n) => ({
          id: n.id,
          title: n.title || "Untitled note",
          snippet: stripHtml(n.body_html || "").slice(0, 70)
        }));
    },
    createNote() {
      const fresh = makeNote();
      notesState.notes.unshift(fresh);
      notesState.selectedId = fresh.id;
      saveNotes();
      rememberSelection(fresh.id);
      renderList();
      renderEditor();
      void upsertNoteOnServer(fresh).then((saved) => {
        upsertLocalNote(saved);
        renderList();
        renderEditor();
      });
      return fresh.id;
    },
    async addToNote(noteId, text) {
      if (!text) return;
      const note = notesState.notes.find((n) => n.id === noteId);
      if (!note) return;
      // Auto-select the target so the user actually sees the chip after
      // the chat-to-note action (the previous version added to whatever
      // was selected without surfacing the change).
      if (note.id !== notesState.selectedId) {
        notesState.selectedId = note.id;
        rememberSelection(note.id);
        renderEditor();
      }
      await appendChipToNoteRecord(note, text);
    },
    async refresh({ preserveSelection = true } = {}) {
      return refreshNotesFromServer({ preserveSelection });
    },
    bodyText(noteId) {
      const note = notesState.notes.find((n) => n.id === noteId);
      return stripHtml(note?.body_html || "");
    }
  };

  function toastNote(msg) {
    // Reuse the global shell notification if available, otherwise fall
    // back to an inline chat log line.
    if (window.ucaShell?.notify) {
      try { window.ucaShell.notify({ title: "Notes", body: msg, kind: "info", autoHideMs: 2500 }); return; } catch { /* ignore */ }
    }
    console.info("[notes]", msg);
  }

  // ── In-note chat (local-only) ─────────────────────────────────────────
  chatSendBtn?.addEventListener("click", () => sendNoteChat());
  chatInput?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sendNoteChat(); } });

  async function sendNoteChat() {
    const text = (chatInput.value || "").trim();
    if (!text) return;
    chatInput.value = "";
    chatLog.hidden = false;

    appendChatLogRow("You", text);

    const note = currentNote();
    const body = stripHtml(note?.body_html || "").slice(0, 3500);
    const prompt = `Note title: ${note?.title || "Untitled"}\nNote body:\n${body}\n\nUser: ${text}\n\nReply concisely. If helpful, suggest text to add to the note.`;

    // Try talking to the local runtime's chat endpoint if available.
    let reply = "";
    try {
      reply = await tryRuntimeChat(prompt);
    } catch {
      // Fall back to echoing a useful hint so the UI is never broken.
      reply = "(offline) No response. Try again when the runtime is up.";
    }
    const row = appendChatLogRow("AI", reply);

    // Offer "Add to note" for every AI reply — the user either approves
    // explicitly or dismisses. This is the "用户同意…直接加入 note" flow.
    const actions = document.createElement("div");
    actions.className = "note-chat-actions";
    const addBtn = document.createElement("button");
    addBtn.className = "note-chat-btn";
    addBtn.textContent = "Add to note";
    addBtn.addEventListener("click", () => {
      appendAdoptedChip(reply);
      addBtn.disabled = true;
      addBtn.textContent = "Added ✓";
    });
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "note-chat-btn";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", () => { row.remove(); });
    actions.appendChild(addBtn);
    actions.appendChild(dismissBtn);
    row.appendChild(actions);
  }

  function appendChatLogRow(role, text) {
    const row = document.createElement("div");
    row.className = "note-chat-row";
    row.innerHTML = `<div class="note-chat-role">${escapeHtml(role)}</div><div class="note-chat-text"></div>`;
    row.querySelector(".note-chat-text").textContent = text;
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
    return row;
  }

  async function tryRuntimeChat(prompt) {
    // state.serviceBaseUrl is the outer console.js global (captured via
    // closure); runtimeBaseUrl is the pre-shadow fallback we stored above.
    const baseUrl = (typeof state === "object" && state?.serviceBaseUrl) || runtimeBaseUrl;
    const url = baseUrl ? `${baseUrl}/chat/complete` : "/chat/complete";
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.text ?? data.message ?? data.content ?? JSON.stringify(data).slice(0, 400);
  }

  // ── Voice input (SpeechRecognition with MediaRecorder fallback) ───────
  voiceBtn?.addEventListener("click", () => toggleVoiceInput());
  let voiceRec = null;
  function toggleVoiceInput() {
    if (voiceRec) { try { voiceRec.stop(); } catch {} voiceRec = null; voiceBtn.classList.remove("is-active"); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toastNote("Voice dictation not available in this window; use the global Ctrl+Shift+N voice-note shortcut.");
      return;
    }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
      }
      if (finalText) {
        document.execCommand("insertText", false, finalText + " ");
        scheduleSave();
      }
    };
    rec.onerror = () => { voiceRec = null; voiceBtn.classList.remove("is-active"); };
    rec.onend = () => { voiceRec = null; voiceBtn.classList.remove("is-active"); };
    voiceRec = rec;
    voiceBtn.classList.add("is-active");
    try { rec.start(); } catch { voiceRec = null; voiceBtn.classList.remove("is-active"); }
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  ensureSelection();
  renderList();
  renderEditor();
  updateRailBadge();

  // Hydrate from the runtime's notes store. Server is authoritative —
  // if the user added chips from the overlay window or another session,
  // they show up here without a console refresh. Local cache is a
  // first-paint fallback for offline boot.
  void (async () => {
    const remote = await fetchNotesFromServer();
    if (!remote) return;
    if (remote.length === 0 && notesState.notes.length > 0) {
      // First boot of the new server store — push the local cache up so
      // pre-existing notes from before UCA-181 are not lost.
      await seedNotesToServer(notesState.notes);
      return;
    }
    replaceNotes(remote, { preserveSelection: true });
  })();
}

// UCA-182 Phase 6: wire the Preview settings panel buttons. These
// listeners are attached at module load because the elements live in
// the Settings tab's static HTML; no runtime mount/unmount to track.
document.getElementById("previewRefreshBtn")?.addEventListener("click", () => {
  void renderPreviewSettings();
});
document.getElementById("previewCacheClearBtn")?.addEventListener("click", async () => {
  try {
    await clearPreviewCacheViaShell();
  } catch (error) {
    console.warn("preview cache clear failed", error);
  }
  void renderPreviewSettings();
});
