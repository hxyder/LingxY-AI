import {
  applyTaskEventPatch,
  applyTaskEventToDetail,
  formatTaskEventSummary,
  subscribeTaskEvents,
  toTaskEventFrame
} from "./task-event-stream.js";
import {
  buildScheduleActionFromText,
  parseScheduleTriggerFromText
} from "./schedule-parser.js";
import {
  BUILTIN_API_TEMPLATES,
  codeCliModelChoices,
  modeOptionsForProvider as catalogModeOptionsForProvider,
  reasoningOptionsForProvider as catalogReasoningOptionsForProvider,
  providerFingerprint,
  providerModelPresets
} from "../../shared/provider-catalog.mjs";

const runtimeState = document.querySelector("#runtimeState");
const summaryGrid = document.querySelector("#summaryGrid");
const integrationList = document.querySelector("#integrationList");
const refreshButton = document.querySelector("#refreshButton");
const openOverlayButton = document.querySelector("#openOverlayButton");
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
const skillRegistryCount = document.querySelector("#skillRegistryCount");
const skillRegistryForm = document.querySelector("#skillRegistryForm");
const skillRegistryId = document.querySelector("#skillRegistryId");
const skillRegistryName = document.querySelector("#skillRegistryName");
const skillRegistryPath = document.querySelector("#skillRegistryPath");
const skillRegistryState = document.querySelector("#skillRegistryState");
const skillRegistryList = document.querySelector("#skillRegistryList");
const skillRegistryRefreshBtn = document.querySelector("#skillRegistryRefreshBtn");
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

let selectedTaskEventStream = null;
let selectedTaskEventTaskId = null;
let selectedTaskEventBaseUrl = null;
let handledSelectedTaskEventIds = new Set();
let consoleChatEventStream = null;
let consoleChatResultTaskIds = new Set();
let consoleChatToolCardCounter = 0;
let consoleChatToolCards = new Map();
const scheduleRunTaskWatchers = new Map();
const completedScheduleRunTaskIds = new Set();
let editingSkillPath = null;

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

async function createScheduleFromConsole() {
  const whenText = scheduleWhenInput.value.trim();
  const commandText = scheduleCommandInput.value.trim();
  if (!whenText || !commandText) {
    scheduleCreateState.textContent = "Please fill both fields.";
    return;
  }

  const trigger = parseScheduleTriggerInput(whenText);
  const scheduledAction = buildScheduleActionFromText(commandText);
  scheduleCreateState.textContent = "Creating...";
  try {
    const result = await fetchJson("/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: commandText.slice(0, 40),
        trigger,
        action: scheduledAction.action,
        executionMode: scheduledAction.executionMode,
        oneShot: Boolean(trigger.oneShot),
        title: "UCA 提醒",
        message: commandText,
        userCommand: commandText,
        createdBy: "desktop_console"
      })
    });
    scheduleCreateState.textContent = `Created · next ${formatDateTime(result.schedule?.next_run_at)}`;
    scheduleWhenInput.value = "";
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
  if (!consoleChatMessages || !text) return;
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
  bubble.textContent = text;
  body.appendChild(bubble);

  wrapper.appendChild(body);
  consoleChatMessages.appendChild(wrapper);
  consoleChatMessages.scrollTop = consoleChatMessages.scrollHeight;
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
  consoleChatMessages.scrollTop = consoleChatMessages.scrollHeight;
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
  consoleChatMessages.scrollTop = consoleChatMessages.scrollHeight;
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
  if (directText) {
    appendConsoleChatMessage("assistant", directText);
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
    appendConsoleChatMessage(task?.status === "failed" ? "system" : "assistant", settledText);
    consoleChatResultTaskIds.add(taskId);
  } catch {
    /* optional */
  }
}

function subscribeConsoleChatTask(taskId) {
  consoleChatEventStream?.close?.();
  consoleChatToolCards = new Map();
  consoleChatEventStream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(rawEvent) {
      const frame = toTaskEventFrame(rawEvent);
      const payload = frame.data ?? {};
      if (frame.event === "tool_call_proposed" || frame.event === "tool_call_started") {
        const toolName = payload.tool_id ?? payload.tool ?? "tool";
        const args = payload.args ?? {};
        const id = createConsoleChatToolCard(toolName, args, { state: "running" });
        if (!payload.__consoleToolCardId) payload.__consoleToolCardId = id;
        consoleChatState.textContent = `Running ${toolName}...`;
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
      } else if (frame.event === "inline_result") {
        appendConsoleChatMessage("assistant", payload.text ?? payload.message ?? "");
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Done.";
      } else if (frame.event === "failed") {
        appendConsoleChatMessage("system", payload.message ?? "Task failed.");
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Failed.";
      } else if (frame.event === "success" || frame.event === "partial_success") {
        void appendConsoleChatFinalResult(taskId, payload);
        consoleChatState.textContent = frame.event === "partial_success" ? "Partially done." : "Done.";
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
  try {
    window.ucaShell?.notify?.({
      title: "LingxY",
      body: copy.body,
      openWindow: "console"
    });
  } catch { /* optional */ }
  try {
    window.ucaShell?.showPopupCard?.({
      kind: copy.kind,
      taskId,
      title: copy.title,
      lines: copy.lines,
      autoHideMs: copy.kind === "error" ? 12000 : 9000
    });
  } catch { /* optional */ }
}

async function settleScheduleRunTask(taskId) {
  if (!taskId) return;
  closeScheduleRunTaskWatcher(taskId);
  try {
    const detail = await fetchJson(`/task/${encodeURIComponent(taskId)}`);
    const task = detail?.task ?? detail ?? null;
    if (!task) return;
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
    fireScheduleRunCompletionNotice(task);
    void refreshWorkspace();
    return;
  }
  if (scheduleRunTaskWatchers.has(taskId)) return;
  const stream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(rawEvent) {
      const frame = toTaskEventFrame(rawEvent);
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
  appendConsoleChatMessage("user", text);
  consoleChatInput.value = "";
  consoleChatState.textContent = "Submitting...";
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
        ...(attachedFilePaths.length > 0 ? { filePaths: attachedFilePaths } : {})
      })
    });
    const taskId = result.task?.task_id;
    consoleChatState.textContent = taskId ? `Running ${taskId}` : "Running...";
    if (taskId) {
      consoleChatResultTaskIds.delete(taskId);
      subscribeConsoleChatTask(taskId);
    }
    await refreshWorkspace();
    updateChatModelChip?.();
    consoleChatAttachList.length = 0;
    renderChatAttachments?.();
  } catch (error) {
    appendConsoleChatMessage("system", error.message);
    consoleChatState.textContent = "Failed.";
  }
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
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
const DEFAULT_PROJECT_ID = "proj_default";

