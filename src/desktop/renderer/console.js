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

/* ═══════════════════════════════════════════════
   TAB NAVIGATION
   ═══════════════════════════════════════════════ */

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function switchTab(tabId) {
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
  tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${tabId}`));
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === "files") {
      void loadAllArtifacts();
    }
  });
});

// External navigation request (e.g., overlay's settings shortcut button)
if (window.ucaShell?.onNavigateConsole) {
  window.ucaShell.onNavigateConsole((payload = {}) => {
    const tabId = typeof payload.tabId === "string" ? payload.tabId : "settings";
    switchTab(tabId);
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
  selectedTemplateId: null,
  currentHistoryQuery: "",
  detailVersion: 0,
  updatingSecurity: false,
  selectedDagExecutionId: null,
  selectedTaskDetail: null,
  selectedTaskArtifactPath: null
};

let selectedTaskEventStream = null;
let selectedTaskEventTaskId = null;
let selectedTaskEventBaseUrl = null;
let handledSelectedTaskEventIds = new Set();

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

function renderSummary() {
  const s = computeSummary(state.workspace.tasks, state.workspace.budget);
  const items = [
    ["Running", s.running],
    ["Queued", s.queued],
    ["Today", s.todaySuccess],
    ["Spend", formatMoney(s.monthlySpend)]
  ];
  summaryGrid.innerHTML = items.map(([label, value]) => `
    <div class="summary-tile">
      <span class="muted" style="font-size:11px;">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
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
        <span class="chip ${server.available ? "ready" : server.enabled === false ? "muted" : "warning"}">${escapeHtml(server.available ? "ready" : server.enabled === false ? "disabled" : "unavailable")}</span>
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
  skillRegistryCount.textContent = `${registries.length}`;
  if (registries.length === 0) {
    renderEmpty(skillRegistryList, "No skill registries configured.");
    return;
  }
  skillRegistryList.innerHTML = registries.map((registry) => `
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

const TASK_TYPES = [
  { id: "chat", label: "Chat / Q&A", desc: "General conversation, summarize, translate, explain" },
  { id: "vision", label: "Vision / Image", desc: "Image analysis, screenshot understanding" },
  { id: "file_analysis", label: "File Analysis", desc: "Deep file processing, report generation (uses Kimi CLI by default)" }
];

const PRESET_MODELS = {
  anthropic: ["claude-sonnet-4-5-20250514", "claude-opus-4-5-20250514", "claude-haiku-4-5-20250514"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-5", "deepseek-chat", "kimi-k2", "moonshot-v1-8k"],
  ollama: ["llama3.2", "qwen2.5", "mistral", "phi3"]
};

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
    return uniqueNonEmpty([preferred, "kimi-k2", "claude-sonnet-4-5-20250514", "gpt-5"]);
  }

  if (provider.kind === "openai") {
    if (/deepseek/.test(fp)) {
      return uniqueNonEmpty([preferred, "deepseek-chat", "deepseek-reasoner"]);
    }
    if (/(moonshot|kimi)/.test(fp)) {
      return uniqueNonEmpty([preferred, "kimi-k2", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]);
    }
    return uniqueNonEmpty([
      preferred,
      taskType === "vision" ? "gpt-4o" : "",
      ...PRESET_MODELS.openai
    ]);
  }

  return uniqueNonEmpty([preferred]);
}

function modeOptionsForModel(provider, model = "") {
  if (!provider) return [];
  const fp = `${providerFingerprint(provider)} ${model}`.toLowerCase();

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
      { id: "latest", label: "Latest", model: "gpt-5" }
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
  return providerModelPresets(provider, taskType)[0] ?? "";
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
    const modelOptions = selectedProvider
      ? uniqueNonEmpty([modelValue, ...providerModelPresets(selectedProvider, task.id)]).map((m) =>
          `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
        ).join("")
      : "";
    const modeValue = modeForModel(selectedProvider, modelValue, route.mode ?? "");
    const modeOptions = selectedProvider
      ? modeOptionsForModel(selectedProvider, modelValue || defaultModelForProvider(selectedProvider, task.id)).map((mode) =>
          `<option value="${escapeHtml(mode.id)}" ${modeValue === mode.id ? "selected" : ""}>${escapeHtml(mode.label)}</option>`
        ).join("")
      : "";

    return `
      <div style="padding:12px;border-radius:10px;background:var(--surface-strong);border:1px solid var(--line);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <strong style="font-size:13px;">${escapeHtml(task.label)}</strong>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">${escapeHtml(task.desc)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">
          <select data-routing-provider="${escapeHtml(task.id)}" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;" ${noProviders ? "disabled" : ""}>${providerOptions}</select>
          <input type="text" data-routing-model="${escapeHtml(task.id)}" list="models-${escapeHtml(task.id)}" value="${escapeHtml(modelValue)}" placeholder="Model name" style="font-size:12px;" ${noProviders ? "disabled" : ""}>
          <select data-routing-mode="${escapeHtml(task.id)}" title="Mode" style="font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;" ${noProviders || !selectedProvider ? "disabled" : ""}>${modeOptions}</select>
          <datalist id="models-${escapeHtml(task.id)}">${modelOptions}</datalist>
        </div>
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
      taskRouting[taskId] = {
        providerId: sel.value,
        model,
        mode: provider ? modeForModel(provider, model, "") : ""
      };
      renderTaskRouting();
    });
  }
  for (const inp of el.querySelectorAll("[data-routing-model]")) {
    inp.addEventListener("input", () => {
      const taskId = inp.dataset.routingModel;
      taskRouting[taskId] = { ...(taskRouting[taskId] ?? {}), model: inp.value };
    });
    inp.addEventListener("change", () => {
      const taskId = inp.dataset.routingModel;
      const route = taskRouting[taskId] ?? {};
      const provider = customProviders.find((p) => p.id === route.providerId);
      taskRouting[taskId] = {
        ...route,
        model: inp.value,
        mode: modeForModel(provider, inp.value, "")
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
  officeAddinSetupState.textContent = `${readyText} · ${status.shareUrl ?? "\\\\localhost\\UCAOfficeAddins"} · share: ${status.shareExists ? "yes" : "no"} · trusted: ${status.registryTrusted ? "yes" : "no"} · ${adminText}${manifestSummary ? ` · ${manifestSummary}` : ""}`;
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
        elevate: true
      })
    });
    renderOfficeAddinSetupStatus(status);
  } catch (error) {
    officeAddinSetupState.textContent = `Configure failed: ${error.message}`;
  } finally {
    setupOfficeAddinsButton.disabled = false;
  }
}

function renderTasks() {
  const tasks = state.workspace.tasks ?? [];
  taskCount.textContent = `${tasks.length}`;
  if (tasks.length === 0) {
    renderEmpty(taskList, "No tasks yet.");
    state.selectedTaskId = null;
    renderTaskDetail(null);
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
    <span>Parent:
      <button class="ghost" data-parent-task-id="${escapeHtml(task.parent_task_id)}" style="padding:0 6px;font-size:11px;">${escapeHtml(task.parent_task_id)}</button>
    </span>
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
  `;
  for (const btn of taskDetailSummary.querySelectorAll("[data-parent-task-id]")) {
    btn.addEventListener("click", () => {
      state.selectedTaskId = btn.dataset.parentTaskId;
      renderTasks();
      void refreshTaskDetail();
    });
  }
  taskTimeline.innerHTML = (detail.events ?? []).length > 0
    ? detail.events.map((ev) => {
      const s = formatTaskEventSummary(ev);
      return `
        <div class="timeline-item">
          <div class="row"><strong style="font-size:12px;">${escapeHtml(s.title)}</strong><span class="muted" style="font-size:11px;">${escapeHtml(formatDateTime(ev.ts ?? ev.at))}</span></div>
          <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(s.body)}</p>
        </div>
      `;
    }).join("")
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
  taskDetailSummary.innerHTML = `<p class="muted" style="font-size:12px;">Loading...</p>`;
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

  approvalList.innerHTML = approvals.map((a) => `
    <div class="approval-item">
      <div class="row">
        <div>
          <h4>${escapeHtml(a.proposed_target ?? a.proposed_action ?? "Pending action")}</h4>
          <p class="muted">${escapeHtml(a.source_type ?? "unknown")} · ${escapeHtml(a.status)}</p>
        </div>
        <span class="chip ${a.status === "approved" ? "ready" : a.status === "rejected" ? "danger" : "warning"}">${escapeHtml(a.status)}</span>
      </div>
      <p class="muted" style="margin-top:6px;">${escapeHtml(a.preview_text ?? "No preview")}</p>
      <div class="row wrap" style="margin-top:8px;">
        <span class="muted" style="font-size:11px;">Expires: ${escapeHtml(formatDateTime(a.expires_at))}</span>
        <div class="toolbar">
          <button class="secondary" data-approve-id="${escapeHtml(a.approval_id)}" ${a.status !== "pending" ? "disabled" : ""}>Approve</button>
          <button class="ghost" data-reject-id="${escapeHtml(a.approval_id)}" ${a.status !== "pending" ? "disabled" : ""}>Reject</button>
        </div>
      </div>
    </div>
  `).join("");

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
}

