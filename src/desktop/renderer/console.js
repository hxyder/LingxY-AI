import {
  formatTaskEventSummary,
  sanitizeAssistantVisibleText,
  looksLikeInternalAssistantText,
  subscribeTaskEvents,
  toTaskEventFrame
} from "./task-event-stream.js";
import {
  createRuntimeHttpClient
} from "./shared/runtime-http-client.mjs";
import {
  createRuntimeTaskClient
} from "./shared/runtime-task-client.mjs";
import {
  createRuntimeSubmissionClient,
  runtimeJsonOptions
} from "./shared/runtime-submission-client.mjs";
import {
  createRuntimeUserMemoryClient
} from "./shared/runtime-user-memory-client.mjs";
import {
  createRuntimePreflightClient
} from "./shared/runtime-preflight-client.mjs";
import {
  createRendererShellClient
} from "./shared/shell-client.mjs";
import {
  createConsoleConnectorsClient
} from "./console/console-connectors-client.mjs";
import {
  createConsoleNotesRuntimeClient
} from "./console/console-notes-runtime-client.mjs";
import {
  createConsoleSkillsClient
} from "./console/console-skills-client.mjs";
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
  fetchConversationDetail as cacheFetchConversationDetail,
  searchConversations as cacheSearchConversations
} from "./conversation-cache.mjs";
import {
  artifactExtension,
  artifactIconClass,
  artifactIconText,
  artifactStatusInfo,
  createBottomPinController,
  escapeHtml,
  formatArtifactLabel as formatSharedArtifactLabel,
  formatDateTime as formatSharedDateTime,
  formatRelativeTime
} from "./shared-ui.mjs";
import {
  createConsoleContextMenuController,
  createConsoleToastController,
  installConsoleChatContextMenu
} from "./console-floating-ui.mjs";
import {
  createConsoleChatAttachmentsController
} from "./console-chat-attachments.mjs";
import {
  renderChatMessageBlocks
} from "./chat-blocks.mjs";
import {
  MCP_LOGO_SVG,
  MCP_SERVER_META,
  renderConnectorsMcpServersHtml
} from "./console-mcp-view.mjs";
import {
  renderSkillManagementHtml
} from "./console-skills-view.mjs";
import {
  ACCOUNT_CONNECTOR_META,
  countAvailableAccountConnectors,
  renderAccountConnectorSectionLabelHtml,
  renderAvailableAccountConnectorHtml,
  renderConnectedAccountConnectorRowHtml
} from "./console-account-connectors-view.mjs";
import {
  renderInboxAccountsHtml,
  renderInboxContentHtml
} from "./console-inbox-view.mjs";
import {
  buildCapabilityChecklist,
  capabilityChecklistSummary
} from "./capability-checklist.mjs";
import {
  buildModelPickerProviderItems,
  configuredModelPickerProviders,
  isModelPickerProviderConfigured
} from "./model-picker-view-model.mjs";
import {
  renderChatSidebarListHtml
} from "./console-chat-sidebar.mjs";
import {
  renderConversationDetailView,
  renderConversationsListHtml
} from "./console-conversation-viewer.mjs";
import {
  normalizeAttachmentSubmission
} from "../../shared/context-resolver.mjs";
import {
  buildConversationMessageContextSummary,
  conversationContextChips,
  conversationContextPreviewText,
  getConversationContextSummary
} from "../../shared/conversation-message-context.mjs";
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
  extractContentEvidenceFromTaskDetail,
  extractEvidenceSummaryFromMessage,
  extractEvidenceSummaryFromTaskDetail,
  renderContentEvidenceHtml,
  renderEvidenceSourcesHtml,
  renderToolCallSourcesHtml,
  revealEvidenceSource,
  wireEvidenceSourceActions
} from "./evidence-sources-view.mjs";
import {
  compactToolText as compactText,
  formatToolArgsPreview as formatConsoleToolArgsPreview,
  formatToolDisplayName as formatConsoleToolDisplayName
} from "./tool-display.mjs";
import {
  buildCapabilityToolView,
  renderCapabilityToolViewHtml
} from "./capability-tool-view.mjs";
import {
  renderTaskKvGrid,
  describeTaskMode,
  describeTaskTokens,
  renderLlmUsagePanel,
  renderTaskTracePanel,
  renderSubAgentTimelinePanel,
  renderFileReversibilityPanel,
  renderContextDebugPanel
} from "./console-task-detail.mjs";
import {
  createConsoleTaskEventController
} from "./console-task-event-stream.mjs";
import {
  groupSchedules,
  renderScheduleRow,
  scheduleRecipients,
  uniqueScheduleEmails
} from "./console-schedules-view.mjs";
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
  renderProjectArtifactListHtml,
  renderProjectConversationListHtml,
  renderProjectListHtml,
  renderProjectWorkspaceSummaryHtml
} from "./console-projects-view.mjs";
import {
  createFileContentIndexPanel
} from "./console-file-content-index-panel.mjs";
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
import {
  getScheduleOccurrencesForRange,
  localDateKey
} from "../../shared/schedule-occurrences.mjs";
import {
  currentLingxyLocale,
  installLingxyI18nControls
} from "./i18n-dom.mjs";

const PROJECT_STORE_KEY = "uca.overlay.projects.v3";
const PROJECT_COLORS = ["#6366f1", "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6"];
const workspaceRenderSignatures = new Map();
const consoleShellClient = createRendererShellClient();
installLingxyI18nControls({ select: document.querySelector("#appLanguageSelect") });

function withConsoleLocaleMetadata(payload = {}) {
  const locale = currentLingxyLocale();
  return {
    ...payload,
    selectionMetadata: {
      ...(payload.selectionMetadata ?? {}),
      ui_locale: locale,
      preferred_locale: locale,
      response_locale: locale
    }
  };
}

async function writeConsoleClipboardText(text) {
  const value = String(text ?? "");
  if (typeof consoleShellClient?.writeClipboardText === "function") {
    await consoleShellClient.writeClipboardText(value);
    return true;
  }
  if (typeof navigator?.clipboard?.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

function showCopyButtonResult(button, ok) {
  if (!button) return;
  button.textContent = ok ? "已复制" : "复制失败";
  setTimeout(() => { button.textContent = "复制"; }, 1200);
}

const runtimeState = document.querySelector("#runtimeState");
const summaryGrid = document.querySelector("#summaryGrid");
const integrationList = document.querySelector("#integrationList");
const refreshButton = document.querySelector("#refreshButton");
const consoleUpdateButton = document.querySelector("#consoleUpdateButton");
const consoleUpdateDot = document.querySelector("#consoleUpdateDot");
const openOverlayButton = document.querySelector("#openOverlayButton");
const locationButton = document.querySelector("#locationButton");
const onboardingState = document.querySelector("#onboardingState");
const wizardList = document.querySelector("#wizardList");
const userMemoryEnabled = document.querySelector("#userMemoryEnabled");
const userMemoryAutoApprove = document.querySelector("#userMemoryAutoApprove");
const userMemoryPreferences = document.querySelector("#userMemoryPreferences");
const userMemoryProjectNotes = document.querySelector("#userMemoryProjectNotes");
const userMemoryScopeFilter = document.querySelector("#userMemoryScopeFilter");
const userMemoryProjectFilter = document.querySelector("#userMemoryProjectFilter");
const userMemoryConversationFilter = document.querySelector("#userMemoryConversationFilter");
const userMemorySaveBtn = document.querySelector("#userMemorySaveBtn");
const userMemoryState = document.querySelector("#userMemoryState");
const settingsSearchInput = document.querySelector("#settingsSearchInput");
const userMemoryEnabledPill = document.querySelector("#userMemoryEnabledPill");
const userMemorySwitchHint = document.querySelector("#userMemorySwitchHint");
const userMemoryApprovedState = document.querySelector("#userMemoryApprovedState");
const userMemoryApprovedList = document.querySelector("#userMemoryApprovedList");
const userMemoryProposalState = document.querySelector("#userMemoryProposalState");
const userMemoryProposalList = document.querySelector("#userMemoryProposalList");
const userMemoryActivityState = document.querySelector("#userMemoryActivityState");
const userMemoryActivityList = document.querySelector("#userMemoryActivityList");
const userMemoryReviewState = document.querySelector("#userMemoryReviewState");
const userMemoryReviewList = document.querySelector("#userMemoryReviewList");
const taskComposer = document.querySelector("#taskComposer");
const commandInput = document.querySelector("#commandInput");
const submitState = document.querySelector("#submitState");
const taskCount = document.querySelector("#taskCount");
const taskList = document.querySelector("#taskList");
const taskDetailSummary = document.querySelector("#taskDetailSummary");
const taskChildCount = document.querySelector("#taskChildCount");
const taskChildList = document.querySelector("#taskChildList");
const taskTimeline = document.querySelector("#taskTimeline");
const taskContextDebugPanel = document.querySelector("#taskContextDebugPanel");
const taskContextDebugBody = document.querySelector("#taskContextDebugBody");
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
const projectArtifactCount = document.querySelector("#projectArtifactCount");
const projectArtifactList = document.querySelector("#projectArtifactList");
const projectAttachFilesBtn = document.querySelector("#projectAttachFilesBtn");
const projectConversationPreview = document.querySelector("#projectConversationPreview");
const projectWorkspaceSummary = document.querySelector("#projectWorkspaceSummary");
const projectOpenChatBtn = document.querySelector("#projectOpenChatBtn");
const projectStartChatBtn = document.querySelector("#projectStartChatBtn");
const projectRefreshBtn = document.querySelector("#projectRefreshBtn");
const projectInstructionsForm = document.querySelector("#projectInstructionsForm");
const projectInstructionsInput = document.querySelector("#projectInstructionsInput");
const projectInstructionsState = document.querySelector("#projectInstructionsState");
const projectCreateForm = document.querySelector("#projectCreateForm");
const projectNameInput = document.querySelector("#projectNameInput");
const projectState = document.querySelector("#projectState");
const privacyState = document.querySelector("#privacyState");
const killSwitchToggle = document.querySelector("#killSwitchToggle");
const offlineModeToggle = document.querySelector("#offlineModeToggle");
const presenterModeToggle = document.querySelector("#presenterModeToggle");
const redactionRuleList = document.querySelector("#redactionRuleList");
const retentionList = document.querySelector("#retentionList");
const exportBundleBtn = document.querySelector("#exportBundleBtn");
const exportBundleState = document.querySelector("#exportBundleState");
const diagnosticBundleBtn = document.querySelector("#diagnosticBundleBtn");
const diagnosticBundleState = document.querySelector("#diagnosticBundleState");
const trashRefreshBtn = document.querySelector("#trashRefreshBtn");
const trashState = document.querySelector("#trashState");
const trashList = document.querySelector("#trashList");
const auditCount = document.querySelector("#auditCount");
const auditList = document.querySelector("#auditList");
const officeAddinSetupState = document.querySelector("#officeAddinSetupState");
const checkOfficeAddinsButton = document.querySelector("#checkOfficeAddinsButton");
const setupOfficeAddinsButton = document.querySelector("#setupOfficeAddinsButton");
const echoWakeDisplayName = document.querySelector("#echoWakeDisplayName");
const echoWakePhrases = document.querySelector("#echoWakePhrases");
const echoWakeIncludeDefault = document.querySelector("#echoWakeIncludeDefault");
const echoWakeSaveBtn = document.querySelector("#echoWakeSaveBtn");
const echoWakeState = document.querySelector("#echoWakeState");
const echoDiagnosticsRefreshBtn = document.querySelector("#echoDiagnosticsRefreshBtn");
const echoEnrollmentStartBtn = document.querySelector("#echoEnrollmentStartBtn");
const echoDiagnosticsPanel = document.querySelector("#echoDiagnosticsPanel");
const mcpServerCount = document.querySelector("#mcpServerCount");
const mcpServerForm = document.querySelector("#mcpServerForm");
const mcpServerId = document.querySelector("#mcpServerId");
const mcpServerName = document.querySelector("#mcpServerName");
const mcpTransport = document.querySelector("#mcpTransport");
const mcpCommand = document.querySelector("#mcpCommand");
const mcpArgs = document.querySelector("#mcpArgs");
const mcpServerState = document.querySelector("#mcpServerState");
const mcpServerList = document.querySelector("#mcpServerList");
const mcpDraftList = document.querySelector("#mcpDraftList");
const mcpServerRefreshBtn = document.querySelector("#mcpServerRefreshBtn");
const mcpServerTestBtn = document.querySelector("#mcpServerTestBtn");
const marketplaceCapabilityCount = document.querySelector("#marketplaceCapabilityCount");
const marketplaceRefreshBtn = document.querySelector("#marketplaceRefreshBtn");
const marketplaceState = document.querySelector("#marketplaceState");
const marketplaceCapabilityList = document.querySelector("#marketplaceCapabilityList");
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
const mcpRegistrySearchInput = document.querySelector("#mcpRegistrySearchInput");
const mcpRegistrySearchBtn = document.querySelector("#mcpRegistrySearchBtn");
const mcpRegistrySearchState = document.querySelector("#mcpRegistrySearchState");
const mcpRegistrySearchResults = document.querySelector("#mcpRegistrySearchResults");
const skillRegistryCount = document.querySelector("#skillRegistryCount");
const skillRegistryForm = document.querySelector("#skillRegistryForm");
const skillRegistryId = document.querySelector("#skillRegistryId");
const skillRegistryName = document.querySelector("#skillRegistryName");
const skillRegistryPath = document.querySelector("#skillRegistryPath");
const skillRegistryState = document.querySelector("#skillRegistryState");
const skillRegistryList = document.querySelector("#skillRegistryList");
const skillRegistryRefreshBtn = document.querySelector("#skillRegistryRefreshBtn");
const skillRegistryTestBtn = document.querySelector("#skillRegistryTestBtn");
const skillCreateBtn = document.querySelector("#skillCreateBtn");
const skillGitHubInstallUrl = document.querySelector("#skillGitHubInstallUrl");
const skillGitHubInstallBtn = document.querySelector("#skillGitHubInstallBtn");
const skillGitHubInstallState = document.querySelector("#skillGitHubInstallState");
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
const consoleChatArtifacts = document.querySelector("#consoleChatArtifacts");
const consoleChatFilesBtn = document.querySelector("#consoleChatFilesBtn");
const consoleChatScrollDownBtn = document.querySelector("#consoleChatScrollDown");
const consoleChatState = document.querySelector("#consoleChatState");
const consoleChatAttachBtn = document.querySelector("#consoleChatAttachBtn");
const consoleChatVoiceBtn = document.querySelector("#consoleChatVoiceBtn");
const consoleChatModelChip = document.querySelector("#consoleChatModelChip");
const consoleChatModelChipLabel = document.querySelector("#consoleChatModelChipLabel");
const consoleChatAttachInput = document.querySelector("#consoleChatAttachInput");
const consoleChatAttachments = document.querySelector("#consoleChatAttachments");
const skillEditModal = document.querySelector("#skillEditModal");
const skillEditText = document.querySelector("#skillEditText");
const skillEditPath = document.querySelector("#skillEditPath");
const skillEditState = document.querySelector("#skillEditState");
const skillEditValidation = document.querySelector("#skillEditValidation");
const skillEditSaveBtn = document.querySelector("#skillEditSaveBtn");
const skillEditCloseBtn = document.querySelector("#skillEditCloseBtn");
const skillEditOpenBtn = document.querySelector("#skillEditOpenBtn");
const skillEditRevealBtn = document.querySelector("#skillEditRevealBtn");
const skillEditRollbackBtn = document.querySelector("#skillEditRollbackBtn");
const skillEditTestBtn = document.querySelector("#skillEditTestBtn");
const skillEditHistorySelect = document.querySelector("#skillEditHistorySelect");

const consoleChatPin = createBottomPinController(consoleChatMessages, {
  button: consoleChatScrollDownBtn
});

/* ═══════════════════════════════════════════════
   TOAST + CONTEXT MENU (shared)
   ═══════════════════════════════════════════════ */

const consoleToastHost = document.querySelector("#consoleToastHost");
const { showToast: showConsoleToast } = createConsoleToastController({ host: consoleToastHost });

// Singleton context-menu element. Each surface (chat panel, etc.)
// installs its own contextmenu listener that calls openCtxMenu with a
// list of items + the click coordinates.
const chatCtxMenu = document.querySelector("#chatCtxMenu");
const { closeMenu: closeCtxMenu, openMenu: openCtxMenu } = createConsoleContextMenuController({
  menu: chatCtxMenu,
  escapeHtml,
  showToast: showConsoleToast
});

// Wire chat-bubble contextmenu — one delegated listener on the chat
// messages container so it covers existing + future bubbles.
installConsoleChatContextMenu({
  messagesEl: consoleChatMessages,
  inputEl: consoleChatInput,
  openMenu: openCtxMenu,
  showToast: showConsoleToast,
  openNoteTargetPicker,
  regenerateTask: regenerateConsoleChatTask
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

function renderEchoWakeSettings(settings = {}) {
  const profile = settings?.echoWake && typeof settings.echoWake === "object"
    ? settings.echoWake
    : {};
  if (echoWakeDisplayName) echoWakeDisplayName.value = profile.displayName || "linxi";
  if (echoWakePhrases) {
    echoWakePhrases.value = Array.isArray(profile.phrases) ? profile.phrases.join("\n") : "";
  }
  if (echoWakeIncludeDefault) echoWakeIncludeDefault.checked = profile.includeDefault !== false;
}

let echoDiagnosticsLastLoadedAt = 0;
let echoDiagnosticsInFlight = null;

function renderEchoDiagnostics(payload = null) {
  if (!echoDiagnosticsPanel) return;
  if (!payload) {
    echoDiagnosticsPanel.innerHTML = `
      <div class="voice-status-card">
        <strong>Voice status</strong>
        <div class="value">Not checked</div>
        <div class="hint">Open this panel or refresh to inspect Echo without slowing live wake detection.</div>
      </div>
    `;
    return;
  }
  const kws = payload.kws ?? {};
  const enrollment = payload.enrollment ?? {};
  const transcription = payload.transcription ?? {};
  const profile = payload.echoWake ?? {};
  const kwsOk = Boolean(kws.ok);
  const enrollmentEnabled = Boolean(enrollment.enabled);
  const sampleCount = Number(enrollment.sampleCount ?? 0);
  const requiredSamples = Number(enrollment.requiredSamples ?? 3);
  const usableSampleCount = Number(enrollment.usableSampleCount ?? sampleCount);
  const matchedCount = Number(enrollment.matchedCount ?? 0);
  const requiredMatches = Number(enrollment.requiredMatches ?? 2);
  const selfCheckPassed = Boolean(enrollment.selfCheckPassed ?? matchedCount >= requiredMatches);
  const customPhrases = Array.isArray(profile.phrases) ? profile.phrases.length : 0;
  const profileLabel = profile.displayName || "linxi";
  const enrollmentValue = enrollmentEnabled
    ? (selfCheckPassed ? "Enabled" : "Fallback enabled")
    : sampleCount > 0 ? "Needs samples" : "Not recorded";
  const sampleHint = enrollment.ok === false
    ? (enrollment.message || enrollment.reason || "Enrollment status unavailable.")
    : enrollmentEnabled
      ? selfCheckPassed
        ? `${usableSampleCount}/${requiredSamples} usable samples. Sherpa self-check ${matchedCount}/${requiredMatches}.`
        : `${usableSampleCount}/${requiredSamples} usable samples. Sherpa self-check ${matchedCount}/${requiredMatches}; personal template fallback remains active.`
      : `${sampleCount}/${requiredSamples} samples, ${matchedCount}/${requiredMatches} KWS matches.`;
  const transcriptionProvider = transcription.provider?.name
    || transcription.provider?.id
    || (transcription.localFallback?.available ? "Local fallback" : "Not configured");
  const transcriptionHint = transcription.ok
    ? `${transcriptionProvider}${transcription.model ? ` · ${transcription.model}` : ""}`
    : transcription.localFallback?.available
      ? `Cloud STT not configured; local ${transcription.localFallback.model || "whisper"} on ${transcription.localFallback.device || "cpu"} is available.`
      : (transcription.message || transcription.reason || "No speech-to-text provider configured.");
  echoDiagnosticsPanel.innerHTML = `
    <div class="voice-status-card">
      <strong>Echo mode</strong>
      <div class="value">${payload.echoMode ? "On" : "Off"}</div>
      <div class="hint">Wake profile: ${escapeHtml(profileLabel)} · ${customPhrases} custom phrase${customPhrases === 1 ? "" : "s"}</div>
    </div>
    <div class="voice-status-card">
      <strong>Wake engine</strong>
      <div class="value">${kwsOk ? "Local KWS ready" : "Needs setup"}</div>
      <div class="hint">${escapeHtml(kwsOk ? (kws.model || kws.engine || "sherpa-onnx") : (kws.message || kws.reason || "Local KWS status unavailable."))}</div>
    </div>
    <div class="voice-status-card">
      <strong>Personal samples</strong>
      <div class="value">${enrollmentValue}</div>
      <div class="hint">${escapeHtml(sampleHint)}</div>
    </div>
    <div class="voice-status-card">
      <strong>Transcription</strong>
      <div class="value">${transcription.ok ? "Cloud STT" : transcription.localFallback?.available ? "Local fallback" : "Not configured"}</div>
      <div class="hint">${escapeHtml(transcriptionHint)}</div>
    </div>
  `;
}

async function loadEchoDiagnostics({ force = false } = {}) {
  if (!echoDiagnosticsPanel || typeof consoleShellClient?.getEchoDiagnostics !== "function") return null;
  const now = Date.now();
  if (!force && echoDiagnosticsInFlight) return echoDiagnosticsInFlight;
  if (!force && echoDiagnosticsLastLoadedAt && now - echoDiagnosticsLastLoadedAt < 30_000) return null;
  if (force && echoWakeState) echoWakeState.textContent = "Checking voice status...";
  echoDiagnosticsInFlight = consoleShellClient.getEchoDiagnostics()
    .then((payload) => {
      echoDiagnosticsLastLoadedAt = Date.now();
      renderEchoDiagnostics(payload);
      if (force && echoWakeState) echoWakeState.textContent = "";
      return payload;
    })
    .catch((error) => {
      renderEchoDiagnostics({
        ok: false,
        echoMode: false,
        echoWake: {},
        kws: { ok: false, reason: "diagnostics_failed", message: error?.message ?? String(error) },
        enrollment: { ok: false, reason: "diagnostics_failed", message: error?.message ?? String(error) },
        transcription: { ok: false, reason: "diagnostics_failed", message: error?.message ?? String(error) }
      });
      if (force && echoWakeState) echoWakeState.textContent = `Voice status failed: ${error?.message ?? error}`;
      return null;
    })
    .finally(() => {
      echoDiagnosticsInFlight = null;
    });
  return echoDiagnosticsInFlight;
}

async function loadEchoWakeSettings() {
  if (typeof consoleShellClient?.getSettings !== "function") return;
  try {
    renderEchoWakeSettings(await consoleShellClient.getSettings());
    void loadEchoDiagnostics();
  } catch {
    // Non-fatal: settings can still be loaded on the next broadcast.
  }
}

consoleShellClient?.onSettingsChanged?.((settings) => {
  renderEchoWakeSettings(settings ?? {});
  echoDiagnosticsLastLoadedAt = 0;
  void loadEchoDiagnostics();
});
void loadEchoWakeSettings();
renderEchoDiagnostics();

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
      savedView = "chat";
      localStorage.setItem("lingxy.view", "chat");
    }
    if (savedView === "files") {
      savedView = "chat";
      localStorage.setItem("lingxy.view", "chat");
    }
    if (savedView === "projects") {
      savedView = "chat";
      localStorage.setItem("lingxy.view", "chat");
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
  tasks: "Tasks", chat: "Chat", files: "Chat", schedules: "Schedules",
  projects: "Projects", notes: "Notes",
  connectors: "Connectors", inbox: "Inbox",
  settings: "Settings"
};

function switchTab(tabId) {
  // UCA-126: reroute retired "advanced" to settings so stale localStorage
  // or deep links don't land on an empty panel.
  if (tabId === "advanced") tabId = "settings";
  if (tabId === "files") tabId = "chat";
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
  try { localStorage.setItem("lingxy.view", tabId === "projects" ? "chat" : tabId); } catch { /* sandbox: ignore */ }
  // Background polling only refreshes the visible workspace slice. When the
  // user switches tabs, render that slice from the latest cached state without
  // waiting for the next network poll.
  void renderWorkspaceAfterFetch({ mode: "active", activeTabId: tabId });
  if (tabId === "tasks") void refreshWorkspace({ mode: "active" });
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === "files") {
      void loadAllArtifacts();
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
// default to system blue + roomy; power users can still flip them via
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
if (consoleShellClient?.onNavigateConsole) {
  consoleShellClient.onNavigateConsole((payload = {}) => {
    const tabId = typeof payload.tabId === "string" ? payload.tabId : "settings";
    if (tabId === "projects") {
      switchTab("chat");
      renderChatSidebarProjectFilter();
      void syncConsoleProjectStoreFromService({ rerender: false });
      void refreshChatSidebar({ force: true });
      requestAnimationFrame(() => document.querySelector("#chatSidebarScopeSelect")?.focus?.());
      return;
    }
    switchTab(tabId);
    if (tabId === "connectors") {
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
    plugins: [],
    onboarding: { pendingSuggestions: [], archivedSuggestions: [] },
    providerSetup: null,
    modelRoles: null,
    runtimeLabs: null,
    userMemory: null,
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
  contextDebugSelectedLimit: 12,
  contextDebugOmittedLimit: 8,
  selectedTaskArtifactPath: null,
  templatePreviewLoadKey: null,
  selectedProjectId: null,
  selectedProjectConversationId: null,
  projectStore: null,
  projectStoreRemoteReady: false,
  projectStoreSyncing: false
};

const consoleRuntimeHttpClient = createRuntimeHttpClient({
  getBaseUrl: () => state.serviceBaseUrl
});
const consoleTaskClient = createRuntimeTaskClient({
  httpClient: consoleRuntimeHttpClient
});
const consoleSubmissionClient = createRuntimeSubmissionClient({
  httpClient: consoleRuntimeHttpClient,
  actor: "desktop_console"
});
const consoleUserMemoryClient = createRuntimeUserMemoryClient({
  httpClient: consoleRuntimeHttpClient,
  actor: "desktop_console"
});
const consolePreflightClient = createRuntimePreflightClient({
  httpClient: consoleRuntimeHttpClient,
  actor: "desktop_console"
});
const consoleConnectorsClient = createConsoleConnectorsClient({
  httpClient: consoleRuntimeHttpClient
});
const consoleSkillsClient = createConsoleSkillsClient({
  httpClient: consoleRuntimeHttpClient
});

let consoleChatEventStream = null;
const consoleChatTaskStreams = new Map();
const consoleChatTaskConversationIds = new Map();
const consoleChatActiveTaskByConversationId = new Map();
let consoleChatResultTaskIds = new Set();
const consoleChatContentEvidenceTaskIds = new Set();
const fileContentIndexPanel = createFileContentIndexPanel({
  getServiceBaseUrl: () => state.serviceBaseUrl,
  getProjects: () => (state.projectStore ?? loadConsoleProjectStore()).projects ?? [],
  getSelectedProjectId: () => state.selectedProjectId ?? null,
  onProjectStoreUpdate: (mutator) => {
    const current = state.projectStore ?? loadConsoleProjectStore();
    const next = typeof mutator === "function" ? mutator(current) : current;
    saveConsoleProjectStore(next);
    renderProjectsWorkspace({ skipFetch: true });
    return next;
  },
  toast: showConsoleToast
});
// Track the in-flight chat task so the composer can flip the Send
// button to a Stop button while events stream. Cleared on terminal
// events (success / failed / cancelled / partial_success).
let consoleChatActiveTaskId = null;
let consoleChatCancellationRequestedTaskId = null;
const consoleChatSendBtn = document.querySelector("#consoleChatSendBtn");

function currentConsoleConversationId() {
  return consoleActiveConversation?.conversation_id ?? null;
}

function rememberConsoleChatTaskOwner(taskId, conversationId = currentConsoleConversationId()) {
  if (!taskId || !conversationId) return;
  consoleChatTaskConversationIds.set(taskId, conversationId);
  consoleChatActiveTaskByConversationId.set(conversationId, taskId);
}

function consoleTaskOwnerConversationId(taskId) {
  if (!taskId) return null;
  if (consoleChatTaskConversationIds.has(taskId)) {
    return consoleChatTaskConversationIds.get(taskId);
  }
  const task = state.workspace?.tasks?.find?.((item) => item?.task_id === taskId);
  const owner = task?.conversation_id ?? task?.context_packet?.selection_metadata?.conversation_id ?? null;
  if (owner) consoleChatTaskConversationIds.set(taskId, owner);
  return owner;
}

function consoleChatTaskBelongsToActiveConversation(taskId) {
  const owner = consoleTaskOwnerConversationId(taskId);
  const active = currentConsoleConversationId();
  return Boolean(active && owner && owner === active);
}

function closeConsoleChatTaskStream(taskId) {
  if (!taskId) return;
  const stream = consoleChatTaskStreams.get(taskId);
  try { stream?.close?.(); } catch { /* ignore */ }
  try { stream?.dispose?.(); } catch { /* ignore */ }
  if (typeof stream === "function") {
    try { stream(); } catch { /* ignore */ }
  }
  consoleChatTaskStreams.delete(taskId);
  if (consoleChatActiveTaskId === taskId) consoleChatEventStream = null;
}

function markConsoleChatTaskTerminal(taskId) {
  const owner = consoleTaskOwnerConversationId(taskId);
  if (owner && consoleChatActiveTaskByConversationId.get(owner) === taskId) {
    consoleChatActiveTaskByConversationId.delete(owner);
  }
  if (consoleChatActiveTaskId === taskId) {
    consoleChatActiveTaskId = null;
    consoleChatCancellationRequestedTaskId = null;
    consoleChatEventStream = null;
    refreshConsoleChatSendBtnMode();
  }
  closeConsoleChatTaskStream(taskId);
}

function findActiveConsoleChatTaskForConversation(conversationId) {
  if (!conversationId) return null;
  const remembered = consoleChatActiveTaskByConversationId.get(conversationId);
  if (remembered) return remembered;
  const tasks = Array.isArray(state.workspace?.tasks) ? state.workspace.tasks : [];
  const activeStatuses = new Set(["queued", "running", "starting", "cancelling"]);
  const found = [...tasks]
    .filter((task) => task?.task_id && activeStatuses.has(task.status))
    .filter((task) => (task.conversation_id ?? task.context_packet?.selection_metadata?.conversation_id ?? null) === conversationId)
    .sort((left, right) => `${right.updated_at ?? right.created_at ?? ""}`.localeCompare(`${left.updated_at ?? left.created_at ?? ""}`))[0];
  if (found?.task_id) {
    rememberConsoleChatTaskOwner(found.task_id, conversationId);
    return found.task_id;
  }
  return null;
}

function syncConsoleChatActiveTaskForConversation(conversationId = currentConsoleConversationId()) {
  const taskId = findActiveConsoleChatTaskForConversation(conversationId);
  consoleChatActiveTaskId = taskId ?? null;
  consoleChatCancellationRequestedTaskId = null;
  if (taskId) {
    subscribeConsoleChatTask(taskId, { conversationId });
    if (consoleChatState) consoleChatState.textContent = `Running ${taskId}`;
  } else if (consoleChatState) {
    consoleChatState.textContent = "";
  }
  refreshConsoleChatSendBtnMode();
}

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
let consoleChatProgressCard = null;
let consoleChatProgressLines = [];
let consoleChatStreamingAnswer = null;
let consoleChatProgressEventIds = new Set();
let consoleChatLiveProgressLastAt = new Map();
let consoleChatEvidenceByTaskId = new Map();
let consoleChatSuppressedTextByTaskId = new Map();
// G: console chat resume state. The chat composer threads this
// conversation_id on every submit, so back-and-forth in the same
// conversation hangs together server-side. New chat clears it.
let consoleActiveConversation = null;
let consoleChatArtifactsConversationId = null;
let consoleChatArtifactItems = { artifacts: [], user_files: [] };
const consoleConversationUsageById = new Map();
let consoleConversationLoadSeq = 0;
let chatSidebarLoadingConversationId = null;

const CONSOLE_CHAT_PROGRESS_EVENT_TYPES = new Set([
  "accepted",
  "started",
  "status_changed",
  "step_started",
  "step_finished",
  "log",
  "phase_timing",
  "file_expand_started",
  "file_expand_finished",
  "file_ingest_started",
  "file_ingest_progress",
  "file_ingest_finished",
  "file_read_started",
  "file_read_progress",
  "file_read_finished",
  "cancel_requested",
  "answer_quality_blocked"
]);
const scheduleRunTaskWatchers = new Map();
const completedScheduleRunTaskIds = new Set();
const surfacedApprovalPopupIds = new Set();
const surfacingApprovalPopupIds = new Set();
let editingSkillPath = null;

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */

function normalizeExternalUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function renderConsoleChatBubbleContent(bubble, text = "") {
  if (!bubble) return;
  const source = String(text ?? "");
  renderChatMessageBlocks(bubble, source);
}

function renderConversationContextChipHtml(chip = {}) {
  const label = escapeHtml(chip.label ?? "");
  const title = escapeHtml(chip.title ?? chip.label ?? "");
  if (chip.path) {
    const filePath = escapeHtml(chip.path);
    const kind = escapeHtml(chip.kind ?? "file");
    return `
      <span class="chat-context-chip-wrap" title="${title}">
        <button class="context-chip context-chip--action" type="button" data-chat-context-open="${filePath}" data-chat-context-kind="${kind}">${label}</button>
        <button class="context-chip-reveal" type="button" data-chat-context-reveal="${filePath}" title="Show in folder">↗</button>
      </span>`;
  }
  if (chip.url) {
    const url = escapeHtml(chip.url);
    return `<button class="context-chip context-chip--action" type="button" data-chat-context-url="${url}" title="${title}">${label}</button>`;
  }
  return `<span class="context-chip" title="${title}">${label}</span>`;
}

function appendConsoleMessageContext(wrapper, message = {}) {
  if (!wrapper) return;
  const summary = getConversationContextSummary(message);
  if (!summary) return;
  const chips = conversationContextChips(summary);
  const preview = conversationContextPreviewText(summary);
  if (chips.length === 0 && !preview) return;
  const box = document.createElement("div");
  box.className = "chat-context-summary";
  const chipsHtml = chips.length
    ? `<div class="chat-context-chips">${chips.map(renderConversationContextChipHtml).join("")}</div>`
    : "";
  box.innerHTML = `
    ${chipsHtml}
    ${preview ? `<div class="chat-context-preview">${escapeHtml(preview)}</div>` : ""}
  `;
  const target = wrapper.querySelector?.(".chat-msg-body, .console-chat-message-body") ?? wrapper;
  target.appendChild(box);
}

function appendConsoleChatBranchActions(wrapper, message = {}) {
  if (!wrapper || !message?.conversation_id || !message?.message_id) return;
  if (wrapper.querySelector?.(".chat-msg-branch-actions")) return;
  if (message.role === "tool_summary") return;
  wrapper.dataset.conversationId = message.conversation_id;
  wrapper.dataset.messageId = message.message_id;
  if (message.seq !== undefined) wrapper.dataset.seq = String(message.seq);
  const body = wrapper.querySelector?.(".chat-msg-body, .console-chat-message-body") ?? wrapper;
  const actions = document.createElement("div");
  actions.className = "chat-msg-branch-actions";
  actions.innerHTML = `
    <button type="button" class="chat-msg-action" data-chat-branch-action="fork"
            data-conversation-id="${escapeHtml(message.conversation_id)}"
            data-message-id="${escapeHtml(message.message_id)}"
            title="Create a new branch through this message">Fork</button>
    <button type="button" class="chat-msg-action" data-chat-branch-action="rewind"
            data-conversation-id="${escapeHtml(message.conversation_id)}"
            data-message-id="${escapeHtml(message.message_id)}"
            title="Create a new branch ending at this message">Rewind</button>
    <button type="button" class="chat-msg-action" data-chat-branch-action="edit"
            data-conversation-id="${escapeHtml(message.conversation_id)}"
            data-message-id="${escapeHtml(message.message_id)}"
            title="Edit this message in a new branch">Edit</button>
  `;
  body.appendChild(actions);
}

async function openConsoleChatExternalLink(anchor) {
  const href = normalizeExternalUrl(anchor?.getAttribute?.("href") ?? anchor?.href ?? "");
  if (!href) return false;
  try {
    if (consoleShellClient?.openUrl) {
      await consoleShellClient.openUrl(href, { ask: true, source: "console_chat" });
      return true;
    }
    if (consoleShellClient?.openExternal) {
      await consoleShellClient.openExternal(href);
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
  const contextOpen = target?.closest?.("[data-chat-context-open]");
  if (contextOpen && consoleChatMessages.contains(contextOpen)) {
    ev.preventDefault();
    void openConversationArtifactPath(contextOpen.getAttribute("data-chat-context-open"));
    return;
  }
  const contextReveal = target?.closest?.("[data-chat-context-reveal]");
  if (contextReveal && consoleChatMessages.contains(contextReveal)) {
    ev.preventDefault();
    void revealConversationArtifactPath(contextReveal.getAttribute("data-chat-context-reveal"));
    return;
  }
  const contextUrl = target?.closest?.("[data-chat-context-url]");
  if (contextUrl && consoleChatMessages.contains(contextUrl)) {
    ev.preventDefault();
    const url = contextUrl.getAttribute("data-chat-context-url");
    if (url) void openConsoleChatExternalLink({ href: url, getAttribute: () => url });
    return;
  }
  const branchAction = target?.closest?.("[data-chat-branch-action]");
  if (branchAction && consoleChatMessages.contains(branchAction)) {
    ev.preventDefault();
    void handleConsoleChatBranchAction(branchAction);
    return;
  }
  const citeChip = target?.closest?.(".cite-chip[data-source-id]");
  if (citeChip && consoleChatMessages.contains(citeChip)) {
    ev.preventDefault();
    revealEvidenceSource(consoleChatMessages, citeChip.dataset.sourceId);
    return;
  }
  const capabilityAction = target?.closest?.("[data-capability-action]");
  if (capabilityAction && consoleChatMessages.contains(capabilityAction)) {
    ev.preventDefault();
    void handoffConsoleCapabilityAction(capabilityAction);
    return;
  }
  const localFileLink = target?.closest?.("[data-local-file-path]");
  if (localFileLink && consoleChatMessages.contains(localFileLink)) {
    ev.preventDefault();
    void openConversationArtifactPath(localFileLink.getAttribute("data-local-file-path"));
    return;
  }
  const copyButton = target?.closest?.("[data-md-copy]");
  if (copyButton && consoleChatMessages.contains(copyButton)) {
    ev.preventDefault();
    const codeEl = copyButton.parentElement?.querySelector("pre code");
    const code = codeEl?.textContent ?? "";
    void writeConsoleClipboardText(code)
      .then((ok) => showCopyButtonResult(copyButton, ok))
      .catch(() => showCopyButtonResult(copyButton, false));
    return;
  }
  const anchor = target?.closest?.("a[href]");
  if (!anchor || !consoleChatMessages.contains(anchor)) return;
  ev.preventDefault();
  void openConsoleChatExternalLink(anchor);
});

async function handoffConsoleCapabilityAction(actionEl) {
  if (!consoleChatInput || !actionEl) return;
  const intent = `${actionEl.getAttribute("data-capability-action") ?? ""}`.trim();
  if (intent === "open_saved_skill") {
    const entryPath = `${actionEl.getAttribute("data-capability-path") ?? ""}`.trim();
    if (entryPath) {
      try { switchTab("settings"); } catch { /* ignore */ }
      await openSkillEditor(entryPath);
    }
    return;
  }
  if (intent === "review_mcp_drafts") {
    try { switchTab("connectors"); } catch { /* ignore */ }
    await loadConnectorsTab();
    try { document.querySelector("#mcpDraftList")?.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* ignore */ }
    return;
  }
  const prompt = `${actionEl.getAttribute("data-capability-prompt") ?? ""}`.trim();
  if (!prompt) return;
  const current = consoleChatInput.value.trim();
  consoleChatInput.value = current ? `${current}\n\n${prompt}` : prompt;
  consoleChatInput.focus();
  consoleChatInput.setSelectionRange(consoleChatInput.value.length, consoleChatInput.value.length);
  try { consoleChatInput.scrollIntoView({ behavior: "smooth", block: "end" }); } catch { /* ignore */ }
  consoleChatInput.classList.add("composer-flash");
  setTimeout(() => consoleChatInput.classList.remove("composer-flash"), 900);
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
  return consoleRuntimeHttpClient.fetchJson(pathname, options);
}

async function fetchJsonWithFallback(pathname, fallback, label = pathname) {
  try {
    return await fetchJson(pathname);
  } catch (error) {
    console.warn(`[console] ${label} refresh failed`, error);
    return fallback;
  }
}

async function fetchClientJsonWithFallback(fetcher, fallback, label) {
  try {
    return await fetcher();
  } catch (error) {
    console.warn(`[console] ${label} refresh failed`, error);
    return fallback;
  }
}

function downloadTextFile(content, name, mime = "text/plain") {
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

function runtimeExportFilename(bundle = {}) {
  const stamp = `${bundle.exported_at ?? new Date().toISOString()}`
    .replace(/[:.]/g, "-")
    .replace(/[^\w-]+/g, "_")
    .slice(0, 40);
  return `lingxy-export-${stamp || Date.now()}.json`;
}

function diagnosticBundleFilename(bundle = {}) {
  const stamp = `${bundle.generated_at ?? new Date().toISOString()}`
    .replace(/[:.]/g, "-")
    .replace(/[^\w-]+/g, "_")
    .slice(0, 40);
  return `lingxy-diagnostics-${stamp || Date.now()}.json`;
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
      ev.preventDefault();
      ev.stopPropagation();
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
      ev.preventDefault();
      ev.stopPropagation();
      const content = bubble.dataset.rawText || bubble.textContent || "";
      if (btn.dataset.action === "copy") {
        void writeConsoleClipboardText(content)
          .then((ok) => showCopyButtonResult(btn, ok))
          .catch(() => showCopyButtonResult(btn, false));
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

function appendConsoleChatErrorBlock(taskId, payload = {}, { cancelled = false } = {}) {
  if (!consoleChatMessages) return null;
  const key = taskId || payload.task_id || payload.taskId || "";
  if (key && consoleChatMessages.querySelector(`.chat-inline-error[data-task-id="${CSS.escape(key)}"]`)) {
    return null;
  }
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();
  const message = String(payload.message ?? payload.text ?? (cancelled ? "任务已取消。" : "任务执行失败。")).trim();
  const category = String(payload.category ?? payload.failure_category ?? (cancelled ? "user_interrupted" : "task_failed")).trim();
  const actions = Array.isArray(payload.user_actions) ? payload.user_actions.filter(Boolean).slice(0, 4) : [];
  const recoveryHint = String(payload.recovery_hint ?? "").trim();
  const recoveryPolicy = payload.recovery_policy && typeof payload.recovery_policy === "object" ? payload.recovery_policy : null;
  const policyBits = recoveryPolicy ? [
    recoveryPolicy.provider_label,
    recoveryPolicy.tool_label,
    recoveryPolicy.issue
  ].filter(Boolean).map((item) => String(item)) : [];
  const retryable = !cancelled && payload.retryable !== false;

  const card = document.createElement("div");
  card.className = `chat-inline-error ${cancelled ? "is-cancelled" : "is-failed"}`;
  if (key) card.dataset.taskId = key;
  card.setAttribute("role", "status");
  card.innerHTML = `
    <div class="cie-head">
      <span class="cie-icon" aria-hidden="true">${cancelled ? "!" : "!"}</span>
      <span class="cie-title">${cancelled ? "任务已取消" : "任务失败"}</span>
      ${category ? `<span class="cie-category">${escapeHtml(category)}</span>` : ""}
    </div>
    <div class="cie-body">${escapeHtml(message)}</div>
    ${recoveryHint ? `<div class="cie-recovery">${escapeHtml(recoveryHint)}</div>` : ""}
    ${policyBits.length > 0 ? `<div class="cie-policy">${policyBits.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
    ${actions.length > 0 ? `<ul class="cie-actions">${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    ${retryable && key ? `<div class="cie-footer"><button type="button" class="chat-msg-action cie-retry">重试</button></div>` : ""}
  `;
  const retryBtn = card.querySelector(".cie-retry");
  retryBtn?.addEventListener("click", async () => {
    const original = retryBtn.textContent;
    retryBtn.disabled = true;
    retryBtn.textContent = "重试中…";
    try {
      await retryTaskViaShell(key, { mode: "retry_same" });
      retryBtn.textContent = "已发起";
      await refreshWorkspace?.();
    } catch (error) {
      retryBtn.disabled = false;
      retryBtn.textContent = "重试失败";
      showConsoleToast(`重试失败：${error?.message ?? error}`, { kind: "err" });
      setTimeout(() => { retryBtn.textContent = original ?? "重试"; }, 1600);
    }
  });
  appendConsoleChatTimelineNode(card);
  consoleChatPin.maybeScrollToBottom();
  return card;
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

const pendingConsoleChatTextDeltas = new Map();
let consoleChatTextDeltaRaf = 0;
let pendingConsoleChatThinkingDelta = "";
let consoleChatThinkingDeltaRaf = 0;

function scheduleAnimationFrame(callback) {
  const schedule = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  return schedule(callback);
}

function scheduleConsoleChatTextDeltaFlush() {
  if (consoleChatTextDeltaRaf) return;
  consoleChatTextDeltaRaf = scheduleAnimationFrame(() => {
    consoleChatTextDeltaRaf = 0;
    flushConsoleChatTextDeltas();
  });
}

function queueConsoleChatTextDelta(taskId, delta) {
  if (!taskId || !delta) return;
  pendingConsoleChatTextDeltas.set(
    taskId,
    `${pendingConsoleChatTextDeltas.get(taskId) ?? ""}${String(delta)}`
  );
  scheduleConsoleChatTextDeltaFlush();
}

function flushConsoleChatTextDeltas(taskId = null) {
  if (taskId) {
    const delta = pendingConsoleChatTextDeltas.get(taskId);
    if (!delta) return;
    pendingConsoleChatTextDeltas.delete(taskId);
    appendConsoleChatTextDelta(taskId, delta);
    return;
  }
  const batch = [...pendingConsoleChatTextDeltas.entries()];
  pendingConsoleChatTextDeltas.clear();
  for (const [queuedTaskId, delta] of batch) {
    appendConsoleChatTextDelta(queuedTaskId, delta);
  }
}

function scheduleConsoleChatThinkingDeltaFlush() {
  if (consoleChatThinkingDeltaRaf) return;
  consoleChatThinkingDeltaRaf = scheduleAnimationFrame(() => {
    consoleChatThinkingDeltaRaf = 0;
    flushConsoleChatThinkingDelta();
  });
}

function queueConsoleChatThinkingDelta(delta) {
  if (!delta) return;
  pendingConsoleChatThinkingDelta += String(delta);
  scheduleConsoleChatThinkingDeltaFlush();
}

function flushConsoleChatThinkingDelta() {
  const delta = pendingConsoleChatThinkingDelta;
  if (!delta) return;
  pendingConsoleChatThinkingDelta = "";
  appendConsoleChatThinkingDelta(delta);
}

function appendConsoleChatTextDelta(taskId, delta) {
  if (!taskId || !delta || !consoleChatMessages) return;
  const owner = consoleTaskOwnerConversationId(taskId);
  if (owner && owner !== currentConsoleConversationId()) return;
  const baseText = consoleChatSuppressedTextByTaskId.get(taskId) ?? consoleChatStreamingAnswer?.text ?? "";
  const rawNextText = `${baseText}${String(delta)}`;
  const visibleNextText = sanitizeAssistantVisibleText(rawNextText);
  const nextText = visibleNextText !== rawNextText ? visibleNextText : rawNextText;
  if (!nextText && visibleNextText !== rawNextText) {
    consoleChatSuppressedTextByTaskId.delete(taskId);
    consoleChatStreamingAnswer?.wrapper?.remove?.();
    consoleChatStreamingAnswer = null;
    return;
  }
  if (looksLikeInternalAssistantText(nextText)) {
    consoleChatSuppressedTextByTaskId.set(taskId, nextText);
    if (consoleChatStreamingAnswer) {
      consoleChatStreamingAnswer.text = nextText;
      consoleChatStreamingAnswer.wrapper?.remove?.();
      consoleChatStreamingAnswer = null;
    }
    return;
  }
  consoleChatSuppressedTextByTaskId.delete(taskId);
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
  consoleChatStreamingAnswer.text = nextText;
  if (consoleChatStreamingAnswer.bubble) {
    consoleChatStreamingAnswer.bubble.classList.remove("answer-placeholder");
    renderConsoleChatBubbleContent(consoleChatStreamingAnswer.bubble, consoleChatStreamingAnswer.text);
  }
  placeConsoleChatProgressCardAtBottom();
  placeConsoleChatThinkingCardAtBottom();
  consoleChatPin.maybeScrollToBottom();
}

function waitForConsoleSmokeFrame() {
  return new Promise((resolve) => {
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    schedule(() => resolve());
  });
}

window.__lingxyConsoleSmoke = {
  async runTextDeltaLoad({ chunks = 1000, chunkText = "x", taskId = "gui-smoke-console-stream" } = {}) {
    const count = Math.max(1, Math.min(5000, Number(chunks) || 1000));
    const text = String(chunkText || "x");
    const started = performance.now();
    consoleChatMessages?.querySelectorAll?.(".chat-msg-bubble.streaming")?.forEach((node) => {
      node.closest(".chat-msg")?.remove?.();
    });
    consoleChatProgressCard?.remove?.();
    consoleChatProgressCard = null;
    consoleChatProgressLines = [];
    consoleChatStreamingAnswer = null;
    consoleChatSuppressedTextByTaskId.delete(taskId);
    pendingConsoleChatTextDeltas.delete(taskId);
    appendConsoleChatProgress({
      event: "planner_request_started",
      data: { iteration: 0 }
    });
    for (let i = 0; i < count; i += 1) {
      queueConsoleChatTextDelta(taskId, text);
    }
    await waitForConsoleSmokeFrame();
    await waitForConsoleSmokeFrame();
    flushConsoleChatTextDeltas(taskId);
    const bubble = consoleChatStreamingAnswer?.bubble ?? consoleChatMessages?.querySelector?.(".chat-msg-bubble.streaming");
    const wrapper = consoleChatStreamingAnswer?.wrapper ?? bubble?.closest?.(".chat-msg");
    const renderedText = bubble?.textContent ?? "";
    const progressPosition = consoleChatProgressCard && wrapper
      ? consoleChatProgressCard.compareDocumentPosition(wrapper)
      : 0;
    const progressBeforeStreaming = Boolean(progressPosition & Node.DOCUMENT_POSITION_FOLLOWING);
    const durationMs = Math.round(performance.now() - started);
    return {
      ok: renderedText.length >= count * text.length && progressBeforeStreaming,
      chunks: count,
      rendered_chars: renderedText.length,
      expected_chars: count * text.length,
      duration_ms: durationMs,
      streaming_bubbles: consoleChatMessages?.querySelectorAll?.(".chat-msg-bubble.streaming")?.length ?? 0,
      progress_before_streaming: progressBeforeStreaming
    };
  },
  async runStopButtonCancel({ taskId = "gui-smoke-console-stop-button" } = {}) {
    consoleChatActiveTaskId = taskId;
    consoleChatCancellationRequestedTaskId = null;
    refreshConsoleChatSendBtnMode();
    const beforeLabel = consoleChatSendBtn?.textContent ?? "";
    consoleChatSendBtn?.click?.();
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && consoleChatCancellationRequestedTaskId !== taskId) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const firstCancelRegistered = consoleChatCancellationRequestedTaskId === taskId;
    refreshConsoleChatSendBtnMode();
    const afterLabel = consoleChatSendBtn?.textContent ?? "";
    return {
      ok: firstCancelRegistered && /取消|强制|停止|Stop/i.test(afterLabel),
      taskId,
      beforeLabel,
      afterLabel,
      firstCancelRegistered,
      stopClass: Boolean(consoleChatSendBtn?.classList?.contains("btn-stop")),
      cancellingClass: Boolean(consoleChatSendBtn?.classList?.contains("btn-cancelling"))
    };
  },
  async runConversationIsolation({
    conversationId = "gui-smoke-conv-a",
    taskId = "gui-smoke-console-isolated-task",
    leakedText = "GUI_SMOKE_SHOULD_NOT_LEAK"
  } = {}) {
    consoleActiveConversation = cacheEnsureBackendFields({
      conversation_id: conversationId,
      title: "GUI smoke isolated conversation"
    });
    rememberConsoleChatTaskOwner(taskId, conversationId);
    consoleChatActiveTaskId = taskId;
    refreshConsoleChatSendBtnMode();
    startNewConsoleChat();
    appendConsoleChatTextDelta(taskId, leakedText);
    await waitForConsoleSmokeFrame();
    flushConsoleChatTextDeltas(taskId);
    const bodyText = consoleChatMessages?.textContent ?? "";
    const leaked = bodyText.includes(leakedText);
    return {
      ok: !leaked && !consoleChatActiveTaskId && !consoleChatSendBtn?.classList?.contains("btn-stop"),
      taskId,
      conversationId,
      leaked,
      activeTaskId: consoleChatActiveTaskId,
      sendButtonText: consoleChatSendBtn?.textContent ?? ""
    };
  },
  async runTaskDetailCancel({ taskId = "gui-smoke-console-detail-cancel" } = {}) {
    state.selectedTaskId = taskId;
    renderTaskDetail({
      task: {
        task_id: taskId,
        status: "running",
        user_command: "GUI smoke running task",
        executor: "tool_using",
        source_app: "gui_smoke",
        created_at: new Date().toISOString()
      },
      events: [],
      artifacts: [],
      children: []
    });
    const cancelBtn = taskDetailSummary?.querySelector?.('[data-task-act="cancel"]');
    const beforeDisabled = Boolean(cancelBtn?.disabled);
    cancelBtn?.click?.();
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && consoleTaskCancellationRequestedId !== taskId) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const cancelRegistered = consoleTaskCancellationRequestedId === taskId;
    return {
      ok: Boolean(cancelBtn) && !beforeDisabled && cancelRegistered,
      taskId,
      beforeDisabled,
      cancelRegistered,
      label: cancelBtn?.textContent?.trim?.() ?? ""
    };
  },
  async runInlineErrorRetry({ taskId = "gui-smoke-console-inline-retry" } = {}) {
    consoleChatMessages?.querySelectorAll?.(`.chat-inline-error[data-task-id="${CSS.escape(taskId)}"]`)?.forEach((node) => node.remove());
    const card = appendConsoleChatErrorBlock(taskId, {
      message: "GUI smoke retryable failure",
      category: "gui_smoke",
      retryable: true,
      user_actions: ["Retry from the inline error card."]
    });
    const retryBtn = card?.querySelector?.(".cie-retry");
    const beforeLabel = retryBtn?.textContent?.trim?.() ?? "";
    retryBtn?.click?.();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && retryBtn?.textContent?.trim?.() !== "已发起") {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const afterLabel = retryBtn?.textContent?.trim?.() ?? "";
    return {
      ok: Boolean(card) && Boolean(retryBtn) && afterLabel === "已发起",
      taskId,
      beforeLabel,
      afterLabel,
      role: card?.getAttribute?.("role") ?? "",
      disabled: Boolean(retryBtn?.disabled)
    };
  },
  async runConversationBranchControls({
    conversationId = "gui-smoke-conv",
    mode = "fork",
    editContent = "GUI smoke edited branch message"
  } = {}) {
    await loadConsoleConversationFromBackend(conversationId);
    await waitForConsoleSmokeFrame();
    await waitForConsoleSmokeFrame();
    const branchMode = ["fork", "rewind", "edit"].includes(mode) ? mode : "fork";
    const beforeConversationId = consoleActiveConversation?.conversation_id ?? null;
    const beforeActionCount = consoleChatMessages?.querySelectorAll?.("[data-chat-branch-action]")?.length ?? 0;
    const branchBtn = consoleChatMessages?.querySelector?.(`[data-chat-branch-action="${CSS.escape(branchMode)}"]`);
    if (!branchBtn) {
      return {
        ok: false,
        reason: `${branchMode}_button_missing`,
        beforeConversationId,
        beforeActionCount
      };
    }
    const originalPrompt = window.prompt;
    if (branchMode === "edit") {
      window.prompt = () => editContent;
    }
    try {
      branchBtn.click();
    } finally {
      if (branchMode === "edit") {
        window.prompt = originalPrompt;
      }
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && consoleActiveConversation?.conversation_id === beforeConversationId) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await waitForConsoleSmokeFrame();
    const afterConversationId = consoleActiveConversation?.conversation_id ?? null;
    const afterActionCount = consoleChatMessages?.querySelectorAll?.("[data-chat-branch-action]")?.length ?? 0;
    const editedVisible = branchMode !== "edit" || (consoleChatMessages?.textContent ?? "").includes(editContent);
    return {
      ok: Boolean(afterConversationId) && afterConversationId !== beforeConversationId && afterActionCount > 0 && editedVisible,
      beforeConversationId,
      afterConversationId,
      mode: branchMode,
      beforeActionCount,
      afterActionCount,
      editedVisible,
      messages: consoleChatMessages?.querySelectorAll?.(".chat-msg")?.length ?? 0
    };
  },
  async runFirstRunProviderSetupRecovery({
    issueDetail = "API key missing during first-run recovery."
  } = {}) {
    state.workspace = {
      ...state.workspace,
      providers: [],
      codeCliAdapters: [],
      providerSetup: {
        status: "recoverable",
        hasUsableRuntime: false,
        hasConfiguredRuntime: true,
        primaryIssue: {
          id: "provider:openai:api_key_missing",
          kind: "provider_config",
          providerId: "openai",
          title: "OpenAI needs setup",
          detail: issueDetail,
          recovery: "api_key_missing",
          action: {
            type: "edit_provider",
            panelId: "providerSettingsPanel",
            providerId: "openai"
          }
        }
      },
      onboarding: {
        ...(state.workspace.onboarding ?? {}),
        pendingSuggestions: [],
        archivedSuggestions: []
      }
    };
    switchTab("settings");
    renderOnboarding();
    await waitForConsoleSmokeFrame();
    const providerItem = wizardList?.querySelector?.('[data-capability-id="ai-provider"]') ?? null;
    const routingItem = wizardList?.querySelector?.('[data-capability-id="model-routing"]') ?? null;
    const openProviderButton = providerItem?.querySelector?.('[data-capability-panel="providerSettingsPanel"]') ?? null;
    openProviderButton?.focus?.();
    const bodyText = wizardList?.textContent ?? "";
    return {
      ok: Boolean(providerItem)
        && Boolean(routingItem)
        && Boolean(openProviderButton)
        && (onboardingState?.textContent ?? "") === "Action needed"
        && bodyText.includes(issueDetail)
        && !bodyText.includes("sk-gui-smoke-secret"),
      state: onboardingState?.textContent ?? "",
      providerDetail: providerItem?.textContent?.trim?.() ?? "",
      routingDetail: routingItem?.textContent?.trim?.() ?? "",
      focusedOpenButton: document.activeElement === openProviderButton,
      openButtonLabel: openProviderButton?.textContent?.trim?.() ?? ""
    };
  },
  async runScheduleCompletionNotice({
    taskId = "gui-smoke-scheduled-artifact",
    artifactPath = "E:\\linxi\\gui-smoke-scheduled-report.pdf",
    status = "success",
    summary = "GUI Smoke Scheduled Artifact",
    artifacts = null
  } = {}) {
    completedScheduleRunTaskIds.delete(taskId);
    const artifactList = Array.isArray(artifacts)
      ? artifacts
      : artifactPath
        ? [
            {
              path: artifactPath,
              mime: "application/pdf",
              preview: summary
            }
          ]
        : [];
    fireScheduleRunCompletionNotice({
      task_id: taskId,
      status,
      user_command: "GUI smoke scheduled artifact task",
      result_summary: summary,
      artifacts: artifactList
    });
    await waitForConsoleSmokeFrame();
    await waitForConsoleSmokeFrame();
    return { ok: true, taskId, artifactPath, status, artifactCount: artifactList.length };
  }
};

function ensureConsoleChatAnswerPlaceholder(taskId, label = "正在整理答案…") {
  if (!taskId || !consoleChatMessages) return;
  if (consoleChatStreamingAnswer?.taskId === taskId) return;
  const wrapper = appendConsoleChatMessage("assistant", "", { allowEmpty: true, taskId });
  const bubble = wrapper?.querySelector(".chat-msg-bubble") ?? null;
  if (!wrapper || !bubble) return;
  bubble.classList.add("streaming", "answer-placeholder");
  bubble.innerHTML = `<span class="answer-placeholder-text">${escapeHtml(label)}</span>`;
  consoleChatStreamingAnswer = {
    taskId,
    text: "",
    wrapper,
    bubble
  };
  placeConsoleChatThinkingCardAtBottom();
  consoleChatPin.maybeScrollToBottom();
}

function finalizeConsoleChatStreaming(taskId, finalText = "") {
  if (!taskId || !consoleChatStreamingAnswer || consoleChatStreamingAnswer.taskId !== taskId) {
    return false;
  }
  const rawText = String(finalText || consoleChatStreamingAnswer.text || consoleChatSuppressedTextByTaskId.get(taskId) || "");
  const text = sanitizeAssistantVisibleText(rawText).trim();
  consoleChatSuppressedTextByTaskId.delete(taskId);
  if (!text) {
    consoleChatStreamingAnswer.wrapper?.remove?.();
    consoleChatStreamingAnswer = null;
    return true;
  }
  if (text && consoleChatStreamingAnswer.bubble) {
    consoleChatStreamingAnswer.bubble.classList.remove("answer-placeholder");
    renderConsoleChatBubbleContent(consoleChatStreamingAnswer.bubble, text);
  }
  consoleChatStreamingAnswer.bubble?.classList.remove("streaming");
  consoleChatStreamingAnswer = null;
  return true;
}

function consoleChatAssistantWrapperForTask(taskId) {
  if (!taskId || !consoleChatMessages) return null;
  return consoleChatMessages.querySelector(`.chat-msg.assistant[data-task-id="${cacheCssEscape(taskId)}"]`);
}

function appendConsoleChatEvidenceSourcesToBody(body, summary) {
  if (!body || !summary || typeof summary !== "object") return false;
  const html = renderEvidenceSourcesHtml(summary, {
    className: "task-answer task-evidence chat-evidence-card",
    title: "Sources",
    zh: "来源"
  });
  if (!html) return false;
  body.querySelector("[data-chat-evidence-sources]")?.remove();
  const holder = document.createElement("div");
  holder.dataset.chatEvidenceSources = "true";
  holder.innerHTML = html;
  body.appendChild(holder);
  wireEvidenceSourceActions(holder, consoleShellClient);
  return true;
}

function appendConsoleChatEvidenceSources(taskId, evidence = null) {
  if (!taskId) return;
  const summary = evidence && typeof evidence === "object"
    ? evidence
    : consoleChatEvidenceByTaskId.get(taskId);
  if (!summary) return;
  consoleChatEvidenceByTaskId.set(taskId, summary);
  const wrapper = consoleChatAssistantWrapperForTask(taskId);
  const body = wrapper?.querySelector(".chat-msg-body");
  if (!body) return;
  if (appendConsoleChatEvidenceSourcesToBody(body, summary)) {
    consoleChatPin.maybeScrollToBottom();
  }
}

function appendConsoleChatContentEvidenceToBody(body, entries) {
  if (!body) return false;
  const html = renderContentEvidenceHtml(entries, {
    className: "task-answer task-evidence chat-content-evidence-card",
    title: "Input evidence",
    zh: "输入证据"
  });
  if (!html) return false;
  body.querySelector("[data-chat-content-evidence]")?.remove();
  const holder = document.createElement("div");
  holder.dataset.chatContentEvidence = "true";
  holder.innerHTML = html;
  const sources = body.querySelector("[data-chat-evidence-sources]");
  if (sources) body.insertBefore(holder, sources);
  else body.appendChild(holder);
  return true;
}

function appendConsoleChatContentEvidence(taskId, entries) {
  if (!taskId) return false;
  const wrapper = consoleChatAssistantWrapperForTask(taskId);
  const body = wrapper?.querySelector(".chat-msg-body");
  if (!body) return false;
  consoleChatContentEvidenceTaskIds.add(taskId);
  if (appendConsoleChatContentEvidenceToBody(body, entries)) {
    consoleChatPin.maybeScrollToBottom();
    return true;
  }
  return false;
}

async function appendConsoleChatContentEvidenceFromTask(taskId) {
  if (!taskId || consoleChatContentEvidenceTaskIds.has(taskId)) return;
  try {
    const detail = await consoleTaskClient.fetchTaskDetail(taskId);
    appendConsoleChatContentEvidence(taskId, extractContentEvidenceFromTaskDetail(detail));
  } catch {
    /* optional */
  }
}

function appendConsoleChatFinalText(taskId, text, {
  role = "assistant",
  evidence = null
} = {}) {
  const visibleText = sanitizeAssistantVisibleText(text).trim();
  if (!taskId || !visibleText) return;
  if (!finalizeConsoleChatStreaming(taskId, visibleText)) {
    appendConsoleChatMessage(role, visibleText, { taskId });
  }
  appendConsoleChatEvidenceSources(taskId, evidence);
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

function appendConsoleChatTimelineNode(node, { taskId = null } = {}) {
  if (!consoleChatMessages || !node) return node;
  const streamingWrapper = consoleChatStreamingAnswer?.wrapper;
  const completedAssistantWrapper = taskId ? consoleChatAssistantWrapperForTask(taskId) : null;
  if (streamingWrapper?.parentElement === consoleChatMessages && node !== streamingWrapper) {
    consoleChatMessages.insertBefore(node, streamingWrapper);
  } else if (
    completedAssistantWrapper?.parentElement === consoleChatMessages
    && node !== completedAssistantWrapper
  ) {
    consoleChatMessages.insertBefore(node, completedAssistantWrapper);
  } else {
    consoleChatMessages.appendChild(node);
  }
  return node;
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
  card.dataset.toolId = toolName;
  if (options.taskId) card.dataset.taskId = options.taskId;
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `tool call ${formatConsoleToolDisplayName(toolName)}`);

  const argsPreview = formatConsoleToolArgsPreview(toolName, args);
  const outcomeText = outcome == null ? "" : compactText(outcome, 110);
  const capabilityViewHtml = renderCapabilityToolViewHtml(
    buildCapabilityToolView(toolName, options.metadata ?? {}),
    { interactive: true }
  );
  const sourcesHtml = renderToolCallSourcesHtml(options.sources ?? []);
  const displayName = formatConsoleToolDisplayName(toolName);
  const time = new Date();
  const timeText = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;

  const ICON = `<svg class="ttc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>`;

  card.innerHTML = `
    <div class="ttc-head">
      ${ICON}
      <span class="ttc-name">${escapeHtml(displayName)}</span>
      <span class="ttc-status">${stateLabel}</span>
      <time class="ttc-time" datetime="${time.toISOString()}">${timeText}</time>
    </div>
    <div class="ttc-args ${argsPreview ? "" : "is-empty"}">${escapeHtml(argsPreview)}</div>
    ${outcomeText
      ? `<div class="ttc-outcome"><span class="ttc-outcome-arrow">→</span><span class="ttc-outcome-text">${escapeHtml(outcomeText)}</span></div>`
      : ""}
    ${sourcesHtml}
    ${capabilityViewHtml}
  `;
  bindConsoleToolCardToggle(card);
  setConsoleToolCardCollapsed(card, inferredState !== "err");
  appendConsoleChatTimelineNode(card, { taskId: options.taskId ?? null });
  consoleChatPin.maybeScrollToBottom();
  return card;
}

function setConsoleToolCardCollapsed(card, collapsed) {
  if (!card) return;
  card.classList.toggle("is-collapsed", Boolean(collapsed));
  card.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function bindConsoleToolCardToggle(card) {
  if (!card || card.dataset.toolToggleBound === "true") return;
  card.dataset.toolToggleBound = "true";
  card.tabIndex = 0;
  card.addEventListener("click", (event) => {
    if (event.target?.closest?.("a,button,input,select,textarea")) return;
    setConsoleToolCardCollapsed(card, !card.classList.contains("is-collapsed"));
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setConsoleToolCardCollapsed(card, !card.classList.contains("is-collapsed"));
  });
}

function collapseCompletedConsoleToolCards() {
  if (!consoleChatMessages) return;
  for (const card of consoleChatMessages.querySelectorAll(".chat-tool-card.is-ok")) {
    setConsoleToolCardCollapsed(card, true);
  }
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
    card.open = false;
    card.innerHTML = `
      <summary class="cth-summary">
        <span class="cth-icon" aria-hidden="true"></span>
        <span class="cth-label">实时过程</span>
        <span class="cth-status">running</span>
      </summary>
      <div class="cth-body"></div>
    `;
    card.addEventListener("toggle", () => {
      if (!card.open) return;
      const body = card.querySelector(".cth-body");
      if (body) body.textContent = consoleChatThinkingText;
    });
    consoleChatMessages.appendChild(card);
    consoleChatThinkingCard = card;
    consoleChatThinkingText = "";
  }
  consoleChatThinkingText += String(delta);
  const status = consoleChatThinkingCard.querySelector(".cth-status");
  if (status) status.textContent = `${consoleChatThinkingText.length} chars`;
  const body = consoleChatThinkingCard.querySelector(".cth-body");
  if (body && consoleChatThinkingCard.open) body.textContent = consoleChatThinkingText;
  placeConsoleChatThinkingCardAtBottom();
  consoleChatPin.maybeScrollToBottom();
}

function placeConsoleChatThinkingCardAtBottom() {
  if (!consoleChatMessages || !consoleChatThinkingCard) return;
  if (consoleChatThinkingCard.parentElement === consoleChatMessages) {
    consoleChatMessages.appendChild(consoleChatThinkingCard);
  }
}

function findConsoleConversationSummary(conversationId) {
  if (!conversationId) return null;
  return chatSidebarItems.find((item) => item?.conversation_id === conversationId)
    ?? conversationsState.items.find((item) => item?.conversation_id === conversationId)
    ?? null;
}

function activateConsoleConversationShell(conversationId, summary = null) {
  if (!conversationId) return null;
  const previous = consoleActiveConversation?.conversation_id === conversationId
    ? consoleActiveConversation
    : null;
  const projectId = summary?.project_id
    ?? summary?.projectId
    ?? previous?.project_id
    ?? (chatSidebarMode === "projects" ? chatSidebarProjectId : null);
  const next = cacheEnsureBackendFields({
    conversation_id: conversationId,
    title: summary?.title ?? previous?.title ?? conversationId.slice(0, 12),
    project_id: projectId ?? null,
    metadata: summary?.metadata ?? previous?.metadata ?? {}
  });
  if (previous?.pendingByClientId instanceof Map) {
    next.pendingByClientId = previous.pendingByClientId;
  }
  if (typeof previous?.lastKnownSeq === "number") {
    next.lastKnownSeq = previous.lastKnownSeq;
  }
  consoleActiveConversation = next;
  setChatSidebarProjectScope(projectId ?? null);
  renderConsoleChatHeader();
  syncConsoleChatActiveTaskForConversation(conversationId);
  return next;
}

function appendConsoleChatProgress(frame, textOverride = "") {
  if (!consoleChatMessages) return;
  const payload = frame?.data ?? {};
  if (payload?.background === true || payload?.visibility === "diagnostic") return;
  if (frame?.id && consoleChatProgressEventIds.has(frame.id)) return;
  if (frame?.id) consoleChatProgressEventIds.add(frame.id);
  const summary = formatTaskEventSummary(frame);
  const text = String(textOverride || (
    frame?.event === "conversation_step"
      ? summary.body
      : `${summary.title}: ${summary.body}`
  )).trim();
  if (!text) return;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();
  if (!consoleChatProgressCard) {
    const card = document.createElement("details");
    card.className = "chat-progress-card";
    // Keep the running card open so Console shows task movement before
    // final synthesis; closeConsoleChatProgressCard folds it after terminal.
    card.open = true;
    card.innerHTML = `
      <summary class="cpg-summary">
        <span class="cpg-icon" aria-hidden="true"></span>
        <span class="cpg-label">执行状态</span>
        <span class="cpg-status"></span>
      </summary>
      <div class="cpg-body"></div>
    `;
    consoleChatMessages.appendChild(card);
    consoleChatProgressCard = card;
    consoleChatProgressLines = [];
  }
  consoleChatProgressLines.push(text);
  if (consoleChatProgressLines.length > 40) {
    consoleChatProgressLines = consoleChatProgressLines.slice(-40);
  }
  const status = consoleChatProgressCard.querySelector(".cpg-status");
  if (status) status.textContent = text;
  const body = consoleChatProgressCard.querySelector(".cpg-body");
  if (body) body.textContent = consoleChatProgressLines.join("\n");
  placeConsoleChatProgressCardAtBottom();
  consoleChatPin.maybeScrollToBottom();
}

function appendConsoleChatLiveProgress(taskId, key, text, minIntervalMs = 1600) {
  if (!taskId || !text) return;
  const cacheKey = `${taskId}:${key}`;
  const now = Date.now();
  const lastAt = consoleChatLiveProgressLastAt.get(cacheKey) ?? 0;
  if (lastAt && now - lastAt < minIntervalMs) return;
  consoleChatLiveProgressLastAt.set(cacheKey, now);
  appendConsoleChatProgress({
    event: "status_changed",
    data: { task_id: taskId, source: key }
  }, text);
}

function shouldAppendConsoleChatProgressFrame(frame) {
  const eventType = frame?.event ?? "";
  if (!eventType) return false;
  const payload = frame?.data ?? {};
  if (payload?.background === true || payload?.visibility === "diagnostic") return false;
  return CONSOLE_CHAT_PROGRESS_EVENT_TYPES.has(eventType);
}

function placeConsoleChatProgressCardAtBottom() {
  if (!consoleChatMessages || !consoleChatProgressCard) return;
  const streamingWrapper = consoleChatStreamingAnswer?.wrapper;
  if (
    streamingWrapper
    && streamingWrapper.parentElement === consoleChatMessages
    && consoleChatProgressCard !== streamingWrapper
  ) {
    consoleChatMessages.insertBefore(consoleChatProgressCard, streamingWrapper);
    return;
  }
  if (consoleChatProgressCard.parentElement === consoleChatMessages) {
    consoleChatMessages.appendChild(consoleChatProgressCard);
  }
}

function closeConsoleChatProgressCard({ terminalText = "" } = {}) {
  if (!consoleChatProgressCard) return;
  placeConsoleChatProgressCardAtBottom();
  const status = consoleChatProgressCard.querySelector(".cpg-status");
  if (status && terminalText) status.textContent = terminalText;
  consoleChatProgressCard.classList.add("is-complete");
  consoleChatProgressCard.open = false;
  consoleChatProgressCard = null;
  consoleChatProgressLines = [];
}

function clearConsoleChatTerminalBuffers(taskId) {
  if (!taskId) return;
  consoleChatSuppressedTextByTaskId.delete(taskId);
  pendingConsoleChatTextDeltas.delete(taskId);
  for (const key of [...consoleChatLiveProgressLastAt.keys()]) {
    if (key.startsWith(`${taskId}:`)) consoleChatLiveProgressLastAt.delete(key);
  }
  if (consoleChatStreamingAnswer?.taskId === taskId) {
    if (!String(consoleChatStreamingAnswer.text ?? "").trim()) {
      consoleChatStreamingAnswer.wrapper?.remove?.();
    }
    consoleChatStreamingAnswer = null;
  }
}

function closeConsoleChatThinkingCard() {
  flushConsoleChatThinkingDelta();
  if (!consoleChatThinkingCard) return;
  placeConsoleChatThinkingCardAtBottom();
  consoleChatThinkingCard.open = false;
  const status = consoleChatThinkingCard.querySelector(".cth-status");
  if (status) status.textContent = `${consoleChatThinkingText.length} chars`;
  consoleChatThinkingCard = null;
  consoleChatThinkingText = "";
}

function settleConsoleChatThinkingCard() {
  flushConsoleChatThinkingDelta();
  if (!consoleChatThinkingCard) return;
  consoleChatThinkingCard.open = false;
  const status = consoleChatThinkingCard.querySelector(".cth-status");
  if (status) status.textContent = `${consoleChatThinkingText.length} chars`;
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
  setConsoleToolCardCollapsed(card, inferredState !== "err");
  bindConsoleToolCardToggle(card);

  const stateLabel = inferredState === "running" ? "RUNNING"
    : inferredState === "err" ? "FAILED"
    : "DONE";
  const argsPreview = formatConsoleToolArgsPreview(toolName, args);
  const outcomeText = outcome == null ? "" : compactText(outcome, 110);
  const capabilityViewHtml = renderCapabilityToolViewHtml(
    buildCapabilityToolView(toolName, options.metadata ?? {}),
    { interactive: true }
  );
  const sourcesHtml = renderToolCallSourcesHtml(options.sources ?? []);

  const nameEl = card.querySelector(".ttc-name");
  const statusEl = card.querySelector(".ttc-status");
  const argsEl = card.querySelector(".ttc-args");
  const outcomeEl = card.querySelector(".ttc-outcome");
  const outcomeTextEl = card.querySelector(".ttc-outcome-text");
  if (nameEl) nameEl.textContent = formatConsoleToolDisplayName(toolName);
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
  card.querySelector(".capability-tool-view")?.remove();
  card.querySelector("[data-tool-call-sources]")?.remove();
  if (sourcesHtml) {
    const capabilityEl = card.querySelector(".capability-tool-view");
    if (capabilityEl) capabilityEl.insertAdjacentHTML("beforebegin", sourcesHtml);
    else card.insertAdjacentHTML("beforeend", sourcesHtml);
  }
  if (capabilityViewHtml) {
    card.insertAdjacentHTML("beforeend", capabilityViewHtml);
  }
  consoleChatPin.maybeScrollToBottom();
  return card;
}

async function appendConsoleChatFinalResult(taskId, payload = {}) {
  if (!taskId || consoleChatResultTaskIds.has(taskId)) return;
  const owner = consoleTaskOwnerConversationId(taskId);
  if (owner && owner !== currentConsoleConversationId()) return;
  const directText = String(
    payload.text
    ?? payload.summary
    ?? payload.message
    ?? ""
  ).trim();
  const visibleText = sanitizeAssistantVisibleText(directText).trim();
  if (!visibleText && directText) {
    consoleChatResultTaskIds.add(taskId);
    return;
  }
  if (visibleText) {
    collapseCompletedConsoleToolCards();
    appendConsoleChatFinalText(taskId, visibleText, {
      evidence: payload.evidence_summary ?? null
    });
    void appendConsoleChatContentEvidenceFromTask(taskId);
    consoleChatResultTaskIds.add(taskId);
    void refreshConsoleChatArtifacts({ force: true });
    return;
  }
  try {
    const detail = await consoleTaskClient.fetchTaskDetail(taskId);
    const latestOwner = consoleTaskOwnerConversationId(taskId);
    if (latestOwner && latestOwner !== currentConsoleConversationId()) return;
    const task = detail?.task ?? detail ?? null;
    const settledText = String(
      task?.result_summary
      ?? task?.inline_result
      ?? task?.failure_user_message
      ?? ""
    ).trim();
    if (!settledText) return;
    collapseCompletedConsoleToolCards();
    appendConsoleChatFinalText(taskId, settledText, {
      role: task?.status === "failed" ? "system" : "assistant",
      evidence: extractEvidenceSummaryFromTaskDetail(detail)
    });
    appendConsoleChatContentEvidence(taskId, extractContentEvidenceFromTaskDetail(detail));
    consoleChatResultTaskIds.add(taskId);
    void refreshConsoleChatArtifacts({ force: true });
  } catch {
    /* optional */
  }
}

function artifactPathFromConsoleToolPayload(payload = {}) {
  if (Array.isArray(payload?.artifact_paths)) {
    const artifactPath = payload.artifact_paths.find((item) => typeof item === "string" && item.length > 0);
    if (artifactPath) return artifactPath;
  }
  return payload?.metadata?.path ?? payload?.artifact_path ?? payload?.path ?? "";
}

function subscribeConsoleChatTask(taskId, { conversationId = currentConsoleConversationId() } = {}) {
  if (!taskId) return;
  rememberConsoleChatTaskOwner(taskId, conversationId);
  const shouldRenderNow = () => consoleChatTaskBelongsToActiveConversation(taskId);
  if (shouldRenderNow()) {
    consoleChatToolCards = new Map();
    consoleChatStreamingAnswer = null;
    consoleChatProgressEventIds = new Set();
    consoleChatSuppressedTextByTaskId.delete(taskId);
    pendingConsoleChatTextDeltas.delete(taskId);
    consoleChatEvidenceByTaskId.delete(taskId);
    consoleChatContentEvidenceTaskIds.delete(taskId);
    closeConsoleChatThinkingCard();
    consoleChatActiveTaskId = taskId;
    refreshConsoleChatSendBtnMode();
  }
  if (consoleChatTaskStreams.has(taskId)) {
    if (shouldRenderNow()) consoleChatEventStream = consoleChatTaskStreams.get(taskId);
    return;
  }
  const stream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
    onEvent(rawEvent) {
      const frame = toTaskEventFrame(rawEvent);
      const payload = frame.data ?? {};
      const terminal = ["failed", "cancelled", "success", "partial_success"].includes(frame.event);
      if (!shouldRenderNow()) {
        if (frame.event === "pending_approval_created") {
          void surfaceApprovalPopup(payload, { taskId });
        }
        if (terminal) {
          markConsoleChatTaskTerminal(taskId);
          void refreshWorkspace();
          void refreshChatSidebar({ force: true });
        }
        return;
      }
      if (frame.event === "reasoning_delta") {
        queueConsoleChatThinkingDelta(payload.delta ?? "");
        appendConsoleChatLiveProgress(taskId, "reasoning_delta", "模型正在规划下一步…");
      } else if (frame.event === "pending_approval_created") {
        void surfaceApprovalPopup(payload, { taskId });
        appendConsoleChatProgress(frame);
        void refreshWorkspace();
      } else if (frame.event === "text_delta") {
        settleConsoleChatThinkingCard();
        queueConsoleChatTextDelta(taskId, payload.delta ?? payload.text ?? "");
        consoleChatState.textContent = "Answering...";
      } else if (frame.event === "tool_call_proposed" || frame.event === "tool_call_started") {
        const toolName = payload.tool_id ?? payload.tool ?? "tool";
        const toolLabel = formatConsoleToolDisplayName(toolName);
        const args = payload.args ?? payload.arguments ?? {};
        const id = createConsoleChatToolCard(toolName, args, { state: "running" });
        if (!payload.__consoleToolCardId) payload.__consoleToolCardId = id;
        consoleChatState.textContent = `${toolLabel}中...`;
        if (window.livePreview?.isFileGenTool?.(toolName)) {
          window.livePreview.openForTool({ toolName, args });
        }
      } else if (frame.event === "tool_input_delta") {
        const toolName = payload.tool_id ?? "";
        if (window.livePreview?.isFileGenTool?.(toolName)) {
          window.livePreview.appendDelta({ toolName, partialJson: payload.partial_json ?? "" });
          appendConsoleChatLiveProgress(taskId, `tool_input_delta:${toolName}`, `${formatConsoleToolDisplayName(toolName)} 正在生成内容…`);
        }
      } else if (frame.event === "tool_call_completed") {
        const toolName = payload.tool_id ?? payload.tool ?? "tool";
        const toolLabel = formatConsoleToolDisplayName(toolName);
        const outcome = payload.observation ?? payload.text ?? payload.error ?? "";
        const candidate = [...consoleChatToolCards.entries()].reverse().find(([, card]) => {
          return card.dataset.toolId === toolName
            && card.querySelector(".ttc-status")?.textContent === "RUNNING";
        })?.[0] ?? null;
        completeConsoleChatToolCard(candidate, toolName, payload.args ?? {}, outcome, {
          state: payload.success === false ? "err" : "ok",
          error: payload.success === false,
          metadata: payload.metadata ?? {},
          sources: payload.sources ?? []
        });
        consoleChatState.textContent = payload.success === false ? `${toolLabel}失败` : `${toolLabel}完成`;
        if (window.livePreview?.isFileGenTool?.(toolName)) {
          const artifactPath = artifactPathFromConsoleToolPayload(payload);
          window.livePreview.commit({
            toolName,
            success: payload.success !== false,
            artifactPath,
            mime: payload.metadata?.mime_type ?? null,
            observation: outcome
          });
        }
      } else if (frame.event === "artifact_created") {
        const artifactPath = artifactPathFromConsoleToolPayload(payload);
        if (artifactPath) {
          window.livePreview?.commit?.({
            toolName: payload.tool_id ?? payload.tool ?? "",
            success: true,
            artifactPath,
            mime: payload.mime ?? payload.mime_type ?? payload.metadata?.mime_type ?? null,
            observation: payload.observation ?? ""
          });
        }
        appendConsoleChatProgress(frame);
      } else if (frame.event === "conversation_step") {
        const source = payload.source_event ?? "";
        if (!String(source).startsWith("tool_call")) {
          appendConsoleChatProgress(frame);
        }
      } else if (frame.event === "final_composer_started") {
        appendConsoleChatProgress(frame);
        settleConsoleChatThinkingCard();
        ensureConsoleChatAnswerPlaceholder(taskId);
        consoleChatState.textContent = "Answering...";
      } else if ([
        "task_created",
        "accepted",
        "started",
        "provider_resolved",
        "planner_request_started",
        "sr_patch_applied",
        "background_context_added",
        "local_file_read_guidance",
        "file_ingest_started",
        "file_ingest_progress",
        "file_ingest_finished"
      ].includes(frame.event)) {
        appendConsoleChatProgress(frame);
        if (["task_created", "accepted", "started"].includes(frame.event)) {
          ensureConsoleChatAnswerPlaceholder(taskId, "正在执行，结果会实时更新…");
        }
      } else if (frame.event === "inline_result") {
        flushConsoleChatTextDeltas(taskId);
        closeConsoleChatThinkingCard();
        closeConsoleChatProgressCard({ terminalText: "生成最终回复" });
        appendConsoleChatFinalText(taskId, payload.text ?? payload.message ?? "", {
          evidence: payload.evidence_summary ?? null
        });
        void appendConsoleChatContentEvidenceFromTask(taskId);
        clearConsoleChatTerminalBuffers(taskId);
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Done.";
      } else if (frame.event === "failed") {
        flushConsoleChatTextDeltas(taskId);
        closeConsoleChatThinkingCard();
        closeConsoleChatProgressCard({ terminalText: "执行失败" });
        clearConsoleChatTerminalBuffers(taskId);
        appendConsoleChatErrorBlock(taskId, payload);
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Failed.";
        markConsoleChatTaskTerminal(taskId);
      } else if (frame.event === "cancelled") {
        flushConsoleChatTextDeltas(taskId);
        closeConsoleChatThinkingCard();
        closeConsoleChatProgressCard({ terminalText: "已取消" });
        clearConsoleChatTerminalBuffers(taskId);
        appendConsoleChatErrorBlock(taskId, payload, { cancelled: true });
        consoleChatResultTaskIds.add(taskId);
        consoleChatState.textContent = "Cancelled.";
        markConsoleChatTaskTerminal(taskId);
      } else if (frame.event === "success" || frame.event === "partial_success") {
        flushConsoleChatTextDeltas(taskId);
        closeConsoleChatThinkingCard();
        closeConsoleChatProgressCard({ terminalText: frame.event === "partial_success" ? "部分完成" : "完成" });
        void appendConsoleChatFinalResult(taskId, payload);
        appendConsoleChatEvidenceSources(taskId, payload.evidence_summary ?? null);
        clearConsoleChatTerminalBuffers(taskId);
        consoleChatState.textContent = frame.event === "partial_success" ? "Partially done." : "Done.";
        markConsoleChatTaskTerminal(taskId);
      } else if (frame.event === "evidence_summary") {
        appendConsoleChatEvidenceSources(taskId, payload);
      } else if (shouldAppendConsoleChatProgressFrame(frame)) {
        appendConsoleChatProgress(frame);
      }
    },
    onError(error) {
      if (shouldRenderNow()) consoleChatState.textContent = `Stream failed: ${error.message}`;
      consoleChatTaskStreams.delete(taskId);
    }
  });
  consoleChatTaskStreams.set(taskId, stream);
  if (shouldRenderNow()) consoleChatEventStream = stream;
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
    if (typeof consoleShellClient?.showPopupCard !== "function") return;
    await consoleShellClient.showPopupCard({
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
  if (typeof consoleShellClient?.approveApproval !== "function") {
    throw new Error("Desktop approval bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.approveApproval({
      approvalId,
      overrides: options.overrides ?? null
    }),
    "Could not approve this action."
  );
}

async function rejectApproval(approvalId, options = {}) {
  if (typeof consoleShellClient?.rejectApproval !== "function") {
    throw new Error("Desktop approval bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.rejectApproval({
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
    const primaryArtifactInfo = artifacts[0] ?? {};
    const suffix = artifacts.length > 1 ? `，共 ${artifacts.length} 个文件` : "";
    const body = primaryLabel
      ? `已生成 ${primaryLabel}${suffix}`
      : `已生成 ${artifacts.length} 个文件`;
    return {
      kind: "success",
      title: status === "partial_success" ? "定时任务部分完成" : "定时任务已完成",
      body,
      lines: [body, summary].filter(Boolean),
      artifactPath: primaryArtifact,
      mime: primaryArtifactInfo.mime ?? primaryArtifactInfo.content_type ?? null,
      inlinePreview: primaryArtifactInfo.preview ?? primaryArtifactInfo.inlinePreview ?? null
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
    consoleShellClient?.showPopupCard?.({
      kind: copy.kind,
      taskId,
      title: copy.title,
      lines: copy.lines,
      artifactPath: copy.artifactPath ?? null,
      mime: copy.mime ?? null,
      inlinePreview: copy.inlinePreview ?? null,
      autoHideMs: copy.kind === "error" ? 12000 : 9000,
      dedupeKey: `schedule-run:${taskId}`
    });
    popupShown = true;
  } catch { /* optional */ }

  if (!popupShown) {
    try {
      consoleShellClient?.notify?.({
        kind: copy.kind,
        taskId,
        title: copy.title,
        body: copy.body,
        artifactPath: copy.artifactPath ?? null,
        mime: copy.mime ?? null,
        inlinePreview: copy.inlinePreview ?? null,
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
    const detail = await consoleTaskClient.fetchTaskDetail(taskId);
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

function getChatSidebarProject(projectId = chatSidebarProjectId) {
  if (!projectId) return null;
  const store = state.projectStore ?? loadConsoleProjectStore();
  return (store.projects ?? []).find((project) => project.id === projectId) ?? null;
}

function getChatSidebarProjectLabel(projectId = chatSidebarProjectId) {
  const project = getChatSidebarProject(projectId);
  return project?.name || project?.id || projectId || null;
}

function getConsoleChatSubmitProjectId() {
  return consoleActiveConversation?.project_id ?? getChatSidebarConversationProjectId() ?? null;
}

function renderConsoleChatEmptyState() {
  if (!consoleChatMessages) return;
  const projectLabel = getChatSidebarProjectLabel(getChatSidebarConversationProjectId());
  const scopeLine = projectLabel
    ? `新对话会保存到项目：${escapeHtml(projectLabel)}`
    : "新对话会保存到独立会话。";
  consoleChatMessages.innerHTML = `
    <div class="console-chat-empty">
      <svg class="console-chat-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <div class="console-chat-empty-title">Start a conversation</div>
      <div class="console-chat-empty-sub">${scopeLine}<br/>Type below, or press <span class="kbd">Ctrl</span><span class="kbd">K</span> to pick a template.</div>
    </div>
  `;
}

function setConsoleChatFilesDrawerOpen(open) {
  const layout = document.querySelector("#panel-chat .chat-layout");
  if (layout) layout.classList.toggle("files-open", open === true);
}

function artifactPathKey(filePath) {
  return `${filePath ?? ""}`.trim().replace(/\\/g, "/").toLowerCase();
}

function dedupeFileEntriesByPath(entries = []) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const path = `${entry?.path ?? ""}`.trim();
    const key = artifactPathKey(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...entry, path });
  }
  return deduped;
}

function normalizeConsoleChatFilePayload(payload = []) {
  if (Array.isArray(payload)) return { artifacts: payload, userFiles: [] };
  if (!payload || typeof payload !== "object") return { artifacts: [], userFiles: [] };
  return {
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
    userFiles: Array.isArray(payload.user_files)
      ? payload.user_files
      : Array.isArray(payload.userFiles) ? payload.userFiles : []
  };
}

function renderConsoleChatArtifacts(payload = []) {
  if (!consoleChatArtifacts) return;
  const normalizedPayload = normalizeConsoleChatFilePayload(payload);
  consoleChatArtifactItems = normalizedPayload;
  const files = normalizedPayload.artifacts.filter((artifact) => `${artifact?.path ?? ""}`.trim());
  const userFiles = normalizedPayload.userFiles.filter((entry) => `${entry?.path ?? ""}`.trim());
  const projectId = getConsoleChatSubmitProjectId();
  const project = projectId && projectId !== DEFAULT_PROJECT_ID
    ? getChatSidebarProject(projectId)
    : null;
  const projectFileEntries = project
    ? currentProjectFiles(project.id, Array.isArray(project.attachedFilePaths) ? project.attachedFilePaths : [])
      .map((entry) => typeof entry === "string" ? { path: entry, legacyScopeLabel: true } : entry)
      .filter((entry) => typeof entry?.path === "string" && entry.path.trim())
      .map((entry) => ({ ...entry, path: entry.path.trim() }))
    : [];
  const activeConversationId = consoleActiveConversation?.conversation_id ?? null;
  const currentConversationFileKeys = new Set(files.map((artifact) => artifactPathKey(artifact.path)));
  const currentUserFileKeys = new Set(userFiles.map((entry) => artifactPathKey(entry.path)));
  const projectGeneratedEntries = project
    ? dedupeFileEntriesByPath([
      ...currentProjectArtifacts(project.id),
      ...files
    ])
    : dedupeFileEntriesByPath(files);
  const projectUserFileEntries = project
    ? dedupeFileEntriesByPath([
      ...currentProjectMessageFiles(project.id),
      ...userFiles
    ])
    : dedupeFileEntriesByPath(userFiles);
  const projectAttachedEntries = dedupeFileEntriesByPath(projectFileEntries);
  if (projectGeneratedEntries.length === 0 && projectUserFileEntries.length === 0 && projectAttachedEntries.length === 0) {
    consoleChatArtifacts.hidden = true;
    setConsoleChatFilesDrawerOpen(false);
    setHtmlIfChanged(consoleChatArtifacts, "");
    if (consoleChatFilesBtn) consoleChatFilesBtn.setAttribute("aria-expanded", "false");
    return;
  }
  if (!consoleChatArtifactsExpanded) {
    consoleChatArtifacts.hidden = true;
    setConsoleChatFilesDrawerOpen(false);
    if (consoleChatFilesBtn) consoleChatFilesBtn.setAttribute("aria-expanded", "false");
    return;
  }
  const projectRows = projectAttachedEntries.map((entry) => {
    const filePath = entry.path;
    const label = formatArtifactLabel(filePath);
    const ext = artifactExtension(filePath);
    const kind = entry.metadata?.kind === "folder" || entry.kind === "folder" || !ext ? "folder" : "file";
    const status = entry.legacyScopeLabel ? "Project scope" : entry.status || (entry.indexed_at ? "indexed" : "attached");
    return `
      <div class="conversation-artifact conversation-artifact--project-file" title="${escapeHtml(filePath)}">
        <span class="artifact-icon ${artifactIconClass(ext)}">${escapeHtml(artifactIconText(filePath))}</span>
        <button type="button" class="conversation-artifact-main" data-conversation-artifact-open="${escapeHtml(filePath)}">
          <span class="conversation-artifact-name">${escapeHtml(label)}</span>
          <span class="conversation-artifact-meta">
            <span>${kind === "folder" ? "Project folder" : "Project file"}</span>
            <span>${escapeHtml(status)}</span>
          </span>
        </button>
        <button type="button" class="conversation-artifact-action" data-conversation-artifact-reveal="${escapeHtml(filePath)}" aria-label="Reveal ${escapeHtml(label)}" title="Reveal in folder">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h3l2 2h4"/></svg>
        </button>
      </div>
    `;
  }).join("");
  const userFileRows = projectUserFileEntries.map((entry) => {
    const filePath = `${entry.path ?? ""}`;
    const label = formatArtifactLabel(filePath);
    const ext = artifactExtension(filePath);
    const isCurrentConversation = (activeConversationId && entry.conversation_id === activeConversationId)
      || currentUserFileKeys.has(artifactPathKey(filePath));
    const scopeLabel = isCurrentConversation
      ? "Current chat upload"
      : (entry.conversation_title ? `Chat upload: ${entry.conversation_title}` : "Project chat upload");
    const kindLabel = entry.kind === "user_image" ? "Image" : "File";
    return `
      <div class="conversation-artifact conversation-artifact--user-file ${isCurrentConversation ? "conversation-artifact--current-conversation" : ""}" title="${escapeHtml(filePath)}">
        <span class="artifact-icon ${artifactIconClass(ext)}">${escapeHtml(artifactIconText(filePath))}</span>
        <button type="button" class="conversation-artifact-main" data-conversation-artifact-open="${escapeHtml(filePath)}">
          <span class="conversation-artifact-name">${escapeHtml(label)}</span>
          <span class="conversation-artifact-meta">
            <span>${escapeHtml(scopeLabel)}</span>
            <span>${escapeHtml(kindLabel)}</span>
            ${entry.created_at ? `<span>${escapeHtml(formatDateTime(entry.created_at))}</span>` : ""}
          </span>
        </button>
        <button type="button" class="conversation-artifact-action" data-conversation-artifact-reveal="${escapeHtml(filePath)}" aria-label="Reveal ${escapeHtml(label)}" title="Reveal in folder">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h3l2 2h4"/></svg>
        </button>
      </div>
    `;
  }).join("");
  const generatedRows = projectGeneratedEntries.map((artifact) => {
    const filePath = `${artifact.path ?? ""}`;
    const label = formatArtifactLabel(filePath);
    const ext = artifactExtension(filePath);
    const createdAt = artifact.created_at ? formatDateTime(artifact.created_at) : "";
    const status = artifactStatusInfo(artifact.status);
    const isCurrentConversation = (activeConversationId && artifact.conversation_id === activeConversationId)
      || currentConversationFileKeys.has(artifactPathKey(filePath));
    const scopeLabel = isCurrentConversation
      ? "Current chat"
      : (artifact.conversation_title ? `Chat: ${artifact.conversation_title}` : "Project chat");
    return `
      <div class="conversation-artifact ${isCurrentConversation ? "conversation-artifact--current-conversation" : ""}" title="${escapeHtml(filePath)}">
        <span class="artifact-icon ${artifactIconClass(ext)}">${escapeHtml(artifactIconText(filePath))}</span>
        <button type="button" class="conversation-artifact-main" data-conversation-artifact-open="${escapeHtml(filePath)}">
          <span class="conversation-artifact-name">${escapeHtml(label)}</span>
          <span class="conversation-artifact-meta">
            <span>${escapeHtml(scopeLabel)}</span>
            ${createdAt ? `<span>${escapeHtml(createdAt)}</span>` : ""}
            ${status ? `<span class="artifact-status ${status.className}">${escapeHtml(status.label)}</span>` : ""}
          </span>
        </button>
        <button type="button" class="conversation-artifact-action" data-conversation-artifact-reveal="${escapeHtml(filePath)}" aria-label="Reveal ${escapeHtml(label)}" title="Reveal in folder">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h3l2 2h4"/></svg>
        </button>
      </div>
    `;
  }).join("");
  const rows = [
    userFileRows ? `<span class="conversation-artifacts-section">${project ? "Project uploads" : "User uploads"}</span>${userFileRows}` : "",
    generatedRows ? `<span class="conversation-artifacts-section">${project ? "Project generated" : "Generated files"}</span>${generatedRows}` : "",
    projectRows ? `<span class="conversation-artifacts-section">Project attachments</span>${projectRows}` : ""
  ].filter(Boolean).join("");
  const total = projectGeneratedEntries.length + projectUserFileEntries.length + projectAttachedEntries.length;
  setHtmlIfChanged(consoleChatArtifacts, `
    <div class="conversation-artifacts-head">
      <span>Files</span>
      <span>${total}</span>
    </div>
    <div class="conversation-artifacts-list">${rows}</div>
    ${project ? `
      <div class="conversation-artifacts-actions">
        <button type="button" class="conversation-artifacts-manage" data-chat-project-files-add="${escapeHtml(project.id)}">Add files/folders</button>
      </div>
    ` : ""}
  `);
  consoleChatArtifacts.hidden = false;
  setConsoleChatFilesDrawerOpen(true);
  if (consoleChatFilesBtn) consoleChatFilesBtn.setAttribute("aria-expanded", "true");
}

async function fetchConsoleConversationArtifacts(conversationId, { limit = 8 } = {}) {
  if (!conversationId) return { artifacts: [], user_files: [] };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 100));
  const data = await fetchJson(`/conversation/${encodeURIComponent(conversationId)}/artifacts?limit=${safeLimit}`);
  return {
    artifacts: Array.isArray(data?.artifacts) ? data.artifacts : [],
    user_files: Array.isArray(data?.user_files) ? data.user_files : []
  };
}

async function refreshConsoleChatArtifacts({ force = false } = {}) {
  const conversationId = consoleActiveConversation?.conversation_id ?? null;
  if (!conversationId) {
    consoleChatArtifactsConversationId = null;
    consoleChatArtifactItems = { artifacts: [], user_files: [] };
    renderConsoleChatArtifacts(consoleChatArtifactItems);
    return;
  }
  const previousId = consoleChatArtifactsConversationId;
  if (!force && previousId === conversationId) return;
  consoleChatArtifactsConversationId = conversationId;
  if (previousId !== conversationId) renderConsoleChatArtifacts({ artifacts: [], user_files: [] });
  try {
    const artifacts = await fetchConsoleConversationArtifacts(conversationId, { limit: 100 });
    if (consoleActiveConversation?.conversation_id !== conversationId) return;
    consoleChatArtifactItems = artifacts;
    renderConsoleChatArtifacts(artifacts);
  } catch {
    if (consoleActiveConversation?.conversation_id === conversationId) {
      consoleChatArtifactItems = { artifacts: [], user_files: [] };
      renderConsoleChatArtifacts(consoleChatArtifactItems);
    }
  }
}

async function openConversationArtifactPath(filePath) {
  if (!filePath) return;
  const openedInline = await openInlinePreviewInChat({ filePath });
  if (openedInline) return;
  if (typeof consoleShellClient?.openPath !== "function") {
    showConsoleToast("Open path bridge unavailable.", { kind: "err" });
    return;
  }
  const result = await consoleShellClient.openPath(filePath);
  if (result) showConsoleToast(`打开失败：${result}`, { kind: "err" });
}

async function revealConversationArtifactPath(filePath) {
  if (!filePath) return;
  try {
    if (typeof consoleShellClient?.showItemInFolder === "function") {
      await consoleShellClient.showItemInFolder(filePath);
      return;
    }
  } catch { /* fallback to open */ }
  await openConversationArtifactPath(filePath);
}

function consoleChatAttachmentPayload(filePaths = []) {
  return normalizeAttachmentSubmission({ filePaths });
}

async function submitConsoleChat() {
  const text = consoleChatInput?.value?.trim() ?? "";
  if (!text) return;
  const attachedFilePaths = consoleChatAttachmentsController.getFilePaths();
  const clientMessageId = cacheCreateClientMessageId();
  // G: when a conversation is active, we are RESUMING; when the user
  // started a blank chat, mint the conversation_id before /task so the
  // backend can create the durable conversation row immediately.
  if (!consoleActiveConversation?.conversation_id) {
    const title = text.replace(/\s+/g, " ").trim();
    consoleActiveConversation = cacheEnsureBackendFields({
      conversation_id: cacheCreateConversationId(),
      title: title.length > 36 ? `${title.slice(0, 36)}…` : title,
      project_id: chatSidebarProjectId ?? null
    });
    renderConsoleChatHeader();
    renderConsoleChatArtifacts([]);
  }
  // No history is re-injected — backend already has it.
  const conversationId = consoleActiveConversation?.conversation_id ?? null;
  const projectId = getConsoleChatSubmitProjectId();
  const conv = cacheEnsureBackendFields(consoleActiveConversation);
  if (conv) {
    conv.pendingByClientId.set(clientMessageId, { role: "user", content: text, ts: Date.now() });
  }
  appendConsoleChatUserMessage(text, clientMessageId, { filePaths: attachedFilePaths });
  consoleChatInput.value = "";
  consoleChatState.textContent = "Submitting...";
  appendConsoleChatProgress({
    event: "submission_received",
    data: { stage: "client_submit" }
  }, "已收到请求，正在创建任务…");
  try {
    const result = await consoleSubmissionClient.submitTask(withConsoleLocaleMetadata({
      sourceApp: "uca.console.chat",
      captureMode: "desktop_console_chat",
      sourceType: "clipboard",
      text: "",
      userCommand: text,
      executionMode: "interactive",
      background: true,
      client_message_id: clientMessageId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(projectId ? { project_id: projectId, selectionMetadata: { project_id: projectId } } : {}),
      ...consoleChatAttachmentPayload(attachedFilePaths)
    }));
    const taskId = result.task?.task_id;
    const replyConvId = result.task?.conversation_id;
    const taskConversationId = replyConvId || conversationId;
    if (replyConvId && replyConvId !== consoleActiveConversation?.conversation_id) {
      consoleActiveConversation = cacheEnsureBackendFields({ conversation_id: replyConvId });
      renderConsoleChatHeader();
      renderConsoleChatArtifacts([]);
    }
    consoleChatState.textContent = taskId ? `Running ${taskId}` : "Running...";
    if (taskId) {
      consoleChatResultTaskIds.delete(taskId);
      rememberConsoleChatTaskOwner(taskId, taskConversationId);
      subscribeConsoleChatTask(taskId, { conversationId: taskConversationId });
      appendConsoleChatProgress({
        event: "task_created",
        data: { executor: result.task?.executor ?? "" }
      }, "任务已创建，正在执行…");
    }
    // Phase 2: surface the new conversation in the sidebar
    // immediately. ensureConversationsCache() refetches from backend
    // so the new conversation_id (with auto-derived title from
    // first user command) appears.
    void refreshChatSidebar({ force: true });
    void refreshWorkspace({ mode: "background" });
    updateChatModelChip?.();
    consoleChatAttachmentsController.clear();
  } catch (error) {
    markConsoleChatPendingFailed(clientMessageId, error);
    consoleChatState.textContent = "Failed.";
  }
}

function appendConsoleChatUserMessage(content, clientMessageId, { filePaths = [] } = {}) {
  if (!consoleChatMessages) return;
  consoleChatMessages.querySelector(".console-chat-empty")?.remove();
  const wrapper = document.createElement("div");
  wrapper.className = "console-chat-message console-chat-message-user pending";
  if (clientMessageId) wrapper.dataset.clientMessageId = clientMessageId;
  const body = document.createElement("div");
  body.className = "console-chat-message-body";
  renderConsoleChatBubbleContent(body, content);
  wrapper.appendChild(body);
  const contextSummary = buildConversationMessageContextSummary({
    source_type: "file_group",
    capture_mode: "desktop_console_chat",
    file_paths: filePaths
  });
  if (contextSummary) appendConsoleMessageContext(wrapper, { metadata: { context_summary: contextSummary } });
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
    updateChatModelChip();
    return;
  }
  const label = consoleActiveConversation.title
    || consoleActiveConversation.conversation_id.slice(0, 12);
  const projectLabel = getChatSidebarProjectLabel(consoleActiveConversation.project_id);
  const usage = workspaceTokenUsage({ conversationId: consoleActiveConversation.conversation_id });
  const tokenLabel = `${formatTokensCompact(usage.total || usage.input + usage.output)} tokens`;
  titleEl.innerHTML = `
    <span>${escapeHtml(projectLabel ? `Continuing in ${projectLabel}: ${label}` : `Continuing: ${label}`)}</span>
    <span class="chat-token-counter" title="Current conversation token usage">${escapeHtml(tokenLabel)}</span>
  `;
  titleEl.hidden = false;
  updateChatModelChip();
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
      appendConsoleMessageContext(node, message);
      appendConsoleChatBranchActions(node, message);
    }
  },
  onAppend(message) {
    if (message.role === "user") {
      const wrapper = appendConsoleChatMessage("user", message.content, { ts: message.ts });
      if (wrapper && wrapper.dataset) {
        wrapper.dataset.messageId = message.message_id;
        wrapper.dataset.seq = String(message.seq);
        appendConsoleMessageContext(wrapper, message);
        appendConsoleChatBranchActions(wrapper, message);
      }
    } else if (message.role === "assistant" || message.role === "system") {
      // Reuse the existing renderer for assistant/system bubbles.
      // Pass through any task_id the backend recorded so the replayed
      // bubble can also surface a Regenerate button. If the backend
      // didn't store one (older messages, system bubbles), the action
      // simply won't render — graceful fallback.
      const taskId = message.task_id ?? message.taskId ?? message.metadata?.task_id ?? null;
      const wrapper = appendConsoleChatMessage(message.role, message.content, { taskId });
      if (wrapper && wrapper.dataset) {
        wrapper.dataset.messageId = message.message_id;
        wrapper.dataset.seq = String(message.seq);
        appendConsoleMessageContext(wrapper, message);
        appendConsoleChatBranchActions(wrapper, message);
        const evidence = extractEvidenceSummaryFromMessage(message);
        if (evidence) {
          appendConsoleChatEvidenceSourcesToBody(wrapper.querySelector(".chat-msg-body"), evidence);
          if (taskId) consoleChatEvidenceByTaskId.set(taskId, evidence);
        }
      }
    }
    consoleChatPin.maybeScrollToBottom();
  },
  onSkip() { /* tool_summary is backend-only history; the timeline owns it */ }
};

async function loadConsoleConversationFromBackend(conversationId) {
  if (!conversationId) return;
  const loadSeq = ++consoleConversationLoadSeq;
  const summary = findConsoleConversationSummary(conversationId);
  activateConsoleConversationShell(conversationId, summary);
  chatSidebarLoadingConversationId = conversationId;
  renderChatSidebar();
  switchTab("chat");
  let detail;
  try {
    detail = await cacheFetchConversationDetail(fetch.bind(globalThis), state.serviceBaseUrl, conversationId);
  } catch (error) {
    if (loadSeq === consoleConversationLoadSeq) {
      chatSidebarLoadingConversationId = null;
      renderChatSidebar();
      showConsoleToast(`加载对话失败：${error.message}`, { kind: "err" });
    }
    return;
  }
  if (loadSeq !== consoleConversationLoadSeq) return;
  if (!detail?.conversation) {
    chatSidebarLoadingConversationId = null;
    renderChatSidebar();
    return;
  }
  const pendingNodes = consoleChatMessages
    ? [...consoleChatMessages.querySelectorAll("[data-client-message-id]")]
      .map((node) => ({
        clientId: node.getAttribute("data-client-message-id"),
        node
      }))
      .filter((entry) => entry.clientId)
    : [];
  const previousActive = consoleActiveConversation?.conversation_id === detail.conversation.conversation_id
    ? consoleActiveConversation
    : null;
  consoleActiveConversation = cacheEnsureBackendFields({
    conversation_id: detail.conversation.conversation_id,
    title: detail.conversation.title,
    project_id: detail.conversation.project_id,
    metadata: detail.conversation.metadata ?? {}
  });
  if (previousActive?.pendingByClientId instanceof Map) {
    consoleActiveConversation.pendingByClientId = previousActive.pendingByClientId;
  }
  if (typeof previousActive?.lastKnownSeq === "number") {
    consoleActiveConversation.lastKnownSeq = Math.max(
      consoleActiveConversation.lastKnownSeq ?? -1,
      previousActive.lastKnownSeq
    );
  }
  consoleConversationUsageById.set(
    detail.conversation.conversation_id,
    aggregateMessageTaskLinkTokenUsage(detail.message_task_links ?? [])
  );
  setChatSidebarProjectScope(detail.conversation.project_id ?? null);
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
  if (consoleChatMessages && pendingNodes.length > 0) {
    for (const { clientId, node } of pendingNodes) {
      if (!consoleActiveConversation.pendingByClientId.has(clientId)) continue;
      consoleChatMessages.appendChild(node);
    }
    consoleChatPin.maybeScrollToBottom();
  }
  renderConsoleChatHeader();
  switchTab("chat");
  syncConsoleChatActiveTaskForConversation(detail.conversation.conversation_id);
  if (detail.conversation.project_id) {
    void refreshProjectWorkspace(detail.conversation.project_id, { force: true });
  }
  void refreshConsoleChatArtifacts({ force: true });
  void refreshWorkspace({ mode: "background" }).then(() => {
    if (consoleActiveConversation?.conversation_id === detail.conversation.conversation_id) {
      syncConsoleChatActiveTaskForConversation(detail.conversation.conversation_id);
    }
  }).catch(() => {});
  // Update the sidebar's active highlight to track the just-loaded
  // conversation.
  chatSidebarLoadingConversationId = null;
  renderChatSidebar();
}

function clearConsoleActiveConversation() {
  consoleActiveConversation = null;
  renderConsoleChatHeader();
  renderConsoleChatArtifacts([]);
  renderChatSidebar();
}

async function deleteConsoleConversation(conversationId) {
  if (!conversationId) return;
  const conversation = chatSidebarItems.find((item) => item?.conversation_id === conversationId)
    ?? conversationsState.items.find((item) => item?.conversation_id === conversationId)
    ?? null;
  const title = conversation?.title || conversationId.slice(0, 12);
  if (typeof globalThis.confirm === "function" && !globalThis.confirm(`删除对话「${title}」？`)) {
    return;
  }
  try {
    await fetchJson(`/conversation/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
      headers: { "X-Lingxy-Desktop-Actor": "desktop_console" }
    });
    chatSidebarItems = chatSidebarItems.filter((item) => item?.conversation_id !== conversationId);
    conversationsState.items = conversationsState.items.filter((item) => item?.conversation_id !== conversationId);
    if (consoleActiveConversation?.conversation_id === conversationId) {
      clearConsoleActiveConversation();
      renderConsoleChatEmptyState();
    }
    await refreshChatSidebar({ force: true });
    await refreshWorkspace({ mode: "summary" });
    showConsoleToast("对话已删除。", { kind: "ok" });
  } catch (error) {
    showConsoleToast(`删除对话失败：${error.message}`, { kind: "err" });
  }
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
const CHAT_SIDEBAR_PROJECT_KEY = "lingxy.chatSidebar.projectId";
const CHAT_SIDEBAR_MODE_KEY = "lingxy.chatSidebar.mode";
let chatSidebarProjectId = (() => {
  try {
    const saved = localStorage.getItem(CHAT_SIDEBAR_PROJECT_KEY);
    return saved ? saved : null;
  } catch {
    return null;
  }
})();
let chatSidebarMode = (() => {
  try {
    const saved = localStorage.getItem(CHAT_SIDEBAR_MODE_KEY);
    return saved === "projects" || chatSidebarProjectId ? "projects" : "chats";
  } catch {
    return chatSidebarProjectId ? "projects" : "chats";
  }
})();
let chatSidebarItems = [];
let chatSidebarCacheKey = "";
let chatSidebarCacheLoaded = false;
let chatSidebarShowingServerSearch = false;
let consoleChatArtifactsExpanded = false;

function syncChatSidebarProjectScopeStorage() {
  try {
    if (chatSidebarProjectId) localStorage.setItem(CHAT_SIDEBAR_PROJECT_KEY, chatSidebarProjectId);
    else localStorage.removeItem(CHAT_SIDEBAR_PROJECT_KEY);
    localStorage.setItem(CHAT_SIDEBAR_MODE_KEY, chatSidebarMode);
  } catch { /* sandbox */ }
}

function getChatSidebarProjects() {
  const store = state.projectStore ?? loadConsoleProjectStore();
  return (Array.isArray(store.projects) ? store.projects : [])
    .filter((project) => project?.id && project.id !== DEFAULT_PROJECT_ID);
}

function firstChatSidebarProjectId() {
  return getChatSidebarProjects()[0]?.id ?? null;
}

function getChatSidebarConversationProjectId() {
  return chatSidebarMode === "projects" ? chatSidebarProjectId : null;
}

function setChatSidebarProjectScope(projectId = null) {
  const rawId = typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
  const nextId = rawId === DEFAULT_PROJECT_ID ? null : rawId;
  const previousMode = chatSidebarMode;
  chatSidebarMode = nextId ? "projects" : "chats";
  if (chatSidebarProjectId === nextId && previousMode === chatSidebarMode) return false;
  chatSidebarProjectId = nextId;
  chatSidebarCacheLoaded = false;
  chatSidebarCacheKey = "";
  syncChatSidebarProjectScopeStorage();
  renderConsoleChatHeader();
  renderChatSidebarProjectFilter();
  if (nextId) void refreshProjectWorkspace(nextId, { force: true });
  return true;
}

function setChatSidebarMode(mode = "chats") {
  const nextMode = mode === "projects" ? "projects" : "chats";
  if (nextMode === "chats") {
    return setChatSidebarProjectScope(null);
  }
  const nextProjectId = chatSidebarProjectId ?? firstChatSidebarProjectId();
  const changed = chatSidebarMode !== "projects" || chatSidebarProjectId !== nextProjectId;
  chatSidebarMode = "projects";
  chatSidebarProjectId = nextProjectId;
  chatSidebarCacheLoaded = false;
  chatSidebarCacheKey = "";
  syncChatSidebarProjectScopeStorage();
  renderConsoleChatHeader();
  renderChatSidebarProjectFilter();
  if (nextProjectId) void refreshProjectWorkspace(nextProjectId, { force: true });
  return changed;
}

function conversationProjectId(conversation = {}) {
  return conversation?.project_id ?? conversation?.projectId ?? null;
}

function isVisibleConversationThread(conversation = {}) {
  const metadata = conversation?.metadata && typeof conversation.metadata === "object"
    ? conversation.metadata
    : {};
  const importedPlaceholder = metadata.imported_from_project_store === true
    && Number(conversation?.message_count ?? 0) <= 0
    && Number(conversation?.task_count ?? 0) <= 0;
  return !importedPlaceholder;
}

function filterConversationsByChatScope(items = [], projectId = chatSidebarProjectId) {
  const source = (Array.isArray(items) ? items : []).filter(isVisibleConversationThread);
  if (projectId) {
    return source.filter((conversation) => conversationProjectId(conversation) === projectId);
  }
  return source.filter((conversation) => {
    const id = conversationProjectId(conversation);
    return !id || id === DEFAULT_PROJECT_ID;
  });
}

function chatSidebarConversationScope(projectId = getChatSidebarConversationProjectId()) {
  return projectId ? null : "ordinary";
}

function chatSidebarRequestKey({ limit = 100, archived = "false", projectId = null, scope = null } = {}) {
  return JSON.stringify({ limit, archived, projectId: projectId ?? null, scope: scope ?? null });
}

async function fetchConversationsList({
  limit = 100,
  archived = "false",
  projectId = null,
  scope = null
} = {}) {
  return cacheFetchConversations(fetch.bind(globalThis), state.serviceBaseUrl, {
    limit,
    archived,
    projectId,
    scope
  });
}

async function searchConversationsList({
  query = "",
  limit = 50,
  archived = "false",
  projectId = null,
  scope = null
} = {}) {
  return cacheSearchConversations(fetch.bind(globalThis), state.serviceBaseUrl, {
    query,
    limit,
    archived,
    projectId,
    scope
  });
}

function renderChatSidebarProjectFilter() {
  const select = document.querySelector("#chatSidebarScopeSelect");
  const scopeWrap = document.querySelector("#chatSidebarProjectSelectWrap");
  const chatsTab = document.querySelector("#chatSidebarChatsTabBtn");
  const projectsTab = document.querySelector("#chatSidebarProjectsTabBtn");
  const sidebar = document.querySelector(".chat-sidebar");
  const projects = getChatSidebarProjects();
  if (chatSidebarProjectId && !projects.some((project) => project.id === chatSidebarProjectId)) {
    chatSidebarProjectId = chatSidebarMode === "projects" ? projects[0]?.id ?? null : null;
    chatSidebarCacheLoaded = false;
    chatSidebarCacheKey = "";
    syncChatSidebarProjectScopeStorage();
  }
  if (chatSidebarMode === "projects" && !chatSidebarProjectId && projects.length > 0) {
    chatSidebarProjectId = projects[0].id;
    chatSidebarCacheLoaded = false;
    chatSidebarCacheKey = "";
    syncChatSidebarProjectScopeStorage();
  }
  const isProjectsMode = chatSidebarMode === "projects";
  if (sidebar) sidebar.dataset.chatSidebarMode = isProjectsMode ? "projects" : "chats";
  for (const [btn, active] of [[chatsTab, !isProjectsMode], [projectsTab, isProjectsMode]]) {
    if (!btn) continue;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (scopeWrap) {
    scopeWrap.hidden = !isProjectsMode;
    scopeWrap.setAttribute("aria-hidden", isProjectsMode ? "false" : "true");
  }
  if (!select) return;
  const options = [
    projects.length === 0 ? `<option value="">暂无项目</option>` : `<option value="">选择项目</option>`,
    ...projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name ?? project.id)}</option>`)
  ].join("");
  if (select.innerHTML !== options) select.innerHTML = options;
  const nextValue = isProjectsMode ? chatSidebarProjectId ?? "" : "";
  if (select.value !== nextValue) select.value = nextValue;
}

async function ensureConversationsCache({
  force = false,
  limit = 100,
  archived = "false",
  projectId = getChatSidebarConversationProjectId(),
  query = ""
} = {}) {
  const searchQuery = String(query ?? "").trim();
  const scope = chatSidebarConversationScope(projectId);
  if (chatSidebarMode === "projects" && !projectId) {
    chatSidebarItems = [];
    chatSidebarCacheKey = chatSidebarRequestKey({ limit, archived, projectId: "__none__", scope: null });
    chatSidebarCacheLoaded = true;
    chatSidebarShowingServerSearch = false;
    return chatSidebarItems;
  }
  if (searchQuery) {
    try {
      const items = await searchConversationsList({
        query: searchQuery,
        limit: Math.min(Math.max(Number(limit) || 50, 1), 50),
        archived,
        projectId,
        scope
      });
      chatSidebarItems = filterConversationsByChatScope(items, projectId);
      chatSidebarCacheKey = chatSidebarRequestKey({ limit, archived, projectId, scope }) + `:search:${searchQuery}`;
      chatSidebarCacheLoaded = true;
      chatSidebarShowingServerSearch = true;
      return chatSidebarItems;
    } catch {
      return chatSidebarItems;
    }
  }
  const key = chatSidebarRequestKey({ limit, archived, projectId, scope });
  if (!force && chatSidebarCacheLoaded && chatSidebarCacheKey === key) {
    return chatSidebarItems;
  }
  try {
    const fetchLimit = projectId ? limit : Math.min(Math.max(Number(limit) || 100, 100), 500);
    const items = await fetchConversationsList({ limit: fetchLimit, archived, projectId, scope });
    chatSidebarItems = filterConversationsByChatScope(items, projectId);
    chatSidebarCacheKey = key;
    chatSidebarCacheLoaded = true;
    chatSidebarShowingServerSearch = false;
    return chatSidebarItems;
  } catch {
    if (chatSidebarCacheKey !== key) {
      chatSidebarItems = [];
      chatSidebarCacheKey = key;
      chatSidebarCacheLoaded = true;
      chatSidebarShowingServerSearch = false;
    }
  }
  return chatSidebarItems;
}

function renderChatSidebar() {
  const listEl = document.querySelector("#chatSidebarList");
  if (!listEl) return;
  renderChatSidebarProjectFilter();
  const items = chatSidebarItems;
  const activeId = consoleActiveConversation?.conversation_id ?? null;
  const projectId = getChatSidebarConversationProjectId();
  listEl.innerHTML = renderChatSidebarListHtml({
    items,
    searchTerm: chatSidebarSearchTerm,
    activeConversationId: activeId,
    projectId: chatSidebarMode === "projects" ? (projectId ?? "__projects__") : null,
    loadingConversationId: chatSidebarLoadingConversationId,
    searchAlreadyApplied: chatSidebarShowingServerSearch
  });
  for (const btn of listEl.querySelectorAll("[data-chat-sidebar-id]")) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.chatSidebarId;
      if (!id || id === activeId) return;
      void loadConsoleConversationFromBackend(id);
    });
  }
  for (const btn of listEl.querySelectorAll("[data-chat-sidebar-delete-id]")) {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.chatSidebarDeleteId;
      if (!id) return;
      void deleteConsoleConversation(id);
    });
  }
}

async function refreshChatSidebar({ force = false } = {}) {
  renderChatSidebarProjectFilter();
  const projectId = getChatSidebarConversationProjectId();
  const items = await ensureConversationsCache({ force, query: chatSidebarSearchTerm, projectId });
  const activeId = consoleActiveConversation?.conversation_id ?? null;
  if (shouldRenderWorkspaceSlice("chat.sidebar", {
    items,
    searchTerm: chatSidebarSearchTerm,
    activeConversationId: activeId,
    projectId,
    mode: chatSidebarMode
  })) {
    renderChatSidebar();
  }
}

function formatDateTime(value) {
  return formatSharedDateTime(value);
}

function formatMoney(value) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function currentConsoleTabId() {
  const activePanel = document.querySelector(".tab-panel.active");
  return activePanel?.id?.replace(/^panel-/, "") || "tasks";
}

function stableWorkspaceSignature(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? "");
  }
}

function shouldRenderWorkspaceSlice(key, value, { force = false } = {}) {
  const signature = stableWorkspaceSignature(value);
  if (!force && workspaceRenderSignatures.get(key) === signature) {
    return false;
  }
  workspaceRenderSignatures.set(key, signature);
  return true;
}

function setHtmlIfChanged(element, html) {
  if (!element) return false;
  const next = String(html ?? "");
  if (element.innerHTML !== next) {
    element.innerHTML = next;
    return true;
  }
  return false;
}

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php",
  ".sh", ".ps1", ".bat", ".sql", ".yaml", ".yml", ".toml", ".ini", ".xml"
]);

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
  // C17 codex round-1: the stat strip used to surface monthlySpend
  // (USD this month) alongside running/queued/today. R flagged USD
  // as the inaccurate signal, so we now compute monthlyTokens
  // instead — same role (running tally that should reset monthly)
  // but with the honest unit.
  const taskUsage = aggregateTaskTokenUsage(tasks);
  const budgetUsage = budgetTokenUsage(budget);
  const usage = taskUsage.total > 0 ? taskUsage : budgetUsage;
  return {
    running: tasks.filter((t) => ["running", "cancelling"].includes(t.status)).length,
    queued: tasks.filter((t) => t.status === "queued").length,
    todaySuccess: tasks.filter((t) => t.status === "success" && `${t.updated_at ?? t.created_at ?? ""}`.startsWith(today)).length,
    monthlyTokens: usage.total
  };
}

// UCA-108: render a 4-card stat strip. The "Today" card embeds an SVG
// sparkline of completed tasks bucketed into the last 15 hours — a
// rough-but-real signal of recent throughput. The fourth card shows
// monthly token consumption (post-C17; was USD spend before).
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

// C17 helper: compact token count for the stat strip ("1.2K", "12.3K",
// "1.2M"). Keeps the card a fixed visual width regardless of order
// of magnitude.
function formatTokensCompact(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K`;
  return `${(v / 1_000_000).toFixed(v < 10_000_000 ? 1 : 0)}M`;
}

function safeTokenNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extractTaskTokenUsage(task = {}) {
  const usage = task?.usage_summary ?? task?.usage ?? task?.metadata?.usage_summary ?? {};
  const input = safeTokenNumber(usage.tokens_in ?? usage.input_tokens ?? usage.prompt_tokens);
  const output = safeTokenNumber(usage.tokens_out ?? usage.output_tokens ?? usage.completion_tokens);
  const total = safeTokenNumber(usage.total_tokens) || input + output || safeTokenNumber(task?.tokens_used);
  return {
    input,
    output,
    total,
    cacheHit: safeTokenNumber(usage.cache_hit_tokens ?? usage.prompt_cache_hit_tokens),
    cacheMiss: safeTokenNumber(usage.cache_miss_tokens ?? usage.prompt_cache_miss_tokens),
    cacheCreate: safeTokenNumber(usage.cache_creation_input_tokens),
    cacheRead: safeTokenNumber(usage.cache_read_input_tokens),
    callCount: safeTokenNumber(usage.call_count ?? usage.llm_usage_call_count)
  };
}

function addTokenUsageTotals(total, next) {
  total.input += next.input;
  total.output += next.output;
  total.total += next.total;
  total.cacheHit += next.cacheHit;
  total.cacheMiss += next.cacheMiss;
  total.cacheCreate += next.cacheCreate;
  total.cacheRead += next.cacheRead;
  total.callCount += next.callCount;
  return total;
}

function emptyTokenUsageTotals() {
  return {
    input: 0,
    output: 0,
    total: 0,
    cacheHit: 0,
    cacheMiss: 0,
    cacheCreate: 0,
    cacheRead: 0,
    callCount: 0
  };
}

function aggregateTaskTokenUsage(tasks = [], { conversationId = null } = {}) {
  const totals = emptyTokenUsageTotals();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (conversationId) {
      const owner = task?.conversation_id ?? task?.context_packet?.selection_metadata?.conversation_id ?? null;
      if (owner !== conversationId) continue;
    }
    addTokenUsageTotals(totals, extractTaskTokenUsage(task));
  }
  if (totals.total === 0) totals.total = totals.input + totals.output;
  return totals;
}

function aggregateMessageTaskLinkTokenUsage(links = []) {
  const totals = emptyTokenUsageTotals();
  const seen = new Set();
  for (const link of Array.isArray(links) ? links : []) {
    const taskId = link?.task_id ?? "";
    if (taskId && seen.has(taskId)) continue;
    if (taskId) seen.add(taskId);
    addTokenUsageTotals(totals, extractTaskTokenUsage(link));
  }
  if (totals.total === 0) totals.total = totals.input + totals.output;
  return totals;
}

function budgetTokenUsage(budget = {}) {
  const spent = budget?.spent ?? {};
  const totals = emptyTokenUsageTotals();
  totals.input = safeTokenNumber(spent.this_month_tokens_in);
  totals.output = safeTokenNumber(spent.this_month_tokens_out);
  totals.total = totals.input + totals.output;
  totals.cacheHit = safeTokenNumber(spent.cache_hit_tokens ?? spent.prompt_cache_hit_tokens);
  totals.cacheMiss = safeTokenNumber(spent.cache_miss_tokens ?? spent.prompt_cache_miss_tokens);
  totals.cacheCreate = safeTokenNumber(spent.cache_creation_input_tokens);
  totals.cacheRead = safeTokenNumber(spent.cache_read_input_tokens);
  return totals;
}

function workspaceTokenUsage({ conversationId = null } = {}) {
  const taskTotals = aggregateTaskTokenUsage(state.workspace?.tasks ?? [], { conversationId });
  if (conversationId && taskTotals.total <= 0) {
    const conversationTotals = consoleConversationUsageById.get(conversationId) ?? null;
    if (conversationTotals) return conversationTotals;
  }
  if (conversationId || taskTotals.total > 0 || taskTotals.cacheHit > 0 || taskTotals.cacheMiss > 0) {
    return taskTotals;
  }
  return budgetTokenUsage(state.workspace?.budget ?? {});
}

function bindTokenUsageShortcut() {
  for (const el of summaryGrid?.querySelectorAll?.("[data-open-token-usage]") ?? []) {
    el.addEventListener("click", () => navigateToSettingsPanel("settings-budget"));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigateToSettingsPanel("settings-budget");
      }
    });
  }
}

function renderSummary() {
  const tasks = state.workspace.tasks ?? [];
  const s = computeSummary(tasks, state.workspace.budget);
  const running = s.running ?? 0;
  const queued = s.queued ?? 0;
  const monthlyTokens = s.monthlyTokens ?? 0;
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
  // Idle mode: nothing in motion AND no tokens burned this month.
  // C17: switched the idle check from "spend === 0" to "monthlyTokens
  // === 0" — same role (running tally that's zero at the start of
  // a fresh month), honest unit. Collapses the 4-card strip to a
  // thin summary line so zero-value cards stop dominating the page.
  // Today's success count + sparkline stay visible because they
  // still carry signal even when the queue is empty.
  const isIdle = running === 0 && queued === 0 && monthlyTokens === 0;
  if (isIdle) {
    summaryGrid.classList.add("stat-strip--idle");
    summaryGrid.innerHTML = `
      <div class="stat-idle">
        <span class="stat-idle-dot" aria-hidden="true"></span>
        <span class="stat-idle-label">Idle — no active work</span>
        <span class="stat-idle-sep" aria-hidden="true"></span>
        <span class="stat-idle-metric"><strong>${escapeHtml(String(s.todaySuccess))}</strong> succeeded today</span>
        <span class="stat-idle-sep" aria-hidden="true"></span>
        <button class="stat-idle-metric stat-idle-metric--button stat-idle-metric--muted" type="button" data-open-token-usage>${escapeHtml(formatTokensCompact(monthlyTokens))} tokens this month</button>
      </div>
    `;
    bindTokenUsageShortcut();
    return;
  }
  summaryGrid.classList.remove("stat-strip--idle");
  const cards = [
    { label: "Running", value: running, sub: "Active right now" },
    { label: "Queued", value: queued, sub: "Waiting for a worker" },
    { label: "Today", value: s.todaySuccess, sub: "Succeeded today", spark: buildTodaySparkline(tasks) },
    { label: "Tokens", value: formatTokensCompact(monthlyTokens), sub: "This month", action: "token_usage" }
  ];
  summaryGrid.innerHTML = cards.map((c) => `
    <div class="stat-card" ${c.action === "token_usage" ? "role=\"button\" tabindex=\"0\" data-open-token-usage title=\"Open token usage\"" : ""}>
      <div class="stat-card-label">${escapeHtml(c.label)}</div>
      <div class="stat-card-value">${escapeHtml(String(c.value))}</div>
      <div class="stat-card-sub">${escapeHtml(c.sub)}</div>
      ${c.spark ?? ""}
    </div>
  `).join("");
  bindTokenUsageShortcut();
}

function renderOnboarding() {
  const checklist = buildCapabilityChecklist({
    workspace: state.workspace,
    serviceBaseUrl: state.serviceBaseUrl
  });
  const summary = capabilityChecklistSummary(checklist);
  const hasBlocking = summary.action_needed > 0;
  const hasRecommended = summary.recommended > 0;
  onboardingState.textContent = hasBlocking ? "Action needed" : hasRecommended ? "Recommended" : "Ready";
  onboardingState.className = `chip ${hasBlocking ? "danger" : hasRecommended ? "warning" : "ready"}`;
  wizardList.innerHTML = checklist.map((entry, index) => `
    <div class="capability-checklist-item" data-capability-id="${escapeHtml(entry.id)}">
      <div class="capability-checklist-main">
        <div class="row">
          <strong class="capability-checklist-title">${index + 1}. ${escapeHtml(entry.title)}</strong>
          <span class="chip ${capabilityStatusChipClass(entry.status)}">${escapeHtml(capabilityStatusLabel(entry.status))}</span>
        </div>
        <p class="muted capability-checklist-detail">${escapeHtml(entry.detail ?? "")}</p>
      </div>
      ${renderCapabilityActionButton(entry)}
    </div>
  `).join("");
  wireCapabilityChecklistActions();
}

function capabilityStatusChipClass(status = "") {
  if (status === "ready") return "ready";
  if (status === "recommended") return "warning";
  if (status === "action_needed") return "danger";
  return "muted";
}

function capabilityStatusLabel(status = "") {
  return {
    action_needed: "needs config",
    recommended: "recommended",
    optional: "optional",
    ready: "ready",
    disabled: "disabled"
  }[status] ?? status;
}

function pendingOnboardingSuggestionById(id = "") {
  return (state.workspace.onboarding?.pendingSuggestions ?? [])
    .find((suggestion) => suggestion?.id === id && suggestion?.status === "pending") ?? null;
}

function renderCapabilityActionButton(entry = {}) {
  const action = entry.action ?? null;
  if (!action || entry.status === "ready" || entry.status === "disabled") return "";
  if (action.type === "suggestion" && action.suggestionId) {
    const suggestion = pendingOnboardingSuggestionById(action.suggestionId);
    const label = suggestion ? onboardingSuggestionActionLabel(suggestion) : "Open";
    return `<button class="btn btn-sm btn-ghost" type="button" data-capability-suggestion="${escapeHtml(action.suggestionId)}">${escapeHtml(label)}</button>`;
  }
  if (action.type === "settings_panel" && action.panelId) {
    return `<button class="btn btn-sm btn-ghost" type="button" data-capability-panel="${escapeHtml(action.panelId)}">Open</button>`;
  }
  if (action.type === "connector_mcp" && action.serverId) {
    return `<button class="btn btn-sm btn-ghost" type="button" data-capability-mcp="${escapeHtml(action.serverId)}">Configure</button>`;
  }
  return "";
}

function wireCapabilityChecklistActions() {
  if (!wizardList) return;
  wizardList.querySelectorAll("[data-capability-suggestion]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const suggestion = pendingOnboardingSuggestionById(btn.dataset.capabilitySuggestion);
      if (!suggestion) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Working...";
      try {
        await completeOnboardingSuggestion(suggestion);
      } catch (error) {
        showConsoleToast(`能力配置失败：${error?.message ?? error}`, { kind: "err" });
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });
  wizardList.querySelectorAll("[data-capability-panel]").forEach((btn) => {
    btn.addEventListener("click", () => navigateToSettingsPanel(btn.dataset.capabilityPanel));
  });
  wizardList.querySelectorAll("[data-capability-mcp]").forEach((btn) => {
    btn.addEventListener("click", () => navigateToConnectorMcp(btn.dataset.capabilityMcp));
  });
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

function memoryItemsToLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => item?.text ?? item)
    .filter(Boolean)
    .join("\n");
}

function projectMemoryItemsToLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const text = String(item?.text ?? "").trim();
      if (!text) return "";
      return item?.projectId ? `${item.projectId} | ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function parseMemoryLines(text = "") {
  return String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ id: `pref_${index + 1}`, text: line, scope: "global" }));
}

function parseProjectMemoryLines(text = "") {
  return String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [projectId, ...rest] = line.includes("|") ? line.split("|") : ["", line];
      return {
        id: `project_${index + 1}`,
        projectId: projectId.trim() || undefined,
        text: rest.join("|").trim(),
        scope: "project"
      };
    })
    .filter((item) => item.text);
}

function getUserMemoryFilter() {
  return {
    scope: userMemoryScopeFilter?.value || "all",
    projectId: userMemoryProjectFilter?.value.trim() || "",
    conversationId: userMemoryConversationFilter?.value.trim() || ""
  };
}

function getMemoryScopeIdentity(item = {}, profile = {}) {
  const proposal = item?.proposalId
    ? (profile.proposals ?? []).find((candidate) => candidate?.proposalId === item.proposalId)
    : null;
  const memory = item?.memoryId
    ? (profile.approvedMemories ?? []).find((candidate) => candidate?.id === item.memoryId)
    : null;
  const undoMemory = item?.undo?.memory && typeof item.undo.memory === "object" ? item.undo.memory : null;
  const source = item?.action ? (proposal ?? memory ?? undoMemory ?? item) : item;
  return {
    scope: source?.scope ?? "global",
    projectId: source?.projectId ?? source?.project_id ?? "",
    conversationId: source?.conversationId ?? source?.conversation_id ?? "",
    artifactId: source?.artifactId ?? source?.artifact_id ?? ""
  };
}

function matchesUserMemoryFilter(item = {}, profile = {}, filter = getUserMemoryFilter()) {
  const identity = getMemoryScopeIdentity(item, profile);
  if (filter.scope && filter.scope !== "all" && identity.scope !== filter.scope) return false;
  if (filter.projectId && identity.scope === "project" && identity.projectId !== filter.projectId) return false;
  if (filter.projectId && identity.scope !== "global" && identity.scope !== "project") return false;
  if (filter.conversationId && identity.scope === "conversation" && identity.conversationId !== filter.conversationId) return false;
  if (filter.conversationId && identity.scope !== "global" && identity.scope !== "conversation") return false;
  return true;
}

function renderGovernedMemoryList(profile = {}) {
  const approved = Array.isArray(profile.approvedMemories) ? profile.approvedMemories : [];
  const proposals = Array.isArray(profile.proposals) ? profile.proposals : [];
  const activityHistory = Array.isArray(profile.activityHistory) ? profile.activityHistory : [];
  const reviewHistory = Array.isArray(profile.reviewHistory) ? profile.reviewHistory : [];
  const filter = getUserMemoryFilter();
  const filteredApproved = approved.filter((item) => matchesUserMemoryFilter(item, profile, filter));
  const reviewInbox = proposals.filter((item) => item?.status === "pending"
    && item?.quality?.lane !== "activity_history"
    && item?.source !== "task_completion_summary");
  const filteredProposals = reviewInbox.filter((item) => matchesUserMemoryFilter(item, profile, filter));
  const filteredActivityHistory = activityHistory.filter((item) => matchesUserMemoryFilter(item, profile, filter));
  const filteredReviewHistory = reviewHistory.filter((item) => matchesUserMemoryFilter(item, profile, filter));
  if (userMemoryApprovedState) {
    userMemoryApprovedState.textContent = `${filteredApproved.length}/${approved.length} approved`;
  }
  if (userMemoryProposalState) {
    userMemoryProposalState.textContent = `${filteredProposals.length}/${reviewInbox.length} pending`;
  }
  if (userMemoryActivityState) {
    userMemoryActivityState.textContent = `${filteredActivityHistory.length}/${activityHistory.length} activities`;
  }
  if (userMemoryReviewState) {
    const undoable = filteredReviewHistory.filter((item) => item?.status !== "undone").length;
    userMemoryReviewState.textContent = `${filteredReviewHistory.length}/${reviewHistory.length} reviews · ${undoable} undoable`;
  }
  if (userMemoryApprovedList) {
    if (filteredApproved.length === 0) {
      renderEmpty(userMemoryApprovedList, "No approved governed memory for this filter.");
    } else {
      userMemoryApprovedList.innerHTML = filteredApproved.map((item) => `
        <div class="surface" style="padding:10px 12px;">
          <div class="row">
            <strong style="font-size:13px;">${escapeHtml(item.type ?? "memory")}</strong>
            <span class="chip muted">${escapeHtml(item.scope ?? "global")}</span>
          </div>
          <p style="margin:6px 0 0;font-size:12px;">${escapeHtml(item.text ?? "")}</p>
          <p class="muted" style="margin:4px 0 0;font-size:11px;">${escapeHtml(item.source ?? "manual")}</p>
          <div class="toolbar" style="margin-top:6px;">
            <button class="btn btn-sm btn-danger" data-memory-delete="${escapeHtml(item.id ?? "")}">Delete</button>
          </div>
        </div>
      `).join("");
      for (const btn of userMemoryApprovedList.querySelectorAll("[data-memory-delete]")) {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.memoryDelete;
          if (!id || !userMemoryState) return;
          userMemoryState.textContent = "Deleting memory...";
          try {
            const result = await consoleUserMemoryClient.deleteMemory(id);
            state.workspace.userMemory = result.userMemory ?? state.workspace.userMemory;
            renderUserMemorySettings();
          } catch (error) {
            userMemoryState.textContent = `Failed: ${error.message}`;
          }
        });
      }
    }
  }
  if (userMemoryProposalList) {
    if (filteredProposals.length === 0) {
      renderEmpty(userMemoryProposalList, "No high-signal memory candidates need review.");
    } else {
      userMemoryProposalList.innerHTML = filteredProposals.map((item) => `
        <div class="surface" style="padding:10px 12px;">
          <div class="row">
            <strong style="font-size:13px;">${escapeHtml(item.type ?? "proposal")}</strong>
            <span class="chip warning">${escapeHtml(item.scope ?? "global")}</span>
          </div>
          <p style="margin:6px 0 0;font-size:12px;">${escapeHtml(item.text ?? "")}</p>
          <p class="muted" style="margin:4px 0 0;font-size:11px;">${escapeHtml(item.source ?? "candidate_detection")} · ${escapeHtml((item.quality?.reasons ?? []).join(", "))}</p>
          <div class="toolbar" style="margin-top:6px;">
            <button class="btn btn-sm" data-memory-approve="${escapeHtml(item.proposalId ?? "")}">Approve</button>
            <button class="btn btn-sm btn-danger" data-memory-reject="${escapeHtml(item.proposalId ?? "")}">Reject</button>
          </div>
        </div>
      `).join("");
      for (const btn of userMemoryProposalList.querySelectorAll("[data-memory-approve],[data-memory-reject]")) {
        btn.addEventListener("click", async () => {
          const proposalId = btn.dataset.memoryApprove || btn.dataset.memoryReject;
          if (!proposalId || !userMemoryState) return;
          const action = btn.dataset.memoryReject ? "reject" : "approve";
          userMemoryState.textContent = `${action === "approve" ? "Approving" : "Rejecting"} proposal...`;
          try {
            const result = await consoleUserMemoryClient.decideProposal(proposalId, action);
            state.workspace.userMemory = result.userMemory ?? state.workspace.userMemory;
            renderUserMemorySettings();
          } catch (error) {
            userMemoryState.textContent = `Failed: ${error.message}`;
          }
        });
      }
    }
  }
  if (userMemoryActivityList) {
    if (filteredActivityHistory.length === 0) {
      renderEmpty(userMemoryActivityList, "No activity history for this filter.");
    } else {
      userMemoryActivityList.innerHTML = filteredActivityHistory.slice(0, 16).map((item) => `
        <div class="surface" style="padding:10px 12px;">
          <div class="row">
            <strong style="font-size:13px;">${escapeHtml(item.kind ?? "activity")}</strong>
            <span class="chip muted">${escapeHtml(item.scope ?? "global")}</span>
          </div>
          <p style="margin:6px 0 0;font-size:12px;white-space:pre-wrap;">${escapeHtml(item.text ?? "")}</p>
          <p class="muted" style="margin:4px 0 0;font-size:11px;">${escapeHtml(item.source ?? "activity")} · ${escapeHtml(item.createdAt ?? "")}</p>
        </div>
      `).join("");
    }
  }
  if (userMemoryReviewList) {
    if (filteredReviewHistory.length === 0) {
      renderEmpty(userMemoryReviewList, "No memory review history for this filter.");
    } else {
      userMemoryReviewList.innerHTML = filteredReviewHistory.slice(0, 12).map((item) => {
        const canUndo = item.status !== "undone";
        return `
          <div class="surface" style="padding:10px 12px;">
            <div class="row">
              <strong style="font-size:13px;">${escapeHtml(item.action ?? "review")}</strong>
              <span class="chip ${canUndo ? "muted" : ""}">${escapeHtml(item.status ?? "applied")}</span>
            </div>
            <p style="margin:6px 0 0;font-size:12px;">${escapeHtml(item.summary ?? "")}</p>
            <p class="muted" style="margin:4px 0 0;font-size:11px;">${escapeHtml(item.createdAt ?? "")}</p>
            ${canUndo ? `
              <div class="toolbar" style="margin-top:6px;">
                <button class="btn btn-sm" data-memory-review-undo="${escapeHtml(item.reviewId ?? "")}">Undo</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("");
      for (const btn of userMemoryReviewList.querySelectorAll("[data-memory-review-undo]")) {
        btn.addEventListener("click", async () => {
          const reviewId = btn.dataset.memoryReviewUndo;
          if (!reviewId || !userMemoryState) return;
          userMemoryState.textContent = "Undoing memory review...";
          try {
            const result = await consoleUserMemoryClient.undoReview(reviewId);
            state.workspace.userMemory = result.userMemory ?? state.workspace.userMemory;
            renderUserMemorySettings();
          } catch (error) {
            userMemoryState.textContent = `Failed: ${error.message}`;
          }
        });
      }
    }
  }
}

function renderUserMemorySettings() {
  const profile = state.workspace.userMemory ?? {};
  const enabled = profile.enabled !== false;
  if (userMemoryEnabled) userMemoryEnabled.checked = enabled;
  if (userMemoryAutoApprove) userMemoryAutoApprove.checked = profile.autoApproveGenerated === true;
  if (userMemoryPreferences) userMemoryPreferences.value = memoryItemsToLines(profile.preferences);
  if (userMemoryProjectNotes) userMemoryProjectNotes.value = projectMemoryItemsToLines(profile.projectMemories);
  if (userMemoryEnabledPill) {
    userMemoryEnabledPill.textContent = enabled ? "enabled" : "disabled";
    userMemoryEnabledPill.className = `chip ${enabled ? "ready" : "muted"}`;
    userMemoryEnabledPill.title = enabled
      ? "Typed memory is available to the ContextCompiler when saved entries exist."
      : "Typed memory injection is disabled.";
  }
  if (userMemorySwitchHint) {
    userMemorySwitchHint.textContent = enabled
      ? "Enabled. Saved preferences and approved memories can be injected as typed context. Routine task history stays separate from durable memory."
      : "Disabled. Stored entries stay saved, but they are not injected into runtime context.";
  }
  if (userMemoryState) {
    const prefCount = Array.isArray(profile.preferences) ? profile.preferences.length : 0;
    const projectCount = Array.isArray(profile.projectMemories) ? profile.projectMemories.length : 0;
    userMemoryState.textContent = `${prefCount} preferences · ${projectCount} project notes`;
  }
  renderGovernedMemoryList(profile);
}

async function saveUserMemorySettings() {
  if (!userMemoryState) return;
  userMemoryState.textContent = "Saving...";
  try {
    const payload = {
      enabled: userMemoryEnabled?.checked !== false,
      autoApproveGenerated: userMemoryAutoApprove?.checked === true,
      preferences: parseMemoryLines(userMemoryPreferences?.value ?? ""),
      projectMemories: parseProjectMemoryLines(userMemoryProjectNotes?.value ?? ""),
      approvedMemories: state.workspace.userMemory?.approvedMemories ?? [],
      proposals: state.workspace.userMemory?.proposals ?? [],
      activityHistory: state.workspace.userMemory?.activityHistory ?? [],
      reviewHistory: state.workspace.userMemory?.reviewHistory ?? []
    };
    const result = await consoleUserMemoryClient.saveUserMemory(payload);
    state.workspace.userMemory = result.userMemory ?? payload;
    renderUserMemorySettings();
    userMemoryState.textContent = "Saved.";
    setTimeout(() => {
      if (userMemoryState.textContent === "Saved.") renderUserMemorySettings();
    }, 1600);
  } catch (error) {
    userMemoryState.textContent = `Failed: ${error.message}`;
  }
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
  const customCount = servers.filter((server) => server.source === "runtime_config").length;
  mcpServerCount.textContent = `${customCount}`;
  if (mcpServerList) {
    mcpServerList.innerHTML = "";
    mcpServerList.hidden = true;
  }
}

function renderSkillRegistries() {
  const registries = state.workspace.skillRegistries ?? [];
  const skills = state.workspace.skills ?? [];
  const activeSkillCount = skills.filter((skill) => skill.active !== false).length;
  const knownSkillCount = skills.length || registries.reduce((total, registry) => total + Number(registry.skillCount ?? 0), 0);
  skillRegistryCount.textContent = skills.length && activeSkillCount !== skills.length
    ? `${activeSkillCount}/${skills.length}`
    : `${knownSkillCount}`;
  if (registries.length === 0 && skills.length === 0) {
    renderEmpty(skillRegistryList, "No skill registries or skills discovered.");
    return;
  }
  skillRegistryList.innerHTML = renderSkillManagementHtml(registries, skills, { escapeHtml });

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
  for (const btn of skillRegistryList.querySelectorAll("[data-skill-duplicate]")) {
    btn.addEventListener("click", async () => {
      const entryPath = btn.dataset.skillDuplicate;
      if (!entryPath) return;
      btn.disabled = true;
      try {
        const result = await duplicateSkillViaShell(entryPath);
        await refreshWorkspace({ mode: "background" });
        showConsoleToast("Skill duplicated.", { kind: "ok" });
        if (result.entryPath) await openSkillEditor(result.entryPath);
      } catch (error) {
        showConsoleToast(`复制 skill 失败：${error.message}`, { kind: "err" });
      } finally {
        btn.disabled = false;
      }
    });
  }
  for (const btn of skillRegistryList.querySelectorAll("[data-skill-open]")) {
    btn.addEventListener("click", () => void openSkillPath(btn.dataset.skillOpen));
  }
  for (const btn of skillRegistryList.querySelectorAll("[data-skill-reveal]")) {
    btn.addEventListener("click", () => void revealSkillPath(btn.dataset.skillReveal));
  }
  for (const btn of skillRegistryList.querySelectorAll("[data-skill-delete]")) {
    btn.addEventListener("click", async () => {
      const entryPath = btn.dataset.skillDelete;
      if (!entryPath) return;
      const ok = confirm("Delete this skill? It will be moved to the local .deleted folder so it can be recovered manually.");
      if (!ok) return;
      btn.disabled = true;
      try {
        await deleteSkillViaShell(entryPath);
        skillRegistryState.textContent = "Skill deleted.";
        await refreshWorkspace({ mode: "background" });
      } catch (error) {
        skillRegistryState.textContent = `Failed: ${error.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }
  for (const btn of skillRegistryList.querySelectorAll("[data-skill-state-registry]")) {
    btn.addEventListener("click", async () => {
      const registry = btn.dataset.skillStateRegistry;
      const id = btn.dataset.skillStateId;
      const enabled = btn.dataset.skillStateEnabled === "true";
      if (!registry || !id) return;
      btn.disabled = true;
      try {
        await updateSkillStateViaShell({ registry, id, enabled, exclusive: true });
        skillRegistryState.textContent = enabled ? "Skill enabled; same-id alternatives stopped." : "Skill stopped.";
        await refreshWorkspace({ mode: "background" });
      } catch (error) {
        skillRegistryState.textContent = `Failed: ${error.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }
}

function marketplaceTrustFields(entry = {}) {
  const preview = entry.trustPreview ?? {};
  const trust = preview.trust ?? entry.trust ?? {};
  const distribution = preview.distribution ?? trust.distribution ?? entry.distribution ?? {};
  const signature = distribution.signature ?? {};
  const archive = distribution.archive ?? {};
  return {
    origin: preview.origin ?? trust.origin ?? entry.source ?? "unknown",
    signatureState: signature.state ?? trust.signatureState ?? entry.signatureState ?? "unsigned",
    archiveState: archive.state ?? entry.archiveState ?? (entry.status === "archived" ? "archived" : "active"),
    warnings: Array.isArray(entry.warnings) ? entry.warnings : Array.isArray(preview.warnings) ? preview.warnings : Array.isArray(trust.warnings) ? trust.warnings : [],
    requiredReview: Boolean(entry.requiredReview ?? preview.requiredUserReview ?? trust.userActionRequired),
    trustState: entry.trustState ?? trust.trustState ?? "unknown"
  };
}

function marketplaceCardHtml(entry = {}) {
  const fields = marketplaceTrustFields(entry);
  const title = entry.title ?? entry.displayName ?? entry.name ?? entry.id ?? "Marketplace item";
  const subtitle = [entry.group, entry.kind, fields.origin, entry.path ?? entry.entryPath ?? entry.directory ?? entry.command ?? entry.url]
    .filter(Boolean)
    .join(" · ");
  const governance = entry.governance
    ? entry.governance.allowed === false
      ? { chip: "danger", label: "governance blocked" }
      : { chip: "ready", label: "governance allowed" }
    : null;
  const enabled = entry.enabledState ? entry.enabledState === "enabled" : entry.enabled !== false && entry.active !== false && entry.status !== "archived";
  const pluginId = entry.management?.pluginId ?? entry.id ?? "";
  const canTogglePlugin = (entry.kind === "plugin" || entry.kind === "connector_plugin") && Boolean(entry.management?.toggleRoute ?? pluginId);
  const canArchivePlugin = (entry.kind === "plugin" || entry.kind === "connector_plugin") && Boolean(entry.management?.archiveRoute ?? (entry.source !== "builtin" && pluginId));
  return `
    <div class="surface" style="padding:10px 12px;">
      <div class="row">
        <strong style="font-size:13px;">${escapeHtml(title)}</strong>
        <span class="chip ${enabled ? "ready" : "muted"}">${escapeHtml(enabled ? "enabled" : "inactive")}</span>
      </div>
      <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(subtitle || "n/a")}</p>
      <div class="toolbar" style="margin-top:6px;">
        <span class="chip ${fields.requiredReview ? "warning" : "ready"}">${escapeHtml(fields.trustState)}</span>
        <span class="chip ${fields.signatureState === "verified" ? "ready" : "warning"}">${escapeHtml(`signature:${fields.signatureState}`)}</span>
        <span class="chip ${fields.archiveState === "archived" ? "muted" : "ready"}">${escapeHtml(`archive:${fields.archiveState}`)}</span>
        ${governance ? `<span class="chip ${governance.chip}">${escapeHtml(governance.label)}</span>` : ""}
      </div>
      ${fields.warnings.length ? `
        <p class="muted" style="margin-top:6px;font-size:11.5px;color:#b45309;">${escapeHtml(fields.warnings.join(", "))}</p>
      ` : ""}
      ${canTogglePlugin ? `
        <div class="toolbar" style="margin-top:8px;">
          <button class="btn btn-sm btn-ghost" data-marketplace-plugin-toggle="${escapeHtml(pluginId)}" data-marketplace-plugin-enabled="${enabled ? "false" : "true"}">${enabled ? "Disable" : "Enable"}</button>
          ${canArchivePlugin ? `<button class="btn btn-sm btn-danger" data-marketplace-plugin-archive="${escapeHtml(pluginId)}">Archive</button>` : ""}
        </div>
      ` : ""}
    </div>
  `;
}

function marketplaceEntries() {
  const inventoryEntries = state.workspace.capabilityInventory?.entries;
  if (Array.isArray(inventoryEntries) && inventoryEntries.length > 0) {
    return inventoryEntries;
  }
  const skills = (state.workspace.skills ?? []).map((skill) => ({
    ...skill,
    kind: "skill",
    title: skill.displayName ?? skill.name ?? skill.id
  }));
  const mcpServers = (state.workspace.mcpServers ?? []).map((server) => ({
    ...server,
    kind: "mcp",
    title: server.displayName ?? server.id
  }));
  const plugins = (state.workspace.plugins ?? []).map((plugin) => ({
    ...plugin,
    kind: "plugin",
    title: plugin.displayName ?? plugin.name ?? plugin.id
  }));
  return [...skills, ...mcpServers, ...plugins];
}

async function setMarketplacePluginEnabled(pluginId, enabled) {
  return fetchJson(
    `/plugins/${encodeURIComponent(pluginId)}/enabled`,
    runtimeJsonOptions("PATCH", { enabled }, { actor: "desktop_console" })
  );
}

async function archiveMarketplacePlugin(pluginId) {
  return fetchJson(`/plugins/${encodeURIComponent(pluginId)}`, {
    method: "DELETE",
    headers: { "X-Lingxy-Desktop-Actor": "desktop_console" }
  });
}

function renderMarketplaceManagement() {
  if (!marketplaceCapabilityList) return;
  const entries = marketplaceEntries();
  const actionable = entries.filter((entry) => {
    const fields = marketplaceTrustFields(entry);
    return fields.requiredReview || fields.signatureState !== "verified" || fields.archiveState === "archived" || entry.governance;
  }).length;
  if (marketplaceCapabilityCount) marketplaceCapabilityCount.textContent = `${actionable}/${entries.length}`;
  if (marketplaceState) marketplaceState.textContent = `${entries.length} capabilities · ${actionable} need review or expose governance state`;
  if (entries.length === 0) {
    renderEmpty(marketplaceCapabilityList, "No capability inventory entries discovered.");
    return;
  }
  marketplaceCapabilityList.innerHTML = entries.map(marketplaceCardHtml).join("");
  marketplaceCapabilityList.querySelectorAll("[data-marketplace-plugin-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pluginId = btn.dataset.marketplacePluginToggle;
      const enabled = btn.dataset.marketplacePluginEnabled === "true";
      if (!pluginId) return;
      btn.disabled = true;
      if (marketplaceState) marketplaceState.textContent = enabled ? "Enabling plugin..." : "Disabling plugin...";
      try {
        await setMarketplacePluginEnabled(pluginId, enabled);
        await refreshWorkspace({ mode: "background" });
      } catch (error) {
        if (marketplaceState) marketplaceState.textContent = `Failed: ${error.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });
  marketplaceCapabilityList.querySelectorAll("[data-marketplace-plugin-archive]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pluginId = btn.dataset.marketplacePluginArchive;
      if (!pluginId) return;
      const ok = confirm("Archive this installed plugin? Built-in plugins can be disabled instead.");
      if (!ok) return;
      btn.disabled = true;
      if (marketplaceState) marketplaceState.textContent = "Archiving plugin...";
      try {
        await archiveMarketplacePlugin(pluginId);
        await refreshWorkspace({ mode: "background" });
      } catch (error) {
        if (marketplaceState) marketplaceState.textContent = `Failed: ${error.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderSkillValidation(target, validation) {
  if (!target) return;
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  if (validation?.valid === true || validation?.ok === true) {
    target.innerHTML = `<span class="chip ready">valid</span>`;
    return;
  }
  if (errors.length > 0 || validation?.valid === false || validation?.ok === false) {
    target.innerHTML = `
      <div><span class="chip danger">needs attention</span></div>
      <div style="margin-top:6px;">
        ${errors.map((error) => `<div>${escapeHtml(error.field ?? "skill")}: ${escapeHtml(error.message ?? error)}</div>`).join("") || "Skill descriptor is invalid."}
      </div>
    `;
    return;
  }
  target.innerHTML = "";
}

function renderSkillTestResult(target, result) {
  if (!target) return;
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const rows = checks.map((check) => {
    const chipClass = check.ok === true ? "ready" : check.ok === false ? "warning" : "muted";
    const chipText = check.ok === true ? "ok" : check.ok === false ? "check" : "n/a";
    return `<div style="margin-top:4px;"><span class="chip ${chipClass}">${chipText}</span> ${escapeHtml(check.label ?? check.id ?? "check")}</div>`;
  }).join("");
  if (!checks.length) {
    renderSkillValidation(target, result?.validation);
    return;
  }
  target.innerHTML = `
    <div><span class="chip ${result?.ok ? "ready" : "warning"}">${result?.ok ? "ready" : "needs attention"}</span></div>
    <div style="margin-top:6px;">${rows}</div>
  `;
}

async function openSkillPath(entryPath) {
  if (!entryPath) return;
  if (typeof consoleShellClient?.openPath !== "function") {
    showConsoleToast("Open path bridge unavailable.", { kind: "err" });
    return;
  }
  const result = await consoleShellClient.openPath(entryPath);
  if (result) showConsoleToast(`打开失败：${result}`, { kind: "err" });
}

async function revealSkillPath(entryPath) {
  if (!entryPath) return;
  try {
    if (typeof consoleShellClient?.showItemInFolder === "function") {
      await consoleShellClient.showItemInFolder(entryPath);
      return;
    }
  } catch { /* fallback to openPath */ }
  await openSkillPath(entryPath);
}

async function openSkillEditor(entryPath) {
  if (!entryPath || !skillEditModal || !skillEditText) return;
  editingSkillPath = entryPath;
  skillEditState.textContent = "Loading...";
  skillEditPath.textContent = entryPath;
  renderSkillValidation(
    skillEditValidation,
    (state.workspace.skills ?? []).find((skill) => (skill.entryPath ?? skill.filePath ?? skill.path) === entryPath)
  );
  skillEditModal.style.display = "flex";
  try {
    const payload = await readSkillMarkdownViaShell(entryPath);
    skillEditText.value = payload.markdown ?? "";
    await refreshSkillHistoryOptions(entryPath);
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
  if (skillEditValidation) skillEditValidation.innerHTML = "";
  if (skillEditHistorySelect) {
    skillEditHistorySelect.innerHTML = "";
    skillEditHistorySelect.disabled = true;
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
let providerListState = { status: "idle", error: "" };
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
  const out = [];
  const byId = new Map();
  for (const choice of choices) {
    const id = `${choice?.id ?? choice ?? ""}`.trim();
    const sources = [
      ...(Array.isArray(choice?.sources) ? choice.sources : []),
      choice?.source
    ].filter((source) => source && source !== "unknown");
    const normalized = {
      ...(choice && typeof choice === "object" ? choice : {}),
      id,
      label: `${choice?.label ?? (id || "(CLI 自行管理)")}`.trim(),
      source: modelChoicePrimarySource(choice?.source, sources[0]),
      sources: [...new Set(sources)],
      configuredDefault: Boolean(choice?.configuredDefault),
      activeRoute: Boolean(choice?.activeRoute),
      recommended: Boolean(choice?.recommended),
      available: Boolean(choice?.available),
      stale: Boolean(choice?.stale)
    };
    if (byId.has(id)) {
      const existing = byId.get(id);
      const mergedSources = [...new Set([
        ...(existing.sources ?? []),
        ...(normalized.sources ?? [])
      ])];
      const merged = {
        ...normalized,
        ...existing,
        sources: mergedSources,
        source: modelChoicePrimarySource(existing.source, normalized.source, mergedSources[0]),
        configuredDefault: Boolean(existing.configuredDefault || normalized.configuredDefault),
        activeRoute: Boolean(existing.activeRoute || normalized.activeRoute),
        recommended: Boolean(existing.recommended || normalized.recommended),
        available: Boolean(existing.available || normalized.available),
        stale: Boolean(existing.stale || normalized.stale)
      };
      byId.set(id, merged);
      out[out.findIndex((entry) => entry.id === id)] = merged;
      continue;
    }
    byId.set(id, normalized);
    out.push(normalized);
  }
  return out;
}

function curatedModelChoice(id) {
  return {
    id,
    label: id,
    source: "curated",
    sources: ["curated"],
    recommended: true
  };
}

function modelChoicePrimarySource(...sources) {
  return sources.find((source) => source && source !== "unknown") ?? "unknown";
}

function modelChoiceBadges(choice = {}) {
  const badges = [];
  if (choice.activeRoute) badges.push({ label: "Active", kind: "active" });
  if (choice.configuredDefault) badges.push({ label: "Default", kind: "default" });
  if (choice.available) badges.push({ label: "Available", kind: "available" });
  if (choice.recommended) badges.push({ label: "Recommended", kind: "recommended" });
  if (choice.stale) badges.push({ label: "Stale", kind: "stale" });
  return badges;
}

function modelChoiceTitle(choice = {}) {
  const bits = [];
  const label = `${choice.label || choice.id || "(CLI default)"}`.trim();
  if (label) bits.push(label);
  if (choice.sources?.length) bits.push(`Sources: ${choice.sources.join(", ")}`);
  const badges = modelChoiceBadges(choice).map((badge) => badge.label);
  if (badges.length) bits.push(`Status: ${badges.join(", ")}`);
  return bits.join(" · ");
}

function renderModelChoiceBadges(choice = {}) {
  return modelChoiceBadges(choice).map((badge) => (
    `<span class="model-picker-badge model-picker-badge--${escapeHtml(badge.kind)}">${escapeHtml(badge.label)}</span>`
  )).join("");
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
      ...providerModelPresets(provider, taskType).map(curatedModelChoice)
    ]);
  }

  if (provider.kind === "code_cli") {
    return uniqueModelChoices(codeCliModelChoices(provider).map((choice) => ({
      ...choice,
      source: "curated",
      sources: ["curated"],
      recommended: true
    })));
  }
  return providerModelPresets(provider, taskType).map(curatedModelChoice);
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
  providerListState = { status: "loading", error: "" };
  renderProvidersList();
  try {
    const data = await listProvidersForConsole();
    customProviders = data.providers ?? [];
    taskRouting = data.taskRouting ?? {};
    providerModelOptionsCache.clear();
    providerModelOptionsLoading.clear();
    providerListState = { status: "ready", error: "" };
    renderProvidersList();
    renderModelRoleManagementSurface();
    renderTaskRouting();
    void prefetchProviderModelOptions();
  } catch (error) {
    console.error("Failed to load providers", error);
    providerListState = { status: "error", error: error?.message ?? String(error) };
    renderProvidersList();
  }
}

function onboardingSuggestionActionLabel(suggestion = {}) {
  const type = suggestion.action?.type ?? "";
  if (type === "enable_builtin_mcp") return "Enable";
  if (type === "configure_builtin_mcp") return "Configure";
  if (type === "open_skills_library") return "Open skills";
  if (type === "configure_provider_mcp_files") return "Open CLI";
  return "Open";
}

function navigateToSettingsPanel(panelId) {
  if (typeof switchTab === "function") {
    try { switchTab("settings"); } catch { /* ignore */ }
  }
  const link = document.querySelector(`[data-settings-nav="${panelId}"]`);
  link?.click?.();
  const panel = document.getElementById(panelId);
  panel?.removeAttribute?.("data-collapsed");
  panel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function navigateToConnectorMcp(serverId = "") {
  if (typeof switchTab === "function") {
    try { switchTab("connectors"); } catch { /* ignore */ }
  }
  setTimeout(() => {
    const card = serverId ? document.getElementById(`mcp-card-${serverId}`) : null;
    card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    card?.classList?.add?.("surface-flash");
    setTimeout(() => card?.classList?.remove?.("surface-flash"), 1200);
  }, 80);
}

function navigateToConnectorsPanel(panelId = "") {
  if (typeof switchTab === "function") {
    try { switchTab("connectors"); } catch { /* ignore */ }
  }
  const link = document.querySelector(`[data-connectors-nav="${panelId}"]`);
  link?.click?.();
  const target = document.getElementById(panelId);
  const panel = target?.closest?.(".settings-group, .panel-section") ?? target;
  panel?.removeAttribute?.("data-collapsed");
  panel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

async function updateOnboardingSuggestionViaShell(id, status) {
  if (typeof consoleShellClient?.updateOnboardingSuggestion !== "function") {
    throw new Error("Desktop onboarding bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateOnboardingSuggestion({ id, status }),
    "Could not update onboarding suggestion."
  );
}

async function completeOnboardingSuggestion(suggestion) {
  if (!suggestion?.id) return;
  const action = suggestion.action ?? {};
  if (action.type === "enable_builtin_mcp" && action.serverId) {
    await toggleMcpServer(action.serverId, true);
    await updateOnboardingSuggestionViaShell(suggestion.id, "completed");
    showConsoleToast(`Enabled ${suggestion.title ?? action.serverId}`, { kind: "ok" });
    await refreshWorkspace();
    return;
  }
  if (action.type === "configure_builtin_mcp") {
    navigateToConnectorMcp(action.serverId);
    return;
  }
  if (action.type === "open_skills_library") {
    navigateToConnectorsPanel("skillsSettingsPanel");
    return;
  }
  if (action.type === "configure_provider_mcp_files") {
    navigateToConnectorsPanel("codeCliSettingsPanel");
    codeCliAdapterMcpFiles?.focus?.();
    return;
  }
  showConsoleToast("No direct action is configured for this suggestion.", { kind: "info" });
}

function renderProviderOnboardingSuggestions() {
  const el = document.getElementById("providerOnboardingList");
  if (!el) return;
  const suggestions = (state.workspace.onboarding?.pendingSuggestions ?? [])
    .filter((suggestion) => suggestion?.status === "pending");
  el.hidden = suggestions.length === 0;
  if (suggestions.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = suggestions.map((suggestion) => {
    const priority = suggestion.priority === "recommended" ? "recommended" : "optional";
    return `
      <div class="onboarding-suggestion-card" data-onboarding-id="${escapeHtml(suggestion.id)}">
        <div class="onboarding-suggestion-main">
          <div class="onboarding-suggestion-title">
            <span>${escapeHtml(suggestion.title ?? "Suggested setup")}</span>
            <span class="pill ${priority === "recommended" ? "pill-info" : "pill-neutral"}">${escapeHtml(priority)}</span>
          </div>
          <div class="onboarding-suggestion-reason">${escapeHtml(suggestion.reason ?? "")}</div>
        </div>
        <div class="onboarding-suggestion-actions">
          <button class="btn btn-sm btn-primary" type="button" data-onboarding-accept="${escapeHtml(suggestion.id)}">${escapeHtml(onboardingSuggestionActionLabel(suggestion))}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-onboarding-dismiss="${escapeHtml(suggestion.id)}">Dismiss</button>
        </div>
      </div>
    `;
  }).join("");

  el.querySelectorAll("[data-onboarding-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const suggestion = suggestions.find((entry) => entry.id === btn.dataset.onboardingAccept);
      if (!suggestion) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Working...";
      try {
        await completeOnboardingSuggestion(suggestion);
      } catch (error) {
        showConsoleToast(`建议执行失败：${error?.message ?? error}`, { kind: "err" });
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  el.querySelectorAll("[data-onboarding-dismiss]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.onboardingDismiss;
      if (!id) return;
      btn.disabled = true;
      try {
        await updateOnboardingSuggestionViaShell(id, "dismissed");
        await refreshWorkspace({ mode: "background" });
        showConsoleToast("Suggestion dismissed.", { kind: "ok" });
      } catch (error) {
        btn.disabled = false;
        showConsoleToast(`忽略失败：${error?.message ?? error}`, { kind: "err" });
      }
    });
  });
}

function applyMcpDraftToForm(draft = {}) {
  const descriptor = draft.descriptor ?? {};
  if (mcpServerId) mcpServerId.value = descriptor.id ?? draft.id ?? "";
  if (mcpServerName) mcpServerName.value = descriptor.displayName ?? draft.name ?? "";
  if (mcpTransport) mcpTransport.value = descriptor.transport ?? "stdio";
  if (mcpCommand) mcpCommand.value = descriptor.transport === "stdio"
    ? (descriptor.command ?? "")
    : (descriptor.url ?? "");
  if (mcpArgs) mcpArgs.value = Array.isArray(descriptor.args) ? descriptor.args.join(" ") : "";
  const wrap = document.querySelector("#mcpServerFormWrap");
  if (wrap) {
    wrap.hidden = false;
    document.querySelector("#mcpServerAddToggle")?.setAttribute("aria-expanded", "true");
  }
  mcpServerForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderMcpDrafts(drafts = []) {
  if (!mcpDraftList) return;
  if (!Array.isArray(drafts) || drafts.length === 0) {
    mcpDraftList.innerHTML = "";
    return;
  }
  mcpDraftList.innerHTML = `
    <div class="conn-section-label">MCP drafts<span class="zh">待审核草稿</span><span class="count">${drafts.length}</span></div>
    ${drafts.map((draft) => {
      const valid = draft.validation?.ok !== false;
      const descriptor = draft.descriptor ?? {};
      return `
        <div class="surface" style="padding:10px 12px;">
          <div class="row" style="gap:8px;">
            <strong style="font-size:13px;">${escapeHtml(draft.name ?? draft.id ?? "MCP draft")}</strong>
            <span class="chip ${valid ? "muted" : "error"}">${valid ? "待导入" : "需修正"}</span>
          </div>
          <p class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(draft.purpose ?? "")}</p>
          <p class="muted mono" style="margin-top:4px;font-size:11px;">${escapeHtml(descriptor.transport ?? "stdio")} · ${escapeHtml(descriptor.command ?? descriptor.url ?? descriptor.id ?? "")}</p>
          <div class="toolbar" style="margin-top:6px;">
            <button class="btn btn-sm btn-ghost" data-mcp-draft-review="${escapeHtml(draft.file)}">Review</button>
            ${valid ? `<button class="btn btn-sm btn-primary" data-mcp-draft-import="${escapeHtml(draft.file)}">Import disabled</button>` : ""}
          </div>
        </div>
      `;
    }).join("")}
  `;
  mcpDraftList.querySelectorAll("[data-mcp-draft-review]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const draft = drafts.find((entry) => entry.file === btn.dataset.mcpDraftReview);
      if (draft) applyMcpDraftToForm(draft);
    });
  });
  mcpDraftList.querySelectorAll("[data-mcp-draft-import]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const file = btn.dataset.mcpDraftImport;
      if (!file) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Importing...";
      try {
        const result = await importMcpDraft({ file });
        showConsoleToast("MCP draft imported as disabled server.", { kind: "ok" });
        await loadConnectorsTab();
        await refreshWorkspace();
        const serverId = result.server?.id ?? result.draft?.id ?? "";
        if (serverId) navigateToConnectorMcp(serverId);
      } catch (error) {
        btn.disabled = false;
        btn.textContent = original;
        showConsoleToast(`Import failed: ${error?.message ?? error}`, { kind: "err" });
      }
    });
  });
}

function renderProvidersList() {
  const el = document.getElementById("providersList");
  if (!el) return;

  if (providerListState.status === "loading" && customProviders.length === 0) {
    el.innerHTML = `<div style="padding:14px;border-radius:10px;background:var(--surface-strong);border:1px solid var(--line);text-align:center;">
      <p class="muted" style="font-size:12px;margin:0;">Loading configured providers...</p>
    </div>`;
    return;
  }

  if (providerListState.status === "error" && customProviders.length === 0) {
    el.innerHTML = `<div style="padding:14px;border-radius:10px;background:var(--surface-strong);border:1px solid var(--line);">
      <p class="muted" style="font-size:12px;margin:0 0 8px;">Could not load providers: ${escapeHtml(providerListState.error || "unknown error")}</p>
      <button id="providersRetryBtn" class="btn btn-sm btn-ghost" type="button">Retry</button>
    </div>`;
    document.getElementById("providersRetryBtn")?.addEventListener("click", () => {
      void loadProvidersAndRouting();
    });
    return;
  }

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

function modelRoleChipClass(status = "") {
  if (status === "ready" || status === "configured" || status === "fallback") return "ready";
  if (status === "missing_provider" || status === "misconfigured" || status === "unavailable") return "warning";
  if (status === "disabled") return "muted";
  return "muted";
}

function renderModelRoleManagementSurface() {
  const el = document.getElementById("modelRoleManagementSurface");
  if (!el) return;
  const modelRoles = state.workspace?.modelRoles ?? null;
  const surface = modelRoles?.managementSurface ?? null;
  const roles = surface?.roles ?? modelRoles?.roles ?? [];
  if (!modelRoles || roles.length === 0) {
    el.innerHTML = "";
    return;
  }

  const featureFlag = surface?.featureFlag ?? modelRoles.featureFlag ?? {};
  const flagLabel = featureFlag.enabled ? "role routing enabled" : "role routing inactive";
  const flagDetail = featureFlag.source ?? "disabled";
  const counts = surface?.counts ?? modelRoles.counts ?? {};

  el.innerHTML = `
    <div class="model-role-surface">
      <div class="model-role-surface-head">
        <div>
          <strong style="font-size:13px;">Model Roles</strong>
          <div class="muted" style="font-size:11px;margin-top:2px;">${featureFlag.enabled
            ? "Automatic role routing is on. Each task lane resolves the provider/model below before model calls."
            : "Automatic role routing is off. The default chat provider handles calls until this gate is enabled."}</div>
        </div>
        <span class="chip ${featureFlag.enabled ? "ready" : "muted"}" title="${escapeHtml(flagDetail)}">${escapeHtml(flagLabel)}</span>
      </div>
      <div class="model-role-list" role="list">
        ${roles.map((roleEntry) => {
          const route = roleEntry.route ?? {};
          const provider = roleEntry.provider ?? {};
          const fallback = roleEntry.fallback ?? {};
          const usage = roleEntry.usage ?? roleEntry.cost ?? {};
          const providerLabel = provider.providerName ?? provider.providerId ?? route.providerId ?? "fallback provider";
          const modelLabel = route.model ?? "auto";
          const sourceLabel = fallback.source ?? route.source ?? "unknown";
          const status = roleEntry.status ?? "unknown";
          const testAction = (roleEntry.actions ?? []).find((action) => action.type === "live_provider_acceptance");
          return `
            <div class="model-role-row" role="listitem">
              <div class="model-role-row-main">
                <strong style="font-size:13px;">${escapeHtml(roleEntry.label ?? roleEntry.role)}</strong>
                <div class="muted" style="font-size:11px;margin-top:3px;overflow-wrap:anywhere;">${escapeHtml(providerLabel)} · ${escapeHtml(modelLabel)}</div>
              </div>
              <div class="model-role-row-meta">
                <span class="chip ${modelRoleChipClass(status)}">${escapeHtml(status)}</span>
                <span class="muted">route: ${escapeHtml(route.taskType ?? "auto")} · ${escapeHtml(sourceLabel)}</span>
                <span class="muted">tokens: ${escapeHtml(usage.usageEvent ?? "llm_usage")}</span>
              </div>
              <div class="toolbar model-role-row-actions">
                <button class="btn btn-sm btn-ghost" type="button" data-model-role-action="open_routing" data-model-role="${escapeHtml(roleEntry.role)}">Route</button>
                ${testAction ? `<button class="btn btn-sm btn-ghost" type="button" data-model-role-action="test" data-model-role="${escapeHtml(roleEntry.role)}" ${testAction.available === false ? "disabled" : ""}>Test</button>` : ""}
              </div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="muted" style="font-size:11px;margin-top:8px;">${escapeHtml(counts.ready ?? 0)} ready · ${escapeHtml(counts.configured ?? 0)} configured · ${escapeHtml(counts.explicit ?? 0)} explicit routes</div>
    </div>
  `;

  el.querySelectorAll("[data-model-role-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.modelRoleAction;
      const role = btn.dataset.modelRole ?? "";
      if (action === "open_routing") {
        navigateToSettingsPanel("routingSettingsPanel");
        return;
      }
      if (action === "test") {
        const roleEntry = roles.find((entry) => entry.role === role) ?? null;
        const testAction = (roleEntry?.actions ?? []).find((entry) => entry.type === "live_provider_acceptance") ?? {};
        showConsoleToast(`Live role test: ${testAction.command ?? "node scripts/real-llm-test/run-live-provider-acceptance.mjs --live"} (${role})`, { kind: "info" });
      }
    });
  });
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

  const saveResult = await saveProviderViaShell(payload);
  if (saveResult?.onboarding) {
    state.workspace.onboarding = saveResult.onboarding;
    renderProviderOnboardingSuggestions();
  }
  closeProviderModal();
  await loadProvidersAndRouting();
  await refreshWorkspace({ mode: "background" });
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

  const entries = buildTaskListEntries(tasks);
  taskCount.textContent = tasks.length === allTasks.length
    ? `${entries.length}`
    : `${entries.length} / ${allTasks.length}`;
  if (entries.length === 0) {
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

  const visibleTasks = entries.map((entry) => entry.task);
  if (!state.selectedTaskId || !visibleTasks.some((t) => t.task_id === state.selectedTaskId)) {
    state.selectedTaskId = visibleTasks[0].task_id;
  }

  // Outer signature gate: if (id, status, sub_status, child_count) for the
  // whole entry list is unchanged AND the selection didn't change, we can
  // skip the entire reconcile pass. This handles the no-op poll tick where
  // nothing material is different.
  const sig = `${taskListSignature(entries)}|sel:${state.selectedTaskId ?? ""}`;
  if (taskList._lastSig === sig && taskList.children.length > 0) {
    return;
  }
  taskList._lastSig = sig;

  // Incremental reconcile (instead of `taskList.innerHTML = ...` which was
  // the previous fix). Why: even with the outer sig gate, a single task
  // changing status triggers the gate to invalidate, and a destructive
  // innerHTML rebuild loses every button's DOM identity → hover state /
  // focus / mid-scroll click target / CSS transitions all reset for every
  // unchanged button. The result is a visible flicker each time any task
  // state ticks. Reconcile preserves the button nodes that are still
  // current and only modifies the ones whose data changed.
  reconcileTaskList(taskList, entries, state.selectedTaskId);
}

// Diff `container.children` against `entries` by task_id, modifying DOM
// in place so persistent button nodes keep their identity across refresh
// ticks. The HTML for any single entry is generated by the same pure
// renderer used at first render (`renderTaskListItemHtml`), which means
// the markup contract stays in one place.
function reconcileTaskList(container, entries, selectedTaskId) {
  const existing = new Map();
  for (const btn of [...container.children]) {
    const id = btn.dataset.taskId;
    if (id) existing.set(id, btn);
  }

  // First pass: ensure each target entry has a button at the right index,
  // updating in place when content differs.
  for (let cursor = 0; cursor < entries.length; cursor += 1) {
    const entry = entries[cursor];
    const id = entry.task.task_id;
    const html = renderTaskListItemHtml({ ...entry, selectedTaskId }).trim();
    let btn = existing.get(id);
    if (!btn) {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      btn = tmp.firstElementChild;
      // Click handler: bind once at creation. Subsequent updates only
      // rewrite inner content / classes, not the button element itself,
      // so this listener survives reconciles.
      btn.addEventListener("click", () => {
        state.selectedTaskId = btn.dataset.taskId;
        renderTasks();
        void refreshTaskDetail({ showLoading: true });
      });
    } else {
      // Cheap content diff: outerHTML compare. If unchanged, leave the
      // node alone so :hover / :focus / animations stay intact.
      if (btn.outerHTML.trim() !== html) {
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        const next = tmp.firstElementChild;
        // Mutate this button's attributes + inner subtree, but DON'T
        // replace the button node — the click listener and DOM identity
        // are preserved.
        btn.className = next.className;
        btn.style.cssText = next.style.cssText;
        for (const attr of next.getAttributeNames()) {
          if (attr === "class" || attr === "style") continue;
          btn.setAttribute(attr, next.getAttribute(attr));
        }
        btn.innerHTML = next.innerHTML;
      }
    }
    // Reorder if needed.
    if (container.children[cursor] !== btn) {
      container.insertBefore(btn, container.children[cursor] ?? null);
    }
  }

  // Second pass: drop any tail buttons whose tasks are no longer in the
  // entries list (e.g. filtered out, deleted, or beyond the limit).
  while (container.children.length > entries.length) {
    container.removeChild(container.lastElementChild);
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
      void refreshTaskDetail({ showLoading: true });
    });
  }
}

/* ── Artifact selection ── */
async function loadArtifactPreviewText(artifactPath) {
  if (!artifactPath) return { text: "Select an artifact to preview.", kind: "empty" };
  if (isImageArtifactPath(artifactPath)) {
    try {
      const dataUrl = await consoleShellClient.readFileAsDataUrl(artifactPath, imageMimeFor(artifactPath));
      return { text: "", kind: "image", dataUrl };
    } catch (error) {
      return { text: `Image preview failed: ${error?.message ?? error}`, kind: "error" };
    }
  }
  if (!isPreviewableArtifactPath(artifactPath)) {
    return { text: "This file type can't be previewed inline — use Open to view it externally.", kind: "external" };
  }
  try {
    const raw = await consoleShellClient.readTextFile(artifactPath, 4000);
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
      await consoleShellClient.openPath(p);
    });
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-reveal]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        if (typeof consoleShellClient.showItemInFolder === "function") {
          await consoleShellClient.showItemInFolder(btn.dataset.artifactPath);
        } else {
          await consoleShellClient.openPath(btn.dataset.artifactPath);
        }
      }
      catch { await consoleShellClient.openPath(btn.dataset.artifactPath); }
    });
  }
  for (const btn of taskArtifactList.querySelectorAll("[data-artifact-copy]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await consoleShellClient.writeClipboardText(btn.dataset.artifactPath);
    });
  }

  // Visibility + actions are owned by renderArtifactReport() now —
  // called above once selection is stable.
}

/* ═══════════════════════════════════════════════
   LEGACY FILES PANEL — hidden compatibility artifact manager
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
      const detail = await consoleTaskClient.fetchTaskDetail(taskSummary.task_id);
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
      const raw = await consoleShellClient.readTextFile(filePath, 12_000);
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
  if (filesSelectedPath) await consoleShellClient.openPath(filesSelectedPath);
});

filesRevealBtn?.addEventListener("click", async () => {
  if (!filesSelectedPath) return;
  const dir = dirnameOf(filesSelectedPath);
  if (dir) await consoleShellClient.openPath(dir);
});

filesCopyPathBtn?.addEventListener("click", async () => {
  if (!filesSelectedPath) return;
  await consoleShellClient.writeClipboardText(filesSelectedPath);
  filesPreviewLabel.textContent = "Path copied to clipboard";
  setTimeout(() => {
    if (filesSelectedPath) filesPreviewLabel.textContent = `Preview · ${basenameOf(filesSelectedPath)}`;
  }, 1200);
});

// UCA-125 Phase 2b: show/hide helpers for the split detail panels.
// Each subtasks/artifacts/timeline section is its own .panel card now,
// so empty sections just stay hidden instead of rendering a stacked
// "No X yet." placeholder.
// Compatibility renderer for the retired "Recent conversations in Tasks"
// panel. FW-028 moves conversation browsing to Chat/Projects so Tasks can
// remain an execution-run surface. If a legacy caller still renders this,
// all clicks load the canonical Chat conversation instead of switching to
// the hidden Conversations tab.
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
      void loadConsoleConversationFromBackend(convId);
      showConsoleToast("已加载对话，可继续输入", { kind: "ok" });
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

function renderTaskEvidenceSummary(detail) {
  return renderEvidenceSourcesHtml(extractEvidenceSummaryFromTaskDetail(detail));
}

function renderTaskContentEvidence(detail) {
  return renderContentEvidenceHtml(extractContentEvidenceFromTaskDetail(detail));
}

function renderTaskConversationLink(task = {}) {
  const conversationId = task.conversation_id ?? task.context_packet?.selection_metadata?.conversation_id ?? null;
  if (!conversationId) return "";
  const projectId = task.project_id ?? task.context_packet?.selection_metadata?.project_id ?? null;
  return `
    <section class="task-conversation-link" aria-label="Linked conversation">
      <div>
        <div class="task-conversation-title">Conversation<span class="zh">所属对话</span></div>
        <div class="muted">${escapeHtml(conversationId)}${projectId ? ` · ${escapeHtml(projectId)}` : ""}</div>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" data-task-open-conversation="${escapeHtml(conversationId)}">
        Open in Chat
      </button>
    </section>
  `;
}

function resetContextDebugPaging() {
  state.contextDebugSelectedLimit = 12;
  state.contextDebugOmittedLimit = 8;
}

async function copySelectedTaskContextDebugJson(button) {
  const task = state.selectedTaskDetail?.task ?? null;
  const compiledContext = task?.context_packet?.compiled_context ?? null;
  if (!compiledContext) return;
  const previous = button.textContent;
  button.disabled = true;
  try {
    const payload = JSON.stringify(compiledContext, null, 2);
    if (typeof consoleShellClient?.writeClipboardText === "function") {
      await consoleShellClient.writeClipboardText(payload);
    } else {
      await navigator.clipboard?.writeText?.(payload);
    }
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 1200);
  }
}

function renderTaskContextDebug(detail) {
  if (!taskContextDebugPanel || !taskContextDebugBody) return;
  const task = detail?.task ?? null;
  const html = task ? renderContextDebugPanel(task, {
    selectedLimit: state.contextDebugSelectedLimit,
    omittedLimit: state.contextDebugOmittedLimit
  }) : "";
  if (!html) {
    taskContextDebugBody.innerHTML = "";
    setTaskDetailPanelVisible("taskContextDebugPanel", false);
    return;
  }
  taskContextDebugBody.innerHTML = html;
  setTaskDetailPanelVisible("taskContextDebugPanel", true);
  for (const btn of taskContextDebugBody.querySelectorAll("[data-context-debug-copy]")) {
    btn.addEventListener("click", () => {
      void copySelectedTaskContextDebugJson(btn);
    });
  }
  for (const btn of taskContextDebugBody.querySelectorAll("[data-context-debug-more]")) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.contextDebugMore;
      if (target === "selected") {
        state.contextDebugSelectedLimit += 12;
      } else if (target === "omitted") {
        state.contextDebugOmittedLimit += 8;
      }
      renderTaskContextDebug(state.selectedTaskDetail);
    });
  }
}

function renderTaskDetail(detail) {
  if (!detail) {
    selectedTaskEventController.close();
    state.selectedTaskDetail = null;
    resetContextDebugPaging();
    taskDetailSummary.innerHTML = `
      <div class="task-empty-detail" role="status">
        <h2>Task runs are execution records<span class="zh">任务是执行记录</span></h2>
        <p class="muted">Chats and conversation history live in the Chat sidebar and Projects. Pick a task here only when you need logs, artifacts, recovery, retry, or cancel controls.</p>
        <div class="btn-group" style="margin-top:12px;">
          <button type="button" class="btn btn-sm btn-primary" data-task-empty-action="chat">Open Chat</button>
          <button type="button" class="btn btn-sm" data-task-empty-action="new-task">New task</button>
        </div>
      </div>
    `;
    taskDetailSummary.querySelector('[data-task-empty-action="chat"]')?.addEventListener("click", () => switchTab("chat"));
    taskDetailSummary.querySelector('[data-task-empty-action="new-task"]')?.addEventListener("click", () => {
      document.querySelector("#tasksNewBtn")?.click();
    });
    taskTimeline.innerHTML = "";
    setTaskDetailPanelVisible("taskSubtasksPanel", false);
    setTaskDetailPanelVisible("taskArtifactsPanel", false);
    setTaskDetailPanelVisible("taskTimelinePanel", false);
    setTaskDetailPanelVisible("taskContextDebugPanel", false);
    setTaskDetailPanelVisible("taskRecentConversationsPanel", false);
    renderTaskContextDebug(null);
    renderTaskArtifacts(null);
    renderTaskChildren(null);
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
  resetContextDebugPaging();
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
  const contentEvidenceBlock = renderTaskContentEvidence(detail);
  const evidenceSummaryBlock = renderTaskEvidenceSummary(detail);
  const llmUsageBlock = renderLlmUsagePanel(detail.events ?? []);
  const traceBlock = renderTaskTracePanel(detail.events ?? []);
  const subAgentTimelineBlock = renderSubAgentTimelinePanel({
    task,
    children: detail.children ?? [],
    events: detail.events ?? []
  });
  const reversibilityBlock = renderFileReversibilityPanel(detail.events ?? []);
  const conversationLinkBlock = renderTaskConversationLink(task);
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
  // C17: tokens replace cost as the primary usage signal in the KV
  // grid below. describeTaskTokens returns "<total> (<in> in / <out>
  // out)" when the breakdown is available, "<total>" when only the
  // total is known, and null when no usage data is available (so the
  // KV grid omits the cell rather than displaying a misleading 0).
  const tokensDisplay = describeTaskTokens(task);
  const modeDisplay = describeTaskMode(task);
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
      ${renderTaskKvGrid({ provider, model, executor: task.executor, source, retry: task.retry_count, tokens: tokensDisplay, duration, mode: modeDisplay, transport })}
      ${conversationLinkBlock}
      ${llmUsageBlock}
      ${traceBlock}
      ${subAgentTimelineBlock}
      ${reversibilityBlock}
      ${heroActions}
    </div>
    ${renderDowngradedWarning(downgraded)}
    ${failBlock}
    ${contentEvidenceBlock}
    ${resultSummaryBlock}
    ${evidenceSummaryBlock}
  `;
  for (const btn of taskDetailSummary.querySelectorAll("[data-parent-task-id]")) {
    btn.addEventListener("click", () => {
      state.selectedTaskId = btn.dataset.parentTaskId;
      renderTasks();
      void refreshTaskDetail({ showLoading: true });
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
  for (const btn of taskDetailSummary.querySelectorAll("[data-task-open-conversation]")) {
    btn.addEventListener("click", () => {
      const conversationId = btn.dataset.taskOpenConversation;
      if (!conversationId) return;
      void loadConsoleConversationFromBackend(conversationId);
    });
  }
  for (const btn of taskDetailSummary.querySelectorAll("[data-task-trace-copy]")) {
    btn.addEventListener("click", async () => {
      const traceJson = btn.dataset.traceJson ?? "";
      if (!traceJson) return;
      const previous = btn.textContent;
      btn.disabled = true;
      try {
        if (typeof consoleShellClient?.writeClipboardText === "function") {
          await consoleShellClient.writeClipboardText(traceJson);
        } else {
          await navigator.clipboard?.writeText?.(traceJson);
        }
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Copy failed";
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = previous;
        }, 1200);
      }
    });
  }
  for (const btn of taskDetailSummary.querySelectorAll("[data-file-reversibility-copy]")) {
    btn.addEventListener("click", async () => {
      const reversibilityJson = btn.dataset.reversibilityJson ?? "";
      if (!reversibilityJson) return;
      const previous = btn.textContent;
      btn.disabled = true;
      try {
        if (typeof consoleShellClient?.writeClipboardText === "function") {
          await consoleShellClient.writeClipboardText(reversibilityJson);
        } else {
          await navigator.clipboard?.writeText?.(reversibilityJson);
        }
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Copy failed";
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = previous;
        }, 1200);
      }
    });
  }
  for (const btn of taskDetailSummary.querySelectorAll("[data-file-reversibility-restore]")) {
    btn.addEventListener("click", async () => {
      const checkpointId = btn.dataset.fileReversibilityRestore ?? "";
      const taskId = state.selectedTaskId;
      if (!checkpointId || !taskId) return;
      const previous = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Restoring...";
      try {
        await restoreFileCheckpointViaShell(taskId, checkpointId);
        btn.textContent = "Restored";
        showConsoleToast("文件已恢复", { kind: "ok" });
        await refreshTaskDetail({ showLoading: true });
      } catch (error) {
        btn.textContent = "Restore failed";
        showConsoleToast(`恢复失败：${error.message}`, { kind: "err" });
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = previous;
        }, 1400);
      }
    });
  }
  wireEvidenceSourceActions(taskDetailSummary, consoleShellClient);
  renderTaskContextDebug(detail);
  const events = (detail.events ?? []).filter((ev) => {
    const payload = ev?.payload ?? ev?.data ?? {};
    return !(payload?.background === true || payload?.visibility === "diagnostic");
  });
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

async function refreshTaskDetail({ showLoading = false } = {}) {
  if (!state.selectedTaskId) {
    selectedTaskEventController.close();
    if (state.selectedTaskDetail || taskDetailSummary.innerHTML.trim()) {
      renderTaskDetail(null);
    }
    return;
  }
  const selectedTaskId = state.selectedTaskId;
  const currentDetailTaskId = state.selectedTaskDetail?.task?.task_id ?? null;
  const firstLoadForSelection = currentDetailTaskId !== selectedTaskId;
  const v = ++state.detailVersion;
  if (showLoading || firstLoadForSelection) {
    taskDetailSummary.innerHTML = `
      <div aria-label="Loading task details" role="status">
        <div class="skeleton skeleton-line wide"></div>
        <div class="skeleton skeleton-line mid"></div>
        <div class="skeleton skeleton-line narrow"></div>
      </div>
    `;
  }
  try {
    const detail = await consoleTaskClient.fetchTaskDetail(selectedTaskId);
    if (v !== state.detailVersion) return;
    selectedTaskEventController.ensure(selectedTaskId);
    if (shouldRenderWorkspaceSlice(`task.detail.${selectedTaskId}`, detail, {
      force: showLoading || firstLoadForSelection
    })) {
      renderTaskDetail(detail);
    }
  } catch (error) {
    if (v !== state.detailVersion) return;
    state.selectedTaskDetail = null;
    taskDetailSummary.innerHTML = `<p class="muted" style="font-size:12px;">Failed: ${escapeHtml(error.message)}</p>`;
    taskTimeline.innerHTML = "";
    renderTaskContextDebug(null);
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
            value = splitEmailFieldValue(value);
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

function splitEmailFieldValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const matches = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g);
  if (matches && matches.length > 0) {
    return [...new Set(matches.map((item) => item.trim()).filter(Boolean))];
  }
  return text.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);
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
  const rangeStart = new Date(cells[0] ?? now);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(cells.at(-1) ?? now);
  rangeEnd.setHours(23, 59, 59, 999);
  const occurrencesByDay = new Map();
  for (const occurrence of getScheduleOccurrencesForRange(schedules, rangeStart, rangeEnd)) {
    const key = localDateKey(occurrence.run_at);
    if (!key) continue;
    const bucket = occurrencesByDay.get(key) ?? [];
    bucket.push(occurrence);
    occurrencesByDay.set(key, bucket);
  }

  const gridCells = cells.map((day) => {
    const dayOccurrences = occurrencesByDay.get(localDateKey(day)) ?? [];
    const isToday = day.toDateString() === now.toDateString();
    const entries = dayOccurrences.slice(0, 3).map((occurrence) => {
      const s = occurrence.schedule;
      const color = s.color || s.metadata?.color || "var(--accent)";
      const runAt = new Date(occurrence.run_at);
      const time = Number.isNaN(runAt.getTime()) ? "" : runAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return `<div class="cal-entry" data-schedule-ref="${escapeHtml(s.schedule_id)}" style="border-left:3px solid ${escapeHtml(color)};padding:2px 4px;font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2);" title="${escapeHtml(s.name)} — ${escapeHtml(time)} — click to view">${escapeHtml(time ? `${time} ${s.name}` : s.name)}</div>`;
    }).join("");
    const overflow = dayOccurrences.length > 3 ? `<div style="font-size:9px;color:var(--muted);">+${dayOccurrences.length - 3} more</div>` : "";
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

function scheduleHasEditableEmailRecipients(schedule = {}) {
  if (!schedule) return false;
  if (scheduleRecipients(schedule).length > 0) return true;
  const groups = schedule.metadata?.side_effect_contract?.groups ?? schedule.action_params?.side_effect_contract?.groups ?? {};
  if (groups?.email_send) return true;
  return /(?:邮件|邮箱|email|mail|send).{0,80}@/i.test([
    schedule.name,
    schedule.description,
    schedule.action_target,
    schedule.action_params?.userCommand,
    schedule.action_params?.contextText,
    schedule.action_params?.command
  ].filter(Boolean).join("\n"));
}

function normalizeScheduleRecipientEditValue(value = "") {
  return uniqueScheduleEmails(String(value ?? "").split(/[,;，；\s]+/));
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
  const currentRecipients = scheduleRecipients(currentSchedule);
  const canEditRecipients = scheduleHasEditableEmailRecipients(currentSchedule);
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
        ${canEditRecipients ? `
          <label class="sched-row-edit-field">
            <span>收件人</span>
            <input type="text" class="sched-row-edit-recipients" value="${escapeHtml(currentRecipients.join(", "))}" placeholder="name@example.com, another@example.com"/>
          </label>
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
  const recipientsInput = metaEl?.querySelector(".sched-row-edit-recipients");
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
    const newRecipients = recipientsInput ? normalizeScheduleRecipientEditValue(recipientsInput.value) : currentRecipients;
    const pickerTrigger = readSchedulePicker(pickerRoot);
    if (!newName) { showConsoleToast("名称不能为空", { kind: "err" }); return; }
    if (commandInput && !newCommand) { showConsoleToast("执行内容不能为空", { kind: "err" }); return; }
    if (recipientsInput && newRecipients.length === 0) { showConsoleToast("收件人不能为空", { kind: "err" }); return; }
    const patch = {};
    if (newName !== currentName) patch.name = newName;
    if (commandInput && newCommand !== currentCommand) patch.userCommand = newCommand;
    if (recipientsInput && newRecipients.join("\n").toLowerCase() !== currentRecipients.join("\n").toLowerCase()) {
      patch.emailRecipients = newRecipients;
    }
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
      if (patch.emailRecipients) labels.push("收件人");
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
  const { filtered, groups } = groupSchedules(schedules, scheduleSearch);

  const groupSpec = [
    { key: "active",    label: "启用中", zh: "" },
    { key: "paused",    label: "已暂停", zh: "" },
    { key: "completed", label: "已完成", zh: "" }
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
              <span>${g.label}${g.zh ? `<span class="zh">${g.zh}</span>` : ""}</span>
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
            consoleShellClient?.showPopupCard?.({
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
      void refreshTaskDetail({ showLoading: true });
    });
  }
}

function buildTemplatePreviewLoadKey(templateId) {
  if (!templateId) return "";
  const item = (state.workspace.templates ?? []).find((template) => template.id === templateId) ?? { id: templateId };
  return stableWorkspaceSignature(item);
}

async function loadTemplatePreview(templateId, { force = false } = {}) {
  if (!templateId) {
    if (state.templatePreviewLoadKey !== "") {
      templatePreview.textContent = "Select a template.";
      state.templatePreviewLoadKey = "";
    }
    return;
  }
  const loadKey = buildTemplatePreviewLoadKey(templateId);
  if (!force && state.templatePreviewLoadKey === loadKey) return;
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
    state.templatePreviewLoadKey = loadKey;
  } catch (error) {
    templatePreview.textContent = `Failed: ${error.message}`;
  }
}

async function selectTemplate(templateId) {
  state.selectedTemplateId = templateId;
  renderTemplates();
  await loadTemplatePreview(templateId, { force: true });
}

function renderTemplates() {
  const templates = state.workspace.templates ?? [];
  templateCount.textContent = `${templates.length}`;
  if (templates.length === 0) {
    renderEmpty(templateList, "No templates.");
    state.selectedTemplateId = null;
    state.templatePreviewLoadKey = "";
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
  if (!budgetSummary) return;
  // C17/PMAT: tokens are the primary usage signal. The runtime may still
  // keep legacy monetary caps internally, but the user-facing Console shows
  // token movement only unless provider-owned cache-hit fields exist.
  const usage = workspaceTokenUsage();
  const totalIn = usage.input;
  const totalOut = usage.output;
  const total = usage.total || totalIn + totalOut;
  const hit = usage.cacheHit;
  const miss = usage.cacheMiss;
  const formatTokens = (n) => safeTokenNumber(Number(n)).toLocaleString("en-US");
  const entries = [
    { label: "Tokens this month", value: formatTokens(total), detail: "input + output" },
    { label: "Input tokens", value: formatTokens(totalIn), detail: `${total > 0 ? Math.round((totalIn / total) * 100) : 0}% of total` },
    { label: "Output tokens", value: formatTokens(totalOut), detail: `${total > 0 ? Math.round((totalOut / total) * 100) : 0}% of total` },
    { label: "Cache tokens", value: hit || miss ? `${formatTokens(hit)} hit / ${formatTokens(miss)} miss` : "Not reported", detail: hit || miss ? "provider cache trace" : "open a task detail when cache events are present" }
  ];
  budgetSummary.innerHTML = entries.map((entry) => `
    <div class="summary-tile usage-summary-tile">
      <span class="muted" style="font-size:11px;">${escapeHtml(entry.label)}</span>
      <strong>${escapeHtml(entry.value)}</strong>
      <span class="muted" style="font-size:11px;">${escapeHtml(entry.detail)}</span>
    </div>
  `).join("");
  if (budgetState) {
    budgetState.textContent = "Token usage is aggregated from task llm_usage records; price display is hidden.";
  }
  if (monthlyBudgetInput) monthlyBudgetInput.value = `${b.limits?.monthly_usd_limit ?? ""}`;
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
    renderChatSidebarProjectFilter();
    if (rerender) renderProjectsWorkspace();
  } catch {
    state.projectStore = state.projectStore ?? loadConsoleProjectStore();
  } finally {
    state.projectStoreSyncing = false;
  }
}

let projectWorkspaceProjectId = null;
let projectWorkspaceStatus = "idle";
let projectWorkspaceDetail = null;
const projectWorkspaceCache = new Map();

function toProjectConversationSummary(conversation = {}) {
  const id = conversation.conversation_id ?? conversation.id ?? "";
  return {
    id,
    conversation_id: id,
    projectId: conversation.project_id ?? conversation.projectId ?? null,
    title: conversation.title ?? null,
    seedCommand: conversation.title ?? id,
    updatedAt: conversation.updated_at ?? conversation.updatedAt ?? conversation.created_at ?? null,
    startedAt: conversation.created_at ?? conversation.startedAt ?? null,
    messageCount: conversation.message_count ?? conversation.messageCount ?? 0,
    taskCount: conversation.task_count ?? conversation.taskCount ?? 0,
    turns: []
  };
}

function legacyProjectConversations(store, projectId) {
  return (store.conversations ?? [])
    .filter((conversation) => conversation.projectId === projectId)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function currentProjectConversations(store, projectId) {
  if (projectWorkspaceProjectId === projectId && projectWorkspaceStatus === "ready") {
    return (projectWorkspaceDetail?.conversations ?? []).map(toProjectConversationSummary);
  }
  if (projectWorkspaceProjectId === projectId
      && projectWorkspaceStatus === "loading"
      && Array.isArray(projectWorkspaceDetail?.conversations)
      && projectWorkspaceDetail.conversations.length > 0) {
    return projectWorkspaceDetail.conversations.map(toProjectConversationSummary);
  }
  return legacyProjectConversations(store, projectId);
}

function currentProjectArtifacts(projectId) {
  if (projectWorkspaceProjectId === projectId && projectWorkspaceStatus === "ready") {
    return projectWorkspaceDetail?.artifacts ?? [];
  }
  if (projectWorkspaceProjectId === projectId
      && projectWorkspaceStatus === "loading"
      && Array.isArray(projectWorkspaceDetail?.artifacts)
      && projectWorkspaceDetail.artifacts.length > 0) {
    return projectWorkspaceDetail.artifacts;
  }
  return [];
}

function currentProjectMessageFiles(projectId) {
  if (projectWorkspaceProjectId === projectId && projectWorkspaceStatus === "ready") {
    return projectWorkspaceDetail?.message_files ?? [];
  }
  if (projectWorkspaceProjectId === projectId
      && projectWorkspaceStatus === "loading"
      && Array.isArray(projectWorkspaceDetail?.message_files)
      && projectWorkspaceDetail.message_files.length > 0) {
    return projectWorkspaceDetail.message_files;
  }
  return projectWorkspaceCache.get(projectId)?.message_files ?? [];
}

function currentProjectFiles(projectId, fallbackPaths = []) {
  const workspaceFiles = projectWorkspaceProjectId === projectId
    ? projectWorkspaceDetail?.files
    : projectWorkspaceCache.get(projectId)?.files;
  if (Array.isArray(workspaceFiles) && workspaceFiles.length > 0) return workspaceFiles;
  return Array.isArray(fallbackPaths) ? fallbackPaths : [];
}

function normalizeProjectWorkspacePayload(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  return {
    ...payload,
    conversations: Array.isArray(payload.conversations) ? payload.conversations : [],
    files: Array.isArray(payload.files) ? payload.files : [],
    message_files: Array.isArray(payload.message_files) ? payload.message_files : [],
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
    stats: payload.stats && typeof payload.stats === "object" ? payload.stats : {}
  };
}

async function refreshProjectWorkspace(projectId, { force = false } = {}) {
  if (!projectId) return;
  if (!force && projectWorkspaceProjectId === projectId && projectWorkspaceStatus === "ready") return;
  const cached = projectWorkspaceCache.get(projectId) ?? null;
  projectWorkspaceProjectId = projectId;
  projectWorkspaceStatus = "loading";
  projectWorkspaceDetail = cached;
  try {
    const payload = await fetchJson(`/projects/${encodeURIComponent(projectId)}/workspace`);
    const workspace = normalizeProjectWorkspacePayload(payload);
    if (projectWorkspaceProjectId !== projectId) return;
    projectWorkspaceDetail = workspace;
    if (workspace) projectWorkspaceCache.set(projectId, workspace);
    projectWorkspaceStatus = "ready";
  } catch {
    if (projectWorkspaceProjectId !== projectId) return;
    projectWorkspaceStatus = cached ? "ready" : "error";
    projectWorkspaceDetail = cached;
  }
  renderProjectsWorkspace({ skipFetch: true });
  if (projectId === getConsoleChatSubmitProjectId()) {
    renderConsoleChatArtifacts(consoleChatArtifactItems);
  }
}

function renderProjectsWorkspace({ skipFetch = false } = {}) {
  if (!projectList || !projectConversationList) return;
  const store = state.projectStore ?? loadConsoleProjectStore();
  state.projectStore = store;
  const projects = store.projects ?? [];
  if (!state.selectedProjectId || !projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = store.currentProjectId || projects[0]?.id || DEFAULT_PROJECT_ID;
  }
  const selectedProject = projects.find((project) => project.id === state.selectedProjectId) ?? projects[0] ?? null;
  if (selectedProject?.id && !skipFetch) {
    void refreshProjectWorkspace(selectedProject.id);
  }
  const conversations = currentProjectConversations(store, selectedProject?.id);
  const projectArtifacts = currentProjectArtifacts(selectedProject?.id);
  const projectMessageFiles = currentProjectMessageFiles(selectedProject?.id);
  const attachedProjectFilePaths = currentProjectFiles(
    selectedProject?.id,
    Array.isArray(selectedProject?.attachedFilePaths) ? selectedProject.attachedFilePaths : []
  );
  if (!state.selectedProjectConversationId || !conversations.some((conversation) => conversation.id === state.selectedProjectConversationId)) {
    state.selectedProjectConversationId = conversations[0]?.id ?? null;
  }
  const selectedConversation = conversations.find((conversation) => conversation.id === state.selectedProjectConversationId) ?? null;
  if (projectAttachFilesBtn) {
    const canAttachFiles = Boolean(selectedProject?.id && selectedProject.id !== DEFAULT_PROJECT_ID);
    projectAttachFilesBtn.disabled = !canAttachFiles;
    projectAttachFilesBtn.title = canAttachFiles
      ? "Add local files or folders to this project"
      : "Create or select a non-default project before adding files";
  }
  if (projectStartChatBtn) {
    projectStartChatBtn.disabled = !selectedProject?.id;
    projectStartChatBtn.title = selectedProject?.id
      ? `Start a new chat in ${selectedProject.name ?? selectedProject.id}`
      : "Select a project before starting a chat";
  }
  if (projectOpenChatBtn) {
    projectOpenChatBtn.disabled = !selectedProject?.id;
    projectOpenChatBtn.title = selectedProject?.id
      ? `Open ${selectedProject.name ?? selectedProject.id} in Chat`
      : "Select a project before opening Chat";
  }
  if (projectRefreshBtn) {
    projectRefreshBtn.disabled = !selectedProject?.id || projectWorkspaceStatus === "loading";
  }
  if (projectWorkspaceSummary) {
    const workspace = selectedProject?.id === projectWorkspaceProjectId
      ? projectWorkspaceDetail
      : projectWorkspaceCache.get(selectedProject?.id);
    setHtmlIfChanged(projectWorkspaceSummary, renderProjectWorkspaceSummaryHtml({
      project: selectedProject,
      workspace,
      status: selectedProject?.id === projectWorkspaceProjectId ? projectWorkspaceStatus : "idle"
    }));
  }
  if (projectInstructionsInput) {
    const instructions = selectedProject?.metadata?.instructions ?? selectedProject?.metadata?.projectInstructions ?? "";
    if (document.activeElement !== projectInstructionsInput && projectInstructionsInput.value !== instructions) {
      projectInstructionsInput.value = instructions;
    }
    projectInstructionsInput.disabled = !selectedProject?.id;
  }
  if (projectInstructionsState && projectWorkspaceStatus === "error") {
    projectInstructionsState.textContent = "Workspace sync failed; showing cached project data.";
  } else if (projectInstructionsState && projectInstructionsState.textContent === "Workspace sync failed; showing cached project data.") {
    projectInstructionsState.textContent = "";
  }

  projectCount.textContent = `${projects.length}`;
  projectConversationCount.textContent = `${conversations.length}`;
  if (projectArtifactCount) {
    projectArtifactCount.textContent = `${projectArtifacts.length + projectMessageFiles.length + attachedProjectFilePaths.length}`;
  }
  if (projectConversationPreview) projectConversationPreview.textContent = "";
  const projectListConversationCounts = [
    ...(store.conversations ?? []).filter((conversation) => conversation.projectId !== selectedProject?.id),
    ...conversations.map((conversation) => ({
      ...conversation,
      projectId: selectedProject?.id
    }))
  ];

  projectList.innerHTML = renderProjectListHtml({
    projects,
    conversations: projectListConversationCounts,
    selectedProjectId: selectedProject?.id,
    defaultColor: PROJECT_COLORS[0],
    workspaceByProjectId: Object.fromEntries(projectWorkspaceCache.entries())
  });

  projectConversationList.innerHTML = renderProjectConversationListHtml({
    conversations,
    selectedConversationId: selectedConversation?.id
  });
  if (projectArtifactList) {
    const artifactLoading = projectWorkspaceStatus === "loading"
      && selectedProject?.id === projectWorkspaceProjectId
      && projectArtifacts.length === 0
      && projectMessageFiles.length === 0
      && attachedProjectFilePaths.length === 0;
    const artifactHtml = artifactLoading
      ? `<p class="muted" style="font-size:12px;">Loading files...</p>`
      : renderProjectArtifactListHtml({
        artifacts: projectArtifacts,
        attachedFilePaths: attachedProjectFilePaths,
        messageFiles: projectMessageFiles,
        projectId: selectedProject?.id ?? null,
        labelForPath: formatArtifactLabel
      });
    setHtmlIfChanged(projectArtifactList, artifactHtml);
  }

  for (const btn of projectList.querySelectorAll("[data-project-id]")) {
    btn.addEventListener("click", () => {
      state.selectedProjectId = btn.dataset.projectId;
      state.selectedProjectConversationId = null;
      projectWorkspaceProjectId = null;
      projectWorkspaceStatus = "idle";
      projectWorkspaceDetail = null;
      store.currentProjectId = state.selectedProjectId;
      store.currentConversationId = null;
      saveConsoleProjectStore(store);
      renderProjectsWorkspace();
      renderChatSidebarProjectFilter();
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
  if (!formatsEl.innerHTML.trim()) {
    formatsEl.innerHTML = `<div class="muted" style="font-size:12px;">Loading…</div>`;
  }
  try {
    const status = await fetchJson("/preview/status");
    const formats = status.providers ?? [];
    setHtmlIfChanged(formatsEl, formats.length
      ? formats.map((p) => `
        <div class="row" style="justify-content:space-between;font-size:12px;padding:4px 0;">
          <span><strong>${escapeHtml(p.id)}</strong> <span class="muted">(${(p.extensions ?? []).join(" ")})</span></span>
          <span class="muted">priority ${p.priority}</span>
        </div>`).join("")
      : `<div class="muted" style="font-size:12px;">无已注册的 Provider。</div>`);

    setHtmlIfChanged(strategyEl, `
      <div>生成的 Office 文件优先使用 sidecar HTML 预览。</div>
      <div>外部 docx / xlsx / pdf 使用各自 provider；外部 pptx 使用坐标解析预览。</div>`);

    const m = status.metrics ?? {};
    const hitRate = m.renders > 0 ? ((m.cacheHits / m.renders) * 100).toFixed(1) : "—";
    const byProvider = m.byProvider ?? {};
    setHtmlIfChanged(metricsEl, `
      <div>总渲染次数: ${m.renders ?? 0}</div>
      <div>缓存命中: ${m.cacheHits ?? 0} · 命中率 ${hitRate}${typeof hitRate === "string" && hitRate !== "—" ? "%" : ""}</div>
      <div style="margin-top:6px;">${Object.entries(byProvider).map(([id, stats]) =>
        `<div>• ${escapeHtml(id)}: ${stats.hits} 次 · 平均 ${stats.hits > 0 ? (stats.renderMs / Math.max(1, stats.hits - stats.cacheHits)).toFixed(0) : "—"} ms · ${stats.errors ?? 0} 错误</div>`
      ).join("") || '<span class="muted">暂无指标。</span>'}</div>`);

    const cache = status.cache ?? {};
    setHtmlIfChanged(cacheEl, `
      <div>路径: <code style="font-size:11px;">${escapeHtml(cache.dir ?? "—")}</code></div>
      <div>${cache.files ?? 0} 个缓存文件 · ${formatBytesSimple(cache.bytes ?? 0)}</div>`);
  } catch (error) {
    setHtmlIfChanged(formatsEl, `<div class="muted" style="font-size:12px;color:#b45309;">运行时未就绪: ${escapeHtml(error.message)}</div>`);
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
  if (!listEl.innerHTML.trim()) {
    listEl.innerHTML = `<div class="muted" style="font-size:12px;">Loading…</div>`;
  }
  try {
    const resp = await consoleTaskClient.fetchFailedTasks();
    const items = resp.failed ?? [];
    if (items.length === 0) {
      setHtmlIfChanged(listEl, `<div class="muted" style="font-size:12px;">最近没有失败任务。</div>`);
      return;
    }
    const changed = setHtmlIfChanged(listEl, items.map((t) => `
      <div class="surface" style="padding:8px 10px;cursor:pointer;" data-failed-task="${escapeHtml(t.task_id)}">
        <div class="row" style="justify-content:space-between;gap:8px;">
          <strong style="font-size:12px;">${escapeHtml(t.task_id.slice(0, 28))}</strong>
          <span class="muted" style="font-size:11px;">${escapeHtml(formatDateTime(t.updated_at ?? t.created_at))}</span>
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:3px;">${escapeHtml((t.user_command ?? "").slice(0, 140))}</div>
        ${t.failure_user_message ? `<div style="font-size:11px;margin-top:4px;color:#b45309;">${escapeHtml(String(t.failure_user_message).slice(0, 240))}</div>` : ""}
      </div>`).join(""));
    if (!changed) return;
    for (const row of listEl.querySelectorAll("[data-failed-task]")) {
      row.addEventListener("click", async () => {
        const taskId = row.dataset.failedTask;
        if (!taskId || !viewerEl) return;
        viewerEl.style.display = "block";
        viewerEl.textContent = `加载 ${taskId} 事件流…`;
        try {
          const log = await consoleTaskClient.fetchTaskLog(taskId);
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
    setHtmlIfChanged(listEl, `<div class="muted" style="font-size:12px;color:#b45309;">加载失败：${escapeHtml(error.message)}</div>`);
  }
}

document.getElementById("failedTasksRefreshBtn")?.addEventListener("click", () => {
  void renderFailedTasks();
});

function renderTrashItem({ kind, id, title, deletedAt, restoreUntil }) {
  const kindLabel = kind === "task" ? "Task" : "Note";
  const restoreAttr = kind === "task" ? "data-trash-restore-task" : "data-trash-restore-note";
  return `
    <div class="surface" style="padding:8px 10px;">
      <div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start;">
        <div style="min-width:0;">
          <div class="row" style="gap:6px;">
            <span class="tag">${kindLabel}</span>
            <strong style="font-size:12px;overflow-wrap:anywhere;">${escapeHtml(title || id)}</strong>
          </div>
          <div class="muted" style="font-size:11px;margin-top:4px;">
            Deleted ${escapeHtml(formatDateTime(deletedAt))}
            ${restoreUntil ? ` · Restore until ${escapeHtml(formatDateTime(restoreUntil))}` : ""}
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" type="button" ${restoreAttr}="${escapeHtml(id)}">Restore</button>
      </div>
    </div>
  `;
}

async function renderTrashList() {
  if (!trashList) return;
  if (trashState && !trashList.innerHTML.trim()) trashState.textContent = "Loading Trash...";
  try {
    const [tasksPayload, notesPayload] = await Promise.all([
      consoleTaskClient.fetchDeletedTasks(),
      fetchJson("/notes?deleted=only")
    ]);
    const taskItems = (tasksPayload.tasks ?? []).map((task) => ({
      kind: "task",
      id: task.task_id,
      title: task.user_command,
      deletedAt: task.deleted_at,
      restoreUntil: task.restore_until
    }));
    const noteItems = (notesPayload.notes ?? []).map((note) => ({
      kind: "note",
      id: note.id,
      title: note.title || stripTags(note.body_html || "").slice(0, 80),
      deletedAt: note.deleted_at,
      restoreUntil: note.restore_until
    }));
    const items = [...taskItems, ...noteItems]
      .sort((left, right) => `${right.deletedAt ?? ""}`.localeCompare(`${left.deletedAt ?? ""}`));
    if (trashState) trashState.textContent = `${items.length} deleted item${items.length === 1 ? "" : "s"}.`;
    if (items.length === 0) {
      setHtmlIfChanged(trashList, `<div class="muted" style="font-size:12px;">Trash is empty.</div>`);
      return;
    }
    const changed = setHtmlIfChanged(trashList, items.map(renderTrashItem).join(""));
    if (!changed) return;
    for (const button of trashList.querySelectorAll("[data-trash-restore-task]")) {
      button.addEventListener("click", async () => {
        const taskId = button.getAttribute("data-trash-restore-task");
        if (!taskId) return;
        button.disabled = true;
        try {
          await restoreTaskViaShell(taskId);
          showConsoleToast("任务已恢复", { kind: "ok" });
          await refreshWorkspace();
          await renderTrashList();
        } catch (error) {
          showConsoleToast(`恢复失败：${error.message}`, { kind: "err" });
          button.disabled = false;
        }
      });
    }
    for (const button of trashList.querySelectorAll("[data-trash-restore-note]")) {
      button.addEventListener("click", async () => {
        const noteId = button.getAttribute("data-trash-restore-note");
        if (!noteId) return;
        button.disabled = true;
        try {
          await restoreNoteViaShell(noteId);
          try { window.lingxyNotes?.refresh?.({ preserveSelection: true }); } catch { /* ignore */ }
          showConsoleToast("笔记已恢复", { kind: "ok" });
          await renderTrashList();
        } catch (error) {
          showConsoleToast(`恢复失败：${error.message}`, { kind: "err" });
          button.disabled = false;
        }
      });
    }
  } catch (error) {
    if (trashState) trashState.textContent = `Failed: ${error.message}`;
    setHtmlIfChanged(trashList, `<div class="muted" style="font-size:12px;color:#b45309;">Failed: ${escapeHtml(error.message)}</div>`);
  }
}

trashRefreshBtn?.addEventListener("click", () => {
  void renderTrashList();
});

async function updateSecurityConfig(patch, label) {
  privacyState.textContent = `Updating ${label}...`;
  state.updatingSecurity = true;
  renderPrivacy();
  try {
    if (typeof consoleShellClient?.updateSecurityState !== "function") {
      throw new Error("Desktop security settings bridge unavailable.");
    }
    const payload = assertShellResult(
      await consoleShellClient.updateSecurityState(patch),
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

function runtimeLabsChipClass(status = "") {
  if (status === "enabled" || status === "framework_complete") return "ready";
  if (status === "available") return "muted";
  if (status === "deferred" || status === "evidence_gated" || status === "needs_endpoint") return "warning";
  return "muted";
}

function renderRuntimeLabsPanel() {
  const list = document.getElementById("runtimeLabsList");
  const stateLabel = document.getElementById("runtimeLabsState");
  if (!list) return;
  const runtimeLabs = state.workspace?.runtimeLabs ?? null;
  const capabilities = Array.isArray(runtimeLabs?.capabilities) ? runtimeLabs.capabilities : [];
  if (!runtimeLabs || capabilities.length === 0) {
    list.innerHTML = `<div class="muted" style="font-size:12px;">Runtime Labs status is not available yet.</div>`;
    if (stateLabel) stateLabel.textContent = "";
    return;
  }

  const toggleableCount = capabilities.filter((entry) => entry.userToggle === true).length;
  const enabledCount = capabilities.filter((entry) => entry.enabled === true).length;
  if (stateLabel) stateLabel.textContent = `${enabledCount} active · ${toggleableCount} configurable`;

  list.innerHTML = capabilities.map((entry) => {
    const status = entry.status ?? (entry.enabled ? "enabled" : "available");
    const disabled = entry.userToggle !== true;
    const checked = entry.enabled === true;
    const evidence = Array.isArray(entry.evidence) && entry.evidence.length > 0
      ? `<div class="muted" style="font-size:11px;margin-top:6px;overflow-wrap:anywhere;">evidence: ${escapeHtml(entry.evidence.slice(0, 3).join(" · "))}</div>`
      : "";
    const blocked = entry.blockedReason
      ? `<div class="muted" style="font-size:11px;margin-top:6px;color:#b45309;overflow-wrap:anywhere;">${escapeHtml(entry.blockedReason)}</div>`
      : "";
    const nextGate = entry.nextGate
      ? `<div class="muted" style="font-size:11px;margin-top:4px;overflow-wrap:anywhere;">next: ${escapeHtml(entry.nextGate)}</div>`
      : "";
    const networkOtelControls = entry.id === "network_otel_export"
      ? `
          <div style="margin-top:8px;display:grid;gap:6px;">
            <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);" for="runtimeLabsNetworkOtelEndpoint">OTLP HTTP endpoint</label>
            <input id="runtimeLabsNetworkOtelEndpoint" data-runtime-labs-network-otel-endpoint type="url" placeholder="https://otel.example.com/v1/traces" value="${escapeHtml(entry.settings?.endpoint ?? "")}" ${disabled ? "disabled" : ""}>
            <div class="muted" style="font-size:11px;overflow-wrap:anywhere;">redaction: ${escapeHtml(entry.settings?.redaction ?? "summary_only_no_raw_payloads")} · queue: ${escapeHtml(entry.settings?.queueDepth ?? 0)} · exported spans: ${escapeHtml(entry.settings?.exportedSpans ?? 0)}</div>
            ${entry.settings?.lastError ? `<div class="muted" style="font-size:11px;color:#b45309;overflow-wrap:anywhere;">last error: ${escapeHtml(entry.settings.lastError)}</div>` : ""}
          </div>
        `
      : "";
    return `
      <div class="switch-row" style="display:flex;gap:10px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface-strong);cursor:${disabled ? "default" : "pointer"};">
        <input type="checkbox" class="switch-control" data-runtime-labs-toggle="${escapeHtml(entry.id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <strong style="font-size:13px;">${escapeHtml(entry.label ?? entry.id)}</strong>
            <span class="chip ${runtimeLabsChipClass(status)}">${escapeHtml(status)}</span>
          </div>
          <div class="muted" style="font-size:11px;margin-top:4px;overflow-wrap:anywhere;">${escapeHtml(entry.summary ?? "")}</div>
          ${entry.configPath ? `<div class="muted" style="font-size:11px;margin-top:4px;">config: ${escapeHtml(entry.configPath)}</div>` : ""}
          ${evidence}
          ${blocked}
          ${nextGate}
          ${networkOtelControls}
        </div>
      </div>
    `;
  }).join("");
}

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

document.getElementById("saveRuntimeLabsBtn")?.addEventListener("click", async () => {
  const stateLabel = document.getElementById("runtimeLabsState");
  const patch = {};
  for (const input of document.querySelectorAll("[data-runtime-labs-toggle]")) {
    if (input.disabled) continue;
    if (input.dataset.runtimeLabsToggle === "model_role_routing") {
      patch.modelRoleRouting = { enabled: input.checked };
    }
    if (input.dataset.runtimeLabsToggle === "final_answer_reviewer") {
      patch.finalAnswerReviewer = { enabled: input.checked };
    }
    if (input.dataset.runtimeLabsToggle === "network_otel_export") {
      const endpoint = document.querySelector("[data-runtime-labs-network-otel-endpoint]")?.value?.trim() ?? "";
      patch.networkOtel = {
        enabled: input.checked,
        consentAccepted: input.checked,
        endpoint
      };
    }
  }
  try {
    const result = await updateRuntimeLabsConfigViaShell(patch);
    state.workspace.runtimeLabs = result.runtimeLabs ?? state.workspace.runtimeLabs;
    state.workspace.modelRoles = result.modelRoles ?? state.workspace.modelRoles;
    renderRuntimeLabsPanel();
    renderModelRoleManagementSurface();
    if (stateLabel) stateLabel.textContent = "Saved.";
  } catch (error) {
    if (stateLabel) stateLabel.textContent = `Failed: ${error.message}`;
  }
});

/* ═══════════════════════════════════════════════
   WORKSPACE REFRESH
   ═══════════════════════════════════════════════ */

async function renderWorkspaceAfterFetch({ mode = "full", activeTabId = currentConsoleTabId() } = {}) {
  const full = mode === "full";
  const isActive = (tabId) => full || activeTabId === tabId;
  const renderIfChanged = (key, value, render) => {
    if (shouldRenderWorkspaceSlice(key, value, { force: full })) render();
  };

  renderIfChanged("summary", {
    tasks: state.workspace.tasks,
    budget: state.workspace.budget
  }, renderSummary);

  if (isActive("tasks")) {
    renderIfChanged("tasks.onboarding", {
      health: state.workspace.health,
      providers: state.workspace.providers,
      codeCliAdapters: state.workspace.codeCliAdapters,
      tasks: state.workspace.tasks
    }, renderOnboarding);
    renderIfChanged("tasks.integrations", {
      health: state.workspace.health,
      providers: state.workspace.providers,
      codeCliAdapters: state.workspace.codeCliAdapters,
      mcpServers: state.workspace.mcpServers,
      emailAccounts: state.workspace.emailAccounts
    }, renderIntegrations);
    renderIfChanged("tasks.list", {
      tasks: state.workspace.tasks,
      taskFilter: state.taskFilter,
      taskSearch: state.taskSearch,
      taskDateFilter: state.taskDateFilter,
      taskSourceFilter: state.taskSourceFilter,
      selectedTaskId: state.selectedTaskId
    }, renderTasks);
  }

  if (isActive("schedules")) {
    renderIfChanged("schedules.approvals", state.workspace.approvals, renderApprovals);
    renderIfChanged("schedules.list", state.workspace.schedules, renderSchedules);
  }

  if (isActive("settings")) {
    renderIfChanged("settings.providerOnboarding", state.workspace.onboarding, renderProviderOnboardingSuggestions);
    renderIfChanged("settings.modelRoles", state.workspace.modelRoles, renderModelRoleManagementSurface);
    renderIfChanged("settings.runtimeLabs", state.workspace.runtimeLabs, renderRuntimeLabsPanel);
    renderIfChanged("settings.userMemory", state.workspace.userMemory, renderUserMemorySettings);
    renderIfChanged("settings.templates", state.workspace.templates, renderTemplates);
    renderIfChanged("settings.dag", state.workspace.dagExecutions, renderDagExecutions);
    renderIfChanged("settings.budget", state.workspace.budget, renderBudget);
    renderIfChanged("settings.privacy", state.workspace.security, renderPrivacy);
    renderIfChanged("settings.audit", state.workspace.audit, renderAudit);
    renderIfChanged("settings.mcp", state.workspace.mcpServers, renderMcpServers);
    renderIfChanged("settings.skills", {
      skills: state.workspace.skills,
      skillRegistries: state.workspace.skillRegistries
    }, renderSkillRegistries);
    renderIfChanged("settings.marketplace", {
      skills: state.workspace.skills,
      mcpServers: state.workspace.mcpServers,
      plugins: state.workspace.plugins
    }, renderMarketplaceManagement);
    renderIfChanged("settings.codeCli", state.workspace.codeCliAdapters, renderCodeCliAdapters);
    renderIfChanged("settings.emailAccounts", state.workspace.emailAccounts, renderEmailAccounts);
    renderIfChanged("settings.emailDigest", state.workspace.emailDigestSettings, renderEmailDigestSettings);
    renderIfChanged("settings.features", state.workspace.health?.config?.features ?? {}, renderFeatureToggles);
    renderIfChanged("settings.output", state.workspace.health?.config?.output ?? {}, renderOutputDir);
    void loadEchoDiagnostics();
    void renderPreviewSettings();
    void renderFailedTasks();
    void renderTrashList();
  }

  if (isActive("projects")) {
    renderIfChanged("projects.local", state.projectStore, renderProjectsWorkspace);
    void syncConsoleProjectStoreFromService({ rerender: true });
  }

  if (isActive("files")) {
    void loadAllArtifacts();
  }

  const followUps = [];
  if (isActive("tasks")) followUps.push(refreshTaskDetail());
  if (isActive("settings")) followUps.push(loadTemplatePreview(state.selectedTemplateId));
  if (followUps.length > 0) await Promise.all(followUps);
}

let refreshWorkspaceInFlight = null;

async function refreshWorkspace(options = {}) {
  if (refreshWorkspaceInFlight) return refreshWorkspaceInFlight;
  const mode = options.mode ?? "full";
  refreshWorkspaceInFlight = (async () => {
    try {
      const shell = typeof consoleShellClient?.getShellStatus === "function"
        ? await consoleShellClient.getShellStatus()
        : { serviceBaseUrl: state.serviceBaseUrl };
      state.serviceBaseUrl = shell.serviceBaseUrl ?? state.serviceBaseUrl;
      const activeTabId = currentConsoleTabId();
      const shouldLoadSettingsHeavyData = activeTabId === "settings";

      const previous = state.workspace ?? {};
      const [health, tasksP, approvalsP, schedulesP, templatesP, budgetP, securityP, auditP, dagP, providersP, cliP, capabilityInventoryP, mcpP, skillsP, pluginsP, integrationsP, emailP, emailSettingsP] = await Promise.all([
        fetchJsonWithFallback("/health", previous.health ?? {}, "health"),
        fetchClientJsonWithFallback(() => consoleTaskClient.fetchTaskSummaries({
          limit: activeTabId === "tasks" ? "all" : 240
        }), { tasks: previous.tasks ?? [] }, "tasks"),
        fetchJsonWithFallback("/approvals", { approvals: previous.approvals ?? [] }, "approvals"),
        fetchJsonWithFallback("/schedules", { schedules: previous.schedules ?? [] }, "schedules"),
        fetchJsonWithFallback("/templates", { templates: previous.templates ?? [] }, "templates"),
        fetchJsonWithFallback("/budget", { budget: previous.budget ?? null }, "budget"),
        fetchJsonWithFallback("/security/state", { security: previous.security ?? null }, "security"),
        shouldLoadSettingsHeavyData
          ? fetchJsonWithFallback("/audit-log", { entries: previous.audit ?? [] }, "audit-log")
          : Promise.resolve({ entries: previous.audit ?? [] }),
        fetchJsonWithFallback("/dag/executions", { executions: previous.dagExecutions ?? [] }, "dag-executions"),
        fetchJsonWithFallback("/ai/providers", { providers: previous.providers ?? [] }, "ai-providers"),
        fetchJsonWithFallback("/ai/code-cli", { adapters: previous.codeCliAdapters ?? [] }, "code-cli"),
        fetchJsonWithFallback("/capabilities/inventory", { inventory: previous.capabilityInventory ?? null }, "capability-inventory"),
        fetchJsonWithFallback("/ai/mcp", { servers: previous.mcpServers ?? [] }, "mcp"),
        fetchJsonWithFallback("/ai/skills", { registries: previous.skillRegistries ?? [], skills: previous.skills ?? [] }, "skills"),
        fetchJsonWithFallback("/plugins", { plugins: previous.plugins ?? [] }, "plugins"),
        fetchJsonWithFallback("/config/integrations", { onboarding: previous.onboarding ?? { pendingSuggestions: [], archivedSuggestions: [] } }, "integrations"),
        fetchJsonWithFallback("/config/email/accounts", { accounts: previous.emailAccounts ?? [] }, "email-accounts"),
        fetchJsonWithFallback("/config/email/settings", { settings: previous.emailDigestSettings ?? {} }, "email-settings")
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
        capabilityInventory: capabilityInventoryP.inventory ?? previous.capabilityInventory ?? null,
        mcpServers: mcpP.servers ?? [],
        skillRegistries: skillsP.registries ?? [],
        skills: skillsP.skills ?? [],
        plugins: pluginsP.plugins ?? [],
        onboarding: integrationsP.onboarding ?? { pendingSuggestions: [], archivedSuggestions: [] },
        providerSetup: integrationsP.providerSetup ?? null,
        modelRoles: integrationsP.modelRoles ?? previous.modelRoles ?? null,
        runtimeLabs: integrationsP.runtimeLabs ?? previous.runtimeLabs ?? null,
        userMemory: integrationsP.userMemory ?? previous.userMemory ?? null,
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
      renderConsoleChatHeader();
      await renderWorkspaceAfterFetch({ mode, activeTabId });
    } catch (error) {
      setRuntimeBadge(false, `Unavailable · ${error.message}`);
    } finally {
      refreshWorkspaceInFlight = null;
    }
  })();
  return refreshWorkspaceInFlight;
}

/* ═══════════════════════════════════════════════
   EVENT BINDINGS
   ═══════════════════════════════════════════════ */

taskComposer.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitState.textContent = "Submitting...";
  try {
    const result = await consoleSubmissionClient.submitTask(withConsoleLocaleMetadata({
      sourceApp: "uca.console.desktop",
      captureMode: "desktop_console",
      sourceType: "clipboard",
      text: "",
      userCommand: commandInput.value || "Process this text",
      executionMode: "interactive"
    }));
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

function syncTaskDateFilterUi() {
  const selected = state.taskDateFilter ?? "all";
  const select = document.querySelector("#taskTimeRangeSelect");
  if (select && select.value !== selected) select.value = selected;
  for (const chip of document.querySelectorAll("#taskDateFilterChips .filter-chip")) {
    chip.setAttribute("aria-pressed", (chip.dataset.date ?? "all") === selected ? "true" : "false");
  }
  updateTasksAdvFilterBadge();
}

document.querySelector("#taskTimeRangeSelect")?.addEventListener("change", (event) => {
  state.taskDateFilter = event.target?.value ?? "all";
  syncTaskDateFilterUi();
  renderTasks();
});

// UCA-121: date filter chips (All / Today / 7d / 30d).
for (const chip of document.querySelectorAll("#taskDateFilterChips .filter-chip")) {
  chip.addEventListener("click", () => {
    state.taskDateFilter = chip.dataset.date ?? "all";
    syncTaskDateFilterUi();
    renderTasks();
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

let consoleUpdaterStatus = null;
let consoleUpdaterBusy = false;

function updateVersionLabel(info) {
  return info?.version ? `LingxY ${info.version}` : "新版本";
}

function setConsoleUpdaterBusy(busy) {
  consoleUpdaterBusy = Boolean(busy);
  if (!consoleUpdateButton) return;
  consoleUpdateButton.disabled = consoleUpdaterBusy || consoleUpdaterStatus?.available === false;
  consoleUpdateButton.dataset.busy = consoleUpdaterBusy ? "1" : "0";
}

function renderConsoleUpdaterStatus(status = {}) {
  consoleUpdaterStatus = status;
  if (!consoleUpdateButton) return;
  if (status.available === false) {
    consoleUpdateButton.disabled = true;
    consoleUpdateButton.title = "当前环境不支持自动更新";
    if (consoleUpdateDot) consoleUpdateDot.hidden = true;
    return;
  }
  const downloaded = status.downloaded ?? null;
  const available = status.available ?? null;
  const busy = consoleUpdaterBusy || status.pending || status.downloading;
  consoleUpdateButton.disabled = Boolean(consoleUpdaterBusy);
  consoleUpdateButton.dataset.busy = busy ? "1" : "0";
  if (downloaded) {
    consoleUpdateButton.title = `${updateVersionLabel(downloaded)} 已下载，点击重启更新`;
  } else if (status.downloading) {
    consoleUpdateButton.title = `${updateVersionLabel(available)} 正在下载`;
  } else if (available) {
    consoleUpdateButton.title = `${updateVersionLabel(available)} 可下载，点击打开更新提示`;
  } else if (status.pending) {
    consoleUpdateButton.title = "正在检查更新";
  } else if (status.lastCheckedAt && status.lastCheckResult === "none") {
    consoleUpdateButton.title = "已是最新版本，点击重新检查";
  } else {
    consoleUpdateButton.title = "检查更新（会访问 GitHub Releases）";
  }
  if (consoleUpdateDot) {
    consoleUpdateDot.hidden = !(downloaded || available || status.downloading);
  }
}

async function refreshConsoleUpdaterStatus({ quiet = true } = {}) {
  if (typeof consoleShellClient?.getUpdaterStatus !== "function") {
    renderConsoleUpdaterStatus({ available: false });
    return consoleUpdaterStatus;
  }
  try {
    const status = await consoleShellClient.getUpdaterStatus();
    renderConsoleUpdaterStatus(status ?? { available: false });
    return consoleUpdaterStatus;
  } catch (error) {
    renderConsoleUpdaterStatus({ available: false });
    if (!quiet) showConsoleToast(`更新状态读取失败：${error?.message ?? error}`, { kind: "err" });
    return consoleUpdaterStatus;
  }
}

async function ensureManualUpdaterPreference(status = consoleUpdaterStatus) {
  if (status?.strategy && status.strategy !== "off") return status;
  if (typeof consoleShellClient?.setUpdaterStrategy !== "function") return status;
  showConsoleToast("将访问 GitHub Releases 检查新版本；LingxY 不经过自有遥测服务器。", { kind: "info" });
  const result = await consoleShellClient.setUpdaterStrategy("manual");
  if (result?.ok === false) {
    throw new Error(result?.message || result?.error || "无法保存更新偏好");
  }
  return await refreshConsoleUpdaterStatus({ quiet: true });
}

async function showConsoleUpdateAvailableCard(status = consoleUpdaterStatus) {
  const info = status?.available ?? null;
  const version = updateVersionLabel(info);
  if (typeof consoleShellClient?.showPopupCard !== "function") {
    showConsoleToast(`${version} 可下载`, { kind: "info" });
    return;
  }
  await consoleShellClient.showPopupCard({
    kind: "info",
    title: "发现新版本",
    body: `${version} 可下载。点击下载后，完成时再选择是否重启。`,
    buttons: [
      { id: "download", actionKey: "updater:download", label: "下载更新", primary: true },
      { id: "dismiss", actionKey: "dismiss", label: "稍后" }
    ],
    allowContinue: false,
    dedupeKey: `updater:available:${info?.version ?? "unknown"}`
  });
}

async function handleConsoleUpdateClick() {
  if (consoleUpdaterBusy) return;
  setConsoleUpdaterBusy(true);
  try {
    let status = await refreshConsoleUpdaterStatus({ quiet: true });
    if (status?.available === false) {
      showConsoleToast("当前环境不支持自动更新。打包后的桌面版本可检查 GitHub Releases。", { kind: "info" });
      return;
    }
    if (status?.downloaded) {
      const result = await consoleShellClient.applyUpdaterUpdate?.({ silent: false, restart: true });
      if (result?.ok === false) throw new Error(result?.error || "重启更新失败");
      showConsoleToast("正在重启以完成更新…", { kind: "ok" });
      return;
    }
    if (status?.available) {
      await showConsoleUpdateAvailableCard(status);
      return;
    }
    status = await ensureManualUpdaterPreference(status);
    renderConsoleUpdaterStatus({ ...(status ?? {}), pending: true });
    const result = await consoleShellClient.checkUpdaterNow?.();
    if (result?.ok === false) throw new Error(result?.message || result?.error || "检查更新失败");
    await new Promise((resolve) => setTimeout(resolve, 160));
    status = await refreshConsoleUpdaterStatus({ quiet: true });
    if (status?.available) {
      await showConsoleUpdateAvailableCard(status);
    } else if (status?.downloaded) {
      showConsoleToast(`${updateVersionLabel(status.downloaded)} 已下载，点击更新按钮重启`, { kind: "ok" });
    } else if (status?.lastCheckResult === "none") {
      showConsoleToast("已是最新版本", { kind: "ok" });
    } else {
      showConsoleToast("检查完成，暂未发现可用更新", { kind: "info" });
    }
  } catch (error) {
    showConsoleToast(`检查更新失败：${error?.message ?? error}`, { kind: "err" });
  } finally {
    setConsoleUpdaterBusy(false);
    void refreshConsoleUpdaterStatus({ quiet: true });
  }
}

refreshButton.addEventListener("click", () => void refreshWorkspace());
consoleUpdateButton?.addEventListener("click", () => void handleConsoleUpdateClick());
void refreshConsoleUpdaterStatus({ quiet: true });
openOverlayButton.addEventListener("click", async () => await consoleShellClient.showWindow("overlay"));

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
      if (reason === "denied" && consoleShellClient?.openExternal) {
        consoleShellClient.openExternal("ms-settings:privacy-location").catch(() => {});
      }
    }
  } catch (err) {
    locationButton.title = original;
    console.warn("[location] fetch failed", err);
  }
});

// Hydrate on boot so the icon tooltip shows the current state immediately.
void refreshDesktopLocationChip();
setTimeout(() => { void refreshDesktopLocationChip(); }, 9_000);
setInterval(() => { void refreshDesktopLocationChip(); }, 30 * 60 * 1000);

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
          void refreshTaskDetail({ showLoading: true });
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
      const result = await consoleSubmissionClient.submitTask(withConsoleLocaleMetadata({ userCommand: text, sourceApp: "console.palette" }));
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
        void refreshTaskDetail({ showLoading: true });
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
consoleChatFilesBtn?.addEventListener("click", async () => {
  consoleChatArtifactsExpanded = !consoleChatArtifactsExpanded;
  if (consoleChatArtifactsExpanded && typeof closeInlinePreview === "function") closeInlinePreview();
  const projectId = getConsoleChatSubmitProjectId();
  if (consoleChatArtifactsExpanded && projectId && projectId !== DEFAULT_PROJECT_ID) {
    await refreshProjectWorkspace(projectId, { force: true });
  }
  if (consoleActiveConversation?.conversation_id) {
    await refreshConsoleChatArtifacts({ force: true });
  } else {
    renderConsoleChatArtifacts([]);
  }
  switchTab("chat");
  if (consoleChatArtifactsExpanded && consoleChatArtifacts && !consoleChatArtifacts.hidden) {
    const firstFile = consoleChatArtifacts.querySelector("[data-conversation-artifact-open]");
    if (firstFile instanceof HTMLElement) firstFile.focus();
    return;
  }
  if (consoleChatArtifactsExpanded) showConsoleToast("当前对话还没有可预览的文件。", { kind: "info" });
});
consoleChatArtifacts?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const addBtn = target?.closest?.("[data-chat-project-files-add]");
  if (addBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void attachFilesToProject(addBtn.dataset.chatProjectFilesAdd ?? "");
    return;
  }
  const revealBtn = target?.closest?.("[data-conversation-artifact-reveal]");
  if (revealBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void revealConversationArtifactPath(revealBtn.dataset.conversationArtifactReveal ?? "");
    return;
  }
  const openBtn = target?.closest?.("[data-conversation-artifact-open]");
  if (openBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void openConversationArtifactPath(openBtn.dataset.conversationArtifactOpen ?? "");
  }
});

async function attachFilesToProject(projectId) {
  const store = state.projectStore ?? loadConsoleProjectStore();
  const targetProjectId = projectId || state.selectedProjectId || store.currentProjectId || "";
  if (!targetProjectId || targetProjectId === DEFAULT_PROJECT_ID) {
    showConsoleToast("Select a project before adding files.", { kind: "info" });
    return;
  }
  if (typeof consoleShellClient?.pickProjectFiles !== "function") {
    showConsoleToast("Desktop file picker is unavailable.", { kind: "error" });
    return;
  }
  try {
    if (projectAttachFilesBtn) projectAttachFilesBtn.disabled = true;
    const picked = await consoleShellClient.pickProjectFiles();
    const paths = Array.isArray(picked?.paths) ? picked.paths.filter(Boolean) : [];
    if (picked?.canceled || paths.length === 0) return;
    showConsoleToast("Indexing selected project files...", { kind: "info" });
    const result = await attachProjectFilesViaShell({ projectId: targetProjectId, paths });
    const nextStore = normalizeProjectStore(result.store ?? store);
    nextStore.updatedAt = Date.now();
    state.projectStore = nextStore;
    localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(nextStore));
    state.projectStoreRemoteReady = true;
    projectWorkspaceCache.delete(targetProjectId);
    await refreshProjectWorkspace(targetProjectId, { force: true });
    renderProjectsWorkspace({ skipFetch: true });
    consoleChatArtifactsExpanded = true;
    renderConsoleChatArtifacts(consoleChatArtifactItems);
    const indexed = Number(result.indexed_count ?? 0);
    const attached = Array.isArray(result.attached_paths) ? result.attached_paths.length : paths.length;
    const failed = Array.isArray(result.failed_paths) ? result.failed_paths.length : 0;
    showConsoleToast(
      failed > 0
        ? `Attached ${attached} path(s), indexed ${indexed} chunk(s), ${failed} failed.`
        : `Attached ${attached} path(s), indexed ${indexed} chunk(s).`,
      { kind: failed > 0 ? "warning" : "success" }
    );
  } catch (error) {
    showConsoleToast(error?.message ?? "Could not attach project files.", { kind: "error" });
  } finally {
    if (projectAttachFilesBtn) projectAttachFilesBtn.disabled = false;
    renderProjectsWorkspace({ skipFetch: true });
  }
}

projectAttachFilesBtn?.addEventListener("click", () => {
  const store = state.projectStore ?? loadConsoleProjectStore();
  void attachFilesToProject(state.selectedProjectId || store.currentProjectId || "");
});

projectArtifactList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const reindexBtn = target?.closest?.("[data-project-file-reindex]");
  if (reindexBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const filePath = reindexBtn.dataset.projectFileReindex ?? "";
    const projectId = reindexBtn.dataset.projectFileReindexProjectId ?? state.selectedProjectId ?? "";
    if (!filePath || !projectId) return;
    reindexBtn.setAttribute("disabled", "true");
    showConsoleToast("Reindexing project file...", { kind: "info" });
    void attachProjectFilesViaShell({ projectId, paths: [filePath] }).then(async (result) => {
      const store = normalizeProjectStore(result.store ?? state.projectStore ?? loadConsoleProjectStore());
      store.updatedAt = Date.now();
      state.projectStore = store;
      localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(store));
      state.projectStoreRemoteReady = true;
      projectWorkspaceCache.delete(projectId);
      await refreshProjectWorkspace(projectId, { force: true });
      renderProjectsWorkspace({ skipFetch: true });
      renderConsoleChatArtifacts(consoleChatArtifactItems);
      showConsoleToast(`Reindexed ${Number(result.indexed_count ?? 0)} chunk(s).`, { kind: "success" });
    }).catch((error) => {
      showConsoleToast(error?.message ?? "Could not reindex project file.", { kind: "error" });
    }).finally(() => {
      reindexBtn.removeAttribute("disabled");
    });
    return;
  }
  const clearIndexBtn = target?.closest?.("[data-project-file-clear-index]");
  if (clearIndexBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const filePath = clearIndexBtn.dataset.projectFileClearIndex ?? "";
    const projectId = clearIndexBtn.dataset.projectFileClearIndexProjectId ?? state.selectedProjectId ?? "";
    if (!filePath || !projectId) return;
    clearIndexBtn.setAttribute("disabled", "true");
    showConsoleToast("Clearing project search index...", { kind: "info" });
    void removeProjectFileIndexViaShell({ projectId, paths: [filePath], detach: false }).then(async (result) => {
      projectWorkspaceCache.delete(projectId);
      await refreshProjectWorkspace(projectId, { force: true });
      renderProjectsWorkspace({ skipFetch: true });
      renderConsoleChatArtifacts(consoleChatArtifactItems);
      showConsoleToast(`Cleared ${Number(result.removed_count ?? 0)} indexed chunk(s).`, { kind: "success" });
    }).catch((error) => {
      showConsoleToast(error?.message ?? "Could not clear project search index.", { kind: "error" });
    }).finally(() => {
      clearIndexBtn.removeAttribute("disabled");
    });
    return;
  }
  const detachBtn = target?.closest?.("[data-project-file-detach]");
  if (detachBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const filePath = detachBtn.dataset.projectFileDetach ?? "";
    const projectId = detachBtn.dataset.projectFileDetachProjectId ?? state.selectedProjectId ?? "";
    if (!filePath || !projectId) return;
    detachBtn.setAttribute("disabled", "true");
    void removeProjectFileIndexViaShell({ projectId, paths: [filePath], detach: true }).then(async (result) => {
      const store = normalizeProjectStore(result.store ?? state.projectStore ?? loadConsoleProjectStore());
      store.updatedAt = Date.now();
      state.projectStore = store;
      localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(store));
      state.projectStoreRemoteReady = true;
      projectWorkspaceCache.delete(projectId);
      await refreshProjectWorkspace(projectId, { force: true });
      renderProjectsWorkspace({ skipFetch: true });
      renderConsoleChatArtifacts(consoleChatArtifactItems);
      showConsoleToast("已从项目文件范围移出，并清理该项目索引", { kind: "ok" });
    }).catch((error) => {
      showConsoleToast(error?.message ?? "Could not remove project file.", { kind: "error" });
    }).finally(() => {
      detachBtn.removeAttribute("disabled");
    });
    return;
  }
  const revealBtn = target?.closest?.("[data-project-artifact-reveal]");
  if (revealBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void revealConversationArtifactPath(revealBtn.dataset.projectArtifactReveal ?? "");
    return;
  }
  const openBtn = target?.closest?.("[data-project-artifact-open]");
  if (openBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void openConversationArtifactPath(openBtn.dataset.projectArtifactOpen ?? "");
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
  const taskId = state.selectedTaskId;
  await deleteTaskViaShell(taskId);
  state.selectedTaskId = null;
  await refreshWorkspace();
  showConsoleToast("任务已移到 Trash", {
    kind: "ok",
    durationMs: 7000,
    actionLabel: "Undo",
    onAction: async () => {
      await restoreTaskViaShell(taskId);
      state.selectedTaskId = taskId;
      await refreshWorkspace();
      await refreshTaskDetail({ showLoading: true });
      showConsoleToast("任务已恢复", { kind: "ok" });
    }
  });
});

openTaskArtifactButton.addEventListener("click", async () => {
  if (state.selectedTaskArtifactPath) await consoleShellClient.openPath(state.selectedTaskArtifactPath);
});

copyTaskArtifactPathButton.addEventListener("click", async () => {
  if (state.selectedTaskArtifactPath) await consoleShellClient.writeClipboardText(state.selectedTaskArtifactPath);
});

useTaskArtifactContextButton.addEventListener("click", async () => {
  if (!state.selectedTaskArtifactPath) return;
  if (isPreviewableArtifactPath(state.selectedTaskArtifactPath)) {
    try {
      const raw = await consoleShellClient.readTextFile(state.selectedTaskArtifactPath, 4000);
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
    state.templatePreviewLoadKey = null;
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
    state.templatePreviewLoadKey = null;
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
    state.templatePreviewLoadKey = "";
    templateNameInput.value = "";
    templatePromptInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    templateState.textContent = `Failed: ${error.message}`;
  }
});

budgetForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  budgetState.textContent = "Updating...";
  try {
    if (typeof consoleShellClient?.updateBudget !== "function") {
      throw new Error("Desktop budget bridge unavailable.");
    }
    await assertShellResult(
      await consoleShellClient.updateBudget({ limits: { monthly_usd_limit: Number(monthlyBudgetInput?.value || 0) } }),
      "Could not update budget."
    );
    budgetState.textContent = "Updated";
    await refreshWorkspace();
  } catch (error) {
    budgetState.textContent = `Failed: ${error.message}`;
  }
});

exportBundleBtn?.addEventListener("click", async () => {
  const originalLabel = exportBundleBtn.textContent;
  exportBundleBtn.disabled = true;
  exportBundleBtn.textContent = "Exporting...";
  if (exportBundleState) exportBundleState.textContent = "Preparing redacted export...";
  try {
    const result = await exportBundleViaShell({ includeTaskEvents: true });
    const bundle = result.bundle ?? result;
    downloadTextFile(
      JSON.stringify(bundle, null, 2),
      runtimeExportFilename(bundle),
      "application/json"
    );
    if (exportBundleState) {
      const counts = bundle?.manifest?.counts ?? {};
      const summary = [
        `${counts.notes ?? 0} notes`,
        `${counts.conversations ?? 0} conversations`,
        `${counts.tasks ?? 0} tasks`,
        `${counts.schedules ?? 0} schedules`
      ].join(", ");
      exportBundleState.textContent = `Export ready: ${summary}. Secrets were excluded.`;
    }
    showConsoleToast("已导出数据 JSON", { kind: "ok" });
  } catch (error) {
    if (exportBundleState) exportBundleState.textContent = `Failed: ${error.message}`;
    showConsoleToast(`导出失败：${error.message}`, { kind: "err" });
  } finally {
    exportBundleBtn.disabled = false;
    exportBundleBtn.textContent = originalLabel;
  }
});

diagnosticBundleBtn?.addEventListener("click", async () => {
  const originalLabel = diagnosticBundleBtn.textContent;
  diagnosticBundleBtn.disabled = true;
  diagnosticBundleBtn.textContent = "Preparing...";
  if (diagnosticBundleState) diagnosticBundleState.textContent = "Collecting local diagnostics...";
  try {
    const result = await diagnosticBundleViaShell();
    const bundle = result.bundle ?? result;
    downloadTextFile(
      JSON.stringify(bundle, null, 2),
      diagnosticBundleFilename(bundle),
      "application/json"
    );
    if (diagnosticBundleState) {
      const counts = bundle?.counts ?? {};
      diagnosticBundleState.textContent = `Diagnostics ready: ${counts.tasks ?? 0} tasks, ${counts.failedTasks ?? 0} failed, ${bundle?.desktopErrors?.length ?? 0} desktop errors. No telemetry sent.`;
    }
    showConsoleToast("已生成本地诊断 JSON", { kind: "ok" });
  } catch (error) {
    if (diagnosticBundleState) diagnosticBundleState.textContent = `Failed: ${error.message}`;
    showConsoleToast(`诊断包失败：${error.message}`, { kind: "err" });
  } finally {
    diagnosticBundleBtn.disabled = false;
    diagnosticBundleBtn.textContent = originalLabel;
  }
});

// UCA-121: historyForm submit handler retired (form removed from DOM).

// UCA-125 Phase 3-4: page-head "+ New project" button focuses the
// inline name input (faster than hunting for the form in the left col).
document.querySelector("#projectNewBtn")?.addEventListener("click", () => {
  projectNameInput?.focus();
  projectNameInput?.select?.();
});

projectRefreshBtn?.addEventListener("click", () => {
  const store = state.projectStore ?? loadConsoleProjectStore();
  const projectId = state.selectedProjectId || store.currentProjectId || "";
  if (!projectId) return;
  void syncConsoleProjectStoreFromService({ rerender: true });
  void refreshProjectWorkspace(projectId, { force: true });
});

function setSelectedProjectChatScope() {
  const store = state.projectStore ?? loadConsoleProjectStore();
  const projectId = state.selectedProjectId || store.currentProjectId || DEFAULT_PROJECT_ID;
  setChatSidebarProjectScope(projectId);
  store.currentProjectId = projectId;
  store.currentConversationId = null;
  saveConsoleProjectStore(store);
  renderChatSidebarProjectFilter();
  return projectId;
}

function openSelectedProjectChat({ startNew = false } = {}) {
  const projectId = setSelectedProjectChatScope();
  if (startNew) {
    startNewConsoleChat();
  } else if (consoleActiveConversation?.conversation_id && (consoleActiveConversation.project_id ?? null) !== projectId) {
    startNewConsoleChat();
  }
  switchTab("chat");
  showConsoleToast("项目已在 Chat 中打开", { kind: "info" });
}

projectOpenChatBtn?.addEventListener("click", () => {
  openSelectedProjectChat();
});

projectStartChatBtn?.addEventListener("click", () => {
  setSelectedProjectChatScope();
  startNewConsoleChat();
  switchTab("chat");
  showConsoleToast("新项目会话已打开", { kind: "info" });
});

projectInstructionsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const store = state.projectStore ?? loadConsoleProjectStore();
  const projectId = state.selectedProjectId || store.currentProjectId || "";
  if (!projectId) return;
  const instructions = (projectInstructionsInput?.value ?? "").trim();
  const next = normalizeProjectStore({
    ...store,
    projects: (store.projects ?? []).map((project) => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        metadata: {
          ...(project.metadata ?? {}),
          instructions
        }
      };
    })
  });
  state.projectStore = next;
  localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(next));
  if (projectInstructionsState) projectInstructionsState.textContent = "Saving...";
  void saveProjectMetadataViaService(projectId, { instructions }).then((payload) => {
    const savedStore = normalizeProjectStore(payload.store ?? next);
    state.projectStore = savedStore;
    localStorage.setItem(PROJECT_STORE_KEY, JSON.stringify(savedStore));
    projectWorkspaceCache.delete(projectId);
    if (projectInstructionsState) projectInstructionsState.textContent = "Saved.";
    renderProjectsWorkspace({ skipFetch: true });
    return refreshProjectWorkspace(projectId, { force: true });
  }).catch((error) => {
    if (projectInstructionsState) projectInstructionsState.textContent = "Save failed.";
    showConsoleToast(error?.message ?? "Could not save project instructions.", { kind: "error" });
  });
  renderProjectsWorkspace({ skipFetch: true });
});

// "+ New chat" — clear the current thread and the active conversation
// reference so the next submit creates a fresh conversation_id rather
// than continuing to thread into the previously-resumed one.
function startNewConsoleChat() {
  const outgoingConversationId = currentConsoleConversationId();
  if (consoleChatActiveTaskId && outgoingConversationId) {
    rememberConsoleChatTaskOwner(consoleChatActiveTaskId, outgoingConversationId);
  }
  consoleChatEventStream = null;
  consoleChatToolCards = new Map();
  consoleChatStreamingAnswer = null;
  closeConsoleChatThinkingCard();
  consoleChatResultTaskIds = new Set();
  consoleChatActiveTaskId = null;
  consoleChatCancellationRequestedTaskId = null;
  clearConsoleActiveConversation();
  if (consoleChatMessages) {
    renderConsoleChatEmptyState();
  }
  const input = document.querySelector("#consoleChatInput");
  if (input) { input.value = ""; input.focus(); }
  if (consoleChatState) consoleChatState.textContent = "";
  refreshConsoleChatSendBtnMode();
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
    void refreshChatSidebar({ force: true });
  }, 120);
});

function applyChatSidebarModeSelection(mode) {
  const previousProjectId = consoleActiveConversation?.project_id ?? null;
  const changed = setChatSidebarMode(mode);
  const nextProjectId = getChatSidebarConversationProjectId();
  const normalizedActive = previousProjectId === DEFAULT_PROJECT_ID ? null : previousProjectId;
  const enteringEmptyProjectMode = mode === "projects" && !nextProjectId;
  if (changed && consoleActiveConversation?.conversation_id && (enteringEmptyProjectMode || normalizedActive !== nextProjectId)) {
    clearConsoleActiveConversation();
    renderConsoleChatEmptyState();
    renderConsoleChatArtifacts([]);
  }
  renderChatSidebar();
  void refreshChatSidebar({ force: true });
}

document.querySelector("#chatSidebarChatsTabBtn")?.addEventListener("click", () => {
  applyChatSidebarModeSelection("chats");
});

document.querySelector("#chatSidebarProjectsTabBtn")?.addEventListener("click", () => {
  applyChatSidebarModeSelection("projects");
});

document.querySelector("#chatSidebarScopeSelect")?.addEventListener("change", (event) => {
  const nextProjectId = event.target?.value || null;
  const changed = setChatSidebarProjectScope(nextProjectId);
  const activeProjectId = consoleActiveConversation?.project_id ?? null;
  const normalizedActive = activeProjectId === DEFAULT_PROJECT_ID ? null : activeProjectId;
  const normalizedNext = nextProjectId || null;
  if (changed && consoleActiveConversation?.conversation_id && normalizedActive !== normalizedNext) {
    clearConsoleActiveConversation();
  }
  if (!consoleActiveConversation?.conversation_id) {
    renderConsoleChatEmptyState();
    renderConsoleChatArtifacts([]);
  }
  renderChatSidebar();
  void refreshChatSidebar({ force: true });
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
  projectWorkspaceProjectId = null;
  projectWorkspaceStatus = "idle";
  projectWorkspaceDetail = null;
  renderProjectsWorkspace();
  renderChatSidebarProjectFilter();
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
marketplaceRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
skillRegistryRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
codeCliAdapterRefreshBtn?.addEventListener("click", () => void refreshWorkspace());
emailAccountRefreshBtn?.addEventListener("click", () => void refreshWorkspace());

skillGitHubInstallBtn?.addEventListener("click", async () => {
  if (!skillGitHubInstallUrl) return;
  const url = skillGitHubInstallUrl.value.trim();
  if (!url) {
    if (skillGitHubInstallState) skillGitHubInstallState.textContent = "请输入 GitHub URL";
    return;
  }
  const originalLabel = skillGitHubInstallBtn.textContent;
  skillGitHubInstallBtn.disabled = true;
  skillGitHubInstallBtn.textContent = "预览中…";
  if (skillGitHubInstallState) skillGitHubInstallState.textContent = "正在预览第三方 Skill…";
  try {
    const previewResponse = await consoleSkillsClient.previewInstallFromGitHub(url);
    const preview = previewResponse.payload ?? {};
    if (!preview?.ok) {
      const detail = preview?.errors?.[0]?.message ?? preview?.error ?? "preview_failed";
      if (skillGitHubInstallState) skillGitHubInstallState.textContent = `预览失败：${detail}`;
      showConsoleToast(`预览失败：${detail}`, { kind: "err" });
      return;
    }
    const label = preview.source?.sourceRef ?? url;
    const accepted = confirm(`安装第三方 Skill？\n\n${label}\n\n安装会写入本地 skills 目录，并把该 Skill 加入可用能力。`);
    if (!accepted) {
      if (skillGitHubInstallState) skillGitHubInstallState.textContent = "已取消安装。";
      return;
    }
    skillGitHubInstallBtn.textContent = "安装中…";
    if (skillGitHubInstallState) skillGitHubInstallState.textContent = "正在 git clone…";
    const response = await consoleSkillsClient.installFromGitHub(url, { previewAccepted: true });
    const data = response.payload ?? {};
    if (data?.ok) {
      if (skillGitHubInstallState) {
        skillGitHubInstallState.textContent = `已安装：${data.descriptor?.heading ?? data.repo} → ${data.rootPath}`;
      }
      skillGitHubInstallUrl.value = "";
      showConsoleToast("Skill 已安装", { kind: "ok" });
      // Skill registry list refreshes via the workspace fetcher.
      void refreshWorkspace?.();
    } else {
      const reason = data?.error ?? "install_failed";
      const detail = data?.message ? `${reason}：${data.message}` : reason;
      if (skillGitHubInstallState) skillGitHubInstallState.textContent = `失败：${detail}`;
      showConsoleToast(`安装失败：${detail}`, { kind: "err" });
    }
  } catch (error) {
    if (skillGitHubInstallState) skillGitHubInstallState.textContent = `失败：${error.message}`;
    showConsoleToast(`安装失败：${error.message}`, { kind: "err" });
  } finally {
    skillGitHubInstallBtn.disabled = false;
    skillGitHubInstallBtn.textContent = originalLabel;
  }
});

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
  return consolePreflightClient.testMcpServerConfig(buildMcpServerPayloadFromForm());
}

async function planMcpInstallSource() {
  return consolePreflightClient.planMcpInstall({
    source: mcpInstallSource?.value?.trim() ?? "",
    id: mcpServerId?.value?.trim() ?? ""
  });
}

async function runMcpInstallSource() {
  if (typeof consoleShellClient?.runMcpInstall !== "function") {
    throw new Error("Desktop install bridge unavailable.");
  }
  return consoleShellClient.runMcpInstall({
    source: mcpInstallSource?.value?.trim() ?? "",
    id: mcpServerId?.value?.trim() ?? ""
  });
}

async function previewMcpInstallCandidate() {
  if (typeof consoleShellClient?.previewMcpInstall !== "function") {
    throw new Error("Desktop preview bridge unavailable.");
  }
  return consoleShellClient.previewMcpInstall({
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
  if (typeof consoleShellClient?.createSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.createSchedule(payload),
    "Could not create schedule."
  );
}

async function updateSchedule(scheduleId, patch) {
  if (typeof consoleShellClient?.updateSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateSchedule({ scheduleId, patch }),
    "Could not update schedule."
  );
}

async function deleteSchedule(scheduleId) {
  if (typeof consoleShellClient?.deleteSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteSchedule(scheduleId),
    "Could not delete schedule."
  );
}

async function runScheduleNow(scheduleId, triggerPayload = {}) {
  if (typeof consoleShellClient?.runSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.runSchedule({ scheduleId, triggerPayload }),
    "Could not run schedule."
  );
}

async function saveTemplateViaShell(template) {
  if (typeof consoleShellClient?.saveTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveTemplate({ template }),
    "Could not save template."
  );
}

async function importTemplateViaShell(raw) {
  if (typeof consoleShellClient?.importTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.importTemplate({ raw }),
    "Could not import template."
  );
}

async function deleteTemplateViaShell(templateId) {
  if (typeof consoleShellClient?.deleteTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteTemplate(templateId),
    "Could not delete template."
  );
}

async function resumeDagExecutionViaShell(executionId) {
  if (typeof consoleShellClient?.resumeDagExecution !== "function") {
    throw new Error("Desktop DAG bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.resumeDagExecution(executionId),
    "Could not resume DAG execution."
  );
}

async function listProvidersViaShell() {
  if (typeof consoleShellClient?.listProviders !== "function") {
    throw new Error("Desktop provider config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.listProviders(),
    "Could not load providers."
  );
}

async function listProvidersForConsole() {
  if (typeof consoleShellClient?.listProviders === "function") {
    return listProvidersViaShell();
  }
  return fetchJson("/config/providers");
}

async function saveProviderViaShell(provider) {
  if (typeof consoleShellClient?.saveProvider !== "function") {
    throw new Error("Desktop provider config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveProvider(provider),
    "Could not save provider."
  );
}

async function deleteProviderViaShell(providerId) {
  if (typeof consoleShellClient?.deleteProvider !== "function") {
    throw new Error("Desktop provider config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteProvider(providerId),
    "Could not delete provider."
  );
}

async function saveCodeCliAdapterViaShell(adapter) {
  if (typeof consoleShellClient?.saveCodeCliAdapter !== "function") {
    throw new Error("Desktop Code CLI adapter bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveCodeCliAdapter(adapter),
    "Could not save Code CLI adapter."
  );
}

async function deleteCodeCliAdapterViaShell(adapterId) {
  if (typeof consoleShellClient?.deleteCodeCliAdapter !== "function") {
    throw new Error("Desktop Code CLI adapter bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteCodeCliAdapter(adapterId),
    "Could not delete Code CLI adapter."
  );
}

async function saveSkillRegistryViaShell(registry) {
  if (typeof consoleShellClient?.saveSkillRegistry !== "function") {
    throw new Error("Desktop skill registry bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveSkillRegistry(registry),
    "Could not save skill registry."
  );
}

async function deleteSkillRegistryViaShell(registryId) {
  if (typeof consoleShellClient?.deleteSkillRegistry !== "function") {
    throw new Error("Desktop skill registry bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteSkillRegistry(registryId),
    "Could not delete skill registry."
  );
}

async function updateSkillStateViaShell(payload) {
  if (typeof consoleShellClient?.updateSkillState !== "function") {
    throw new Error("Desktop skill state bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateSkillState(payload),
    "Could not update skill state."
  );
}

async function writeSkillMarkdownViaShell(entryPath, markdown) {
  if (typeof consoleShellClient?.writeSkillMarkdown !== "function") {
    throw new Error("Desktop skill editor bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.writeSkillMarkdown({ entryPath, markdown }),
    "Could not save skill markdown."
  );
}

async function readSkillMarkdownViaShell(entryPath) {
  if (typeof consoleShellClient?.readSkillMarkdown !== "function") {
    throw new Error("Desktop skill editor bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.readSkillMarkdown({ entryPath }),
    "Could not read skill markdown."
  );
}

async function createSkillViaShell(payload = {}) {
  if (typeof consoleShellClient?.createSkill !== "function") {
    throw new Error("Desktop skill lifecycle bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.createSkill(payload),
    "Could not create skill."
  );
}

async function duplicateSkillViaShell(entryPath) {
  if (typeof consoleShellClient?.duplicateSkill !== "function") {
    throw new Error("Desktop skill lifecycle bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.duplicateSkill({ entryPath }),
    "Could not duplicate skill."
  );
}

async function deleteSkillViaShell(entryPath) {
  if (typeof consoleShellClient?.deleteSkill !== "function") {
    throw new Error("Desktop skill lifecycle bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteSkill({ entryPath }),
    "Could not delete skill."
  );
}

async function rollbackSkillViaShell(entryPath, historyId = "") {
  if (typeof consoleShellClient?.rollbackSkill !== "function") {
    throw new Error("Desktop skill lifecycle bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.rollbackSkill({ entryPath, historyId }),
    "Could not rollback skill."
  );
}

async function listSkillHistoryViaShell(entryPath) {
  if (typeof consoleShellClient?.listSkillHistory !== "function") {
    throw new Error("Desktop skill history bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.listSkillHistory({ entryPath }),
    "Could not list skill history."
  );
}

async function testSkillViaShell(payload = {}) {
  if (typeof consoleShellClient?.testSkill !== "function") {
    throw new Error("Desktop skill test bridge unavailable.");
  }
  const result = await consoleShellClient.testSkill(payload);
  if (result?.error) {
    throw new Error(result.message ?? result.error ?? "Could not test skill.");
  }
  return result ?? {};
}

function formatSkillHistoryLabel(entry = {}, index = 0) {
  const rawId = String(entry.id ?? "");
  const label = rawId
    .replace(/^backup-/i, "")
    .replace(/-(?=\d{2}(?:-|$))/g, ":")
    .replace(/-/g, " ");
  return `${index === 0 ? "Latest" : "Backup"} ${label || rawId || index + 1}`.trim();
}

async function refreshSkillHistoryOptions(entryPath) {
  if (!skillEditHistorySelect || !entryPath) return;
  skillEditHistorySelect.disabled = true;
  skillEditHistorySelect.innerHTML = `<option value="">No backups</option>`;
  try {
    const payload = await listSkillHistoryViaShell(entryPath);
    const history = Array.isArray(payload.history) ? payload.history : [];
    if (!history.length) return;
    skillEditHistorySelect.innerHTML = history.map((entry, index) =>
      `<option value="${escapeHtml(entry.id ?? "")}">${escapeHtml(formatSkillHistoryLabel(entry, index))}</option>`
    ).join("");
    skillEditHistorySelect.disabled = false;
  } catch {
    skillEditHistorySelect.innerHTML = `<option value="">History unavailable</option>`;
  }
}

async function updateRoutingConfigViaShell(routing) {
  if (typeof consoleShellClient?.updateRoutingConfig !== "function") {
    throw new Error("Desktop routing config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateRoutingConfig(routing),
    "Could not save routing config."
  );
}

async function updateOutputConfigViaShell(output) {
  if (typeof consoleShellClient?.updateOutputConfig !== "function") {
    throw new Error("Desktop output config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateOutputConfig(output),
    "Could not save output config."
  );
}

async function updateFeatureConfigViaShell(features) {
  if (typeof consoleShellClient?.updateFeatureConfig !== "function") {
    throw new Error("Desktop feature config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateFeatureConfig(features),
    "Could not save feature config."
  );
}

async function updateRuntimeLabsConfigViaShell(patch) {
  if (typeof consoleShellClient?.updateRuntimeLabsConfig !== "function") {
    throw new Error("Desktop runtime labs bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateRuntimeLabsConfig(patch),
    "Could not save runtime labs config."
  );
}

async function exportBundleViaShell(options = {}) {
  if (typeof consoleShellClient?.exportBundle !== "function") {
    throw new Error("Desktop export bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.exportBundle(options),
    "Could not export data bundle."
  );
}

async function diagnosticBundleViaShell(options = {}) {
  if (typeof consoleShellClient?.diagnosticBundle !== "function") {
    throw new Error("Desktop diagnostics bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.diagnosticBundle(options),
    "Could not build diagnostics bundle."
  );
}

async function updateEmailSettingsViaShell(settings) {
  if (typeof consoleShellClient?.updateEmailSettings !== "function") {
    throw new Error("Desktop email settings bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.updateEmailSettings(settings),
    "Could not save email settings."
  );
}

async function saveEmailAccountViaShell(account) {
  if (typeof consoleShellClient?.saveEmailAccount !== "function") {
    throw new Error("Desktop email account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveEmailAccount(account),
    "Could not save email account."
  );
}

async function deleteEmailAccountViaShell(accountId) {
  if (typeof consoleShellClient?.deleteEmailAccount !== "function") {
    throw new Error("Desktop email account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteEmailAccount(accountId),
    "Could not delete email account."
  );
}

async function checkEmailDigestViaShell(payload = {}) {
  if (typeof consoleShellClient?.checkEmailDigest !== "function") {
    throw new Error("Desktop email digest bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.checkEmailDigest(payload),
    "Could not run email digest check."
  );
}

async function saveNotesViaShell(notes) {
  if (typeof consoleShellClient?.saveNotes !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveNotes(notes),
    "Could not save notes."
  );
}

async function upsertNoteViaShell(note) {
  if (typeof consoleShellClient?.upsertNote !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.upsertNote(note),
    "Could not save note."
  );
}

async function deleteNoteViaShell(noteId) {
  if (typeof consoleShellClient?.deleteNote !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteNote(noteId),
    "Could not delete note."
  );
}

async function restoreNoteViaShell(noteId) {
  if (typeof consoleShellClient?.restoreNote !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.restoreNote(noteId),
    "Could not restore note."
  );
}

async function appendNoteChipViaShell(payload) {
  if (typeof consoleShellClient?.appendNoteChip !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.appendNoteChip(payload),
    "Could not append note chip."
  );
}

async function saveProjectStoreViaShell(store) {
  if (typeof consoleShellClient?.saveProjectStore !== "function") {
    throw new Error("Desktop project store bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveProjectStore(store),
    "Could not save project store."
  );
}

async function attachProjectFilesViaShell(payload) {
  if (typeof consoleShellClient?.attachProjectFiles !== "function") {
    throw new Error("Desktop project file bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.attachProjectFiles(payload ?? {}),
    "Could not attach project files."
  );
}

async function removeProjectFileIndexViaShell(payload) {
  if (typeof consoleShellClient?.removeProjectFileIndex !== "function") {
    throw new Error("Desktop project file index bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.removeProjectFileIndex(payload ?? {}),
    "Could not remove project file index."
  );
}

async function saveProjectMetadataViaService(projectId, body = {}) {
  if (!projectId) throw new Error("project_id required");
  return fetchJson(
    `/projects/${encodeURIComponent(projectId)}`,
    runtimeJsonOptions("PATCH", body, { actor: "desktop_console" })
  );
}

async function clearPreviewCacheViaShell() {
  if (typeof consoleShellClient?.clearPreviewCache !== "function") {
    throw new Error("Desktop preview cache bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.clearPreviewCache(),
    "Could not clear preview cache."
  );
}

async function setupOfficeAddinsViaShell(payload) {
  if (typeof consoleShellClient?.setupOfficeAddins !== "function") {
    throw new Error("Desktop Office add-in setup bridge unavailable.");
  }
  const result = await consoleShellClient.setupOfficeAddins(payload ?? {});
  if (result?.ok === false && result?.error) {
    throw new Error(result.message ?? result.error ?? "Could not configure Office add-ins.");
  }
  return result ?? {};
}

async function updateEchoWakeProfileViaShell(profile) {
  if (typeof consoleShellClient?.setEchoWakeProfile !== "function") {
    throw new Error("Desktop Echo wake profile bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.setEchoWakeProfile(profile ?? {}),
    "Could not save Echo wake profile."
  );
}

async function renameConnectedAccountViaShell(accountId, displayName) {
  if (typeof consoleShellClient?.renameConnectedAccount !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.renameConnectedAccount(accountId, displayName),
    "Could not rename connected account."
  );
}

async function setConnectedAccountDefaultViaShell(accountId, purpose) {
  if (typeof consoleShellClient?.setConnectedAccountDefault !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.setConnectedAccountDefault(accountId, purpose),
    "Could not update connected account default."
  );
}

async function disconnectConnectedAccountViaShell(accountId) {
  if (typeof consoleShellClient?.disconnectConnectedAccount !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.disconnectConnectedAccount(accountId),
    "Could not disconnect connected account."
  );
}

async function disconnectConnectorAccountViaShell(type) {
  if (typeof consoleShellClient?.disconnectConnectorAccount !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.disconnectConnectorAccount(type),
    "Could not disconnect connector account."
  );
}

async function saveConnectorAccountConfigViaShell(type, config) {
  if (typeof consoleShellClient?.saveConnectorAccountConfig !== "function") {
    throw new Error("Desktop connector account bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveConnectorAccountConfig(type, config),
    "Could not save connector account config."
  );
}

async function cancelTaskViaShell(taskId, options = {}) {
  if (typeof consoleShellClient?.cancelTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.cancelTask(taskId, { force: options.force === true }),
    "Could not cancel task."
  );
}

async function retryTaskViaShell(taskId, options = {}) {
  if (typeof consoleShellClient?.retryTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.retryTask(taskId, options),
    "Could not retry task."
  );
}

async function deleteTaskViaShell(taskId) {
  if (typeof consoleShellClient?.deleteTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteTask(taskId),
    "Could not delete task."
  );
}

async function restoreTaskViaShell(taskId) {
  if (typeof consoleShellClient?.restoreTask !== "function") {
    throw new Error("Desktop task restore bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.restoreTask(taskId),
    "Could not restore task."
  );
}

async function restoreFileCheckpointViaShell(taskId, checkpointId) {
  if (typeof consoleShellClient?.restoreFileCheckpoint !== "function") {
    throw new Error("Desktop file recovery bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.restoreFileCheckpoint(taskId, checkpointId),
    "Could not restore file checkpoint."
  );
}

async function saveMcpServer(server) {
  if (typeof consoleShellClient?.saveMcpServer !== "function") {
    throw new Error("Desktop MCP config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveMcpServer(server),
    "Could not save MCP server."
  );
}

async function deleteMcpServer(id) {
  if (typeof consoleShellClient?.deleteMcpServer !== "function") {
    throw new Error("Desktop MCP config bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.deleteMcpServer(id),
    "Could not delete MCP server."
  );
}

async function testMcpServer(id) {
  if (typeof consoleShellClient?.testMcpServer !== "function") {
    throw new Error("Desktop MCP test bridge unavailable.");
  }
  return await consoleShellClient.testMcpServer(id);
}

async function importMcpDraft(payload) {
  if (typeof consoleShellClient?.importMcpDraft !== "function") {
    throw new Error("Desktop MCP draft bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.importMcpDraft(payload),
    "Could not import MCP draft."
  );
}

async function toggleMcpServer(id, enabled) {
  if (typeof consoleShellClient?.toggleMcpServer !== "function") {
    throw new Error("Desktop MCP runtime bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.toggleMcpServer({ id, enabled }),
    "Could not update MCP server."
  );
}

async function saveMcpServerConfig({ id, key, value, values, references }) {
  if (typeof consoleShellClient?.saveMcpServerConfig !== "function") {
    throw new Error("Desktop MCP runtime bridge unavailable.");
  }
  return assertShellResult(
    await consoleShellClient.saveMcpServerConfig({ id, key, value, values, references }),
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
  return consolePreflightClient.testSkillRegistryConfig(buildSkillRegistryPayloadFromForm());
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

skillCreateBtn?.addEventListener("click", async () => {
  if (!skillRegistryState) return;
  skillRegistryState.textContent = "Creating skill...";
  try {
    const result = await createSkillViaShell({ name: "New Skill" });
    skillRegistryState.textContent = "Created.";
    await refreshWorkspace({ mode: "background" });
    if (result.entryPath) await openSkillEditor(result.entryPath);
  } catch (error) {
    skillRegistryState.textContent = `Failed: ${error.message}`;
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
skillEditOpenBtn?.addEventListener("click", () => {
  if (editingSkillPath) void openSkillPath(editingSkillPath);
});
skillEditRevealBtn?.addEventListener("click", () => {
  if (editingSkillPath) void revealSkillPath(editingSkillPath);
});
skillEditRollbackBtn?.addEventListener("click", async () => {
  if (!editingSkillPath || !skillEditText) return;
  const historyId = skillEditHistorySelect?.value ?? "";
  const targetLabel = skillEditHistorySelect?.selectedOptions?.[0]?.textContent ?? "latest backup";
  if (!historyId) {
    skillEditState.textContent = "No backup is available.";
    return;
  }
  if (!confirm(`Restore ${targetLabel} for this skill?`)) return;
  skillEditState.textContent = "Restoring...";
  try {
    const result = await rollbackSkillViaShell(editingSkillPath, historyId);
    skillEditText.value = result.markdown ?? skillEditText.value;
    renderSkillValidation(skillEditValidation, result.validation);
    skillEditState.textContent = `Restored ${result.restoredHistoryId ?? "latest backup"}.`;
    await refreshSkillHistoryOptions(editingSkillPath);
    await refreshWorkspace({ mode: "background" });
  } catch (error) {
    skillEditState.textContent = `Failed: ${error.message}`;
  }
});
skillEditTestBtn?.addEventListener("click", async () => {
  if (!editingSkillPath || !skillEditText) return;
  skillEditState.textContent = "Testing...";
  try {
    const result = await testSkillViaShell({
      entryPath: editingSkillPath,
      markdown: skillEditText.value
    });
    renderSkillTestResult(skillEditValidation, result);
    skillEditState.textContent = result.ok ? "Ready for planner discovery." : "Review the checks above.";
  } catch (error) {
    skillEditState.textContent = `Failed: ${error.message}`;
  }
});
skillEditModal?.addEventListener("click", (event) => {
  if (event.target === skillEditModal) closeSkillEditor();
});
skillEditSaveBtn?.addEventListener("click", async () => {
  if (!editingSkillPath || !skillEditText) return;
  skillEditState.textContent = "Saving...";
  try {
    const result = await writeSkillMarkdownViaShell(editingSkillPath, skillEditText.value);
    renderSkillValidation(skillEditValidation, result.validation);
    skillEditState.textContent = result.validation?.ok === false ? "Saved with validation issues." : "Saved.";
    await refreshSkillHistoryOptions(editingSkillPath);
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

userMemorySaveBtn?.addEventListener("click", () => void saveUserMemorySettings());
userMemoryEnabled?.addEventListener("change", () => {
  state.workspace.userMemory = {
    ...(state.workspace.userMemory ?? {}),
    enabled: userMemoryEnabled.checked
  };
  const enabled = userMemoryEnabled.checked;
  if (userMemoryEnabledPill) {
    userMemoryEnabledPill.textContent = enabled ? "enabled" : "disabled";
    userMemoryEnabledPill.className = `chip ${enabled ? "ready" : "muted"}`;
  }
  if (userMemorySwitchHint) {
    userMemorySwitchHint.textContent = enabled
      ? "Enabled. Saved preferences and approved memories can be injected as typed context. Routine task history stays separate from durable memory."
      : "Disabled. Stored entries stay saved, but they are not injected into runtime context.";
  }
});
userMemoryAutoApprove?.addEventListener("change", () => {
  state.workspace.userMemory = {
    ...(state.workspace.userMemory ?? {}),
    autoApproveGenerated: userMemoryAutoApprove.checked
  };
  renderUserMemorySettings();
});
for (const control of [userMemoryScopeFilter, userMemoryProjectFilter, userMemoryConversationFilter]) {
  control?.addEventListener("input", () => renderGovernedMemoryList(state.workspace.userMemory ?? {}));
  control?.addEventListener("change", () => renderGovernedMemoryList(state.workspace.userMemory ?? {}));
}

// DAG editor retired from the UI (UCA-126); wiring stays null-safe so the
// backend APIs (/dag/preview, /dag/execute/:id/resume) remain reachable
// from scripts or future surfaces without crashing when the DOM is absent.
previewDagButton?.addEventListener("click", async () => {
  const raw = dagEditorInput?.value.trim() ?? "";
  if (!raw) { if (dagPreview) dagPreview.textContent = "Enter DAG JSON first."; return; }
  if (dagPreview) dagPreview.textContent = "Validating...";
  try {
    const graph = JSON.parse(raw);
    const result = await consolePreflightClient.previewDag(graph);
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

echoWakeSaveBtn?.addEventListener("click", async () => {
  const phrases = (echoWakePhrases?.value ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const displayName = (echoWakeDisplayName?.value ?? "").trim() || phrases[0] || "linxi";
  const profile = {
    displayName,
    phrases,
    includeDefault: echoWakeIncludeDefault?.checked !== false
  };
  if (echoWakeState) echoWakeState.textContent = "Saving...";
  if (echoWakeSaveBtn) echoWakeSaveBtn.disabled = true;
  try {
    const settings = await updateEchoWakeProfileViaShell(profile);
    renderEchoWakeSettings(settings);
    echoDiagnosticsLastLoadedAt = 0;
    void loadEchoDiagnostics({ force: true });
    if (echoWakeState) echoWakeState.textContent = "Saved. Echo will use this profile next wake.";
    setTimeout(() => { if (echoWakeState) echoWakeState.textContent = ""; }, 2600);
  } catch (error) {
    if (echoWakeState) echoWakeState.textContent = `Failed: ${error.message}`;
  } finally {
    if (echoWakeSaveBtn) echoWakeSaveBtn.disabled = false;
  }
});

echoDiagnosticsRefreshBtn?.addEventListener("click", () => {
  void loadEchoDiagnostics({ force: true });
});

echoEnrollmentStartBtn?.addEventListener("click", async () => {
  if (typeof consoleShellClient?.startWakeEnrollment !== "function") {
    if (echoWakeState) echoWakeState.textContent = "Wake enrollment is only available in the desktop shell.";
    return;
  }
  if (echoEnrollmentStartBtn) echoEnrollmentStartBtn.disabled = true;
  if (echoWakeState) echoWakeState.textContent = "Starting wake sample recording...";
  try {
    const result = await consoleShellClient.startWakeEnrollment();
    if (!result?.ok) throw new Error(result?.message || result?.reason || "Could not start wake enrollment.");
    if (echoWakeState) echoWakeState.textContent = "Follow the Echo bubbles to record 3 wake samples.";
    setTimeout(() => { if (echoWakeState) echoWakeState.textContent = ""; }, 4200);
  } catch (error) {
    if (echoWakeState) echoWakeState.textContent = `Failed: ${error.message}`;
  } finally {
    if (echoEnrollmentStartBtn) echoEnrollmentStartBtn.disabled = false;
  }
});

// load custom providers + task routing on startup
loadProvidersAndRouting();

consoleShellClient.onShortcutTriggered((payload) => {
  submitState.textContent = `Shortcut: ${payload.shortcutId}`;
});

consoleShellClient.onShellReady(() => void refreshWorkspace());

consoleShellClient?.onPopupCardResolved?.((payload) => {
  if (payload?.kind === "approval") {
    void refreshWorkspace();
  }
});

consoleShellClient.onWindowFocused((payload) => {
  if (payload.windowId === "console") void refreshWorkspace({ mode: "background" });
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
setInterval(() => void refreshWorkspace({ mode: "background" }), 6000);
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
   FILE PREVIEW COMPATIBILITY (Console)
   ═══════════════════════════════════════════════ */

/* Console file chips open inside the conversation split preview first. The
   explicit "open external" button remains the route to the OS association
   when the user wants to edit the file in a native app. */

const consolePreviewLayout = document.querySelector(".chat-layout");
const consolePreviewPane = document.querySelector("#consolePreviewPane");
const consolePreviewBody = document.querySelector("#consolePreviewBody");
const consolePreviewTitle = document.querySelector("#consolePreviewTitle");
const consolePreviewMeta = document.querySelector("#consolePreviewMeta");
const consolePreviewBackBtn = document.querySelector("#consolePreviewBackBtn");
const consolePreviewParentBtn = document.querySelector("#consolePreviewParentBtn");
const consolePreviewCloseBtn = document.querySelector("#consolePreviewCloseBtn");
const consolePreviewOpenExternalBtn = document.querySelector("#consolePreviewOpenExternalBtn");

let currentInlinePreviewPath = null;
let inlinePreviewBackStack = [];
let currentInlinePreviewParentPath = null;

function fileNameFromPath(filePath) {
  if (!filePath) return "Preview";
  const segments = String(filePath).split(/[\\/]/);
  return segments[segments.length - 1] || "Preview";
}

function closeInlinePreview() {
  if (consolePreviewLayout) consolePreviewLayout.classList.remove("preview-open");
  if (consolePreviewPane) consolePreviewPane.hidden = true;
  if (consolePreviewBody) consolePreviewBody.innerHTML = "";
  currentInlinePreviewPath = null;
  currentInlinePreviewParentPath = null;
  inlinePreviewBackStack = [];
  updateInlinePreviewBackButton();
  updateInlinePreviewParentButton();
}

function updateInlinePreviewBackButton() {
  if (!consolePreviewBackBtn) return;
  consolePreviewBackBtn.hidden = inlinePreviewBackStack.length === 0;
  consolePreviewBackBtn.disabled = inlinePreviewBackStack.length === 0;
}

function updateInlinePreviewParentButton() {
  if (!consolePreviewParentBtn) return;
  const hasParent = Boolean(currentInlinePreviewParentPath && currentInlinePreviewParentPath !== currentInlinePreviewPath);
  consolePreviewParentBtn.hidden = !hasParent;
  consolePreviewParentBtn.disabled = !hasParent;
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function directoryEntryIcon(entry = {}) {
  if (entry.isDirectory || entry.kind === "folder") return "DIR";
  return artifactIconText(entry.path ?? entry.name ?? "");
}

async function renderDirectoryPreviewInChat(filePath) {
  if (!consolePreviewBody) return;
  const listing = await consoleShellClient.listDirectory(filePath, { limit: 300 });
  const parentPath = listing.parentPath && listing.parentPath !== listing.path ? listing.parentPath : "";
  const rows = (listing.entries ?? []).map((entry) => {
    const isDirectory = entry.isDirectory || entry.kind === "folder";
    const meta = [
      isDirectory ? "Folder" : "File",
      !isDirectory ? formatFileSize(entry.size) : "",
      entry.mtimeMs ? formatDateTime(entry.mtimeMs) : ""
    ].filter(Boolean).join(" · ");
    return `
      <div class="directory-preview-row" title="${escapeHtml(entry.path)}">
        <span class="artifact-icon ${artifactIconClass(entry.path)}">${escapeHtml(directoryEntryIcon(entry))}</span>
        <button type="button" class="directory-preview-main" data-directory-entry-open="${escapeHtml(entry.path)}">
          <span class="directory-preview-name">${escapeHtml(entry.name)}</span>
          <span class="directory-preview-meta">${escapeHtml(meta)}</span>
        </button>
        <button type="button" class="conversation-artifact-action" data-directory-entry-reveal="${escapeHtml(entry.path)}" aria-label="Reveal ${escapeHtml(entry.name)}" title="Reveal in folder">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h3l2 2h4"/></svg>
        </button>
      </div>
    `;
  }).join("");
  consolePreviewBody.innerHTML = `
    <div class="directory-preview">
      <div class="directory-preview-toolbar">
        ${parentPath ? `<button type="button" class="btn btn-sm btn-ghost" data-directory-entry-open="${escapeHtml(parentPath)}">上一层</button>` : ""}
        <span class="muted">${escapeHtml(`${listing.entries?.length ?? 0}/${listing.total ?? 0} items${listing.truncated ? " · truncated" : ""}`)}</span>
      </div>
      <div class="directory-preview-list">
        ${rows || `<div class="muted" style="padding:24px;text-align:center;">此文件夹为空。</div>`}
      </div>
    </div>
  `;
}

async function openInlinePreviewInChat({ filePath, mime, fromHistory = false } = {}) {
  if (!filePath || !consolePreviewPane || !consolePreviewBody || !consolePreviewLayout) {
    return false;
  }
  if (!fromHistory && currentInlinePreviewPath && currentInlinePreviewPath !== filePath) {
    inlinePreviewBackStack.push(currentInlinePreviewPath);
    if (inlinePreviewBackStack.length > 30) inlinePreviewBackStack = inlinePreviewBackStack.slice(-30);
  }
  consoleChatArtifactsExpanded = false;
  if (consoleChatArtifacts) consoleChatArtifacts.hidden = true;
  setConsoleChatFilesDrawerOpen(false);
  if (consoleChatFilesBtn) consoleChatFilesBtn.setAttribute("aria-expanded", "false");

  // The user might click a file from any tab; ensure they see the chat
  // tab so the split view is actually visible.
  const activeTab = document.querySelector(".tab-panel.active");
  if (activeTab?.id !== "panel-chat") {
    if (typeof switchTab === "function") {
      try { switchTab("chat"); } catch { /* ignore */ }
    }
  }

  if (consolePreviewTitle) consolePreviewTitle.textContent = fileNameFromPath(filePath);
  if (consolePreviewMeta) consolePreviewMeta.textContent = filePath;
  consolePreviewPane.hidden = false;
  consolePreviewLayout.classList.add("preview-open");
  currentInlinePreviewPath = filePath;
  currentInlinePreviewParentPath = null;
  updateInlinePreviewBackButton();
  updateInlinePreviewParentButton();

  // Loading placeholder while the registered handler renders.
  consolePreviewBody.innerHTML = `<div class="muted" style="padding:24px;text-align:center;font-size:12px;">Loading preview…  正在加载预览</div>`;

  try {
    const stat = typeof consoleShellClient?.statPath === "function"
      ? await consoleShellClient.statPath(filePath)
      : null;
    currentInlinePreviewParentPath = stat?.parentPath && stat.parentPath !== filePath ? stat.parentPath : null;
    updateInlinePreviewParentButton();
    if (stat?.isDirectory) {
      if (consolePreviewTitle) consolePreviewTitle.textContent = fileNameFromPath(filePath) || "Folder";
      if (consolePreviewMeta) consolePreviewMeta.textContent = filePath;
      await renderDirectoryPreviewInChat(filePath);
      return true;
    }
  } catch {
    // Fall through to format handlers; they will render a useful error.
  }

  if (typeof window.livePreviewClient?.render !== "function") {
    consolePreviewBody.innerHTML = `<div class="muted" style="padding:24px;text-align:center;">Inline preview is unavailable (registry not loaded).</div>`;
    return true;
  }

  try {
    await window.livePreviewClient.render(consolePreviewBody, {
      filePath,
      mime: mime ?? null,
      runtimeBaseUrl: state.serviceBaseUrl
    });
  } catch (error) {
    consolePreviewBody.innerHTML = `<div class="muted" style="padding:24px;text-align:center;">预览失败：${escapeHtml(error?.message ?? String(error))}</div>`;
  }
  return true;
}

consolePreviewBackBtn?.addEventListener("click", () => {
  const previous = inlinePreviewBackStack.pop();
  updateInlinePreviewBackButton();
  if (previous) void openInlinePreviewInChat({ filePath: previous, fromHistory: true });
});
consolePreviewParentBtn?.addEventListener("click", () => {
  if (currentInlinePreviewParentPath) {
    void openInlinePreviewInChat({ filePath: currentInlinePreviewParentPath });
  }
});

consolePreviewCloseBtn?.addEventListener("click", () => closeInlinePreview());
consolePreviewOpenExternalBtn?.addEventListener("click", async () => {
  // "Open external" closes the inline pane and routes through the
  // standard external open path (system associations / preview window).
  const path = currentInlinePreviewPath;
  closeInlinePreview();
  if (!path) return;
  try {
    if (typeof consoleShellClient?.openPath === "function") {
      await consoleShellClient.openPath(path);
    }
  } catch { /* ignore */ }
});

consolePreviewBody?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const revealBtn = target?.closest?.("[data-directory-entry-reveal]");
  if (revealBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void revealConversationArtifactPath(revealBtn.dataset.directoryEntryReveal ?? "");
    return;
  }
  const openBtn = target?.closest?.("[data-directory-entry-open]");
  if (openBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    void openInlinePreviewInChat({ filePath: openBtn.dataset.directoryEntryOpen ?? "" });
  }
});

// Override livePreview.openForFile so console-internal callers route to
// the inline pane. Other livePreview methods (openForTool / appendDelta /
// commit — used for live tool output) stay unchanged: tool output still
// streams to the dedicated preview window because that flow needs SSE
// support which the inline pane doesn't replicate.
if (window.livePreview && !window.livePreview._originalOpenForFile) {
  window.livePreview._originalOpenForFile = window.livePreview.openForFile;
}

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

const mcpDiscoveryState = {
  loaded: false,
  loading: false,
  query: "",
  results: [],
  error: ""
};

function mcpDiscoveryEntryById(id) {
  return mcpDiscoveryState.results.find((entry) => entry.id === id) ?? null;
}

function formatMcpDiscoveryConfigLine(entry = {}) {
  const required = Array.isArray(entry.requiredEnv) ? entry.requiredEnv.length : 0;
  const total = Array.isArray(entry.envRequirements) ? entry.envRequirements.length : required;
  if (required > 0) return `${required} required config`;
  if (total > 0) return `${total} optional config`;
  return "No required config";
}

function mergeMcpDiscoveryDraftWithDetected(entry = {}, detected = {}) {
  const draft = entry.serverDraft ?? {};
  const mergedEnv = {
    ...(draft.env ?? {}),
    ...(detected.env ?? {})
  };
  return {
    ...draft,
    ...detected,
    id: detected.id || draft.id || entry.id,
    displayName: entry.title || detected.displayName || draft.displayName || detected.id || draft.id || entry.id,
    transport: detected.transport || draft.transport || "stdio",
    command: detected.transport === "stdio" || (!detected.transport && draft.transport === "stdio")
      ? (detected.command ?? draft.command ?? null)
      : null,
    args: Array.isArray(detected.args) && detected.args.length
      ? detected.args
      : (Array.isArray(draft.args) ? draft.args : []),
    url: detected.transport && detected.transport !== "stdio"
      ? (detected.url ?? draft.url ?? null)
      : (!detected.transport && draft.transport !== "stdio" ? draft.url ?? null : null),
    env: Object.keys(mergedEnv).length ? mergedEnv : null,
    enabled: false
  };
}

function renderMcpDiscoveryResults() {
  if (!mcpRegistrySearchResults) return;
  if (mcpRegistrySearchState) {
    if (mcpDiscoveryState.loading) {
      mcpRegistrySearchState.textContent = "Searching...";
    } else if (mcpDiscoveryState.error) {
      mcpRegistrySearchState.textContent = `Search failed: ${mcpDiscoveryState.error}`;
    } else if (mcpDiscoveryState.loaded) {
      const count = mcpDiscoveryState.results.length;
      mcpRegistrySearchState.textContent = count ? `${count} MCP result${count === 1 ? "" : "s"}` : "No MCP results";
    } else {
      mcpRegistrySearchState.textContent = "";
    }
  }
  if (mcpDiscoveryState.loading && mcpDiscoveryState.results.length === 0) {
    mcpRegistrySearchResults.innerHTML = "";
    return;
  }
  if (!mcpDiscoveryState.results.length) {
    mcpRegistrySearchResults.innerHTML = "";
    return;
  }
  mcpRegistrySearchResults.innerHTML = mcpDiscoveryState.results.map((entry) => {
    const title = escapeHtml(entry.title ?? entry.id);
    const source = escapeHtml(entry.sourceLabel ?? entry.source ?? "MCP");
    const description = escapeHtml(entry.description ?? "");
    const packageLine = entry.packageSource
      ? `npm · ${entry.packageSource}`
      : entry.remoteUrl
        ? `remote · ${entry.remoteUrl}`
        : (entry.registryName ?? "registry entry");
    const installable = Boolean(entry.installable && (entry.packageSource || entry.serverDraft));
    const addLabel = entry.packageSource ? "Add" : entry.remoteUrl ? "Add remote" : "Unavailable";
    const openUrl = entry.repositoryUrl || entry.remoteUrl || "";
    return `
      <div class="mcp-discovery-card" data-mcp-discovery-card="${escapeHtml(entry.id)}">
        <div class="mcp-discovery-main">
          <div class="mcp-discovery-title">
            <strong>${title}</strong>
            <span class="pill pill-neutral">${source}</span>
          </div>
          ${description ? `<div class="mcp-discovery-desc">${description}</div>` : ""}
          <div class="mcp-discovery-meta">
            <span>${escapeHtml(packageLine)}</span>
            <span>${escapeHtml(formatMcpDiscoveryConfigLine(entry))}</span>
          </div>
        </div>
        <div class="mcp-discovery-actions">
          ${openUrl ? `<button class="btn btn-sm btn-ghost" type="button" data-mcp-discovery-open="${escapeHtml(openUrl)}">Open</button>` : ""}
          <button class="btn btn-sm btn-primary" type="button" data-mcp-discovery-add="${escapeHtml(entry.id)}" ${installable ? "" : "disabled"}>${escapeHtml(addLabel)}</button>
        </div>
      </div>
    `;
  }).join("");

  mcpRegistrySearchResults.querySelectorAll("[data-mcp-discovery-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const url = button.dataset.mcpDiscoveryOpen;
      if (url) void consoleShellClient?.openExternal?.(url);
    });
  });

  mcpRegistrySearchResults.querySelectorAll("[data-mcp-discovery-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = mcpDiscoveryEntryById(button.dataset.mcpDiscoveryAdd);
      if (entry) void installMcpDiscoveryEntry(entry, button);
    });
  });
}

async function searchMcpRegistryForConsole(query = "", { quiet = false } = {}) {
  if (!mcpRegistrySearchResults) return;
  const q = `${query ?? ""}`.trim();
  mcpDiscoveryState.loading = true;
  mcpDiscoveryState.error = "";
  mcpDiscoveryState.query = q;
  renderMcpDiscoveryResults();
  try {
    const response = await consoleConnectorsClient.searchMcpRegistry(q, 24);
    if (!response.ok) {
      throw new Error(response.payload?.message ?? response.payload?.error ?? "Registry search failed.");
    }
    const payload = response.payload ?? {};
    mcpDiscoveryState.results = Array.isArray(payload.results) ? payload.results : [];
    mcpDiscoveryState.loaded = true;
    if (payload.warning && !quiet) {
      showConsoleToast("MCP registry unavailable; showing curated results.", { kind: "warn" });
    }
  } catch (error) {
    mcpDiscoveryState.error = error?.message ?? String(error);
    if (!quiet) showConsoleToast(`MCP 搜索失败：${mcpDiscoveryState.error}`, { kind: "err" });
  } finally {
    mcpDiscoveryState.loading = false;
    renderMcpDiscoveryResults();
  }
}

function loadMcpDiscoveryFeatured() {
  if (mcpDiscoveryState.loaded || mcpDiscoveryState.loading) return;
  void searchMcpRegistryForConsole("", { quiet: true });
}

async function installMcpDiscoveryEntry(entry, button) {
  const original = button?.textContent ?? "";
  if (button) {
    button.disabled = true;
    button.textContent = "Adding...";
  }
  try {
    let server = null;
    if (entry.packageSource) {
      if (typeof consoleShellClient?.runMcpInstall !== "function") {
        throw new Error("Desktop install bridge unavailable.");
      }
      const result = assertShellResult(
        await consoleShellClient.runMcpInstall({
          source: entry.packageSource,
          id: entry.serverDraft?.id || entry.id
        }),
        "Could not install this MCP package."
      );
      server = mergeMcpDiscoveryDraftWithDetected(entry, result.server ?? {});
    } else if (entry.serverDraft) {
      server = mergeMcpDiscoveryDraftWithDetected(entry, entry.serverDraft);
    }
    if (!server?.id) {
      throw new Error("This MCP entry does not include an installable package or remote endpoint.");
    }
    await saveMcpServer(server);
    await loadConnectorsTab();
    showConsoleToast(`已添加：${entry.title ?? server.id}。请先配置/测试，再启用。`, { kind: "ok" });
  } catch (error) {
    showConsoleToast(`添加失败：${error?.message ?? error}`, { kind: "err" });
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function renderConnectorsMcpServers(servers) {
  if (!connectorsMcpList) return;
  connectorsMcpList.innerHTML = renderConnectorsMcpServersHtml(servers ?? [], { escapeHtml });

  // UCA-126: toggle switch replaces the Install/Disable button. Clicking
  // checkbox fires "change"; if the server needs configuration first we
  // open the config panel instead of flipping the API.
  connectorsMcpList.querySelectorAll("[data-mcp-install]").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.dataset.mcpInstall;
      const wantEnabled = input.checked;
      const cfgDiv = document.getElementById(`mcp-cfg-${id}`);
      // If turning ON a server that needs config but has none, divert
      // to the config flow and snap the toggle back off.
      if (wantEnabled && cfgDiv && input.dataset.mcpEnabled === "true") {
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
      if (cfgDiv) {
        cfgDiv.classList.add("open");
        cfgDiv.scrollIntoView({ behavior: "smooth", block: "center" });
        cfgDiv.querySelector("[data-mcp-cfg-input]")?.focus();
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

  connectorsMcpList.querySelectorAll("[data-mcp-test]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mcpTest;
      if (!id) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Testing...";
      try {
        const result = await testMcpServer(id);
        if (result.ok) {
          showConsoleToast("MCP 配置检测通过，可以启用。", { kind: "ok" });
          return;
        }
        const missing = Array.isArray(result.missingEnv) && result.missingEnv.length
          ? `缺少配置：${result.missingEnv.map((entry) => entry.name || entry.envKey).filter(Boolean).join(", ")}`
          : (result.detail ? `状态：${result.detail}` : result.error ?? "MCP 配置未通过检测");
        showConsoleToast(missing, { kind: "warn" });
      } catch (error) {
        showConsoleToast(`MCP 检测失败：${error?.message ?? error}`, { kind: "err" });
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  connectorsMcpList.querySelectorAll("[data-mcp-disable]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mcpDisable;
      if (!id) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Disconnecting...";
      try {
        await toggleMcpServer(id, false);
        await loadConnectorsTab();
        showConsoleToast("MCP 已断开连接。", { kind: "ok" });
      } catch (error) {
        btn.disabled = false;
        btn.textContent = original;
        showConsoleToast(`断开失败：${error?.message ?? error}`, { kind: "err" });
      }
    });
  });

  connectorsMcpList.querySelectorAll("[data-mcp-delete-card]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mcpDeleteCard;
      if (!id) return;
      const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(`Delete MCP server "${id}"?`)
        : true;
      if (!confirmed) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Deleting...";
      try {
        await deleteMcpServer(id);
        await refreshWorkspace();
        showConsoleToast("MCP 已删除。", { kind: "ok" });
      } catch (error) {
        btn.disabled = false;
        btn.textContent = original;
        showConsoleToast(`删除失败：${error?.message ?? error}`, { kind: "err" });
      }
    });
  });

  connectorsMcpList.querySelectorAll("[data-mcp-install-source-click]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const source = btn.dataset.mcpInstallSourceClick;
      if (!source || !mcpInstallSource) return;
      mcpInstallSource.value = source;
      mcpInstallSource.scrollIntoView({ behavior: "smooth", block: "center" });
      mcpInstallSource.focus();
      if (mcpInstallPlanSummary) {
        mcpInstallPlanSummary.hidden = true;
        mcpInstallPlanSummary.textContent = "";
      }
      setPreflightState(mcpInstallPlanState, "pending", "Review source, then run Plan.");
    });
  });

  connectorsMcpList.querySelectorAll("[data-plugin-guide]").forEach((button) => {
    button.addEventListener("click", () => {
      const url = button.dataset.pluginGuide;
      if (url) void consoleShellClient?.openExternal?.(url);
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
      const stateEl = document.getElementById(`mcp-cfg-state-${id}`);
      const cfgDiv = document.getElementById(`mcp-cfg-${id}`);
      const inputs = Array.from(cfgDiv?.querySelectorAll("[data-mcp-cfg-key]") ?? []);
      const values = {};
      const references = [];
      for (const input of inputs) {
        const key = `${input.dataset.mcpCfgKey ?? ""}`.trim();
        const value = `${input.value ?? ""}`.trim();
        if (!key) continue;
        if (!value) {
          if (stateEl) stateEl.textContent = "请输入值";
          input.focus();
          return;
        }
        values[key] = value;
        references.push({
          envKey: key,
          type: input.dataset.mcpCfgType ?? "env",
          name: input.dataset.mcpCfgName ?? ""
        });
      }
      if (Object.keys(values).length === 0) {
        if (stateEl) stateEl.textContent = "没有可保存的配置项";
        return;
      }
      if (stateEl) stateEl.textContent = "保存中…";
      try {
        await saveMcpServerConfig({ id, values, references });
        if (stateEl) { stateEl.textContent = "已保存。请先测试，再启用。"; setTimeout(() => { stateEl.textContent = ""; }, 3000); }
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
  bindConversationBranchButtons();
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

async function createConversationBranchFromDetail({
  conversationId,
  messageId,
  mode,
  content = null
} = {}) {
  if (!conversationId || !messageId || !mode) return;
  const result = await createConversationBranchRequest({
    conversationId,
    messageId,
    mode,
    content
  });
  const nextId = result?.conversation?.conversation_id;
  if (!nextId) return;
  conversationsState.selectedId = nextId;
  conversationsState.detail = null;
  conversationsState.items = [
    result.conversation,
    ...conversationsState.items.filter((conversation) => conversation.conversation_id !== nextId)
  ];
  renderConversationsList();
  await loadConversationDetail(nextId);
  chatSidebarCacheLoaded = false;
  void refreshChatSidebar({ force: true });
  showConsoleToast(mode === "edit" ? "已创建编辑分支" : mode === "rewind" ? "已创建回退分支" : "已创建分支", { kind: "ok" });
}

async function createConversationBranchRequest({
  conversationId,
  messageId,
  mode,
  content = null
} = {}) {
  if (!conversationId || !messageId || !mode) return null;
  const endpoint = mode === "edit"
    ? `/conversation/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/edit`
    : `/conversation/${encodeURIComponent(conversationId)}/${mode}`;
  const payload = mode === "edit"
    ? { content }
    : { through_message_id: messageId };
  return fetchJson(endpoint, runtimeJsonOptions("POST", payload, { actor: "desktop_console" }));
}

async function createConversationBranchFromChat({
  conversationId,
  messageId,
  mode,
  content = null
} = {}) {
  const result = await createConversationBranchRequest({
    conversationId,
    messageId,
    mode,
    content
  });
  const nextId = result?.conversation?.conversation_id;
  if (!nextId) return;
  conversationsState.items = [
    result.conversation,
    ...conversationsState.items.filter((conversation) => conversation.conversation_id !== nextId)
  ];
  conversationsState.selectedId = nextId;
  conversationsState.detail = null;
  renderConversationsList();
  chatSidebarCacheLoaded = false;
  await loadConsoleConversationFromBackend(nextId);
  void refreshChatSidebar({ force: true });
  showConsoleToast(mode === "edit" ? "已创建编辑分支" : mode === "rewind" ? "已创建回退分支" : "已创建分支", { kind: "ok" });
}

async function handleConsoleChatBranchAction(button) {
  const mode = button?.dataset?.chatBranchAction ?? "";
  const conversationId = button?.dataset?.conversationId ?? "";
  const messageId = button?.dataset?.messageId ?? "";
  if (!conversationId || !messageId || !["fork", "rewind", "edit"].includes(mode)) return;
  let content = null;
  if (mode === "edit") {
    const wrapper = button.closest(".chat-msg, .console-chat-message");
    const bubble = wrapper?.querySelector?.(".chat-msg-bubble, .console-chat-message-body");
    const current = bubble?.dataset?.rawText || bubble?.textContent || "";
    content = window.prompt("Edit message", current);
    if (content == null || !content.trim()) return;
  }
  button.disabled = true;
  try {
    await createConversationBranchFromChat({
      conversationId,
      messageId,
      mode,
      content
    });
  } catch (error) {
    showConsoleToast(error?.message ?? "Could not branch conversation.", { kind: "error" });
  } finally {
    button.disabled = false;
  }
}

function bindConversationBranchButtons() {
  const bodyEl = document.querySelector("#conversationsDetailBody");
  if (!bodyEl) return;
  for (const btn of bodyEl.querySelectorAll("[data-conversation-fork-message]")) {
    btn.addEventListener("click", () => {
      void createConversationBranchFromDetail({
        conversationId: btn.dataset.conversationId,
        messageId: btn.dataset.conversationForkMessage,
        mode: "fork"
      }).catch((error) => showConsoleToast(error?.message ?? "Could not fork conversation.", { kind: "error" }));
    });
  }
  for (const btn of bodyEl.querySelectorAll("[data-conversation-rewind-message]")) {
    btn.addEventListener("click", () => {
      void createConversationBranchFromDetail({
        conversationId: btn.dataset.conversationId,
        messageId: btn.dataset.conversationRewindMessage,
        mode: "rewind"
      }).catch((error) => showConsoleToast(error?.message ?? "Could not rewind conversation.", { kind: "error" }));
    });
  }
  for (const btn of bodyEl.querySelectorAll("[data-conversation-edit-message]")) {
    btn.addEventListener("click", () => {
      const messageId = btn.dataset.conversationEditMessage;
      const current = conversationsState.detail?.messages?.find((message) => message.message_id === messageId)?.content ?? "";
      const content = window.prompt("Edit message", current);
      if (content == null || !content.trim()) return;
      void createConversationBranchFromDetail({
        conversationId: btn.dataset.conversationId,
        messageId,
        mode: "edit",
        content
      }).catch((error) => showConsoleToast(error?.message ?? "Could not edit conversation.", { kind: "error" }));
    });
  }
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
    const {
      accountsResp,
      mcpResp,
      mcpDraftsResp,
      settingsResp,
      accountConnectorsResp,
      connectedResp
    } = await consoleConnectorsClient.loadConnectorsTabData();
    if (accountsResp.ok) {
      const { accounts } = accountsResp.payload;
      renderConnEmailAccounts(accounts);
    }
    if (mcpResp.ok) {
      const data = mcpResp.payload;
      renderConnectorsMcpServers(data.servers ?? []);
      loadMcpDiscoveryFeatured();
    }
    if (mcpDraftsResp.ok) {
      const data = mcpDraftsResp.payload;
      renderMcpDrafts(data.drafts ?? []);
    }
    if (settingsResp.ok) {
      const { settings } = settingsResp.payload;
      if (connDigestEnabled) connDigestEnabled.checked = settings.enabled !== false;
    }
    if (accountConnectorsResp.ok) {
      const { connectors } = accountConnectorsResp.payload;
      let connectedAccounts = [];
      if (connectedResp.ok) {
        const connected = connectedResp.payload;
        connectedAccounts = connected.accounts ?? [];
      }
      renderAccountConnectors(connectors ?? [], connectedAccounts);
    }
  } catch (err) {
    if (connEmailList) connEmailList.innerHTML = `<p class='muted' style='font-size:12px;'>Could not load: ${err.message}</p>`;
  }
}

// ── Account Connectors (Microsoft 365 / Google) ───────────────────────────────

let _acConfigOpen = {};   // { microsoft: bool, google: bool }

async function renderAccountConnectors(connectors, connectedAccounts = []) {
  const list = document.getElementById("accountConnectorsList");
  if (!list) return;
  // Skip-render guard: don't wipe an inline rename input mid-edit.
  if (shouldSkipRender(list, ".conn-row-edit")) return;
  // UCA-127: connector cards collapsed into single-line .conn-row entries
  // grouped under "Connected" / "Available providers" section labels
  // (settings-style). Bulky cards, capability tag strips, and per-card
  // default buttons now hide behind a ⋯ menu. Files/mail/calendar previews
  // live in the Inbox tab; this page is only the connection ledger.
  list.className = "conn-section-group";

  const html = [];
  if (connectedAccounts.length > 0) {
    html.push(renderAccountConnectorSectionLabelHtml("Connected", "已连接", connectedAccounts.length));
    html.push(...connectedAccounts.map((account) => renderConnectedAccountConnectorRowHtml(account)));
  }

  // Available providers section
  html.push(renderAccountConnectorSectionLabelHtml("Available providers", "可添加", countAvailableAccountConnectors(connectors)));

  for (const connector of connectors) {
    const type = connector.type;
    if (!ACCOUNT_CONNECTOR_META[type]) continue;
    let cfgData = { clientId: "", hasClientSecret: false };

    // ── Config panel (shown when user clicks "配置") ──
    if (_acConfigOpen[type]) {
      try {
        const r = await consoleConnectorsClient.fetchAccountConnectorConfig(type);
        if (r.ok) cfgData = r.payload;
      } catch { /* ignore */ }
      // UCA-127: config panel attaches as a sibling row below the conn-row
      // (full-width), so the row stays one line even when configuring.
    }

    // UCA-126: resource-strip (files/mail/calendar preview) retired from
    // connector cards. Those previews now live in the dedicated Inbox tab
    // with a sidebar account switcher — keeps Connectors cards focused on
    // connection status alone.
    html.push(renderAvailableAccountConnectorHtml(connector, {
      configOpen: Boolean(_acConfigOpen[type]),
      configData: cfgData
    }));
  }

  list.innerHTML = html.join("");

  // Wire events
  list.querySelectorAll("[data-acc-more-toggle]").forEach((moreBtn) => {
    const moreRoot = moreBtn.closest("[data-acc-more-root]");
    const moreMenu = moreRoot?.querySelector(".acc-more-menu");
    moreBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      moreMenu?.toggleAttribute("hidden");
    });
    document.addEventListener("click", (ev) => {
      if (!moreRoot?.contains(ev.target) && moreMenu && !moreMenu.hasAttribute("hidden")) {
        moreMenu.setAttribute("hidden", "");
      }
    });
  });
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
      consoleShellClient?.openExternal?.(a.dataset.externalUrl);
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
  const r = await consoleConnectorsClient.startConnectedAccountReauth(accountId);
  const data = r.payload ?? {};
  if (!r.ok) {
    alert(data.message ?? data.error ?? "启动重新授权失败。");
    return;
  }
  if (data.authUrl) {
    if (consoleShellClient?.openExternal) await consoleShellClient.openExternal(data.authUrl);
    else window.open(data.authUrl, "_blank");
  }
}

async function handleAccountConnect(type) {
  try {
    const r = await consoleConnectorsClient.startAccountAuth(type);
    const data = r.payload;
    if (!r.ok) {
      alert(data.message ?? data.error ?? "启动授权失败，请先配置 Client ID。");
      _acConfigOpen[type] = true;
      void loadConnectorsTab();
      return;
    }
    // Open the OAuth URL in the system browser
    if (consoleShellClient?.openExternal) {
      await consoleShellClient.openExternal(data.authUrl);
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
        const sr = await consoleConnectorsClient.listAccountConnectors();
        if (!sr.ok) return;
        const { connectors } = sr.payload;
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
        _inboxState.accounts = await consoleConnectorsClient.loadInboxAccounts();
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

function renderInboxAccounts() {
  const list = document.querySelector("#inboxAccountList");
  if (!list) return;
  list.innerHTML = renderInboxAccountsHtml(_inboxState.accounts, _inboxState.activeAccountId);
  if (_inboxState.accounts.length === 0) {
    list.querySelector("#inboxGoConnectorsBtn")?.addEventListener("click", () => {
      switchTab("connectors");
    });
    return;
  }
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
    content.innerHTML = renderInboxContentHtml(data, {
      activeTab: _inboxState.activeTab,
      isImap,
      expandedEmailId: _inboxState.expandedEmailId,
      fullBodyCache: _inboxState.fullBodyCache,
      htmlBodyCache: _inboxState.htmlBodyCache,
      bodyViewMode: _inboxState.bodyViewMode
    });
    if (_inboxState.activeTab === "emails" && !(isImap && data.reason)) {
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
              const r = await consoleConnectorsClient.fetchOAuthMessageBody(account.provider, id);
              if (!r.ok) return;
              const payload = r.payload;
              if (payload.status !== "success" || !payload.data) return;
              if (payload.data.bodyText) _inboxState.fullBodyCache.set(id, payload.data.bodyText);
              if (payload.data.bodyHtml) _inboxState.htmlBodyCache.set(id, payload.data.bodyHtml);
              if (_inboxState.expandedEmailId === id) renderInboxContent();
            } catch { /* silent */ }
          }
        });
      });
    }
    content.querySelectorAll("[data-external-url]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (btn.dataset.externalUrl) consoleShellClient?.openExternal?.(btn.dataset.externalUrl);
      });
    });
  }

  content.innerHTML = `<p class="inbox-empty">加载中…</p>`;
  try {
    const refreshResource = _inboxState.forceNext;
    _inboxState.forceNext = false;
    const resource = consoleConnectorsClient.describeInboxResource({
      account,
      activeTab: _inboxState.activeTab,
      refresh: refreshResource
    });
    const cached = refreshResource ? null : _inboxState.resourceCache.get(resource.cacheKey);
    if (cached && (Date.now() - cached.ts) < INBOX_RESOURCE_TTL_MS) {
      renderInboxPayload(cached.data);
      return;
    }

    const r = await consoleConnectorsClient.fetchInboxResource(resource);
    const cacheKey = r.cacheKey;
    const data = r.payload;
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
    if (url) void consoleShellClient?.openExternal?.(url);
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
mcpRegistrySearchBtn?.addEventListener("click", () => {
  void searchMcpRegistryForConsole(mcpRegistrySearchInput?.value ?? "");
});
mcpRegistrySearchInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void searchMcpRegistryForConsole(mcpRegistrySearchInput.value ?? "");
});
document.querySelectorAll("[data-mcp-search-chip]").forEach((button) => {
  button.addEventListener("click", () => {
    const query = button.dataset.mcpSearchChip ?? "";
    if (mcpRegistrySearchInput) mcpRegistrySearchInput.value = query;
    void searchMcpRegistryForConsole(query);
  });
});

// UCA-126 Phase 7d: chat composer richness — attachments, voice trigger,
// model chip label. Attach is local-file-picker + chips (passed into task
// context). Voice defers to the existing overlay voice mode via hotkey.

const consoleChatAttachmentsController = createConsoleChatAttachmentsController({
  attachButton: consoleChatAttachBtn,
  attachInput: consoleChatAttachInput,
  attachmentsEl: consoleChatAttachments,
  dropShell: document.querySelector(".console-chat-shell"),
  dropZone: document.querySelector("#consoleChatDropZone"),
  shell: consoleShellClient,
  escapeHtml,
  isImagePath: isImageArtifactPath,
  imageMimeFor
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
consoleChatVoiceBtn?.addEventListener("click", () => {
  if (typeof consoleShellClient?.openOverlayVoice !== "function") {
    showConsoleToast("按 Ctrl+Shift+V 开启语音", { kind: "info" });
    return;
  }
  consoleShellClient.openOverlayVoice({ mode: "voice", autoStart: true })
    .catch(() => showConsoleToast("按 Ctrl+Shift+V 开启语音", { kind: "info" }));
});

function updateChatModelChip() {
  if (!consoleChatModelChipLabel) return;
  const override = consoleActiveConversation?.metadata?.modelOverride ?? null;
  if (override?.providerId) {
    const provider = customProviders.find((item) => item.id === override.providerId);
    const providerLabel = provider?.name ?? override.providerId;
    const label = override.model ? `${providerLabel}:${override.model}` : providerLabel;
    consoleChatModelChipLabel.textContent = String(label).slice(0, 34);
    if (consoleChatModelChip) {
      consoleChatModelChip.title = `Conversation model: ${label}`;
    }
    return;
  }
  const routing = state.workspace?.routing ?? {};
  const chatTask = Array.isArray(routing.tasks) ? routing.tasks.find((t) => t?.id === "chat" || t?.id === "chat.reply") : null;
  const label = chatTask?.model || routing.default_model || "auto";
  consoleChatModelChipLabel.textContent = String(label).slice(0, 28);
  if (consoleChatModelChip) {
    consoleChatModelChip.title = configuredConversationModelProviders().length > 0
      ? "Change model for this conversation"
      : "Configure an AI provider to choose models";
  }
}
updateChatModelChip();

async function ensureConsoleConversationForModelOverride() {
  const currentId = consoleActiveConversation?.conversation_id ?? cacheCreateConversationId();
  const payload = await consoleSubmissionClient.createConversation({
    conversation_id: currentId,
    project_id: getConsoleChatSubmitProjectId(),
    title: consoleActiveConversation?.title ?? null,
    metadata: consoleActiveConversation?.metadata ?? {}
  });
  const conv = payload.conversation ?? { conversation_id: currentId };
  consoleActiveConversation = cacheEnsureBackendFields({
    ...consoleActiveConversation,
    conversation_id: conv.conversation_id,
    title: conv.title ?? consoleActiveConversation?.title ?? null,
    project_id: conv.project_id ?? consoleActiveConversation?.project_id ?? null,
    metadata: conv.metadata ?? consoleActiveConversation?.metadata ?? {}
  });
  renderConsoleChatHeader();
  renderChatSidebar();
  return consoleActiveConversation;
}

let consoleModelPickerEl = null;

function isProviderConfiguredForConversationModel(provider = {}) {
  return isModelPickerProviderConfigured(provider);
}

function configuredConversationModelProviders() {
  return configuredModelPickerProviders(customProviders);
}

function mergeOnboardingSuggestionsIntoWorkspace(suggestions = []) {
  const pending = state.workspace.onboarding?.pendingSuggestions ?? [];
  const byId = new Map(pending.map((suggestion) => [suggestion.id, suggestion]));
  for (const suggestion of suggestions) {
    if (suggestion?.id && suggestion.status !== "dismissed" && suggestion.status !== "completed") {
      byId.set(suggestion.id, {
        ...byId.get(suggestion.id),
        ...suggestion,
        status: suggestion.status ?? "pending"
      });
    }
  }
  state.workspace.onboarding = {
    ...(state.workspace.onboarding ?? {}),
    pendingSuggestions: [...byId.values()].sort((a, b) => `${a.id}`.localeCompare(`${b.id}`))
  };
  renderProviderOnboardingSuggestions();
}

function closeConsoleModelPicker() {
  consoleModelPickerEl?.remove();
  consoleModelPickerEl = null;
  document.removeEventListener("mousedown", handleConsoleModelPickerOutside, true);
  document.removeEventListener("keydown", handleConsoleModelPickerKeydown, true);
}

function handleConsoleModelPickerOutside(event) {
  if (!consoleModelPickerEl) return;
  if (consoleModelPickerEl.contains(event.target) || consoleChatModelChip?.contains(event.target)) return;
  closeConsoleModelPicker();
}

function handleConsoleModelPickerKeydown(event) {
  if (event.key === "Escape" && consoleModelPickerEl) {
    event.preventDefault();
    closeConsoleModelPicker();
  }
}

function positionConsoleModelPicker(popover) {
  const rect = consoleChatModelChip?.getBoundingClientRect?.();
  if (!rect) return;
  const width = Math.min(520, Math.max(360, window.innerWidth - 24));
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + window.scrollX));
  const opensAbove = rect.top > window.innerHeight * 0.55;
  const top = opensAbove
    ? rect.top + window.scrollY - 8
    : rect.bottom + window.scrollY + 8;
  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.transform = opensAbove ? "translateY(-100%)" : "none";
}

async function renderConsoleModelPicker(popover, providers, selectedProviderId) {
  const providerItems = buildModelPickerProviderItems(providers, selectedProviderId);
  const selectedItem = providerItems.find((item) => item.selected) ?? providerItems[0];
  const selectedProvider = selectedItem?.provider;
  if (!selectedProvider) return;
  if (selectedItem.configured) {
    await loadProviderModelOptions(selectedProvider.id);
  }
  const currentOverride = consoleActiveConversation?.metadata?.modelOverride ?? null;
  const currentModel = currentOverride?.providerId === selectedProvider.id
    ? currentOverride?.model ?? ""
    : "";
  const choices = selectedItem.configured ? modelChoicesForProvider(selectedProvider, "chat") : [];
  const fallbackModel = selectedItem.configured
    ? currentModel || defaultModelForProvider(selectedProvider, "chat") || choices[0]?.id || ""
    : "";
  const reasonOptions = selectedItem.configured ? reasoningEffortOptions(selectedProvider, fallbackModel) : [];
  const currentReasoning = currentOverride?.providerId === selectedProvider.id
    ? currentOverride?.reasoningEffort ?? ""
    : "";
  const selectedPanelHtml = selectedItem.configured
    ? `
        <label class="model-picker-field">
          <span>Model</span>
          <input data-model-custom-input type="text" value="${escapeHtml(fallbackModel)}" placeholder="${selectedProvider.kind === "code_cli" ? "(CLI default)" : "model id"}">
        </label>
        <div class="model-picker-list" aria-label="Model suggestions">
          ${choices.slice(0, 16).map((choice) => `
            <button type="button" class="model-picker-choice ${choice.id === fallbackModel ? "active" : ""}" data-model-choice="${escapeHtml(choice.id)}" title="${escapeHtml(modelChoiceTitle(choice))}">
              <span class="model-picker-choice-main">${escapeHtml(choice.label || choice.id || "(CLI default)")}</span>
              <span class="model-picker-choice-badges">${renderModelChoiceBadges(choice)}</span>
            </button>
          `).join("") || `<div class="model-picker-empty">No published list available. Enter a model ID manually.</div>`}
        </div>
        <label class="model-picker-field ${reasonOptions.length ? "" : "is-hidden"}">
          <span>Reasoning effort</span>
          <select data-model-reasoning>
            <option value="">Provider default</option>
            ${reasonOptions.map((option) => `
              <option value="${escapeHtml(option.id)}" ${option.id === currentReasoning ? "selected" : ""}>${escapeHtml(option.label ?? option.id)}</option>
            `).join("")}
          </select>
        </label>
      `
    : `
        <div class="model-picker-setup">
          <div class="model-picker-setup-title">Finish provider setup</div>
          <p>${escapeHtml(selectedItem.setupReason || "Finish this provider before using it for a conversation.")}</p>
          <button class="btn btn-primary btn-sm" type="button" data-model-configure-provider="${escapeHtml(selectedProvider.id)}">Configure provider</button>
        </div>
      `;
  const saveButtonHtml = selectedItem.configured
    ? `<button class="btn btn-primary btn-sm" type="button" data-model-save>Use for this chat</button>`
    : "";

  popover.innerHTML = `
    <div class="model-picker-head">
      <div>
        <div class="model-picker-title">Conversation model</div>
        <div class="model-picker-sub">Applies only to the current chat</div>
      </div>
      <button class="icon-btn" type="button" data-model-picker-close aria-label="Close">×</button>
    </div>
    <div class="model-picker-body">
      <div class="model-picker-providers" role="listbox" aria-label="Providers">
        ${providerItems.map((item) => `
          <button type="button" class="model-picker-provider ${item.selected ? "active" : ""} ${item.configured ? "" : "model-picker-provider--unconfigured"}" data-model-provider="${escapeHtml(item.id)}" aria-pressed="${item.selected ? "true" : "false"}">
            <span>${escapeHtml(item.label)}</span>
            <small>${escapeHtml(item.kind)} · ${escapeHtml(item.statusLabel)}</small>
          </button>
        `).join("")}
      </div>
      <div class="model-picker-panel">
        ${selectedPanelHtml}
        <div class="model-picker-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-model-clear>Use global routing</button>
          ${saveButtonHtml}
        </div>
      </div>
    </div>
  `;

  popover.querySelector("[data-model-picker-close]")?.addEventListener("click", closeConsoleModelPicker);
  popover.querySelectorAll("[data-model-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void renderConsoleModelPicker(popover, providers, btn.dataset.modelProvider);
    });
  });
  popover.querySelectorAll("[data-model-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = popover.querySelector("[data-model-custom-input]");
      if (input) input.value = btn.dataset.modelChoice ?? "";
      popover.querySelectorAll(".model-picker-choice").forEach((entry) => entry.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  popover.querySelectorAll("[data-model-configure-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeConsoleModelPicker();
      switchTab("settings");
      document.querySelector('[data-settings-nav="providerSettingsPanel"]')?.click?.();
      openProviderModal(btn.dataset.modelConfigureProvider || selectedProvider.id);
    });
  });
  popover.querySelector("[data-model-clear]")?.addEventListener("click", async () => {
    const conv = await ensureConsoleConversationForModelOverride();
    const cleared = await consoleSubmissionClient.clearConversationModel(conv.conversation_id);
    consoleActiveConversation = cacheEnsureBackendFields({
      ...consoleActiveConversation,
      metadata: cleared.conversation?.metadata ?? {}
    });
    updateChatModelChip();
    closeConsoleModelPicker();
    showConsoleToast("已恢复为全局 Task Routing。", { kind: "success" });
  });
  popover.querySelector("[data-model-save]")?.addEventListener("click", async () => {
    const input = popover.querySelector("[data-model-custom-input]");
    const reasoningSelect = popover.querySelector("[data-model-reasoning]");
    const model = `${input?.value ?? ""}`.trim();
    const conv = await ensureConsoleConversationForModelOverride();
    const saved = await consoleSubmissionClient.updateConversationModel(conv.conversation_id, {
      providerId: selectedProvider.id,
      model,
      mode: "default",
      reasoningEffort: `${reasoningSelect?.value ?? ""}`.trim() || undefined
    });
    consoleActiveConversation = cacheEnsureBackendFields({
      ...consoleActiveConversation,
      metadata: saved.conversation?.metadata ?? { modelOverride: saved.modelOverride ?? null }
    });
    if (saved.onboarding?.suggestions?.length) {
      mergeOnboardingSuggestionsIntoWorkspace(saved.onboarding.suggestions);
    }
    updateChatModelChip();
    closeConsoleModelPicker();
    showConsoleToast("当前对话的模型已切换。", { kind: "success" });
  });
}

async function chooseConsoleConversationModel() {
  await loadProvidersAndRouting();
  const allProviders = customProviders.filter((provider) => provider?.id);
  if (allProviders.length === 0) {
    showConsoleToast("先添加一个 AI Provider，然后就可以给当前对话切模型。", { kind: "info" });
    switchTab("settings");
    document.querySelector('[data-settings-nav="providerSettingsPanel"]')?.click?.();
    openProviderModal();
    return;
  }

  const currentOverride = consoleActiveConversation?.metadata?.modelOverride ?? null;
  const selectedProviderId = currentOverride?.providerId
    ?? configuredConversationModelProviders()[0]?.id
    ?? allProviders[0]?.id;
  closeConsoleModelPicker();
  const popover = document.createElement("div");
  popover.className = "model-picker-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Conversation model picker");
  document.body.appendChild(popover);
  consoleModelPickerEl = popover;
  positionConsoleModelPicker(popover);
  document.addEventListener("mousedown", handleConsoleModelPickerOutside, true);
  document.addEventListener("keydown", handleConsoleModelPickerKeydown, true);
  await renderConsoleModelPicker(
    popover,
    allProviders,
    selectedProviderId
  );
}

consoleChatModelChip?.addEventListener("click", () => {
  void chooseConsoleConversationModel().catch((error) => {
    showConsoleToast(`模型切换失败：${error.message}`, { kind: "error" });
  });
});

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
    wireFoldable(group, ":scope > .settings-group-head, :scope > .settings-group-title, :scope > .row:first-child");
  }
}
initFoldablePanelSections();

function initSectionNav({ selector, datasetKey }) {
  const navLinks = Array.from(document.querySelectorAll(selector));
  if (navLinks.length === 0) return;
  const setActive = (id) => {
    for (const link of navLinks) {
      link.classList.toggle("active", link.dataset[datasetKey] === id);
    }
  };
  const sectionForTarget = (target) =>
    target.closest?.(".settings-group, .panel-section") ?? target;
  for (const link of navLinks) {
    link.addEventListener("click", (ev) => {
      const id = link.dataset[datasetKey];
      const target = document.querySelector(`#${CSS.escape(id)}`);
      if (!target) return;
      ev.preventDefault();
      const section = sectionForTarget(target);
      if (section.getAttribute("data-foldable") === "true" && section.getAttribute("data-collapsed") === "true") {
        section.setAttribute("data-collapsed", "false");
        const head = section.querySelector(":scope > .settings-group-head, :scope > .settings-group-title, :scope > .row:first-child, :scope > .panel-section-header");
        if (head) head.setAttribute("aria-expanded", "true");
      }
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
    });
  }
  const panels = navLinks
    .map((l) => {
      const target = document.querySelector(`#${CSS.escape(l.dataset[datasetKey])}`);
      return target ? sectionForTarget(target) : null;
    })
    .filter(Boolean);
  if (panels.length > 0 && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const link = navLinks.find((entry) => {
        const target = document.querySelector(`#${CSS.escape(entry.dataset[datasetKey])}`);
        return target === visible.target || target?.closest?.(".settings-group, .panel-section") === visible.target;
      });
      if (link) setActive(link.dataset[datasetKey]);
    }, { rootMargin: "-20% 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] });
    for (const p of panels) io.observe(p);
  }
}

// UCA-125 Phase 3-3: Settings sub-nav — clicking an anchor un-collapses
// the target foldable (if any), scrolls it into view, and moves the
// "active" highlight to the clicked link. IntersectionObserver then
// tracks which panel is in view during manual scrolling so the nav
// reflects the current section without needing extra clicks.
initSectionNav({ selector: ".settings-nav [data-settings-nav]", datasetKey: "settingsNav" });
initSectionNav({ selector: ".connectors-nav [data-connectors-nav]", datasetKey: "connectorsNav" });

function initSettingsSearch() {
  if (!settingsSearchInput) return;
  const links = Array.from(document.querySelectorAll(".settings-nav [data-settings-nav]"));
  const sectionById = new Map(links.map((link) => {
    const id = link.dataset.settingsNav;
    return [id, document.getElementById(id)];
  }));
  const searchableText = (id, link, section) => [
    link?.textContent ?? "",
    section?.querySelector(".settings-group-title, .panel-section-title, h3")?.textContent ?? "",
    section?.id ?? id
  ].join(" ").toLowerCase();
  const apply = () => {
    const query = settingsSearchInput.value.trim().toLowerCase();
    for (const link of links) {
      const id = link.dataset.settingsNav;
      const section = sectionById.get(id);
      const match = !query || searchableText(id, link, section).includes(query);
      link.toggleAttribute("hidden", !match);
      if (section) section.toggleAttribute("hidden", !match);
    }
  };
  settingsSearchInput.addEventListener("input", apply);
}
initSettingsSearch();

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
  const notesRuntimeClient = createConsoleNotesRuntimeClient({
    notesHttpClient: createRuntimeHttpClient({ getBaseUrl: () => runtimeBaseUrl }),
    chatHttpClient: createRuntimeHttpClient({
      getBaseUrl: () => (typeof state === "object" && state?.serviceBaseUrl) || runtimeBaseUrl
    })
  });

  // ── Server-side notes sync (authoritative store) ──────────────────────
  // The runtime JSON store is authoritative. localStorage is now only a
  // first-paint cache so cross-window changes are never overwritten by an
  // older console snapshot.
  async function fetchNotesFromServer() {
    try {
      return await notesRuntimeClient.fetchNotes();
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
      return await deleteNoteViaShell(id);
    } catch {
      return null;
    }
  }

  async function restoreNoteOnServer(id) {
    try {
      const data = await restoreNoteViaShell(id);
      return data?.note ?? null;
    } catch {
      return null;
    }
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
    const deletedNote = { ...note };
    removeLocalNote(note.id);
    saveNotes();
    ensureSelection();
    renderList();
    renderEditor();
    const deletionPromise = deleteNoteOnServer(note.id);
    void deletionPromise;
    showConsoleToast("笔记已移到 Trash", {
      kind: "ok",
      durationMs: 7000,
      actionLabel: "Undo",
      onAction: async () => {
        await deletionPromise;
        const restored = await restoreNoteOnServer(deletedNote.id);
        upsertLocalNote(restored ?? deletedNote);
        notesState.selectedId = deletedNote.id;
        rememberSelection(deletedNote.id);
        renderList();
        renderEditor();
        void refreshNotesFromServer({ preserveSelection: true });
        showConsoleToast("笔记已恢复", { kind: "ok" });
      }
    });
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
    void writeConsoleClipboardText(text).catch(() => {});
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
    if (consoleShellClient?.notify) {
      try { consoleShellClient.notify({ title: "Notes", body: msg, kind: "info", autoHideMs: 2500 }); return; } catch { /* ignore */ }
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
    return notesRuntimeClient.completeChat(prompt);
  }

  // ── Voice note capture ────────────────────────────────────────────────
  voiceBtn?.addEventListener("click", () => {
    void openOverlayForNoteVoice();
  });

  async function openOverlayForNoteVoice() {
    if (typeof consoleShellClient?.openOverlayVoice !== "function") {
      toastNote("Voice notes are available from the global Ctrl+Shift+N shortcut.");
      return;
    }
    voiceBtn?.classList.add("is-active");
    try {
      const result = await consoleShellClient.openOverlayVoice({ mode: "note", autoStart: true });
      if (!result?.ok) {
        toastNote("Could not open the voice note recorder.");
      }
    } catch {
      toastNote("Could not open the voice note recorder.");
    } finally {
      voiceBtn?.classList.remove("is-active");
    }
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