// UCA-122: map a file extension → v3 .artifact-icon variant class.
// The CSS defines colored badges for doc/pdf/md/csv/png/txt.
function artifactIconClass(ext = "") {
  const e = String(ext).toLowerCase();
  if (e === "pdf") return "pdf";
  if (e === "md" || e === "markdown") return "md";
  if (e === "csv" || e === "tsv") return "csv";
  if (e === "png" || e === "jpg" || e === "jpeg" || e === "gif" || e === "webp") return "png";
  if (e === "txt" || e === "log") return "txt";
  if (e === "docx" || e === "doc" || e === "xlsx" || e === "xls" || e === "pptx" || e === "ppt") return "doc";
  return "txt";
}

function formatArtifactLabel(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  if (p.endsWith(".md")) return "Markdown";
  if (p.endsWith(".txt")) return "Text";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "HTML";
  if (p.endsWith(".json")) return "JSON";
  if (p.endsWith(".csv")) return "CSV";
  if (p.endsWith(".docx")) return "Word";
  if (p.endsWith(".xlsx")) return "Excel";
  if (p.endsWith(".pdf")) return "PDF";
  for (const ext of CODE_EXTENSIONS) {
    if (p.endsWith(ext)) return `Code ${ext.replace(".", "")}`;
  }
  return "File";
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
        await fetchJson(`/config/email/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
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
  emailDigestEnabled.checked = enabled;
  emailDigestWindowStart.value = settings.windowStart ?? "06:00";
  emailDigestWindowEnd.value = settings.windowEnd ?? "12:00";
  emailDigestSkipWeekends.checked = Boolean(settings.skipWeekends);
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
        await fetchJson(`/config/mcp/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
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
        await fetchJson(`/config/skills/registries/${encodeURIComponent(id)}`, { method: "DELETE" });
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
        await fetchJson(`/config/code-cli/adapters/${encodeURIComponent(id)}`, { method: "DELETE" });
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

const TASK_TYPES = [
  { id: "chat", label: "Chat / Q&A", desc: "General conversation, summarize, translate, explain" },
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
  if (provider.supportsVision === true) return true;
  if (provider.supportsVision === false) return false;
  if (provider.kind === "anthropic" && provider.apiKey) return true;
  if (provider.kind === "openai" && provider.apiKey) {
    const fp = `${provider.baseUrl ?? ""} ${provider.defaultModel ?? ""} ${provider.name ?? ""}`.toLowerCase();
    return /api\.openai\.com|generativelanguage|gemini|glm|qwen|pixtral|mistral|openrouter|siliconflow|gpt-4o|gpt-4-vision|claude-3|claude-sonnet|claude-opus|doubao|ark|volces/.test(fp);
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
  if (!cached?.models?.length) return null;
  return uniqueModelChoices(cached.models);
}

async function loadProviderModelOptions(providerId) {
  if (!providerId || providerModelOptionsCache.has(providerId) || providerModelOptionsLoading.has(providerId)) return;
  providerModelOptionsLoading.add(providerId);
  try {
    const data = await fetchJson(`/config/provider-model-options?providerId=${encodeURIComponent(providerId)}`);
    if (data.option) providerModelOptionsCache.set(providerId, data.option);
  } catch (error) {
    providerModelOptionsCache.set(providerId, {
      source: "unavailable",
      models: [],
      reasoningEfforts: [],
      error: error.message
    });
  } finally {
    providerModelOptionsLoading.delete(providerId);
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
    return cachedChoices;
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
    const isActive = isCli ? Boolean(p.command) : Boolean(p.apiKey);
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
      await fetchJson(`/config/providers/${encodeURIComponent(btn.dataset.deleteProvider)}`, { method: "DELETE" });
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
    }

    // For code_cli we render labelled choices (id + label). For API kinds we
    // keep the old "preset as plain string" flow since those model IDs are
    // the display text.
    let modelOptions = "";
    const optionMeta = selectedProvider?.id ? providerModelOptionsCache.get(selectedProvider.id) : null;
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
          ? `模型列表来自 ${optionMeta.source}`
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
    payload.apiKey = document.getElementById("provApiKey").value.trim();
  }

  await fetchJson("/config/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  closeProviderModal();
  await loadProvidersAndRouting();
});

document.getElementById("saveRoutingBtn")?.addEventListener("click", async () => {
  const stateEl = document.getElementById("routingSaveState");
  stateEl.textContent = "Saving...";
  try {
    await fetchJson("/config/routing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskRouting)
    });
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
    const status = await fetchJson("/setup/office-addins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        elevate: true,
        resetCache: true
      })
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
    const emptyMsg = allTasks.length === 0
      ? "No tasks yet."
      : `No tasks match this filter${search ? ` + search "${search}"` : ""}.`;
    renderEmpty(taskList, emptyMsg);
    // Don't clobber the selected detail when the only reason the list is
    // empty is that the filter hides the selected task.
    if (allTasks.length === 0) {
      state.selectedTaskId = null;
      renderTaskDetail(null);
    }
    return;
  }

  function buildTaskListEntries(list) {
    const byId = new Map(list.map((task) => [task.task_id, task]));
    const childrenByParent = new Map();
    for (const task of list) {
      if (task.parent_task_id) {
        if (!childrenByParent.has(task.parent_task_id)) {
          childrenByParent.set(task.parent_task_id, []);
        }
        childrenByParent.get(task.parent_task_id).push(task);
      }
    }

    for (const [parentId, children] of childrenByParent) {
      children.sort((a, b) => (a.child_index ?? 0) - (b.child_index ?? 0));
      childrenByParent.set(parentId, children);
    }

    const parentsOrSingles = list.filter((task) => !task.parent_task_id);
    const sorted = parentsOrSingles.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    const entries = [];
    for (const task of sorted) {
      if (entries.length >= 12) break;
      entries.push({ task, indent: 0, isChild: false });
      const children = childrenByParent.get(task.task_id) ?? [];
      for (const child of children) {
        if (entries.length >= 12) break;
        entries.push({ task: child, indent: 1, isChild: true });
      }
    }

    const seen = new Set(entries.map((entry) => entry.task.task_id));
    for (const task of list) {
      if (entries.length >= 12) break;
      if (seen.has(task.task_id)) continue;
      entries.push({ task, indent: 0, isChild: false });
    }

    return entries;
  }

  if (!state.selectedTaskId || !tasks.some((t) => t.task_id === state.selectedTaskId)) {
    state.selectedTaskId = tasks[0].task_id;
  }

  const entries = buildTaskListEntries(tasks);
  taskList.innerHTML = entries.map(({ task, indent, isChild }) => {
    const selected = task.task_id === state.selectedTaskId;
    const sc = task.status === "success" ? "ready" : task.status === "failed" ? "danger" : "warning";
    const childCount = Number(task.child_count ?? 0) || (Array.isArray(task.child_task_ids) ? task.child_task_ids.length : 0);
    return `
      <button class="task-item ${selected ? "selected" : ""}" data-task-id="${escapeHtml(task.task_id)}" style="text-align:left;${indent ? "margin-left:18px;" : ""}">
        <div class="row">
          <div>
            <h4>${isChild ? "<span class=\"muted\" style=\"margin-right:6px;\">↳</span>" : childCount > 0 ? "<span class=\"muted\" style=\"margin-right:6px;\">▸</span>" : ""}${escapeHtml(task.user_command ?? task.intent ?? "Unnamed")}${childCount > 0 ? ` <span class="chip muted" style="font-size:10px;padding:2px 6px;">${escapeHtml(childCount)}</span>` : ""}</h4>
            <p class="muted">${escapeHtml(task.executor ?? "unknown")} · ${escapeHtml(task.source_type ?? "unknown")}</p>
          </div>
          <span class="chip ${sc}">${escapeHtml(task.status)}</span>
        </div>
        <p class="muted" style="margin-top:6px;">${escapeHtml(formatDateTime(task.created_at))}</p>
      </button>
    `;
  }).join("");

  for (const btn of taskList.querySelectorAll("[data-task-id]")) {
    btn.addEventListener("click", () => {
      state.selectedTaskId = btn.dataset.taskId;
      renderTasks();
      void refreshTaskDetail();
    });
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

/* ── Task Event Stream ── */
function closeSelectedTaskEventStream() {
  selectedTaskEventStream?.close?.();
  selectedTaskEventStream = null;
  selectedTaskEventTaskId = null;
  selectedTaskEventBaseUrl = null;
  handledSelectedTaskEventIds = new Set();
}

function updateTaskInWorkspace(taskId, patchEvent) {
  const i = state.workspace.tasks.findIndex((t) => t.task_id === taskId);
  if (i === -1) return null;
  const next = applyTaskEventPatch(state.workspace.tasks[i], patchEvent);
  state.workspace.tasks[i] = next;
  return next;
}

async function handleSelectedTaskEventFrame(rawEvent) {
  const frame = toTaskEventFrame(rawEvent);
  if (frame.id && handledSelectedTaskEventIds.has(frame.id)) return;
  if (frame.id) handledSelectedTaskEventIds.add(frame.id);

  const updated = updateTaskInWorkspace(state.selectedTaskId, frame);
  if (updated) { renderSummary(); renderTasks(); }

  if (state.selectedTaskDetail?.task?.task_id === state.selectedTaskId) {
    state.selectedTaskDetail = applyTaskEventToDetail(state.selectedTaskDetail, frame);
    renderTaskDetail(state.selectedTaskDetail);
  }

  if (["artifact_created", "success", "partial_success", "failed", "cancelled"].includes(frame.event)) {
    await refreshTaskDetail();
  }
}

function ensureSelectedTaskEventStream(taskId) {
  if (!taskId) { closeSelectedTaskEventStream(); return; }
  if (selectedTaskEventTaskId === taskId && selectedTaskEventBaseUrl === state.serviceBaseUrl && selectedTaskEventStream) return;

  closeSelectedTaskEventStream();
  selectedTaskEventTaskId = taskId;
  selectedTaskEventBaseUrl = state.serviceBaseUrl;
  selectedTaskEventStream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(event) { void handleSelectedTaskEventFrame(event); },
    onError(error) {
      // UCA-P0-D: route stream errors to the rail sys indicator (below)
      // instead of the retired topbar pill next to the page title.
      const railSysText = document.querySelector("#railSysText");
      const railSys = document.querySelector("#railSys");
      if (railSysText) railSysText.textContent = `Stream disconnected · ${error.message}`;
      if (railSys) railSys.classList.add("rail-sys--warn");
    }
  });
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
  const ext = (artifactPath.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
  icon.className = `artifact-icon ${artifactIconClass(ext)}`;
  icon.textContent = (ext || "FILE").toUpperCase().slice(0, 3);
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
  taskArtifactList.innerHTML = artifacts.map((a, i) => {
    const label = formatArtifactLabel(a.path);
    const ext = (a.path.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
    const iconClass = artifactIconClass(ext);
    const iconText = (ext || "FILE").toUpperCase().slice(0, 3);
    const isActive = a.path === state.selectedTaskArtifactPath;
    return `
    <div class="artifact-row ${isActive ? "active" : ""}" data-artifact-container>
      <button type="button" class="artifact-row-main" data-artifact-select data-artifact-path="${escapeHtml(a.path)}">
        <span class="artifact-icon ${iconClass}">${escapeHtml(iconText)}</span>
        <div class="artifact-main">
          <div class="artifact-name">
            ${escapeHtml(label)}
            ${i === 0 ? `<span class="pill pill-ok" style="margin-left:6px;">Primary</span>` : ""}
          </div>
          <div class="artifact-path">${escapeHtml(a.path)}</div>
        </div>
      </button>
      <div class="artifact-actions btn-group">
        <button type="button" class="btn btn-sm" data-artifact-open data-artifact-path="${escapeHtml(a.path)}">Open</button>
        <button type="button" class="btn btn-sm btn-ghost" data-artifact-reveal data-artifact-path="${escapeHtml(a.path)}">Reveal</button>
        <button type="button" class="btn btn-sm btn-ghost" data-artifact-copy data-artifact-path="${escapeHtml(a.path)}">Copy path</button>
      </div>
    </div>
  `; }).join("");

  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-select]")) {
    btn.addEventListener("click", () => void selectTaskArtifact(btn.dataset.artifactPath));
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-open]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await window.ucaShell.openPath(btn.dataset.artifactPath);
    });
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-reveal]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try { await window.ucaShell.revealInFolder?.(btn.dataset.artifactPath); }
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
  const filter = filesFilterText.trim().toLowerCase();
  const visible = filter
    ? filesAllArtifacts.filter((a) =>
        a.name.toLowerCase().includes(filter) ||
        a.path.toLowerCase().includes(filter) ||
        (a.taskCommand ?? "").toLowerCase().includes(filter) ||
        a.label.toLowerCase().includes(filter)
      )
    : filesAllArtifacts;

  filesCountEl.textContent = `${visible.length}`;

  if (visible.length === 0) {
    filesListEl.innerHTML = `<p class="muted" style="font-size:12px;">${filesAllArtifacts.length === 0 ? "No files yet. Generated artifacts will appear here." : "No matches."}</p>`;
    return;
  }

  // UCA-122: v3 .file-row structure with colored artifact-icon by ext.
  filesListEl.innerHTML = visible.map((art) => {
    const ext = (art.path.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
    const iconClass = artifactIconClass(ext);
    const iconText = (ext || "FILE").toUpperCase().slice(0, 3);
    const active = art.path === filesSelectedPath ? " active" : "";
    return `
    <div class="file-row${active}" data-file-path="${escapeHtml(art.path)}" role="button" tabindex="0">
      <span class="artifact-icon ${iconClass}">${escapeHtml(iconText)}</span>
      <div class="file-main">
        <div class="file-name">${escapeHtml(art.name)}</div>
        <div class="file-sub">${escapeHtml(formatDateTime(art.createdAt))}${art.taskCommand ? " · " + escapeHtml(art.taskCommand.slice(0, 40)) : ""}</div>
      </div>
    </div>
  `; }).join("");

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

// UCA-049: pull provider visibility info out of the task event stream so the
// task detail panel can show "Provider: DeepSeek · deepseek-chat · HTTPS"
// and "AI 已降级" warnings without the backend having to denormalise them
// into the task record itself.
function extractTaskProviderInfo(detail) {
  if (!detail?.events?.length) return { descriptor: null, downgraded: false };
  let descriptor = null;
  let downgraded = false;
  for (const event of detail.events) {
    const payload = event?.payload ?? {};
    if (payload.provider_id || payload.provider_kind) {
      descriptor = {
        provider_id: payload.provider_id ?? null,
        provider_kind: payload.provider_kind ?? null,
        provider_name: payload.provider_name ?? null,
        model: payload.model ?? null,
        transport: payload.transport ?? null
      };
    }
    if (payload.downgraded === true) {
      downgraded = true;
    }
  }
  return { descriptor, downgraded };
}

function renderProviderLine(descriptor) {
  if (!descriptor) return "";
  const name = descriptor.provider_name || descriptor.provider_id || descriptor.provider_kind || "unknown provider";
  const model = descriptor.model || "default";
  const transport = (descriptor.transport || "").toUpperCase() || "—";
  return `
    <div class="row" style="font-size:11px;color:var(--muted);gap:6px;align-items:center;">
      <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:var(--status-info-bg);border:1px solid var(--status-info-border);color:var(--status-info-text);">
        <span style="font-weight:500;">Provider</span>
        <span>${escapeHtml(name)}</span>
        <span class="muted">·</span>
        <span>${escapeHtml(model)}</span>
        <span class="muted">·</span>
        <span>${escapeHtml(transport)}</span>
      </span>
    </div>
  `;
}

function renderDowngradedWarning(downgraded) {
  if (!downgraded) return "";
  return `
    <div data-uca-downgraded="1" style="padding:8px 10px;border-radius:8px;background:var(--warn-soft);border:1px solid var(--warn);margin-top:8px;">
      <strong style="font-size:12px;color:var(--warn);">AI claim downgraded</strong>
      <p class="muted" style="margin:4px 0 0;font-size:12px;">The model claimed completion, but no tool in this run returned success:true. The task has been downgraded to partial — see the timeline below for what actually executed.</p>
    </div>
  `;
}

// UCA-102: Render a single timeline entry. Events carrying extra payload
// detail (tool args, observations, errors) use a <details> element so the
// user can expand only what they want to see. Failures and pending steps
// default to open; routine success steps stay collapsed so the timeline
// reads cleanly at a glance.
function renderTimelineEntry(ev) {
  const s = formatTaskEventSummary(ev);
  const payload = ev?.data ?? ev?.payload ?? {};
  const eventType = ev?.event ?? ev?.event_type ?? "";
  const ts = escapeHtml(formatDateTime(ev.ts ?? ev.at));
  const title = escapeHtml(s.title);
  const body = escapeHtml(s.body);

  // Determine whether there's rich detail worth showing behind a toggle.
  const hasToolArgs = (eventType === "tool_call_started" || eventType === "tool_call_proposed" || eventType === "tool_call_completed")
    && payload.args && typeof payload.args === "object" && Object.keys(payload.args).length > 0;
  const hasObservation = eventType === "tool_call_completed"
    && (typeof payload.observation === "string" || typeof payload.text === "string" || typeof payload.error === "string");
  const hasError = eventType === "failed" && typeof payload.message === "string" && payload.message.length > 0;
  const hasRichDetail = hasToolArgs || hasObservation || hasError;

  if (!hasRichDetail) {
    return `
      <div class="timeline-item">
        <div class="row"><strong style="font-size:12px;">${title}</strong><span class="muted" style="font-size:11px;">${ts}</span></div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${body}</p>
      </div>
    `;
  }

  // Success tool_calls collapse; anything that failed or is pending stays open.
  const failed = eventType === "tool_call_completed" && payload.success === false;
  const pending = eventType === "tool_call_started" || eventType === "tool_call_proposed";
  const openAttr = failed || pending || hasError ? " open" : "";

  const detailLines = [];
  if (hasToolArgs) {
    const argsJson = escapeHtml(JSON.stringify(payload.args, null, 2));
    detailLines.push(`<div class="muted" style="font-size:11px;margin-top:6px;">args</div><pre class="mono" style="font-size:11px;margin:4px 0 0;padding:8px;background:var(--surface-soft);border-radius:6px;overflow:auto;">${argsJson}</pre>`);
  }
  if (hasObservation) {
    const raw = typeof payload.observation === "string" ? payload.observation
      : typeof payload.text === "string" ? payload.text
        : payload.error ?? "";
    const label = payload.success === false ? "error" : "observation";
    detailLines.push(`<div class="muted" style="font-size:11px;margin-top:6px;">${label}</div><pre class="mono" style="font-size:11px;margin:4px 0 0;padding:8px;background:var(--surface-soft);border-radius:6px;overflow:auto;white-space:pre-wrap;">${escapeHtml(raw)}</pre>`);
  }
  if (hasError) {
    detailLines.push(`<div class="muted" style="font-size:11px;margin-top:6px;">failure</div><pre class="mono" style="font-size:11px;margin:4px 0 0;padding:8px;background:rgba(239,68,68,0.08);border-radius:6px;overflow:auto;white-space:pre-wrap;">${escapeHtml(payload.message)}</pre>`);
  }

  return `
    <details class="timeline-item"${openAttr}>
      <summary style="cursor:pointer;list-style:none;">
        <div class="row"><strong style="font-size:12px;">${title}</strong><span class="muted" style="font-size:11px;">${ts}</span></div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${body}</p>
      </summary>
      ${detailLines.join("")}
    </details>
  `;
}

// UCA-P0-E: build the task-detail KV grid with only the cells that
// carry real signal. Earlier the grid always rendered 8 fixed cells,
// so an idle task (no retries, no cost, no duration captured) showed
// a wall of "—" and "0" that made the view look like a broken form.
// Rules:
//   - string fields ("—" / null / empty) are skipped
//   - retry=0 is skipped (no-retry is the normal case)
//   - cost=0 is skipped on terminal tasks (no spend is the normal case)
//   - CSS uses auto-fit so the remaining cells reflow cleanly into
//     whatever column count fits (no widowed cells when 5 or 7 remain)
function renderTaskKvGrid({ provider, model, executor, source, retry, cost, duration, transport }) {
  const hasText = (v) => v != null && v !== "" && v !== "—";
  const cells = [];
  if (hasText(provider)) cells.push(["Provider", provider]);
  if (hasText(model)) cells.push(["Model", model]);
  if (hasText(executor)) cells.push(["Executor", executor]);
  if (hasText(source)) cells.push(["Source", source]);
  if (retry && Number(retry) > 0) cells.push(["Retry", String(retry)]);
  if (cost && Number(cost) > 0) cells.push(["Cost", formatMoney(cost)]);
  if (hasText(duration)) cells.push(["Duration", duration]);
  if (hasText(transport)) cells.push(["Transport", transport]);
  if (cells.length === 0) return "";
  return `
    <div class="kv-grid kv-grid--auto">
      ${cells.map(([k, v]) => `<div class="kv-cell"><div class="kv-k">${escapeHtml(k)}</div><div class="kv-v">${escapeHtml(String(v))}</div></div>`).join("")}
    </div>
  `;
}

// UCA-125 Phase 2b: show/hide helpers for the split detail panels.
// Each subtasks/artifacts/timeline section is its own .panel card now,
// so empty sections just stay hidden instead of rendering a stacked
// "No X yet." placeholder.
function setTaskDetailPanelVisible(id, visible) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  if (visible) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

function renderTaskDetail(detail) {
  if (!detail) {
    state.selectedTaskDetail = null;
    taskDetailSummary.innerHTML = `<p class="muted" style="font-size:12px;">Select a task to view details.</p>`;
    taskTimeline.innerHTML = "";
    setTaskDetailPanelVisible("taskSubtasksPanel", false);
    setTaskDetailPanelVisible("taskArtifactsPanel", false);
    setTaskDetailPanelVisible("taskTimelinePanel", false);
    renderTaskArtifacts(null);
    renderTaskChildren(null);
    retryTaskButton.disabled = true;
    cancelTaskButton.disabled = true;
    if (deleteTaskButton) deleteTaskButton.disabled = true;
    return;
  }

  state.selectedTaskDetail = detail;
  const task = detail.task ?? {};
  const { descriptor: providerDescriptor, downgraded } = extractTaskProviderInfo(detail);
  const failBlock = task.failure_category ? `
    <div style="padding:8px 10px;border-radius:8px;background:var(--err-soft);border:1px solid var(--err);margin-top:8px;">
      <strong style="font-size:12px;color:var(--err);">Failed</strong>
      <p class="muted" style="margin:4px 0 0;font-size:12px;">${escapeHtml(task.failure_user_message ?? task.failure_category)}</p>
    </div>
  ` : "";
  const parentLink = task.parent_task_id ? `
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
      <button type="button" class="btn btn-sm btn-ghost" data-task-act="cancel" ${canCancel ? "" : "disabled"}>Cancel</button>
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
      ${renderTaskKvGrid({ provider, model, executor: task.executor, source, retry: task.retry_count, cost: task.cost_usd, duration, transport })}
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
    taskTimeline.innerHTML = events.map((ev) => renderTimelineEntry(ev)).join("");
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
  if (!state.selectedTaskId) { renderTaskDetail(null); return; }
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
    ensureSelectedTaskEventStream(state.selectedTaskId);
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
  const approvals = state.workspace.approvals ?? [];
  approvalCount.textContent = `${approvals.filter((a) => a.status === "pending").length}`;
  if (approvals.length === 0) {
    renderEmpty(approvalList, "No pending approvals.");
    return;
  }

  approvalList.innerHTML = approvals.map((a) => renderApprovalItem(a)).join("");

  // Plain Approve (no overrides).
  for (const btn of approvalList.querySelectorAll("[data-approve-id]")) {
    btn.addEventListener("click", async () => {
      await fetchJson(`/approvals/${encodeURIComponent(btn.dataset.approveId)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "desktop_console" }) });
      await refreshWorkspace();
    });
  }
  for (const btn of approvalList.querySelectorAll("[data-reject-id]")) {
    btn.addEventListener("click", async () => {
      await fetchJson(`/approvals/${encodeURIComponent(btn.dataset.rejectId)}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "desktop_console", reason: "rejected_in_console" }) });
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
      await fetchJson(`/approvals/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "desktop_console", overrides })
      });
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
function scheduleBucket(s) {
  if (s.completed_at) return "completed";
  if (!s.enabled) return "paused";
  return "active";
}
function scheduleMatchesSearch(s, q) {
  if (!q) return true;
  const hay = [s.name, s.schedule_id, s.trigger_type, s.category, s.metadata?.category, s.last_run_status]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
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
  const statePill = bucket === "completed"
    ? `<span class="pill pill-neutral">completed</span>`
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
      </div>
      <div class="sched-actions btn-group">
        <button class="btn btn-sm" data-run-schedule-id="${escapeHtml(s.schedule_id)}">${runLabel}</button>
        <button class="btn btn-sm btn-danger" data-delete-schedule-id="${escapeHtml(s.schedule_id)}">Delete</button>
      </div>
    </div>
  `;
}

function renderSchedules() {
  const schedules = state.workspace.schedules ?? [];
  scheduleCount.textContent = `${schedules.length}`;
  if (schedules.length === 0) {
    renderEmpty(scheduleList, "No scheduled tasks.");
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
        const result = await fetchJson(`/schedules/${encodeURIComponent(btn.dataset.runScheduleId)}/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggerPayload: { source: "desktop_console", bypassDedupe: true } })
        });
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
      await fetchJson(`/schedules/${encodeURIComponent(input.dataset.toggleScheduleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: input.dataset.enabled === "true" })
      });
      await refreshWorkspace();
    });
  }

  for (const btn of scheduleList.querySelectorAll("[data-delete-schedule-id]")) {
    btn.addEventListener("click", async () => {
      await fetchJson(`/schedules/${encodeURIComponent(btn.dataset.deleteScheduleId)}`, { method: "DELETE" });
      await refreshWorkspace();
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
        const result = await fetchJson(`/dag/executions/${encodeURIComponent(btn.dataset.resumeDagId)}/resume`, { method: "POST" });
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
  return {
    currentProjectId: DEFAULT_PROJECT_ID,
    currentConversationId: null,
    projects: [{ id: DEFAULT_PROJECT_ID, name: "默认", color: PROJECT_COLORS[0], createdAt: Date.now(), metadata: {} }],
    conversations: []
  };
}

function normalizeProjectStore(store) {
  const next = store && typeof store === "object" ? store : buildDefaultProjectStore();
  next.projects = Array.isArray(next.projects) ? next.projects : [];
  next.conversations = Array.isArray(next.conversations) ? next.conversations : [];
  if (!next.projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    next.projects.unshift({ id: DEFAULT_PROJECT_ID, name: "默认", color: PROJECT_COLORS[0], createdAt: Date.now(), metadata: {} });
  }
  next.currentProjectId = next.currentProjectId || DEFAULT_PROJECT_ID;
  next.currentConversationId = next.currentConversationId ?? null;
  return next;
}

function mergeProjectStores(localStore, remoteStore) {
  const local = normalizeProjectStore(localStore);
  const remote = normalizeProjectStore(remoteStore);
  const projects = new Map();
  for (const project of [...remote.projects, ...local.projects]) {
    projects.set(project.id, { ...(projects.get(project.id) ?? {}), ...project });
  }
  const conversations = new Map();
  for (const conversation of [...remote.conversations, ...local.conversations]) {
    const existing = conversations.get(conversation.id);
    if (!existing || (conversation.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      conversations.set(conversation.id, conversation);
    }
  }
  return normalizeProjectStore({
    currentProjectId: remote.currentProjectId || local.currentProjectId || DEFAULT_PROJECT_ID,
    currentConversationId: remote.currentConversationId ?? local.currentConversationId ?? null,
    projects: [...projects.values()],
    conversations: [...conversations.values()]
  });
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
  state.projectStore = normalized;
  localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(normalized));
  void saveConsoleProjectStoreToService(normalized);
}

async function saveConsoleProjectStoreToService(store) {
  try {
    await fetchJson("/projects/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: normalizeProjectStore(store) })
    });
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

function formatProjectConversationPreview(conversation) {
  if (!conversation) return "Select a conversation.";
  const lines = [
    conversation.title || conversation.seedCommand || conversation.id,
    `Updated: ${formatDateTime(conversation.updatedAt)}`,
    ""
  ];
  for (const turn of (conversation.turns ?? []).slice(-12)) {
    const label = turn.role === "user" ? "User" : turn.role === "assistant" ? "Assistant" : "System";
    lines.push(`${label}: ${turn.content ?? ""}`);
    lines.push("");
  }
  return lines.join("\n").trim() || "No turns yet.";
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

  projectList.innerHTML = projects.map((project) => {
    const selected = project.id === selectedProject?.id;
    return `
      <button class="history-item ${selected ? "active" : ""}" data-project-id="${escapeHtml(project.id)}" style="text-align:left;border-left:4px solid ${escapeHtml(project.color ?? PROJECT_COLORS[0])};">
        <div class="row">
          <strong style="font-size:13px;">${escapeHtml(project.name ?? project.id)}</strong>
          <span class="muted" style="font-size:11px;">${escapeHtml((store.conversations ?? []).filter((conversation) => conversation.projectId === project.id).length)}</span>
        </div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(project.id)}</p>
      </button>
    `;
  }).join("");

  projectConversationList.innerHTML = conversations.length > 0
    ? conversations.map((conversation) => `
      <button class="history-item ${conversation.id === selectedConversation?.id ? "active" : ""}" data-project-conversation-id="${escapeHtml(conversation.id)}" style="text-align:left;">
        <div class="row">
          <strong style="font-size:13px;">${escapeHtml(conversation.title || conversation.seedCommand || "新会话")}</strong>
          <span class="muted" style="font-size:11px;">${escapeHtml((conversation.turns ?? []).length)}</span>
        </div>
        <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(formatDateTime(conversation.updatedAt ?? conversation.startedAt))}</p>
      </button>
    `).join("")
    : `<p class="muted" style="font-size:12px;">No conversations in this project.</p>`;

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

async function updateSecurityConfig(patch, label) {
  privacyState.textContent = `Updating ${label}...`;
  state.updatingSecurity = true;
  renderPrivacy();
  try {
    const payload = await fetchJson("/security/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
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
    await fetchJson("/config/output", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultDir: dir, autoCreateDirs: true })
    });
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
    await fetchJson("/config/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toggles)
    });
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
  void submitConsoleChat();
});
consoleChatInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submitConsoleChat();
  }
});

retryTaskButton.addEventListener("click", async () => {
  if (!state.selectedTaskId) return;
  await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "retry_same" }) });
  await refreshWorkspace();
});

cancelTaskButton.addEventListener("click", async () => {
  if (!state.selectedTaskId) return;
  await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}/cancel`, { method: "POST" });
  await refreshWorkspace();
});