function renderSchedules() {
  const schedules = state.workspace.schedules ?? [];
  scheduleCount.textContent = `${schedules.length}`;
  if (schedules.length === 0) {
    renderEmpty(scheduleList, "No scheduled tasks.");
    return;
  }

  scheduleList.innerHTML = schedules.map((s) => `
    <div class="schedule-item">
      <div class="row">
        <div>
          <h4>${escapeHtml(s.name ?? s.schedule_id)}</h4>
          <p class="muted">${escapeHtml(s.trigger_type ?? "manual")} · ${escapeHtml(s.execution_mode ?? "interactive")}</p>
        </div>
        <span class="chip ${s.enabled ? "ready" : "warning"}">${s.enabled ? "enabled" : "paused"}</span>
      </div>
      <div class="row wrap" style="margin-top:6px;">
        <span class="muted" style="font-size:11px;">Next: ${escapeHtml(formatDateTime(s.next_run_at))}</span>
        <span class="muted" style="font-size:11px;">Last: ${escapeHtml(s.last_run_status ?? "never")}</span>
        <button class="secondary" data-run-schedule-id="${escapeHtml(s.schedule_id)}">Run Now</button>
        <button class="ghost" data-toggle-schedule-id="${escapeHtml(s.schedule_id)}" data-enabled="${s.enabled ? "false" : "true"}">${s.enabled ? "Pause" : "Resume"}</button>
        <button class="ghost" data-delete-schedule-id="${escapeHtml(s.schedule_id)}">Delete</button>
      </div>
    </div>
  `).join("");

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

  historyList.innerHTML = results.map((r) => `
    <button class="history-item" data-history-summary="${escapeHtml(r.metadata?.summary ?? r.text ?? "")}" data-history-task-id="${escapeHtml(r.id ?? "")}" style="text-align:left;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(r.metadata?.summary ?? r.id)}</strong>
        <span class="muted" style="font-size:11px;">${escapeHtml(Number(r.score ?? 0).toFixed(4))}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(r.metadata?.created_at ?? "")}</p>
    </button>
  `).join("");

  for (const btn of historyList.querySelectorAll("[data-history-summary]")) {
    btn.addEventListener("click", () => {
      historyPreview.textContent = btn.dataset.historySummary || "No summary";
      const taskId = btn.dataset.historyTaskId;
      if (taskId && state.workspace.tasks.some((t) => t.task_id === taskId)) {
        state.selectedTaskId = taskId;
        switchTab("tasks");
        renderTasks();
        void refreshTaskDetail();
      }
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
    renderPrivacy();
    renderAudit();
    renderMcpServers();
    renderSkillRegistries();
    renderCodeCliAdapters();
    renderEmailAccounts();
    renderEmailDigestSettings();
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

refreshButton.addEventListener("click", () => void refreshWorkspace());
openOverlayButton.addEventListener("click", async () => await window.ucaShell.showWindow("overlay"));

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
