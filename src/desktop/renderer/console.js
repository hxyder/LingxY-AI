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
const historyForm = document.querySelector("#historyForm");
const historyQueryInput = document.querySelector("#historyQueryInput");
const historyList = document.querySelector("#historyList");
const historyPreview = document.querySelector("#historyPreview");
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

const PANEL_INTROS = {
  tasks: ["Queue", "Work in motion", "Active runs, results, and recovery actions."],
  chat: ["Dialogue", "Console chat", "A full-size conversation surface for longer prompts and follow-up work."],
  files: ["Artifacts", "Produced files", "Files ready to open, reveal, or reuse."],
  schedules: ["Automation", "Scheduled work", "Reminders, recurring tasks, and pending approvals."],
  history: ["Memory", "History search", "Past task context and retrieved results."],
  projects: ["Threads", "Conversation memory", "Overlay projects and saved conversations."],
  connectors: ["Integrations", "Connections", "Email, MCP, skills, Code CLI, and Office handoffs."],
  settings: ["Policy", "Runtime settings", "AI routing, privacy, feature flags, and output paths."],
  advanced: ["Operations", "Advanced controls", "Templates, DAG workflow, budget, and audit log."]
};

function installPanelIntros() {
  for (const [tabId, [eyebrow, title, subtitle]] of Object.entries(PANEL_INTROS)) {
    const panel = document.querySelector(`#panel-${tabId}`);
    if (!panel || panel.querySelector(".console-panel-intro")) continue;
    const intro = document.createElement("div");
    intro.className = "console-panel-intro";
    intro.innerHTML = `
      <div class="eyebrow">${escapeHtml(eyebrow)}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle)}</p>
    `;
    panel.prepend(intro);
  }
}

function applyConsoleInformationArchitecture() {
  installPanelIntros();
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

  // Restore the last visited view.
  try {
    const savedView = localStorage.getItem("lingxy.view");
    if (savedView && document.querySelector(`[data-tab="${savedView}"]`)) {
      // Defer to next frame so any page-load hooks (applyConsoleInfo…
      // etc) finish their own default state first.
      requestAnimationFrame(() => switchTab(savedView));
    }
  } catch { /* ignore */ }
})();

function switchTab(tabId) {
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
    document.body.removeAttribute("data-theme");
  } else {
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

function appendConsoleChatMessage(role, text) {
  if (!consoleChatMessages || !text) return;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();
  const node = document.createElement("div");
  node.className = `console-chat-message ${role}`;
  node.textContent = text;
  consoleChatMessages.appendChild(node);
  consoleChatMessages.scrollTop = consoleChatMessages.scrollHeight;
}

function subscribeConsoleChatTask(taskId) {
  consoleChatEventStream?.close?.();
  consoleChatEventStream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(rawEvent) {
      const frame = toTaskEventFrame(rawEvent);
      const payload = frame.data ?? {};
      if (frame.event === "inline_result") {
        appendConsoleChatMessage("assistant", payload.text ?? payload.message ?? "");
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Done.";
      } else if (frame.event === "failed") {
        appendConsoleChatMessage("system", payload.message ?? "Task failed.");
        consoleChatState.textContent = "Failed.";
      } else if (frame.event === "success" || frame.event === "partial_success") {
        if (payload.summary && !consoleChatResultTaskIds.has(taskId)) appendConsoleChatMessage("assistant", payload.summary);
        consoleChatState.textContent = "Done.";
      }
    },
    onError(error) {
      consoleChatState.textContent = `Stream failed: ${error.message}`;
    }
  });
}

async function submitConsoleChat() {
  const text = consoleChatInput?.value?.trim() ?? "";
  if (!text) return;
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
        executionMode: "interactive"
      })
    });
    const taskId = result.task?.task_id;
    consoleChatState.textContent = taskId ? `Running ${taskId}` : "Running...";
    if (taskId) {
      consoleChatResultTaskIds.delete(taskId);
      subscribeConsoleChatTask(taskId);
    }
    await refreshWorkspace();
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