const deleteTaskButton = document.getElementById("deleteTaskButton");
deleteTaskButton?.addEventListener("click", async () => {
  if (!state.selectedTaskId) return;
  await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}`, { method: "DELETE" });
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
    await fetchJson("/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "desktop_console", template }) });
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
    await fetchJson("/templates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "desktop_console", raw }) });
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
    await fetchJson(`/templates/${encodeURIComponent(state.selectedTemplateId)}`, { method: "DELETE" });
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
    await fetchJson("/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limits: { monthly_usd_limit: Number(monthlyBudgetInput.value || 0) } }) });
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

// UCA-125 Phase 3-5: page-head "+ New chat" clears the current thread
// and returns focus to the composer. A proper multi-session store is
// intentionally not introduced here — this is a UI alignment pass.
document.querySelector("#consoleChatNewBtn")?.addEventListener("click", () => {
  consoleChatEventStream?.close?.();
  consoleChatEventStream = null;
  consoleChatToolCards = new Map();
  consoleChatResultTaskIds = new Set();
  if (consoleChatMessages) {
    consoleChatMessages.innerHTML = `<div class="console-chat-empty">没有对话 — 开始一个吧。</div>`;
  }
  const input = document.querySelector("#consoleChatInput");
  if (input) { input.value = ""; input.focus(); }
  if (consoleChatState) consoleChatState.textContent = "";
});

projectCreateForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = projectNameInput.value.trim();
  if (!name) {
    projectState.textContent = "Project name required.";
    return;
  }
  const store = loadConsoleProjectStore();
  const project = {
    id: `proj_${crypto.randomUUID().slice(0, 8)}`,
    name,
    color: PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length],
    createdAt: Date.now(),
    metadata: {}
  };
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
  mcpServerForm?.addEventListener("submit", () => setTimeout(() => setOpen(false), 400));
})();

mcpServerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = mcpServerId.value.trim();
  const displayName = mcpServerName.value.trim();
  const transport = mcpTransport.value;
  const commandOrUrl = mcpCommand.value.trim();
  if (!id || !commandOrUrl) {
    mcpServerState.textContent = "ID and command/url required.";
    return;
  }
  const payload = {
    id,
    displayName: displayName || id,
    transport,
    command: transport === "stdio" ? commandOrUrl : null,
    args: transport === "stdio" ? mcpArgs.value.trim().split(/\s+/).filter(Boolean) : [],
    url: transport !== "stdio" ? commandOrUrl : null
  };
  mcpServerState.textContent = "Saving...";
  try {
    await fetchJson("/config/mcp/servers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    mcpServerState.textContent = "Saved.";
    mcpServerId.value = "";
    mcpServerName.value = "";
    mcpCommand.value = "";
    mcpArgs.value = "";
    await refreshWorkspace();
  } catch (error) {
    mcpServerState.textContent = `Failed: ${error.message}`;
  }
});

skillRegistryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = skillRegistryId.value.trim();
  const displayName = skillRegistryName.value.trim();
  const rootPath = skillRegistryPath.value.trim();
  if (!id || !rootPath) {
    skillRegistryState.textContent = "ID and root path required.";
    return;
  }
  const payload = {
    id,
    displayName: displayName || id,
    rootPath
  };
  skillRegistryState.textContent = "Saving...";
  try {
    await fetchJson("/config/skills/registries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    skillRegistryState.textContent = "Saved.";
    skillRegistryId.value = "";
    skillRegistryName.value = "";
    skillRegistryPath.value = "";
    await refreshWorkspace();
  } catch (error) {
    skillRegistryState.textContent = `Failed: ${error.message}`;
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
    await fetchJson("/skills/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPath: editingSkillPath, markdown: skillEditText.value })
    });
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
    await fetchJson("/config/code-cli/adapters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
    await fetchJson("/config/email/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
    const result = await fetchJson("/config/email/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.workspace.emailDigestSettings = result.settings ?? payload;
    emailDigestState.textContent = "Saved.";
    renderEmailDigestSettings();
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
setInterval(() => void refreshWorkspace(), 6000);

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
        await fetch(`${state.serviceBaseUrl}/config/email/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
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
    const status = getMcpStatusView(s);
    const statusLabel = status.label;
    const statusClass = status.className;
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
    card.innerHTML = `
      <div class="mcp-card-head">
        <div class="conn-logo ${logoClass} mcp-card-logo">${logoGlyph}</div>
        <div class="mcp-card-info">
          <div class="mcp-name">${escapeHtml(meta.title ?? s.displayName ?? s.id)}</div>
          <div class="mcp-card-desc">${escapeHtml(meta.desc ?? "")}</div>
        </div>
        <span class="mcp-status-dot ${statusClass}" title="${statusLabel}"></span>
        <label class="toggle" title="${installed ? "Disable" : needsConfig ? "Configure first" : "Enable"}">
          <input type="checkbox" ${installed ? "checked" : ""} ${canInstall ? "" : "disabled"} data-mcp-install="${escapeHtml(s.id)}" data-mcp-enabled="${installed ? "false" : "true"}">
          <span class="toggle-track"></span>
        </label>
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
        await fetch(`${state.serviceBaseUrl}/ai/mcp/${encodeURIComponent(id)}/toggle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: wantEnabled })
        });
        await loadConnectorsTab();
      } catch {
        input.disabled = false;
        input.checked = !wantEnabled;
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
        await fetch(`${state.serviceBaseUrl}/ai/mcp/${encodeURIComponent(id)}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: MCP_SERVER_META[id]?.configKey, value: val })
        });
        if (stateEl) { stateEl.textContent = "已保存 ✓"; setTimeout(() => { stateEl.textContent = ""; }, 2000); }
        // Also enable the server after saving API key
        await fetch(`${state.serviceBaseUrl}/ai/mcp/${encodeURIComponent(id)}/toggle`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true })
        });
        await loadConnectorsTab();
      } catch (err) {
        if (stateEl) stateEl.textContent = `Error: ${err.message}`;
      }
    });
  });
}

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

  // UCA-126: Inbox tab handles its own preview loading; no auto-load here.
}

async function handleConnectedAccountDefault(accountId, purpose) {
  if (!accountId || !purpose) return;
  await fetch(`${state.serviceBaseUrl}/connectors/connected-accounts/${encodeURIComponent(accountId)}/defaults`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose })
  });
  void loadConnectorsTab();
}

async function handleConnectedAccountDisconnect(accountId) {
  if (!accountId) return;
  if (!confirm("断开这个已连接账户？已缓存的 token 将被删除。")) return;
  await fetch(`${state.serviceBaseUrl}/connectors/connected-accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE"
  });
  void loadConnectorsTab();
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
  await fetch(`${state.serviceBaseUrl}/connectors/accounts/${type}`, { method: "DELETE" });
  void loadConnectorsTab();
}

