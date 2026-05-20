import {
  applyTaskEventPatch,
  formatTaskEventSummary,
  looksLikeInternalAssistantText,
  sanitizeAssistantVisibleText,
  subscribeTaskEvents,
  toTaskEventFrame
} from "./task-event-stream.js";
import {
  buildScheduleActionFromText,
  isScheduleIntentText,
  parseScheduleTriggerFromText
} from "./schedule-parser.js";
import {
  createConversationId as newConversationId,
  createClientMessageId,
  ensureBackendCacheFields as ensureBackendCacheFieldsBase,
  cssEscape as cssEscapeFor,
  applyMessageBatch as applyMessageBatchShared,
  fetchMessagesSince as fetchMessagesSinceShared
} from "./conversation-cache.mjs";
import {
  createBottomPinController,
  escapeHtml,
  formatArtifactLabel as formatSharedArtifactLabel,
  formatDateTime as formatSharedDateTime,
  formatRelativeTime
} from "./shared-ui.mjs";
import {
  createRuntimeHttpClient
} from "./shared/runtime-http-client.mjs";
import {
  createRuntimeTaskClient
} from "./shared/runtime-task-client.mjs";
import {
  createRuntimeSubmissionClient
} from "./shared/runtime-submission-client.mjs";
import {
  createRendererShellClient
} from "./shared/shell-client.mjs";
import {
  createEchoRuntimeClient
} from "./shared/echo-runtime-client.mjs";
import {
  hasStructuredChatBlocks,
  renderChatMessageBlocksHtml
} from "./chat-blocks.mjs";
import {
  formatToolArgsPreview,
  formatToolDisplayName
} from "./tool-display.mjs";
import {
  extractContentEvidenceFromTaskDetail,
  extractEvidenceSummaryFromMessage,
  renderContentEvidenceHtml,
  renderEvidenceSourcesHtml,
  renderToolCallSourcesHtml,
  revealEvidenceSource,
  wireEvidenceSourceActions
} from "./evidence-sources-view.mjs";
import {
  DEFAULT_PROJECT_ID,
  buildProject,
  createProjectId
} from "../../shared/project-store.mjs";
import {
  commandTargetsCurrentBrowserContext,
  commandTargetsCurrentFileContext
} from "../../shared/current-context-intent.mjs";
import {
  resolveOverlayContextSubmission
} from "../../shared/context-resolver.mjs";
import {
  buildConversationMessageContextSummary,
  conversationContextChips,
  conversationContextPreviewText,
  getConversationContextSummary
} from "../../shared/conversation-message-context.mjs";
import {
  collectLlmUsageSummary
} from "../../shared/llm-usage-summary.mjs";
import { describePermissionModeContract } from "../../shared/permission-mode-model.mjs";
import {
  selectPartialSuccessTaskMessage
} from "../../shared/partial-success-text.mjs";
import {
  buildOverlayProjectStore,
  ensureDefaultProjectInStore,
  ensureSystemProjectInStore,
  listConversationsForProject,
  mergeOverlayProjectStores,
  normalizeOverlayProjectStore,
  projectHasUnread as projectHasUnreadInStore,
  pruneProjectConversations
} from "./overlay-project-model.mjs";
import {
  AUTO_EMAIL_PROJECT_ID,
  AUTO_SCHEDULE_PROJECT_ID,
  automaticConversationKey,
  automaticProjectForTask,
  finalTextFromTaskDetail,
  isAutomaticResultTask,
  isEmailDigestTask,
  taskIdsForConversation,
  titleForAutomaticConversation
} from "./overlay-auto-tasks.mjs";
import {
  bindTaskToConversationId,
  resolveOverlayTaskEventVisibility,
  taskOwnerConversationId
} from "./overlay-task-routing.mjs";
import {
  describeAudioInputFailure,
  requestAudioInputStream
} from "./audio-device.mjs";
import {
  applyVoiceRecordingView,
  formatNoteElapsed,
  resetVoiceTranscriptView,
  setVoiceCardMode as setVoiceCardModeView
} from "./overlay-audio-view.mjs";

/* ── Theme sync (mirrors console theme via shared localStorage) ── */
const THEME_KEY = "uca-console-theme";
function syncOverlayTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY) ?? "default";
    if (t === "default") document.body.removeAttribute("data-theme");
    else document.body.setAttribute("data-theme", t);
  } catch { /* ignore */ }
}
syncOverlayTheme();

/* ── DOM refs ── */
const bubbleArea = document.querySelector("#bubbleArea");
const windowDragHandle = document.querySelector("#windowDragHandle");
const overlayResizeGrip = document.querySelector("#overlayResizeGrip");
const commandInput = document.querySelector("#commandInput");
const sendBtn = document.querySelector("#sendBtn");
const closeBtn = document.querySelector("#closeBtn");
const clipboardBtn = document.querySelector("#clipboardBtn");
const composerMicBtn = document.querySelector("#composerMicBtn");
// UCA-182 Phase 8: retired result-toast DOM. showToast() now routes
// every artifact notification through the top-right popup-card stack
// (see popup-card.js / popup-card-manager.mjs). Query refs intentionally
// removed so any accidental late use would surface as an undefined
// instead of silently painting into dead DOM.
const quickButtons = document.querySelectorAll("[data-quick-action]");
const scheduleToggleBtn = document.querySelector("#scheduleToggleBtn");
const schedulePanel = document.querySelector("#schedulePanel");
const scheduleWhenInput = document.querySelector("#scheduleWhen");
const scheduleNameInput = document.querySelector("#scheduleName");
const scheduleCommandInput = document.querySelector("#scheduleCommand");
const scheduleSaveBtn = document.querySelector("#scheduleSaveBtn");
const scheduleCancelBtn = document.querySelector("#scheduleCancelBtn");
const voiceToggleBtn = document.querySelector("#voiceToggleBtn");
const voiceCard = document.querySelector("#voiceCard");
const voiceLangSelect = document.querySelector("#voiceLang");
const voiceStartBtn = document.querySelector("#voiceStartBtn");
const voiceStopBtn = document.querySelector("#voiceStopBtn");
const voiceCancelBtn = document.querySelector("#voiceCancelBtn");
const voiceStatus = document.querySelector("#voiceStatus");
const voiceTranscript = document.querySelector("#voiceTranscript");
const voiceMinimizeBtn = document.querySelector("#voiceMinimizeBtn");
const tabVoiceBtn = document.querySelector("#tabVoiceBtn");
const tabNoteBtn = document.querySelector("#tabNoteBtn");
const noteTimer = document.querySelector("#noteTimer");
const noteMicTag = document.querySelector("#noteMicTag");
const noteSysTag = document.querySelector("#noteSysTag");
const noteTranscriptBox = document.querySelector("#noteTranscriptBox");
const noteLangSelect = document.querySelector("#noteLang");
const noteCancelBtn = document.querySelector("#noteCancelBtn");
const noteFinishBtn = document.querySelector("#noteFinishBtn");
const settingsBtn = document.querySelector("#settingsBtn");
const newSessionBtn = document.querySelector("#newSessionBtn");
const popBubble = document.querySelector("#popBubble");
const popLabel = document.querySelector("#popLabel");
const popBody = document.querySelector("#popBody");
const popOpenBtn = document.querySelector("#popOpenBtn");
const popCopyBtn = document.querySelector("#popCopyBtn");
const taskListDock = document.querySelector("#taskListDock");
const taskListDockBadge = document.querySelector("#taskListDockBadge");
const taskListPanel = document.querySelector("#taskListPanel");
const taskListBody = document.querySelector("#taskListBody");
const taskListCloseBtn = document.querySelector("#taskListCloseBtn");
const taskListFilterBtns = document.querySelectorAll("[data-task-filter]");

const bubbleAreaPin = createBottomPinController(bubbleArea, {
  button: document.querySelector("#bubbleScrollDown")
});

/* ── state ── */
let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";
const overlayRuntimeHttpClient = createRuntimeHttpClient({
  getBaseUrl: () => serviceBaseUrl
});
const overlayTaskClient = createRuntimeTaskClient({
  httpClient: overlayRuntimeHttpClient
});
const overlaySubmissionClient = createRuntimeSubmissionClient({
  httpClient: overlayRuntimeHttpClient,
  actor: "desktop_overlay"
});
const overlayShellClient = createRendererShellClient();
const overlayEchoClient = createEchoRuntimeClient({
  httpClient: overlayRuntimeHttpClient,
  actor: "desktop_overlay"
});
let activeTaskId = null;
let lastTask = null;
let pendingFileSelection = null;
let pendingCapture = null;
let pendingActiveWindowContext = null;
let pendingActiveWindowContextCapturedAt = 0;
const EXPLICIT_BROWSER_CONTEXT_FALLBACK_MAX_AGE_MS = 30 * 1000;
const VOICE_CONTEXT_FALLBACK_MAX_AGE_MS = 60 * 1000;
const NOTE_SOURCE_CONTEXT_MAX_AGE_MS = 60 * 1000;
let lastArtifactPath = null;
let autoOpenedArtifactTaskId = null;
let notifiedTaskId = null;
let notifiedInlineResultTaskId = null;
// Separate dedupe flag for the floating popup success card. The old
// notifiedTaskId guard runs AFTER the inline-result event has already
// flipped notifiedInlineResultTaskId, so success-card emission was being
// skipped for streaming conversational replies ("你好" style). This flag
// is set by whichever path actually shows the card first. Terminal events
// are still allowed to re-notify with the same task dedupe key so a short
// inline_result cannot permanently block the fuller success payload.
let popupSuccessCardTaskId = null;
let suppressOverlayAutoReveal = false;
let echoTaskIds = new Set();
let echoResultHudTaskIds = new Set();
let echoSessionId = null;
let pendingContinuationTaskId = null;
let pendingContinuationConversationId = null;

// Echo wake continuation window: when an echo-origin task completes, a wake
// within this many ms is treated as a follow-up to the SAME conversation
// AND task thread instead of starting a fresh one. After the window the
// next wake starts new again. This is the renderer-side approximation of
// the "post-result short-window continuation" pattern; if/when codex lands
// the main-owned EchoContextLease design, this window can be retired or
// kept as a fallback.
//
// Codex Round 1+2 review caught that setting only conversationId without
// taskId was a no-op: the /task POST path (line ~4055) only reads
// pendingContinuationConversationId WHEN pendingContinuationTaskId is set,
// so we now also remember lastEchoTaskId and seed both pending fields when
// the window fires.
const ECHO_CONTINUATION_WINDOW_MS = 30_000;
let lastEchoTaskCompletedAt = 0;
let lastEchoTaskConversationId = null;
let lastEchoTaskId = null;

// Echo TTS helpers. The /echo/speak route returns immediately (the engine
// races synthesis against a 300ms timeout) so these are safe to await
// without blocking the renderer's terminal-state handling.
async function postEchoSpeak(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return;
  try {
    await overlayEchoClient.speak(trimmed);
  } catch { /* ignore — speech is best-effort */ }
}

async function postEchoSpeakCancel() {
  try {
    await overlayEchoClient.cancelSpeak();
  } catch { /* ignore */ }
}

function speakEchoFinalIfApplicable(task, text) {
  // Only speak when the task came in via the echo wake path. Console-driven
  // chats and overlay-typed prompts get no audio reply, mirroring the
  // privacy default ("voice in → voice out, text in → text out").
  if (!task || !(isEchoTask(task.task_id) || isEchoOriginTask(task))) return;
  void postEchoSpeak(text);
}

function shouldSurfaceTaskPopupCards() {
  try {
    return document.visibilityState !== "visible";
  } catch {
    return true;
  }
}

function shouldAutoRevealTaskResult() {
  try {
    return popKeptOpen || document.visibilityState === "visible";
  } catch {
    return popKeptOpen;
  }
}

function fireSuccessPopupCardOnce(taskId, { title, body, autoHideMs = 8000, openWindow = null, terminal = false } = {}) {
  if (!taskId || (popupSuccessCardTaskId === taskId && !terminal)) return;
  if (!isEchoTask(taskId) && !shouldSurfaceTaskPopupCards()) return;
  popupSuccessCardTaskId = taskId;
  const fullBody = Array.isArray(body) ? body.filter(Boolean).join("\n") : String(body ?? "");
  const echoTask = isEchoTask(taskId);
  try {
    overlayShellClient?.notify?.({
      kind: "success",
      taskId,
      conversationId: taskOwnerConversationId(taskConversationMap, taskId) ?? conversationState?.id ?? null,
      title: title || "任务完成",
      body: echoTask ? fullBody : fullBody.slice(0, 160),
      inlinePreview: echoTask ? fullBody : null,
      allowLongBody: echoTask,
      forcePopup: echoTask,
      autoHideMs,
      openWindow,
      dedupeKey: `notify:${taskId}`
    });
  } catch { /* optional */ }
}

function rememberEchoTask(taskId) {
  if (!taskId) return;
  echoTaskIds.add(taskId);
}

function isEchoTask(taskId) {
  return Boolean(taskId && echoTaskIds.has(taskId));
}

function createEchoSessionId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `echo_${Date.now().toString(36)}_${random}`;
}

function isEchoOriginTask(task = null) {
  const metadata = task?.context_packet?.selection_metadata ?? task?.selection_metadata ?? {};
  return metadata?.submission_origin === "echo";
}

function isEchoOriginEventFrame(frame = {}) {
  const data = frame?.data ?? {};
  return data?.submission_origin === "echo" || Boolean(data?.voice_session_id);
}

function attachOverlaySubmissionMetadata(payload = {}) {
  const metadata = echoSessionActive
    ? {
        submission_origin: "echo",
        voice_session_id: echoSessionId || createEchoSessionId()
      }
    : {};
  if (metadata.voice_session_id && !echoSessionId) echoSessionId = metadata.voice_session_id;
  if (Object.keys(metadata).length === 0) return payload;
  const next = {
    ...payload,
    selectionMetadata: {
      ...(payload.selectionMetadata ?? {}),
      ...metadata
    }
  };
  if (next.contextPacket && typeof next.contextPacket === "object") {
    next.contextPacket = {
      ...next.contextPacket,
      selection_metadata: {
        ...(next.contextPacket.selection_metadata ?? {}),
        ...metadata
      }
    };
  }
  if (next.capture && typeof next.capture === "object") {
    next.capture = {
      ...next.capture,
      selectionMetadata: {
        ...(next.capture.selectionMetadata ?? {}),
        ...metadata
      }
    };
  }
  return next;
}

function compactEchoResultText(text = "") {
  const oneLine = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > 220 ? `${oneLine.slice(0, 220)}...` : oneLine;
}

function showEchoResultHudOnce(taskId, { text = "", title = "任务完成", kind = "success", durationMs = 9000 } = {}) {
  if (!isEchoTask(taskId) || echoResultHudTaskIds.has(taskId)) return;
  const body = compactEchoResultText(text);
  const label = compactEchoResultText(title);
  const hudText = body
    ? `${label ? `${label}: ` : ""}${body}\n在结果卡片按 V 或点“继续追问”；点卡片可打开对话框`
    : `${label || "任务完成"}\n在结果卡片按 V 或点“继续追问”；点卡片可打开对话框`;
  if (!hudText) return;
  echoResultHudTaskIds.add(taskId);
  try {
    void overlayShellClient?.showEchoBubble?.({
      text: hudText,
      kind,
      durationMs
    });
  } catch { /* optional */ }
}

function finishEchoTaskSurface(taskId) {
  if (!taskId) return;
  echoTaskIds.delete(taskId);
}

async function maybeRevealOverlay({ markEngaged = false } = {}) {
  if (suppressOverlayAutoReveal) return false;
  await overlayShellClient?.showWindow?.("overlay");
  if (markEngaged) markUserEngaged();
  return true;
}
let notifiedCompositeTaskId = null;
let selectedOutputSuffix = "";
let selectedFormatInstruction = "";
let lastArtifactPreview = "";
let lastArtifacts = [];
let activeTaskEventStream = null;
let activeTaskEventTaskId = null;
let activeTaskEventBaseUrl = null;
let handledTaskEventIds = new Set();
// Map every submitted task_id back to the conversation that owns it so task
// events route to the originating conversation's state even when the user
// has switched away. Without this, an async task's result lands in whichever
// conversation is visible when the SSE event arrives — which is the bug
// behind "两个任务跑完只剩一个结果，还跑到别的对话里".
const taskConversationMap = new Map(); // taskId -> conversationId
// Per-task SSE stream bookkeeping so multiple background tasks can stream
// concurrently. The old single activeTaskEventStream is still used for the
// conversation the user is currently looking at; we add silent streams for
// tasks belonging to other conversations so their results still land in the
// right place even if the user never switches back before completion.
const backgroundTaskStreams = new Map(); // taskId -> dispose function
let overlayViewGeneration = 0;
let renderedTimelineEventIds = new Set();
let streamingBubble = null;
let streamingBubbleRawText = "";
let pendingOverlayTextDeltaTaskId = null;
let pendingOverlayTextDeltaText = "";
let overlayTextDeltaRaf = 0;
let pendingOverlayThinkingDeltaText = "";
let overlayThinkingDeltaRaf = 0;
let pendingToolStepBubbles = {}; // { toolId: [stepEl, ...] } — updated by tool_call_completed
let renderedEvidenceSummaryTaskIds = new Set();
let renderedContentEvidenceTaskIds = new Set();
let activeClarificationBubble = null;
const approvalPopupCardIds = new Map(); // approvalId -> popup card id
const surfacedApprovalPopupIds = new Set();
const surfacingApprovalPopupIds = new Set();
let taskSummaries = [];
let taskListFilter = "all";
let lastTaskSummaryRefresh = 0;
let compositeHeaderTaskId = null;
const AUTO_TASK_SURFACED_KEY = "uca.overlay.autoTaskResults.v1";

function normalizeOverlayTaskId(taskId) {
  if (taskId === null || taskId === undefined) return null;
  const key = `${taskId}`.trim();
  return key.length > 0 ? key : null;
}

function sameOverlayTaskId(left, right) {
  const leftKey = normalizeOverlayTaskId(left);
  const rightKey = normalizeOverlayTaskId(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function advanceOverlayViewGeneration() {
  overlayViewGeneration += 1;
  return overlayViewGeneration;
}

function isOverlayViewGenerationCurrent(viewGeneration) {
  return viewGeneration === overlayViewGeneration;
}

function taskFrameVisibilityForCurrentOverlay(taskId, { viewGeneration = overlayViewGeneration } = {}) {
  if (!isOverlayViewGenerationCurrent(viewGeneration)) {
    return { render: false, ownerConversationId: null, reason: "stale_overlay_view_generation" };
  }
  return resolveOverlayTaskEventVisibility(taskConversationMap, {
    taskId,
    activeTaskId,
    currentConversationId: conversationState?.id ?? null
  });
}

function shouldRenderTaskFrameInCurrentOverlay(taskId, viewGeneration = overlayViewGeneration) {
  return taskFrameVisibilityForCurrentOverlay(taskId, { viewGeneration }).render;
}

function isActiveTaskRefreshCurrent(taskId, viewGeneration) {
  return sameOverlayTaskId(activeTaskId, taskId)
    && shouldRenderTaskFrameInCurrentOverlay(taskId, viewGeneration);
}

function bindWindowDeltaHandle(element, mode = "move") {
  if (!element) return;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const stop = () => {
    dragging = false;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", stop, true);
    window.removeEventListener("pointercancel", stop, true);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    const dx = event.screenX - lastX;
    const dy = event.screenY - lastY;
    lastX = event.screenX;
    lastY = event.screenY;
    if (dx === 0 && dy === 0) return;
    if (mode === "resize") {
      void overlayShellClient?.resizeWindowBy?.("overlay", dx, dy);
    } else {
      void overlayShellClient?.moveWindowBy?.("overlay", dx, dy);
    }
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    lastX = event.screenX;
    lastY = event.screenY;
    try { element.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    event.preventDefault();
  });
}

bindWindowDeltaHandle(windowDragHandle, "move");
bindWindowDeltaHandle(overlayResizeGrip, "resize");

/* ── conversational state ── */
let conversationPhase = "idle"; // idle | awaiting_options | done
let awaitingOptionType = null;  // "action" | "format" | null

/* ── conversation state (unified memory) ──
 * A single ongoing conversation with:
 *   seedCapture    — the original context (webpage selection, clipboard, etc.)
 *   seedCommand    — the first user prompt that started the thread
 *   turns          — [{role: "user"|"assistant", content, ts}]
 *
 * Each submitTask call appends the user's new message to `turns`; each
 * completed response appends an assistant turn. `turns` is persisted to
 * localStorage so a closed+reopened overlay resumes the same thread.
 * When `turns` grows past COMPRESS_TURN_LIMIT, the oldest middle turns are
 * collapsed into a single summary placeholder.
 */
/* ═══════════════════════════════════════════════
   UCA-041: PROJECTS + MULTI-CONVERSATION STORAGE v3
   ═══════════════════════════════════════════════ */

const STORAGE_KEY_V3 = "uca.overlay.projects.v3";
const LEGACY_STORAGE_KEY = "uca.overlay.conversation.v1";
const COMPRESS_TURN_LIMIT = 12;
const COMPRESS_KEEP_START = 2;
const COMPRESS_KEEP_END = 6;
const MAX_CAPTURE_TEXT_CHARS = 8000;
const MAX_CONVERSATIONS_PER_PROJECT = 50;
const PROJECT_COLORS = ["#6366f1", "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];

let projectStore = null;
let conversationState = null;
let projectStoreRemoteReady = false;
let projectStoreSyncInFlight = null;
// "unknown" before first attempt, then "online" or "offline". Used to notify
// the user exactly once when we transition into an offline state (don't spam
// a toast on every fire-and-forget persist call).
let projectSyncIndicatorState = "unknown";

function updateProjectSyncIndicator(success) {
  const prev = projectSyncIndicatorState;
  const next = success ? "online" : "offline";
  projectSyncIndicatorState = next;
  const btn = document.querySelector("#projectSelectorBtn");
  if (btn) {
    btn.classList.toggle("sync-offline", !success);
    btn.title = success
      ? "切换对话 / 查看历史会话"
      : "切换对话 / 查看历史会话（本地改动未同步到服务端，点击重试）";
  }
  if (!success && prev !== "offline") {
    // First transition into offline — let the user know their changes are
    // local-only. Subsequent failures stay silent until we recover and fail
    // again.
    try {
      addSystemBubble("对话/会话同步到服务端失败，本地仍会保留。恢复连接后点击「对话」按钮可重新同步。");
    } catch { /* addSystemBubble not yet initialized on early calls */ }
  }
}

function generateConversationTitle(conv) {
  if (!conv?.turns?.length) return "新会话";
  const first = conv.turns.find((t) => t.role === "user");
  return (first?.content ?? conv.seedCommand ?? "").slice(0, 30).trim() || "新会话";
}

function ensureDefaultProject() {
  projectStore = ensureDefaultProjectInStore(projectStore, {
    defaultProjectId: DEFAULT_PROJECT_ID,
    defaultColor: PROJECT_COLORS[0]
  });
}

function ensureSystemProject(projectId, name, color) {
  if (!projectStore) loadProjectStore();
  return ensureSystemProjectInStore(projectStore, projectId, name, color);
}

function projectHasUnread(projectId) {
  return projectHasUnreadInStore(projectStore, projectId);
}

function buildDefaultProjectStore() {
  return buildOverlayProjectStore({ defaultColor: PROJECT_COLORS[0] });
}

function normalizeProjectStore(store) {
  return normalizeOverlayProjectStore(store, { defaultColor: PROJECT_COLORS[0] });
}

function mergeProjectStores(localStore, remoteStore) {
  return mergeOverlayProjectStores(localStore, remoteStore, { defaultColor: PROJECT_COLORS[0] });
}

function updateConversationPointerFromStore() {
  conversationState = projectStore?.conversations?.find((c) => c.id === projectStore.currentConversationId) ?? null;
}

async function syncProjectStoreFromService({ render = false } = {}) {
  if (projectStoreSyncInFlight) return projectStoreSyncInFlight;
  projectStoreSyncInFlight = (async () => {
    try {
      if (!projectStore) loadProjectStore();
      const payload = await fetchJson("/projects/store");
      const merged = mergeProjectStores(projectStore, payload.store);
      projectStore = merged;
      updateConversationPointerFromStore();
      projectStoreRemoteReady = true;
      localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(projectStore));
      await saveProjectStoreViaShell(projectStore);
      if (render) {
        renderProjectPanel();
        if (conversationState?.turns?.length) renderConversationState();
      }
      updateProjectSyncIndicator(true);
    } catch {
      projectStoreRemoteReady = false;
      updateProjectSyncIndicator(false);
    } finally {
      projectStoreSyncInFlight = null;
    }
  })();
  return projectStoreSyncInFlight;
}

function persistProjectStoreToService() {
  if (!projectStore) return;
  void saveProjectStoreViaShell(projectStore).then(() => {
    projectStoreRemoteReady = true;
    updateProjectSyncIndicator(true);
  }).catch(() => {
    projectStoreRemoteReady = false;
    updateProjectSyncIndicator(false);
  });
}

function migrateV1ToV3() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.turns)) return null;
    const conv = { ...parsed, id: parsed.id || newConversationId(), projectId: DEFAULT_PROJECT_ID, title: generateConversationTitle(parsed) };
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return conv;
  } catch { return null; }
}

function loadProjectStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V3);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects) && Array.isArray(parsed.conversations)) {
        projectStore = parsed;
        ensureDefaultProject();
        conversationState = projectStore.conversations.find((c) => c.id === projectStore.currentConversationId) ?? null;
        return;
      }
    }
  } catch { /* rebuild */ }
  projectStore = buildDefaultProjectStore();
  ensureDefaultProject();
  const migrated = migrateV1ToV3();
  if (migrated) {
    projectStore.conversations.push(migrated);
    projectStore.currentConversationId = migrated.id;
    conversationState = migrated;
  }
}

function saveProjectStore() {
  try {
    if (!projectStore) return;
    pruneProjectConversations(projectStore, { maxPerProject: MAX_CONVERSATIONS_PER_PROJECT });
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(projectStore));
    persistProjectStoreToService();
  } catch { /* quota */ }
}

function switchConversation(convId) {
  const conv = projectStore?.conversations?.find((c) => c.id === convId);
  if (!conv) return;

  // Demote the outgoing conversation's live SSE stream to a silent background
  // stream so its task events (inline_result, success, etc.) still flow and
  // land in that conversation's turns list — even though the user is no
  // longer looking at it. Without this, switching away from a running task
  // drops every event after the switch point.
  demoteActiveStreamToBackground();
  advanceOverlayViewGeneration();

  conversationState = conv;
  if (conversationState.metadata?.unread) {
    conversationState.metadata = { ...(conversationState.metadata ?? {}), unread: false };
  }
  projectStore.currentConversationId = convId;
  projectStore.currentProjectId = conv.projectId;
  saveProjectStore();
  activeTaskId = conv.activeTaskId ?? null;
  lastTask = null; notifiedTaskId = null; notifiedInlineResultTaskId = null;
  popupSuccessCardTaskId = null;
  lastArtifactPath = null; lastArtifactPreview = ""; lastArtifacts = [];
  // If the conversation we're opening has a still-running task, reattach the
  // active stream so the user sees real-time updates again.
  if (activeTaskId) {
    ensureActiveTaskEventStream(activeTaskId);
  }
  // F2: rebuild from backend conversation_messages on conversation switch
  // instead of reading the localStorage `turns` cache as canonical.
  ensureBackendCacheFields(conversationState);
  void loadConversationFromBackend(conversationState.id);
}

function switchProject(projectId) {
  if (!projectStore) return;
  projectStore.currentProjectId = projectId;
  const convs = projectStore.conversations.filter((c) => c.projectId === projectId).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (convs.length) {
    switchConversation(convs[0].id);
  } else {
    advanceOverlayViewGeneration();
    conversationState = null;
    projectStore.currentConversationId = null;
    saveProjectStore();
    clearBubbles();
    showWelcome();
  }
}

function createProject(name, color) {
  if (!projectStore) loadProjectStore();
  const p = buildProject({
    id: createProjectId(),
    name: name || "新项目",
    color: color || PROJECT_COLORS[projectStore.projects.length % PROJECT_COLORS.length],
    metadata: {}
  });
  projectStore.projects.push(p);
  saveProjectStore();
  return p;
}

function deleteProject(projectId) {
  if (!projectStore || projectId === DEFAULT_PROJECT_ID) return;
  projectStore.projects = projectStore.projects.filter((p) => p.id !== projectId);
  projectStore.conversations = projectStore.conversations.filter((c) => c.projectId !== projectId);
  if (projectStore.currentProjectId === projectId) switchProject(DEFAULT_PROJECT_ID);
  saveProjectStore();
}

function deleteConversation(convId) {
  if (!projectStore) return;
  projectStore.conversations = projectStore.conversations.filter((c) => c.id !== convId);
  if (projectStore.currentConversationId === convId) {
    conversationState = null; projectStore.currentConversationId = null;
    const fallback = projectStore.conversations.filter((c) => c.projectId === projectStore.currentProjectId).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    if (fallback) {
      switchConversation(fallback.id);
    } else {
      advanceOverlayViewGeneration();
      clearBubbles();
      showWelcome();
    }
  }
  saveProjectStore();
}

function listConversationsForCurrentProject() {
  if (!projectStore) return [];
  return listConversationsForProject(projectStore, projectStore.currentProjectId || DEFAULT_PROJECT_ID);
}

function ensureConversation(seedCapture = null, seedCommand = null) {
  if (!projectStore) loadProjectStore();
  if (!conversationState) {
    const conv = {
      id: newConversationId(),
      projectId: projectStore.currentProjectId || DEFAULT_PROJECT_ID,
      title: "",
      seedCapture: seedCapture ? { ...seedCapture } : null,
      seedCommand: seedCommand ?? null,
      turns: [],
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
    projectStore.conversations.push(conv);
    projectStore.currentConversationId = conv.id;
    conversationState = conv;
    advanceOverlayViewGeneration();
  } else {
    if (!conversationState.seedCapture && seedCapture) conversationState.seedCapture = { ...seedCapture };
    if (!conversationState.seedCommand && seedCommand) conversationState.seedCommand = seedCommand;
  }
  return conversationState;
}

function currentOverlayProjectIdForSubmission() {
  if (!projectStore) loadProjectStore();
  return conversationState?.projectId
    ?? projectStore?.currentProjectId
    ?? DEFAULT_PROJECT_ID
    ?? null;
}

function attachOverlayProjectScope(payload = {}) {
  const projectId = currentOverlayProjectIdForSubmission();
  if (!projectId) return payload;
  const next = {
    ...payload,
    project_id: projectId,
    selectionMetadata: {
      ...(payload.selectionMetadata ?? {}),
      project_id: projectId
    }
  };
  if (next.contextPacket && typeof next.contextPacket === "object") {
    next.contextPacket = {
      ...next.contextPacket,
      selection_metadata: {
        ...(next.contextPacket.selection_metadata ?? {}),
        project_id: projectId
      }
    };
  }
  return next;
}

function appendTurn(role, content, opts = {}) {
  if (!content || typeof content !== "string") return null;
  ensureConversation();
  // F2: turns is now a transient UI cache. Backend conversation_messages
  // is the canonical store; localStorage projectStore keeps only project
  // metadata. compressIfNeeded is gone — backend ContextBudgetPolicy
  // owns history windowing.
  const turn = { role, content, ts: Date.now(), ...(opts.metadata ?? {}) };
  conversationState.turns.push(turn);
  conversationState.updatedAt = Date.now();
  if (!conversationState.title && role === "user") {
    conversationState.title = content.slice(0, 30).trim() || "新会话";
  }
  saveProjectStore();
  return turn;
}

// Route an assistant turn to whichever conversation owns this task — not
// necessarily the one currently visible. The visible conversation gets a
// bubble as a side effect; other conversations only get their turns list
// mutated (users see the reply when they switch back).
function appendTurnForTask(taskId, role, content) {
  if (!content || typeof content !== "string") return;
  const ownerConvId = taskOwnerConversationId(taskConversationMap, taskId);
  if (!ownerConvId) {
    if (shouldRenderTaskFrameInCurrentOverlay(taskId)) {
      appendTurn(role, content);
    }
    return;
  }
  if (!projectStore) {
    if (ownerConvId === conversationState?.id) {
      appendTurn(role, content);
    }
    return;
  }
  if (ownerConvId === conversationState?.id) {
    appendTurn(role, content);
    return;
  }
  const owner = projectStore.conversations.find((c) => c.id === ownerConvId);
  if (!owner) {
    return;
  }
  owner.turns = Array.isArray(owner.turns) ? owner.turns : [];
  owner.turns.push({ role, content, ts: Date.now() });
  owner.updatedAt = Date.now();
  if (!owner.title && role === "user") {
    owner.title = content.slice(0, 30).trim() || "新会话";
  }
  saveProjectStore();
  persistProjectStoreToService();
}

function bindTaskToConversation(taskId) {
  if (!taskId) return;
  ensureConversation();
  bindTaskToConversationId(taskConversationMap, taskId, conversationState.id);
  conversationState.activeTaskId = taskId;
  conversationState.updatedAt = Date.now();
  persistConversation();
}

function persistConversation() { saveProjectStore(); }

// ─── F2: Backend-backed conversation cache ───────────────────────────────────
// conversationState.turns is a transient UI cache only; the canonical
// conversation lives in the backend SQL store. The shared helpers
// (createClientMessageId / ensureBackendCacheFields / cssEscape /
// applyMessageBatch / fetchMessagesSince) are imported at the top of
// this file from conversation-cache.mjs so console.js can reuse the
// exact same reconcile pattern.

function ensureBackendCacheFields(conv) {
  const base = ensureBackendCacheFieldsBase(conv);
  if (base && !Array.isArray(base.turns)) base.turns = [];
  return base;
}

function markPendingUserMessage(clientMessageId, content, context = {}) {
  if (!clientMessageId || typeof content !== "string") return;
  const conv = ensureBackendCacheFields(conversationState);
  if (!conv) return;
  conv.pendingByClientId.set(clientMessageId, {
    role: "user",
    content,
    ts: Date.now()
  });
  const metadata = {
    client_message_id: clientMessageId,
    pending: true,
    ...(context.summary ? { context_summary: context.summary } : {})
  };
  appendTurn("user", content, { metadata });
  // Optimistic UI bubble — tagged with the client_message_id so the
  // reconcile pass can recognise it and avoid emitting a duplicate.
  const bubble = typeof addBubble === "function" ? addBubble("user", content, {
    contextChips: context.contextChips,
    contextPreview: context.contextPreview
  }) : null;
  if (bubble && bubble.dataset) {
    bubble.dataset.clientMessageId = clientMessageId;
    bubble.classList.add("pending");
  }
}

function clearPending(clientMessageId) {
  const conv = conversationState;
  if (conv?.pendingByClientId instanceof Map) {
    conv.pendingByClientId.delete(clientMessageId);
  }
}

function markPendingMessageFailed(clientMessageId, error) {
  if (!clientMessageId) return;
  const conv = conversationState;
  if (conv?.pendingByClientId instanceof Map) {
    conv.pendingByClientId.delete(clientMessageId);
  }
  const bubble = bubbleArea?.querySelector?.(`.bubble[data-client-message-id="${cssEscapeFor(clientMessageId)}"]`);
  if (bubble && bubble.dataset) {
    bubble.classList.remove("pending");
    bubble.classList.add("failed");
    bubble.dataset.status = "failed";
    if (error?.message) bubble.dataset.failureReason = String(error.message).slice(0, 200);
  }
}

// Overlay-specific UI adapter for the shared message classifier. The
// pure logic + lastKnownSeq / pendingByClientId bookkeeping lives in
// conversation-cache.mjs; this only describes how to materialise each
// classification into overlay DOM.
const overlayMessageAdapter = {
  onReconcilePending(message, clientMessageId) {
    const existing = bubbleArea?.querySelector?.(`.bubble[data-client-message-id="${cssEscapeFor(clientMessageId)}"]`);
    if (existing) {
      existing.dataset.messageId = message.message_id;
      existing.dataset.seq = String(message.seq);
      existing.classList.remove("pending");
    }
  },
  onAppend(message) {
    appendTurn(message.role, message.content);
    if (typeof addBubble === "function") {
      const taskId = message.task_id ?? message.taskId ?? message.metadata?.task_id ?? null;
      const bubble = addBubble(message.role, message.content, {
        taskId,
        ...conversationContextOptionsFromMessage(message)
      });
      if (bubble && bubble.dataset) {
        bubble.dataset.messageId = message.message_id;
        bubble.dataset.seq = String(message.seq);
      }
      const evidence = extractEvidenceSummaryFromMessage(message);
      if (evidence && (message.role === "assistant" || message.role === "system")) {
        appendOverlayEvidenceSources(taskId ?? message.message_id, evidence);
      }
    }
  },
  onSkip() { /* tool_summary / stale — no-op in chat */ }
};

function conversationContextOptionsFromMessage(message = {}) {
  const summary = getConversationContextSummary(message);
  if (!summary) return {};
  const chips = conversationContextChips(summary).map((chip) => ({
    label: chip.label,
    title: chip.title,
    kind: chip.kind,
    path: chip.path,
    url: chip.url,
    dismissable: false
  }));
  return {
    contextChips: chips,
    contextPreview: conversationContextPreviewText(summary)
  };
}

function conversationContextFromFilePaths(filePaths = [], {
  sourceType = "file_group",
  captureMode = "overlay"
} = {}) {
  const paths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
  if (!paths.length) return {};
  const summary = buildConversationMessageContextSummary({
    source_type: sourceType,
    capture_mode: captureMode,
    file_paths: paths
  });
  if (!summary) return {};
  return {
    summary,
    ...conversationContextOptionsFromMessage({ metadata: { context_summary: summary } })
  };
}

function applyBackendMessageToCache(message) {
  const conv = ensureBackendCacheFields(conversationState);
  if (!conv) return;
  applyMessageBatchShared(conv, { messages: [message] }, overlayMessageAdapter);
}

async function reconcileConversationFromBackend(convId, { fullRebuild = false } = {}) {
  if (!convId) return;
  const conv = ensureBackendCacheFields(conversationState);
  if (!conv || conv.id !== convId) return;
  // Snapshot the local turn cache BEFORE clearing so we can restore it if
  // (a) the user switched conversations during the fetch (race), or
  // (b) the backend has zero messages for this conversation id (legacy
  //     conversations from before the conversation_v1 migration, or the
  //     row was never registered server-side).
  const targetConvId = conv.id;
  const turnsSnapshot = Array.isArray(conv.turns) ? [...conv.turns] : [];
  if (fullRebuild) {
    conv.turns = [];
    conv.lastKnownSeq = -1;
    clearBubbles();
  }
  // F2 follow-up TODO: UI currently renders recent 200 messages only.
  // This is display pagination, not conversation memory truncation —
  // backend still has every message and Phase B's ContextBudgetPolicy
  // owns LLM history windowing. A "load earlier" button + virtualised
  // rendering for very long histories is a UX upgrade, not a memory
  // change.
  const sinceSeq = fullRebuild ? 0 : Math.max(0, conv.lastKnownSeq + 1);
  const payload = await fetchMessagesSinceShared(fetch.bind(globalThis), serviceBaseUrl, convId, { sinceSeq, limit: 200 });

  // Race guard: the user may have clicked another conversation while the
  // backend fetch was in flight. If so, applying these messages to the
  // bubble area would render conversation A's content into B's view. Drop
  // the visual update; restore turns we cleared so a later switch back to
  // A still has its local cache.
  if (conversationState?.id !== targetConvId) {
    if (fullRebuild) conv.turns = turnsSnapshot;
    return;
  }

  const hasMessages = payload && Array.isArray(payload.messages) && payload.messages.length > 0;
  if (!hasMessages) {
    // Backend returned nothing (404 / empty / network failure). For a full
    // rebuild we already wiped conv.turns + bubbles, so the user would see
    // a blank chat. Restore the local cache so old conversations stay
    // viewable until the backend catches up. Incremental updates (sinceSeq)
    // with no payload are no-ops.
    if (fullRebuild && turnsSnapshot.length > 0) {
      conv.turns = turnsSnapshot;
      for (const turn of turnsSnapshot) {
        const role = ["user", "assistant", "system"].includes(turn.role) ? turn.role : "system";
        addBubble(role, turn.content);
      }
    }
    return;
  }

  applyMessageBatchShared(conv, payload, overlayMessageAdapter);
}

async function loadConversationFromBackend(convId) {
  if (!convId) return;
  const conv = ensureBackendCacheFields(conversationState);
  if (!conv || conv.id !== convId) return;
  // Automatic conversations (scheduled task results, email digests) are
  // synthesised on the frontend — `appendAutomaticTurnToConversation` writes
  // their turns into projectStore but never registers them with the backend
  // conversations table. Calling reconcileConversationFromBackend on a
  // `conv_auto_*` id wipes the local turns (fullRebuild=true) and then
  // gets nothing back from the 404 — the user clicks the entry and the
  // chat area stays empty. Keep these locally rendered.
  if ((conv.metadata?.autoSource || conv.id?.startsWith("conv_auto_")) && conv.metadata?.backendCanonical !== true) {
    renderConversationState();
    return;
  }
  await reconcileConversationFromBackend(convId, { fullRebuild: true });
}
function restoreConversation() { loadProjectStore(); }

function renderConversationState() {
  clearBubbles();
  if (!conversationState?.turns?.length) { showWelcome(); return; }
  for (const turn of conversationState.turns) {
    const role = ["user", "assistant", "system"].includes(turn.role) ? turn.role : "system";
    addBubble(role, turn.content);
  }
}

function renderConversationFromState() {
  renderConversationState();
}

function startNewConversation({ preservePendingInputContext = false } = {}) {
  const preservedPendingFileSelection = preservePendingInputContext ? pendingFileSelection : null;
  const preservedPendingCapture = preservePendingInputContext ? pendingCapture : null;
  advanceOverlayViewGeneration();
  demoteActiveStreamToBackground();
  window.livePreview?.close?.();
  activeTaskId = null; lastTask = null; notifiedTaskId = null; notifiedInlineResultTaskId = null;
  popupSuccessCardTaskId = null;
  lastArtifactPath = null; autoOpenedArtifactTaskId = null;
  lastArtifactPreview = ""; lastArtifacts = [];
  selectedOutputSuffix = ""; selectedFormatInstruction = "";
  conversationPhase = "idle"; awaitingOptionType = null;
  conversationState = null;
  clearActiveClarificationBubble();
  if (projectStore) projectStore.currentConversationId = null;
  saveProjectStore();
  if (preservePendingInputContext) {
    pendingFileSelection = preservedPendingFileSelection;
    pendingCapture = preservedPendingCapture;
    pendingActiveWindowContext = null;
    pendingActiveWindowContextCapturedAt = 0;
    if (typeof renderVoiceChips === "function") renderVoiceChips();
  } else {
    clearPendingInputContext();
  }
  // Hard reset: drop the streaming bubble reference so clearBubbles()
  // doesn't preserve it into the new conversation. (Defensive guard in
  // clearBubbles keeps streaming visible during incidental wipes — but
  // a deliberate "new conversation" should sweep everything.)
  streamingBubble = null;
  streamingBubbleRawText = "";
  pendingOverlayTextDeltaTaskId = null;
  pendingOverlayTextDeltaText = "";
  pendingOverlayThinkingDeltaText = "";
  activeThinkingEl = null;
  activeThinkingText = "";
  clearBubbles();
  commandInput.value = "";
  autoSizeInput();
  showWelcome();
  commandInput.focus();
}

let lastShellHandoffAt = 0;

function beginShortcutCaptureSession(shortcutId = "") {
  if (Date.now() - lastShellHandoffAt < 800) return;
  startNewConversation();
  addSystemBubble(shortcutId === "capture-screenshot" ? "正在截图..." : "正在捕捉当前选择...");
  void maybeRevealOverlay({ markEngaged: true });
  commandInput.focus();
}

// Parent attachment is now conservative: backend conversation_messages carry
// broad context, while parent_task_id is only for clear continuations.
const SHORT_FOLLOWUP_REPLY_RE = /^(好|好的?|可以|继续|需要|要|对|是|是的|嗯|ok|okay|yes|sure|please)\s*[!.！。]?$/i;
const REFERENTIAL_FOLLOWUP_RE = /(^|\s)(上个|上一|刚才|之前|前面|那个|这个|这些|那些|它|它们|里面的|文件夹里的|图片里的|表格里的|文档里的|这张|那张|第一张|第二张|同样|一样|照这个|继续|再来|改一下|补充|加上|打开它|打开这个|打开那个)(\s|$|[，。！？,.!?])/i;
const ARTIFACT_VERB_RE = /(文件|文档|pptx?|docx?|xlsx?|pdf|导出|保存|打开|发送|分享|修改|edit|open|send|export|save|file|document)/i;

function shouldAttachParentTaskForCommand(commandText = "") {
  if (!conversationState?.lastCompletedTaskId) return false;
  const command = String(commandText ?? "").trim();
  if (!command) return false;

  if (SHORT_FOLLOWUP_REPLY_RE.test(command)) return true;
  if (REFERENTIAL_FOLLOWUP_RE.test(command)) return true;

  if (conversationState.lastArtifacts?.length && ARTIFACT_VERB_RE.test(command)) {
    return true;
  }

  return false;
}

function isCompositeChildTask(task = {}) {
  return Boolean(task?.parent_task_id) && Number.isInteger(task?.child_index);
}

function isNestedChildTask(task = {}) {
  if (!task) return false;
  if (isCompositeChildTask(task)) return true;
  return task.is_continuation === true && Boolean(task.parent_task_id);
}

function seedCaptureMatches(newText) {
  if (!conversationState?.seedCapture?.text) return false;
  const a = String(conversationState.seedCapture.text).trim().slice(0, 200);
  const b = String(newText ?? "").trim().slice(0, 200);
  return a && b && a === b;
}

/* ═══════════════════════════════════════════════
   BUBBLE RENDERING
   ═══════════════════════════════════════════════ */

function renderMarkdown(text) {
  return renderChatMessageBlocksHtml(text);
}

function imageMimeForPath(filePath = "") {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

function extractLocalImagePaths(text = "") {
  const matches = String(text).match(/[A-Za-z]:\\[^\r\n<>"]+?\.(?:png|jpe?g|gif|webp|bmp)/gi) ?? [];
  return [...new Set(matches.map((item) => item.replace(/[)\].,，。；;:：]+$/g, "")))];
}

function attachLocalImagePreviews(bubble, sourceText = "") {
  const paths = extractLocalImagePaths(sourceText);
  if (!paths.length || !overlayShellClient?.readFileAsDataUrl) return;
  for (const filePath of paths.slice(0, 4)) {
    const link = document.createElement("a");
    link.href = "#";
    link.className = "md-image-link";
    link.title = filePath;
    link.textContent = "正在加载图片预览...";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void overlayShellClient?.openPath?.(filePath);
    });
    bubble.appendChild(link);
    overlayShellClient.readFileAsDataUrl(filePath, imageMimeForPath(filePath))
      .then((dataUrl) => {
        const img = document.createElement("img");
        img.className = "md-image";
        img.src = dataUrl;
        img.alt = filePath.split(/[\\/]/).pop() || "image";
        link.textContent = "";
        link.appendChild(img);
      })
      .catch(() => {
        link.textContent = `打开图片：${filePath}`;
      });
  }
}

function hideEmptyState() {
  const el = document.getElementById("emptyState");
  if (el && el.getAttribute("aria-hidden") !== "true") {
    el.setAttribute("aria-hidden", "true");
  }
}

function showEmptyState() {
  const el = document.getElementById("emptyState");
  if (el) el.setAttribute("aria-hidden", "false");
}

// Build the per-assistant-bubble action row: "+ Note" (existing) and
// "↻ 重新生成" (new — asks the desktop shell to retry the task so the
// main process can attach the local actor header). Both buttons live in
// the same row so the layout stays compact. Idempotent: removes any
// prior action row before appending.
async function regenerateTask(taskId, btn) {
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
  } catch (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "重试失败";
      setTimeout(() => { btn.textContent = original ?? "↻ 重新生成"; }, 1600);
    }
    addSystemBubble?.(`重新生成失败：${error?.message ?? error}`);
  }
}

// Jump between user-sent bubbles in a long overlay thread. Mirrors
// console's navigateUserMessage. Wraps gracefully at either end.
function navigateUserBubble(currentEl, direction) {
  if (!bubbleArea || !currentEl) return;
  const all = [...bubbleArea.querySelectorAll(".bubble.user")];
  const idx = all.indexOf(currentEl);
  if (idx === -1) return;
  const target = direction === "prev" ? all[idx - 1] : all[idx + 1];
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("bubble--flash");
    setTimeout(() => target.classList.remove("bubble--flash"), 1100);
  }
}

function appendAssistantActions(bubble, content, taskId) {
  if (!bubble) return;
  bubble.querySelector(":scope > .bubble-note-actions")?.remove();
  if (taskId) bubble.dataset.taskId = taskId;

  const row = document.createElement("div");
  row.className = "bubble-note-actions";

  const addNoteBtn = document.createElement("button");
  addNoteBtn.type = "button";
  addNoteBtn.className = "bubble-note-btn";
  addNoteBtn.textContent = "＋ Note";
  addNoteBtn.title = "添加到 Notes";
  addNoteBtn.addEventListener("click", () => openOverlayNotePicker(content, addNoteBtn));
  row.appendChild(addNoteBtn);

  // Regenerate is gated on having a task id — replay history without an
  // associated task can't be retried, so we just hide the button rather
  // than show a non-functional one.
  if (taskId) {
    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "bubble-note-btn bubble-regen-btn";
    regenBtn.textContent = "↻ 重新生成";
    regenBtn.title = "用相同的输入重新生成回答";
    regenBtn.addEventListener("click", () => void regenerateTask(taskId, regenBtn));
    row.appendChild(regenBtn);
  }

  bubble.appendChild(row);
}

function appendOverlayErrorBlock(taskId, payload = {}, { cancelled = false } = {}) {
  if (!bubbleArea) return null;
  const key = taskId || payload.task_id || payload.taskId || activeTaskId || "";
  if (key && bubbleArea.querySelector(`.chat-inline-error[data-task-id="${CSS.escape(key)}"]`)) {
    return null;
  }
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

  const head = document.createElement("div");
  head.className = "cie-head";
  const icon = document.createElement("span");
  icon.className = "cie-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  const title = document.createElement("span");
  title.className = "cie-title";
  title.textContent = cancelled ? "任务已取消" : "任务失败";
  head.append(icon, title);
  if (category) {
    const categoryEl = document.createElement("span");
    categoryEl.className = "cie-category";
    categoryEl.textContent = category;
    head.appendChild(categoryEl);
  }
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "cie-body";
  body.textContent = message;
  card.appendChild(body);

  if (recoveryHint) {
    const hint = document.createElement("div");
    hint.className = "cie-recovery";
    hint.textContent = recoveryHint;
    card.appendChild(hint);
  }

  if (policyBits.length > 0) {
    const policy = document.createElement("div");
    policy.className = "cie-policy";
    for (const item of policyBits) {
      const chip = document.createElement("span");
      chip.textContent = item;
      policy.appendChild(chip);
    }
    card.appendChild(policy);
  }

  if (actions.length > 0) {
    const list = document.createElement("ul");
    list.className = "cie-actions";
    for (const item of actions) {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  if (retryable && key) {
    const footer = document.createElement("div");
    footer.className = "cie-footer";
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "bubble-note-btn cie-retry";
    retryBtn.textContent = "重试";
    retryBtn.addEventListener("click", async () => {
      const original = retryBtn.textContent;
      retryBtn.disabled = true;
      retryBtn.textContent = "重试中…";
      try {
        await retryTaskViaShell(key, { mode: "retry_same" });
        retryBtn.textContent = "已发起";
      } catch (error) {
        retryBtn.disabled = false;
        retryBtn.textContent = "重试失败";
        addSystemBubble(`重试失败：${error?.message ?? error}`);
        setTimeout(() => { retryBtn.textContent = original ?? "重试"; }, 1600);
      }
    });
    footer.appendChild(retryBtn);
    card.appendChild(footer);
  }

  addBubble("system", card, { taskId: key || null });
  bubbleAreaPin.maybeScrollToBottom();
  return card;
}

function addBubble(role, content, options) {
  bubbleArea.hidden = false;
  hideEmptyState();
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  // Screen readers get a clear prefix per bubble role. The aria-live region
  // on the parent handles announcement; we just label the origin.
  const roleLabels = { user: "你", assistant: "助手", system: "系统提示", step: "任务进展" };
  if (roleLabels[role]) {
    bubble.setAttribute("aria-label", `${roleLabels[role]}：`);
  }

  if (typeof content === "string") {
    bubble.dataset.rawText = content;
    if (role === "assistant") {
      bubble.innerHTML = renderMarkdown(content);
      // Apply the "answer" layout (accent bar + richer typography) whenever
      // the reply is either structured (has headings / code / lists) or just
      // long enough to benefit from the extra spacing. Empirically the old
      // 240-char threshold was too aggressive — most helpful replies (explain
      // a concept, list 3-5 steps) landed at 80–220 chars and still looked
      // cramped in the plain bubble. Drop to 80 + include bullet/numbered
      // list detection.
      const rendered = bubble.innerHTML;
      const hasMarkdownStructure =
        rendered.includes("md-h") ||
        rendered.includes("md-code") ||
        rendered.includes("md-table") ||
        rendered.includes("md-diagram") ||
        rendered.includes("md-svg") ||
        rendered.includes("md-list-item") ||
        rendered.includes("md-gap");
      const isStructured = hasMarkdownStructure || hasStructuredChatBlocks(content) || content.length > 80;
      if (isStructured) bubble.classList.add("bubble--answer");
      // Wire clickable links to open_url
      for (const anchor of bubble.querySelectorAll("[data-open-url]")) {
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          const url = anchor.dataset.openUrl;
          if (url) {
            overlayShellClient?.openUrl?.(url, { ask: true, source: "overlay_chat" })
              ?? overlayShellClient?.openExternal?.(url);
          }
        });
      }
      // Copy-to-clipboard for fenced code blocks
      for (const btn of bubble.querySelectorAll("[data-md-copy]")) {
        btn.addEventListener("click", async () => {
          const codeEl = btn.parentElement?.querySelector("pre code");
          if (!codeEl) return;
          const code = codeEl.textContent ?? "";
          try {
            await overlayShellClient?.writeClipboardText?.(code);
            btn.textContent = "已复制";
            setTimeout(() => { btn.textContent = "复制"; }, 1400);
          } catch { /* ignore */ }
        });
      }
      attachLocalImagePreviews(bubble, content);
      appendAssistantActions(bubble, content, options?.taskId ?? activeTaskId ?? null);
    } else {
      bubble.textContent = content;
    }
  } else {
    bubble.appendChild(content);
  }

  // Per-user-message ↑/↓ jump nav. Hover-only. Lets the user step
  // back to a previous prompt in a long thread without scrolling
  // manually — particularly useful when tool-step bubbles fill the
  // gap between answers.
  if (role === "user") {
    const nav = document.createElement("div");
    nav.className = "bubble-nav";
    nav.innerHTML = `
      <button type="button" class="bubble-nav-btn" data-nav="prev" title="上一个问题" aria-label="上一个问题">↑</button>
      <button type="button" class="bubble-nav-btn" data-nav="next" title="下一个问题" aria-label="下一个问题">↓</button>
    `;
    nav.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-nav]");
      if (!btn) return;
      navigateUserBubble(bubble, btn.dataset.nav);
    });
    bubble.appendChild(nav);
  }

  if (options?.optionButtons) {
    const optRow = document.createElement("div");
    optRow.className = "bubble-options";
    for (const opt of options.optionButtons) {
      const btn = document.createElement("button");
      btn.textContent = opt.label;
      btn.type = "button";
      if (opt.active) btn.classList.add("active");
      btn.addEventListener("click", () => {
        for (const sibling of optRow.querySelectorAll("button")) {
          sibling.classList.remove("active");
        }
        btn.classList.add("active");
        opt.onClick?.();
      });
      optRow.appendChild(btn);
    }
    bubble.appendChild(optRow);
  }

  if (options?.contextChips) {
    const chipRow = document.createElement("div");
    chipRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;";
    for (const chip of options.contextChips) {
      const el = document.createElement(chip.path || chip.url ? "button" : "span");
      el.className = "context-chip";
      if (chip.path || chip.url) {
        el.type = "button";
        el.classList.add("context-chip-action");
      }
      el.textContent = chip.label;
      if (chip.title) el.title = chip.title;
      if (chip.path) {
        el.dataset.contextOpenPath = chip.path;
        el.dataset.contextKind = chip.kind ?? "file";
      }
      if (chip.url) el.dataset.contextOpenUrl = chip.url;
      if (chip.dismissable) {
        const x = document.createElement("button");
        x.className = "dismiss";
        x.textContent = "\u00d7";
        x.addEventListener("click", () => {
          chip.onDismiss?.();
          el.remove();
        });
        el.appendChild(x);
      }
      chipRow.appendChild(el);
    }
    bubble.appendChild(chipRow);
  }

  if (options?.contextPreview) {
    const preview = document.createElement("div");
    preview.className = "context-preview";
    preview.textContent = options.contextPreview;
    bubble.appendChild(preview);
  }

  // Per-bubble timestamp footer. Only meaningful for user / assistant
  // messages; system / step / timeline bubbles already carry their own
  // status line and would just gain noise.
  if (role === "user" || role === "assistant") {
    appendBubbleTimestamp(bubble, options?.ts);
  }

  bubbleArea.appendChild(bubble);
  bubbleAreaPin.maybeScrollToBottom();
  trimBubbleOverflow();
  return bubble;
}

// Long sessions can accumulate hundreds of bubbles, bloating DOM + memory. Cap
// at BUBBLE_SOFT_CAP; when exceeded, drop the oldest bubbles but never prune
// the currently active timeline or streaming bubble (those hold live refs).
const BUBBLE_SOFT_CAP = 120;
const BUBBLE_TRIM_TO = 80;
let bubbleOverflowNoticeShown = false;
function trimBubbleOverflow() {
  if (!bubbleArea) return;
  const children = bubbleArea.children;
  if (children.length <= BUBBLE_SOFT_CAP) return;

  let removed = 0;
  const toRemove = children.length - BUBBLE_TRIM_TO;
  // Walk from the start and remove, skipping live-referenced bubbles.
  let i = 0;
  while (removed < toRemove && i < children.length) {
    const node = children[i];
    if (node === timelineBubble || node === streamingBubble) {
      i += 1;
      continue;
    }
    node.remove();
    removed += 1;
    // don't advance i — children shifted left
  }

  if (removed > 0 && !bubbleOverflowNoticeShown) {
    bubbleOverflowNoticeShown = true;
    // One-time, non-intrusive notice injected at the very top.
    const notice = document.createElement("div");
    notice.className = "bubble system";
    notice.style.cssText = "opacity:0.7;font-size:11px;text-align:center;";
    notice.textContent = "…较早的消息已隐藏以保持性能（完整历史仍保存在会话里）";
    bubbleArea.insertBefore(notice, bubbleArea.firstChild);
  }
}

function addSystemBubble(text) {
  return addBubble("system", text);
}

function clearBubbles() {
  // Defensive: preserve an in-progress streaming bubble across clears.
  // Without this guard, any code path that calls clearBubbles() while
  // text_delta frames are still arriving (project-store sync with
  // render=true, conversation reconcile, focus-driven re-render, etc.)
  // silently wipes the user's mid-stream answer — the JS reference
  // sticks around but the DOM node is gone, so future text_delta
  // updates write into a detached node and the user sees their reply
  // vanish. Hard-reset paths (startNewConversation, closeActiveTask-
  // EventStream) explicitly null streamingBubble first so they still
  // wipe cleanly.
  const liveStream = streamingBubble?.classList?.contains("streaming")
    ? streamingBubble
    : null;
  bubbleArea.innerHTML = "";
  bubbleArea.hidden = true;
  if (liveStream) {
    bubbleArea.appendChild(liveStream);
    bubbleArea.hidden = false;
  }
  showEmptyState();
  // timeline bubble lives inside bubbleArea, so innerHTML="" already removed it;
  // just clear the JS references
  timelineBubble = null;
  timelineBodyEl = null;
  pendingToolStepBubbles = {};
  renderedTimelineEventIds = new Set();
  renderedEvidenceSummaryTaskIds = new Set();
  renderedContentEvidenceTaskIds = new Set();
  timelineLabelEl = null;
  timelinePhaseEl = null;
  timelineSpinnerEl = null;
  timelineUsageEl = null;
  overlayLlmUsageEventsByTaskId.clear();
  timelineStepCount = 0;
  timelinePhaseRank = 0;
  timelineStartedAt = 0;
  runtimeStepIndex = 0;
  runtimeStepTotal = 0;
  bubbleOverflowNoticeShown = false;
  closeActiveThinkingCard();
}

/* ═══════════════════════════════════════════════
   EXECUTION TIMELINE  (inline bubble inside bubbleArea)
   ═══════════════════════════════════════════════ */

let timelineBubble = null;
let timelineBodyEl = null;
let timelineLabelEl = null;
let timelinePhaseEl = null;
let timelineSpinnerEl = null;
let timelineStepCount = 0;
let timelineUsageEl = null;
const overlayLlmUsageEventsByTaskId = new Map();
// Stamp the wall-clock time when the timeline first opens. Used to
// render "+2.3s" relative timestamps next to each step so the user can
// spot slow stages at a glance. Reset by clear* paths.
let timelineStartedAt = 0;
// Per-task step counter for the progress suffix ("第 3/7 步"). Counts
// only real backend steps (step_started events), not timeline rows. The
// total stays unknown until the backend hints it via payload.step_total
// — when it does, the suffix promotes from "第 3 步" to "第 3/7 步".
let runtimeStepIndex = 0;
let runtimeStepTotal = 0;

function formatStepDelta(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 10_000) return `+${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `+${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `+${m}m${s}s` : `+${m}m`;
}

function timelineEnsure() {
  if (timelineBubble) return;

  const bubble = document.createElement("div");
  bubble.className = "bubble system";
  bubble.style.cssText = "padding:0;overflow:hidden;";

  // ── header row ──
  const header = document.createElement("div");
  header.style.cssText = [
    "display:flex;align-items:center;gap:6px;padding:7px 10px;",
    "cursor:pointer;user-select:none;font-size:11px;",
    "color:var(--muted,rgba(0,0,0,0.45));letter-spacing:0.01em;"
  ].join("");

  const toggleIcon = document.createElement("span");
  toggleIcon.style.cssText = "font-size:9px;transition:transform 0.18s;transform:rotate(90deg);";
  toggleIcon.textContent = "▶";

  const spinnerEl = document.createElement("span");
  spinnerEl.className = "tl-particles";
  for (let i = 0; i < 6; i++) {
    const dot = document.createElement("span");
    dot.className = "p";
    spinnerEl.appendChild(dot);
  }

  const labelEl = document.createElement("span");
  labelEl.textContent = "执行中…";

  // Phase chip — Planning → Executing → Finalizing → Done. Updated by
  // setTimelinePhase based on the most recent event class so the user
  // can see at a glance whether the agent is still planning or already
  // composing the answer. Falls back to invisible until the first
  // phase-emitting event lands.
  const phaseEl = document.createElement("span");
  phaseEl.className = "tl-phase";
  phaseEl.style.cssText = [
    "margin-left:auto;padding:1px 8px;border-radius:999px;",
    "background:rgba(91,107,122,0.12);",
    "color:var(--ink,rgba(0,0,0,0.62));",
    "font-size:10px;letter-spacing:0.04em;text-transform:uppercase;",
    "opacity:0;transition:opacity 160ms;"
  ].join("");
  phaseEl.textContent = "";

  header.append(toggleIcon, spinnerEl, labelEl, phaseEl);

  // ── step body ──
  // No inner scroll — the previous max-height: 160px + overflow-y: auto
  // created a nested scroll container, so wheeling over a long step list
  // would trap inside the timeline instead of moving the conversation.
  // Long timelines now flow naturally; the user scrolls the outer
  // bubbleArea, and the collapse toggle still hides the body wholesale.
  const bodyEl = document.createElement("div");
  bodyEl.style.cssText = [
    "padding:2px 10px 8px 10px;",
    "display:flex;flex-direction:column;gap:2px;"
  ].join("");

  // toggle open/close on header click
  let tlOpen = true;
  header.addEventListener("click", () => {
    tlOpen = !tlOpen;
    bodyEl.style.display = tlOpen ? "" : "none";
    toggleIcon.style.transform = tlOpen ? "rotate(90deg)" : "";
  });

  bubble.append(header, bodyEl);
  bubbleArea.appendChild(bubble);
  bubbleArea.hidden = false;
  bubbleAreaPin.maybeScrollToBottom();

  timelineBubble = bubble;
  timelineBodyEl = bodyEl;
  timelineLabelEl = labelEl;
  timelinePhaseEl = phaseEl;
  timelineSpinnerEl = spinnerEl;
  timelineStartedAt = Date.now();
}

function timelineDone(summaryText) {
  if (!timelineBubble) return;
  if (timelineSpinnerEl) timelineSpinnerEl.style.display = "none";
  if (timelineLabelEl) timelineLabelEl.textContent = summaryText ?? "已完成";
  // Hide the phase chip on terminal — the label itself is the final
  // status. Keeping the chip would just stack two "done" indicators.
  if (timelinePhaseEl) {
    timelinePhaseEl.style.opacity = "0";
    timelinePhaseEl.textContent = "";
  }
  timelinePhaseRank = 0;
}

// Phase chip is monotonic: never regress (e.g. don't drop back to
// Planning when a late step_started arrives after Finalizing has fired).
const TIMELINE_PHASES = {
  PLANNING: { rank: 1, label: "Planning" },
  EXECUTING: { rank: 2, label: "Executing" },
  FINALIZING: { rank: 3, label: "Finalizing" }
};
let timelinePhaseRank = 0;
function setTimelinePhase(name) {
  const phase = TIMELINE_PHASES[name];
  if (!phase) return;
  if (phase.rank <= timelinePhaseRank) return;
  timelinePhaseRank = phase.rank;
  if (timelinePhaseEl) {
    timelinePhaseEl.textContent = phase.label;
    timelinePhaseEl.style.opacity = "1";
  }
}

// Map event types to phases. Tool / step events stay in Executing;
// final_composer / text_delta / inline_result / artifact_created are
// the "drafting the answer" signal.
function eventToPhase(eventType) {
  if (!eventType) return null;
  if ([
    "task_created", "accepted", "started", "provider_resolved",
    "planner_request_started", "sr_patch_applied",
    "background_context_added", "phase_timing",
    "llm_usage",
    "file_expand_started", "file_expand_finished",
    "file_ingest_started", "file_ingest_progress", "file_ingest_finished"
  ].includes(eventType)) return "PLANNING";
  if ([
    "step_started", "step_finished", "conversation_step",
    "tool_call_started", "tool_call_proposed", "tool_call_completed",
    "tool_call_denied", "tool_input_delta", "reasoning_delta",
    "local_file_read_guidance", "pending_approval_created", "log"
  ].includes(eventType)) return "EXECUTING";
  if ([
    "final_composer_started", "text_delta", "inline_result",
    "artifact_created", "evidence_summary"
  ].includes(eventType)) return "FINALIZING";
  return null;
}

function timelineAddStep(text, kind = "active") {
  timelineEnsure();
  timelineStepCount += 1;

  const colorMap = {
    done: "rgba(40,160,60,0.85)",
    fail: "rgba(200,50,40,0.85)",
    active: "rgba(60,100,220,0.8)"
  };
  const row = document.createElement("div");
  row.style.cssText = [
    "display:flex;align-items:flex-start;gap:6px;",
    "padding:2px 0;font-size:11px;line-height:1.4;",
    `color:${colorMap[kind] ?? colorMap.active};`
  ].join("");

  const icon = document.createElement("span");
  icon.style.cssText = "flex-shrink:0;width:14px;text-align:center;";
  icon.textContent = kind === "done" ? "✓" : kind === "fail" ? "✗" : "▸";

  const label = document.createElement("span");
  label.style.cssText = "flex:1;min-width:0;word-break:break-word;";
  label.textContent = text;

  // Relative-time chip ("+2.3s" since the timeline opened). Helps the
  // user spot slow stages without having to mentally diff event order.
  const timeEl = document.createElement("span");
  timeEl.style.cssText = [
    "flex-shrink:0;",
    "font-family:ui-monospace,SFMono-Regular,Consolas,monospace;",
    "font-size:10px;color:rgba(0,0,0,0.36);",
    "letter-spacing:0.02em;"
  ].join("");
  if (timelineStartedAt) {
    timeEl.textContent = formatStepDelta(Date.now() - timelineStartedAt);
  }

  row.append(icon, label, timeEl);
  timelineBodyEl.appendChild(row);
  // No inner-scroll pin — the timeline body now flows under the outer
  // bubbleArea. bubbleAreaPin.maybeScrollToBottom() handles the only
  // scroll surface that matters.
  bubbleAreaPin.maybeScrollToBottom();
}

function fmtOverlayUsageNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

function overlayUsageDisplay(usage = {}) {
  const total = Number(usage.total_tokens ?? 0);
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  if (total > 0 && (input > 0 || output > 0)) {
    return `${fmtOverlayUsageNumber(total)} tokens (${fmtOverlayUsageNumber(input)} in / ${fmtOverlayUsageNumber(output)} out)`;
  }
  if (total > 0) return `${fmtOverlayUsageNumber(total)} tokens`;
  return "tokens n/a";
}

function overlayCacheDisplay(cache = {}) {
  const bits = [
    ["hit", cache.hit_tokens],
    ["miss", cache.miss_tokens],
    ["read", cache.read_input_tokens],
    ["create", cache.creation_input_tokens]
  ]
    .filter(([, value]) => Number(value) > 0)
    .map(([label, value]) => `${label} ${fmtOverlayUsageNumber(value)}`);
  return bits.join(" · ");
}

function overlayUsageEventFromFrame(frame) {
  return {
    event_id: frame.id ?? null,
    ts: frame.timestamp ?? null,
    event_type: "llm_usage",
    payload: frame.data ?? {}
  };
}

function renderOverlayLlmUsageTimeline(frame) {
  const taskId = frame.taskId ?? frame.task_id ?? activeTaskId ?? "active";
  const usageEvents = overlayLlmUsageEventsByTaskId.get(taskId) ?? [];
  usageEvents.push(overlayUsageEventFromFrame(frame));
  overlayLlmUsageEventsByTaskId.set(taskId, usageEvents);
  const summary = collectLlmUsageSummary(usageEvents);
  if (!summary) return;

  timelineEnsure();
  if (!timelineUsageEl || timelineUsageEl.dataset.taskId !== taskId) {
    timelineUsageEl?.remove?.();
    timelineUsageEl = document.createElement("div");
    timelineUsageEl.className = "tl-llm-usage";
    timelineUsageEl.dataset.taskId = taskId;
    timelineUsageEl.setAttribute("role", "status");
    timelineUsageEl.style.cssText = [
      "display:flex;align-items:flex-start;gap:6px;",
      "padding:4px 0;font-size:11px;line-height:1.4;",
      "color:rgba(72,88,104,0.92);"
    ].join("");
    timelineBodyEl.appendChild(timelineUsageEl);
  }

  const topSegments = (summary.prompt_segments_estimate?.segments ?? [])
    .slice(0, 2)
    .map((segment) => `${segment.name} ${fmtOverlayUsageNumber(segment.estimated_tokens)} est`)
    .join(" · ");
  const cacheText = overlayCacheDisplay(summary.cache);
  const meta = [
    `${summary.call_count} call${summary.call_count === 1 ? "" : "s"}`,
    cacheText,
    topSegments
  ].filter(Boolean).join(" · ");
  const elapsed = timelineStartedAt ? formatStepDelta(Date.now() - timelineStartedAt) : "";
  timelineUsageEl.innerHTML = `
    <span style="flex-shrink:0;width:14px;text-align:center;">Σ</span>
    <span style="flex:1;min-width:0;word-break:break-word;">
      <strong>模型用量</strong> · ${escapeHtml(overlayUsageDisplay(summary.totals))}
      ${meta ? `<span style="display:block;color:rgba(0,0,0,0.48);">${escapeHtml(meta)}</span>` : ""}
    </span>
    <span style="flex-shrink:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:rgba(0,0,0,0.36);letter-spacing:0.02em;">${escapeHtml(elapsed)}</span>
  `;
  bubbleAreaPin.maybeScrollToBottom();
}

function getToolEventId(frame) {
  return frame.data?.tool_id ?? frame.data?.tool ?? "";
}

function artifactPathFromToolPayload(payload = {}) {
  if (Array.isArray(payload?.artifact_paths)) {
    const path = payload.artifact_paths.find((item) => typeof item === "string" && item.length > 0);
    if (path) return path;
  }
  return payload?.metadata?.path ?? payload?.artifact_path ?? payload?.path ?? "";
}

// 83.3 — Tool-call card. Renders as a <details> so the user can collapse
// long arg blobs and result previews. Plain ✓ / ✗ + tool name remains the
// single-line summary (matches the screenshot the user critiqued, just
// inside a polished card chrome).
const TOOL_STEP_ICONS = {
  pending: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.3"/><path d="M12 3 a9 9 0 0 1 9 9"/></svg>',
  done:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  fail:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};
const STEP_CHEVRON =
  '<svg class="step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

function buildToolStepInner(toolId, state, args, observation, sources = []) {
  const icon = TOOL_STEP_ICONS[state] ?? TOOL_STEP_ICONS.pending;
  const displayName = formatToolDisplayName(toolId);
  const argsText = args == null ? "" : formatToolArgsPreview(toolId, args);
  const obsText = String(observation ?? "").trim();
  // Single-line summary capped at 80 chars. When the underlying text is
  // longer we add an explicit "…查看全部" hint so it's clear the row is
  // collapsible — the chevron alone reads as decoration.
  const compactObs = obsText.replace(/\s+/g, " ");
  const isTruncated = compactObs.length > 80;
  const summaryText = compactObs
    ? compactObs.slice(0, 80)
    : (state === "pending" ? "运行中…" : "");
  const sourcesHtml = renderToolCallSourcesHtml(sources);
  const hasBody = Boolean(argsText || obsText || sourcesHtml);
  const truncatedHint = isTruncated
    ? `<span class="step-more">… 查看全部</span>`
    : "";
  // Copy button surfaces on the step row (top-right, always visible)
  // when there's a non-trivial observation. Hover-only to keep the
  // collapsed step looking clean; expanding the step makes it solid.
  // Lives outside .step-row so it isn't a nested button (a11y).
  const showCopy = obsText.length >= 20;
  const copyBtn = showCopy
    ? `<button type="button" class="step-copy" title="复制结果" aria-label="复制工具结果">复制</button>`
    : "";
  return `
    ${copyBtn}
    <button type="button" class="step-row" aria-expanded="${hasBody ? "true" : "false"}">
      <span class="step-icon">${icon}</span>
      <span class="step-name" title="${escapeHtml(toolId)}">${escapeHtml(displayName)}</span>
      <span class="step-summary">${escapeHtml(summaryText)}</span>
      ${truncatedHint}
      ${hasBody ? STEP_CHEVRON : ""}
    </button>
    <div class="step-body"${hasBody ? "" : " hidden"}>
      ${argsText ? `<div class="step-args">${escapeHtml(argsText)}</div>` : ""}
      ${obsText ? `<div class="step-outcome">${escapeHtml(obsText)}</div>` : ""}
      ${sourcesHtml}
    </div>
  `;
}

function bindToolStepToggle(stepEl) {
  if (!stepEl) return;
  const row = stepEl.querySelector(".step-row");
  row?.addEventListener("click", () => {
    const body = stepEl.querySelector(".step-body");
    if (!body || !body.textContent?.trim()) return;
    const willOpen = !stepEl.classList.contains("is-open");
    stepEl.classList.toggle("is-open", willOpen);
    row.setAttribute("aria-expanded", willOpen ? "true" : "false");
    body.hidden = !willOpen;
  });
  // Copy button — uses the rendered .step-outcome textContent so the
  // user gets the observation as plain text. Stops propagation so the
  // click doesn't also toggle the row open/closed.
  const copyBtn = stepEl.querySelector(".step-copy");
  copyBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const outcome = stepEl.querySelector(".step-outcome")?.textContent ?? "";
    if (!outcome) return;
    try {
      if (overlayShellClient?.writeClipboardText) {
        await overlayShellClient.writeClipboardText(outcome);
      } else {
        await navigator.clipboard?.writeText?.(outcome);
      }
      const original = copyBtn.textContent;
      copyBtn.textContent = "已复制";
      setTimeout(() => { copyBtn.textContent = original; }, 1200);
    } catch { /* clipboard may be denied — silent */ }
  });
}

function setToolStepOpen(stepEl, isOpen) {
  if (!stepEl) return;
  stepEl.classList.toggle("is-open", Boolean(isOpen));
  const row = stepEl.querySelector(".step-row");
  if (row) row.setAttribute("aria-expanded", isOpen ? "true" : "false");
  const body = stepEl.querySelector(".step-body");
  if (body) body.hidden = !isOpen;
}

function appendToolStepBubble(toolId, state = "pending", detailText = "", { anchorBefore = null } = {}) {
  if (!toolId) return null;
  const stepEl = document.createElement("div");
  stepEl.className = `bubble step ${state}`;
  stepEl.innerHTML = buildToolStepInner(toolId, state, null, detailText);
  bindToolStepToggle(stepEl);
  setToolStepOpen(stepEl, false);
  bubbleArea.hidden = false;
  if (anchorBefore && anchorBefore.parentNode === bubbleArea) {
    bubbleArea.insertBefore(stepEl, anchorBefore);
  } else if (streamingBubble && streamingBubble.parentNode === bubbleArea) {
    // Pin the streaming answer to the bottom of the conversation so the
    // user can keep watching it while new tool steps fire. Insert the
    // step bubble just above streamingBubble; final-composer's
    // bubbleArea.appendChild(streamingBubble) at inline_result re-
    // anchors it to the tail anyway, but during the streaming window
    // we want it visible without the user having to scroll.
    bubbleArea.insertBefore(stepEl, streamingBubble);
    bubbleAreaPin.maybeScrollToBottom();
  } else {
    bubbleArea.appendChild(stepEl);
    bubbleAreaPin.maybeScrollToBottom();
  }
  return stepEl;
}

function ensureStreamingAnswerPlaceholder({ taskId = null, label = "正在整理答案…", reveal = true } = {}) {
  if (streamingBubble || !bubbleArea) return;
  streamingBubble = document.createElement("div");
  streamingBubble.className = "bubble assistant streaming answer-placeholder";
  if (taskId) streamingBubble.dataset.taskId = taskId;
  streamingBubbleRawText = "";
  streamingBubble.innerHTML = `<span class="answer-placeholder-text">${escapeHtml(label)}</span>`;
  bubbleArea.hidden = false;
  bubbleArea.appendChild(streamingBubble);
  bubbleAreaPin.maybeScrollToBottom();
  if (reveal) void maybeRevealOverlay({ markEngaged: true });
}

function markToolStepBubble(toolId, ok, observation = "", sources = []) {
  if (!toolId) return;
  const queue = pendingToolStepBubbles[toolId];
  const stepEl = queue?.length ? queue.shift() : appendToolStepBubble(toolId, ok ? "done" : "fail");
  if (!stepEl) return;
  const nextState = ok ? "done" : "fail";
  stepEl.className = `bubble step ${nextState}`;
  // Preserve any args we recorded during the pending phase (stored on the
  // dataset by appendToolStepBubble's caller, if any) so the body shows
  // both the call shape and the result.
  const preservedArgs = stepEl.dataset.args ? safeJsonParseForOverlay(stepEl.dataset.args) : null;
  stepEl.innerHTML = buildToolStepInner(toolId, nextState, preservedArgs, observation, sources);
  bindToolStepToggle(stepEl);
  setToolStepOpen(stepEl, false);
  bubbleAreaPin.maybeScrollToBottom();
}

function safeJsonParseForOverlay(raw) {
  try { return JSON.parse(raw); } catch { return raw; }
}

// 83.4 — Thinking card. Streams reasoning_content into a folded <details>
// above the answer bubble. We keep one in-flight thinking card per turn —
// a new turn (signalled by a fresh text_delta or tool call) closes the
// previous one. Module-level state because multiple events fire from
// different code paths and we don't want to thread the ref everywhere.
let activeThinkingEl = null;
let activeThinkingText = "";
function scheduleOverlayFrame(callback) {
  const schedule = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  return schedule(callback);
}

function scheduleOverlayThinkingDeltaFlush() {
  if (overlayThinkingDeltaRaf) return;
  overlayThinkingDeltaRaf = scheduleOverlayFrame(() => {
    overlayThinkingDeltaRaf = 0;
    flushOverlayThinkingDelta();
  });
}

function queueOverlayThinkingDelta(delta) {
  if (!delta) return;
  pendingOverlayThinkingDeltaText += String(delta);
  scheduleOverlayThinkingDeltaFlush();
}

function flushOverlayThinkingDelta() {
  const delta = pendingOverlayThinkingDeltaText;
  if (!delta) return;
  pendingOverlayThinkingDeltaText = "";
  appendThinkingDelta(delta);
}

function appendThinkingDelta(delta) {
  if (!activeThinkingEl) {
    const det = document.createElement("div");
    det.className = "bubble thinking is-open";
    det.innerHTML = `
      <button type="button" class="thinking-summary" aria-expanded="true">
        <span class="thinking-icon">🧠</span>
        <span class="thinking-label">思考过程</span>
        <span class="thinking-status">…</span>
      </button>
      <div class="thinking-body"></div>
    `;
    det.querySelector(".thinking-summary")?.addEventListener("click", () => {
      const willOpen = !det.classList.contains("is-open");
      det.classList.toggle("is-open", willOpen);
      det.querySelector(".thinking-summary")?.setAttribute("aria-expanded", willOpen ? "true" : "false");
      const body = det.querySelector(".thinking-body");
      if (body) body.hidden = !willOpen;
    });
    bubbleArea.hidden = false;
    bubbleArea.appendChild(det);
    activeThinkingEl = det;
    activeThinkingText = "";
  }
  activeThinkingText += delta;
  const body = activeThinkingEl.querySelector(".thinking-body");
  if (body) body.textContent = activeThinkingText;
  bubbleAreaPin.maybeScrollToBottom();
}
function closeActiveThinkingCard() {
  flushOverlayThinkingDelta();
  if (!activeThinkingEl) return;
  activeThinkingEl.classList.remove("is-open");
  activeThinkingEl.querySelector(".thinking-summary")?.setAttribute("aria-expanded", "false");
  const body = activeThinkingEl.querySelector(".thinking-body");
  if (body) body.hidden = true;
  const status = activeThinkingEl.querySelector(".thinking-status");
  if (status) status.textContent = `${activeThinkingText.length} chars`;
  activeThinkingEl = null;
  activeThinkingText = "";
}

// UCA-059: Show a clarification question bubble.
// The user can type their answer and it will be merged with the original
// command and submitted to /task/clarify.
function clearActiveClarificationBubble() {
  if (!activeClarificationBubble) return;
  try { activeClarificationBubble.remove(); } catch { /* ignore */ }
  activeClarificationBubble = null;
}

function showClarificationBubble(originalCommand, question, originalPayload) {
  clearActiveClarificationBubble();
  const cardEl = document.createElement("div");
  cardEl.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  const questionEl = document.createElement("div");
  questionEl.textContent = question;
  questionEl.style.cssText = "font-size:13px;line-height:1.5;";

  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.placeholder = "请补充信息…";
  inputEl.style.cssText = "padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;width:100%;box-sizing:border-box;";

  const actions = document.createElement("div");
  actions.className = "bubble-options";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "确认";
  confirmBtn.addEventListener("click", async () => {
    const answer = inputEl.value.trim();
    if (!answer) { inputEl.focus(); return; }
    confirmBtn.disabled = true;
    confirmBtn.textContent = "发送中…";
    const answerClientMessageId = createClientMessageId();
    markPendingUserMessage(answerClientMessageId, answer);
    try {
      const clarifyPayload = attachOverlayProjectScope({
        ...originalPayload,
        originalCommand,
        clarificationAnswer: answer,
        conversation_id: conversationState?.id ?? originalPayload?.conversation_id ?? null,
        client_message_id: answerClientMessageId
      });
      delete clarifyPayload.userCommand;
      const result = await overlaySubmissionClient.clarifyTask({ ...clarifyPayload, background: true });
      if (result.task?.task_id) {
        activeTaskId = result.task.task_id;
        lastTask = result.task;
        notifiedTaskId = null;
        notifiedInlineResultTaskId = null;
        bindTaskToConversation(activeTaskId);
        ensureActiveTaskEventStream(activeTaskId);
        clearPendingInputContext();
        clearActiveClarificationBubble();
        addBubble("assistant", "Processing in background...");
        conversationPhase = "idle";
      }
    } catch (err) {
      markPendingMessageFailed(answerClientMessageId, err);
      addSystemBubble(`提交失败：${err.message}`);
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => {
    conversationPhase = "idle";
    clearActiveClarificationBubble();
  });

  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); confirmBtn.click(); }
  });

  actions.append(confirmBtn, cancelBtn);
  cardEl.append(questionEl, inputEl, actions);
  activeClarificationBubble = addBubble("assistant", cardEl);
  // Focus the clarification input so the user can type immediately
  setTimeout(() => inputEl.focus(), 80);
  conversationPhase = "awaiting_options";
}

/* ═══════════════════════════════════════════════
   CONVERSATIONAL FLOW
   ═══════════════════════════════════════════════ */

function showWelcome() {
  if (bubbleArea.children.length === 0) {
    addBubble("assistant", "Hi, what can I do for you?");
  }
}

function showContextReceivedBubble() {
  if (pendingFileSelection?.filePaths?.length) {
    const count = pendingFileSelection.filePaths.length;
    const chips = pendingFileSelection.filePaths.slice(0, 4).map((fp) => {
      const name = fp.split(/[/\\]/).pop();
      return { label: name, title: fp, path: fp, kind: "file", dismissable: false };
    });
    if (count > 4) {
      chips.push({ label: `+${count - 4} more`, dismissable: false });
    }
    addBubble("assistant", `Received ${count} file(s). What do you want me to do?`, { contextChips: chips });
  } else if (pendingCapture?.capture) {
    const capture = pendingCapture.capture;
    const appName = pendingCapture.sourceApp ?? "";
    const filePath = capture.filePath ?? null;
    const selectedText = capture.text?.trim() ?? "";

    // hotkey capture from native app — show rich context
    if (pendingCapture.captureMode === "hotkey_capture") {
      const detailLines = [];
      if (filePath) detailLines.push(`File: ${filePath.split(/[/\\]/).pop()}`);
      if (selectedText) detailLines.push(`Selected: ${selectedText.slice(0, 100)}${selectedText.length > 100 ? "..." : ""}`);

      const chips = [];
      if (filePath) chips.push({ label: filePath.split(/[/\\]/).pop(), title: filePath, path: filePath, kind: "file", dismissable: false });

      addBubble("assistant",
        detailLines.length > 0
          ? `Captured from ${appName || "desktop"}:\n${detailLines.join("\n")}\n\nWhat do you want me to do?`
          : "Ready. What do you want me to do?",
        chips.length > 0 ? { contextChips: chips } : undefined
      );
      return;
    }

    // browser/web context
    const preview = selectedText.slice(0, 120)
      || capture.url
      || capture.imageUrl
      || "Context received.";
    addBubble("assistant", `Received context:\n${preview}\n\nWhat do you want me to do?`);
  }
}

function offerQuickActions() {
  conversationPhase = "awaiting_options";
  awaitingOptionType = "action";

  addBubble("assistant", "Choose an action, or just type your own:", {
    optionButtons: [
      { label: "summarize", onClick: () => pickQuickAction("summarize") },
      { label: "explain", onClick: () => pickQuickAction("explain") },
      { label: "translate", onClick: () => pickQuickAction("translate") },
      { label: "rewrite", onClick: () => pickQuickAction("rewrite") }
    ]
  });
}

function pickQuickAction(action) {
  const commands = {
    "summarize": "summarize and list key points",
    "explain":   "explain the content and its significance",
    "translate": "translate to Chinese naturally",
    "rewrite":   "rewrite for clarity and professionalism"
  };
  commandInput.value = commands[action] ?? action;
  addBubble("user", commandInput.value);
  offerOutputFormat();
}

function offerOutputFormat() {
  conversationPhase = "awaiting_options";
  awaitingOptionType = "format";

  addBubble("assistant", "Output format?", {
    optionButtons: [
      { label: "Direct", active: true, onClick: () => { selectedFormatInstruction = ""; } },
      { label: "TXT",    onClick: () => { selectedFormatInstruction = ", save as .txt file"; } },
      { label: "HTML",   onClick: () => { selectedFormatInstruction = ", save as .html file"; } },
      { label: "JSON",   onClick: () => { selectedFormatInstruction = ", save as .json file"; } },
      { label: "Word",   onClick: () => { selectedFormatInstruction = ", save as .docx file"; } },
      { label: "Excel",  onClick: () => { selectedFormatInstruction = ", save as .xlsx spreadsheet"; } }
    ]
  });

  conversationPhase = "idle";
}

/* ═══════════════════════════════════════════════
   TOAST (result notification)
   ═══════════════════════════════════════════════ */

// UCA-182 Phase 8: result-toast DOM is retired. `showToast` now routes
// through the shared popup-card (top-right stack), giving artifact
// notifications the same styling, stacking, pin and dedupe behaviour
// as approvals. Button actions are handled by
// the popup-card-resolved listener further down.
function showToast(title, body, artifactPath) {
  lastArtifactPath = artifactPath ?? null;
  if (popKeptOpen) return; // overlay already open; the conversation bubble is enough.
  try {
    overlayShellClient?.showPopupCard?.({
      kind: "success",
      title,
      lines: body ? [body] : [],
      artifactPath: artifactPath ?? null,
      inlinePreview: lastArtifactPreview ?? null,
      taskId: activeTaskId ?? null,
      dedupeKey: artifactPath ? `artifact:${artifactPath}` : undefined,
      autoHideMs: 10000
    });
  } catch { /* best effort */ }
}

function hideToast() {
  // Kept as a no-op so existing callers continue to compile. Popup-card
  // controls its own lifecycle (dedupe + reflow + auto-hide).
}


/* ═══════════════════════════════════════════════
   CORE TASK LOGIC (preserved from original)
   ═══════════════════════════════════════════════ */

function formatDateTime(value) {
  return formatSharedDateTime(value, { timeOnly: true });
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

function assertShellResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.message ?? result.error ?? fallback);
  }
  return result ?? {};
}

async function approveApproval(approvalId, options = {}) {
  if (typeof overlayShellClient?.approveApproval !== "function") {
    throw new Error("Desktop approval bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.approveApproval({
      approvalId,
      overrides: options.overrides ?? null
    }),
    "Could not approve this action."
  );
}

async function rejectApproval(approvalId, options = {}) {
  if (typeof overlayShellClient?.rejectApproval !== "function") {
    throw new Error("Desktop approval bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.rejectApproval({
      approvalId,
      reason: options.reason ?? ""
    }),
    "Could not reject this action."
  );
}

async function createScheduleViaShell(payload) {
  if (typeof overlayShellClient?.createSchedule !== "function") {
    throw new Error("Desktop schedule bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.createSchedule(payload),
    "Could not create schedule."
  );
}

async function saveTemplateViaShell(template) {
  if (typeof overlayShellClient?.saveTemplate !== "function") {
    throw new Error("Desktop template bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.saveTemplate({ template }),
    "Could not save template."
  );
}

async function saveAutoSkillViaShell(proposal) {
  if (typeof overlayShellClient?.saveAutoSkill !== "function") {
    throw new Error("Desktop skill save bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.saveAutoSkill(proposal),
    "Could not save this skill."
  );
}

async function appendNoteChipViaShell(payload) {
  if (typeof overlayShellClient?.appendNoteChip !== "function") {
    throw new Error("Desktop notes bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.appendNoteChip(payload),
    "Could not append note chip."
  );
}

async function saveProjectStoreViaShell(store) {
  if (typeof overlayShellClient?.saveProjectStore !== "function") {
    throw new Error("Desktop project store bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.saveProjectStore(store),
    "Could not save project store."
  );
}

async function cancelTaskViaShell(taskId, options = {}) {
  if (typeof overlayShellClient?.cancelTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.cancelTask(taskId, { force: options.force === true }),
    "Could not cancel task."
  );
}

async function retryTaskViaShell(taskId, options = {}) {
  if (typeof overlayShellClient?.retryTask !== "function") {
    throw new Error("Desktop task control bridge unavailable.");
  }
  return assertShellResult(
    await overlayShellClient.retryTask(taskId, options),
    "Could not retry task."
  );
}

async function surfaceApprovalPopup(approvalLike = {}, { taskId = null } = {}) {
  const approvalId = approvalIdOf(approvalLike);
  if (!approvalId || surfacedApprovalPopupIds.has(approvalId) || surfacingApprovalPopupIds.has(approvalId)) return;
  surfacingApprovalPopupIds.add(approvalId);
  const fullApproval = await fetchApprovalRecord(approvalId);
  const approval = fullApproval ?? approvalLike;
  if (approval.status && approval.status !== "pending") {
    surfacingApprovalPopupIds.delete(approvalId);
    return;
  }
  const target = approval.proposed_target ?? approval.workflow_id ?? approvalLike.workflow_id ?? "";
  const preview = approval.preview_text ?? approval.summary ?? approval.preview ?? approvalLike.summary ?? "工具调用需要您的确认";
  try {
    if (typeof overlayShellClient?.showPopupCard !== "function") return;
    const popupResult = await overlayShellClient.showPopupCard({
      kind: "approval",
      approvalId,
      taskId: taskId ?? approval.metadata?.task_id ?? approvalLike.task_id ?? null,
      title: target ? `等待确认：${target}` : "等待用户确认",
      lines: [preview],
      openWindow: "overlay"
    });
    if (popupResult?.cardId) approvalPopupCardIds.set(approvalId, popupResult.cardId);
    surfacedApprovalPopupIds.add(approvalId);
  } catch {
    /* popup card is optional */
  } finally {
    surfacingApprovalPopupIds.delete(approvalId);
  }
}

async function reconcilePendingApprovalPopups() {
  try {
    const response = await fetchJson("/approvals");
    for (const approval of response.approvals ?? []) {
      if (approval?.status === "pending") {
        void surfaceApprovalPopup(approval, { taskId: approval.metadata?.task_id ?? null });
      }
    }
  } catch {
    /* runtime not ready */
  }
}

function formatAbsoluteTimestamp(value) {
  return formatSharedDateTime(value, { invalidFallback: "empty" });
}

// Append (or refresh) the .bubble-time footer on a bubble. Idempotent:
// calling twice replaces the existing element. Used by addBubble for
// fresh bubbles and by the streaming-finalize path so streamed answers
// also pick up a timestamp once they're committed.
function appendBubbleTimestamp(bubble, value) {
  if (!bubble) return;
  const ts = value != null ? new Date(value).getTime() : Date.now();
  if (!Number.isFinite(ts)) return;
  bubble.querySelector(":scope > .bubble-time")?.remove();
  const timeEl = document.createElement("time");
  timeEl.className = "bubble-time";
  timeEl.dataset.ts = String(ts);
  timeEl.title = formatAbsoluteTimestamp(ts);
  timeEl.textContent = formatRelativeTime(ts);
  bubble.appendChild(timeEl);
}

function closeActiveTaskEventStream() {
  activeTaskEventStream?.close?.();
  activeTaskEventStream = null;
  activeTaskEventTaskId = null;
  activeTaskEventBaseUrl = null;
  handledTaskEventIds = new Set();
  renderedTimelineEventIds = new Set();
  streamingBubble = null;
  streamingBubbleRawText = "";
  pendingToolStepBubbles = {};
  renderedEvidenceSummaryTaskIds = new Set();
  renderedContentEvidenceTaskIds = new Set();
  // The new task may not arrive immediately, but resetting here means the
  // first step_started we see for it always increments from 0 — never
  // appearing as "第 5 步" because the previous task's counter leaked.
  runtimeStepIndex = 0;
  runtimeStepTotal = 0;
  closeActiveThinkingCard();
}

function renderTaskTimelineEvent(frame, { showOverlay = false, replayAnchor = null } = {}) {
  if (frame.id && renderedTimelineEventIds.has(frame.id)) return;
  const payload = frame?.data ?? {};
  if (payload?.background === true || payload?.visibility === "diagnostic") return;
  const visibleEvents = new Set([
    "task_created",
    "accepted",
    "started",
    "provider_resolved",
    "phase_timing",
    "file_expand_started",
    "file_expand_finished",
    "file_ingest_started",
    "file_ingest_progress",
    "file_ingest_finished",
    "status_changed",
    "step_started",
    "step_finished",
    "conversation_step",
    "planner_request_started",
    "llm_usage",
    "final_composer_started",
    "sr_patch_applied",
    "background_context_added",
    "tool_call_started",
    "tool_call_proposed",
    "tool_call_completed",
    "tool_call_denied",
    "tool_input_delta",
    "local_file_read_guidance",
    "reasoning_delta",
    "pending_approval_created",
    "log",
    "artifact_created",
    "evidence_summary",
    "failed",
    "cancelled"
  ]);
  if (!visibleEvents.has(frame.event)) return;
  if (frame.id) renderedTimelineEventIds.add(frame.id);

  // Track per-task step progress so summaries can render "第 N 步" /
  // "第 N/M 步" even when the backend doesn't emit step_index. The
  // counter increments on each step_started; payload values (when
  // present) take precedence inside formatStepSuffix.
  if (frame.event === "step_started") {
    runtimeStepIndex += 1;
  }
  const totalHint = Number(frame.data?.step_total ?? 0);
  if (Number.isFinite(totalHint) && totalHint > runtimeStepTotal) {
    runtimeStepTotal = totalHint;
  }
  // Promote the timeline-header phase chip based on event class. Always
  // calls setTimelinePhase — it's a no-op when timelineBubble doesn't
  // exist yet, and the rank-monotonic guard prevents regressions.
  const phaseName = eventToPhase(frame.event);
  if (phaseName) setTimelinePhase(phaseName);
  const summary = formatTaskEventSummary(frame, {
    step: { index: runtimeStepIndex, total: runtimeStepTotal }
  });

  if (frame.event === "step_started") {
    const stepText = summary.body || frame.data?.step_label || "步骤开始";
    timelineAddStep(stepText, "active");
  }
  if (frame.event === "step_finished") {
    const stepText = summary.body || frame.data?.step_label || "步骤完成";
    timelineAddStep(stepText, "done");
  }

  // UCA-061: Real-time step labels forwarded from task-runtime.mjs
  if (frame.event === "conversation_step") {
    const label = frame.data?.step_label ?? "";
    if (label) timelineAddStep(label, "active");
  }

  if (frame.event === "llm_usage") {
    renderOverlayLlmUsageTimeline(frame);
  }

  if ([
    "task_created", "accepted", "started", "provider_resolved", "phase_timing",
    "status_changed", "planner_request_started", "final_composer_started",
    "sr_patch_applied", "background_context_added", "local_file_read_guidance",
    "file_ingest_started", "file_ingest_progress", "file_ingest_finished",
    "log", "artifact_created"
  ].includes(frame.event)) {
    timelineAddStep(`${summary.title}: ${summary.body}`, frame.event === "artifact_created" ? "done" : "active");
  }

  // UCA-061: Tool call events shown in timeline AND as step bubbles in conversation
  if (frame.event === "tool_call_started" || frame.event === "tool_call_proposed") {
    const toolId = getToolEventId(frame);
    if (toolId) {
      if (!showOverlay) timelineAddStep(`调用 ${formatToolDisplayName(toolId)}...`, "active");
      const frameTaskId = frame.taskId ?? frame.task_id ?? activeTaskId;
      if (showOverlay) {
        ensureStreamingAnswerPlaceholder({
          taskId: frameTaskId ?? null,
          label: "正在处理请求…",
          reveal: !isEchoTask(frameTaskId)
        });
        if (!isEchoTask(frameTaskId)) void maybeRevealOverlay();
      }
      const stepEl = appendToolStepBubble(toolId, "pending", "", { anchorBefore: replayAnchor });
      // 83.3 — Stash args on the element so markToolStepBubble can re-render
      // them inside the result body. The proposed/started events carry the
      // arg payload; the completed event carries only the observation.
      const callArgs = frame.data?.arguments ?? frame.data?.args ?? null;
      if (stepEl && callArgs) {
        try { stepEl.dataset.args = JSON.stringify(callArgs); } catch { /* ignore */ }
      }
      if (!pendingToolStepBubbles[toolId]) pendingToolStepBubbles[toolId] = [];
      pendingToolStepBubbles[toolId].push(stepEl);
      if (window.livePreview?.isFileGenTool?.(toolId)) {
        window.livePreview.openForTool({
          toolName: toolId,
          args: frame.data?.arguments ?? frame.data?.args ?? {},
          taskId: frameTaskId ?? null
        });
      }
    }
  }
  if (frame.event === "tool_input_delta") {
    const toolId = frame.data?.tool_id ?? "";
    if (window.livePreview?.isFileGenTool?.(toolId)) {
      window.livePreview.appendDelta({
        toolName: toolId,
        partialJson: frame.data?.partial_json ?? "",
        taskId: frame.taskId ?? frame.task_id ?? activeTaskId ?? null
      });
    }
  }
  // 83.4 — Reasoning tokens from Qwen3 / DeepSeek thinking models. Renders
  // a folded "🧠 思考过程" bubble that streams in real time. Uses appendOrAppend
  // so multiple chunks land in the same card rather than spawning one card
  // per delta.
  if (frame.event === "reasoning_delta") {
    const delta = String(frame.data?.delta ?? "");
    if (delta) queueOverlayThinkingDelta(delta);
  }
  if (frame.event === "tool_call_completed") {
    const toolId = getToolEventId(frame);
    const ok = frame.data?.success !== false;
    if (toolId) {
      if (!showOverlay) timelineAddStep(formatToolDisplayName(toolId), ok ? "done" : "fail");
      markToolStepBubble(toolId, ok, frame.data?.observation ?? "", frame.data?.sources ?? []);
      if (window.livePreview?.isFileGenTool?.(toolId)) {
        window.livePreview.commit({
          toolName: toolId,
          taskId: frame.taskId ?? frame.task_id ?? activeTaskId ?? null,
          success: ok,
          artifactPath: artifactPathFromToolPayload(frame.data),
          mime: frame.data?.metadata?.mime_type ?? null,
          observation: frame.data?.observation ?? ""
        });
      }
    }
  }

  if (frame.event === "artifact_created") {
    const artifactPath = artifactPathFromToolPayload(frame.data);
    if (artifactPath) {
      window.livePreview?.commit?.({
        toolName: getToolEventId(frame),
        taskId: frame.taskId ?? frame.task_id ?? activeTaskId ?? null,
        success: true,
        artifactPath,
        mime: frame.data?.mime ?? frame.data?.mime_type ?? frame.data?.metadata?.mime_type ?? null,
        observation: frame.data?.observation ?? ""
      });
    }
  }

  if (frame.event === "tool_call_denied") {
    const toolId = getToolEventId(frame);
    if (!showOverlay) timelineAddStep(toolId ? `${formatToolDisplayName(toolId)} 已拦截` : summary.body, "fail");
  }

  if (frame.event === "pending_approval_created") {
    renderInlineApproval(frame);
    if (!showOverlay) timelineAddStep("等待用户确认", "active");
    if (showOverlay) void maybeRevealOverlay();
    void surfaceApprovalPopup(frame.data ?? {}, { taskId: frame.task_id ?? frame.data?.task_id ?? null });
  }

  if (frame.event === "failed" || frame.event === "cancelled") {
    timelineAddStep(summary.body, "fail");
  }
}

function appendOverlayEvidenceSources(taskId, evidence) {
  if (!evidence || typeof evidence !== "object") return;
  const key = taskId || "active";
  if (renderedEvidenceSummaryTaskIds.has(key)) return;
  const html = renderEvidenceSourcesHtml(evidence, {
    className: "task-answer task-evidence overlay-evidence",
    title: "Evidence",
    zh: "来源"
  });
  if (!html) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const node = wrapper.firstElementChild;
  if (!node) return;
  addBubble("assistant", node, { taskId });
  wireEvidenceSourceActions(node, overlayShellClient);
  renderedEvidenceSummaryTaskIds.add(key);
}

function appendOverlayContentEvidence(taskId, entries) {
  const key = taskId || "active";
  if (renderedContentEvidenceTaskIds.has(key)) return;
  renderedContentEvidenceTaskIds.add(key);
  const html = renderContentEvidenceHtml(entries, {
    className: "task-answer task-evidence overlay-evidence overlay-content-evidence",
    title: "Input evidence",
    zh: "输入证据"
  });
  if (!html) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const node = wrapper.firstElementChild;
  if (!node) return;
  addBubble("assistant", node, { taskId });
}

// Track approval bubbles so SSE duplicates don't stack cards, and so we can
// swap the buttons for a result indicator once the user decides.
const renderedApprovalCards = new Map(); // approval_id -> HTMLElement

async function renderInlineApproval(frame) {
  const data = frame.data ?? {};
  const approvalId = data.approval_id ?? data.approvalId;
  if (!approvalId) return;
  if (renderedApprovalCards.has(approvalId)) return;

  async function closeApprovalPopupCard() {
    const popupCardId = approvalPopupCardIds.get(approvalId);
    if (!popupCardId) return;
    approvalPopupCardIds.delete(approvalId);
    try {
      await overlayShellClient?.closePopupCard?.(popupCardId, { reason: "resolved_inline" });
    } catch { /* optional */ }
  }

  // Fetch the full record so we can show the real preview (SSE payload only
  // carries a summary). Fall back to the payload if the call fails.
  let approval = null;
  try {
    const response = await fetchJson(`/approvals`);
    approval = (response.approvals ?? []).find((item) => item.approval_id === approvalId)
      ?? (response.approvals ?? []).find((item) => item.approvalId === approvalId)
      ?? null;
  } catch { /* silent — we'll show a minimal card */ }

  async function listConnectedEmailAccounts() {
    try {
      const response = await fetchJson("/connectors/connected-accounts");
      return (response.accounts ?? [])
        .filter((account) => account?.tokenStatus === "active" && account?.capabilities?.emailWrite)
        .sort((a, b) => {
          const aDefault = a.isDefaultForEmail === true ? 1 : 0;
          const bDefault = b.isDefaultForEmail === true ? 1 : 0;
          if (aDefault !== bDefault) return bDefault - aDefault;
          const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
          const bt = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
          return bt - at;
        });
    } catch {
      return [];
    }
  }

  const card = document.createElement("div");
  card.className = "approval-card";
  card.style.cssText = [
    "border:1px solid color-mix(in srgb, var(--accent, #4a88ff) 45%, transparent)",
    "border-radius:10px",
    "padding:12px 14px",
    "background:color-mix(in srgb, var(--panel, rgba(255,255,255,0.92)) 88%, var(--accent, #4a88ff) 12%)",
    "display:flex",
    "flex-direction:column",
    "gap:10px",
    "color:var(--ink)"
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px;";
  header.textContent = approval?.proposed_target
    ? `等待确认：${approval.proposed_target}`
    : (data.workflow_id ? `等待确认：${data.workflow_id}` : "等待用户确认");
  card.appendChild(header);

  // The store already decodes proposed_params JSON for us. Fall back to the
  // raw string only when an older record shape shows up.
  let editableInput = approval?.proposed_params?.input ?? null;
  if (!editableInput
      && approval?.proposed_params
      && typeof approval.proposed_params === "object"
      && (approval.proposed_params.subject !== undefined
        || approval.proposed_params.body !== undefined
        || approval.proposed_params.to !== undefined)) {
    editableInput = approval.proposed_params;
  }
  if (!editableInput && approval?.proposed_params_json) {
    try {
      const params = typeof approval.proposed_params_json === "string"
        ? JSON.parse(approval.proposed_params_json)
        : approval.proposed_params_json;
      editableInput = params?.input ?? null;
    } catch { /* ignore */ }
  }

  const editFields = {};

  function addLabel(text) {
    const lbl = document.createElement("div");
    lbl.style.cssText = "font-size:11px; color:var(--muted); margin-bottom:2px;";
    lbl.textContent = text;
    return lbl;
  }

  function addTextInput(key, value, label, { multi = false } = {}) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; flex-direction:column; gap:2px;";
    wrap.appendChild(addLabel(label));
    const el = document.createElement(multi ? "textarea" : "input");
    if (!multi) el.type = "text";
    el.value = value ?? "";
    el.style.cssText = "font:inherit; color:var(--ink); padding:6px 8px; border:1px solid var(--line); border-radius:5px; background:var(--panel);"
      + (multi ? " min-height:110px; resize:vertical;" : "");
    wrap.appendChild(el);
    card.appendChild(wrap);
    editFields[key] = el;
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

  if (editableInput && (editableInput.subject !== undefined || editableInput.body !== undefined || editableInput.to !== undefined)) {
    const toValue = Array.isArray(editableInput.to) ? editableInput.to.join(", ") : (editableInput.to ?? "");
    addTextInput("to", toValue, "收件人（多个用逗号分隔）");
    addTextInput("subject", editableInput.subject ?? "", "主题");
    addTextInput("body", editableInput.body ?? "", "正文", { multi: true });
    if (Array.isArray(editableInput.attachmentPaths) && editableInput.attachmentPaths.length > 0) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:11px; color:var(--muted);";
      note.textContent = `附件：${editableInput.attachmentPaths.join(", ")}`;
      card.appendChild(note);
    }
  } else if (approval?.preview_text) {
    const preview = document.createElement("pre");
    preview.style.cssText = "margin:0; padding:8px 10px; background:color-mix(in srgb, var(--ink) 5%, transparent); border-radius:6px; font-family:inherit; white-space:pre-wrap; word-break:break-word; font-size:12px; max-height:260px; overflow:auto; color:var(--ink);";
    preview.textContent = approval.preview_text;
    card.appendChild(preview);
  }

  if (editableInput && !editableInput.accountId) {
    const emailAccounts = await listConnectedEmailAccounts();
    if (emailAccounts.length > 1) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex; flex-direction:column; gap:2px;";
      wrap.appendChild(addLabel("发送账户"));
      const select = document.createElement("select");
      select.style.cssText = "font:inherit; color:var(--ink); padding:6px 8px; border:1px solid var(--line); border-radius:5px; background:var(--panel);";
      for (const account of emailAccounts) {
        const option = document.createElement("option");
        option.value = account.id ?? account.accountId ?? "";
        option.textContent = `${account.provider} · ${account.email ?? account.displayName ?? account.id}${account.isDefaultForEmail ? "（默认）" : ""}`;
        select.appendChild(option);
      }
      wrap.appendChild(select);
      card.appendChild(wrap);
      editFields.accountId = select;
    }
  }

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex; gap:8px;";
  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.textContent = "确认发送";
  approveBtn.className = "primary";
  approveBtn.style.cssText = [
    "padding:6px 14px",
    "font-size:13px",
    "border-radius:8px",
    "border:1px solid color-mix(in srgb, var(--ink) 14%, transparent)",
    "background:var(--ink)",
    "color:var(--bg)",
    "font-weight:600"
  ].join(";");
  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.textContent = "拒绝";
  rejectBtn.className = "ghost";
  rejectBtn.style.cssText = [
    "padding:6px 14px",
    "font-size:13px",
    "border-radius:8px",
    "border:1px solid var(--line)",
    "background:var(--panel)",
    "color:var(--ink)",
    "font-weight:600"
  ].join(";");

  async function disableButtons() {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    for (const el of Object.values(editFields)) el.disabled = true;
  }

  function showResult(text, ok) {
    actions.remove();
    let result = card.querySelector(".approval-inline-result");
    if (!result) {
      result = document.createElement("div");
      result.className = "approval-inline-result";
      card.appendChild(result);
    }
    result.style.cssText = [
      "font-size:12px",
      `color:${ok ? "var(--ok)" : "var(--err)"}`,
      `background:${ok ? "var(--ok-soft)" : "var(--err-soft)"}`,
      "border:1px solid var(--line)",
      "padding:6px 10px",
      "border-radius:8px",
      "display:inline-flex",
      "align-items:center",
      "width:fit-content"
    ].join(";");
    result.textContent = text;
  }

  function collectOverrides() {
    if (!editFields || Object.keys(editFields).length === 0) return null;
    const overrides = {};
    if (editFields.to) {
      const raw = editFields.to.value.trim();
      if (raw) {
        overrides.to = splitEmailFieldValue(raw);
      }
    }
    if (editFields.subject) {
      const raw = editFields.subject.value.trim();
      if (raw) overrides.subject = raw;
    }
    if (editFields.body) {
      const raw = editFields.body.value;
      if (raw.trim()) overrides.body = raw;
    }
    if (editFields.accountId) {
      const raw = editFields.accountId.value.trim();
      if (raw) overrides.accountId = raw;
    }
    return Object.keys(overrides).length > 0 ? overrides : null;
  }

  approveBtn.addEventListener("click", async () => {
    const overrides = collectOverrides();
    await disableButtons();
    try {
      const resp = await approveApproval(approvalId, overrides ? { overrides } : {});
      showResult("✓ 已确认，正在执行…", true);
      // Subscribe to the resume task's event stream so the user sees send_email
      // completion / failure inline in this conversation.
      const resumeTaskId = resp?.executionResult?.task?.task_id
        ?? resp?.approval?.resulting_task_id
        ?? null;
      const owningTaskId = frame.taskId ?? frame.task_id ?? data.task_id ?? activeTaskId ?? null;
      if (resumeTaskId && conversationState?.id) {
        bindTaskToConversationId(taskConversationMap, resumeTaskId, conversationState.id);
        const existing = backgroundTaskStreams.get(resumeTaskId);
        if (!existing) {
          const stream = subscribeTaskEvents(serviceBaseUrl, resumeTaskId, {
            onEvent(event) { void handleTaskEventFrame(event); },
            onError() { backgroundTaskStreams.delete(resumeTaskId); }
          });
          backgroundTaskStreams.set(
            resumeTaskId,
            typeof stream === "function" ? stream : () => { try { (stream?.close ?? stream?.dispose)?.call(stream); } catch { /* ignore */ } }
          );
        }
        // Approval execution can finish before the renderer's fresh SSE
        // subscription is attached. Poll the canonical task detail once so
        // terminal success/failed events clear the inline "processing" bubble.
        if (!activeTaskId || activeTaskId === owningTaskId || activeTaskId === resumeTaskId) {
          activeTaskId = resumeTaskId;
          await refreshActiveTask();
        }
      }
      const executionResult = resp?.executionResult ?? null;
      if (!resumeTaskId && executionResult?.executed) {
        const ok = executionResult.success !== false;
        const observation = String(executionResult.observation ?? executionResult.error ?? "").trim();
        showResult(ok ? "✓ 已执行。" : "执行失败。", ok);
        if (observation) addBubble(ok ? "assistant" : "system", observation);
      }
      await closeApprovalPopupCard();
    } catch (error) {
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
      showResult(`确认失败：${error.message}`, false);
    }
  });
  rejectBtn.addEventListener("click", async () => {
    await disableButtons();
    try {
      await rejectApproval(approvalId, { reason: "rejected_in_overlay" });
      showResult("✕ 已拒绝。", false);
      await closeApprovalPopupCard();
    } catch (error) {
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
      showResult(`拒绝失败：${error.message}`, false);
    }
  });
  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  card.appendChild(actions);

  addBubble("system", card);
  bubbleAreaPin.maybeScrollToBottom();
  renderedApprovalCards.set(approvalId, card);
}

function replayTaskTimelineEvents(events = [], { taskId = activeTaskId, viewGeneration = overlayViewGeneration } = {}) {
  if (!shouldRenderTaskFrameInCurrentOverlay(taskId, viewGeneration)) return;
  // Insert tool bubbles BEFORE the most recent assistant bubble so the
  // replayed timeline reads chronologically (user → tools → answer)
  // instead of (user → answer → tools dangling at the bottom).
  const assistantBubbles = bubbleArea.querySelectorAll(".bubble.assistant");
  const replayAnchor = assistantBubbles[assistantBubbles.length - 1] ?? null;
  for (const event of events) {
    const frame = toTaskEventFrame(event);
    const eventTaskId = frame.taskId ?? frame.task_id ?? taskId;
    if (!shouldRenderTaskFrameInCurrentOverlay(eventTaskId, viewGeneration)) continue;
    renderTaskTimelineEvent(frame, { showOverlay: false, replayAnchor });
  }
}

function scheduleOverlayTextDeltaFlush() {
  if (overlayTextDeltaRaf) return;
  overlayTextDeltaRaf = scheduleOverlayFrame(() => {
    overlayTextDeltaRaf = 0;
    flushOverlayTextDelta();
  });
}

function queueOverlayTextDelta(taskId, delta) {
  if (!delta) return;
  pendingOverlayTextDeltaTaskId = taskId ?? pendingOverlayTextDeltaTaskId ?? activeTaskId ?? null;
  pendingOverlayTextDeltaText += String(delta);
  scheduleOverlayTextDeltaFlush();
}

function flushOverlayTextDelta() {
  const delta = pendingOverlayTextDeltaText;
  if (!delta) return;
  const taskId = pendingOverlayTextDeltaTaskId ?? activeTaskId ?? null;
  pendingOverlayTextDeltaText = "";
  pendingOverlayTextDeltaTaskId = null;
  if (!shouldRenderTaskFrameInCurrentOverlay(taskId)) return;
  applyOverlayTextDelta(taskId, delta);
}

function applyOverlayTextDelta(frameTaskId, delta) {
  if (!delta) return;
  const rawNextText = `${streamingBubbleRawText}${delta}`;
  const visibleNextText = sanitizeAssistantVisibleText(rawNextText);
  const nextRawText = visibleNextText !== rawNextText ? visibleNextText : rawNextText;
  if (!nextRawText && visibleNextText !== rawNextText) {
    streamingBubble?.remove?.();
    streamingBubble = null;
    streamingBubbleRawText = "";
    return;
  }
  if (looksLikeInternalAssistantText(nextRawText)) {
    streamingBubbleRawText = nextRawText;
    return;
  }
  // 83.4 — Keep thinking visible while the answer streams; terminal
  // events fold it after the run settles.
  if (!streamingBubble) {
    streamingBubble = document.createElement("div");
    streamingBubble.className = "bubble assistant streaming";
    bubbleArea.hidden = false;
    bubbleArea.appendChild(streamingBubble);
    streamingBubbleRawText = "";
    if (!isEchoTask(frameTaskId)) {
      void maybeRevealOverlay({ markEngaged: true });
    }
  }
  streamingBubbleRawText = nextRawText;
  streamingBubble.classList.remove("answer-placeholder");
  streamingBubble.innerHTML = renderMarkdown(streamingBubbleRawText);
  bubbleAreaPin.maybeScrollToBottom();
}

function waitForOverlaySmokeFrame() {
  return new Promise((resolve) => {
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    schedule(() => resolve());
  });
}

function waitForOverlaySmokeCondition(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      try {
        if (predicate()) {
          resolve(true);
          return;
        }
      } catch {
        // Keep polling until timeout; smoke callers return their own details.
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function createOverlaySmokeAudioStream() {
  const tracks = [{
    kind: "audio",
    readyState: "live",
    stop() {
      this.readyState = "ended";
      this.stopped = true;
    },
    addEventListener() {},
    removeEventListener() {}
  }];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
    __tracks: tracks
  };
}

function installOverlaySmokeMediaRecorder({ chunks = 2, label = "overlay-smoke" } = {}) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, "MediaRecorder");
  const hadOwnMediaRecorder = Object.prototype.hasOwnProperty.call(window, "MediaRecorder");
  const instances = [];
  const chunkCount = Math.max(1, Math.min(6, Number(chunks) || 2));

  class OverlaySmokeMediaRecorder extends EventTarget {
    static isTypeSupported(type) {
      return /^audio\/webm/i.test(String(type || ""));
    }

    constructor(stream, options = {}) {
      super();
      this.stream = stream;
      this.mimeType = options.mimeType || "audio/webm";
      this.state = "inactive";
      this.emittedChunks = 0;
      this.startTimeslice = null;
      instances.push(this);
    }

    start(timeslice) {
      this.state = "recording";
      this.startTimeslice = timeslice;
      for (let i = 0; i < chunkCount; i += 1) {
        setTimeout(() => this.#emitChunk(), 10 + i * 10);
      }
    }

    requestData() {
      this.#emitChunk();
    }

    stop() {
      if (this.state === "inactive") return;
      this.#emitChunk();
      this.state = "inactive";
      setTimeout(() => {
        this.dispatchEvent(new Event("stop"));
      }, 0);
    }

    #emitChunk() {
      if (this.state !== "recording") return;
      const blob = new Blob([`${label}-${this.emittedChunks}`], { type: this.mimeType });
      this.emittedChunks += 1;
      const event = new Event("dataavailable");
      Object.defineProperty(event, "data", { value: blob });
      this.dispatchEvent(event);
    }
  }

  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    writable: true,
    value: OverlaySmokeMediaRecorder
  });

  return {
    instances,
    restore() {
      if (originalDescriptor) {
        Object.defineProperty(window, "MediaRecorder", originalDescriptor);
      } else if (hadOwnMediaRecorder) {
        Object.defineProperty(window, "MediaRecorder", {
          configurable: true,
          writable: true,
          value: undefined
        });
      } else {
        try { delete window.MediaRecorder; } catch { /* ignore */ }
      }
    }
  };
}

const overlayShortcutSmokeEvents = [];

window.__lingxyOverlaySmoke = {
  getPendingFileSelection() {
    const chips = [...(bubbleArea?.querySelectorAll?.("[data-context-open-path]") ?? [])]
      .map((node) => node.getAttribute("data-context-open-path"))
      .filter(Boolean);
    return {
      ok: Boolean(pendingFileSelection?.filePaths?.length),
      sourceApp: pendingFileSelection?.sourceApp ?? null,
      captureMode: pendingFileSelection?.captureMode ?? null,
      filePaths: pendingFileSelection?.filePaths ?? [],
      openablePaths: chips
    };
  },
  getShortcutReceipts() {
    return [...overlayShortcutSmokeEvents];
  },
  async runVoiceMediaRecorderPath({ chunks = 2 } = {}) {
    const harness = installOverlaySmokeMediaRecorder({ chunks, label: "voice-mediarecorder-smoke" });
    const stream = createOverlaySmokeAudioStream();
    try {
      resetVoiceState();
      startVoiceLocalRecorder(stream);
      const recorder = voiceMediaRecorder;
      const receivedChunks = await waitForOverlaySmokeCondition(
        () => voiceAudioChunks.length >= Math.max(1, Number(chunks) || 2),
        1200
      );
      const chunkCount = voiceAudioChunks.length;
      const recordingState = recorder?.state ?? null;
      const stopResult = await stopVoiceLocalRecorder({ transcribe: false });
      const stoppedTracks = stream.__tracks.every((track) => track.readyState === "ended" || track.stopped === true);
      return {
        ok: Boolean(recorder) && recordingState === "recording" && receivedChunks && chunkCount > 0 && stopResult?.ok === true && stoppedTracks,
        chunkCount,
        emittedChunks: recorder?.emittedChunks ?? 0,
        mimeType: recorder?.mimeType ?? null,
        startTimeslice: recorder?.startTimeslice ?? null,
        stoppedTracks
      };
    } finally {
      harness.restore();
      resetVoiceState();
    }
  },
  async runNoteMicMediaRecorderPath({ chunks = 2 } = {}) {
    const harness = installOverlaySmokeMediaRecorder({ chunks, label: "note-mic-mediarecorder-smoke" });
    const stream = createOverlaySmokeAudioStream();
    const smokeSessionId = noteSessionId + 1;
    try {
      noteActive = true;
      noteSessionId = smokeSessionId;
      noteStoppingSessionId = null;
      noteStartTime = Date.now();
      noteMicAudioChunks = [];
      noteTranscripts = [];
      startNoteMicRecorder(stream, smokeSessionId);
      const recorder = noteMicMediaRecorder;
      const receivedChunks = await waitForOverlaySmokeCondition(
        () => noteMicAudioChunks.length >= Math.max(1, Number(chunks) || 2),
        1200
      );
      const chunkCount = noteMicAudioChunks.length;
      const recordingState = recorder?.state ?? null;
      await stopNoteMicRecorder();
      const stoppedTracks = stream.__tracks.every((track) => track.readyState === "ended" || track.stopped === true);
      return {
        ok: Boolean(recorder) && recordingState === "recording" && receivedChunks && chunkCount > 0 && noteMicMediaRecorder === null && stoppedTracks,
        chunkCount,
        emittedChunks: recorder?.emittedChunks ?? 0,
        mimeType: recorder?.mimeType ?? null,
        startTimeslice: recorder?.startTimeslice ?? null,
        stoppedTracks
      };
    } finally {
      noteActive = false;
      noteStoppingSessionId = null;
      noteMicMediaRecorder = null;
      noteMicStream = null;
      noteMicAudioChunks = [];
      publishNoteRecordingState({ active: false, elapsedMs: 0, elapsed: "00:00" });
      harness.restore();
    }
  },
  async runAudioHardwarePermissionPath({ recordMs = 900, timeoutMs = 6000 } = {}) {
    const started = performance.now();
    const input = await requestAudioInputStream({
      mediaDevices: navigator.mediaDevices,
      permissions: navigator.permissions,
      timeoutMs
    });
    if (!input?.ok) {
      return {
        ok: false,
        code: input?.code ?? "init_failed",
        message: describeAudioInputFailure(input),
        durationMs: Math.round(performance.now() - started)
      };
    }

    const stream = input.stream;
    const tracks = stream?.getAudioTracks?.() ?? [];
    const chunks = [];
    let recorder = null;
    try {
      if (tracks.length === 0) {
        return {
          ok: false,
          code: "no_audio_track",
          message: "getUserMedia returned a stream without audio tracks.",
          durationMs: Math.round(performance.now() - started)
        };
      }
      if (typeof MediaRecorder !== "function") {
        return {
          ok: false,
          code: "mediarecorder_unsupported",
          message: "MediaRecorder is unavailable after microphone permission was granted.",
          audioTrackCount: tracks.length,
          durationMs: Math.round(performance.now() - started)
        };
      }

      const options = {};
      if (MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      }
      const stopped = new Promise((resolve, reject) => {
        recorder = new MediaRecorder(stream, options);
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener("error", (event) => {
          reject(event.error ?? new Error("MediaRecorder hardware smoke failed"));
        });
        recorder.addEventListener("stop", resolve, { once: true });
      });
      recorder.start(120);
      await new Promise((resolve) => setTimeout(resolve, Math.max(300, Number(recordMs) || 900)));
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      const bytes = chunks.reduce((sum, chunk) => sum + (chunk?.size ?? 0), 0);
      return {
        ok: bytes > 0,
        code: bytes > 0 ? "ok" : "empty_recording",
        message: bytes > 0 ? "microphone capture produced audio data" : "microphone capture produced no audio chunks",
        audioTrackCount: tracks.length,
        chunkCount: chunks.length,
        bytes,
        mimeType: recorder.mimeType ?? null,
        trackLabels: tracks.map((track) => track.label).filter(Boolean).slice(0, 3),
        trackStates: tracks.map((track) => track.readyState),
        durationMs: Math.round(performance.now() - started)
      };
    } catch (error) {
      return {
        ok: false,
        code: "recording_failed",
        message: error?.message ?? String(error),
        audioTrackCount: tracks.length,
        durationMs: Math.round(performance.now() - started)
      };
    } finally {
      for (const track of tracks) {
        try { track.stop?.(); } catch { /* ignore cleanup */ }
      }
    }
  },
  async runTextDeltaLoad({ chunks = 1000, chunkText = "x", taskId = "gui-smoke-stream" } = {}) {
    const count = Math.max(1, Math.min(5000, Number(chunks) || 1000));
    const text = String(chunkText || "x");
    const started = performance.now();
    const smokeConversation = ensureConversation(null, "GUI smoke stream");
    activeTaskId = taskId;
    const visibleConversationId = smokeConversation?.id
      ?? conversationState?.id
      ?? projectStore?.currentConversationId
      ?? null;
    if (visibleConversationId) {
      bindTaskToConversationId(taskConversationMap, taskId, visibleConversationId);
    }
    const visibilityBefore = taskFrameVisibilityForCurrentOverlay(taskId);
    streamingBubble?.remove?.();
    streamingBubble = null;
    streamingBubbleRawText = "";
    pendingOverlayTextDeltaTaskId = null;
    pendingOverlayTextDeltaText = "";
    for (let i = 0; i < count; i += 1) {
      queueOverlayTextDelta(taskId, text);
    }
    await waitForOverlaySmokeFrame();
    await waitForOverlaySmokeFrame();
    flushOverlayTextDelta();
    const renderedText = streamingBubble?.textContent ?? "";
    const durationMs = Math.round(performance.now() - started);
    return {
      ok: renderedText.length >= count * text.length,
      chunks: count,
      rendered_chars: renderedText.length,
      expected_chars: count * text.length,
      duration_ms: durationMs,
      streaming_bubbles: bubbleArea?.querySelectorAll?.(".bubble.assistant.streaming")?.length ?? 0,
      active_task_id: activeTaskId,
      visible_conversation_id: visibleConversationId,
      conversation_state_id: conversationState?.id ?? null,
      project_current_conversation_id: projectStore?.currentConversationId ?? null,
      visibility_reason: visibilityBefore.reason,
      owner_conversation_id: visibilityBefore.ownerConversationId ?? null
    };
  },
  async runStopButtonCancel({ taskId = "gui-smoke-stop-button" } = {}) {
    activeTaskId = taskId;
    lastTask = {
      task_id: taskId,
      status: "running",
      sub_status: null
    };
    cancellationRequestedTaskId = null;
    refreshSendBtnMode();
    const beforeLabel = sendBtn?.getAttribute?.("aria-label") ?? "";
    sendBtn?.click?.();
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && cancellationRequestedTaskId !== taskId) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const firstCancelRegistered = cancellationRequestedTaskId === taskId;
    refreshSendBtnMode();
    const afterLabel = sendBtn?.getAttribute?.("aria-label") ?? "";
    return {
      ok: firstCancelRegistered && /取消|强制取消|停止/.test(afterLabel),
      taskId,
      beforeLabel,
      afterLabel,
      firstCancelRegistered,
      stopClass: Boolean(sendBtn?.classList?.contains("send-btn--stop")),
      cancellingClass: Boolean(sendBtn?.classList?.contains("send-btn--cancelling"))
    };
  },
  async runInlineErrorRetry({ taskId = "gui-smoke-overlay-inline-retry" } = {}) {
    bubbleArea?.querySelectorAll?.(`.chat-inline-error[data-task-id="${CSS.escape(taskId)}"]`)?.forEach((node) => {
      node.closest?.(".bubble")?.remove?.();
    });
    const card = appendOverlayErrorBlock(taskId, {
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
  async runLlmUsageTimeline({ taskId = "gui-smoke-overlay-llm-usage" } = {}) {
    overlayLlmUsageEventsByTaskId.delete(taskId);
    timelineUsageEl?.remove?.();
    timelineUsageEl = null;
    for (const id of ["gui-smoke-usage-1", "gui-smoke-usage-2"]) {
      renderedTimelineEventIds.delete(id);
    }
    renderTaskTimelineEvent({
      id: "gui-smoke-usage-1",
      event: "llm_usage",
      taskId,
      timestamp: new Date().toISOString(),
      data: {
        call_site: "tool_using.planner",
        provider_name: "DeepSeek",
        model: "deepseek-v4-flash",
        stream: true,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          prompt_cache_hit_tokens: 70,
          prompt_cache_miss_tokens: 30
        },
        prompt_segments_estimate: {
          segments: [
            { name: "system", estimated_tokens: 60 },
            { name: "current", estimated_tokens: 20 },
            { name: "tool_schemas", estimated_tokens: 15 }
          ]
        }
      }
    }, { showOverlay: true });
    renderTaskTimelineEvent({
      id: "gui-smoke-usage-2",
      event: "llm_usage",
      taskId,
      timestamp: new Date().toISOString(),
      data: {
        call_site: "tool_using.final_composer",
        provider_name: "DeepSeek",
        model: "deepseek-v4-flash",
        usage: {
          input_tokens: 40,
          output_tokens: 10,
          cache_read_input_tokens: 25
        },
        prompt_segments_estimate: {
          segments: [
            { name: "system", estimated_tokens: 12 },
            { name: "current", estimated_tokens: 18 }
          ]
        }
      }
    }, { showOverlay: true });
    await waitForOverlaySmokeFrame();
    const text = timelineUsageEl?.textContent ?? "";
    return {
      ok: /模型用量/.test(text) && /170 tokens/.test(text) && /2 calls/.test(text) && /hit 70/.test(text) && /read 25/.test(text),
      taskId,
      text
    };
  }
};

async function handleTaskEventFrame(rawEvent) {
  const frameViewGeneration = overlayViewGeneration;
  const frame = toTaskEventFrame(rawEvent);
  if (frame.id && handledTaskEventIds.has(frame.id)) return;
  if (frame.id) handledTaskEventIds.add(frame.id);

  const summary = formatTaskEventSummary(frame);

  // Work out whether this event belongs to the conversation the user is
  // currently looking at. Events for other conversations still need to
  // mutate the owning conversation's turns list; we just don't render
  // bubbles for them.
  const frameTaskId = frame.taskId ?? frame.task_id ?? activeTaskId;
  if (frameTaskId && isEchoOriginEventFrame(frame)) {
    rememberEchoTask(frameTaskId);
  }
  const visibility = taskFrameVisibilityForCurrentOverlay(frameTaskId, { viewGeneration: frameViewGeneration });
  const isForActiveConv = visibility.render;

  if (lastTask?.task_id === activeTaskId) {
    lastTask = applyTaskEventPatch(lastTask, frame);
    // Status may have flipped from running → success/failed/cancelled, so
    // sync the Send-vs-Stop affordance on every event. Cheap; idempotent.
    refreshSendBtnMode();
  }

  if (isForActiveConv) {
    renderTaskTimelineEvent(frame, { showOverlay: true });
  }

  if (frame.event === "final_composer_started" && isForActiveConv) {
    ensureStreamingAnswerPlaceholder({
      taskId: frameTaskId ?? activeTaskId ?? null,
      reveal: !isEchoTask(frameTaskId)
    });
  }

  if (frame.event === "text_delta") {
    if (!isForActiveConv) return; // silent streams don't build bubbles
    const delta = frame.data?.delta ?? frame.data?.text ?? "";
    if (!delta) return;
    queueOverlayTextDelta(frameTaskId, delta);
    return;
  }

  if (frame.event === "inline_result") {
    flushOverlayTextDelta();
    const text = frame.data?.text ?? summary.body ?? "";
    const trimmedText = text.trim();
    const isPlannerPlaceholder = trimmedText === "(no response from agentic planner)";
    if (text && !isPlannerPlaceholder) {
      const visibleText = sanitizeAssistantVisibleText(text).trim();
      if (!visibleText) return;
      if (isForActiveConv) {
        if (streamingBubble) {
          // Tool-step bubbles get appended while the task runs, so move the
          // live answer node to the tail before finalising it.
          bubbleArea.appendChild(streamingBubble);
          streamingBubble.classList.remove("streaming");
          streamingBubble.classList.remove("answer-placeholder");
          streamingBubbleRawText = visibleText;
          streamingBubble.dataset.rawText = visibleText;
          streamingBubble.innerHTML = renderMarkdown(streamingBubbleRawText);
          // Now that streaming has settled, attach the action row (+
          // Note, ↻ 重新生成) and timestamp. Done after the last
          // innerHTML write so the next render can't wipe them. Without
          // this the streaming-derived answer used to lack both the
          // note button and the regenerate affordance.
          appendAssistantActions(streamingBubble, visibleText, frameTaskId ?? activeTaskId ?? null);
          appendBubbleTimestamp(streamingBubble);
          streamingBubble = null;
          streamingBubbleRawText = "";
        } else {
          streamingBubbleRawText = "";
          addBubble("assistant", visibleText, { taskId: frameTaskId ?? activeTaskId ?? null });
        }
        bubbleAreaPin.maybeScrollToBottom();
      }
      appendTurnForTask(frameTaskId, "assistant", text);
      if (isForActiveConv) {
        lastArtifactPreview = text;
        // Inline_result already rendered the assistant text — mark the task
        // as notified so the downstream status_changed=success path
        // (overlay.js ~3124) doesn't append a SECOND bubble with the same
        // content. The previous `artifact.required === false` gating only
        // fired when task_spec was strongly populated, so multi_modal /
        // image-submission tasks (whose preflight task_spec has
        // `artifact.required` undefined) double-rendered every reply.
        notifiedInlineResultTaskId = activeTaskId;
        if (!isEchoTask(frameTaskId) && shouldAutoRevealTaskResult()) void maybeRevealOverlay();
        // Fire success popup card from the inline-result path as well —
        // the downstream status_changed=success block is guarded by
        // notifiedInlineResultTaskId and otherwise wouldn't trigger the
        // card for streaming conversational replies.
        fireSuccessPopupCardOnce(frameTaskId, {
          title: lastTask?.intent ?? "任务完成",
          body: text,
          openWindow: "overlay"
        });
        showEchoResultHudOnce(frameTaskId, {
          title: lastTask?.intent ?? "任务完成",
          text,
          kind: "success"
        });
      }
    }
  }

  if (frame.event === "artifact_created") {
    // Artifact events are operational status, not assistant speech. The
    // artifact itself is surfaced by preview/result cards and task detail;
    // rendering "Artifact created: ..." in the chat makes normal users see
    // internal event names.
    if (isForActiveConv) {
      lastArtifactPath = frame.data?.path ?? lastArtifactPath;
    }
  }

  if (frame.event === "evidence_summary" && isForActiveConv) {
    appendOverlayEvidenceSources(frameTaskId, frame.data ?? {});
  }

  // UCA-075: Skill proposal — user can save the repeated tool sequence as a skill
  if (frame.event === "skill_proposal" && isForActiveConv) {
    const proposal = frame.data?.proposal;
    const text = frame.data?.text ?? "💡 检测到重复操作，是否保存为可复用技能？";
    if (proposal) {
      addBubble("assistant", text, {
        optionButtons: [
          {
            label: "保存为技能",
            onClick: async () => {
              try {
                const resp = await saveAutoSkillViaShell(proposal);
                addSystemBubble(`✅ 技能「${resp.suggestedName ?? proposal.suggestedName ?? resp.skillId}」已保存。`);
              } catch (err) {
                addSystemBubble(`保存技能失败：${err.message}`);
              }
            }
          },
          { label: "不用了", onClick: () => {} }
        ]
      });
      void maybeRevealOverlay();
    }
  }

  if (["success", "partial_success", "failed", "cancelled"].includes(frame.event)) {
    flushOverlayTextDelta();
    if (isForActiveConv) {
      const doneLabel = frame.event === "success" ? "已完成"
        : frame.event === "partial_success" ? "部分完成"
          : frame.event === "failed" ? "执行失败"
            : "已取消";
      timelineDone(doneLabel);
      // Task settled — fold the thinking card now so the answer reads as
      // the primary surface. The card is still expandable on click; we
      // also stamp it with the final character count as a residual hint.
      closeActiveThinkingCard();
      const detail = await refreshActiveTask();
      if (shouldRenderTaskFrameInCurrentOverlay(frameTaskId, frameViewGeneration)) {
        appendOverlayContentEvidence(frameTaskId, extractContentEvidenceFromTaskDetail(detail));
        if ((frame.event === "success" || frame.event === "partial_success") && frame.data?.evidence_summary) {
          appendOverlayEvidenceSources(frameTaskId, frame.data.evidence_summary);
        }
      }
    }
    if (frame.event === "partial_success") {
      fireSuccessPopupCardOnce(frameTaskId, {
        title: lastTask?.intent ?? "部分完成",
        body: frame.data?.text ?? frame.data?.summary ?? "任务已部分完成。",
        openWindow: "overlay",
        terminal: true
      });
      showEchoResultHudOnce(frameTaskId, {
        title: lastTask?.intent ?? "部分完成",
        text: frame.data?.text ?? "任务已完成，但有一些限制。",
        kind: "info"
      });
    } else if (frame.event === "success") {
      fireSuccessPopupCardOnce(frameTaskId, {
        title: lastTask?.intent ?? "任务完成",
        body: frame.data?.text ?? frame.data?.summary ?? lastTask?.result_summary ?? lastArtifactPreview ?? "任务已完成。",
        openWindow: "overlay",
        terminal: true
      });
      showEchoResultHudOnce(frameTaskId, {
        title: lastTask?.intent ?? "任务完成",
        text: frame.data?.text ?? frame.data?.summary ?? lastTask?.result_summary ?? lastArtifactPreview ?? "任务已完成。",
        kind: "success"
      });
    } else if (frame.event === "failed") {
      if (isForActiveConv) appendOverlayErrorBlock(frameTaskId, frame.data ?? {});
      showEchoResultHudOnce(frameTaskId, {
        title: lastTask?.intent ?? "任务失败",
        text: frame.data?.message ?? frame.data?.text ?? "任务失败，请打开对话查看详情。",
        kind: "error",
        durationMs: 10000
      });
    } else if (frame.event === "cancelled") {
      if (isForActiveConv) appendOverlayErrorBlock(frameTaskId, frame.data ?? {}, { cancelled: true });
      showEchoResultHudOnce(frameTaskId, {
        title: "任务已取消",
        text: frame.data?.message ?? "",
        kind: "info"
      });
    }
    // Close any background stream for this task — it's done, no more events.
    if (frameTaskId) {
      const dispose = backgroundTaskStreams.get(frameTaskId);
      if (typeof dispose === "function") {
        try { dispose(); } catch { /* ignore */ }
        backgroundTaskStreams.delete(frameTaskId);
      }
      // Also clear the owning conversation's activeTaskId so future switches
      // don't try to re-attach to a terminated task.
      const ownerId = taskOwnerConversationId(taskConversationMap, frameTaskId);
      if (ownerId && projectStore) {
        const owner = projectStore.conversations.find((c) => c.id === ownerId);
        if (owner && owner.activeTaskId === frameTaskId) {
          owner.activeTaskId = null;
          saveProjectStore();
        }
      }
      finishEchoTaskSurface(frameTaskId);
    }
  }
}

// When the user switches conversations, demote the currently-active SSE
// stream (tied to the outgoing conversation's task) to a silent background
// subscription. Events keep flowing through handleTaskEventFrame, which
// routes them to the owning conversation via taskConversationMap.
function demoteActiveStreamToBackground() {
  if (!activeTaskEventTaskId || !activeTaskEventStream) return;
  const taskId = activeTaskEventTaskId;
  // Re-subscribe as a fresh background stream — same callback, just not
  // referenced by the "active" pointers. This makes the ownership transfer
  // explicit and lets us close the original subscription cleanly.
  try {
    const dispose = typeof activeTaskEventStream === "function"
      ? activeTaskEventStream
      : activeTaskEventStream?.close ?? activeTaskEventStream?.dispose;
    if (typeof dispose === "function") dispose();
  } catch { /* ignore */ }
  const bgStream = subscribeTaskEvents(serviceBaseUrl, taskId, {
    onEvent(event) { void handleTaskEventFrame(event); },
    onError() {
      // background streams reconnect silently; drop the reference so the
      // next refresh can re-establish.
      backgroundTaskStreams.delete(taskId);
    }
  });
  backgroundTaskStreams.set(taskId, typeof bgStream === "function" ? bgStream : () => {
    try { (bgStream?.close ?? bgStream?.dispose)?.call(bgStream); } catch { /* ignore */ }
  });
  activeTaskEventStream = null;
  activeTaskEventTaskId = null;
  activeTaskEventBaseUrl = null;
}

function ensureActiveTaskEventStream(taskId) {
  if (!taskId) { closeActiveTaskEventStream(); return; }
  if (activeTaskEventTaskId === taskId && activeTaskEventBaseUrl === serviceBaseUrl && activeTaskEventStream) return;

  closeActiveTaskEventStream();
  activeTaskEventTaskId = taskId;
  activeTaskEventBaseUrl = serviceBaseUrl;
  activeTaskEventStream = subscribeTaskEvents(serviceBaseUrl, taskId, {
    onEvent(event) { void handleTaskEventFrame(event); },
    onError() {
      // Connection dropped — clear reference so the next refreshActiveTask()
      // call will reconnect, and trigger an immediate REST poll to catch any
      // completion events we missed while disconnected.
      if (activeTaskEventTaskId === taskId) {
        activeTaskEventStream = null;
      }
      void refreshActiveTask();
    }
  });
}

function switchActiveTask(taskId) {
  if (!taskId) return;
  activeTaskId = taskId;
  ensureActiveTaskEventStream(taskId);
  void refreshActiveTask();
}

function clearPendingInputContext() {
  pendingFileSelection = null;
  pendingCapture = null;
  pendingActiveWindowContext = null;
  pendingActiveWindowContextCapturedAt = 0;
  // Keep the voice-card chip strip in sync when files are cleared via any
  // path (submit success, new conversation, cancel).
  if (typeof renderVoiceChips === "function") renderVoiceChips();
}

function isRetryCommand(text = "") {
  return /^(重试一次|再试一次|重新试一次|重新生成|retry|try again|rerun)$/i.test(text.trim());
}

async function retryActiveTaskFromOverlay() {
  const taskId = lastTask?.task_id ?? activeTaskId;
  if (!taskId) {
    addSystemBubble("没有可重试的任务。");
    return false;
  }

  addSystemBubble("Retrying previous task...");
  try {
    const result = await retryTaskViaShell(taskId, { mode: "retry_same", background: true });
    if (result.task?.task_id) {
      activeTaskId = result.task.task_id;
      lastTask = result.task;
      notifiedTaskId = null;
      notifiedInlineResultTaskId = null;
      lastArtifactPreview = "";
      bindTaskToConversation(activeTaskId);
      ensureActiveTaskEventStream(activeTaskId);
      clearPendingInputContext();
      addBubble("assistant", "Processing in background...");
      conversationPhase = "idle";
      return true;
    }
    addSystemBubble("重试接口没有返回任务。");
    return false;
  } catch (error) {
    addBubble("assistant", `Retry failed: ${error.message}`);
    conversationPhase = "idle";
    return false;
  }
}

async function refreshTaskSummaries(force = false) {
  const now = Date.now();
  if (!force && now - lastTaskSummaryRefresh < 4000) return taskSummaries;
  try {
    const payload = await overlayTaskClient.fetchTaskSummaries({ limit: 120 });
    taskSummaries = payload.recent ?? payload.tasks ?? [];
    lastTaskSummaryRefresh = now;
    repairAutomaticTaskConversations(taskSummaries);
    void surfaceAutomaticTaskResults(taskSummaries);
  } catch {
    // ignore
  }
  return taskSummaries;
}

function repairAutomaticTaskConversations(tasks = []) {
  if (!projectStore?.conversations?.length) return;
  const byTaskId = new Map(tasks.filter((task) => task?.task_id).map((task) => [task.task_id, task]));
  let changed = false;
  for (const conversation of projectStore.conversations) {
    if (!conversation?.projectId || conversation.metadata?.autoSource) continue;
    if (conversation.projectId === AUTO_SCHEDULE_PROJECT_ID || conversation.projectId === AUTO_EMAIL_PROJECT_ID) continue;
    const task = [...taskIdsForConversation(conversation)]
      .map((taskId) => byTaskId.get(taskId))
      .find((candidate) => isAutomaticResultTask(candidate));
    if (!task) continue;
    const projectInfo = automaticProjectForTask(task);
    ensureSystemProject(projectInfo.projectId, projectInfo.name, projectInfo.color);
    const previousProjectId = conversation.projectId;
    conversation.projectId = projectInfo.projectId;
    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      autoSource: projectInfo.projectId === AUTO_EMAIL_PROJECT_ID ? "email" : "schedule",
      movedFromProjectId: previousProjectId,
      latestTaskId: task.task_id,
      unread: conversation.id !== conversationState?.id
    };
    if (conversation.id === conversationState?.id) {
      projectStore.currentProjectId = projectInfo.projectId;
    }
    changed = true;
  }
  if (changed) {
    saveProjectStore();
    renderProjectPanel();
  }
}

function loadSurfacedAutoTaskIds() {
  try {
    const raw = localStorage.getItem(AUTO_TASK_SURFACED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSurfacedAutoTaskIds(ids) {
  try {
    localStorage.setItem(AUTO_TASK_SURFACED_KEY, JSON.stringify([...ids].slice(-100)));
  } catch { /* ignore */ }
}

function appendAutomaticTurnToConversation({ task, detail, text }) {
  if (!text) return null;
  if (!projectStore) loadProjectStore();
  const projectInfo = automaticProjectForTask(task);
  ensureSystemProject(projectInfo.projectId, projectInfo.name, projectInfo.color);
  const conversationKey = automaticConversationKey(task, detail);
  let conv = projectStore.conversations.find((item) =>
    item.projectId === projectInfo.projectId
    && item.metadata?.autoKey === conversationKey
  );
  if (!conv) {
    conv = {
      id: `conv_auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      projectId: projectInfo.projectId,
      title: titleForAutomaticConversation(task, detail),
      seedCapture: null,
      seedCommand: task.user_command ?? task.intent ?? projectInfo.name,
      turns: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        autoKey: conversationKey,
        autoSource: projectInfo.projectId === AUTO_EMAIL_PROJECT_ID ? "email" : "schedule",
        unread: true,
        latestTaskId: task.task_id
      }
    };
    projectStore.conversations.push(conv);
  }
  conv.turns = Array.isArray(conv.turns) ? conv.turns : [];
  const existingTurn = conv.turns.find((turn) => turn.taskId === task.task_id && turn.role === "assistant");
  if (existingTurn) {
    existingTurn.content = text;
    existingTurn.ts = Date.now();
  } else {
    conv.turns.push({ role: "assistant", content: text, ts: Date.now(), taskId: task.task_id });
  }
  conv.updatedAt = Date.now();
  conv.metadata = {
    ...(conv.metadata ?? {}),
    unread: conv.id !== conversationState?.id,
    latestTaskId: task.task_id
  };
  if (conv.id === conversationState?.id) {
    addBubble("assistant", text);
  }
  saveProjectStore();
  return conv;
}

function canonicalConversationIdForTask(task = {}, detail = {}) {
  const detailTask = detail?.task ?? task;
  return detailTask?.conversation_id
    ?? detailTask?.context_packet?.selection_metadata?.conversation_id
    ?? task?.conversation_id
    ?? task?.context_packet?.selection_metadata?.conversation_id
    ?? null;
}

function ensureCanonicalAutomaticConversation({ task, detail }) {
  const conversationId = canonicalConversationIdForTask(task, detail);
  if (!conversationId) return null;
  if (!projectStore) loadProjectStore();
  const projectInfo = automaticProjectForTask(task);
  const projectId = task?.project_id
    ?? detail?.task?.project_id
    ?? task?.context_packet?.selection_metadata?.project_id
    ?? detail?.task?.context_packet?.selection_metadata?.project_id
    ?? projectInfo.projectId;
  ensureSystemProject(projectId, projectInfo.name, projectInfo.color);
  let conv = projectStore.conversations.find((item) => item.id === conversationId);
  if (!conv) {
    conv = {
      id: conversationId,
      projectId,
      title: titleForAutomaticConversation(task, detail),
      seedCapture: null,
      seedCommand: task.user_command ?? task.intent ?? projectInfo.name,
      turns: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {}
    };
    projectStore.conversations.push(conv);
  }
  conv.projectId = conv.projectId ?? projectId;
  conv.turns = Array.isArray(conv.turns) ? conv.turns : [];
  conv.updatedAt = Date.now();
  conv.metadata = {
    ...(conv.metadata ?? {}),
    autoSource: projectInfo.projectId === AUTO_EMAIL_PROJECT_ID ? "email" : "schedule",
    backendCanonical: true,
    unread: conv.id !== conversationState?.id,
    latestTaskId: task.task_id
  };
  saveProjectStore();
  return conv;
}

async function surfaceAutomaticTaskResults(tasks = []) {
  const surfaced = loadSurfacedAutoTaskIds();
  const now = Date.now();
  const candidates = sortTasksNewestFirst(tasks)
    .filter((task) => task?.task_id && !surfaced.has(task.task_id))
    .filter((task) => isAutomaticResultTask(task) && taskIsDone(task.status))
    .filter((task) => {
      const updated = new Date(task.updated_at ?? task.created_at ?? 0).getTime();
      return Number.isFinite(updated) && now - updated < 24 * 60 * 60_000;
    })
    .slice(0, 5);
  if (!candidates.length) return;

  for (const task of candidates.reverse()) {
    surfaced.add(task.task_id);
    try {
      const detail = await overlayTaskClient.fetchTaskDetail(task.task_id);
      if (canonicalConversationIdForTask(task, detail)) {
        ensureCanonicalAutomaticConversation({ task, detail });
        renderProjectPanel();
        continue;
      }
      const finalText = finalTextFromTaskDetail(detail).trim();
      const artifactLines = (detail?.task?.artifacts ?? task.artifacts ?? [])
        .map((artifact) => artifact?.path)
        .filter(Boolean)
        .map((artifactPath) => `文件：${artifactPath}`);
      const title = isEmailDigestTask(task)
        ? "邮件摘要"
        : "定时任务结果";
      const body = [finalText, ...artifactLines].filter(Boolean).join("\n\n");
      if (!body) continue;
      const renderedText = `**${title}**\n\n${body}`;
      appendAutomaticTurnToConversation({ task, detail, text: renderedText });
      renderProjectPanel();
    } catch {
      // keep marked to avoid hammering a bad legacy task forever
    }
  }
  saveSurfacedAutoTaskIds(surfaced);
}

async function openTaskResultInOverlayConversation(taskId, fallback = {}) {
  if (!taskId) return false;
  try {
    const detail = await overlayTaskClient.fetchTaskDetail(taskId);
    const task = detail?.task ?? {};
    if (isAutomaticResultTask(task) && canonicalConversationIdForTask(task, detail)) {
      const conv = ensureCanonicalAutomaticConversation({ task, detail });
      if (conv?.id) {
        switchConversation(conv.id);
        renderProjectPanel();
        void maybeRevealOverlay({ markEngaged: true });
      }
      const surfaced = loadSurfacedAutoTaskIds();
      surfaced.add(taskId);
      saveSurfacedAutoTaskIds(surfaced);
      return true;
    }
    const finalText = finalTextFromTaskDetail(detail).trim()
      || String(fallback.inlinePreview ?? "").trim()
      || (Array.isArray(fallback.lines) ? fallback.lines.join("\n").trim() : "");
    const artifactLines = (detail?.artifacts ?? task.artifacts ?? [])
      .map((artifact) => artifact?.path)
      .filter(Boolean)
      .map((artifactPath) => `文件：${artifactPath}`);
    const body = [finalText, ...artifactLines].filter(Boolean).join("\n\n");
    if (!body) return false;

    if (isAutomaticResultTask(task)) {
      const title = isEmailDigestTask(task) ? "邮件摘要" : "定时任务结果";
      const conv = appendAutomaticTurnToConversation({
        task,
        detail,
        text: `**${title}**\n\n${body}`
      });
      if (conv?.id) {
        switchConversation(conv.id);
        renderProjectPanel();
        void maybeRevealOverlay({ markEngaged: true });
      }
      const surfaced = loadSurfacedAutoTaskIds();
      surfaced.add(taskId);
      saveSurfacedAutoTaskIds(surfaced);
      return true;
    }

    ensureConversation(null, task.user_command ?? fallback.title ?? "任务结果");
    addBubble("assistant", body);
    appendTurn("assistant", body);
    void maybeRevealOverlay({ markEngaged: true });
    return true;
  } catch {
    return false;
  }
}

function taskIsActive(status) {
  return ["queued", "running", "cancelling", "starting"].includes(status);
}

function taskIsDone(status) {
  return ["success", "partial_success", "failed", "cancelled"].includes(status);
}

function isUserVisibleTask(task) {
  if (!task) return false;
  if (task.hidden === true || task.ui_hidden === true) return false;
  // Automatic tasks used to disappear from the overlay, which made scheduled
  // runs and email digests look like nothing was happening. Treat task
  // visibility as a UI contract instead: anything the runtime records as a
  // task is visible unless it explicitly opts out with hidden/ui_hidden.
  return true;
}

function sortTasksNewestFirst(tasks = []) {
  return [...tasks].sort((left, right) =>
    `${right.updated_at ?? right.created_at ?? ""}`.localeCompare(`${left.updated_at ?? left.created_at ?? ""}`)
  );
}

function findLatestOverlayTask(tasks = taskSummaries) {
  const visible = sortTasksNewestFirst(tasks).filter(isUserVisibleTask);
  return visible.find((task) => taskIsActive(task.status))
    ?? visible.find((task) => {
      if (isNestedChildTask(task)) return false;
      const updatedAt = new Date(task.updated_at ?? task.created_at ?? 0).getTime();
      return Number.isFinite(updatedAt) && Date.now() - updatedAt < 15 * 60_000;
    })
    ?? null;
}

async function attachLatestActiveTaskToOverlay() {
  const tasks = await refreshTaskSummaries(true);
  const current = tasks.find((task) => task.task_id === activeTaskId);
  if (current && isUserVisibleTask(current) && taskIsActive(current.status)) return false;
  const latest = findLatestOverlayTask(tasks);
  // Only auto-attach tasks that are still running. Re-attaching terminal
  // (failed/success/cancelled) tasks on every window focus was replaying
  // stale failure timelines into freshly-opened overlays, making users
  // think the old failure was a new one.
  if (!latest?.task_id || latest.task_id === activeTaskId) return false;
  if (!taskIsActive(latest.status)) return false;
  // Don't hijack: if this task belongs to a DIFFERENT conversation than the
  // one the user is currently looking at, leave it alone. Its results will
  // land in the originating conversation via the background SSE stream +
  // taskConversationMap routing. Without this guard, opening overlay while
  // conversation B has a running task pulls its events into conversation A's
  // bubble area — the exact "两个任务跑完只剩一个结果跑错对话框" bug.
  const owner = taskOwnerConversationId(taskConversationMap, latest.task_id)
    ?? latest.conversation_id
    ?? latest.context_packet?.selection_metadata?.conversation_id
    ?? null;
  if (owner) {
    bindTaskToConversationId(taskConversationMap, latest.task_id, owner);
  }
  if (owner && conversationState?.id && owner !== conversationState.id) return false;
  // A task with no conversation owner is a background/system task from the
  // chat surface's point of view. Keep it in the task dock instead of
  // hijacking a newly opened conversation with a stale "running" state.
  if (!owner) return false;
  activeTaskId = latest.task_id;
  lastTask = latest;
  notifiedTaskId = null;
  notifiedInlineResultTaskId = null;
  pendingToolStepBubbles = {};
  renderedEvidenceSummaryTaskIds = new Set();
  renderedContentEvidenceTaskIds = new Set();
  ensureActiveTaskEventStream(activeTaskId);
  await refreshActiveTask();
  return true;
}

function renderCompositeBreadcrumb({ parentTask, currentTask, childIndex }) {
  if (!parentTask) return "";
  const childLabel = childIndex != null ? `#${childIndex + 1} ${currentTask?.user_command ?? currentTask?.intent ?? ""}`.trim() : "";
  const label = `📦 复合任务${childLabel ? ` > ${childLabel}` : ""}`;
  return escapeHtml(label);
}

function buildChildBadgeRow({ parentTask, activeChildId }) {
  const childIds = Array.isArray(parentTask?.child_task_ids) ? parentTask.child_task_ids : [];
  if (childIds.length === 0) return "";
  return `
    <div class="child-badge-row" data-role="childBadgeRow">
      ${childIds.map((childId, index) => {
        const isActive = childId === activeChildId;
        return `<button type="button" data-child-badge="${escapeHtml(childId)}" class="${isActive ? "active" : ""}">#${index + 1}</button>`;
      }).join("")}
    </div>
  `;
}

async function ensureCompositeHeader(task, { viewGeneration = overlayViewGeneration } = {}) {
  if (!bubbleArea) return;
  if (!isOverlayViewGenerationCurrent(viewGeneration)) return;
  if (task?.task_id && !shouldRenderTaskFrameInCurrentOverlay(task.task_id, viewGeneration)) return;
  if (!task?.task_id) {
    compositeHeaderTaskId = null;
    const existing = bubbleArea.querySelector("[data-composite-header]");
    if (existing) existing.remove();
    return;
  }

  const isParent = Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0;
  const parentId = isParent ? task.task_id : (isCompositeChildTask(task) ? task.parent_task_id : null);
  if (!parentId) {
    compositeHeaderTaskId = null;
    const existing = bubbleArea.querySelector("[data-composite-header]");
    if (existing) existing.remove();
    return;
  }

  if (compositeHeaderTaskId === `${task.task_id}:${parentId}`) {
    return;
  }

  let parentTask = isParent ? task : null;
  if (!parentTask) {
    try {
      const detail = await overlayTaskClient.fetchTaskDetail(parentId);
      parentTask = detail.task ?? detail;
    } catch { /* ignore */ }
  }

  if (!isOverlayViewGenerationCurrent(viewGeneration)) return;
  if (!shouldRenderTaskFrameInCurrentOverlay(task.task_id, viewGeneration)) return;
  if (!parentTask) return;

  compositeHeaderTaskId = `${task.task_id}:${parentId}`;
  const childIndex = Number.isInteger(task.child_index) ? task.child_index : null;
  const breadcrumb = renderCompositeBreadcrumb({ parentTask, currentTask: task, childIndex });
  const badgeRow = buildChildBadgeRow({ parentTask, activeChildId: isParent ? null : task.task_id });
  const existing = bubbleArea.querySelector("[data-composite-header]");
  if (existing) existing.remove();

  const header = document.createElement("div");
  header.className = "bubble system";
  header.dataset.compositeHeader = "1";
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;justify-content:space-between;">
      <span>${breadcrumb}</span>
      ${!isParent ? `<button data-parent-task="${escapeHtml(parentId)}" class="ghost" style="font-size:10px;padding:2px 6px;">返回总览</button>` : ""}
    </div>
    ${badgeRow}
  `;
  bubbleArea.prepend(header);

  for (const btn of header.querySelectorAll("[data-child-badge]")) {
    btn.addEventListener("click", () => switchActiveTask(btn.dataset.childBadge));
  }
  const parentBtn = header.querySelector("[data-parent-task]");
  parentBtn?.addEventListener("click", () => switchActiveTask(parentBtn.dataset.parentTask));
}

function normalisePreviewText(rawText = "") {
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatArtifactLabel(artifactPath = "") {
  return formatSharedArtifactLabel(artifactPath);
}

function isPreviewableArtifactPath(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  return [".md", ".txt", ".json", ".csv", ".html", ".htm"].some((ext) => p.endsWith(ext));
}

function choosePreviewArtifactPath(artifacts = []) {
  const exts = [".md", ".txt", ".json", ".csv", ".html", ".htm"];
  return artifacts.find((a) => exts.some((ext) => a.path?.toLowerCase().endsWith(ext)))?.path ?? null;
}

function renderTaskListDock() {
  if (!taskListDock || !taskListBody) return;
  const tasks = taskSummaries ?? [];
  const parentOrStandalone = tasks.filter((task) => isUserVisibleTask(task) && !isNestedChildTask(task));
  const filtered = parentOrStandalone.filter((task) => {
    if (taskListFilter === "active") return taskIsActive(task.status);
    if (taskListFilter === "done") return taskIsDone(task.status);
    return true;
  });
  const limited = filtered.slice(0, 10);

  const pendingCount = parentOrStandalone.filter((task) => taskIsActive(task.status)).length;
  taskListDock.classList.toggle("is-running", pendingCount > 0);
  document.body.classList.toggle("has-active-tasks", pendingCount > 0);
  if (taskListDockBadge) {
    taskListDockBadge.textContent = `${pendingCount}`;
    taskListDockBadge.hidden = pendingCount === 0;
  }

  if (limited.length === 0) {
    taskListBody.innerHTML = `<p class="muted" style="font-size:12px;">暂无任务。</p>`;
    return;
  }

  taskListBody.innerHTML = limited.map((task) => {
    const progress = Math.round((task.progress ?? 0) * 100);
    const status = task.status ?? "unknown";
    const active = taskIsActive(status);
    const statusClass = status === "success" ? "ready" : status === "failed" ? "danger" : "warning";
    const modeLabel = describePermissionModeContract(task);
    const source = task.source_app === "uca.scheduler" || task.capture_mode === "scheduler"
      ? "定时任务"
      : task.source_app === "uca.email" || task.capture_mode === "email_digest"
        ? "邮件摘要"
        : task.source_type ?? "source";
    return `
      <div class="task-list-item">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <strong style="font-size:12px;">${escapeHtml(task.user_command ?? task.intent ?? "任务")}</strong>
          <span class="muted" style="font-size:10px;">${escapeHtml(task.executor ?? "executor")} · ${escapeHtml(source)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="task-progress-ring ${active ? "is-running" : ""}">${active ? "" : `${progress}%`}</div>
          <span class="chip" title="Execution mode" style="font-size:10px;">${escapeHtml(modeLabel)}</span>
          <span class="chip ${statusClass}" style="font-size:10px;">${escapeHtml(status)}</span>
          <button class="ghost" data-task-open="${escapeHtml(task.task_id)}" style="font-size:10px;padding:2px 6px;">查看</button>
        </div>
      </div>
    `;
  }).join("");

  for (const btn of taskListBody.querySelectorAll("[data-task-open]")) {
    btn.addEventListener("click", () => switchActiveTask(btn.dataset.taskOpen));
  }
}

function appendOutputSuffix(baseCommand) {
  if (!selectedOutputSuffix) return baseCommand;
  if (!baseCommand) return selectedOutputSuffix.replace(/^,\s*/, "");
  if (baseCommand.includes(selectedOutputSuffix)) return baseCommand;
  return `${baseCommand}${selectedOutputSuffix}`;
}

function appendFormatInstruction(baseCommand) {
  if (!selectedFormatInstruction) return baseCommand;
  if (!baseCommand) return selectedFormatInstruction.replace(/^,\s*/, "");
  if (baseCommand.includes(selectedFormatInstruction)) return baseCommand;
  return `${baseCommand}${selectedFormatInstruction}`;
}

async function fetchJson(pathname, options = {}) {
  return overlayRuntimeHttpClient.fetchJson(pathname, options);
}

// UCA-181: overlay-side note picker. Fetches the runtime's notes list
// (server-side store shared with the console window), renders a small
// popover anchored at the +Note button, and POSTs the user's pick to
// `/notes/append-chip`. No navigateConsole IPC — both windows hit the
// same store directly.
let overlayNotePickerEl = null;
async function openOverlayNotePicker(text, anchorEl) {
  overlayNotePickerEl?.remove();
  overlayNotePickerEl = null;
  let notes = [];
  try {
    const data = await fetchJson("/notes");
    notes = Array.isArray(data?.notes) ? data.notes : [];
  } catch { /* notes endpoint unavailable — still allow create-new */ }
  const popover = document.createElement("div");
  popover.className = "overlay-note-popover";
  popover.innerHTML = `
    <div class="onp-head">添加到笔记</div>
    <div class="onp-list">
      <button type="button" data-note-id="__new__" class="onp-item onp-item-new">＋ 新建笔记</button>
      ${notes.slice(0, 8).map((n) => {
        const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const snippet = stripTags(n.body_html).slice(0, 60);
        const safeTitle = (n.title || "Untitled note").replace(/[<>&"']/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;","'":"&#39;"}[c]));
        const safeSnippet = snippet.replace(/[<>&"']/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;","'":"&#39;"}[c]));
        return `<button type="button" data-note-id="${n.id}" class="onp-item">
          <span class="onp-item-title">${safeTitle}</span>
          <span class="onp-item-snippet">${safeSnippet}</span>
        </button>`;
      }).join("")}
    </div>
  `;
  document.body.appendChild(popover);
  overlayNotePickerEl = popover;
  const r = anchorEl?.getBoundingClientRect?.() ?? { left: 100, bottom: 100 };
  const left = Math.min(window.innerWidth - 280, Math.max(8, r.left + window.scrollX));
  const top = r.bottom + window.scrollY + 6;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  const close = () => {
    popover.remove();
    if (overlayNotePickerEl === popover) overlayNotePickerEl = null;
    document.removeEventListener("mousedown", outside, true);
  };
  const outside = (ev) => { if (!popover.contains(ev.target) && ev.target !== anchorEl) close(); };
  setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  const submitToNote = async (noteId, title = null) => {
    try {
      const result = await appendNoteChipViaShell({ noteId, text, sourceLabel: "From overlay", title });
      if (anchorEl) {
        const target = result?.note?.title || "笔记";
        anchorEl.textContent = result?.created ? `已新建 ✓ ${target}` : `已添加 ✓ ${target}`;
        setTimeout(() => { anchorEl.textContent = "＋ Note"; }, 1800);
      }
    } catch (err) {
      if (anchorEl) anchorEl.textContent = `失败：${err.message}`;
    }
    close();
  };

  popover.querySelectorAll("[data-note-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      if (noteId === "__new__") {
        // New-note flow — inline a title input so the user can name the
        // note. Same UX as the console picker.
        const promptEl = document.createElement("div");
        promptEl.className = "onp-new-prompt";
        promptEl.innerHTML = `
          <input type="text" class="onp-title-input" placeholder="笔记标题（可选）" maxlength="80"/>
          <button type="button" class="onp-title-confirm">创建</button>
        `;
        const list = popover.querySelector(".onp-list");
        if (list) {
          list.innerHTML = "";
          list.appendChild(promptEl);
        }
        const titleInput = promptEl.querySelector(".onp-title-input");
        const confirmBtn = promptEl.querySelector(".onp-title-confirm");
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

async function refreshStatus() {
  try {
    const shell = await overlayShellClient.getShellStatus();
    serviceBaseUrl = shell.serviceBaseUrl ?? serviceBaseUrl;
    await fetchJson("/health");
  } catch {
    // runtime not ready yet — silent
  }
}

// UCA-049: derive the provider descriptor and downgraded flag from any event
// payload that the submission layer attached `provider_*` fields to (commit 1
// guarantees this for every task path). The latest event wins.
function extractTaskProviderInfo(events) {
  if (!Array.isArray(events) || events.length === 0) return { descriptor: null, downgraded: false };
  let descriptor = null;
  let downgraded = false;
  for (const event of events) {
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
    if (payload.downgraded === true) downgraded = true;
  }
  return { descriptor, downgraded };
}

function formatProviderTag(descriptor) {
  if (!descriptor) return "";
  const name = descriptor.provider_name || descriptor.provider_id || descriptor.provider_kind || "unknown";
  const model = descriptor.model || "default";
  const transport = (descriptor.transport || "").toUpperCase() || "—";
  return `Provider: ${name} · ${model} · ${transport}`;
}

function appendProviderFooterBubble({ descriptor, downgraded }) {
  if (!descriptor && !downgraded) return;
  if (downgraded) {
    addSystemBubble(`⚠ AI claim downgraded — no tool returned success in this run. ${formatProviderTag(descriptor)}`);
    return;
  }
  addSystemBubble(formatProviderTag(descriptor));
}

async function refreshActiveTask() {
  const refreshViewGeneration = overlayViewGeneration;
  const refreshTaskId = activeTaskId;
  if (!refreshTaskId) {
    await refreshTaskSummaries();
    renderTaskListDock();
    return null;
  }

  try {
    ensureActiveTaskEventStream(refreshTaskId);
    const payload = await overlayTaskClient.fetchTaskDetail(refreshTaskId);
    if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
    const task = {
      ...(payload.task ?? payload),
      artifacts: payload.artifacts ?? []
    };
    lastTask = task;
    lastArtifacts = task.artifacts;
    await refreshTaskSummaries();
    if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
    await ensureCompositeHeader(task, { viewGeneration: refreshViewGeneration });
    if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
    renderTaskListDock();
    replayTaskTimelineEvents(payload.events ?? [], { taskId: refreshTaskId, viewGeneration: refreshViewGeneration });

    const childIds = Array.isArray(task.child_task_ids) ? task.child_task_ids : [];
    if (childIds.length > 0 && notifiedCompositeTaskId !== task.task_id) {
      notifiedCompositeTaskId = task.task_id;
      addBubble("assistant", `已分解为 ${childIds.length} 个任务。`, {
        optionButtons: childIds.slice(0, 6).map((id, index) => ({
          label: `查看任务 ${index + 1}`,
          onClick: () => switchActiveTask(id)
        }))
      });
    }

    if (task.status === "success" && task.artifacts?.length) {
      // UCA-182 Phase 9: remember this task + its artifacts on the
      // conversation so the next turn can link via parent_task_id and
      // reuse the artifact list without hitting disk again.
      if (conversationState) {
        conversationState.lastCompletedTaskId = task.task_id;
        // P4-RQ G3a: lastCompletedAt drives the recency window for
        // structural follow-up attachment (shouldAttachParentTaskForCommand).
        conversationState.lastCompletedAt = Date.now();
        conversationState.lastArtifacts = task.artifacts.map((a) => ({
          path: a.path,
          mime: a.mime ?? null,
          size: a.size ?? null,
          producedAt: a.producedAt ?? Date.now()
        }));
        conversationState.updatedAt = Date.now();
      }
      // Echo continuation window: any echo-origin task completion (with or
      // without artifacts) opens a 30s window during which the next wake
      // continues this conversation instead of opening a new one. The
      // companion branches below (success-without-artifacts, failed) record
      // the same fields so the policy is uniform across terminal outcomes.
      if (isEchoTask(task.task_id) || isEchoOriginTask(task)) {
        lastEchoTaskCompletedAt = Date.now();
        // Codex Round 3 review: prefer task.conversation_id (authoritative
        // server-side owner), then taskConversationMap (renderer-side bind
        // record that survives conversation switches), then the live
        // conversationState as a last fallback. The previous direct
        // fallback to conversationState.id could bind to whichever
        // conversation the user happened to be viewing when the task
        // finished, which might not be the task's actual owner.
        lastEchoTaskConversationId = task.conversation_id
          ?? taskOwnerConversationId(taskConversationMap, task.task_id)
          ?? conversationState?.id
          ?? null;
        lastEchoTaskId = task.task_id;
      }
      const previewPath = choosePreviewArtifactPath(task.artifacts) ?? task.artifacts[0].path;
      lastArtifactPath = previewPath;

      let previewText = "";
      if (isPreviewableArtifactPath(previewPath)) {
        try {
          const rawText = await overlayShellClient.readTextFile(previewPath, 4000);
          if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
          previewText = normalisePreviewText(rawText).slice(0, 1200);
          lastArtifactPreview = previewText;
        } catch { /* ignore */ }
      }
      if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;

      if (notifiedTaskId !== task.task_id) {
        notifiedTaskId = task.task_id;
        const resultLabel = formatArtifactLabel(previewPath);
        const filename = previewPath.split(/[\\/]/).pop() || previewPath;
        const isAudioNoteTask = task.context_packet?.source_type === "audio_note"
          || task.context_packet?.source_app === "uca.note";
        // Record in conversation memory so later follow-ups can reference
        // "the file you generated" without the LLM losing the thread.
        const memorySnippet = previewText
          ? `生成了文件 ${filename}\n\n${previewText.slice(0, 600)}`
          : `生成了文件 ${filename}`;
        appendTurn("assistant", memorySnippet);
        if (!isEchoTask(task.task_id)) {
          await maybeRevealOverlay({ markEngaged: true });
          if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
        }
        if (isAudioNoteTask && previewText) {
          addBubble("assistant", `录音笔记整理好了：\n\n${previewText.slice(0, 1200)}`);
        }
        // UCA-049: surface which provider actually ran this task + warn if
        // the planner had to downgrade an unsupported "已完成" claim.
        try {
          const detail = await overlayTaskClient.fetchTaskDetail(refreshTaskId);
          if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
          appendProviderFooterBubble(extractTaskProviderInfo(detail.events ?? []));
        } catch { /* non-fatal — provider footer is informational */ }
        if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
        showToast(
          "Task complete",
          previewText || `Result: ${resultLabel} — ${previewPath}`,
          previewPath
        );

        // Conversation bubble: clickable file link + Preview / Open / Reveal options
        const bubbleEl = document.createElement("div");
        const headline = document.createElement("div");
        // UCA-068: show file-type icon badge for binary/non-previewable files
        const ext = filename.split(".").pop()?.toLowerCase() ?? "";
        const fileIcon = { pptx: "📊", docx: "📝", xlsx: "📈", pdf: "📄", zip: "📦" }[ext] ?? "📎";
        headline.textContent = isAudioNoteTask
          ? `${isPreviewableArtifactPath(previewPath) ? "✅" : fileIcon} 已生成录音笔记 ${filename}`
          : `${isPreviewableArtifactPath(previewPath) ? "✅" : fileIcon} Done! 生成了文件 ${filename}`;
        bubbleEl.appendChild(headline);
        if (previewText) {
          const sub = document.createElement("div");
          sub.style.cssText = "margin-top:6px;font-size:12px;color:var(--muted);max-height:300px;overflow:auto;white-space:pre-wrap;";
          sub.textContent = previewText.slice(0, 1200);
          bubbleEl.appendChild(sub);
        }
        addBubble("assistant", bubbleEl, {
          optionButtons: [
            { label: "预览", onClick: () => {
                // UCA-182 Phase 7: always try the in-panel preview first.
                // Binary Office formats, pdf, markdown, etc. all have
                // handlers registered on window.livePreviewClient.
                if (window.livePreview?.openForFile?.({ filePath: previewPath })) return;
                // Fallback: open externally if the preview module is
                // somehow missing (script load race).
                void overlayShellClient?.openPath?.(previewPath);
              } },
            { label: "打开文件", onClick: async () => {
                const err = await overlayShellClient.openPath(previewPath);
                if (err) addSystemBubble(`无法打开文件：${err}`);
              } },
            { label: "打开文件夹", onClick: () => overlayShellClient.showItemInFolder(previewPath) },
            { label: "复制路径", onClick: () => overlayShellClient.writeClipboardText(previewPath) }
          ]
        });

        // Apple-style pop bubble for ephemeral mode (artifact result)
        if (!popKeptOpen) {
          showPopBubble({
            label: resultLabel,
            body: previewText ? `${filename}\n\n${previewText.slice(0, 220)}` : `生成了文件 ${filename}`,
            autoHideMs: 4000
          });
        }

        fireSuccessPopupCardOnce(task.task_id, {
          title: task.intent ?? "任务完成",
          body: [filename, previewText ? previewText.slice(0, 140) : null].filter(Boolean),
          autoHideMs: 10000,
          terminal: true
        });
        // Echo TTS: speak the artifact summary line + preview snippet.
        // The route caps to maxChars; we just send a useful summary text.
        speakEchoFinalIfApplicable(
          task,
          previewText
            ? `已生成 ${filename}。${previewText.slice(0, 200)}`
            : `已生成 ${filename}。`
        );
      }
      // Auto-open removed: previously the host file viewer would steal focus
      // every time a task finished. Users explicitly click the "打开文件"
      // button or the artifact from the Console Chat/Project file context.
    } else if (task.status === "success" && !task.artifacts?.length) {
      // UCA-182 Phase 9: conversational success (no artifacts) still
      // needs to thread — remember the task_id so follow-ups link.
      if (conversationState) {
        conversationState.lastCompletedTaskId = task.task_id;
        // P4-RQ G3a: lastCompletedAt drives the recency window —
        // same field used by shouldAttachParentTaskForCommand for
        // both artifact and conversational successes.
        conversationState.lastCompletedAt = Date.now();
        conversationState.updatedAt = Date.now();
      }
      // Echo continuation window — see the corresponding artifact branch
      // above for the full rationale. Mirrored here so a conversational
      // echo task (no artifact) also opens the 30s follow-up window.
      if (isEchoTask(task.task_id) || isEchoOriginTask(task)) {
        lastEchoTaskCompletedAt = Date.now();
        // Codex Round 3 review: prefer task.conversation_id (authoritative
        // server-side owner), then taskConversationMap (renderer-side bind
        // record that survives conversation switches), then the live
        // conversationState as a last fallback. The previous direct
        // fallback to conversationState.id could bind to whichever
        // conversation the user happened to be viewing when the task
        // finished, which might not be the task's actual owner.
        lastEchoTaskConversationId = task.conversation_id
          ?? taskOwnerConversationId(taskConversationMap, task.task_id)
          ?? conversationState?.id
          ?? null;
        lastEchoTaskId = task.task_id;
      }
      // conversational mode — no artifacts
      if (notifiedTaskId !== task.task_id && notifiedInlineResultTaskId !== task.task_id) {
        notifiedTaskId = task.task_id;

        // try to find inline result from task events
        let inlineText = lastArtifactPreview;
        let providerInfo = { descriptor: null, downgraded: false };
        try {
          const detail = await overlayTaskClient.fetchTaskDetail(refreshTaskId);
          if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
          const events = detail.events ?? [];
          providerInfo = extractTaskProviderInfo(events);
          if (!inlineText) {
            const inlineEvent = events.find((e) =>
              (e.event_type === "inline_result" || e.event_type === "success") && (e.payload?.text?.length > 5)
            );
            inlineText = inlineEvent?.payload?.text ?? "";
            if (inlineText) lastArtifactPreview = inlineText;
          }
        } catch { /* ignore */ }
        if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;

        // UCA-064: For composite tasks, use result_summary instead of "Done."
        const compositeSummary = (task.child_task_ids?.length > 0 && task.result_summary)
          ? task.result_summary
          : null;
        const finalText = compositeSummary || inlineText || "已完成。";
        // Record the assistant turn in conversation memory so the next
        // follow-up (if any) sees it as context.
        if (finalText && finalText !== "已完成。") {
          appendTurn("assistant", finalText);
        }
        // If the SSE connection dropped and left a partial streaming bubble,
        // finalise it with the full text instead of adding a duplicate bubble.
        if (streamingBubble) {
          streamingBubble.classList.remove("streaming");
          streamingBubble.innerHTML = renderMarkdown(finalText);
          streamingBubble = null;
          streamingBubbleRawText = "";
        } else {
          addBubble("assistant", finalText);
          if (shouldAutoRevealTaskResult()) {
            await maybeRevealOverlay({ markEngaged: true });
            if (!isActiveTaskRefreshCurrent(refreshTaskId, refreshViewGeneration)) return null;
          }
        }
        if (!popKeptOpen) {
          // Apple-style: show a transient pop bubble too, but keep the reply
          // in the conversation so reopening the overlay doesn't lose it.
          showPopBubble({
            label: task.intent ?? "UCA",
            body: finalText,
            autoHideMs: 3000
          });
        }
        // UCA-049: provider footer + downgraded warning (system bubble)
        appendProviderFooterBubble(providerInfo);
        fireSuccessPopupCardOnce(task.task_id, {
          title: task.intent ?? "任务完成",
          body: finalText,
          openWindow: "overlay",
          terminal: true
        });
        // Echo TTS: voice in → voice out. Best-effort; muted users get a
        // 200 OK with muted:true and no spawn.
        speakEchoFinalIfApplicable(task, finalText);
      }
    } else if (task.status === "failed") {
      const failureMsg = task.failure_user_message ?? "Unknown error.";
      addBubble("assistant", `Task failed: ${failureMsg}`);
      // Codex Round 1+2 review: the 30s echo continuation window for failures
      // is only useful if shouldAttachParentTaskForCommand actually finds the
      // failed task as the conversation's most recent terminal state. The
      // success branches already update conversationState.lastCompletedTaskId
      // /lastCompletedAt; mirror that for failures so a user re-saying
      // "灵犀, 再试一次" within the window attaches via parent_task_id and
      // the LLM sees the failure context instead of starting fresh.
      if (conversationState) {
        conversationState.lastCompletedTaskId = task.task_id;
        conversationState.lastCompletedAt = Date.now();
        conversationState.updatedAt = Date.now();
      }
      // Record the failure as an assistant turn so memory rollup includes it
      // on the next follow-up (otherwise the LLM's transcript only sees the
      // user's previous request and no outcome).
      appendTurn("assistant", `任务失败：${failureMsg}`);
      // Echo continuation window applies to failures too: a user who said
      // "灵犀, 整理这份文件" and the task failed often re-asks immediately
      // ("再试一次 / 那换一种方式"). Inheriting the conversation lets that
      // follow-up reach the same context. After 30s the wake reverts to
      // starting fresh.
      if (isEchoTask(task.task_id) || isEchoOriginTask(task)) {
        lastEchoTaskCompletedAt = Date.now();
        // Codex Round 3 review: prefer task.conversation_id (authoritative
        // server-side owner), then taskConversationMap (renderer-side bind
        // record that survives conversation switches), then the live
        // conversationState as a last fallback. The previous direct
        // fallback to conversationState.id could bind to whichever
        // conversation the user happened to be viewing when the task
        // finished, which might not be the task's actual owner.
        lastEchoTaskConversationId = task.conversation_id
          ?? taskOwnerConversationId(taskConversationMap, task.task_id)
          ?? conversationState?.id
          ?? null;
        lastEchoTaskId = task.task_id;
      }
      try {
        overlayShellClient?.showPopupCard?.({
          kind: "error",
          taskId: task.task_id,
          title: "任务失败",
          lines: [task.failure_user_message ?? "Unknown error."],
          autoHideMs: 12000
        });
      } catch { /* optional */ }
      speakEchoFinalIfApplicable(task, `任务失败：${failureMsg}`);
    } else if (task.status === "partial_success") {
      // Codex Round 4 review: partial_success was already declared a terminal
      // status (line ~4018 in conversationPhase reset), but no UI / memory /
      // continuation branch existed. If a backend path ever emits this state
      // the user would see a silent freeze. Mirror the failed branch's
      // conversation thread updates so a follow-up wake within the 30s
      // window can attach via parent_task_id, while making the partial
      // outcome visible.
      const partialText = selectPartialSuccessTaskMessage(task);
      const shouldRenderPartialOutcome = notifiedTaskId !== task.task_id
        && notifiedInlineResultTaskId !== task.task_id;
      // Codex Round 5 review: success branches finalise streamingBubble in
      // place rather than adding a duplicate; partial_success must do the
      // same so a backend path that ends mid-stream (no inline_result, no
      // success event) doesn't leave a "streaming" bubble hanging in the UI.
      const hadStreamingBubble = Boolean(streamingBubble);
      if (streamingBubble) {
        streamingBubble.classList.remove("streaming");
        streamingBubble.innerHTML = renderMarkdown(partialText);
        streamingBubble = null;
        streamingBubbleRawText = "";
      } else if (shouldRenderPartialOutcome) {
        addBubble("assistant", partialText);
      }
      if (hadStreamingBubble || shouldRenderPartialOutcome) {
        notifiedTaskId = task.task_id;
      }
      if (conversationState) {
        conversationState.lastCompletedTaskId = task.task_id;
        conversationState.lastCompletedAt = Date.now();
        conversationState.updatedAt = Date.now();
      }
      if (hadStreamingBubble || shouldRenderPartialOutcome) {
        appendTurn("assistant", `部分完成：${partialText.replace(/^Task partially succeeded:\s*/i, "")}`);
      }
      if (isEchoTask(task.task_id) || isEchoOriginTask(task)) {
        lastEchoTaskCompletedAt = Date.now();
        lastEchoTaskConversationId = task.conversation_id
          ?? taskOwnerConversationId(taskConversationMap, task.task_id)
          ?? conversationState?.id
          ?? null;
        lastEchoTaskId = task.task_id;
      }
      if (hadStreamingBubble || shouldRenderPartialOutcome) {
        speakEchoFinalIfApplicable(task, partialText);
      }
    } else if (task.status === "cancelled") {
      addSystemBubble("Task cancelled.");
      // Audit (2026-05-07): cancelled tasks left lastEchoTaskCompletedAt at
      // 0, so a wake within 30s of pressing Esc started a fresh
      // conversation instead of carrying the prior context. Mirror the
      // success/failed/partial branches so "灵犀, 重新试一下" inherits
      // the conversation that just got cancelled.
      if (conversationState) {
        conversationState.lastCompletedTaskId = task.task_id;
        conversationState.lastCompletedAt = Date.now();
        conversationState.updatedAt = Date.now();
      }
      if (isEchoTask(task.task_id) || isEchoOriginTask(task)) {
        lastEchoTaskCompletedAt = Date.now();
        lastEchoTaskConversationId = task.conversation_id
          ?? taskOwnerConversationId(taskConversationMap, task.task_id)
          ?? conversationState?.id
          ?? null;
        lastEchoTaskId = task.task_id;
      }
    }

    // UCA-038 bug fix: reset conversationPhase to "idle" once a task reaches
    // any terminal state. Without this, the phase stays stuck at "running"
    // and the next handleUserSend() skips addBubble("user", text) because
    // the `conversationPhase === "idle"` guard fails.
    if (["success", "failed", "cancelled", "partial_success"].includes(task.status)) {
      conversationPhase = "idle";
    }
    return payload;
  } catch (error) {
    // Service restart/network hiccup: leave the composer usable. Task list
    // polling will reattach when the runtime comes back.
    return null;
  }
}

/* ═══════════════════════════════════════════════
   SUBMIT
   ═══════════════════════════════════════════════ */

async function submitTask() {
  const rawCommand = commandInput.value.trim();

  // UCA-060: Strict separation of user instruction vs captured context.
  // A captured active-window context is BACKGROUND information, NOT the query.
  // If the user hasn't typed anything, we must ask them what they want —
  // never substitute the window content as the question.
  // Exception: file/image selections have sensible defaults (analyze/describe).
  if (!rawCommand) {
    if (pendingFileSelection?.filePaths?.length) {
      // File/image context: allow a meaningful default command (see below)
    } else {
      // No input, no file — do nothing; hint the user to type first.
      commandInput.placeholder = "请先输入你的问题或指令…";
      commandInput.focus();
      // Flash placeholder to draw attention
      commandInput.classList.add("input-hint-flash");
      setTimeout(() => commandInput.classList.remove("input-hint-flash"), 1200);
      return;
    }
  }

  // smart default command based on context type (only reached for file selections)
  let defaultCommand = "Analyze and summarize these files.";
  if (pendingFileSelection?.filePaths?.length) {
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
    const isImageTask = pendingFileSelection.filePaths.every((fp) =>
      imageExts.some((ext) => fp.toLowerCase().endsWith(ext))
    );
    defaultCommand = isImageTask
      ? "Describe and analyze this image in detail."
      : "Analyze and summarize these files.";
  }
  const commandText = appendFormatInstruction(appendOutputSuffix(rawCommand)) || defaultCommand;
  commandInput.value = "";
  autoSizeInput();
  clearActiveClarificationBubble();

  try {
    let payload;
    const explicitBrowserContextRequest = commandTargetsCurrentBrowserContext(commandText);
    const explicitFileContextRequest = commandTargetsCurrentFileContext(commandText);
    const activeBrowserCapture = explicitBrowserContextRequest
      ? await resolveActiveWindowBrowserCapture()
      : null;
    if (explicitBrowserContextRequest && !activeBrowserCapture) {
      commandInput.value = rawCommand;
      autoSizeInput();
      addSystemBubble("没有检测到可读取的当前浏览器页面。请先切到要分析的网页，或选中文字/链接后再提问。");
      commandInput.focus();
      return;
    }
    const activeFileSelection = !activeBrowserCapture && explicitFileContextRequest
      ? resolveActiveWindowFileSelection(commandText)
      : null;
    // P6-F1: legacy outbound history removed. Backend conversation_messages
    // is now the single source of conversation history (see Phase D loader).
    // The frontend cache is rendered locally but never re-injected here.
    const contextDecision = resolveOverlayContextSubmission({
      explicitBrowserContextRequest,
      activeBrowserCapture,
      explicitFileContextRequest,
      activeFileSelection,
      pendingFileSelection,
      pendingCapture,
      seedCapture: conversationState?.seedCapture ?? null
    });
    let optimisticMessageContext = {};
    if (contextDecision.kind === "capture") {
      const capture = { ...contextDecision.capture };
      const executorOverride = capture.sourceType === "image" ? "multi_modal" : undefined;
      if (contextDecision.reason === "explicit_browser_context") {
        ensureConversation(capture, conversationState?.seedCommand ?? rawCommand ?? commandText);
      }
      if (capture.filePath) {
        optimisticMessageContext = conversationContextFromFilePaths([capture.filePath], {
          sourceType: capture.sourceType === "image" ? "image_group" : "file_group",
          captureMode: contextDecision.captureMode ?? capture.captureMode ?? "hotkey_capture"
        });
      }
      payload = {
        userCommand: commandText,
        executionMode: "interactive",
        capture,
        executorOverride
      };
    } else if (contextDecision.kind === "missing_explicit_file_context") {
      commandInput.value = rawCommand;
      autoSizeInput();
      addSystemBubble("没有检测到可读取的当前文件。请先选中文件、拖入文件，或把文件窗口切到前台后再提问。");
      commandInput.focus();
      return;
    } else if (contextDecision.kind === "image_paths") {
      optimisticMessageContext = conversationContextFromFilePaths(contextDecision.filePaths, {
        sourceType: "image_group",
        captureMode: contextDecision.captureMode ?? "shell_menu"
      });
      payload = {
        imagePaths: contextDecision.filePaths,
        userCommand: commandText,
        source: "file",
        sourceApp: contextDecision.sourceApp ?? "explorer.exe",
        captureMode: contextDecision.captureMode ?? "shell_menu",
        executionMode: "interactive"
      };
    } else if (contextDecision.kind === "file_paths") {
      optimisticMessageContext = conversationContextFromFilePaths(contextDecision.filePaths, {
        sourceType: "file_group",
        captureMode: contextDecision.captureMode ?? "shell_menu"
      });
      payload = {
        sourceApp: contextDecision.sourceApp ?? "explorer.exe",
        captureMode: contextDecision.captureMode ?? "shell_menu",
        filePaths: contextDecision.filePaths,
        userCommand: commandText,
        executionMode: "interactive"
      };
    } else {
      payload = {
        sourceApp: "uca.overlay",
        captureMode: "overlay",
        sourceType: "clipboard",
        text: "",
        userCommand: commandText,
        executionMode: "interactive"
      };
    }

    // UCA-182 Phase 9: link follow-up turns to the conversation's last
    // completed task. Server-side submitContextTask skips decomposition /
    // plan layer when parentTaskId is set, so the follow-up inherits the
    // thread instead of starting a brand-new root task every time.
    const explicitContinuationTaskId = pendingContinuationTaskId;
    const parentTaskId = explicitContinuationTaskId || (shouldAttachParentTaskForCommand(commandText)
      ? conversationState?.lastCompletedTaskId ?? null
      : null);
    const continuationConversationId = explicitContinuationTaskId
      ? (pendingContinuationConversationId ?? taskOwnerConversationId(taskConversationMap, explicitContinuationTaskId))
      : null;

    const clientMessageId = createClientMessageId();
    markPendingUserMessage(clientMessageId, commandText, optimisticMessageContext);
    timelineAddStep("已收到请求，正在创建任务…", "active");

    let result;
    try {
      const taskBody = attachOverlayProjectScope(attachOverlaySubmissionMetadata({
        ...payload,
        background: true,
        parent_task_id: parentTaskId,
        conversation_id: continuationConversationId ?? conversationState?.id ?? null,
        client_message_id: clientMessageId
      }));
      result = await overlaySubmissionClient.submitTask(taskBody);
    } catch (err) {
      markPendingMessageFailed(clientMessageId, err);
      throw err;
    }
    // F2: post-submit reconcile is intentionally NOT fired here — SSE
    // events render the live assistant bubble during task execution.
    // The next conversation switch / overlay reopen will rebuild from
    // backend (loadConversationFromBackend), at which point the
    // optimistic user bubble is upgraded via client_message_id match
    // and any live-rendered assistant bubble is replaced by the
    // canonical backend message.

    // UCA-059: Server detected an ambiguous command — show clarification bubble
    // instead of starting a background task.
    if (result.type === "clarification_needed") {
      showClarificationBubble(commandText, result.question, payload);
      return;
    }

    activeTaskId = result.task.task_id;
    pendingContinuationTaskId = null;
    pendingContinuationConversationId = null;
    lastTask = result.task;
    if (echoSessionActive || isEchoOriginTask(result.task)) rememberEchoTask(activeTaskId);
    notifiedTaskId = null;
    notifiedInlineResultTaskId = null;
    lastArtifactPreview = "";
    bindTaskToConversation(activeTaskId);
    ensureActiveTaskEventStream(activeTaskId);
    clearPendingInputContext();
    timelineAddStep("任务已创建，正在执行…", "active");

    if (shouldSurfaceTaskPopupCards()) {
      void overlayShellClient.notify?.({
        title: "LingxY processing",
        body: "Task submitted. You'll be notified when it's done.",
        taskId: activeTaskId
      })?.catch?.(() => {});
    }

    conversationPhase = "idle";

    // only auto-hide if the user explicitly requested file output
    if (selectedFormatInstruction) {
      setTimeout(() => {
        overlayShellClient.hideWindow("overlay");
      }, 600);
    }
  } catch (error) {
    addBubble("assistant", `Submit failed: ${error.message}`);
  }
}

/* ═══════════════════════════════════════════════
   SHELL HANDOFF (file drop, browser context)
   ═══════════════════════════════════════════════ */

// UCA-047 — render a compact "you're currently looking at X" card in the
// overlay whenever the hotkey probe detected a real URL / document path.
// The card appends 2-3 quick-action buttons that auto-fill the command
// input so the user can hit Enter without typing anything.
function rememberPendingActiveWindowContext(activeWindow = null) {
  if (!activeWindow || activeWindow.blocked) return;
  pendingActiveWindowContext = { ...activeWindow };
  pendingActiveWindowContextCapturedAt = Date.now();
}

function freshPendingActiveWindowContext(maxAgeMs = 2 * 60 * 1000) {
  if (!pendingActiveWindowContext) return null;
  if (!pendingActiveWindowContextCapturedAt) return null;
  if (Date.now() - pendingActiveWindowContextCapturedAt > maxAgeMs) return null;
  return pendingActiveWindowContext;
}

function showActiveWindowPreviewCard(activeWindow) {
  if (!activeWindow || activeWindow.blocked) return;
  rememberPendingActiveWindowContext(activeWindow);
  const kind = activeWindow.detected_kind ?? activeWindow.detectedKind;
  const process = activeWindow.process ?? "app";
  const title = activeWindow.title ?? "";
  let icon = "🪟";
  let label = process;
  let subLabel = "";
  let quickActions = [];

  if (kind === "web_url" && activeWindow.url) {
    icon = "🌐";
    label = `当前浏览器：${title || process}`;
    subLabel = activeWindow.url;
    quickActions = [
      { label: "分析此页面", command: "分析当前页面的完整内容并总结要点" },
      { label: "翻译此页面", command: "把当前页面翻译成中文" },
      { label: "提取关键信息", command: "从当前页面里抽取最重要的数据点" }
    ];
  } else if (kind === "file_path" && (activeWindow.file_path || activeWindow.filePath)) {
    const filePath = activeWindow.file_path ?? activeWindow.filePath;
    const filename = filePath.split(/[\\/]/).pop() || filePath;
    icon = /\.(docx?|xlsx?|pptx?)$/i.test(filename) ? "📄" : "📝";
    label = `当前文件：${filename}`;
    subLabel = filePath;
    quickActions = [
      { label: "总结", command: `总结这个文件的内容：${filePath}` },
      { label: "审阅", command: `审阅这个文件并指出问题：${filePath}` }
    ];
  } else if (kind === "window_title" && title) {
    icon = "🪟";
    label = `当前窗口：${process}`;
    subLabel = title;
    quickActions = [
      { label: "基于此上下文提问", command: `基于当前窗口"${title}"的上下文` }
    ];
  } else {
    return;
  }

  const card = document.createElement("div");
  card.dataset.ucaActiveWindowCard = "1";
  card.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;gap:6px;font-size:12px;";
  const iconEl = document.createElement("span");
  iconEl.textContent = icon;
  const labelEl = document.createElement("span");
  labelEl.style.cssText = "font-weight:500;";
  labelEl.textContent = label;
  head.appendChild(iconEl);
  head.appendChild(labelEl);
  card.appendChild(head);
  if (subLabel) {
    const subEl = document.createElement("div");
    subEl.style.cssText = "font-size:11px;color:var(--muted);word-break:break-all;max-height:32px;overflow:hidden;";
    subEl.textContent = subLabel;
    card.appendChild(subEl);
  }

  addBubble("assistant", card, {
    optionButtons: quickActions.map((action) => ({
      label: action.label,
      onClick: () => {
        startNewConversation();
        rememberPendingActiveWindowContext(activeWindow);
        commandInput.value = action.command;
        autoSizeInput();
        commandInput.focus();
        void handleUserSend();
      }
    }))
  });
}

function isActiveBrowserWindow(activeWindow = null) {
  const kind = activeWindow?.detected_kind ?? activeWindow?.detectedKind;
  return kind === "web_url" && Boolean(activeWindow?.url);
}

function activeWindowFilePath(activeWindow = null) {
  const kind = activeWindow?.detected_kind ?? activeWindow?.detectedKind;
  if (kind !== "file_path") return "";
  return `${activeWindow?.file_path ?? activeWindow?.filePath ?? ""}`.trim();
}

function browserProcessName(activeWindow = null) {
  const process = `${activeWindow?.process ?? ""}`.trim().toLowerCase();
  if (!process) return "chrome.exe";
  return process.endsWith(".exe") ? process : `${process}.exe`;
}

function compactBrowserContextText(value = "", maxLength = 4000) {
  const text = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

async function fetchRecentBrowserContextForActiveWindow(activeWindow = null) {
  if (!isActiveBrowserWindow(activeWindow)) return null;
  const params = new URLSearchParams();
  params.set("url", activeWindow.url);
  if (activeWindow.title) params.set("title", activeWindow.title);
  params.set("require_url_match", "1");
  params.set("limit", "1");

  try {
    const payload = await timeoutWithFallback(
      fetchJson(`/browser/context/recent?${params.toString()}`),
      900,
      null
    );
    return payload?.contexts?.[0] ?? null;
  } catch {
    return null;
  }
}

function buildBrowserContextCapture(browserContext = null, activeWindow = null) {
  if (!browserContext && !isActiveBrowserWindow(activeWindow)) return null;

  const youtube = browserContext?.metadata?.youtube ?? null;
  const url = youtube?.canonicalUrl || browserContext?.url || activeWindow?.url || "";
  const title = youtube?.title || browserContext?.pageTitle || activeWindow?.title || "";
  const channel = youtube?.channel || "";
  const platform = browserContext?.metadata?.platform || youtube?.platform || "";
  const description = browserContext?.metadata?.description || youtube?.description || "";
  const captions = youtube?.visibleCaptions || "";
  const pageText = browserContext?.text || "";
  const hasPageContent = Boolean(description || captions || pageText);

  const header = [
    platform ? `平台：${platform}` : "",
    title ? `页面/视频标题：${title}` : "",
    channel ? `频道/作者：${channel}` : "",
    url ? `URL：${url}` : ""
  ].filter(Boolean).join("\n");

  const sections = [];
  if (header) sections.push(header);
  if (description) sections.push(`## 页面/视频描述\n${compactBrowserContextText(description, 2500)}`);
  if (captions) sections.push(`## 当前可见字幕/转录面板片段\n${compactBrowserContextText(captions, 3000)}`);
  if (pageText) sections.push(`## 页面可见文本\n${compactBrowserContextText(pageText, 7000)}`);
  if (sections.length === 0 && url) sections.push(`URL：${url}`);

  return {
    sourceType: "webpage",
    browser: browserContext?.browser ?? browserProcessName(activeWindow),
    url,
    pageTitle: title,
    text: sections.join("\n\n"),
    metadata: {
      contentKind: youtube ? "video" : "webpage",
      platform: platform || "generic",
      browserContextScore: browserContext?.score ?? null,
      hasVisibleCaptions: Boolean(captions),
      hasPageContent
    }
  };
}

async function resolveActiveWindowBrowserCapture() {
  let activeWindow = null;
  if (typeof overlayShellClient?.getActiveWindowContext === "function") {
    const payload = await timeoutWithFallback(
      overlayShellClient.getActiveWindowContext({
        includeSelection: false,
        excludeShellWindow: true,
        preferLastExternal: true,
        maxExternalAgeMs: 2 * 60 * 1000,
        captureMode: "current_page_submit"
      }),
      900,
      null
    );
    activeWindow = payload?.active_window ?? payload?.activeWindow ?? null;
    if (isActiveBrowserWindow(activeWindow)) {
      rememberPendingActiveWindowContext(activeWindow);
    }
  }

  const candidate = isActiveBrowserWindow(activeWindow)
    ? activeWindow
    : freshPendingActiveWindowContext(EXPLICIT_BROWSER_CONTEXT_FALLBACK_MAX_AGE_MS);
  if (!isActiveBrowserWindow(candidate)) return null;
  const browserContext = await fetchRecentBrowserContextForActiveWindow(candidate);
  return buildBrowserContextCapture(browserContext, candidate);
}

function resolveActiveWindowFileSelection(commandText = "") {
  const activeWindow = freshPendingActiveWindowContext();
  const filePath = activeWindowFilePath(activeWindow);
  if (!filePath || !commandTargetsCurrentFileContext(commandText)) return null;
  return {
    sourceApp: activeWindow?.process ?? "active-window",
    captureMode: "active_window_file",
    filePaths: [filePath]
  };
}

async function captureActiveWindowHintForVoice({ captureMode = "voice_context" } = {}) {
  if (typeof overlayShellClient?.getActiveWindowContext !== "function") return null;
  try {
    let clipboardBaseline = null;
    try {
      clipboardBaseline = typeof overlayShellClient?.readClipboardText === "function"
        ? await timeoutWithFallback(overlayShellClient.readClipboardText(), 250, null)
        : null;
    } catch {
      clipboardBaseline = null;
    }
    const payload = await timeoutWithFallback(
      overlayShellClient.getActiveWindowContext({
        includeSelection: true,
        allowClipboardFallback: false,
        clipboardBaseline: typeof clipboardBaseline === "string" ? clipboardBaseline : null,
        excludeShellWindow: true,
        preferLastExternal: true,
        maxExternalAgeMs: VOICE_CONTEXT_FALLBACK_MAX_AGE_MS,
        captureMode
      }),
      1200,
      null
    );
    const activeWindow = payload?.active_window ?? payload?.activeWindow ?? null;
    if (payload?.capture || (Array.isArray(payload?.file_paths) && payload.file_paths.length > 0)) {
      applyShellHandoff(payload);
    }
    if (isActiveBrowserWindow(activeWindow) || activeWindowFilePath(activeWindow)) {
      rememberPendingActiveWindowContext(activeWindow);
    }
    return activeWindow;
  } catch {
    return null;
  }
}

function applyShellHandoff(payload) {
  lastShellHandoffAt = Date.now();
  if (payload?.error) {
    addSystemBubble(payload.error);
    commandInput.focus();
    return;
  }

  if (payload?.file_paths?.length) {
    const isEchoReceipt = payload.surface === "echo_receipt" || payload.mode === "echo";
    const isHotkeyCapture = payload.capture_mode === "hotkey_capture" || payload.captureMode === "hotkey_capture";
    const hasExistingThread = Boolean(conversationState?.turns?.length || activeTaskId);
    if (!isEchoReceipt && (isHotkeyCapture || hasExistingThread)) {
      startNewConversation();
    }
    pendingCapture = null;
    pendingFileSelection = {
      sourceApp: payload.source_app ?? "explorer.exe",
      captureMode: payload.capture_mode ?? "shell_menu",
      filePaths: payload.file_paths ?? []
    };
    if (isEchoReceipt) {
      renderVoiceChips();
      return;
    }
    showContextReceivedBubble();
    if (payload.active_window) {
      showActiveWindowPreviewCard(payload.active_window);
    }
    commandInput.focus();
    return;
  }

  // UCA-047: hotkey probe may return active_window hints even when there's
  // no clipboard text or file selection — render the preview card so the
  // user can click "分析此页面 / 总结 / ..." without typing anything.
  if (payload?.active_window && !payload.capture && !payload.file_paths?.length) {
    // For hotkey captures, always start a fresh conversation so the user
    // doesn't see stale bubbles from a previous session.
    if (payload.capture_mode === "hotkey_capture") {
      startNewConversation();
    }
    showActiveWindowPreviewCard(payload.active_window);
    commandInput.focus();
    return;
  }

  if (payload?.capture) {
    if (payload.capture_mode === "hotkey_capture" || payload.captureMode === "hotkey_capture") {
      startNewConversation();
    }
    pendingFileSelection = null;
    pendingCapture = {
      sourceApp: payload.capture.browser ?? payload.source_app ?? "chrome.exe",
      captureMode: payload.captureMode ?? payload.capture_mode ?? "browser_extension",
      capture: { ...payload.capture }
    };

    const newText = payload.capture.text ?? "";

    if (payload.priorResult) {
      // Resuming from an in-page result frame: start a fresh conversation
      // seeded with the prior Q + A so the user can follow up with memory.
      startNewConversation();
      const priorPrompt = payload.priorUserCommand ?? payload.userCommand ?? "请处理这段网页内容";
      ensureConversation(payload.capture, priorPrompt);
      appendTurn("user", priorPrompt);
      appendTurn("assistant", payload.priorResult);

      markUserEngaged();
      const selectionPreview = newText.trim().slice(0, 240);
      if (selectionPreview) {
        addBubble("user", priorPrompt, {
          contextChips: [{ label: selectionPreview, dismissable: false }]
        });
      } else {
        addBubble("user", priorPrompt);
      }
      addBubble("assistant", payload.priorResult);
      addSystemBubble("已带入上一轮结果，可以继续追问。例如：「换一种更口语化的说法」");
      commandInput.value = "";
      commandInput.focus();
      return;
    }

    // Plain capture (no prior result). If it's a different selection than
    // the one our current conversation is seeded with, auto-start a new
    // session so memory doesn't leak across unrelated topics. Otherwise
    // just append it as extra context to the ongoing thread.
    if (conversationState && conversationState.seedCapture && !seedCaptureMatches(newText)) {
      startNewConversation();
      addSystemBubble("检测到新的上下文，已开启新会话。");
    }
    ensureConversation(payload.capture, payload.userCommand ?? null);
    showContextReceivedBubble();
    // UCA-047: layer the active-window preview card on top of the capture
    // bubble so the user sees BOTH "here's your selected text" and
    // "you're currently on https://... — want me to summarise the whole page?"
    if (payload.active_window) {
      showActiveWindowPreviewCard(payload.active_window);
    }
    if (payload.userCommand && !commandInput.value) {
      commandInput.value = payload.userCommand;
    }
    commandInput.focus();
  }
}

/* ═══════════════════════════════════════════════
   CLIPBOARD
   ═══════════════════════════════════════════════ */

let lastLoadedClipboardText = "";

async function loadClipboardIntoContext({ showBubble = false } = {}) {
  if (pendingFileSelection?.filePaths?.length || pendingCapture?.capture) return;
  try {
    const clipText = (await overlayShellClient.readClipboardText()).trim();
    if (clipText && clipText.length > 4 && clipText !== lastLoadedClipboardText) {
      lastLoadedClipboardText = clipText;
      pendingCapture = {
        sourceApp: "clipboard",
        captureMode: "clipboard",
        capture: { text: clipText, sourceType: "text" }
      };
      if (showBubble) {
        const preview = clipText.slice(0, 100) + (clipText.length > 100 ? "..." : "");
        addBubble("assistant", `Clipboard detected (${clipText.length} chars):\n${preview}\n\nWhat do you want to do with it?`);
      }
    }
  } catch {
    // silent
  }
}

/* ═══════════════════════════════════════════════
   INPUT AUTO-SIZING
   ═══════════════════════════════════════════════ */

// Auto-grow the composer up to AUTO_MAX_INPUT_HEIGHT while the user
// types. If the user has manually dragged the textarea's resize handle
// (browser-native, bottom-right corner), preserve their height — we
// detect that by remembering the height autoSizeInput last set and
// comparing on the next call. AUTO_MAX_INPUT_HEIGHT is the soft cap
// during typing; the CSS max-height (240px) is the hard ceiling for
// drag-resize.
const AUTO_MAX_INPUT_HEIGHT = 96;
let autoSizedInputHeight = 0;
function autoSizeInput() {
  if (!commandInput) return;
  const current = parseFloat(commandInput.style.height) || 0;
  if (autoSizedInputHeight && Math.abs(current - autoSizedInputHeight) > 2) {
    // User has dragged the handle — leave their preferred size alone.
    return;
  }
  commandInput.style.height = "auto";
  const next = Math.min(commandInput.scrollHeight, AUTO_MAX_INPUT_HEIGHT);
  commandInput.style.height = `${next}px`;
  autoSizedInputHeight = next;
}

/* ═══════════════════════════════════════════════
   EVENT BINDINGS
   ═══════════════════════════════════════════════ */

// Empty-state suggestion chips — tapping one pre-fills the input so the user
// can tweak or just press Enter.
for (const chip of document.querySelectorAll(".empty-chip[data-empty-prompt]")) {
  chip.addEventListener("click", () => {
    const prompt = chip.getAttribute("data-empty-prompt") ?? "";
    if (!prompt) return;
    commandInput.value = prompt;
    autoSizeInput();
    commandInput.focus();
    // Move caret to end for easy editing
    const len = commandInput.value.length;
    commandInput.setSelectionRange(len, len);
  });
}

commandInput.addEventListener("input", autoSizeInput);

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    if (voiceMode && !noteActive) {
      closeVoicePanel({ submit: true });
      return;
    }
    void submitComposerInput();
  }
});

sendBtn.addEventListener("click", () => {
  // Dual-purpose button: when a task is in flight, the icon flips to a
  // stop glyph and a click cancels the task instead of submitting.
  if (isTaskRunning()) {
    void cancelActiveTask();
    return;
  }
  void submitComposerInput();
});

closeBtn.addEventListener("click", () => {
  requestOverlayDismiss();
});

newSessionBtn?.addEventListener("click", () => {
  startNewConversation();
  addSystemBubble("已开启新会话 — 之前的上下文已清除。");
});

/* ── UCA-041: project + history panel ── */

const projectPanel = document.querySelector("#projectPanel");
const projectSelectorBtn = document.querySelector("#projectSelectorBtn");
const projectDropdown = document.querySelector("#projectDropdown");
const newProjectBtn = document.querySelector("#newProjectBtn");
const projectTools = document.querySelector("#projectTools");
const historyList = document.querySelector("#historyList");
let overlayProjectPanelMode = "conversations";

function projectNameForOverlayConversation(conversation = {}) {
  const project = projectStore?.projects?.find((item) => item.id === conversation.projectId);
  return project?.name ?? "默认项目";
}

function listOverlayPanelConversations() {
  if (!projectStore) return [];
  const source = overlayProjectPanelMode === "projects"
    ? listConversationsForCurrentProject()
    : [...(projectStore.conversations ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return source.filter((conversation) => conversation?.id && !conversation?.metadata?.autoSource).slice(0, 80);
}

function renderProjectPanel() {
  if (!projectStore) loadProjectStore();
  for (const btn of projectPanel?.querySelectorAll?.("[data-overlay-project-panel-tab]") ?? []) {
    const active = btn.dataset.overlayProjectPanelTab === overlayProjectPanelMode;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (projectTools) projectTools.hidden = overlayProjectPanelMode !== "projects";
  // Populate project dropdown
  if (projectDropdown) {
    projectDropdown.innerHTML = projectStore.projects.map((p) =>
      `<option value="${escapeHtml(p.id)}" ${p.id === projectStore.currentProjectId ? "selected" : ""}>${projectHasUnread(p.id) ? "● " : ""}${escapeHtml(p.name)}</option>`
    ).join("");
  }
  // Populate history list
  if (historyList) {
    const convs = listOverlayPanelConversations();
    if (convs.length === 0) {
      historyList.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px 0;">暂无会话记录。</div>`;
      return;
    }
    historyList.innerHTML = convs.map((c) => {
      const title = c.title || generateConversationTitle(c);
      const turnCount = c.turns?.length ?? 0;
      const date = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "";
      const isActive = c.id === projectStore.currentConversationId;
      const unread = c.metadata?.unread === true;
      const projectName = projectNameForOverlayConversation(c);
      return `
        <div class="overlay-history-row ${isActive ? "is-active" : ""}" data-conv-id="${escapeHtml(c.id)}" role="listitem">
          <span style="width:7px;height:7px;border-radius:999px;background:${unread ? "#ef4444" : "transparent"};"></span>
          <div class="overlay-history-main">
            <div class="overlay-history-title" title="${escapeHtml(title)}" style="${isActive ? "font-weight:650;" : ""}">${escapeHtml(title)}</div>
            <div class="overlay-history-meta">${escapeHtml(projectName)} · ${turnCount} turns${date ? ` · ${escapeHtml(date)}` : ""}</div>
          </div>
          <div class="overlay-history-actions">
            <button class="overlay-history-action" data-open-project="${escapeHtml(c.projectId ?? DEFAULT_PROJECT_ID)}" type="button" title="切到项目">项目</button>
            <button class="overlay-history-action" data-open-conv="${escapeHtml(c.id)}" type="button" title="打开会话">会话</button>
            <button class="overlay-history-action danger" data-delete-conv="${escapeHtml(c.id)}" type="button" title="删除此会话">×</button>
          </div>
        </div>
      `;
    }).join("");
    for (const btn of historyList.querySelectorAll("[data-open-conv]")) {
      btn.addEventListener("click", () => {
        switchConversation(btn.dataset.openConv);
        setPanelOpen(projectPanel, false);
      });
    }
    for (const btn of historyList.querySelectorAll("[data-open-project]")) {
      btn.addEventListener("click", () => {
        overlayProjectPanelMode = "projects";
        switchProject(btn.dataset.openProject);
        renderProjectPanel();
      });
    }
    for (const btn of historyList.querySelectorAll("[data-delete-conv]")) {
      btn.addEventListener("click", () => {
        deleteConversation(btn.dataset.deleteConv);
        renderProjectPanel();
      });
    }
  }
}

for (const btn of projectPanel?.querySelectorAll?.("[data-overlay-project-panel-tab]") ?? []) {
  btn.addEventListener("click", () => {
    overlayProjectPanelMode = btn.dataset.overlayProjectPanelTab === "projects" ? "projects" : "conversations";
    renderProjectPanel();
  });
}

projectSelectorBtn?.addEventListener("click", () => {
  // If we're offline, clicking the projects button retries sync. The user can
  // still open the panel (local store is always usable) but the retry fires
  // alongside panel open so the red dot clears when service is reachable.
  if (projectSyncIndicatorState === "offline") {
    void syncProjectStoreFromService({ render: true });
  }
  if (isPanelOpen(projectPanel)) {
    setPanelOpen(projectPanel, false);
  } else {
    closeAllPanels();
    renderProjectPanel();
    setPanelOpen(projectPanel, true);
  }
});

projectDropdown?.addEventListener("change", () => {
  switchProject(projectDropdown.value);
  renderProjectPanel();
});

newProjectBtn?.addEventListener("click", () => {
  const name = prompt("项目名称：");
  if (!name?.trim()) return;
  const project = createProject(name.trim());
  switchProject(project.id);
  renderProjectPanel();
  addSystemBubble(`已创建项目"${project.name}"。`);
});

clipboardBtn.addEventListener("click", async () => {
  try {
    const clipText = (await overlayShellClient.readClipboardText()).trim();
    if (clipText) {
      // New context replaces any ongoing conversation (different topic).
      if (conversationState && !seedCaptureMatches(clipText)) {
        startNewConversation();
      }
      pendingCapture = {
        sourceApp: "clipboard",
        captureMode: "clipboard",
        capture: { text: clipText, sourceType: "text" }
      };
      ensureConversation(pendingCapture.capture, null);
      addBubble("assistant", `Clipboard loaded (${clipText.length} chars).`);
    } else {
      addBubble("system", "Clipboard is empty.");
    }
  } catch (error) {
    addBubble("system", `Clipboard error: ${error.message}`);
  }
});

/* ═══════════════════════════════════════════════
   QUICK ACTION TOOLBAR
   ═══════════════════════════════════════════════ */

const QUICK_ACTION_PRESETS = {
  translate: {
    needsContext: true,
    featureId: "translation",
    contextless: { command: "请翻译我剪贴板里的内容", autoLoadClipboard: true },
    command: "请翻译这段内容"
  },
  summarize: {
    needsContext: true,
    contextless: { command: "请总结我剪贴板里的内容", autoLoadClipboard: true },
    command: "请总结这段内容并列出关键点"
  },
  explain: {
    needsContext: true,
    contextless: { command: "请解释我剪贴板里的内容", autoLoadClipboard: true },
    command: "请解释这段内容并说明它的重要性"
  }
};

// UCA-048: feature gate for overlay. When a feature is disabled, show a
// pop bubble with a "打开设置" button that navigates to Console Settings.
async function checkFeatureGate(featureId) {
  if (!featureId) return true;
  try {
    const health = await fetchJson("/health");
    const features = health.config?.features ?? {};
    const entry = features[featureId];
    if (entry && entry.enabled === false) {
      showPopBubble({
        label: "功能已关闭",
        body: `"${featureId}" 功能已在设置中关闭。`,
        autoHideMs: 6000
      });
      addBubble("assistant", `此功能已在设置中关闭。`, {
        optionButtons: [{
          label: "打开设置",
          onClick: () => {
            overlayShellClient?.navigateConsole?.({ tabId: "settings", anchor: `features.${featureId}` });
            overlayShellClient?.showWindow?.("console");
          }
        }]
      });
      return false;
    }
  } catch { /* health unavailable → fail open */ }
  return true;
}

async function runQuickAction(action) {
  const preset = QUICK_ACTION_PRESETS[action];
  if (!preset) return;

  // UCA-048: gate check before running the action
  if (preset.featureId && !(await checkFeatureGate(preset.featureId))) return;

  const hasContext = Boolean(pendingCapture?.capture || pendingFileSelection?.filePaths?.length);

  if (!hasContext && preset.contextless?.autoLoadClipboard) {
    try {
      const clipText = (await overlayShellClient.readClipboardText()).trim();
      if (clipText) {
        pendingCapture = {
          sourceApp: "clipboard",
          captureMode: "clipboard",
          capture: { text: clipText, sourceType: "text" }
        };
      } else {
        showPopBubble({ label: action, body: "剪贴板是空的。复制要处理的文本后再试。" });
        return;
      }
    } catch (error) {
      showPopBubble({ label: action, body: `读取剪贴板失败：${error.message}` });
      return;
    }
  }

  // Mark this submission as ephemeral — the result should pop, not stay
  popKeptOpen = false;
  hidePopBubble();
  showPopBubble({ label: action, body: "处理中...", autoHideMs: 30_000 });

  commandInput.value = preset.command;
  await submitTask();
}

for (const btn of quickButtons) {
  btn.addEventListener("click", () => {
    void runQuickAction(btn.dataset.quickAction);
  });
}

/* ═══════════════════════════════════════════════
   INLINE PANELS — schedule + voice
   ═══════════════════════════════════════════════ */

function setPanelOpen(panel, open) {
  if (!panel) return;
  panel.dataset.open = open ? "true" : "false";
}

function isPanelOpen(panel) {
  return panel?.dataset.open === "true";
}

function closeAllPanels() {
  setPanelOpen(schedulePanel, false);
  setPanelOpen(document.querySelector("#projectPanel"), false);
  exitVoiceMode();
}

/* ═══════════════════════════════════════════════
   APPLE-STYLE VOICE MODE + AUTO-HIDE POP BUBBLE
   ═══════════════════════════════════════════════ */

let voiceMode = false;
let popHideTimer = null;
let popKeptOpen = false; // user clicked input → keep overlay until they explicitly close
let echoSessionActive = false;
let echoHudLastText = "";
let echoHudLastAt = 0;
let echoVoiceAutoSubmitTimer = null;
let echoVoiceAutoSubmitInFlight = false;
let echoVoiceHardLimitTimer = null;
let echoCommandStartedAt = 0;
let echoCommandLastSpeechAt = 0;
let echoRecognizerRestartTimer = null;
const ECHO_LOCAL_CAPTURE_MS = 4000;
const ECHO_COMMAND_SILENCE_MS = 1400;
const ECHO_COMMAND_HARD_LIMIT_MS = 18000;
const ECHO_TRANSCRIBE_FIRST_FRAME_TIMEOUT_MS = 6000;
const ECHO_NOTE_COMMAND_PATTERNS = [
  /(?:开始|開始|启动|啟動|打开|開啟|开启|录|錄).{0,4}(?:录音|錄音|笔记|筆記|记录|記錄|会议|會議|note)/i,
  /(?:录音|錄音).{0,4}(?:笔记|筆記|记录|記錄|会议|會議)/i,
  /(?:会议|會議).{0,4}(?:记录|記錄|纪要|紀要|笔记|筆記)/i,
  /\b(?:start|begin|open)\s+(?:a\s+)?(?:voice\s+)?(?:note|recording|meeting\s+notes?)\b/i
];

function isEchoNoteCommand(text = "") {
  const normalized = `${text ?? ""}`
    .trim()
    .replaceAll("筆", "笔")
    .replaceAll("記", "记")
    .replaceAll("錄", "录")
    .replaceAll("會", "会")
    .replaceAll("開", "开")
    .replaceAll("啟", "启")
    .replace(/\s+/g, "");
  if (!normalized) return false;
  return ECHO_NOTE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

function showEchoHud({ text = "", kind = "info", durationMs = 1600, throttleMs = 700 } = {}) {
  if (!echoSessionActive || !text) return;
  const now = Date.now();
  if (text === echoHudLastText && now - echoHudLastAt < throttleMs) return;
  echoHudLastText = text;
  echoHudLastAt = now;
  void overlayShellClient?.showEchoBubble?.({ text, kind, durationMs });
}

function clearEchoVoiceAutoSubmit() {
  if (echoVoiceAutoSubmitTimer) {
    clearTimeout(echoVoiceAutoSubmitTimer);
    echoVoiceAutoSubmitTimer = null;
  }
  if (echoVoiceHardLimitTimer) {
    clearTimeout(echoVoiceHardLimitTimer);
    echoVoiceHardLimitTimer = null;
  }
  if (echoRecognizerRestartTimer) {
    clearTimeout(echoRecognizerRestartTimer);
    echoRecognizerRestartTimer = null;
  }
}

function scheduleEchoVoiceAutoSubmit(delayMs = ECHO_LOCAL_CAPTURE_MS, {
  message = "等你说完，会自动发送…",
  kind = "info",
  durationMs = 1800
} = {}) {
  if (!echoSessionActive || echoVoiceAutoSubmitInFlight) return;
  if (echoVoiceAutoSubmitTimer) {
    clearTimeout(echoVoiceAutoSubmitTimer);
    echoVoiceAutoSubmitTimer = null;
  }
  showEchoHud({
    text: message,
    kind,
    durationMs,
    throttleMs: 900
  });
  echoVoiceAutoSubmitTimer = setTimeout(() => {
    void submitEchoVoiceCommand();
  }, delayMs);
}

function armEchoCommandHardLimit() {
  if (!echoSessionActive) return;
  if (echoVoiceHardLimitTimer) clearTimeout(echoVoiceHardLimitTimer);
  echoVoiceHardLimitTimer = setTimeout(() => {
    if (!echoSessionActive || echoVoiceAutoSubmitInFlight) return;
    if (!commandInput.value.trim()) {
      showEchoHud({ text: "没听清，再说一次 linxi 试试", kind: "error", durationMs: 2600, throttleMs: 0 });
      void endEchoSession();
      return;
    }
    void submitEchoVoiceCommand();
  }, ECHO_COMMAND_HARD_LIMIT_MS);
}

function noteEchoSpeechHeard(text = "") {
  if (!echoSessionActive || !text.trim()) return;
  echoCommandLastSpeechAt = Date.now();
  scheduleEchoVoiceAutoSubmit(ECHO_COMMAND_SILENCE_MS, {
    message: "继续说，停顿后我再执行…",
    durationMs: 1700
  });
}

async function submitEchoVoiceCommand() {
  if (!echoSessionActive || echoVoiceAutoSubmitInFlight) return;
  echoVoiceAutoSubmitInFlight = true;
  let deferredForMoreSpeech = false;
  clearEchoVoiceAutoSubmit();
  try {
    const liveTranscriptReady = voiceRecognitionProducedText
      && commandInput.value.trim()
      && !voiceLocalFallbackActive;
    showEchoHud({
      text: liveTranscriptReady ? "已识别，正在发送…" : "正在转写…",
      kind: "info",
      durationMs: 2000,
      throttleMs: 0
    });
    if (voiceRecording) {
      const finalResult = await stopVoiceRecognition({
        preferLiveTranscript: true,
        streamingFirstFrameTimeoutMs: ECHO_TRANSCRIBE_FIRST_FRAME_TIMEOUT_MS
      });
      const finalText = `${finalResult?.transcript ?? ""}`.trim();
      if (finalText) {
        commandInput.value = finalText;
        autoSizeInput();
        if (voiceTranscript) {
          voiceTranscript.classList.remove("placeholder");
          voiceTranscript.textContent = finalText;
          voiceTranscript.scrollTop = voiceTranscript.scrollHeight;
        }
      }
    }
    const text = commandInput.value.trim();
    if (!text) {
      showEchoHud({ text: "没听清，再说一次 linxi 试试", kind: "error", durationMs: 2600, throttleMs: 0 });
      return;
    }
    const heardRecently = echoCommandLastSpeechAt
      && Date.now() - echoCommandLastSpeechAt < Math.max(900, ECHO_COMMAND_SILENCE_MS - 250);
    if (heardRecently) {
      deferredForMoreSpeech = true;
      scheduleEchoVoiceAutoSubmit(ECHO_COMMAND_SILENCE_MS, {
        message: "继续听你说完…",
        durationMs: 1500
      });
      return;
    }
    if (isEchoNoteCommand(text)) {
      commandInput.value = "";
      autoSizeInput();
      resetVoiceState();
      showEchoHud({ text: "开始录音笔记…", kind: "wake", durationMs: 2200, throttleMs: 0 });
      await enterNoteMode();
      return;
    }
    if (voiceMode && !noteActive) {
      exitVoiceMode();
    }
    showEchoHud({ text: "收到，正在发送…", kind: "wake", durationMs: 1800, throttleMs: 0 });
    await handleUserSend();
  } finally {
    echoVoiceAutoSubmitInFlight = false;
    if (deferredForMoreSpeech) return;
    if (!noteActive) {
      resetVoiceState();
      if (voiceMode) {
        exitVoiceMode();
      }
      await endEchoSession();
    }
  }
}

function setVoiceCardMode(mode = "voice") {
  setVoiceCardModeView({
    voiceCard,
    tabVoiceBtn,
    tabNoteBtn
  }, mode);
}

function showNotePanel() {
  voiceMode = true;
  document.body.classList.add("voice-mode");
  setVoiceCardMode("note");
  voiceCard?.classList.remove("idle", "error");
  cancelPopHide();
}

function enterVoiceMode() {
  if (noteActive) {
    showNotePanel();
    return;
  }
  // Defensive clear of the dock's recording indicator — a prior note session
  // that wasn't cleanly torn down can leave the red REC ring spinning
  // forever. Voice mode never owns note-recording state, so force it off
  // whenever we enter voice mode.
  void overlayShellClient?.setNoteRecordingState?.({ active: false, elapsedMs: 0, elapsed: "00:00" });
  voiceMode = true;
  document.body.classList.add("voice-mode");
  setVoiceCardMode("voice");
  voiceCard?.classList.add("idle");
  voiceCard?.classList.remove("error");
  resetVoiceTranscriptView(voiceTranscript);
  // Defensive reset — make sure a stale voiceRecording=true from a prior
  // session doesn't make the Start button no-op the next time the panel
  // opens. If there's no active stream/recorder, voiceRecording was wrong.
  if (voiceRecording && !voiceMicStream && !voiceMediaRecorder) {
    voiceRecording = false;
    voiceLocalFallbackActive = false;
    voiceManualStopPending = false;
  }
  if (voiceStatus) voiceStatus.textContent = "点击「开始」后说话";
  if (voiceStartBtn) voiceStartBtn.disabled = false;
  if (voiceStopBtn) voiceStopBtn.disabled = false;
  cancelPopHide();
}

function exitVoiceMode() {
  if (noteActive) {
    showNotePanel();
    return;
  }
  voiceMode = false;
  document.body.classList.remove("voice-mode");
  setVoiceCardMode("voice");
  if (voiceRecording) stopVoiceRecognition();
}

function showPopBubble({ label = "UCA", body = "", autoHideMs = 3000 } = {}) {
  if (!popBubble) return;
  popLabel.textContent = label;
  popBody.textContent = body;
  popBubble.dataset.open = "true";
  schedulePopHide(autoHideMs);
}

function hidePopBubble() {
  if (!popBubble) return;
  popBubble.dataset.open = "false";
  cancelPopHide();
}

function cancelPopHide() {
  if (popHideTimer) {
    clearTimeout(popHideTimer);
    popHideTimer = null;
  }
}

function schedulePopHide(ms = 3000) {
  cancelPopHide();
  if (popKeptOpen) return;
  popHideTimer = setTimeout(() => {
    hidePopBubble();
    if (!popKeptOpen) {
      // also dim and hide the whole overlay window after the bubble fades
      document.body.classList.add("popping");
      setTimeout(() => {
        if (!popKeptOpen) {
          document.body.classList.remove("popping");
          overlayShellClient.hideWindow("overlay");
        }
      }, 320);
    }
  }, ms);
}

function markUserEngaged() {
  suppressOverlayAutoReveal = false;
  popKeptOpen = true;
  document.body.classList.remove("popping");
  cancelPopHide();
  hidePopBubble();
}

// Any direct interaction with the input box keeps the overlay open
commandInput.addEventListener("focus", markUserEngaged);
commandInput.addEventListener("pointerdown", markUserEngaged);
bubbleArea?.addEventListener("pointerdown", markUserEngaged);
bubbleArea?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const contextPath = target?.closest?.("[data-context-open-path]");
  if (contextPath && bubbleArea.contains(contextPath)) {
    event.preventDefault();
    const filePath = contextPath.getAttribute("data-context-open-path");
    if (filePath) void overlayShellClient?.openPath?.(filePath);
    return;
  }
  const contextUrl = target?.closest?.("[data-context-open-url]");
  if (contextUrl && bubbleArea.contains(contextUrl)) {
    event.preventDefault();
    const url = contextUrl.getAttribute("data-context-open-url");
    if (url) {
      overlayShellClient?.openUrl?.(url, { ask: true, source: "overlay_chat_context" })
        ?? overlayShellClient?.openExternal?.(url);
    }
    return;
  }
  const externalLink = target?.closest?.("[data-open-url], a[href]:not([data-local-file-path])");
  if (externalLink && bubbleArea.contains(externalLink)) {
    event.preventDefault();
    const url = externalLink.getAttribute("data-open-url") || externalLink.getAttribute("href");
    if (url && /^https?:\/\//i.test(url)) {
      overlayShellClient?.openUrl?.(url, { ask: true, source: "overlay_chat" })
        ?? overlayShellClient?.openExternal?.(url);
    }
    return;
  }
  const localFileLink = target?.closest?.("[data-local-file-path]");
  if (localFileLink && bubbleArea.contains(localFileLink)) {
    event.preventDefault();
    const filePath = localFileLink.getAttribute("data-local-file-path");
    if (filePath) void overlayShellClient?.openPath?.(filePath);
    return;
  }
  const citeChip = target?.closest?.(".cite-chip[data-source-id]");
  if (!citeChip || !bubbleArea.contains(citeChip)) return;
  event.preventDefault();
  revealEvidenceSource(bubbleArea, citeChip.dataset.sourceId);
});

popOpenBtn?.addEventListener("click", () => {
  markUserEngaged();
  if (popBody.textContent) {
    addBubble("assistant", popBody.textContent);
  }
  commandInput.focus();
});

popCopyBtn?.addEventListener("click", async () => {
  const text = popBody?.textContent ?? "";
  if (text) {
    try {
      await overlayShellClient.writeClipboardText(text);
      popLabel.textContent = "已复制";
    } catch {
      popLabel.textContent = "复制失败";
    }
  }
});

popBubble?.addEventListener("pointerdown", (event) => {
  // Clicking inside the pop bubble should keep it visible until the user
  // makes a decision (open / copy / dismiss).
  cancelPopHide();
  if (event.target === popBubble) {
    schedulePopHide(5000);
  }
});

function openSchedulePanel() {
  exitVoiceMode();
  setPanelOpen(schedulePanel, true);
  // default time = 5 minutes from now, formatted for datetime-local
  const future = new Date(Date.now() + 5 * 60_000);
  const tzOffsetMs = future.getTimezoneOffset() * 60_000;
  scheduleWhenInput.value = new Date(future.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  if (!scheduleNameInput.value) scheduleNameInput.value = "UCA 提醒";
  if (!scheduleCommandInput.value && commandInput.value.trim()) {
    scheduleCommandInput.value = commandInput.value.trim();
  }
  scheduleNameInput.focus();
}

scheduleToggleBtn?.addEventListener("click", () => {
  markUserEngaged(); // Bug-B fix: exit popping mode so pointer-events are restored
  if (isPanelOpen(schedulePanel)) {
    setPanelOpen(schedulePanel, false);
  } else {
    openSchedulePanel();
  }
});

scheduleCancelBtn?.addEventListener("click", () => {
  setPanelOpen(schedulePanel, false);
});

// UCA-046: inline schedule form + category + leadTime
const scheduleCategorySelect = document.querySelector("#scheduleCategory");
const scheduleLeadTimeSelect = document.querySelector("#scheduleLeadTime");

scheduleSaveBtn?.addEventListener("click", async () => {
  const whenValue = scheduleWhenInput.value;
  const command = scheduleCommandInput.value.trim();
  const name = (scheduleNameInput.value.trim() || command || "UCA 提醒").slice(0, 60);
  if (!whenValue) {
    addSystemBubble("请选择触发时间。");
    return;
  }
  if (!command) {
    addSystemBubble("请填写任务内容。");
    return;
  }
  const runAt = new Date(whenValue);
  if (Number.isNaN(runAt.getTime())) {
    addSystemBubble("无法解析时间，请重新选择。");
    return;
  }
  const category = scheduleCategorySelect?.value || "reminder";
  const leadTimeRaw = scheduleLeadTimeSelect?.value || "default";
  const leadTimeMs = leadTimeRaw === "default"
    ? (category === "reminder" ? 0 : null)
    : Number(leadTimeRaw);

  scheduleSaveBtn.disabled = true;
  scheduleSaveBtn.textContent = "创建中...";
  try {
    const result = await createScheduleViaShell({
      name,
      trigger: {
        type: "at",
        run_at: runAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        oneShot: true,
        label: runAt.toLocaleString()
      },
      oneShot: true,
      title: name,
      message: command,
      userCommand: command,
      executionMode: "interactive",
      category,
      leadTimeMs,
      userTodo: category === "reminder"
    });
    addBubble("assistant", `定时任务已创建：${name}\n下次触发：${result.schedule?.next_run_at ?? runAt.toLocaleString()}`);
    setPanelOpen(schedulePanel, false);
    scheduleNameInput.value = "";
    scheduleCommandInput.value = "";
  } catch (error) {
    addBubble("assistant", `创建失败：${error.message}`);
  } finally {
    scheduleSaveBtn.disabled = false;
    scheduleSaveBtn.textContent = "创建";
  }
});

/* ═══════════════════════════════════════════════
   VOICE INPUT (Web Speech API)
   ═══════════════════════════════════════════════ */

let voiceRecognizer = null;
let voiceRecording = false;
let voiceMicStream = null;
let voiceMediaRecorder = null;
let voiceAudioChunks = [];
let voiceLocalFallbackActive = false;
let voiceRecognitionProducedText = false;
let voiceManualStopPending = false;

// Live audio-level meter — reads AnalyserNode frequency bins on every
// requestAnimationFrame tick and maps the RMS to each wave-bar's scaleY.
// Replaces the fixed-period CSS keyframe so the bars actually react to the
// user's voice instead of pulsing at a constant rate.
let voiceAudioContext = null;
let voiceAnalyserNode = null;
let voiceAnalyserRafId = null;
let voiceWaveBarsCache = null;

// Live preview transcription — when Web Speech API is unavailable (fallback
// mode on Electron+Windows), the user gets no real-time text during recording.
// This interval takes a snapshot of the accumulated audio every few seconds
// and sends it for a preview transcription, so voiceTranscript grows while
// the user speaks instead of waiting for them to press stop.
let voicePreviewTimer = null;
let voicePreviewInFlight = false;
let voicePreviewSessionId = 0;
const VOICE_PREVIEW_INTERVAL_MS = 3500;

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function selectedVoiceLanguage() {
  return voiceLangSelect?.value || "zh-CN";
}

function liveRecognizerLanguage() {
  const selected = selectedVoiceLanguage();
  if (selected && selected !== "auto") return selected;
  const preferred = Array.isArray(navigator.languages)
    ? navigator.languages.find((lang) => /^zh|^en/i.test(lang))
    : "";
  if (/^zh/i.test(preferred || navigator.language || "")) return "zh-CN";
  return preferred || navigator.language || "zh-CN";
}

function transcriptionOutputLocale() {
  const selected = selectedVoiceLanguage();
  if (selected && selected !== "auto") return selected;
  return "zh-CN";
}

function setVoiceRecording(active) {
  voiceRecording = active;
  applyVoiceRecordingView({
    voiceCard,
    voiceStatus,
    voiceToggleBtn,
    voiceStartBtn,
    voiceStopBtn
  }, active);
  updateComposerMicView(active);
  if (active) {
    showEchoHud({ text: "正在聆听…", kind: "wake", durationMs: 1800, throttleMs: 0 });
  } else {
    stopVoiceAudioMeter();
    showEchoHud({ text: "识别已停止", kind: "info", durationMs: 1200 });
  }
}

// Composer mic owns the lightweight voice-to-text path: it reuses the same
// recognizer + recorder used by the full voice card, but does not flip the
// overlay into voice-mode, so the user dictates straight into the composer
// without losing the chat surface.
function updateComposerMicView(active) {
  if (!composerMicBtn) return;
  composerMicBtn.classList.toggle("recording", !!active);
  composerMicBtn.classList.remove("starting");
  composerMicBtn.setAttribute("aria-pressed", active ? "true" : "false");
  composerMicBtn.title = active
    ? "停止语音输入 (Ctrl+Shift+V)"
    : "语音输入 (Ctrl+Shift+V) — 再次点击停止";
}

function appendVoiceTranscript(text) {
  const transcript = `${text ?? ""}`.trim();
  if (!transcript) return;
  const base = commandInput.value.trim();
  commandInput.value = base ? `${base}\n${transcript}` : transcript;
  autoSizeInput();
  if (voiceTranscript) {
    voiceTranscript.classList.remove("placeholder");
    voiceTranscript.textContent = commandInput.value.trim() || "\u00a0";
    voiceTranscript.scrollTop = voiceTranscript.scrollHeight;
  }
  showEchoHud({
    text: `听到：${transcript.slice(0, 48)}`,
    kind: "info",
    durationMs: 1800
  });
}

function startVoiceLocalRecorder(stream) {
  voiceMicStream = stream;
  voiceAudioChunks = [];
  voiceLocalFallbackActive = false;
  voiceRecognitionProducedText = false;
  if (!stream || typeof MediaRecorder === "undefined") return;
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  try {
    voiceMediaRecorder = new MediaRecorder(stream, { mimeType });
    voiceMediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) voiceAudioChunks.push(event.data);
    });
    voiceMediaRecorder.start(1000);
  } catch {
    voiceMediaRecorder = null;
  }
  // Wire the same stream into an AudioContext analyser so the waveform bars
  // react to actual mic volume. Purely cosmetic — failures silently fall back
  // to the fixed CSS animation.
  startVoiceAudioMeter(stream);
}

function startVoiceAudioMeter(stream) {
  if (!stream || typeof AudioContext === "undefined") return;
  try {
    stopVoiceAudioMeter();
    voiceAudioContext = new AudioContext();
    const source = voiceAudioContext.createMediaStreamSource(stream);
    voiceAnalyserNode = voiceAudioContext.createAnalyser();
    voiceAnalyserNode.fftSize = 64; // 32 frequency bins — enough for 9 bars
    voiceAnalyserNode.smoothingTimeConstant = 0.7;
    source.connect(voiceAnalyserNode);
    voiceCard?.classList.add("audio-reactive");

    const bars = voiceWaveBarsCache ??= Array.from(voiceCard?.querySelectorAll(".wave-bar") ?? []);
    const freqBuffer = new Uint8Array(voiceAnalyserNode.frequencyBinCount);

    const tick = () => {
      if (!voiceAnalyserNode) return;
      voiceAnalyserNode.getByteFrequencyData(freqBuffer);
      // Distribute bins across visible bars; middle bars get the loudest (mid
      // voice frequency band).
      const binCount = freqBuffer.length;
      for (let i = 0; i < bars.length; i += 1) {
        const bin = Math.floor((i / Math.max(1, bars.length - 1)) * (binCount - 1));
        const amplitude = freqBuffer[bin] / 255; // 0..1
        const scale = 0.4 + amplitude * 2.6; // matches @keyframes wave-pulse range
        bars[i].style.transform = `scaleY(${scale.toFixed(3)})`;
        bars[i].style.opacity = `${(0.55 + amplitude * 0.45).toFixed(3)}`;
      }
      voiceAnalyserRafId = requestAnimationFrame(tick);
    };
    voiceAnalyserRafId = requestAnimationFrame(tick);
  } catch {
    stopVoiceAudioMeter();
  }
}

function stopVoiceAudioMeter() {
  if (voiceAnalyserRafId != null) {
    cancelAnimationFrame(voiceAnalyserRafId);
    voiceAnalyserRafId = null;
  }
  if (voiceAnalyserNode) {
    try { voiceAnalyserNode.disconnect(); } catch { /* ignore */ }
    voiceAnalyserNode = null;
  }
  if (voiceAudioContext) {
    try { voiceAudioContext.close(); } catch { /* ignore */ }
    voiceAudioContext = null;
  }
  voiceCard?.classList.remove("audio-reactive");
  // Reset any inline transforms written by the analyser so the CSS animation
  // can take over again.
  if (voiceWaveBarsCache) {
    for (const bar of voiceWaveBarsCache) {
      bar.style.transform = "";
      bar.style.opacity = "";
    }
  }
}

// Starts (or restarts) the periodic preview-transcription loop. Every
// VOICE_PREVIEW_INTERVAL_MS we build a blob from the current accumulated
// MediaRecorder chunks and POST it to the non-streaming /note/transcribe
// endpoint. The preview overwrites voiceTranscript so the user sees their
// words appear while still speaking. Only meant for the fallback path where
// Web Speech API interim results are unavailable.
function startVoicePreviewLoop() {
  stopVoicePreviewLoop();
  voicePreviewSessionId += 1;
  const mySession = voicePreviewSessionId;
  voicePreviewTimer = setInterval(() => {
    if (!voiceRecording || voicePreviewInFlight) return;
    if (voicePreviewSessionId !== mySession) return;
    if (voiceAudioChunks.length === 0) return;
    // Clone chunks now so a concurrent dataavailable push doesn't mutate the
    // blob mid-fetch.
    const snapshot = voiceAudioChunks.slice();
    const blob = new Blob(snapshot, { type: "audio/webm" });
    voicePreviewInFlight = true;
    transcribeAudioBlob(blob, { lang: selectedVoiceLanguage() })
      .then((resp) => {
        if (!voiceRecording || voicePreviewSessionId !== mySession) return;
        const text = `${resp?.transcript ?? ""}`.trim();
        if (!text || !voiceTranscript) return;
        // Preview is overwrite-style: each tick replaces the prior preview
        // with the fresh full-audio transcript. The authoritative streaming
        // transcribe on stop still runs and gets the final text.
        voiceTranscript.classList.remove("placeholder");
        voiceTranscript.textContent = text;
        voiceTranscript.scrollTop = voiceTranscript.scrollHeight;
        noteEchoSpeechHeard(text);
        showEchoHud({
          text: `听到：${text.slice(0, 48)}`,
          kind: "info",
          durationMs: 1800
        });
      })
      .catch((err) => {
        // Preview failures are expected occasionally (codec boundaries,
        // briefly unparseable webm prefix). Don't disrupt the user; the
        // final transcribe is the source of truth.
        console.debug("[voice] preview transcribe failed:", err?.message ?? err);
      })
      .finally(() => {
        voicePreviewInFlight = false;
      });
  }, VOICE_PREVIEW_INTERVAL_MS);
}

function stopVoicePreviewLoop() {
  if (voicePreviewTimer) {
    clearInterval(voicePreviewTimer);
    voicePreviewTimer = null;
  }
  voicePreviewSessionId += 1;
}

function stopVoiceTracks() {
  voiceMicStream?.getTracks?.().forEach((track) => track.stop());
  voiceMicStream = null;
  stopVoiceAudioMeter();
}

function stopVoiceLocalRecorder({ transcribe = false, streamingFirstFrameTimeoutMs = undefined } = {}) {
  const recorder = voiceMediaRecorder;
  voiceMediaRecorder = null;
  voiceLocalFallbackActive = false;
  stopVoicePreviewLoop();

  return new Promise((resolve) => {
    const finish = async () => {
      stopVoiceTracks();
      const chunks = voiceAudioChunks;
      voiceAudioChunks = [];
      if (!transcribe || chunks.length === 0) {
        resolve({ ok: true, transcript: "" });
        return;
      }
      try {
        voiceStatus.textContent = "⏳ 正在转写...";
        const blob = new Blob(chunks, { type: "audio/webm" });
        const streamed = await transcribeAudioBlobStreaming(blob, {
          lang: selectedVoiceLanguage(),
          firstFrameTimeoutMs: streamingFirstFrameTimeoutMs
        });
        if (streamed.ok) {
          const transcript = `${streamed.transcript ?? ""}`.trim();
          voiceStatus.textContent = transcript ? "✓ 转写完成 · 按 Enter 发送" : "没有检测到语音，请再试一次。";
          resolve({ ok: true, transcript });
          return;
        }
        // Streaming failed (no partials, bad server, etc.) — fall back to the
        // original one-shot endpoint so we still get a transcript.
        const resp = await transcribeAudioBlob(blob, {
          lang: selectedVoiceLanguage()
        });
        const transcript = `${resp.transcript ?? ""}`.trim();
        if (resp.ok === false) {
          voiceStatus.textContent = `转写失败：${resp.detail || resp.message || resp.reason || "unknown"}`;
          voiceCard?.classList.add("error");
          resolve({ ok: false, transcript: "" });
          return;
        }
        appendVoiceTranscript(transcript);
        voiceStatus.textContent = transcript ? "✓ 转写完成 · 按 Enter 发送" : "没有检测到语音，请再试一次。";
        resolve({ ok: true, transcript });
      } catch (error) {
        voiceStatus.textContent = `转写失败：${error?.message ?? error}`;
        voiceCard?.classList.add("error");
        resolve({ ok: false, transcript: "" });
      }
    };

    if (!recorder || recorder.state === "inactive") {
      void finish();
      return;
    }
    recorder.addEventListener("stop", () => { void finish(); }, { once: true });
    try { recorder.requestData(); } catch { /* ignore */ }
    try { recorder.stop(); } catch { void finish(); }
  });
}

function ensureVoiceRecognizer() {
  if (voiceRecognizer) return voiceRecognizer;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognizer = new Ctor();
  recognizer.continuous = Boolean(echoSessionActive);
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;

  recognizer.addEventListener("result", (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    const merged = (commandInput.dataset.voiceBase ?? "") + finalText + interim;
    commandInput.value = merged;
    autoSizeInput();
    if (finalText || interim) {
      voiceRecognitionProducedText = true;
    }
    // Mirror in the voice card transcript so the user sees what they're saying
    if (voiceTranscript) {
      voiceTranscript.classList.remove("placeholder");
      voiceTranscript.textContent = merged.trim() || "\u00a0";
      voiceTranscript.scrollTop = voiceTranscript.scrollHeight;
    }
    const heardText = (finalText || interim || "").trim();
    if (heardText) {
      noteEchoSpeechHeard(heardText);
      showEchoHud({
        text: `听到：${heardText.slice(0, 48)}`,
        kind: "info",
        durationMs: 1800
      });
    }
    if (finalText) {
      commandInput.dataset.voiceBase = (commandInput.dataset.voiceBase ?? "") + finalText;
      voiceStatus.textContent = "识别完成 · 按 Enter 发送";
    } else if (interim) {
      voiceStatus.textContent = "听到中...";
    }
  });

  recognizer.addEventListener("end", () => {
    if (voiceLocalFallbackActive || voiceManualStopPending) {
      return;
    }
    void stopVoiceLocalRecorder({ transcribe: false });
    setVoiceRecording(false);
    if (!voiceStatus.textContent || voiceStatus.textContent.startsWith("正在聆听")) {
      voiceStatus.textContent = "已停止。可以再次开始或按 Enter 发送。";
    }
    delete commandInput.dataset.voiceBase;
    commandInput.focus();
    if (echoSessionActive && commandInput.value.trim()) {
      scheduleEchoVoiceAutoSubmit(ECHO_COMMAND_SILENCE_MS, {
        message: "我等一下，确认你说完再执行…",
        durationMs: 1700
      });
      const withinHardLimit = !echoCommandStartedAt
        || Date.now() - echoCommandStartedAt < ECHO_COMMAND_HARD_LIMIT_MS - 1000;
      if (withinHardLimit && !echoRecognizerRestartTimer) {
        echoRecognizerRestartTimer = setTimeout(() => {
          echoRecognizerRestartTimer = null;
          if (!echoSessionActive || echoVoiceAutoSubmitInFlight || voiceLocalFallbackActive) return;
          try {
            recognizer.start();
            setVoiceRecording(true);
          } catch { /* Web Speech may refuse immediate restart; auto-submit timer still protects us. */ }
        }, 250);
      }
    }
  });

  recognizer.addEventListener("error", (event) => {
    const code = event.error ?? "unknown";
    // Whenever the online recogniser fails for an infrastructure reason
    // (network, service-not-allowed, no-speech, or unknown/transient codes)
    // keep the MediaRecorder running so the user's audio isn't thrown away.
    // Only hard-stop on permission errors ("not-allowed", "audio-capture")
    // where we genuinely can't record at all, or on explicit "aborted".
    const keepRecording = voiceMediaRecorder && !["not-allowed", "audio-capture", "aborted"].includes(code);
    if (keepRecording) {
      voiceLocalFallbackActive = true;
      setVoiceRecording(true);
      // Web Speech API failed — kick in the periodic preview-transcribe loop
      // so the user still sees their words appear during recording rather
      // than silent "listening". Final streamed transcribe still runs on
      // stop as the source of truth.
      startVoicePreviewLoop();
      scheduleEchoVoiceAutoSubmit(ECHO_LOCAL_CAPTURE_MS, {
        message: "本地识别中，说完后会自动发送…",
        durationMs: 2400
      });
      voiceStatus.textContent = "🎙 正在聆听（实时预览转写）";
      voiceCard?.classList.remove("error", "idle");
      return;
    }
    void stopVoiceLocalRecorder({ transcribe: false });
    setVoiceRecording(false);
    const friendly = {
      "not-allowed": "麦克风权限被拒绝。请重启 UCA 桌面端，并在系统设置中允许麦克风访问。",
      "service-not-allowed": "操作系统拒绝了语音识别服务。请检查系统设置 → 隐私 → 语音识别。",
      "no-speech": "没有检测到语音，请再试一次。",
      "audio-capture": "无法读取麦克风音频。请检查麦克风是否连接或被其他程序占用。",
      "network": "实时识别暂不可用；请用本地录音转写模式重试。",
      "aborted": "语音输入已取消。"
    }[code] ?? `识别错误：${code}`;
    voiceStatus.textContent = friendly;
    voiceCard?.classList.add("error");
    voiceCard?.classList.remove("idle");
    showEchoHud({
      text: friendly.slice(0, 64),
      kind: "error",
      durationMs: 2600,
      throttleMs: 0
    });
  });

  voiceRecognizer = recognizer;
  return recognizer;
}

// Low-level helper — starts the recognizer after mic permission is confirmed.
function _doStartRecognizer(recognizer) {
  if (!recognizer) return;
  recognizer.lang = liveRecognizerLanguage();
  commandInput.dataset.voiceBase = commandInput.value;
  try {
    recognizer.start();
    setVoiceRecording(true);
    voiceStatus.textContent = "正在聆听...";
  } catch (error) {
    const message = (error?.message ?? "").toLowerCase();
    if (!message.includes("invalidstate") && voiceMediaRecorder) {
      voiceLocalFallbackActive = true;
      setVoiceRecording(true);
      startVoicePreviewLoop();
      scheduleEchoVoiceAutoSubmit(ECHO_LOCAL_CAPTURE_MS, {
        message: "本地识别中，说完后会自动发送…",
        durationMs: 2400
      });
      voiceStatus.textContent = "🎙 正在聆听（实时预览转写）";
      voiceCard?.classList.remove("error", "idle");
      return;
    }
    if (message.includes("not-allowed") || message.includes("notallowederror")) {
      voiceStatus.textContent = "麦克风权限被拒绝。请在系统设置 → 隐私 → 麦克风 中允许此应用访问，然后重试。";
      voiceCard?.classList.add("error");
      voiceCard?.classList.remove("idle");
    } else if (message.includes("invalidstate")) {
      // already running — keep going
      setVoiceRecording(true);
      voiceStatus.textContent = "正在聆听...";
      return;
    } else {
      if (voiceMediaRecorder) {
        voiceLocalFallbackActive = true;
        setVoiceRecording(true);
        startVoicePreviewLoop();
        scheduleEchoVoiceAutoSubmit(ECHO_LOCAL_CAPTURE_MS, {
          message: "本地识别中，说完后会自动发送…",
          durationMs: 2400
        });
        voiceStatus.textContent = "🎙 正在聆听（实时预览转写）";
        voiceCard?.classList.remove("error", "idle");
        return;
      }
      voiceStatus.textContent = `无法启动识别：${error.message}`;
      voiceCard?.classList.add("error");
      voiceCard?.classList.remove("idle");
    }
    setVoiceRecording(false);
  }
}

// Force-reset every voice state/handle. Used by the Start button so a stuck
// prior session (e.g. recorder stopped mid-transcription, mic stream still
// open, error class left on the card) never turns the button into a no-op.
function resetVoiceState() {
  stopVoicePreviewLoop();
  try { voiceRecognizer?.abort?.(); } catch { /* ignore */ }
  try { voiceMediaRecorder?.stop?.(); } catch { /* ignore */ }
  voiceRecognizer = null;
  stopVoiceTracks();
  voiceMediaRecorder = null;
  voiceAudioChunks = [];
  voiceRecording = false;
  voiceLocalFallbackActive = false;
  voiceManualStopPending = false;
  voiceRecognitionProducedText = false;
  voiceCard?.classList.remove("error", "starting");
  // Voice reset must never leave a stale note-recording indicator on the
  // dock. See enterVoiceMode() note above.
  if (!noteActive) {
    void overlayShellClient?.setNoteRecordingState?.({ active: false, elapsedMs: 0, elapsed: "00:00" });
  }
  resetVoiceTranscriptView(voiceTranscript);
}

// On Windows, Web Speech API does not trigger the OS microphone permission
// dialog by itself. We must call getUserMedia({audio:true}) first so that
// Chromium/Electron asks Windows for permission, then start the recognizer.
async function startVoiceRecognition() {
  // Treat every explicit "start" as a hard reset — prevents any prior stuck
  // session (half-torn-down recorder, lingering stream, stale flags) from
  // silently swallowing the click.
  resetVoiceState();

  const recognizer = ensureVoiceRecognizer();
  voiceCard?.classList.add("starting");
  voiceStatus.textContent = "🎙 正在启动麦克风…";
  if (voiceStartBtn) voiceStartBtn.disabled = true;

  const finishError = (text, err) => {
    if (err) console.error("[voice] start failed:", err);
    voiceStatus.textContent = text;
    voiceCard?.classList.add("error");
    voiceCard?.classList.remove("idle", "starting");
    if (voiceStartBtn) voiceStartBtn.disabled = false;
    setVoiceRecording(false);
  };

  const audioRequest = await requestAudioInputStream({
    mediaDevices: navigator.mediaDevices,
    permissions: navigator.permissions,
    timeoutMs: 5000
  });
  if (!audioRequest.ok) {
    finishError(describeAudioInputFailure(audioRequest), audioRequest.error);
    return;
  }

  try {
    const stream = audioRequest.stream;
    voiceCard?.classList.remove("starting");
    startVoiceLocalRecorder(stream);
    setVoiceRecording(true);
    voiceStatus.textContent = "🎙 正在聆听...";
    if (recognizer) {
      _doStartRecognizer(recognizer);
    } else {
      voiceLocalFallbackActive = true;
      startVoicePreviewLoop();
      scheduleEchoVoiceAutoSubmit(ECHO_LOCAL_CAPTURE_MS, {
        message: "本地识别中，说完后会自动发送…",
        durationMs: 2400
      });
      voiceStatus.textContent = "🎙 正在聆听（实时预览转写）";
    }
  } catch (err) {
    finishError(`麦克风初始化失败：${err?.message ?? err}`, err);
  }
}

function stopVoiceRecognition({
  discard = false,
  forceTranscribe = false,
  preferLiveTranscript = false,
  streamingFirstFrameTimeoutMs = undefined
} = {}) {
  // Echo command capture uses Web Speech as the fast path and falls back to
  // MediaRecorder transcription only when live recognition produced no usable
  // text. Manual voice/note flows keep the conservative final-transcribe path.
  const canUseLiveTranscript = Boolean(!forceTranscribe
    && preferLiveTranscript
    && voiceRecognitionProducedText
    && commandInput.value.trim()
    && !voiceLocalFallbackActive);
  const shouldTranscribe = !discard
    && !canUseLiveTranscript
    && (forceTranscribe || voiceLocalFallbackActive || !voiceRecognitionProducedText || selectedVoiceLanguage() === "auto");
  voiceManualStopPending = true;
  if (voiceLocalFallbackActive || shouldTranscribe) {
    setVoiceRecording(false);
    const stopped = stopVoiceLocalRecorder({ transcribe: shouldTranscribe, streamingFirstFrameTimeoutMs }).finally(() => {
      voiceManualStopPending = false;
    });
    return stopped;
  }
  if (voiceRecognizer && voiceRecording) {
    try { voiceRecognizer.stop(); } catch { /* ignore */ }
  }
  const stopped = stopVoiceLocalRecorder({ transcribe: false }).finally(() => {
    voiceManualStopPending = false;
  });
  setVoiceRecording(false);
  return stopped;
}

function openVoicePanel({ autoStart = false } = {}) {
  setPanelOpen(schedulePanel, false);
  enterVoiceMode();
  if (typeof renderVoiceChips === "function") renderVoiceChips();
  if (autoStart && !noteActive) {
    void startVoiceRecognition().catch((err) => {
      console.error("[voice] autoStart failed:", err);
    });
  }
}

function closeVoicePanel({ submit = false } = {}) {
  if (submit && echoSessionActive) {
    void submitEchoVoiceCommand();
    return;
  }
  if (voiceRecording) stopVoiceRecognition();
  exitVoiceMode();
  if (submit) {
    void handleUserSend().finally(() => endEchoSession());
  } else {
    commandInput.focus();
    void endEchoSession();
  }
}

voiceToggleBtn?.addEventListener("click", () => {
  if (noteActive) {
    void overlayShellClient.hideWindow("overlay");
    return;
  }
  if (voiceRecording) stopVoiceRecognition({ discard: true });
  void enterNoteMode();
});

voiceMinimizeBtn?.addEventListener("click", () => {
  void overlayShellClient.hideWindow("overlay");
});

/* ─── Voice-card drag & drop ──────────────────────────────────────────────
   Attach files/images without leaving the voice panel. Dropped paths go into
   pendingFileSelection, which handleUserSend() already routes through the
   file-submission pipeline alongside the spoken/typed command. */

const voiceChipsEl = document.querySelector("#voiceChips");

function renderVoiceChips() {
  if (!voiceChipsEl) return;
  const paths = pendingFileSelection?.filePaths ?? [];
  voiceChipsEl.innerHTML = "";
  for (const filePath of paths) {
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    const chip = document.createElement("span");
    chip.className = "voice-chip";
    chip.setAttribute("role", "listitem");

    const nameSpan = document.createElement("span");
    nameSpan.className = "chip-name";
    nameSpan.textContent = name;
    nameSpan.title = filePath;
    chip.appendChild(nameSpan);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "chip-dismiss";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", `移除 ${name}`);
    dismiss.addEventListener("click", () => {
      if (!pendingFileSelection?.filePaths) return;
      pendingFileSelection.filePaths = pendingFileSelection.filePaths.filter((fp) => fp !== filePath);
      if (pendingFileSelection.filePaths.length === 0) pendingFileSelection = null;
      renderVoiceChips();
    });
    chip.appendChild(dismiss);

    voiceChipsEl.appendChild(chip);
  }
}

function attachDroppedFilesToVoice(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;
  const existing = new Set(pendingFileSelection?.filePaths ?? []);
  for (const fp of filePaths) existing.add(fp);
  pendingFileSelection = {
    sourceApp: pendingFileSelection?.sourceApp ?? "uca.overlay",
    captureMode: pendingFileSelection?.captureMode ?? "drag_drop",
    filePaths: [...existing]
  };
  renderVoiceChips();
}

function hasFilePayload(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

if (voiceCard) {
  let voiceDragDepth = 0;

  const setDrag = (active) => {
    voiceCard.classList.toggle("dragover", active);
  };

  voiceCard.addEventListener("dragenter", (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    voiceDragDepth += 1;
    setDrag(true);
  });
  voiceCard.addEventListener("dragover", (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDrag(true);
  });
  voiceCard.addEventListener("dragleave", (event) => {
    if (!hasFilePayload(event)) return;
    voiceDragDepth = Math.max(0, voiceDragDepth - 1);
    if (voiceDragDepth === 0) setDrag(false);
  });
  voiceCard.addEventListener("drop", async (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.stopPropagation(); // keep window-level drop handlers from also firing
    voiceDragDepth = 0;
    setDrag(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    const filePaths = (overlayShellClient?.resolveDroppedFilePaths?.(files) ?? [])
      .filter((fp) => typeof fp === "string" && fp.length > 0);
    if (filePaths.length === 0) return;
    attachDroppedFilesToVoice(filePaths);
  });
}

/* ═══════════════════════════════════════════════
   CONTEXT MENU on chat bubbles (right-click)
   ═══════════════════════════════════════════════ */

const overlayCtxMenu = document.querySelector("#overlayCtxMenu");

function closeOverlayCtxMenu() {
  if (!overlayCtxMenu) return;
  overlayCtxMenu.hidden = true;
  overlayCtxMenu.innerHTML = "";
}

function openOverlayCtxMenu(items, x, y) {
  if (!overlayCtxMenu) return;
  overlayCtxMenu.innerHTML = items.map((item) => {
    if (item.separator) return `<div class="ctx-sep" role="separator"></div>`;
    return `
      <button type="button" class="ctx-item" role="menuitem" data-act="${escapeHtml(item.id)}">
        <span class="ctx-glyph">${escapeHtml(item.glyph ?? "")}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `;
  }).join("");
  overlayCtxMenu.hidden = false;
  const rect = overlayCtxMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  overlayCtxMenu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  overlayCtxMenu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  for (const btn of overlayCtxMenu.querySelectorAll("[data-act]")) {
    btn.addEventListener("click", () => {
      const item = items.find((i) => i.id === btn.dataset.act);
      closeOverlayCtxMenu();
      try { item?.onClick?.(); } catch { /* surface via system bubble */ }
    });
  }
}

document.addEventListener("click", (event) => {
  if (overlayCtxMenu && !overlayCtxMenu.hidden && !overlayCtxMenu.contains(event.target)) {
    closeOverlayCtxMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && overlayCtxMenu && !overlayCtxMenu.hidden) {
    closeOverlayCtxMenu();
  }
});
window.addEventListener("blur", closeOverlayCtxMenu);
window.addEventListener("scroll", closeOverlayCtxMenu, true);

bubbleArea?.addEventListener("contextmenu", (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const bubble = target?.closest?.(".bubble.assistant, .bubble.user");
  if (!bubble) return;
  event.preventDefault();
  const isAssistant = bubble.classList.contains("assistant");
  // Pull text from the rendered bubble. For assistant, strip the action
  // row + timestamp by reading the dataset/raw content if present;
  // textContent is a fine fallback for plain replies.
  const text = bubble.dataset.rawText || bubble.textContent?.replace(/\s*[+＋]\s*Note\s*$/u, "").trim() || "";
  const taskId = bubble.dataset.taskId || null;
  const items = [
    { id: "copy", label: "复制", glyph: "⧉", onClick: async () => {
      try {
        if (overlayShellClient?.writeClipboardText) await overlayShellClient.writeClipboardText(text);
        else await navigator.clipboard?.writeText?.(text);
      } catch { /* ignore */ }
    }},
    { id: "quote", label: "引用并回复", glyph: "›", onClick: () => {
      const quoted = String(text).split("\n").map((line) => `> ${line}`).join("\n");
      const prefix = commandInput.value.trim() ? `${commandInput.value}\n\n` : "";
      commandInput.value = `${prefix}${quoted}\n\n`;
      autoSizeInput();
      commandInput.focus();
      commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
      // Surface the result — the input bar is small and the user just
      // came from clicking somewhere else, so the focus alone may not
      // register. Flash the composer outline briefly.
      try { commandInput.scrollIntoView({ behavior: "smooth", block: "end" }); } catch { /* ignore */ }
      commandInput.classList.add("composer-flash");
      setTimeout(() => commandInput.classList.remove("composer-flash"), 1200);
    }}
  ];
  if (isAssistant && taskId) {
    items.push({ separator: true });
    items.push({ id: "regen", label: "重新生成", glyph: "↻", onClick: () => {
      void regenerateTask(taskId, null);
    }});
  }
  openOverlayCtxMenu(items, event.clientX, event.clientY);
});

// Window-level drop zone for the overlay. Surfaces the same dashed
// shaded zone the console chat uses, so dragging a file anywhere in the
// overlay (outside voiceCard) gives clear "release to attach"
// feedback. voiceCard's listener calls stopPropagation, so this handler
// only fires when the drop lands on plain bubble-area / drag handle /
// composer area — exactly the case where the user wasn't aiming at
// voice mode.
(function wireOverlayDropZone() {
  const zone = document.querySelector("#overlayDropZone");
  if (!zone || !document.body) return;
  let counter = 0;
  document.body.addEventListener("dragenter", (event) => {
    if (!hasFilePayload(event)) return;
    counter += 1;
    zone.hidden = false;
  });
  document.body.addEventListener("dragleave", (event) => {
    if (!hasFilePayload(event)) return;
    counter -= 1;
    if (counter <= 0) { counter = 0; zone.hidden = true; }
  });
  document.body.addEventListener("dragover", (event) => {
    if (hasFilePayload(event)) event.preventDefault();
  });
  document.body.addEventListener("drop", (event) => {
    if (!hasFilePayload(event)) return;
    counter = 0;
    zone.hidden = true;
    // If the drop landed on voiceCard the region listener already
    // handled it (stopPropagation). When it reaches here the target is
    // somewhere else — route through the same attach pipeline so the
    // user sees a "Received N file(s)" bubble in chat.
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])];
    const filePaths = (overlayShellClient?.resolveDroppedFilePaths?.(files) ?? [])
      .filter((fp) => typeof fp === "string" && fp.length > 0);
    if (filePaths.length === 0) return;
    attachDroppedFilesToVoice(filePaths);
    showContextReceivedBubble();
    void maybeRevealOverlay({ markEngaged: true });
    commandInput?.focus?.();
  });
})();

voiceStartBtn?.addEventListener("click", () => {
  // startVoiceRecognition is async and handles its own errors (including
  // showing an actionable status message). Still wrap the .catch() here so
  // an unexpected synchronous throw from the reset path can't leave the
  // button disabled with no feedback.
  Promise.resolve()
    .then(() => startVoiceRecognition())
    .catch((error) => {
      console.error("[voice] unhandled start error:", error);
      voiceStatus.textContent = `启动语音失败：${error?.message ?? error}`;
      voiceCard?.classList.add("error");
      voiceCard?.classList.remove("idle", "starting");
      if (voiceStartBtn) voiceStartBtn.disabled = false;
      setVoiceRecording(false);
    });
});
voiceStopBtn?.addEventListener("click", () => stopVoiceRecognition());
voiceCancelBtn?.addEventListener("click", () => {
  if (voiceRecording) stopVoiceRecognition({ discard: true });
  commandInput.value = commandInput.dataset.voiceBase ?? "";
  delete commandInput.dataset.voiceBase;
  exitVoiceMode();
  void endEchoSession();
});

// Composer mic button — toggles the same recognizer the voice card uses,
// but stays in normal composer mode so dictation lands straight in the
// textarea. While a note is being recorded the recognizer is owned by note
// mode, so the mic button defers to the user opening the note panel.
function toggleComposerVoiceInput() {
  if (!composerMicBtn) return;
  if (noteActive) {
    showEchoHud({ text: "录音笔记进行中，请先结束笔记再使用语音输入", kind: "info", durationMs: 2000, throttleMs: 0 });
    return;
  }
  if (voiceRecording) {
    void stopVoiceRecognition();
    return;
  }
  composerMicBtn.classList.add("starting");
  Promise.resolve()
    .then(() => startVoiceRecognition())
    .catch((error) => {
      console.error("[voice] composer mic start failed:", error);
      composerMicBtn.classList.remove("starting", "recording");
      composerMicBtn.setAttribute("aria-pressed", "false");
      setVoiceRecording(false);
    })
    .finally(() => {
      composerMicBtn.classList.remove("starting");
    });
}

composerMicBtn?.addEventListener("click", toggleComposerVoiceInput);

// Global Esc + voice-mode Enter handling.
// Esc semantics by precedence:
//   1. note-recording mode  → close overlay (note keeps recording in bg)
//   2. voice mode           → exit voice (discard recording if any)
//   3. task running         → cancel the running task
//   4. otherwise            → dismiss the overlay
// Enter is only special in voice (submit-and-exit); in normal mode the
// commandInput keydown handler owns it.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (noteActive) {
      event.preventDefault();
      void overlayShellClient.hideWindow("overlay");
      return;
    }
    if (voiceMode) {
      event.preventDefault();
      if (voiceRecording) stopVoiceRecognition({ discard: true });
      commandInput.value = commandInput.dataset.voiceBase ?? "";
      delete commandInput.dataset.voiceBase;
      exitVoiceMode();
      void endEchoSession();
      return;
    }
    if (isTaskRunning()) {
      event.preventDefault();
      void cancelActiveTask();
      return;
    }
    event.preventDefault();
    requestOverlayDismiss();
    return;
  }
  if (voiceMode && !noteActive && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    closeVoicePanel({ submit: true });
  }
});

/* ═══════════════════════════════════════════════
   NOTE MODE — record mic + system audio, AI summarises
   ═══════════════════════════════════════════════ */

let noteActive = false;
let noteStartTime = null;
let noteTimerInterval = null;
let noteSessionId = 0;
let noteStoppingSessionId = null;
let noteTranscripts = []; // {time, text}[]
let noteMicRecognizer = null;
let noteMicMediaRecorder = null;
let noteMicAudioChunks = [];
let noteMicStream = null;
let noteMediaRecorder = null;
let noteSysAudioChunks = [];
let noteSysStream = null;
let noteSysCapturePromise = null;
let noteMicStopPromise = Promise.resolve();
let noteRecorderStopPromise = Promise.resolve();

// Hard cap to prevent unbounded memory growth from MediaRecorder chunks +
// transcript accumulation. 30 min covers most meetings; warn 5 min before.
const NOTE_MAX_DURATION_MS = 30 * 60 * 1000;
const NOTE_WARN_BEFORE_MS = 5 * 60 * 1000;
let noteAutoStopTriggered = false;
let noteWarnedNearLimit = false;
let noteSourceContext = null;
let noteSourceContextPromise = Promise.resolve(null);

function noteSessionCanAcceptRecorderChunk(sessionId) {
  if (sessionId === noteSessionId && noteActive) return true;
  return sessionId === noteStoppingSessionId;
}

function publishNoteRecordingState(extra = {}) {
  const elapsedMs = noteActive && noteStartTime ? Date.now() - noteStartTime : 0;
  const { active: _ignoredActive, ...safeExtra } = extra ?? {};
  void overlayShellClient?.setNoteRecordingState?.({
    elapsedMs,
    elapsed: formatNoteElapsed(elapsedMs),
    hasMicTranscript: noteTranscripts.length > 0,
    hasSystemAudio: noteSysAudioChunks.length > 0,
    ...safeExtra,
    active: noteActive
  });
}

function getNoteLanguageSelection() {
  return noteLangSelect?.value || "auto";
}

function getNoteMicRecognitionLanguage() {
  const selected = getNoteLanguageSelection();
  // Web Speech expects a concrete BCP-47 language tag; system-audio
  // transcription can use "auto", but mic recognition should use a locale.
  return selected === "auto" ? (navigator.language || "zh-CN") : selected;
}

function getNoteActiveWindow(sourceContext = null) {
  const activeWindow = sourceContext?.active_window ?? sourceContext?.activeWindow ?? null;
  if (!activeWindow) return null;
  const process = `${activeWindow.process ?? sourceContext?.source_app ?? ""}`.toLowerCase();
  const title = `${activeWindow.title ?? sourceContext?.title ?? ""}`.toLowerCase();
  const isShell = process.includes("electron")
    || process.includes("universal-context-agent")
    || process === "uca"
    || title === "uca"
    || title.includes("uca overlay")
    || title.includes("uca dock")
    || title.includes("universal context agent");
  return isShell ? null : activeWindow;
}

function getNoteSourceUrl(sourceContext = null) {
  const activeWindow = getNoteActiveWindow(sourceContext);
  return activeWindow?.url || sourceContext?.url || "";
}

function getNoteSourceTitle(sourceContext = null) {
  const activeWindow = getNoteActiveWindow(sourceContext);
  return activeWindow?.title || sourceContext?.title || "";
}

function formatNoteSourceContext(sourceContext = null) {
  const activeWindow = getNoteActiveWindow(sourceContext);
  if (!activeWindow) return "";

  const lines = [];
  const process = activeWindow.process || sourceContext?.source_app || "";
  const title = getNoteSourceTitle(sourceContext);
  const url = getNoteSourceUrl(sourceContext);
  const kind = activeWindow.detected_kind || activeWindow.detectedKind || "";
  const filePath = activeWindow.file_path || activeWindow.filePath || "";

  if (process) lines.push(`- 应用：${process}`);
  if (title) lines.push(`- 窗口标题：${title}`);
  if (url) lines.push(`- URL：${url}`);
  if (filePath) lines.push(`- 文件：${filePath}`);
  if (kind) lines.push(`- 来源类型：${kind}`);

  return lines.length ? lines.join("\n") : "";
}

function compactNoteContextText(value = "", maxLength = 1000) {
  const text = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function fetchRecentBrowserContextForNote(sourceContext = null) {
  const params = new URLSearchParams();
  const sourceUrl = getNoteSourceUrl(sourceContext);
  const sourceTitle = getNoteSourceTitle(sourceContext);
  if (!sourceUrl && !sourceTitle) return null;
  if (sourceUrl) params.set("url", sourceUrl);
  if (sourceTitle) params.set("title", sourceTitle);
  if (sourceUrl) params.set("require_url_match", "1");
  params.set("limit", "1");

  try {
    const payload = await timeoutWithFallback(
      fetchJson(`/browser/context/recent?${params.toString()}`),
      900,
      null
    );
    return payload?.contexts?.[0] ?? null;
  } catch {
    return null;
  }
}

function formatNoteBrowserContext(browserContext = null) {
  if (!browserContext) return "";
  const youtube = browserContext.metadata?.youtube ?? null;
  const lines = [];
  const url = youtube?.canonicalUrl || browserContext.url || "";
  const title = youtube?.title || browserContext.pageTitle || "";
  const channel = youtube?.channel || "";
  const platform = browserContext.metadata?.platform || youtube?.platform || "";
  const description = browserContext.metadata?.description || youtube?.description || "";
  const captions = youtube?.visibleCaptions || "";
  const pageText = browserContext.text || "";

  if (platform) lines.push(`- 平台：${platform}`);
  if (title) lines.push(`- 页面/视频标题：${title}`);
  if (channel) lines.push(`- 频道/作者：${channel}`);
  if (url) lines.push(`- URL：${url}`);
  if (browserContext.score != null) lines.push(`- 匹配分：${browserContext.score}`);

  const sections = [];
  if (lines.length) sections.push(lines.join("\n"));
  if (description) sections.push(`### 页面/视频描述\n${compactNoteContextText(description, 2000)}`);
  if (captions) sections.push(`### 当前可见字幕/转录面板片段\n${compactNoteContextText(captions, 2200)}`);
  if (pageText) sections.push(`### 页面可见文本片段\n${compactNoteContextText(pageText, 4000)}`);

  return sections.length ? sections.join("\n\n") : "";
}

function timeoutWithFallback(promise, ms, fallbackValue = null) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallbackValue),
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms))
  ]);
}

function captureNoteSourceContext(sessionId = noteSessionId) {
  const capturePromise = (async () => {
    try {
      const payload = await overlayShellClient?.getActiveWindowContext?.({
        includeSelection: false,
        excludeShellWindow: true,
        preferLastExternal: true,
        maxExternalAgeMs: NOTE_SOURCE_CONTEXT_MAX_AGE_MS,
        captureMode: "note_recording"
      });
      if (sessionId === noteSessionId) {
        noteSourceContext = payload ?? null;
      }
      return payload ?? null;
    } catch {
      return null;
    }
  })();
  noteSourceContextPromise = capturePromise;
  return capturePromise;
}

function appendNoteTranscript(text) {
  if (!text || !text.trim()) return;
  const elapsed = noteStartTime ? Date.now() - noteStartTime : 0;
  const time = formatNoteElapsed(elapsed);
  noteTranscripts.push({ time, text: text.trim() });
  publishNoteRecordingState({ hasMicTranscript: true });
  if (!noteTranscriptBox) return;
  const entry = document.createElement("div");
  entry.className = "note-transcript-entry";
  entry.innerHTML = `<span class="nt-time">${time}</span><span class="nt-channel">输入音频</span>${escapeHtml(text.trim())}`;
  noteTranscriptBox.appendChild(entry);
  noteTranscriptBox.scrollTop = noteTranscriptBox.scrollHeight;
}

function startNoteMicCapture(sessionId = noteSessionId) {
  const Ctor = getSpeechRecognitionCtor();

  // Always keep a local mic recording. Web Speech gives live transcript when
  // available, but Electron/Chromium can report network errors even while
  // getUserMedia works. The local recording is the reliable fallback.
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      if (!noteActive || sessionId !== noteSessionId) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      startNoteMicRecorder(stream, sessionId);
      if (Ctor) {
        _launchNoteMicRecognizer(Ctor, sessionId);
      }
    })
    .catch(() => {
      if (!noteActive || sessionId !== noteSessionId) return;
      // Mic denied — note still runs, just no mic transcript
      noteMicTag?.classList.add("unavailable");
    });
}

function startNoteMicRecorder(stream, sessionId = noteSessionId) {
  noteMicStream = stream;
  noteMicAudioChunks = [];
  if (typeof MediaRecorder === "undefined") return;
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  try {
    noteMicMediaRecorder = new MediaRecorder(stream, { mimeType });
    noteMicMediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        if (!noteSessionCanAcceptRecorderChunk(sessionId)) return;
        noteMicAudioChunks.push(event.data);
        publishNoteRecordingState({ hasMicTranscript: noteTranscripts.length > 0 });
      }
    });
    noteMicMediaRecorder.start(4000);
    noteMicTag?.classList.add("active");
  } catch {
    noteMicMediaRecorder = null;
  }
}

function _launchNoteMicRecognizer(Ctor, sessionId = noteSessionId) {
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.lang = getNoteMicRecognitionLanguage();

  rec.addEventListener("result", (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        appendNoteTranscript(event.results[i][0].transcript);
      }
    }
  });
  rec.addEventListener("end", () => {
    if (noteActive && sessionId === noteSessionId && noteMicRecognizer === rec) {
      try { rec.start(); } catch { /* restart silently */ }
    }
  });
  rec.addEventListener("error", () => {
    if (noteActive && sessionId === noteSessionId && noteMicRecognizer === rec) {
      setTimeout(() => {
        if (noteActive && sessionId === noteSessionId && noteMicRecognizer === rec) {
          try { rec.start(); } catch { /* ignore */ }
        }
      }, 500);
    }
  });

  try {
    rec.start();
    noteMicTag?.classList.add("active");
  } catch { /* ignore — note still captures system audio */ }
  noteMicRecognizer = rec;
}

async function startNoteSysCapture() {
  // Use Electron's desktopCapturer to get the primary screen source ID.
  // This avoids the getDisplayMedia screen-picker dialog entirely and
  // reliably captures WASAPI loopback (all system audio) on Windows.
  const sessionId = noteSessionId;
  const capturePromise = (async () => {
    const sourceId = await overlayShellClient?.getDesktopAudioSource?.();
    if (!noteActive || sessionId !== noteSessionId) return;
    if (!sourceId) {
      noteSysTag?.classList.add("unavailable");
      return;
    }

    // getUserMedia with chromeMediaSource: 'desktop' requires a video track;
    // we stop it immediately after getting the audio stream.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxWidth: 1,
          maxHeight: 1,
          maxFrameRate: 1
        }
      }
    });

    if (!noteActive || sessionId !== noteSessionId) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Drop the video track — we only need audio
    stream.getVideoTracks().forEach((t) => t.stop());

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      noteSysTag?.classList.add("unavailable");
      return;
    }

    noteSysStream = new MediaStream(audioTracks);
    noteSysAudioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    noteMediaRecorder = new MediaRecorder(noteSysStream, { mimeType });
    noteMediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data?.size > 0) {
        if (!noteSessionCanAcceptRecorderChunk(sessionId)) return;
        noteSysAudioChunks.push(e.data);
        publishNoteRecordingState({ hasSystemAudio: true });
      }
    });
    noteMediaRecorder.start(4000); // collect a chunk every 4 s
    noteSysTag?.classList.add("active");

    audioTracks[0].addEventListener("ended", () => {
      noteSysTag?.classList.remove("active");
      noteSysTag?.classList.add("unavailable");
    });
  })();
  noteSysCapturePromise = capturePromise;

  try {
    await capturePromise;
  } catch {
    // System audio unavailable — note mode continues with mic-only
    if (noteActive && sessionId === noteSessionId) noteSysTag?.classList.add("unavailable");
  } finally {
    if (noteSysCapturePromise === capturePromise) noteSysCapturePromise = null;
  }
}

async function enterNoteMode() {
  // Show the voice card in note mode
  voiceMode = true;
  noteActive = true;
  noteSessionId += 1;
  document.body.classList.add("voice-mode");
  setVoiceCardMode("note");
  voiceCard?.classList.remove("idle", "error");

  // Reset state
  noteTranscripts = [];
  noteMicAudioChunks = [];
  noteSysAudioChunks = [];
  noteSourceContext = null;
  noteSourceContextPromise = Promise.resolve(null);
  if (noteTranscriptBox) noteTranscriptBox.innerHTML = "";
  if (noteTimer) { noteTimer.textContent = "00:00"; noteTimer.classList.add("recording"); }
  noteMicTag?.classList.remove("active", "unavailable");
  noteSysTag?.classList.remove("active", "unavailable");

  noteStartTime = Date.now();
  noteAutoStopTriggered = false;
  noteWarnedNearLimit = false;
  publishNoteRecordingState();

  // Start mic transcription
  startNoteMicCapture(noteSessionId);

  // Try system audio (async, non-blocking)
  void startNoteSysCapture();

  // Capture current playback/source context without blocking recording.
  void captureNoteSourceContext(noteSessionId);

  // Start elapsed timer
  noteTimerInterval = setInterval(() => {
    const elapsedMs = Date.now() - noteStartTime;
    if (noteTimer) noteTimer.textContent = formatNoteElapsed(elapsedMs);
    publishNoteRecordingState();

    const remaining = NOTE_MAX_DURATION_MS - elapsedMs;
    if (remaining <= 0 && !noteAutoStopTriggered) {
      noteAutoStopTriggered = true;
      addSystemBubble("已达到单次录音上限（30 分钟），已自动停止并进入转录。如需更长，请分多次录制。");
      finishNote()
        .catch((error) => {
          console.error("[overlay] auto-stop finishNote failed:", error);
          addSystemBubble(`自动完成笔记失败：${error?.message ?? error}`);
        })
        .finally(() => endEchoSession());
    } else if (remaining <= NOTE_WARN_BEFORE_MS && !noteWarnedNearLimit) {
      noteWarnedNearLimit = true;
      const mins = Math.max(1, Math.ceil(remaining / 60000));
      addSystemBubble(`录音将在约 ${mins} 分钟后自动停止（30 分钟上限）。可随时点击「完成」结束。`);
    }
  }, 1000);
}

function waitForRecorderStop(recorder) {
  if (!recorder || recorder.state === "inactive") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      recorder.removeEventListener("stop", settle);
      recorder.removeEventListener("error", settle);
      clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = setTimeout(settle, 2500);
    recorder.addEventListener("stop", settle, { once: true });
    recorder.addEventListener("error", settle, { once: true });

    try { recorder.requestData(); } catch { /* ignore */ }
    try { recorder.stop(); } catch { settle(); }
  });
}

function stopNoteMicRecorder() {
  const recorder = noteMicMediaRecorder;
  noteMicMediaRecorder = null;
  const micStream = noteMicStream;
  noteMicStream = null;

  const stopped = waitForRecorderStop(recorder).finally(() => {
    micStream?.getTracks().forEach((track) => track.stop());
  });
  return stopped;
}

function waitForRecognizerStop(recognizer, { discardMic = true } = {}) {
  if (!recognizer) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      recognizer.removeEventListener("end", settle);
      recognizer.removeEventListener("error", settle);
      clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = setTimeout(settle, 1500);
    recognizer.addEventListener("end", settle, { once: true });
    recognizer.addEventListener("error", settle, { once: true });

    try {
      if (discardMic) recognizer.abort();
      else recognizer.stop();
    } catch { settle(); }
  });
}

function stopNoteCapture({ discardMic = true } = {}) {
  // Stop mic recognizer
  const recognizer = noteMicRecognizer;
  noteMicRecognizer = null;
  noteMicStopPromise = waitForRecognizerStop(recognizer, { discardMic });
  const micRecorderStopPromise = stopNoteMicRecorder();
  // Stop system audio recorder
  const recorder = noteMediaRecorder;
  noteMediaRecorder = null;
  // Stop sys audio tracks
  const sysStream = noteSysStream;
  noteSysStream = null;
  noteRecorderStopPromise = waitForRecorderStop(recorder).finally(() => {
    sysStream?.getTracks().forEach((t) => t.stop());
  });
  // Stop timer
  clearInterval(noteTimerInterval);
  noteTimerInterval = null;
  if (noteTimer) noteTimer.classList.remove("recording");
  return Promise.all([noteMicStopPromise, micRecorderStopPromise, noteRecorderStopPromise]);
}

function exitNoteMode(options = {}) {
  const stoppingSessionId = noteSessionId;
  noteActive = false;
  noteStoppingSessionId = stoppingSessionId;
  voiceMode = false;
  document.body.classList.remove("voice-mode");
  setVoiceCardMode("voice");
  const stopped = stopNoteCapture(options).finally(() => {
    if (noteStoppingSessionId === stoppingSessionId) noteStoppingSessionId = null;
    if (noteSessionId === stoppingSessionId) noteSessionId += 1;
  });
  publishNoteRecordingState({ active: false, elapsedMs: 0, elapsed: "00:00" });
  return stopped;
}

async function transcribeAudioBlob(blob, { lang = "auto" } = {}) {
  if (typeof overlayShellClient?.transcribeNoteAudio !== "function") {
    throw new Error("Desktop note transcription bridge unavailable.");
  }
  const payload = await overlayShellClient.transcribeNoteAudio({
    audio: await blob.arrayBuffer(),
    mimeType: blob.type || "audio/webm",
    lang: lang || "auto",
    outputLocale: transcriptionOutputLocale()
  });
  if (payload?.ok === false && payload?.error) {
    throw new Error(payload.message ?? payload.error ?? "/note/transcribe");
  }
  return payload;
}

// SSE-consuming variant of transcribeAudioBlob: POSTs the audio to
// /note/transcribe?stream=1, parses `data: {...}\n\n` frames as the backend
// emits them, and calls appendVoiceTranscript for each decoded segment. This
// makes text appear progressively (one segment at a time) as faster-whisper
// decodes, instead of waiting for the whole blob to be transcribed.
// Resolves {ok: true, transcript} on a successful `done` event, or
// {ok: false} if the main-process bridge times out before the first frame or
// the server reports an error — the caller falls back to the non-streaming path.
async function transcribeAudioBlobStreaming(blob, { lang = "auto", firstFrameTimeoutMs = 30_000 } = {}) {
  const requestedTimeoutMs = Number(firstFrameTimeoutMs);
  const boundedFirstFrameTimeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1000, Math.min(30_000, Math.trunc(requestedTimeoutMs)))
    : 30_000;
  if (typeof overlayShellClient?.transcribeNoteAudioStreaming !== "function") {
    console.warn("[voice] stream transcribe bridge unavailable");
    return { ok: false };
  }
  let assembled = "";
  let finalTranscript = "";
  let gotAnyFrame = false;
  let sawError = false;
  try {
    const result = await overlayShellClient.transcribeNoteAudioStreaming({
      audio: await blob.arrayBuffer(),
      mimeType: blob.type || "audio/webm",
      lang: lang || "auto",
      outputLocale: transcriptionOutputLocale(),
      firstFrameTimeoutMs: boundedFirstFrameTimeoutMs
    }, (event) => {
        if (!gotAnyFrame) {
          gotAnyFrame = true;
        }
        if (event.type === "segment" && event.text) {
          assembled += (assembled ? "\n" : "") + event.text;
          appendVoiceTranscript(event.text);
          voiceStatus.textContent = "🎙 转写中…";
        } else if (event.type === "done") {
          finalTranscript = `${event.transcript ?? assembled}`.trim();
        } else if (event.type === "error") {
          console.warn("[voice] stream transcribe error frame:", event);
          sawError = true;
        }
    });
    if (result?.transcript && !finalTranscript) {
      finalTranscript = `${result.transcript}`.trim();
    }
    if (result?.ok === false) {
      sawError = true;
    }
  } catch (err) {
    console.warn("[voice] stream transcribe request failed:", err);
    return { ok: false };
  }
  if (!gotAnyFrame || sawError) return { ok: false };
  return { ok: true, transcript: finalTranscript || assembled };
}

async function transcribeSysAudio() {
  if (noteSysAudioChunks.length === 0) return { transcript: "", reason: "no_audio", ok: true };
  try {
    const blob = new Blob(noteSysAudioChunks, { type: "audio/webm" });
    const resp = await transcribeAudioBlob(blob, {
      lang: getNoteLanguageSelection()
    });
    return {
      transcript: resp.transcript ?? "",
      reason: resp.reason ?? null,
      ok: resp.ok !== false,
      message: resp.message ?? "",
      detail: resp.detail ?? "",
      activeProvider: resp.activeProvider ?? null,
      provider: resp.provider ?? null
    };
  } catch (error) {
    return {
      transcript: "",
      reason: "request_failed",
      ok: false,
      detail: error?.message ?? ""
    };
  }
}

async function submitNoteTask({ fullTranscript, duration, sourceContext }) {
  const sourceContextText = formatNoteSourceContext(sourceContext);
  const browserContext = await fetchRecentBrowserContextForNote(sourceContext);
  const browserContextText = formatNoteBrowserContext(browserContext);
  const sourceUrl = getNoteSourceUrl(sourceContext);
  const sourceTitle = getNoteSourceTitle(sourceContext);
  const browserUrl = browserContext?.metadata?.youtube?.canonicalUrl || browserContext?.url || "";
  const browserTitle = browserContext?.metadata?.youtube?.title || browserContext?.pageTitle || "";
  const activeWindow = getNoteActiveWindow(sourceContext);
  const sourceAssistRequirement = sourceContextText || browserContextText
    ? "- 如果“录音来源”包含网页 URL 或窗口标题，可以用它辅助判断上下文并在笔记中注明来源；不要主动联网检索，除非用户另行要求"
    : "- 不要编造录音中没有的事实";
  const userVisibleCommand = "整理这段录音为结构化笔记（Markdown）";
  const noteFormattingRequirement = `## 整理要求
1. **标题**：用一行概括本次录音的核心主题
2. **概述**：2-4 句话总结录音主要内容
3. **要点**：提炼 3-8 个核心观点或信息，用 bullet list，保持原文语言风格
4. **结论 / 决定**：如有明确结论或决定，单独列出
5. **行动项**：如有待办事项或下一步行动，用 checkbox 列出（- [ ] ...）
6. **来源**：如有 URL 或标题，注明”来源：...”

规则：
- 直接输出 Markdown 正文，不要说”已整理”或”以下是笔记”
- 忠实于录音内容，不要添加录音中没有的信息
- 保持原文语言（说中文就输出中文，说英文就输出英文）
${sourceAssistRequirement}`;
  const contextText = [
    sourceContextText ? `## 录音来源（自动检测）\n${sourceContextText}` : "",
    browserContextText ? `## 网页/视频上下文（浏览器扩展）\n${browserContextText}` : "",
    `## 录音时长\n${duration}`,
    noteFormattingRequirement,
    `## 录音转写\n${fullTranscript.trim()}`
  ].filter(Boolean).join("\n\n");

  const userCommand = userVisibleCommand;

  addBubble("user", userVisibleCommand);
  conversationState = null;
  if (projectStore) projectStore.currentConversationId = null;
  saveProjectStore();
  ensureConversation(null, userVisibleCommand);
  appendTurn("user", userVisibleCommand);
  markUserEngaged();

  // Show the raw transcript so the user can verify what was captured.
  // Truncate to 1200 chars for display; the full text still goes to the AI.
  const transcriptPreview = fullTranscript.trim();
  if (transcriptPreview) {
    const MAX = 1200;
    const truncated = transcriptPreview.length > MAX
      ? `${transcriptPreview.slice(0, MAX)}\n…（共 ${transcriptPreview.length} 字符）`
      : transcriptPreview;
    addSystemBubble(`📋 转录原文（供核对）\n\n${truncated}`);
  }

  // Update the existing particle spinner label (started in finishNote)
  if (timelineLabelEl) timelineLabelEl.textContent = "正在整理录音笔记…";

  const payload = {
    contextPacket: {
      source_type: "audio_note",
      source_app: "uca.note",
      capture_mode: "note_recording",
      text: contextText,
      url: sourceUrl || browserUrl || undefined,
      pageTitle: sourceTitle || browserTitle || undefined,
      selection_metadata: {
        audio_duration: duration,
        active_window: activeWindow ?? null,
        browser_context: browserContext ?? null
      }
    },
    userCommand,
    executionMode: "interactive",
    background: true,
    skipDecomposition: true
  };

  try {
    const taskBody = attachOverlayProjectScope(attachOverlaySubmissionMetadata(payload));
    const result = await overlaySubmissionClient.submitTask(taskBody);

    if (result.type === "clarification_needed") {
      showClarificationBubble(userVisibleCommand, result.question, taskBody);
      return;
    }

    activeTaskId = result.task.task_id;
    lastTask = result.task;
    if (echoSessionActive || isEchoOriginTask(result.task)) rememberEchoTask(activeTaskId);
    notifiedTaskId = null;
    notifiedInlineResultTaskId = null;
    lastArtifactPreview = "";
    bindTaskToConversation(activeTaskId);
    ensureActiveTaskEventStream(activeTaskId);
    clearPendingInputContext();

    addBubble("assistant", "Processing in background...");
    if (shouldSurfaceTaskPopupCards()) {
      void overlayShellClient.notify?.({
        title: "LingxY processing",
        body: "录音笔记正在整理。",
        taskId: activeTaskId
      })?.catch?.(() => {});
    }
    conversationPhase = "idle";
  } catch (error) {
    addBubble("assistant", `Submit failed: ${error.message}`);
    conversationPhase = "idle";
  }
}

async function finishNote() {
  if (noteFinishInFlight && !noteActive) return;
  if (!noteActive) return;
  const ownsNoteFinishFlag = !noteFinishInFlight;
  noteFinishInFlight = true;
  const sourceContextSnapshot = noteSourceContext;
  const sourceContextPromise = noteSourceContextPromise;

  try {
    // Show the particle spinner immediately — it stays visible through the
    // whole transcription + AI submission pipeline.
    timelineEnsure();
    timelineLabelEl && (timelineLabelEl.textContent = "正在转录音频…");

    // Stop gracefully so pending Web Speech finals and MediaRecorder chunks flush.
    const stopped = exitNoteMode({ discardMic: false });
    await stopped;
    await noteMicStopPromise;
    await noteRecorderStopPromise;
    publishNoteRecordingState({ active: false, elapsedMs: 0, elapsed: "00:00" });

    // Build mic transcript. Prefer live Web Speech text when it exists; if
    // Electron's recognition service failed, transcribe the local mic recording.
    let micLines = noteTranscripts.map((t) => `[${t.time}] ${t.text}`).join("\n");
    let micReason = null;
    let micDetail = "";
    if (!micLines.trim() && noteMicAudioChunks.length > 0) {
      try {
        addSystemBubble("正在本地转录输入音频（麦克风），请稍候...");
        const micBlob = new Blob(noteMicAudioChunks, { type: "audio/webm" });
        const micResult = await transcribeAudioBlob(micBlob, {
          lang: getNoteLanguageSelection()
        });
        const micText = `${micResult.transcript ?? ""}`.trim();
        if (micResult.ok === false) {
          micReason = micResult.reason ?? "mic_transcription_failed";
          micDetail = micResult.detail || micResult.message || "";
        } else if (micText) {
          micLines = `[00:00] ${micText}`;
          appendNoteTranscript(micText);
        }
      } catch (error) {
        micReason = "mic_transcription_failed";
        micDetail = error?.message ?? "";
      } finally {
        noteMicAudioChunks = [];
      }
    }

    // Optionally transcribe system audio
    let sysLines = "";
    let sysReason = null;
    let sysDetail = "";
    if (noteSysAudioChunks.length > 0) {
      addSystemBubble("正在转录输出音频（系统音频），请稍候...");
      const sysResult = await transcribeSysAudio();
      sysLines = sysResult.transcript ?? "";
      sysReason = sysResult.reason ?? null;
      sysDetail = sysResult.detail || sysResult.message || "";
    }

    const duration = noteStartTime ? formatNoteElapsed(Date.now() - noteStartTime) : "未知";
    const sourceContext = sourceContextSnapshot
      ?? await timeoutWithFallback(sourceContextPromise, 1200, null);

    if (!micLines.trim() && !sysLines.trim()) {
      if (micReason) {
        const detail = micDetail ? `\n原因：${micDetail.slice(0, 180)}` : "";
        addSystemBubble(`已录到输入音频（麦克风），但本地转写失败。${detail}`);
      } else if (noteSysAudioChunks.length > 0 && sysReason === "no_api_provider") {
        addSystemBubble("已录到输出音频（系统音频），但当前模型提供方不支持音频转写；请配置 OpenAI 音频转写 Key，或打开输入音频（麦克风）实时转写后再完成笔记。");
      } else if (noteSysAudioChunks.length > 0 && sysReason === "audio_provider_unsupported") {
        addSystemBubble("已录到输出音频（系统音频），但当前聊天模型不支持音频转写。你的 YouTube/网页音频捕获是成功的；请配置 OpenAI 音频转写 Key（UCA_TRANSCRIPTION_API_KEY 或 OPENAI_API_KEY），聊天仍可继续使用 DeepSeek。");
      } else if (noteSysAudioChunks.length > 0 && sysReason === "local_transcriber_missing") {
        addSystemBubble("已录到输出音频（系统音频），但本地转写依赖还没安装。运行：python -m pip install faster-whisper；安装后无需 OpenAI API，YouTube/网页音频会走本地 Whisper 转写。");
      } else if (noteSysAudioChunks.length > 0 && sysReason === "local_transcription_failed") {
        const detail = sysDetail ? `\n原因：${sysDetail.slice(0, 180)}` : "";
        addSystemBubble(`已录到输出音频（系统音频），但本地 Whisper 转写失败。${detail}`);
      } else if (noteSysAudioChunks.length > 0) {
        const detail = sysDetail ? `\n原因：${sysDetail.slice(0, 180)}` : "";
        addSystemBubble(`已录到输出音频（系统音频），但转写失败；请检查音频转写服务配置后再试。${detail}`);
      } else {
        addSystemBubble("笔记内容为空，请先开始录音并说话。");
      }
      return;
    }

    let fullTranscript = "";
    if (micLines.trim()) fullTranscript += `## 输入音频（麦克风 / 本机说话）\n${micLines}\n\n`;
    if (sysLines.trim()) fullTranscript += `## 输出音频（系统音频 / 扬声器播放）\n${sysLines}\n\n`;

    await submitNoteTask({ fullTranscript, duration, sourceContext });
  } finally {
    if (ownsNoteFinishFlag) noteFinishInFlight = false;
  }
}

// Tab buttons inside the voice card
tabVoiceBtn?.addEventListener("click", () => {
  if (noteActive) {
    addSystemBubble("正在录音笔记中。请先完成或取消录音，再切换到语音输入。");
    showNotePanel();
    return;
  }
  setVoiceCardMode("voice");
  if (!voiceMode) openVoicePanel({ autoStart: true });
});

tabNoteBtn?.addEventListener("click", () => {
  if (noteActive) {
    showNotePanel();
  } else {
    if (voiceRecording) stopVoiceRecognition();
    enterNoteMode();
  }
});


noteCancelBtn?.addEventListener("click", () => {
  exitNoteMode();
  commandInput.focus();
  void endEchoSession();
});

let noteFinishInFlight = false;
noteFinishBtn?.addEventListener("click", async () => {
  // Guard against double-click during the ~2s recorder-stop window. Also
  // surface any error — previously finishNote() errors were swallowed by the
  // async-without-catch pattern, making the click look unresponsive.
  if (noteFinishInFlight || !noteActive) return;
  noteFinishInFlight = true;
  const originalLabel = noteFinishBtn.textContent;
  noteFinishBtn.disabled = true;
  noteFinishBtn.textContent = "结束中…";
  try {
    await finishNote();
  } catch (error) {
    console.error("[overlay] finishNote failed:", error);
    addSystemBubble(`完成笔记失败：${error?.message ?? error}`);
  } finally {
    noteFinishInFlight = false;
    noteFinishBtn.disabled = false;
    noteFinishBtn.textContent = originalLabel || "完成笔记";
    void endEchoSession();
  }
});

/* ═══════════════════════════════════════════════
   SETTINGS BUTTON
   ═══════════════════════════════════════════════ */

settingsBtn?.addEventListener("click", async () => {
  try {
    if (overlayShellClient.navigateConsole) {
      await overlayShellClient.navigateConsole({ tabId: "settings" });
    } else {
      await overlayShellClient.showWindow("console");
    }
    addSystemBubble("已打开 Console 设置。");
  } catch (error) {
    addSystemBubble(`无法打开 Console：${error.message}`);
  }
});

/* ═══════════════════════════════════════════════
   TASK LIST DOCK
   ═══════════════════════════════════════════════ */

async function toggleTaskListPanel() {
  const isOpen = taskListPanel?.dataset.open === "true";
  const nextOpen = !isOpen;
  if (taskListPanel) taskListPanel.dataset.open = nextOpen ? "true" : "false";
  taskListDock?.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  await refreshTaskSummaries(true);
  renderTaskListDock();
}

taskListDock?.addEventListener("click", () => {
  void toggleTaskListPanel();
});

taskListDock?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
  event.preventDefault();
  void toggleTaskListPanel();
});

taskListCloseBtn?.addEventListener("click", () => {
  closeTaskListPanel();
});

function closeTaskListPanel() {
  if (taskListPanel) taskListPanel.dataset.open = "false";
  taskListDock?.setAttribute("aria-expanded", "false");
  taskListDock?.focus?.();
}

function activateTaskListFilter(btn) {
  taskListFilter = btn.dataset.taskFilter ?? "all";
  for (const sibling of taskListFilterBtns) {
    const isActive = sibling === btn;
    sibling.classList.toggle("active", isActive);
    sibling.setAttribute("aria-selected", isActive ? "true" : "false");
    sibling.tabIndex = isActive ? 0 : -1;
  }
  renderTaskListDock();
}

function handleTaskListFilterKeydown(event) {
  const key = event.key === "Left" ? "ArrowLeft"
    : event.key === "Right" ? "ArrowRight"
      : event.key;
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(key)) return;
  event.preventDefault();
  const buttons = [...taskListFilterBtns];
  const currentIndex = Math.max(0, buttons.indexOf(event.currentTarget));
  let nextIndex = currentIndex;
  if (key === "ArrowLeft") nextIndex = (currentIndex + buttons.length - 1) % buttons.length;
  if (key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
  if (key === "Home") nextIndex = 0;
  if (key === "End") nextIndex = buttons.length - 1;
  const next = buttons[nextIndex];
  if (!next) return;
  activateTaskListFilter(next);
  next.focus();
}

for (const btn of taskListFilterBtns) {
  btn.tabIndex = btn.classList.contains("active") ? 0 : -1;
  btn.addEventListener("click", () => activateTaskListFilter(btn));
  btn.addEventListener("keydown", handleTaskListFilterKeydown);
}

taskListPanel?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeTaskListPanel();
  }
});

/* ═══════════════════════════════════════════════
   SMART INTENT DETECTION
   ═══════════════════════════════════════════════ */

function detectSpecialIntent(text) {
  if (isDirectScheduleIntentText(text)) {
    return { type: "schedule", text };
  }

  // template detection
  const lower = text.toLowerCase();
  if (/(?:保存(?:为|成)?模板|记住这个流程|save\s+(?:as\s+)?template|create\s+template|保存这个(?:操作|流程|指令))/.test(lower)) {
    return { type: "template", text };
  }

  return null;
}

function isDirectScheduleIntentText(text = "") {
  if (!isScheduleIntentText(text)) return false;
  const trigger = parseScheduleTriggerFromText(text, { fallback: "natural_language" });
  const scheduledAction = buildScheduleActionFromText(text);

  // Keep the overlay fast path narrow: short one-shot reminders can be written
  // directly, while recurring/conditional/AI-work schedules stay in the
  // agentic path where create_scheduled_task and confirmations can reason over
  // the user's intent.
  return trigger?.type === "interval"
    && trigger.oneShot === true
    && scheduledAction.kind === "notify";
}

async function createScheduleFromText(userText, trigger = parseScheduleTriggerFromText(userText)) {
  const name = userText.slice(0, 40);
  const scheduledAction = buildScheduleActionFromText(userText);
  const result = await createScheduleViaShell({
    name,
    trigger,
    action: scheduledAction.action,
    executionMode: scheduledAction.executionMode,
    oneShot: Boolean(trigger.oneShot),
    title: "UCA 提醒",
    message: userText,
    userCommand: userText,
    category: "reminder",
    leadTimeMs: 0,
    userTodo: true
  });
  return result.schedule;
}

function showScheduleConfirmCard(userText) {
  const trigger = parseScheduleTriggerFromText(userText);
  const name = userText.slice(0, 40);

  const cardEl = document.createElement("div");
  cardEl.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  const title = document.createElement("strong");
  title.textContent = "Create scheduled task?";
  title.style.fontSize = "13px";

  const info = document.createElement("div");
  info.style.cssText = "font-size:12px;color:var(--muted);line-height:1.5;";
  const triggerLabel = trigger.label ?? trigger.expression ?? (trigger.seconds ? `每 ${trigger.seconds} 秒` : trigger.run_at ? new Date(trigger.run_at).toLocaleString("zh-CN", { hour12: false }) : "自定义");
  info.innerHTML = `<div>名称：${escapeHtml(name)}</div><div>时间：<code>${escapeHtml(triggerLabel)}</code></div><div>内容：${escapeHtml(userText.slice(0, 80))}</div>`;

  const actions = document.createElement("div");
  actions.className = "bubble-options";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "确认创建";
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "创建中…";
    try {
      const scheduledAction = buildScheduleActionFromText(userText);
      const result = await createScheduleViaShell({
        name,
        trigger,
        action: scheduledAction.action,
        executionMode: scheduledAction.executionMode,
        oneShot: Boolean(trigger.oneShot),
        title: "UCA 提醒",
        message: userText,
        userCommand: userText,
        category: "reminder",
        leadTimeMs: 0,
        userTodo: true
      });
      const schedule = result.schedule;
      const timeInfo = result.timeInfo;
      // UCA-062: Show Chinese confirmation with resolved time + relative duration
      let confirmMsg = `已设置提醒 ✓\n📝 ${name}`;
      if (timeInfo?.display) {
        confirmMsg += `\n📅 ${timeInfo.display}`;
        if (timeInfo.relativeLabel) confirmMsg += `（${timeInfo.relativeLabel}）`;
      } else if (schedule?.next_run_at) {
        const nextDate = new Date(schedule.next_run_at);
        confirmMsg += `\n📅 ${nextDate.toLocaleString("zh-CN", { hour12: false })}`;
      }
      addBubble("assistant", confirmMsg);
    } catch (error) {
      addBubble("assistant", `创建失败：${error.message}`);
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => {
    addSystemBubble("已取消创建提醒。");
  });

  const asTaskBtn = document.createElement("button");
  asTaskBtn.textContent = "仅执行一次";
  asTaskBtn.addEventListener("click", () => {
    commandInput.value = userText;
    void submitTask();
  });

  actions.append(confirmBtn, cancelBtn, asTaskBtn);
  cardEl.append(title, info, actions);
  addBubble("assistant", cardEl);
}

function showTemplateConfirmCard(userText) {
  const name = userText.replace(/保存(?:为|成)?模板|记住这个流程|save\s+(?:as\s+)?template|create\s+template|保存这个(?:操作|流程|指令)/gi, "").trim().slice(0, 40) || "Custom template";

  const cardEl = document.createElement("div");
  cardEl.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  const title = document.createElement("strong");
  title.textContent = "Save as template?";
  title.style.fontSize = "13px";

  const info = document.createElement("div");
  info.style.cssText = "font-size:12px;color:var(--muted);";
  info.textContent = `Template: "${name}"`;

  const actions = document.createElement("div");
  actions.className = "bubble-options";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Save";
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Saving...";
    try {
      const templateId = `user.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}`;
      await saveTemplateViaShell({
        schema_version: "1.0",
        id: templateId,
        name,
        version: "1.0.0",
        steps: [{ id: "draft", kind: "executor", target: "fast", inputs: { prompt: userText } }]
      });
      addBubble("assistant", `Template saved: "${name}"`);
    } catch (error) {
      addBubble("assistant", `Failed: ${error.message}`);
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => addSystemBubble("Cancelled."));

  actions.append(confirmBtn, cancelBtn);
  cardEl.append(title, info, actions);
  addBubble("assistant", cardEl);
}

let userSendInFlight = false;

function setSendBusy(busy) {
  userSendInFlight = busy;
  if (sendBtn) {
    sendBtn.disabled = busy;
    sendBtn.setAttribute("aria-busy", busy ? "true" : "false");
  }
  if (commandInput) {
    commandInput.removeAttribute("readonly");
  }
  document.body.classList.toggle("send-busy", busy);
  // Stop affordance must stay clickable even when userSendInFlight is true,
  // so let refreshSendBtnMode have the final say on disabled / label.
  refreshSendBtnMode();
}

// True when there is an active task that is still doing work — i.e. the
// user pressed send and the runtime hasn't reached a terminal state yet.
// Drives the Send-vs-Stop affordance on sendBtn and the Esc semantics.
function isTaskRunning() {
  return Boolean(
    activeTaskId
    && lastTask?.task_id === activeTaskId
    && taskIsActive(lastTask?.status)
  );
}

// Toggle sendBtn between "send", "stop", and "cancelling" affordances.
// Called whenever task status changes; cheap to run idempotently.
function refreshSendBtnMode() {
  if (!sendBtn) return;
  const running = isTaskRunning();
  // After a cancel was requested, sub_status flips to "cancelling".
  // Render that as a distinct state so the user knows their click
  // registered (and a second click will escalate to force cancel).
  const cancelling = running
    && (lastTask?.status === "cancelling" || lastTask?.sub_status === "cancelling"
        || cancellationRequestedTaskId === activeTaskId);
  sendBtn.classList.toggle("send-btn--stop", running && !cancelling);
  sendBtn.classList.toggle("send-btn--cancelling", Boolean(cancelling));
  if (cancelling) {
    sendBtn.title = "再次点击强制取消";
    sendBtn.setAttribute("aria-label", "正在取消任务，再次点击强制取消");
    sendBtn.disabled = false;
  } else if (running) {
    sendBtn.title = "停止任务 (Esc)";
    sendBtn.setAttribute("aria-label", "停止当前任务");
    sendBtn.disabled = false;
  } else {
    sendBtn.title = "发送 (Enter)";
    sendBtn.setAttribute("aria-label", "发送指令");
  }
}

// Track which task we already asked to cancel so the second click on
// the stop button can escalate to a force cancel. Without this, users
// who repeatedly click stop on an executor that doesn't honour cancel
// signals get the same polite request each time and the task drags on.
let cancellationRequestedTaskId = null;

async function cancelActiveTask({ silent = false } = {}) {
  if (!activeTaskId) return false;
  const taskId = activeTaskId;
  const force = cancellationRequestedTaskId === taskId;
  cancellationRequestedTaskId = taskId;
  try {
    await cancelTaskViaShell(taskId, { force });
    if (!silent) {
      addSystemBubble(force
        ? "强制取消已发出。任务状态已置为已取消。"
        : "已请求取消任务。如长时间未响应，请再次点击停止以强制取消。");
    }
    return true;
  } catch (error) {
    if (!silent) addSystemBubble(`取消任务失败：${error?.message ?? error}`);
    return false;
  }
}

// Centralise the overlay-dismiss flow so closeBtn, Esc, and the main-
// process auto-hide path all do the same cleanup (stop voice, fold any
// inline panels, mark phase idle, ask the shell to hide the window).
function requestOverlayDismiss() {
  if (voiceRecording) stopVoiceRecognition();
  closeAllPanels();
  conversationPhase = "idle";
  suppressOverlayAutoReveal = true;
  void overlayShellClient.hideWindow("overlay");
}

async function submitComposerInput() {
  if (userSendInFlight) return;
  if (voiceRecording && !voiceMode && !noteActive) {
    voiceStatus.textContent = "正在转写并发送...";
    showEchoHud({ text: "正在转写并发送...", kind: "info", durationMs: 1800, throttleMs: 0 });
    const result = await stopVoiceRecognition();
    const transcript = `${result?.transcript ?? ""}`.trim();
    if (transcript && !commandInput.value.trim()) {
      commandInput.value = transcript;
      autoSizeInput();
      if (voiceTranscript) {
        voiceTranscript.classList.remove("placeholder");
        voiceTranscript.textContent = transcript;
        voiceTranscript.scrollTop = voiceTranscript.scrollHeight;
      }
    }
  }
  await handleUserSend();
}

async function handleUserSend() {
  // Guard only the short submit handshake. The task itself runs in the
  // runtime background so the composer stays available for another request.
  if (userSendInFlight) return;

  const text = commandInput.value.trim();
  if (!text && !pendingFileSelection?.filePaths?.length && !pendingCapture?.capture) return;

  setSendBusy(true);
  try {
    // UCA-062: Check for special intents (schedule, template) BEFORE submitting
    // so they go through the fast confirmation path instead of the AI pipeline.
    if (text) {
      const specialIntent = detectSpecialIntent(text);
      if (specialIntent?.type === "schedule") {
        addBubble("user", text);
        appendTurn("user", text);
        commandInput.value = "";
        autoSizeInput();
        showScheduleConfirmCard(text);
        return;
      }
      if (specialIntent?.type === "template") {
        addBubble("user", text);
        appendTurn("user", text);
        commandInput.value = "";
        autoSizeInput();
        showTemplateConfirmCard(text);
        return;
      }
      if (isRetryCommand(text)) {
        addBubble("user", text);
        appendTurn("user", text);
        commandInput.value = "";
        autoSizeInput();
        await retryActiveTaskFromOverlay();
        return;
      }
    }

    // F2: normal task submission. Optimistic UI bubble + cache push +
    // pending registration are handled inside submitTask via
    // markPendingUserMessage — adding them here would double-render.
    if (text) {
      ensureConversation(null, conversationState?.seedCommand ?? text);
    }

    await submitTask();
  } finally {
    setSendBusy(false);
  }
}

/* ═══════════════════════════════════════════════
   SHELL EVENTS
   ═══════════════════════════════════════════════ */

overlayShellClient.onShortcutTriggered((payload) => {
  overlayShortcutSmokeEvents.push({
    shortcutId: payload?.shortcutId ?? null,
    accelerator: payload?.accelerator ?? null,
    ts: Date.now()
  });
  if (overlayShortcutSmokeEvents.length > 20) overlayShortcutSmokeEvents.splice(0, overlayShortcutSmokeEvents.length - 20);
  if (payload.shortcutId === "toggle-overlay") {
    // Hotkey-summoned overlay should always open a fresh conversation so the
    // user never sees stale bubbles / replayed failure events from a prior
    // task. refreshActiveTask runs on a 2s timer and would otherwise replay
    // the previous task's timeline into the new UI.
    startNewConversation();
  }
  if (payload.shortcutId === "capture-and-ask") {
    beginShortcutCaptureSession(payload.shortcutId);
  }
  if (payload.shortcutId === "capture-screenshot") {
    beginShortcutCaptureSession(payload.shortcutId);
  }
  if (payload.shortcutId === "voice-wake") {
    if (!payload.preserveContext) {
      startNewConversation();
    }
    if (!payload.preserveContext) {
      void captureActiveWindowHintForVoice({ captureMode: "voice_wake" });
    }
    if (payload.autoStart !== false) {
      toggleComposerVoiceInput();
    }
  }
  if (payload.shortcutId === "note-wake") {
    // Match voice-wake semantics (fresh conversation) then jump straight into
    // dual-channel note recording — mic transcript + system audio capture.
    startNewConversation();
    if (voiceRecording) stopVoiceRecognition();
    void captureActiveWindowHintForVoice({ captureMode: "note_wake" });
    void enterNoteMode();
  }
});

overlayShellClient.onShellReady((payload) => {
  if (payload.windowId === "overlay") {
    serviceBaseUrl = payload.serviceBaseUrl ?? serviceBaseUrl;
    refreshStatus();
    void syncProjectStoreFromService({ render: false });
    refreshTaskSummaries(true).then(renderTaskListDock);
    void reconcilePendingApprovalPopups();
    showWelcome();
  }
});

// When an approval is resolved from the floating popup card, the overlay's
// inline twin (if any) is stale — mark it handled so the user doesn't
// double-approve. We disable its buttons and overlay a status chip.
overlayShellClient?.onPopupCardResolved?.(async (payload) => {
  if (!payload) return;

  // UCA-182 Phase 8: success-kind cards carry artifact actions. These
  // replace the old result-toast buttons.
  if (["preview", "reveal", "copy", "continue", "voice_continue", "open_overlay"].includes(payload.action)) {
    const meta = payload.meta ?? {};
    const action = payload.action;
    if (action === "open_overlay") {
      void maybeRevealOverlay({ markEngaged: true });
      const taskId = meta.taskId ?? payload.taskId;
      if (taskId) {
        const opened = await openTaskResultInOverlayConversation(taskId, meta);
        if (!opened) switchActiveTask(taskId);
        return;
      }
      const title = meta.title ?? payload.title ?? "任务结果";
      const text = meta.inlinePreview
        || (Array.isArray(meta.lines) ? meta.lines.join("\n") : "")
        || "";
      if (text) {
        ensureConversation(null, title);
        addBubble("assistant", `**${title}**\n\n${text}`);
        appendTurn("assistant", `${title}\n\n${text}`);
      }
      if (meta.artifactPath) {
        addBubble("assistant", `文件：${meta.artifactPath}`);
      }
      return;
    }
    if (action === "preview" && meta.artifactPath) {
      if (!window.livePreview?.openForFile?.({ filePath: meta.artifactPath, mime: meta.mime })) {
        void overlayShellClient?.openPath?.(meta.artifactPath);
      }
    } else if (action === "reveal" && meta.artifactPath) {
      try { overlayShellClient?.showItemInFolder?.(meta.artifactPath); } catch { /* ignore */ }
    } else if (action === "copy") {
      const text = meta.inlinePreview || meta.artifactPath || "";
      if (text) void overlayShellClient?.writeClipboardText?.(text);
    } else if (action === "voice_continue") {
      const taskId = meta.taskId ?? payload.taskId;
      if (taskId) {
        rememberEchoTask(taskId);
        pendingContinuationTaskId = taskId;
        pendingContinuationConversationId = meta.conversationId ?? payload.conversationId ?? null;
      }
      await beginEchoSession();
      showEchoHud({ text: "继续追问，请直接说；Enter 立即发送", kind: "wake", durationMs: 9000, throttleMs: 0 });
      if (!voiceRecording) {
        toggleComposerVoiceInput();
      }
    } else if (action === "continue") {
      const taskId = meta.taskId ?? payload.taskId;
      if (taskId) {
        pendingContinuationTaskId = taskId;
        pendingContinuationConversationId = meta.conversationId ?? payload.conversationId ?? null;
      }
      commandInput?.focus?.();
      void maybeRevealOverlay?.();
    }
    return;
  }

  if (payload.kind === "error" && payload.action === "view_log") {
    const tid = payload.meta?.taskId ?? payload.taskId;
    if (tid) {
      void overlayShellClient?.navigateConsole?.({ tab: "tasks", taskId: tid });
    }
    return;
  }

  if (payload.kind !== "approval") return;
  const approvalId = payload.approvalId;
  if (!approvalId) return;
  approvalPopupCardIds.delete(approvalId);
  const inline = renderedApprovalCards.get(approvalId);
  if (!inline) return;
  inline.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = "0.55";
    btn.style.cursor = "default";
  });
  let chip = inline.querySelector(".popup-resolved-chip");
  if (!chip) {
    chip = document.createElement("div");
    chip.className = "popup-resolved-chip";
    chip.style.cssText = [
      "margin-top:8px",
      "font-size:12px",
      "color:var(--ok)",
      "background:var(--ok-soft)",
      "border:1px solid var(--line)",
      "padding:4px 10px",
      "border-radius:6px",
      "display:inline-block"
    ].join(";");
    inline.appendChild(chip);
  }
  chip.textContent = payload.action === "approve"
    ? "已通过（悬浮卡片处理）"
    : payload.action === "reject"
      ? "已拒绝（悬浮卡片处理）"
      : "已处理（悬浮卡片）";
});

/* ═══════════════════════════════════════════════
   ECHO MODE handoff — dock detects wake word, overlay takes over
   ═══════════════════════════════════════════════ */

async function beginEchoSession() {
  if (echoSessionActive) return;
  clearEchoVoiceAutoSubmit();
  echoSessionActive = true;
  echoSessionId = createEchoSessionId();
  echoHudLastText = "";
  echoHudLastAt = 0;
  echoCommandStartedAt = Date.now();
  echoCommandLastSpeechAt = 0;
  armEchoCommandHardLimit();
  try { await overlayShellClient?.registerCtrlEnter?.("echo-session"); }
  catch (err) { console.warn("[echo] register Ctrl+Enter failed:", err); }
}
async function endEchoSession() {
  if (!echoSessionActive) return;
  clearEchoVoiceAutoSubmit();
  echoSessionActive = false;
  echoSessionId = null;
  echoHudLastText = "";
  echoHudLastAt = 0;
  echoCommandStartedAt = 0;
  echoCommandLastSpeechAt = 0;
  try { await overlayShellClient?.unregisterCtrlEnter?.(); }
  catch { /* ignore */ }
}

overlayShellClient?.onEchoWake?.(async (payload = {}) => {
  const kind = payload.kind === "note" ? "note" : "voice";
  // The wake word means the user is about to speak again — interrupt any
  // in-flight TTS so the assistant's reply does not talk over the user.
  // Best-effort: the route returns immediately; OS audio buffer may still
  // play a short tail, which is the documented behaviour.
  void postEchoSpeakCancel();
  const hasPendingInputContext = Boolean(pendingFileSelection?.filePaths?.length || pendingCapture?.capture);
  const preservePendingInputContext = Boolean(payload.preserveContext || hasPendingInputContext);

  // 30s continuation window: if the user's previous echo task finished
  // recently AND we still know which conversation it belonged to, this
  // wake is treated as a follow-up — keep the current conversation,
  // skip captureActiveWindowHint (we already have context), and surface
  // a "继续上一任务" HUD so the user knows the difference between a
  // fresh wake and a follow-up. Note thread (kind === "note") is excluded
  // because note recordings always open a fresh transcript surface.
  const continuationAgeMs = lastEchoTaskCompletedAt > 0
    ? Date.now() - lastEchoTaskCompletedAt
    : Infinity;
  const inEchoContinuationWindow = kind === "voice"
    && continuationAgeMs < ECHO_CONTINUATION_WINDOW_MS
    && Boolean(lastEchoTaskConversationId);

  if (!payload.preserveContext && !inEchoContinuationWindow) {
    startNewConversation({ preservePendingInputContext });
  } else if (inEchoContinuationWindow) {
    // Carry the conversation forward without touching message history. The
    // submitOverlayTask path (line ~4055) only reads pendingContinuationConversationId
    // when pendingContinuationTaskId is also set, so seed BOTH so the next
    // /task POST attaches parent_task_id + conversation_id and the LLM
    // sees the prior turn.
    if (lastEchoTaskId) pendingContinuationTaskId = lastEchoTaskId;
    pendingContinuationConversationId = lastEchoTaskConversationId;
  }

  await beginEchoSession();
  if (!payload.preserveContext && !hasPendingInputContext && !inEchoContinuationWindow) {
    // Skip active-window hint capture during a follow-up — the context
    // the user wants is the LAST task's conversation, not whatever app
    // they happen to have foreground right now.
    void captureActiveWindowHintForVoice({ captureMode: kind === "note" ? "echo_note_wake" : "echo_voice_wake" });
  }
  if (kind === "note") {
    showEchoHud({ text: "开始录音笔记…", kind: "wake", durationMs: 1800, throttleMs: 0 });
    if (voiceRecording) stopVoiceRecognition();
    void enterNoteMode();
  } else if (inEchoContinuationWindow) {
    const remainingSec = Math.max(1, Math.round((ECHO_CONTINUATION_WINDOW_MS - continuationAgeMs) / 1000));
    showEchoHud({
      text: `🔁 继续上一任务（${remainingSec}s 内）`,
      kind: "wake",
      durationMs: 1800,
      throttleMs: 0
    });
    openVoicePanel({ autoStart: true });
  } else {
    showEchoHud({ text: "已唤醒，请说", kind: "wake", durationMs: 1800, throttleMs: 0 });
    openVoicePanel({ autoStart: true });
  }
});

// Session-scoped Ctrl+Enter: global shortcut in main forwards here. In voice
// mode it runs the same submit path as Enter; in note mode it finishes the
// note (same as clicking 完成笔记). Either way, the session ends afterward.
overlayShellClient?.onCtrlEnter?.(() => {
  if (!echoSessionActive) return;
  if (noteActive || noteFinishInFlight) {
    void finishNote().finally(() => endEchoSession());
  } else if (voiceMode || voiceRecording) {
    void submitEchoVoiceCommand();
  } else {
    void endEchoSession();
  }
});

// Main process notifies the overlay when the user has clicked outside
// the application entirely. Run the same dismiss flow as the X button so
// voice recording stops and inline panels fold before the window hides.
overlayShellClient.onOverlayAutoHide?.(() => {
  // Recheck the focus contract on the renderer side too — if a sibling
  // window (popup-card, preview, etc.) raced past the main-process check
  // between the blur event and the deferred sample, we don't want to
  // auto-dismiss while the user is acting on a confirmation card.
  if (document.hasFocus()) return;
  requestOverlayDismiss();
});

overlayShellClient.onWindowFocused((payload) => {
  if (payload.windowId === "overlay") {
    suppressOverlayAutoReveal = false;
    syncOverlayTheme(); // pick up any theme change made in the console
    // Sync project store but DO NOT re-render if the conversation is already
    // visible — renderConversationState() calls clearBubbles() which would
    // wipe the artifact file-buttons bubble (it lives in DOM only, not in turns).
    void syncProjectStoreFromService({ render: false });
    // Each time the user re-summons the overlay, start in "ephemeral" mode.
    // The first interaction with the input box will switch it to "kept" mode.
    popKeptOpen = false;
    document.body.classList.remove("popping");
    void attachLatestActiveTaskToOverlay();
    if (noteActive) {
      showNotePanel();
      return;
    }
    if (bubbleArea.children.length === 0) {
      // Don't auto-restore an old conversation on plain focus — a hotkey
      // summons should feel like a fresh overlay. Only keep an in-flight
      // task's bubbles visible (that branch lives in attachLatestActiveTaskToOverlay).
      showWelcome();
    }
  }
});

overlayShellClient.onContextReceived((payload) => {
  if (payload.targetWindow === "overlay" || payload.source_app === "explorer.exe" || payload.capture) {
    applyShellHandoff(payload);
  }
});

/* ── init ── */
restoreConversation();
// Never auto-render a stored conversation at init: the overlay is a summoned
// ephemeral surface, and stale task-failure bubbles from a previous session
// were making users think a new task was failing. If a task is still in-flight
// the 2s refreshActiveTask + attachLatestActiveTaskToOverlay will surface it.
showWelcome();
refreshStatus();
void syncProjectStoreFromService({ render: false });
void reconcilePendingApprovalPopups();
setInterval(refreshActiveTask, 2000);
setInterval(reconcilePendingApprovalPopups, 6000);

// Promote chat-bubble timestamps from "刚刚" → "1 分钟前" → … without
// re-rendering the message. Cheap; only walks visible <time> nodes.
function refreshChatTimestamps() {
  if (!bubbleArea) return;
  for (const el of bubbleArea.querySelectorAll(".bubble-time[data-ts]")) {
    const ts = Number(el.dataset.ts);
    if (!Number.isFinite(ts)) continue;
    const next = formatRelativeTime(ts);
    if (el.textContent !== next) el.textContent = next;
  }
}
setInterval(refreshChatTimestamps, 30_000);