function isPreviewableArtifactPath(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  if ([".md", ".txt", ".json", ".csv", ".html", ".htm"].some((ext) => p.endsWith(ext))) return true;
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
  runtimeState.textContent = message;
  runtimeState.className = `chip ${ok ? "ready" : "danger"}`;
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
  const cards = [
    { label: "Running", value: s.running, sub: "Active right now" },
    { label: "Queued", value: s.queued, sub: "Waiting for a worker" },
    { label: "Today", value: s.todaySuccess, sub: "Succeeded today", spark: buildTodaySparkline(tasks) },
    { label: "Spend", value: formatMoney(s.monthlySpend), sub: "This month" }
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
        <button class="ghost" data-email-delete="${escapeHtml(account.id)}">Delete</button>
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
        <button class="ghost" data-mcp-delete="${escapeHtml(server.id)}">Delete</button>
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
        <button class="ghost" data-skill-registry-delete="${escapeHtml(registry.id)}">Delete</button>
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
      ${skill.entryPath ? `<div class="toolbar" style="margin-top:8px;"><button class="secondary" data-skill-edit="${escapeHtml(skill.entryPath)}" type="button">Edit</button></div>` : ""}
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
        <button class="ghost" data-code-cli-delete="${escapeHtml(adapter.id)}">Delete</button>
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
  { id: "file_analysis", label: "File Analysis", desc: "Deep file processing, report generation (uses Kimi CLI by default)" },
  { id: "audio_transcription", label: "Audio Transcription", desc: "Speech-to-text for recording notes and system audio" }
];

const PRESET_MODELS = {
  anthropic: ["claude-sonnet-4-5-20250514", "claude-opus-4-5-20250514", "claude-haiku-4-5-20250514"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-5", "deepseek-chat", "kimi-k2", "moonshot-v1-8k"],
  ollama: ["llama3.2", "qwen2.5", "mistral", "phi3"]
};

// One-click provider templates — Inspired by AionUi's multi-engine support,
// these pre-fill the Add Provider modal with a sensible baseUrl + default
// model for each popular OpenAI-compatible (or native) API endpoint. User
// still has to paste their own API key. All verified to work with UCA's
// existing OpenAI-compat adapter (kind: "openai") unless marked otherwise.
const BUILTIN_API_TEMPLATES = [
  { id: "anthropic",    label: "Anthropic",          kind: "anthropic", baseUrl: "https://api.anthropic.com",                                   defaultModel: "claude-sonnet-4-5-20250514" },
  { id: "openai",       label: "OpenAI",             kind: "openai",    baseUrl: "https://api.openai.com/v1",                                   defaultModel: "gpt-4o" },
  { id: "deepseek",     label: "DeepSeek",           kind: "openai",    baseUrl: "https://api.deepseek.com/v1",                                 defaultModel: "deepseek-chat" },
  { id: "moonshot",     label: "Moonshot (Kimi)",    kind: "openai",    baseUrl: "https://api.moonshot.cn/v1",                                  defaultModel: "kimi-k2" },
  { id: "dashscope",    label: "Qwen (Dashscope)",   kind: "openai",    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",           defaultModel: "qwen-max" },
  { id: "zhipu",        label: "Zhipu (GLM)",        kind: "openai",    baseUrl: "https://open.bigmodel.cn/api/paas/v4",                        defaultModel: "glm-4-plus" },
  { id: "minimax",      label: "MiniMax",            kind: "openai",    baseUrl: "https://api.minimax.chat/v1",                                 defaultModel: "abab6.5s-chat" },
  { id: "siliconflow",  label: "SiliconFlow",        kind: "openai",    baseUrl: "https://api.siliconflow.cn/v1",                               defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
  { id: "xai",          label: "xAI (Grok)",         kind: "openai",    baseUrl: "https://api.x.ai/v1",                                         defaultModel: "grok-2-latest" },
  { id: "openrouter",   label: "OpenRouter",         kind: "openai",    baseUrl: "https://openrouter.ai/api/v1",                                defaultModel: "openai/gpt-4o" },
  { id: "groq",         label: "Groq",               kind: "openai",    baseUrl: "https://api.groq.com/openai/v1",                              defaultModel: "llama-3.3-70b-versatile" },
  { id: "together",     label: "Together AI",        kind: "openai",    baseUrl: "https://api.together.xyz/v1",                                 defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks",    label: "Fireworks",          kind: "openai",    baseUrl: "https://api.fireworks.ai/inference/v1",                       defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "mistral",      label: "Mistral",            kind: "openai",    baseUrl: "https://api.mistral.ai/v1",                                   defaultModel: "mistral-large-latest" },
  { id: "gemini",       label: "Google Gemini",      kind: "openai",    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",     defaultModel: "gemini-2.0-flash" },
  { id: "ollama",       label: "Ollama (local)",     kind: "ollama",    baseUrl: "http://127.0.0.1:11434",                                      defaultModel: "llama3.2" }
];

function uniqueNonEmpty(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const value = `${raw ?? ""}`.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
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

function providerFingerprint(provider = {}) {
  return [
    provider.id,
    provider.name,
    provider.kind,
    provider.baseUrl,
    provider.command,
    provider.defaultModel
  ].map((part) => `${part ?? ""}`.toLowerCase()).join(" ");
}

// Build labelled model choices for a code_cli provider. Returns
// `{ id, label }[]` — `id` is the actual value sent via `--model` to the
// subprocess (empty string = no flag, CLI uses its own default). `label` is
// the user-facing string in the Console dropdown.
//
// The first option is ALWAYS "(CLI 自行管理)" — users can pick it to defer
// model selection to the CLI's own configuration (e.g. /model in Claude Code,
// Codex's config file). `pushFlagValue()` in code-cli-bridge.mjs skips
// `--model` when the value is empty, so this is a zero-arg path end-to-end.
function codeCliModelChoices(provider) {
  if (!provider || provider.kind !== "code_cli") return [];

  const fpCli = providerFingerprint(provider);
  const cliManaged = { id: "", label: "(CLI 自行管理 — 用 /model 切换)" };
  const dedup = (choices) => {
    const seen = new Set();
    const out = [];
    for (const choice of choices) {
      const key = `${choice.id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(choice);
    }
    return out;
  };

  // Preserve the provider's explicit defaultModel as a second option so
  // users can see it's sticky.
  const preferred = provider.defaultModel ?? "";
  const preferredChoice = preferred
    ? [{ id: preferred, label: `${preferred} (保存的默认)` }]
    : [];

  if (/(moonshot|kimi)/.test(fpCli)) {
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "kimi-code/kimi-for-coding", label: "Kimi Code" },
      { id: "kimi-k2", label: "K2" },
      { id: "moonshot-v1-128k", label: "Moonshot 128K" }
    ]);
  }

  if (/codex/.test(fpCli)) {
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
      { id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
      { id: "gpt-5.2", label: "GPT-5.2" },
      { id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" }
    ]);
  }

  if (/gemini/.test(fpCli)) {
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (fast)" }
    ]);
  }

  if (/aider/.test(fpCli)) {
    // Aider accepts provider-namespaced shorthands — stay conservative.
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "sonnet", label: "Sonnet (shorthand)" },
      { id: "opus", label: "Opus (shorthand)" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" }
    ]);
  }

  if (/opencode/.test(fpCli)) {
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet" },
      { id: "openai/gpt-5", label: "GPT-5" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" }
    ]);
  }

  if (/claude/.test(fpCli)) {
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "sonnet", label: "Sonnet (shorthand)" },
      { id: "opus", label: "Opus (shorthand)" },
      { id: "haiku", label: "Haiku (shorthand)" },
      { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5 (pinned)" },
      { id: "claude-opus-4-5", label: "claude-opus-4-5 (pinned)" },
      { id: "claude-haiku-4-5", label: "claude-haiku-4-5 (pinned)" }
    ]);
  }

  if (/cursor/.test(fpCli)) {
    return dedup([
      cliManaged,
      ...preferredChoice,
      { id: "claude-sonnet-4-5", label: "Claude Sonnet" },
      { id: "gpt-5", label: "GPT-5" }
    ]);
  }

  // Long-tail CLIs (qwen / iflow / codebuddy / goose / augment / droid /
  // copilot / qoder / vibe / kiro / hermes / snow) — we don't track their
  // model catalogue here; keep to CLI-managed + the saved default if any.
  return dedup([cliManaged, ...preferredChoice]);
}

function providerModelPresets(provider, taskType = "chat") {
  if (!provider) return [];
  const fp = providerFingerprint(provider);
  const preferred = provider.defaultModel ?? "";

  if (provider.kind === "anthropic") {
    return uniqueNonEmpty([preferred, ...PRESET_MODELS.anthropic]);
  }

  if (provider.kind === "ollama") {
    return uniqueNonEmpty([preferred, ...PRESET_MODELS.ollama]);
  }

  if (provider.kind === "code_cli") {
    // Flatten the labelled choices back to plain IDs for callers that need
    // a string[] (e.g. defaultModelForProvider). UI callers should prefer
    // codeCliModelChoices() directly.
    return codeCliModelChoices(provider).map((choice) => choice.id).filter((id) => typeof id === "string" && id.length > 0);
  }

  if (provider.kind === "openai") {
    if (taskType === "audio_transcription") {
      return uniqueNonEmpty(["whisper-1", preferred]);
    }
    if (/deepseek/.test(fp)) {
      return uniqueNonEmpty([preferred, "deepseek-chat", "deepseek-reasoner"]);
    }
    if (/(moonshot|kimi)/.test(fp)) {
      return uniqueNonEmpty([preferred, "kimi-k2", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]);
    }
    if (/dashscope|aliyun|qwen/.test(fp)) {
      return uniqueNonEmpty([preferred, "qwen-max", "qwen-plus", "qwen-turbo", "qwen-coder-plus", "qwen-vl-max"]);
    }
    if (/bigmodel|zhipu|glm/.test(fp)) {
      return uniqueNonEmpty([preferred, "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v-plus"]);
    }
    if (/minimax/.test(fp)) {
      return uniqueNonEmpty([preferred, "abab6.5s-chat", "abab6.5g-chat", "abab6.5t-chat"]);
    }
    if (/siliconflow/.test(fp)) {
      return uniqueNonEmpty([preferred, "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "meta-llama/Meta-Llama-3.1-405B-Instruct"]);
    }
    if (/x\.ai|grok/.test(fp)) {
      return uniqueNonEmpty([preferred, "grok-2-latest", "grok-2-1212", "grok-vision-beta", "grok-beta"]);
    }
    if (/openrouter/.test(fp)) {
      return uniqueNonEmpty([preferred, "openai/gpt-4o", "anthropic/claude-sonnet-4-5", "google/gemini-2.0-flash", "deepseek/deepseek-chat"]);
    }
    if (/groq/.test(fp)) {
      return uniqueNonEmpty([preferred, "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]);
    }
    if (/together/.test(fp)) {
      return uniqueNonEmpty([preferred, "meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct-Turbo"]);
    }
    if (/fireworks/.test(fp)) {
      return uniqueNonEmpty([preferred, "accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3"]);
    }
    if (/mistral/.test(fp)) {
      return uniqueNonEmpty([preferred, "mistral-large-latest", "mistral-small-latest", "codestral-latest", "pixtral-large-latest"]);
    }
    if (/generativelanguage|gemini/.test(fp)) {
      return uniqueNonEmpty([preferred, "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"]);
    }
    return uniqueNonEmpty([
      preferred,
      taskType === "audio_transcription" ? "whisper-1" : "",
      taskType === "vision" ? "gpt-4o" : "",
      ...PRESET_MODELS.openai
    ]);
  }

  return uniqueNonEmpty([preferred]);
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
  if (!provider) return [];
  const fp = `${providerFingerprint(provider)} ${model}`.toLowerCase();

  // code_cli providers: mode is now expressed by the labelled model choices
  // (see codeCliModelChoices). The mode slot is repurposed to show an inert
  // single-option placeholder so the routing UI can hide it cleanly.
  if (provider.kind === "code_cli") {
    return [{ id: "default", label: "—", model }];
  }

  if (/deepseek/.test(fp)) {
    return [
      { id: "chat", label: "Chat", model: "deepseek-chat" },
      { id: "reasoner", label: "Reasoner", model: "deepseek-reasoner" }
    ];
  }

  if (provider.kind === "anthropic" || /claude/.test(fp)) {
    return [
      { id: "balanced", label: "Balanced", model: "claude-sonnet-4-5-20250514" },
      { id: "deep", label: "Deep", model: "claude-opus-4-5-20250514" },
      { id: "fast", label: "Fast", model: "claude-haiku-4-5-20250514" }
    ];
  }

  if (/(moonshot|kimi)/.test(fp)) {
    return [
      { id: "k2", label: "K2", model: "kimi-k2" },
      { id: "8k", label: "8K", model: "moonshot-v1-8k" },
      { id: "32k", label: "32K", model: "moonshot-v1-32k" },
      { id: "128k", label: "128K", model: "moonshot-v1-128k" }
    ];
  }

  if (provider.kind === "openai") {
    return [
      { id: "balanced", label: "Balanced", model: "gpt-4o" },
      { id: "fast", label: "Fast", model: "gpt-4o-mini" },
      { id: "latest", label: "Latest", model: "gpt-5" },
      { id: "transcribe", label: "Transcribe", model: "whisper-1" }
    ];
  }

  if (provider.kind === "ollama") {
    return providerModelPresets(provider).map((preset) => ({
      id: preset,
      label: preset,
      model: preset
    }));
  }

  return [{ id: "default", label: "Default", model }];
}

function defaultModelForProvider(provider, taskType = "chat") {
  // For code_cli we default to "(CLI-managed)" which is the empty string —
  // that's intentional: it means "don't pass --model, let the CLI decide".
  if (provider?.kind === "code_cli") return "";
  if (provider?.kind === "openai" && taskType === "audio_transcription") return "whisper-1";
  return providerModelPresets(provider, taskType)[0] ?? "";
}

// Codex is the only CLI in the current roster that exposes a
// reasoning-effort knob via its `--reasoning-effort` flag. Other CLIs don't
// have the concept, so we only render this select when the provider's
// fingerprint matches codex.
function reasoningEffortOptions(provider) {
  if (!provider || provider.kind !== "code_cli") return [];
  const cached = provider.id ? providerModelOptionsCache.get(provider.id) : null;
  if (Array.isArray(cached?.reasoningEfforts) && cached.reasoningEfforts.length > 0) {
    return cached.reasoningEfforts;
  }
  const fpCli = providerFingerprint(provider);
  if (!/codex/.test(fpCli)) return [];
  return [
    { id: "", label: "(不指定)" },
    { id: "low", label: "Low (快速)" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High (深思)" },
    { id: "xhigh", label: "Extra High (最深)" }
  ];
}

function supportsReasoningEffort(provider) {
  return reasoningEffortOptions(provider).length > 0;
}

function modeForModel(provider, model, currentMode = "") {
  const options = modeOptionsForModel(provider, model);
  if (options.some((option) => option.id === currentMode)) return currentMode;
  return options.find((option) => option.model === model)?.id ?? options[0]?.id ?? "";
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
          <button class="ghost" type="button" data-edit-provider="${escapeHtml(p.id)}">Edit</button>
          <button class="ghost" type="button" data-delete-provider="${escapeHtml(p.id)}" style="color:var(--danger);">Delete</button>
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
    const providerOptions = ['<option value="">— Select provider —</option>']
      .concat(customProviders.map((p) =>
        `<option value="${escapeHtml(p.id)}" ${route.providerId === p.id ? "selected" : ""}>${escapeHtml(p.name)} (${escapeHtml(p.kind)})</option>`
      ))
      .join("");

    const selectedProvider = customProviders.find((p) => p.id === route.providerId);
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
    const hideMode = isCli;

    // Codex-only reasoning-effort knob. Renders in the slot where Mode
    // would otherwise be for non-Codex CLIs, so the grid keeps 3 columns.
    const reasoningOpts = reasoningEffortOptions(selectedProvider);
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
          <select data-routing-provider="${escapeHtml(task.id)}" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;" ${noProviders ? "disabled" : ""}>${providerOptions}</select>
          <select data-routing-model="${escapeHtml(task.id)}" title="Model" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;" ${noProviders || !selectedProvider ? "disabled" : ""}>${modelOptions}</select>
          ${showReasoning ? `<select data-routing-reasoning="${escapeHtml(task.id)}" title="Reasoning effort" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;">${reasoningOptionsHtml}</select>` : ""}
          ${!hideMode && !showReasoning ? `<select data-routing-mode="${escapeHtml(task.id)}" title="Mode" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;" ${noProviders || !selectedProvider ? "disabled" : ""}>${modeOptionsHtml}</select>` : ""}
        </div>
        ${modelMeta ? `<div style="font-size:10px;color:var(--muted);margin-top:6px;">${escapeHtml(modelMeta)}</div>` : ""}
      </div>
    `;
  }).join("") + (noProviders ? `
    <div style="padding:14px;border-radius:10px;background:rgba(99,102,241,0.06);border:1px dashed rgba(99,102,241,0.3);text-align:center;margin-top:4px;">
      <p style="font-size:12px;margin:0 0 8px;color:var(--ink-soft);">No providers added yet. Add one to enable routing.</p>
      <button id="routingAddProviderBtn" type="button" class="primary" style="font-size:12px;">+ Add Provider</button>
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
      // supports it (Codex ↔ Codex). Switching away from Codex should not
      // leave a stray reasoningEffort field lying around.
      const previous = taskRouting[taskId] ?? {};
      if (provider && supportsReasoningEffort(provider) && previous.reasoningEffort) {
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

  // Apply filter + search.
  const filter = state.taskFilter ?? "all";
  const search = (state.taskSearch ?? "").trim().toLowerCase();
  let tasks = allTasks.filter((t) => taskMatchesFilter(t, filter));
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
    taskChildList.innerHTML = `<p class="muted" style="font-size:12px;">No subtasks.</p>`;
    return;
  }

  const childEntries = childIds.map((childId, index) => {
    const child = state.workspace.tasks.find((t) => t.task_id === childId) ?? { task_id: childId };
    const label = child.user_command ?? child.intent ?? child.task_id ?? "Subtask";
    const childIndex = Number.isInteger(child.child_index) ? child.child_index + 1 : index + 1;
    const status = child.status ?? "unknown";
    const sc = status === "success" ? "ready" : status === "failed" ? "danger" : "warning";
    return `
      <button class="task-child-item" data-child-task-id="${escapeHtml(childId)}">
        <div class="row">
          <div>
            <strong style="font-size:12px;">#${childIndex} · ${escapeHtml(label)}</strong>
            <p class="muted" style="margin-top:4px;">${escapeHtml(child.executor ?? "unknown")} · ${escapeHtml(child.source_type ?? "unknown")}</p>
          </div>
          <span class="chip ${sc}">${escapeHtml(status)}</span>
        </div>
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
      runtimeState.textContent = `Stream disconnected · ${error.message}`;
      runtimeState.className = "chip warning";
    }
  });
}

/* ── Artifact selection ── */
async function selectTaskArtifact(artifactPath) {
  state.selectedTaskArtifactPath = artifactPath ?? null;
  openTaskArtifactButton.hidden = !state.selectedTaskArtifactPath;
  copyTaskArtifactPathButton.hidden = !state.selectedTaskArtifactPath;
  useTaskArtifactContextButton.hidden = !state.selectedTaskArtifactPath;

  if (!state.selectedTaskArtifactPath) {
    taskArtifactPreview.textContent = "Select an artifact to preview.";
    return;
  }

  if (isPreviewableArtifactPath(state.selectedTaskArtifactPath)) {
    try {
      const raw = await window.ucaShell.readTextFile(state.selectedTaskArtifactPath, 2600);
      taskArtifactPreview.textContent = normalisePreviewText(raw).slice(0, 1200) || "No text content.";
    } catch {
      taskArtifactPreview.textContent = "Cannot preview, open file directly.";
    }
  } else {
    taskArtifactPreview.textContent = "Open externally for best results.";
  }

  renderTaskArtifacts(state.selectedTaskDetail);
}

function renderTaskArtifacts(detail) {
  const artifacts = detail?.artifacts ?? [];
  taskArtifactCount.textContent = `${artifacts.length}`;

  if (artifacts.length === 0) {
    state.selectedTaskArtifactPath = null;
    taskArtifactList.innerHTML = `<p class="muted" style="font-size:12px;">No artifacts yet.</p>`;
    taskArtifactPreview.textContent = "Select an artifact to preview.";
    openTaskArtifactButton.hidden = true;
    copyTaskArtifactPathButton.hidden = true;
    useTaskArtifactContextButton.hidden = true;
    return;
  }

  if (!state.selectedTaskArtifactPath || !artifacts.some((a) => a.path === state.selectedTaskArtifactPath)) {
    state.selectedTaskArtifactPath = artifacts[0].path;
  }

  taskArtifactList.innerHTML = artifacts.map((a, i) => `
    <button class="artifact-item ${a.path === state.selectedTaskArtifactPath ? "active" : ""}" data-artifact-path="${escapeHtml(a.path)}">
      <div class="row">
        <strong style="font-size:12px;">${escapeHtml(formatArtifactLabel(a.path))}</strong>
        <span class="chip ${i === 0 ? "ready" : "muted"}" style="font-size:10px;">${i === 0 ? "Primary" : "Result"}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:11px;">${escapeHtml(a.path)}</p>
    </button>
  `).join("");

  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-path]")) {
    btn.addEventListener("click", () => void selectTaskArtifact(btn.dataset.artifactPath));
  }

  openTaskArtifactButton.hidden = !state.selectedTaskArtifactPath;
  copyTaskArtifactPathButton.hidden = !state.selectedTaskArtifactPath;
  useTaskArtifactContextButton.hidden = !state.selectedTaskArtifactPath;
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

  filesListEl.innerHTML = visible.map((art) => `
    <button class="artifact-item ${art.path === filesSelectedPath ? "active" : ""}" data-file-path="${escapeHtml(art.path)}" style="text-align:left;">
      <div class="row">
        <strong style="font-size:12px;">${escapeHtml(art.name)}</strong>
        <span class="chip muted" style="font-size:10px;">${escapeHtml(art.label)}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:11px;">${escapeHtml(art.taskCommand?.slice(0, 60) ?? "")}</p>
      <p class="muted" style="margin-top:2px;font-size:10px;">${escapeHtml(formatDateTime(art.createdAt))}</p>
    </button>
  `).join("");

  for (const btn of filesListEl.querySelectorAll("[data-file-path]")) {
    btn.addEventListener("click", () => void selectFileArtifact(btn.dataset.filePath));
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
      <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.18);color:var(--primary);">
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
    <div data-uca-downgraded="1" style="padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.22);margin-top:8px;">
      <strong style="font-size:12px;color:#b45309;">AI claim downgraded</strong>
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

function renderTaskDetail(detail) {
  if (!detail) {
    state.selectedTaskDetail = null;
    taskDetailSummary.innerHTML = `<p class="muted" style="font-size:12px;">Select a task to view details.</p>`;
    taskTimeline.innerHTML = `<div class="timeline-item"><p class="muted">No timeline.</p></div>`;
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
    <div style="padding:8px 10px;border-radius:8px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.12);margin-top:8px;">
      <strong style="font-size:12px;color:var(--danger);">Failed</strong>
      <p class="muted" style="margin:4px 0 0;font-size:12px;">${escapeHtml(task.failure_user_message ?? task.failure_category)}</p>
    </div>
  ` : "";
  const parentLink = task.parent_task_id ? `
    <span>父任务：
      <button class="ghost" data-parent-task-id="${escapeHtml(task.parent_task_id)}" style="padding:0 6px;font-size:11px;">← 返回</button>
    </span>
  ` : "";
  // UCA-064: show composite result summary when present
  const resultSummaryBlock = task.result_summary ? `
    <div style="padding:8px 10px;border-radius:8px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.14);margin-top:8px;white-space:pre-wrap;font-size:12px;line-height:1.6;">
      ${escapeHtml(task.result_summary)}
    </div>
  ` : "";
  taskDetailSummary.innerHTML = `
    <div class="stack" style="gap:8px;">
      <div class="row">
        <strong style="font-size:14px;">${escapeHtml(task.user_command ?? task.intent ?? task.task_id)}</strong>
        <span class="chip ${task.status === "success" ? "ready" : task.status === "failed" ? "danger" : "warning"}">${escapeHtml(task.status ?? "unknown")}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--muted);">
        <span>ID: ${escapeHtml(task.task_id)}</span>
        <span>Executor: ${escapeHtml(task.executor ?? "unknown")}</span>
        <span>Source: ${escapeHtml(task.context_packet?.source_type ?? "unknown")}</span>
        <span>Retry: ${escapeHtml(task.retry_count ?? 0)}</span>
        <span>Cost: ${escapeHtml(formatMoney(task.cost_usd ?? 0))}</span>
        <span>${escapeHtml(formatDateTime(task.created_at))}</span>
        ${parentLink}
      </div>
      ${renderProviderLine(providerDescriptor)}
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
  taskTimeline.innerHTML = (detail.events ?? []).length > 0
    ? detail.events.map((ev) => renderTimelineEntry(ev)).join("")
    : `<div class="timeline-item"><p class="muted" style="font-size:12px;">No timeline.</p></div>`;
  renderTaskArtifacts(detail);
  renderTaskChildren(detail);
  retryTaskButton.disabled = !task.retryable;
  cancelTaskButton.disabled = !["queued", "running", "cancelling"].includes(task.status);
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
    ? `<button class="primary" data-save-approve-id="${escapeHtml(a.approval_id)}">Save &amp; Approve</button>`
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
          <button class="secondary" data-approve-id="${escapeHtml(a.approval_id)}" ${disabled ? "disabled" : ""}>Approve</button>
          <button class="ghost" data-reject-id="${escapeHtml(a.approval_id)}" ${disabled ? "disabled" : ""}>Reject</button>
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

for (const btn of document.querySelectorAll("[data-schedule-view]")) {
  btn.addEventListener("click", () => {
    scheduleViewMode = btn.dataset.scheduleView;
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
      const color = s.color || s.metadata?.color || "#6366f1";
      return `<div class="cal-entry" style="border-left:3px solid ${escapeHtml(color)};padding-left:4px;font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>`;
    }).join("");
    const overflow = daySchedules.length > 3 ? `<div style="font-size:9px;color:var(--muted);">+${daySchedules.length - 3} more</div>` : "";
    return `<div class="cal-cell${isToday ? " today" : ""}" style="min-height:${mode === "week" ? "80" : "60"}px;padding:4px;border:1px solid rgba(255,255,255,0.06);border-radius:6px;${isToday ? "background:rgba(99,102,241,0.08);" : ""}"><div style="font-size:10px;font-weight:500;color:${isToday ? "var(--primary)" : "var(--muted)"};">${day.getDate()}</div>${entries}${overflow}</div>`;
  }).join("");

  scheduleCalendar.style.display = "block";
  scheduleCalendar.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:11px;">
      ${header}
      ${padCells}
      ${gridCells}
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

  // Highlight the active view-mode button
  for (const btn of document.querySelectorAll("[data-schedule-view]")) {
    btn.classList.toggle("active", btn.dataset.scheduleView === scheduleViewMode);
  }

  if (scheduleViewMode === "week" || scheduleViewMode === "month") {
    renderScheduleCalendarGrid(schedules, scheduleViewMode);
  } else {
    if (scheduleCalendar) scheduleCalendar.style.display = "none";
  }

  scheduleList.innerHTML = schedules.map((s) => {
    const color = s.color || s.metadata?.color || "#6366f1";
    const categoryLabel = s.category || s.metadata?.category || "";
    const completedBadge = s.completed_at ? `<span class="chip ready" style="font-size:10px;">completed</span>` : "";
    return `
    <div class="schedule-item" style="border-left:4px solid ${escapeHtml(color)};padding-left:10px;">
      <div class="row">
        <div>
          ${categoryLabel ? `<span style="font-size:10px;padding:1px 6px;border-radius:999px;background:${escapeHtml(color)}22;color:${escapeHtml(color)};font-weight:500;">${escapeHtml(categoryLabel)}</span>` : ""}
          <h4>${escapeHtml(s.name ?? s.schedule_id)}</h4>
          <p class="muted">${escapeHtml(s.trigger_type ?? "manual")} · ${escapeHtml(s.execution_mode ?? "interactive")}</p>
        </div>
        <span class="chip ${s.enabled ? "ready" : "warning"}">${s.enabled ? "enabled" : "paused"}</span>
        ${completedBadge}
      </div>
      <div class="row wrap" style="margin-top:6px;">
        <span class="muted" style="font-size:11px;">Next: ${escapeHtml(formatDateTime(s.next_run_at))}</span>
        <span class="muted" style="font-size:11px;">Last: ${escapeHtml(s.last_run_status ?? "never")}</span>
        <button class="secondary" data-run-schedule-id="${escapeHtml(s.schedule_id)}">Run Now</button>
        <button class="ghost" data-toggle-schedule-id="${escapeHtml(s.schedule_id)}" data-enabled="${s.enabled ? "false" : "true"}">${s.enabled ? "Pause" : "Resume"}</button>
        <button class="ghost" data-delete-schedule-id="${escapeHtml(s.schedule_id)}">Delete</button>
      </div>
    </div>
  `; }).join("");

  for (const btn of scheduleList.querySelectorAll("[data-run-schedule-id]")) {
    btn.addEventListener("click", async () => {
      await fetchJson(`/schedules/${encodeURIComponent(btn.dataset.runScheduleId)}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ triggerPayload: { source: "desktop_console" } }) });
      await refreshWorkspace();
    });
  }

  for (const btn of scheduleList.querySelectorAll("[data-toggle-schedule-id]")) {
    btn.addEventListener("click", async () => {
      await fetchJson(`/schedules/${encodeURIComponent(btn.dataset.toggleScheduleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: btn.dataset.enabled === "true" })
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
  const executions = state.workspace.dagExecutions ?? [];
  dagExecutionCount.textContent = `${executions.length}`;
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
          <button class="secondary" data-view-dag-id="${escapeHtml(e.execution_id)}">View</button>
          <button class="ghost" data-resume-dag-id="${escapeHtml(e.execution_id)}" ${e.status !== "failed" ? "disabled" : ""}>Resume</button>
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

function renderHistory() {
  const results = state.workspace.history ?? [];
  historyPreview.textContent = state.currentHistoryQuery
    ? `Query: ${state.currentHistoryQuery}\nResults: ${results.length}`
    : "No results yet.";
  if (results.length === 0) {
    renderEmpty(historyList, state.currentHistoryQuery ? "No matches." : "Enter a keyword to search.");
    return;
  }

  historyList.innerHTML = results.map((r) => {
    const taskExists = r.id && state.workspace.tasks.some((t) => t.task_id === r.id);
    return `
    <div class="history-item" data-history-summary="${escapeHtml(r.metadata?.summary ?? r.text ?? "")}" data-history-task-id="${escapeHtml(r.id ?? "")}" role="button" tabindex="0" style="text-align:left;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(r.metadata?.summary ?? r.id)}</strong>
        <span class="muted" style="font-size:11px;">${escapeHtml(Number(r.score ?? 0).toFixed(4))}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(r.metadata?.created_at ?? "")}</p>
      ${taskExists ? `<button type="button" class="ghost" data-open-history-task="${escapeHtml(r.id)}" style="margin-top:8px;font-size:11px;padding:4px 8px;">Open task</button>` : ""}
    </div>
  `;
  }).join("");

  for (const btn of historyList.querySelectorAll("[data-history-summary]")) {
    btn.addEventListener("click", () => {
      historyPreview.textContent = btn.dataset.historySummary || "No summary";
    });
    btn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        historyPreview.textContent = btn.dataset.historySummary || "No summary";
      }
    });
  }

  for (const btn of historyList.querySelectorAll("[data-open-history-task]")) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const taskId = btn.dataset.openHistoryTask;
      if (!taskId) return;
      state.selectedTaskId = taskId;
      switchTab("tasks");
      renderTasks();
      void refreshTaskDetail();
    });
  }
}

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

    const historyPromise = state.currentHistoryQuery
      ? fetchJson("/history/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: state.currentHistoryQuery, limit: 8 }) })
      : Promise.resolve({ results: [] });

    const [health, tasksP, approvalsP, schedulesP, templatesP, budgetP, securityP, auditP, dagP, providersP, cliP, mcpP, skillsP, emailP, emailSettingsP, historyP] = await Promise.all([
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
      fetchJson("/config/email/settings"),
      historyPromise
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
      history: historyP.results ?? [],
      security: securityP.security ?? null,
      audit: auditP.entries ?? [],
      dagExecutions: dagP.executions ?? []
    };

    setRuntimeBadge(true, `Connected · ${state.serviceBaseUrl}`);
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
    renderHistory();
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
      await fetchJson("/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_command: text, source_app: "console.palette" })
      });
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

historyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.currentHistoryQuery = historyQueryInput.value.trim();
  await refreshWorkspace();
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

mcpServerRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
skillRegistryRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
codeCliAdapterRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
emailAccountRefreshBtn?.addEventListener("click", () => void refreshWorkspace());

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

previewDagButton.addEventListener("click", async () => {
  const raw = dagEditorInput.value.trim();
  if (!raw) { dagPreview.textContent = "Enter DAG JSON first."; return; }
  dagPreview.textContent = "Validating...";
  try {
    const graph = JSON.parse(raw);
    const result = await fetchJson("/dag/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph }) });
    dagPreview.textContent = JSON.stringify(result.validation ?? result, null, 2);
  } catch (error) {
    dagPreview.textContent = `Failed: ${error.message}`;
  }
});

loadSampleDagButton.addEventListener("click", () => {
  dagEditorInput.value = JSON.stringify(buildSampleDag(), null, 2);
  dagPreview.textContent = "Sample DAG loaded.";
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

dagEditorInput.value = JSON.stringify(buildSampleDag(), null, 2);
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

function renderConnEmailAccounts(accounts) {
  if (!connEmailList) return;
  if (!accounts?.length) {
    connEmailList.innerHTML = "";
    return;
  }
  connEmailList.innerHTML = accounts.map((acc) => `
    <div class="surface" style="display:flex;align-items:center;gap:10px;padding:12px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;">${acc.displayName ?? acc.email ?? acc.id}</div>
        <div style="font-size:11px;color:var(--muted);">${acc.provider?.toUpperCase() ?? "IMAP"} · ${acc.imapHost ?? (acc.provider === "graph" ? "Microsoft Graph" : "")}</div>
      </div>
      <button class="ghost" style="font-size:12px;padding:3px 8px;" data-delete-email="${acc.id}">移除</button>
    </div>`).join("");
  connEmailList.querySelectorAll("[data-delete-email]").forEach((btn) => {
    btn.addEventListener("click", async () => {
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
  "mcp-filesystem": { title: "Filesystem", desc: "Read and write files in allowed local directories." },
  "mcp-memory":     { title: "Memory", desc: "Persistent graph memory for agentic tasks." },
  "mcp-brave-search": { title: "Brave Search", desc: "Web search through Brave Search API.", configKey: "BRAVE_API_KEY", configLabel: "Brave API Key", configPlaceholder: "BSA..." },
  "mcp-puppeteer":  { title: "Browser Automation", desc: "Puppeteer-powered browser actions for agentic workflows." },
  "local-fs":       { title: "Legacy Local FS", desc: "Deprecated. Use Filesystem instead." },
  "figma":          { title: "Figma", desc: "Design context through an external Figma MCP plugin.", guideUrl: "https://www.figma.com/" }
};

const EXTRA_PLUGIN_OPTIONS = [
  { title: "GitHub", desc: "Repository issues, pull requests, and code search. Plugin installer pending.", status: "Coming soon" },
  { title: "Notion", desc: "Pages, databases, and workspace notes. Plugin installer pending.", status: "Coming soon" },
  { title: "Slack", desc: "Channel messages and team workflow actions. Plugin installer pending.", status: "Coming soon" },
  { title: "Google Drive", desc: "Docs and Drive file context. Plugin installer pending.", status: "Coming soon" }
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
  if (!servers?.length) {
    connectorsMcpList.innerHTML = "<p class='muted' style='font-size:12px;'>No MCP servers found.</p>";
    return;
  }
  connectorsMcpList.innerHTML = `<div class="connector-plugin-grid"></div>`;
  const grid = connectorsMcpList.querySelector(".connector-plugin-grid");
  for (const s of servers) {
    const meta = MCP_SERVER_META[s.id] ?? { title: s.displayName ?? s.id, desc: s.id };
    const status = getMcpStatusView(s);
    const statusLabel = status.label;
    const statusClass = status.className;
    const hasCfg = !!meta.configKey;
    const needsConfig = hasCfg && !s.enabled;
    const canInstall = Boolean(s.configured || s.available || needsConfig);
    const installed = s.available && s.enabled;
    const cardId = `mcp-card-${s.id}`;

    const card = document.createElement("div");
    card.className = `connector-plugin-card mcp-server-card ${canInstall ? "" : "unavailable"}`;
    card.id = cardId;
    card.innerHTML = `
      <div class="mcp-server-card-header">
        <div class="mcp-server-info">
          <div class="mcp-server-name">${escapeHtml(meta.title ?? s.displayName ?? s.id)}</div>
          <div class="mcp-server-desc">${escapeHtml(meta.desc)}</div>
        </div>
        <span class="mcp-status-dot ${statusClass}" title="${statusLabel}"></span>
        <span style="font-size:11px;color:var(--muted);margin-right:6px;">${statusLabel}</span>
      </div>
      <div class="toolbar" style="padding:0 14px 12px;">
        ${hasCfg ? `<button class="secondary" style="font-size:12px;" data-mcp-config="${escapeHtml(s.id)}">${needsConfig ? "Configure" : "Configure"}</button>` : ""}
        ${meta.guideUrl ? `<button class="ghost" style="font-size:12px;" data-plugin-guide="${escapeHtml(meta.guideUrl)}">Guide</button>` : ""}
        <button class="${installed ? "ghost" : "primary"}" style="font-size:12px;" ${canInstall ? "" : "disabled"} data-mcp-install="${escapeHtml(s.id)}" data-mcp-enabled="${installed ? "false" : "true"}">
          ${installed ? "Disable" : needsConfig ? "Configure first" : "Install"}
        </button>
      </div>
      ${hasCfg ? `
      <div class="mcp-server-config" id="mcp-cfg-${s.id}">
        <div style="margin-top:8px;">
          <label style="font-size:12px;">${meta.configLabel}</label>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <input type="password" id="mcp-cfg-val-${s.id}" placeholder="${meta.configPlaceholder ?? ''}" style="flex:1;">
            <button class="secondary" style="font-size:12px;padding:5px 12px;" data-mcp-cfg-save="${s.id}">保存</button>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;" id="mcp-cfg-state-${s.id}"></div>
        </div>
      </div>` : ""}
    `;
    grid?.appendChild(card);
  }

  for (const option of EXTRA_PLUGIN_OPTIONS) {
    const card = document.createElement("div");
    card.className = "connector-plugin-card unavailable";
    card.innerHTML = `
      <div class="mcp-server-card-header">
        <div class="mcp-server-info">
          <div class="mcp-server-name">${escapeHtml(option.title)}</div>
          <div class="mcp-server-desc">${escapeHtml(option.desc)}</div>
        </div>
        <span class="chip muted">${escapeHtml(option.status)}</span>
      </div>
      <div class="toolbar" style="padding:0 14px 12px;">
        <button class="secondary" disabled style="font-size:12px;">Install</button>
      </div>
    `;
    grid?.appendChild(card);
  }

  connectorsMcpList.querySelectorAll("[data-mcp-install]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.mcpInstall;
      const enabled = button.dataset.mcpEnabled === "true";
      const cfgDiv = document.getElementById(`mcp-cfg-${id}`);
      if (button.textContent.includes("Configure") && cfgDiv) {
        cfgDiv.classList.add("open");
        return;
      }
      button.disabled = true;
      try {
        await fetch(`${state.serviceBaseUrl}/ai/mcp/${encodeURIComponent(id)}/toggle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled })
        });
        await loadConnectorsTab();
      } catch (err) {
        button.disabled = false;
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
let _acResourceTab = {};  // { microsoft: 'files'|'emails'|'calendar' }

async function renderAccountConnectors(connectors, connectedAccounts = []) {
  const list = document.getElementById("accountConnectorsList");
  if (!list) return;
  list.innerHTML = "";

  if (connectedAccounts.length > 0) {
    const accountHeader = document.createElement("div");
    accountHeader.className = "muted";
    accountHeader.style.cssText = "font-size:11px;margin:0 0 2px;";
    accountHeader.textContent = "已连接账户";
    list.appendChild(accountHeader);

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
      const card = document.createElement("div");
      card.className = "account-connector-card";
      card.innerHTML = `
        <div class="acc-card-main">
          <div class="acc-logo ${meta.logoClass}">${meta.logo}</div>
          <div class="acc-info">
            <p class="acc-name">${escapeHtml(account.displayName ?? account.email ?? meta.label)}</p>
            <p class="acc-desc">${escapeHtml(meta.label)} · ${escapeHtml(account.email ?? "")} · ${escapeHtml(account.tokenStatus ?? "active")}</p>
          </div>
          <span class="acc-status-dot ${account.tokenStatus === "active" ? "connected" : ""}" title="${escapeHtml(account.tokenStatus ?? "")}"></span>
          <div class="acc-actions">
            <button class="ghost" data-connected-reauth="${escapeHtml(account.id)}" style="font-size:12px;padding:5px 10px;">重新授权</button>
            <button class="ghost" data-connected-delete="${escapeHtml(account.id)}" style="font-size:12px;padding:5px 10px;">断开</button>
          </div>
        </div>
        <div style="padding:0 16px 12px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${capLabels.length ? capLabels.map((label) => `<span style="font-size:10px;padding:2px 7px;border:1px solid rgba(255,255,255,0.14);border-radius:999px;color:var(--muted);">${escapeHtml(label)}</span>`).join("") : `<span class="muted" style="font-size:11px;">暂无能力标签</span>`}
            ${defaults.map((label) => `<span style="font-size:10px;padding:2px 7px;border:1px solid rgba(86,196,137,0.38);border-radius:999px;color:#86efac;">${escapeHtml(label)}</span>`).join("")}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="ghost" data-connected-default="${escapeHtml(account.id)}" data-purpose="email" style="font-size:11px;padding:4px 8px;">设为邮箱默认</button>
            <button class="ghost" data-connected-default="${escapeHtml(account.id)}" data-purpose="files" style="font-size:11px;padding:4px 8px;">设为文件默认</button>
            <button class="ghost" data-connected-default="${escapeHtml(account.id)}" data-purpose="calendar" style="font-size:11px;padding:4px 8px;">设为日历默认</button>
          </div>
        </div>
      `;
      list.appendChild(card);
    }

    const providerHeader = document.createElement("div");
    providerHeader.className = "muted";
    providerHeader.style.cssText = "font-size:11px;margin:4px 0 2px;";
    providerHeader.textContent = "添加 / 配置 provider";
    list.appendChild(providerHeader);
  }

  for (const connector of connectors) {
    const meta = ACCOUNT_CONNECTOR_META[connector.type];
    if (!meta) continue;
    const type = connector.type;

    const card = document.createElement("div");
    card.className = "account-connector-card";
    card.dataset.acType = type;

    // ── Main row ──
    const dotClass = connector.connected ? "connected" : "";
    const statusText = connector.connected
      ? (connector.email ?? "已连接")
      : connector.configured
        ? "未连接 — 点击\"授权\"登录"
        : "需要配置 Client ID";
    const connectBtn = connector.connected
      ? `<button class="ghost" data-ac-disconnect="${type}" style="font-size:12px;padding:5px 12px;">断开</button>`
      : `<button class="primary" data-ac-connect="${type}" style="font-size:12px;padding:5px 12px;"${connector.configured ? "" : " disabled"}>授权登录</button>`;
    const configToggleLabel = _acConfigOpen[type] ? "收起" : "配置";

    card.innerHTML = `
      <div class="acc-card-main">
        <div class="acc-logo ${meta.logoClass}">${meta.logo}</div>
        <div class="acc-info">
          <p class="acc-name">${meta.label}</p>
          <p class="acc-desc">${connector.connected ? escapeHtml(statusText) : meta.desc}</p>
        </div>
        <span class="acc-status-dot ${dotClass}" title="${escapeHtml(statusText)}"></span>
        <div class="acc-actions">
          ${connectBtn}
          <button class="ghost" data-ac-config-toggle="${type}" style="font-size:12px;padding:5px 10px;">${configToggleLabel}</button>
        </div>
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
          <button class="primary" data-ac-save-config="${type}" style="font-size:12px;padding:5px 14px;">保存</button>
          <span data-ac-config-status style="font-size:12px;color:var(--muted);"></span>
        </div>
      `;
      card.appendChild(configPanel);
    }

    // ── Resource strip (shown when connected) ──
    if (connector.connected) {
      const tab = _acResourceTab[type] ?? "files";
      const strip = document.createElement("div");
      strip.className = "acc-resource-strip";
      strip.innerHTML = `
        <button data-ac-res="${type}" data-ac-tab="files" ${tab === "files" ? "style='border-color:rgba(255,255,255,0.35);color:var(--text);'" : ""}>📁 文件</button>
        <button data-ac-res="${type}" data-ac-tab="emails" ${tab === "emails" ? "style='border-color:rgba(255,255,255,0.35);color:var(--text);'" : ""}>📧 邮件</button>
        <button data-ac-res="${type}" data-ac-tab="calendar" ${tab === "calendar" ? "style='border-color:rgba(255,255,255,0.35);color:var(--text);'" : ""}>📅 日历</button>
      `;
      card.appendChild(strip);

      const resourceBody = document.createElement("div");
      resourceBody.style.cssText = "padding:0 16px 12px;font-size:12px;";
      resourceBody.dataset.acResourceBody = type;
      resourceBody.innerHTML = `<p class="muted" style="margin:6px 0;">加载中…</p>`;
      card.appendChild(resourceBody);
    }

    list.appendChild(card);
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
  list.querySelectorAll("[data-ac-res]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { acRes: type, acTab: tab } = btn.dataset;
      _acResourceTab[type] = tab;
      void loadAccountResourcePreview(type, tab);
      // update button styles in-place without full re-render
      btn.closest(".acc-resource-strip").querySelectorAll("[data-ac-res]").forEach((b) => {
        b.removeAttribute("style");
      });
      btn.style.cssText = "border-color:rgba(255,255,255,0.35);color:var(--text);";
    });
  });
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

  // Auto-load resource previews for connected accounts
  for (const connector of connectors) {
    if (connector.connected) {
      void loadAccountResourcePreview(connector.type, _acResourceTab[connector.type] ?? "files");
    }
  }
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
  delete _acResourceTab[type];
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

async function loadAccountResourcePreview(type, tab) {
  const body = document.querySelector(`[data-ac-resource-body="${type}"]`);
  if (!body) return;
  body.innerHTML = `<p class="muted" style="margin:6px 0;">加载中…</p>`;
  try {
    let url;
    if (tab === "files") url = `${state.serviceBaseUrl}/connectors/accounts/${type}/files?limit=8`;
    else if (tab === "emails") url = `${state.serviceBaseUrl}/connectors/accounts/${type}/emails?limit=6`;
    else url = `${state.serviceBaseUrl}/connectors/accounts/${type}/calendar?limit=6`;

    const r = await fetch(url);
    if (!r.ok) { body.innerHTML = `<p class="muted" style="margin:6px 0;">加载失败</p>`; return; }
    const data = await r.json();

    if (tab === "files") {
      const files = data.files ?? [];
      if (!files.length) { body.innerHTML = `<p class="muted" style="margin:6px 0;">暂无文件</p>`; return; }
      body.innerHTML = files.map((f) => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <span style="font-size:14px;">${f.isFolder ? "📁" : "📄"}</span>
          <a href="#" data-external-url="${escapeHtml(f.url ?? "")}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);text-decoration:none;">${escapeHtml(f.name)}</a>
          <span style="font-size:10px;color:var(--muted);white-space:nowrap;">${f.modified ? new Date(f.modified).toLocaleDateString("zh-CN") : ""}</span>
        </div>`).join("");
    } else if (tab === "emails") {
      const emails = data.emails ?? [];
      if (!emails.length) { body.innerHTML = `<p class="muted" style="margin:6px 0;">暂无邮件</p>`; return; }
      body.innerHTML = emails.map((m) => `
        <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-weight:${m.isRead ? 400 : 600};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.subject ?? "(无主题)")}</div>
          <div style="font-size:10px;color:var(--muted);">${escapeHtml(m.fromName ?? m.from ?? "")} · ${m.received ? new Date(m.received).toLocaleDateString("zh-CN") : ""}</div>
        </div>`).join("");
    } else {
      const events = data.events ?? [];
      if (!events.length) { body.innerHTML = `<p class="muted" style="margin:6px 0;">近期无日程</p>`; return; }
      body.innerHTML = events.map((e) => `
        <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.title ?? "(无标题)")}</div>
          <div style="font-size:10px;color:var(--muted);">${e.start ? new Date(e.start).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""} ${e.location ? "· " + escapeHtml(e.location) : ""}</div>
        </div>`).join("");
    }

    body.querySelectorAll("[data-external-url]").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (a.dataset.externalUrl) window.ucaShell?.openExternal?.(a.dataset.externalUrl);
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="muted" style="margin:6px 0;">Error: ${escapeHtml(err.message)}</p>`;
  }
}

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
    ? `<button type="button" class="ghost" data-email-setup-url="${escapeHtml(preset.setupUrl)}">打开网页登录/设置页面</button>`
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