async function handleAccountConfigSave(type, panel) {
  const status = panel?.querySelector("[data-ac-config-status]");
  const clientId = panel?.querySelector("[data-ac-field='clientId']")?.value?.trim() ?? "";
  const clientSecret = panel?.querySelector("[data-ac-field='clientSecret']")?.value?.trim() ?? "";
  const body = { clientId };
  if (clientSecret) body.clientSecret = clientSecret;
  try {
    const r = await fetch(`${state.serviceBaseUrl}/connectors/accounts/${type}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (r.ok) {
      if (status) { status.textContent = "✓ 已保存"; setTimeout(() => { if (status) status.textContent = ""; }, 2000); }
      void loadConnectorsTab();
    } else {
      if (status) status.textContent = "保存失败";
    }
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
    list.innerHTML = `<p class="muted inbox-empty-accounts" style="padding:14px 16px;font-size:12px;">尚未连接账户 — 去 Connectors 授权后再来。</p>`;
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
    if (!r.ok) { content.innerHTML = `<p class="inbox-empty">加载失败 (${r.status})</p>`; return; }
    const data = await r.json();
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
    const resp = await fetch(`${state.serviceBaseUrl}/config/email/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id, email, provider: provider === "other" ? "imap" : provider === "outlook" ? "imap" : provider === "gmail" ? "imap" : provider === "qq" ? "imap" : provider === "163" ? "imap" : "imap",
        displayName: email,
        imapHost: host,
        imapPort: preset.port,
        credentials: { username: email, password }
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? resp.statusText);
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
    const resp = await fetch(`${state.serviceBaseUrl}/email/digest/check`, { method: "POST" });
    const data = await resp.json();
    if (connDigestTestState) {
      connDigestTestState.textContent = data.sent ? "Digest sent!" : (data.reason ?? "No digest sent.");
      setTimeout(() => { connDigestTestState.textContent = ""; }, 4000);
    }
  } catch (err) {
    if (connDigestTestState) connDigestTestState.textContent = `Error: ${err.message}`;
  }
});

connDigestEnabled?.addEventListener("change", async () => {
  try {
    const result = await fetchJson("/config/email/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(state.workspace.emailDigestSettings ?? {}),
        enabled: connDigestEnabled.checked
      })
    });
    state.workspace.emailDigestSettings = result.settings ?? state.workspace.emailDigestSettings;
    renderEmailDigestSettings();
  } catch (error) {
    if (connDigestTestState) connDigestTestState.textContent = `Error: ${error.message}`;
  }
});

connectorsMcpRefreshBtn?.addEventListener("click", () => { void loadConnectorsTab(); });

// UCA-126 Phase 7d: chat composer richness — attachments, voice trigger,
// model chip label. Attach is local-file-picker + chips (passed into task
// context). Voice defers to the existing overlay voice mode via hotkey.
function renderChatAttachments() {
  if (!consoleChatAttachments) return;
  if (consoleChatAttachList.length === 0) {
    consoleChatAttachments.hidden = true;
    consoleChatAttachments.innerHTML = "";
    return;
  }
  consoleChatAttachments.hidden = false;
  consoleChatAttachments.innerHTML = consoleChatAttachList.map((entry, idx) => `
    <span class="chip-attach">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.58 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      <span>${escapeHtml(entry?.name ?? "")}</span>
      <button type="button" data-remove-attach="${idx}" aria-label="Remove">×</button>
    </span>
  `).join("");
  for (const btn of consoleChatAttachments.querySelectorAll("[data-remove-attach]")) {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeAttach);
      if (Number.isInteger(idx)) {
        consoleChatAttachList.splice(idx, 1);
        renderChatAttachments();
      }
    });
  }
}

consoleChatAttachBtn?.addEventListener("click", () => {
  consoleChatAttachInput?.click();
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

consoleChatVoiceBtn?.addEventListener("click", () => {
  // Defer to the existing overlay voice mode (Ctrl+Shift+V). The preload
  // bridge exposes a helper when available; otherwise surface a hint.
  if (window.ucaBridge?.openOverlayInVoiceMode) {
    window.ucaBridge.openOverlayInVoiceMode();
  } else if (consoleChatState) {
    consoleChatState.textContent = "按 Ctrl+Shift+V 开启语音";
    setTimeout(() => { if (consoleChatState.textContent === "按 Ctrl+Shift+V 开启语音") consoleChatState.textContent = ""; }, 2600);
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
  if (notesReady) return;
  notesReady = true;
  initQuickNotes();
}

function initQuickNotes() {
  const LS_KEY = "lingxy.notes.v1";
  const LS_SELECTED = "lingxy.notes.selected";
  const LS_FONT_FAMILY = "lingxy.notes.fontFamily";
  const LS_FONT_SIZE = "lingxy.notes.fontSize";

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
  })() ?? "http://127.0.0.1:4310";

  // ── Storage ────────────────────────────────────────────────────────────
  const notesState = {
    notes: loadNotes(),
    selectedId: (() => { try { return localStorage.getItem(LS_SELECTED); } catch { return null; } })(),
    searchQuery: "",
    saveTimer: null,
    pendingChatAdoption: null
  };

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

  function nowIso() { return new Date().toISOString(); }
  function fmtRel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    const sameYear = d.getFullYear() === now.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return sameYear ? `${mm}-${dd} ${hh}:${mi}` : `${d.getFullYear()}-${mm}-${dd}`;
  }
  function fmtAbsolute(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function makeNote() {
    const ts = nowIso();
    return {
      id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: "",
      body_html: "",
      created_at: ts,
      updated_at: ts,
      history: [] // [{ts, bytes}] rough edit log for future UI; not rendered yet
    };
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

  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
  }

  function renderList() {
    const items = sortedFiltered();
    countLabel.textContent = `${items.length}`;
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    listEl.hidden = false;
    emptyEl.hidden = true;
    for (const n of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-item" + (n.id === notesState.selectedId ? " is-active" : "");
      btn.dataset.noteId = n.id;
      btn.innerHTML = `
        <div class="note-item-title">${escapeHtml(n.title || "Untitled note")}</div>
        <div class="note-item-snippet">${escapeHtml(stripHtml(n.body_html).slice(0, 110) || "Empty note")}</div>
        <div class="note-item-ts">${escapeHtml(fmtRel(n.updated_at))}</div>
      `;
      btn.addEventListener("click", () => selectNote(n.id));
      listEl.appendChild(btn);
    }
    updateRailBadge();
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
    }, 350);
  }

  titleInput.addEventListener("input", scheduleSave);
  bodyEl.addEventListener("input", scheduleSave);

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
  });

  deleteBtn?.addEventListener("click", () => {
    const note = currentNote();
    if (!note) return;
    if (!confirm(`Delete "${note.title || "Untitled note"}"?`)) return;
    notesState.notes = notesState.notes.filter((n) => n.id !== note.id);
    saveNotes();
    ensureSelection();
    renderList();
    renderEditor();
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

  function noteFilename(note, ext) {
    const base = (note.title || "note").replace(/[\\/:*?"<>|]/g, "_").trim() || "note";
    return `${base}.${ext}`;
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

  function exportAsText(note, opts) {
    const tmp = document.createElement("div");
    tmp.innerHTML = opts.keepInlineStamps ? note.body_html : stripInlineStamps(note.body_html);
    const body = (tmp.textContent || "").trim();
    const header = [];
    header.push(note.title || "Untitled note");
    if (opts.withTimestamps) {
      header.push(`Created: ${fmtAbsolute(note.created_at)}`);
      header.push(`Last edited: ${fmtAbsolute(note.updated_at)}`);
    }
    return `${header.join("\n")}\n\n${body}\n`;
  }

  function exportAsMarkdown(note, opts) {
    const md = htmlToMarkdown(opts.keepInlineStamps ? note.body_html : stripInlineStamps(note.body_html));
    const header = [`# ${note.title || "Untitled note"}`];
    if (opts.withTimestamps) {
      header.push("");
      header.push(`> Created: ${fmtAbsolute(note.created_at)}  `);
      header.push(`> Last edited: ${fmtAbsolute(note.updated_at)}`);
    }
    return `${header.join("\n")}\n\n${md}\n`;
  }

  function exportAsHtml(note, opts) {
    const body = opts.keepInlineStamps ? note.body_html : stripInlineStamps(note.body_html);
    const tsBlock = opts.withTimestamps
      ? `<p style="color:#94a3b8;font-size:12px;margin-top:0">Created: ${escapeHtml(fmtAbsolute(note.created_at))} · Last edited: ${escapeHtml(fmtAbsolute(note.updated_at))}</p>`
      : "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(note.title || "Note")}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#0f172a;line-height:1.7}h1{font-size:22px}img{max-width:100%;border-radius:6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:6px 10px}.note-stamp{color:#94a3b8;font-family:ui-monospace,monospace;font-size:11.5px;padding:0 4px;background:rgba(0,0,0,.04);border-radius:3px}</style>
</head><body><h1>${escapeHtml(note.title || "Untitled note")}</h1>${tsBlock}${body}</body></html>`;
  }

  function stripInlineStamps(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    tmp.querySelectorAll(".note-stamp").forEach((el) => el.remove());
    return tmp.innerHTML;
  }

  function htmlToMarkdown(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      const inner = Array.from(node.childNodes).map(walk).join("");
      switch (tag) {
        case "h1": return `\n# ${inner}\n\n`;
        case "h2": return `\n## ${inner}\n\n`;
        case "h3": return `\n### ${inner}\n\n`;
        case "p": case "div": return `${inner}\n\n`;
        case "br": return "\n";
        case "strong": case "b": return `**${inner}**`;
        case "em": case "i": return `*${inner}*`;
        case "u": return inner;
        case "a": return `[${inner}](${node.getAttribute("href") || ""})`;
        case "img": {
          const src = node.getAttribute("src") || "";
          const alt = node.getAttribute("alt") || "";
          return `![${alt}](${src})`;
        }
        case "code": return `\`${inner}\``;
        case "blockquote": return inner.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
        case "hr": return `\n---\n\n`;
        case "li": {
          const parent = node.parentElement?.tagName?.toLowerCase();
          return parent === "ol" ? `1. ${inner}\n` : `- ${inner}\n`;
        }
        case "ul": case "ol": return `${inner}\n`;
        case "table": return tableToMd(node) + "\n";
        default: return inner;
      }
    };
    return Array.from(tmp.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  function tableToMd(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return "";
    const render = (tr) => Array.from(tr.children).map((c) => (c.textContent || "").trim().replace(/\|/g, "\\|")).join(" | ");
    const head = render(rows[0]);
    const cols = rows[0].children.length;
    const sep = Array.from({ length: cols }, () => "---").join(" | ");
    const body = rows.slice(1).map(render).join("\n");
    return `| ${head} |\n| ${sep} |${body ? `\n| ${body.split("\n").map(r => r + " |").join("\n| ")}` : ""}`;
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
    appendAdoptedChip(last.textContent || "");
  }

  function appendAdoptedChip(text) {
    const note = currentNote();
    if (!note) return;
    const chip = document.createElement("div");
    chip.className = "note-chat-chip";
    chip.textContent = text.trim();
    bodyEl.appendChild(chip);
    bodyEl.appendChild(document.createElement("p"));
    scheduleSave();
    bodyEl.focus();
  }

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
}
