import {
  applyTaskEventPatch,
  formatTaskEventSummary,
  subscribeTaskEvents,
  toTaskEventFrame
} from "./task-event-stream.js";
import {
  buildScheduleActionFromText,
  isScheduleIntentText,
  parseScheduleTriggerFromText
} from "./schedule-parser.js";

/* ── DOM refs ── */
const bubbleArea = document.querySelector("#bubbleArea");
const commandInput = document.querySelector("#commandInput");
const sendBtn = document.querySelector("#sendBtn");
const closeBtn = document.querySelector("#closeBtn");
const clipboardBtn = document.querySelector("#clipboardBtn");
const resultToast = document.querySelector("#resultToast");
const toastTitle = document.querySelector("#toastTitle");
const toastBody = document.querySelector("#toastBody");
const toastOpenBtn = document.querySelector("#toastOpenBtn");
const toastCopyBtn = document.querySelector("#toastCopyBtn");
const toastContinueBtn = document.querySelector("#toastContinueBtn");
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
const settingsBtn = document.querySelector("#settingsBtn");
const newSessionBtn = document.querySelector("#newSessionBtn");
const popBubble = document.querySelector("#popBubble");
const popLabel = document.querySelector("#popLabel");
const popBody = document.querySelector("#popBody");
const popOpenBtn = document.querySelector("#popOpenBtn");
const popCopyBtn = document.querySelector("#popCopyBtn");

/* ── state ── */
let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";
let activeTaskId = null;
let lastTask = null;
let pendingFileSelection = null;
let pendingCapture = null;
let lastArtifactPath = null;
let autoOpenedArtifactTaskId = null;
let notifiedTaskId = null;
let selectedOutputSuffix = "";
let selectedFormatInstruction = "";
let lastArtifactPreview = "";
let lastArtifacts = [];
let activeTaskEventStream = null;
let activeTaskEventTaskId = null;
let activeTaskEventBaseUrl = null;
let handledTaskEventIds = new Set();

/* ── conversational state ── */
let conversationPhase = "idle"; // idle | awaiting_options | running | done
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
const CONVERSATION_STORAGE_KEY = "uca.overlay.conversation.v1";
const COMPRESS_TURN_LIMIT = 12;      // start compressing when more than this
const COMPRESS_KEEP_START = 2;       // keep the first N turns verbatim
const COMPRESS_KEEP_END = 6;         // keep the last N turns verbatim
const MAX_CAPTURE_TEXT_CHARS = 8000; // hard cap when building the prompt

let conversationState = null; // { id, seedCapture, seedCommand, turns, startedAt, updatedAt }

function newConversationId() {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureConversation(seedCapture = null, seedCommand = null) {
  if (!conversationState) {
    conversationState = {
      id: newConversationId(),
      seedCapture: seedCapture ? { ...seedCapture } : null,
      seedCommand: seedCommand ?? null,
      turns: [],
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
  } else {
    if (!conversationState.seedCapture && seedCapture) {
      conversationState.seedCapture = { ...seedCapture };
    }
    if (!conversationState.seedCommand && seedCommand) {
      conversationState.seedCommand = seedCommand;
    }
  }
  return conversationState;
}

function appendTurn(role, content) {
  if (!content || typeof content !== "string") return;
  ensureConversation();
  conversationState.turns.push({ role, content, ts: Date.now() });
  conversationState.updatedAt = Date.now();
  compressIfNeeded();
  persistConversation();
}

function compressIfNeeded() {
  if (!conversationState || conversationState.turns.length <= COMPRESS_TURN_LIMIT) return;
  const turns = conversationState.turns;
  const keepStart = turns.slice(0, COMPRESS_KEEP_START);
  const keepEnd = turns.slice(-COMPRESS_KEEP_END);
  const dropped = turns.length - keepStart.length - keepEnd.length;
  if (dropped <= 0) return;
  const placeholder = {
    role: "system",
    content: `[…压缩了 ${dropped} 轮早先的对话以节省上下文…]`,
    ts: Date.now(),
    compressed: true
  };
  conversationState.turns = [...keepStart, placeholder, ...keepEnd];
}

function persistConversation() {
  try {
    if (conversationState) {
      localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(conversationState));
    } else {
      localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    }
  } catch { /* quota or blocked */ }
}

function restoreConversation() {
  try {
    const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.turns)) {
      conversationState = parsed;
    }
  } catch { /* ignore */ }
}

function renderConversationState() {
  clearBubbles();
  if (!conversationState?.turns?.length) {
    showWelcome();
    return;
  }

  for (const turn of conversationState.turns) {
    const role = turn.role === "user" || turn.role === "assistant" || turn.role === "system"
      ? turn.role
      : "system";
    addBubble(role, turn.content);
  }
}

function startNewConversation() {
  closeActiveTaskEventStream();
  activeTaskId = null;
  lastTask = null;
  notifiedTaskId = null;
  lastArtifactPath = null;
  autoOpenedArtifactTaskId = null;
  lastArtifactPreview = "";
  lastArtifacts = [];
  selectedOutputSuffix = "";
  selectedFormatInstruction = "";
  conversationPhase = "idle";
  awaitingOptionType = null;
  conversationState = null;
  persistConversation();
  clearPendingInputContext();
  clearBubbles();
  commandInput.value = "";
  autoSizeInput();
  showWelcome();
  commandInput.focus();
}

function buildHistoryBlock(excludeLast = false) {
  if (!conversationState || conversationState.turns.length === 0) return "";
  const turns = excludeLast ? conversationState.turns.slice(0, -1) : conversationState.turns;
  if (turns.length === 0) return "";
  return turns.map((t) => {
    const label = t.role === "user" ? "用户" : t.role === "assistant" ? "助手" : "系统";
    return `${label}：${t.content}`;
  }).join("\n\n");
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

function addBubble(role, content, options) {
  bubbleArea.hidden = false;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;

  if (typeof content === "string") {
    bubble.textContent = content;
  } else {
    bubble.appendChild(content);
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
      const el = document.createElement("span");
      el.className = "context-chip";
      el.textContent = chip.label;
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

  bubbleArea.appendChild(bubble);
  bubbleArea.scrollTop = bubbleArea.scrollHeight;
  return bubble;
}

function addSystemBubble(text) {
  return addBubble("system", text);
}

function clearBubbles() {
  bubbleArea.innerHTML = "";
  bubbleArea.hidden = true;
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
      return { label: name, dismissable: false };
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
      const parts = [];
      if (appName) parts.push(`App: ${appName}`);
      if (filePath) parts.push(`File: ${filePath.split(/[/\\]/).pop()}`);
      if (selectedText) parts.push(`Selected: ${selectedText.slice(0, 100)}${selectedText.length > 100 ? "..." : ""}`);

      const chips = [];
      if (filePath) chips.push({ label: filePath.split(/[/\\]/).pop(), dismissable: false });

      addBubble("assistant",
        parts.length > 0
          ? `Captured from ${appName || "desktop"}:\n${parts.slice(1).join("\n")}\n\nWhat do you want me to do?`
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

let toastAutoHideTimer = null;

function showToast(title, body, artifactPath) {
  toastTitle.textContent = title;
  toastBody.textContent = body;
  resultToast.classList.add("visible");
  lastArtifactPath = artifactPath ?? null;

  clearTimeout(toastAutoHideTimer);
  toastAutoHideTimer = setTimeout(hideToast, 8000);
}

function hideToast() {
  resultToast.classList.remove("visible");
  clearTimeout(toastAutoHideTimer);
}

resultToast.addEventListener("mouseenter", () => clearTimeout(toastAutoHideTimer));
resultToast.addEventListener("mouseleave", () => {
  toastAutoHideTimer = setTimeout(hideToast, 4000);
});

toastOpenBtn.addEventListener("click", async () => {
  if (lastArtifactPath) await window.ucaShell.openPath(lastArtifactPath);
  hideToast();
});

toastCopyBtn.addEventListener("click", async () => {
  if (lastArtifactPreview) {
    await window.ucaShell.writeClipboardText(lastArtifactPreview);
  } else if (lastArtifactPath) {
    await window.ucaShell.writeClipboardText(lastArtifactPath);
  }
  hideToast();
});

toastContinueBtn.addEventListener("click", async () => {
  hideToast();
  if (lastArtifactPreview) {
    commandInput.value = "";
    addBubble("assistant", `Previous result loaded as context. What next?`);
    commandInput.focus();
    await window.ucaShell.showWindow("overlay");
  }
});

/* ═══════════════════════════════════════════════
   CORE TASK LOGIC (preserved from original)
   ═══════════════════════════════════════════════ */

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function closeActiveTaskEventStream() {
  activeTaskEventStream?.close?.();
  activeTaskEventStream = null;
  activeTaskEventTaskId = null;
  activeTaskEventBaseUrl = null;
  handledTaskEventIds = new Set();
}

async function handleTaskEventFrame(rawEvent) {
  const frame = toTaskEventFrame(rawEvent);
  if (frame.id && handledTaskEventIds.has(frame.id)) return;
  if (frame.id) handledTaskEventIds.add(frame.id);

  const summary = formatTaskEventSummary(frame);

  if (lastTask?.task_id === activeTaskId) {
    lastTask = applyTaskEventPatch(lastTask, frame);
  }

  if (frame.event === "step_started" || frame.event === "step_finished") {
    addSystemBubble(summary.body);
  }

  if (frame.event === "inline_result") {
    const text = frame.data?.text ?? frame.payload?.text ?? summary.body ?? "";
    if (text) {
      addBubble("assistant", text);
      lastArtifactPreview = text;
      // show the overlay so user sees the reply
      window.ucaShell.showWindow("overlay");
    }
  }

  if (frame.event === "artifact_created") {
    addBubble("assistant", `Artifact created: ${summary.body}`);
  }

  if (["success", "partial_success", "failed", "cancelled"].includes(frame.event)) {
    await refreshActiveTask();
  }
}

function ensureActiveTaskEventStream(taskId) {
  if (!taskId) { closeActiveTaskEventStream(); return; }
  if (activeTaskEventTaskId === taskId && activeTaskEventBaseUrl === serviceBaseUrl && activeTaskEventStream) return;

  closeActiveTaskEventStream();
  activeTaskEventTaskId = taskId;
  activeTaskEventBaseUrl = serviceBaseUrl;
  activeTaskEventStream = subscribeTaskEvents(serviceBaseUrl, taskId, {
    onEvent(event) { void handleTaskEventFrame(event); },
    onError(error) { addSystemBubble(`Connection lost: ${error.message}`); }
  });
}

function clearPendingInputContext() {
  pendingFileSelection = null;
  pendingCapture = null;
}

function normalisePreviewText(rawText = "") {
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatArtifactLabel(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  if (p.endsWith(".md"))   return "Markdown";
  if (p.endsWith(".txt"))  return "Text";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "HTML";
  if (p.endsWith(".json")) return "JSON";
  if (p.endsWith(".csv"))  return "CSV";
  if (p.endsWith(".docx")) return "Word";
  return "File";
}

function isPreviewableArtifactPath(artifactPath = "") {
  const p = `${artifactPath}`.toLowerCase();
  return [".md", ".txt", ".json", ".csv", ".html", ".htm"].some((ext) => p.endsWith(ext));
}

function choosePreviewArtifactPath(artifacts = []) {
  const exts = [".md", ".txt", ".json", ".csv", ".html", ".htm"];
  return artifacts.find((a) => exts.some((ext) => a.path?.toLowerCase().endsWith(ext)))?.path ?? null;
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
  const response = await fetch(`${serviceBaseUrl}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? pathname);
  return payload;
}

async function refreshStatus() {
  try {
    const shell = await window.ucaShell.getShellStatus();
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
  if (!activeTaskId) return;

  try {
    ensureActiveTaskEventStream(activeTaskId);
    const payload = await fetchJson(`/task/${activeTaskId}`);
    const task = {
      ...(payload.task ?? payload),
      artifacts: payload.artifacts ?? []
    };
    lastTask = task;
    lastArtifacts = task.artifacts;

    if (task.status === "success" && task.artifacts?.length) {
      const previewPath = choosePreviewArtifactPath(task.artifacts) ?? task.artifacts[0].path;
      lastArtifactPath = previewPath;

      let previewText = "";
      if (isPreviewableArtifactPath(previewPath)) {
        try {
          const rawText = await window.ucaShell.readTextFile(previewPath, 2400);
          previewText = normalisePreviewText(rawText).slice(0, 600);
          lastArtifactPreview = previewText;
        } catch { /* ignore */ }
      }

      if (notifiedTaskId !== task.task_id) {
        notifiedTaskId = task.task_id;
        const resultLabel = formatArtifactLabel(previewPath);
        const filename = previewPath.split(/[\\/]/).pop() || previewPath;
        // Record in conversation memory so later follow-ups can reference
        // "the file you generated" without the LLM losing the thread.
        const memorySnippet = previewText
          ? `生成了文件 ${filename}\n\n${previewText.slice(0, 600)}`
          : `生成了文件 ${filename}`;
        appendTurn("assistant", memorySnippet);
        // UCA-049: surface which provider actually ran this task + warn if
        // the planner had to downgrade an unsupported "已完成" claim.
        try {
          const detail = await fetchJson(`/task/${activeTaskId}`);
          appendProviderFooterBubble(extractTaskProviderInfo(detail.events ?? []));
        } catch { /* non-fatal — provider footer is informational */ }
        showToast(
          "Task complete",
          previewText || `Result: ${resultLabel} — ${previewPath}`,
          previewPath
        );

        // Conversation bubble: clickable file link + Preview / Open / Reveal options
        const bubbleEl = document.createElement("div");
        const headline = document.createElement("div");
        headline.textContent = `Done! 生成了文件 ${filename}`;
        bubbleEl.appendChild(headline);
        if (previewText) {
          const sub = document.createElement("div");
          sub.style.cssText = "margin-top:6px;font-size:12px;color:var(--muted);max-height:120px;overflow:auto;white-space:pre-wrap;";
          sub.textContent = previewText.slice(0, 400);
          bubbleEl.appendChild(sub);
        }
        addBubble("assistant", bubbleEl, {
          optionButtons: [
            { label: "打开文件", onClick: () => window.ucaShell.openPath(previewPath) },
            ...(isPreviewableArtifactPath(previewPath)
              ? [{ label: "预览", onClick: async () => {
                  try {
                    const raw = await window.ucaShell.readTextFile(previewPath, 6000);
                    addBubble("assistant", normalisePreviewText(raw).slice(0, 1500) || "(empty)");
                  } catch (err) {
                    addSystemBubble(`Cannot preview: ${err.message}`);
                  }
                } }]
              : []),
            { label: "复制路径", onClick: () => window.ucaShell.writeClipboardText(previewPath) }
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

        await window.ucaShell.notify({
          title: "UCA task complete",
          body: filename
        });
      }
      // Auto-open removed: previously the host file viewer would steal focus
      // every time a task finished. Users explicitly click the "打开文件"
      // button or the artifact in the Console Files tab.
    } else if (task.status === "success" && !task.artifacts?.length) {
      // conversational mode — no artifacts
      if (notifiedTaskId !== task.task_id) {
        notifiedTaskId = task.task_id;

        // try to find inline result from task events
        let inlineText = lastArtifactPreview;
        let providerInfo = { descriptor: null, downgraded: false };
        try {
          const detail = await fetchJson(`/task/${activeTaskId}`);
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

        const finalText = inlineText || "Done.";
        // Record the assistant turn in conversation memory so the next
        // follow-up (if any) sees it as context.
        if (finalText && finalText !== "Done.") {
          appendTurn("assistant", finalText);
        }
        if (popKeptOpen) {
          addBubble("assistant", finalText);
        } else {
          // Apple-style: show pop bubble, auto-hide after 3s unless user clicks
          showPopBubble({
            label: task.intent ?? "UCA",
            body: finalText,
            autoHideMs: 3000
          });
        }
        // UCA-049: provider footer + downgraded warning (system bubble)
        appendProviderFooterBubble(providerInfo);
        await window.ucaShell.notify({
          title: "UCA",
          body: finalText.slice(0, 100)
        });
      }
    } else if (task.status === "failed") {
      addBubble("assistant", `Task failed: ${task.failure_user_message ?? "Unknown error."}`);
    } else if (task.status === "cancelled") {
      addSystemBubble("Task cancelled.");
    }
  } catch (error) {
    addSystemBubble(`Refresh failed: ${error.message}`);
  }
}

/* ═══════════════════════════════════════════════
   SUBMIT
   ═══════════════════════════════════════════════ */

async function submitTask() {
  const rawCommand = commandInput.value.trim();
  if (!rawCommand && !pendingFileSelection?.filePaths?.length && !pendingCapture?.capture) return;

  // smart default command based on context type
  let defaultCommand = "Process the current context";
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
  addSystemBubble("Submitting...");
  commandInput.value = "";
  autoSizeInput();

  try {
    let payload;

    if (pendingFileSelection?.filePaths?.length) {
      const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
      const allImages = pendingFileSelection.filePaths.every((fp) =>
        imageExts.some((ext) => fp.toLowerCase().endsWith(ext))
      );
      payload = allImages ? {
        imagePaths: pendingFileSelection.filePaths,
        userCommand: commandText,
        source: "file",
        sourceApp: pendingFileSelection.sourceApp ?? "explorer.exe",
        captureMode: pendingFileSelection.captureMode ?? "shell_menu",
        executionMode: "interactive",
        executorOverride: "multi_modal"
      } : {
        sourceApp: pendingFileSelection.sourceApp ?? "explorer.exe",
        captureMode: pendingFileSelection.captureMode ?? "shell_menu",
        filePaths: pendingFileSelection.filePaths,
        userCommand: commandText,
        executionMode: "interactive",
        executorOverride: "kimi"
      };
    } else if (pendingCapture?.capture || conversationState?.seedCapture) {
      // Re-attach the conversation seed on every turn so multi-turn chats
      // against the same context keep working even after pendingCapture is
      // cleared. Conversation history (all prior turns) is folded into the
      // capture text so the LLM sees the whole thread.
      let capture;
      if (pendingCapture?.capture) {
        capture = { ...pendingCapture.capture };
      } else {
        capture = { ...conversationState.seedCapture };
      }

      // Inject rolling conversation history. We exclude the turn the user
      // is about to send — that one ships as `userCommand` so the executor
      // sees the fresh prompt clearly.
      const historyBlock = buildHistoryBlock(false);
      if (historyBlock) {
        const seedText = conversationState?.seedCapture?.text ?? capture.text ?? "";
        const seedSegment = seedText ? `原文：\n${seedText}` : "";
        const body = [seedSegment, `对话历史：\n${historyBlock}`].filter(Boolean).join("\n\n---\n\n");
        capture.text = body.slice(0, MAX_CAPTURE_TEXT_CHARS);
      }

      // only force kimi for file-heavy tasks; let router decide for text
      const needsKimi = capture.sourceType === "file" || (capture.filePath && !capture.text);
      const executorOverride = capture.sourceType === "image" ? "multi_modal"
        : needsKimi ? "kimi"
        : undefined; // let intent router decide (fast for simple, kimi for reports)
      payload = {
        userCommand: commandText,
        executionMode: "interactive",
        capture
      };
      if (executorOverride) payload.executorOverride = executorOverride;
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

    const result = await fetchJson("/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    activeTaskId = result.task.task_id;
    lastTask = result.task;
    ensureActiveTaskEventStream(activeTaskId);
    clearPendingInputContext();

    addBubble("assistant", "Processing in background...");

    await window.ucaShell.notify({
      title: "UCA processing",
      body: "Task submitted. You'll be notified when it's done."
    });

    conversationPhase = "running";

    // only auto-hide if the user explicitly requested file output
    if (selectedFormatInstruction) {
      setTimeout(() => {
        window.ucaShell.hideWindow("overlay");
      }, 600);
    }
  } catch (error) {
    addBubble("assistant", `Submit failed: ${error.message}`);
  }
}

/* ═══════════════════════════════════════════════
   SHELL HANDOFF (file drop, browser context)
   ═══════════════════════════════════════════════ */

function applyShellHandoff(payload) {
  if (payload?.file_paths?.length) {
    pendingCapture = null;
    pendingFileSelection = {
      sourceApp: payload.source_app ?? "explorer.exe",
      captureMode: payload.capture_mode ?? "shell_menu",
      filePaths: payload.file_paths ?? []
    };
    showContextReceivedBubble();
    commandInput.focus();
    return;
  }

  if (payload?.capture) {
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
    const clipText = (await window.ucaShell.readClipboardText()).trim();
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

function autoSizeInput() {
  commandInput.style.height = "auto";
  commandInput.style.height = Math.min(commandInput.scrollHeight, 96) + "px";
}

/* ═══════════════════════════════════════════════
   EVENT BINDINGS
   ═══════════════════════════════════════════════ */

commandInput.addEventListener("input", autoSizeInput);

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void handleUserSend();
  }
});

sendBtn.addEventListener("click", () => void handleUserSend());

closeBtn.addEventListener("click", () => {
  if (voiceRecording) stopVoiceRecognition();
  closeAllPanels();
  // Keep the visible transcript, pending context, and conversationState intact
  // so reopening resumes the same thread instead of showing an empty overlay.
  conversationPhase = "idle";
  window.ucaShell.hideWindow("overlay");
});

newSessionBtn?.addEventListener("click", () => {
  startNewConversation();
  addSystemBubble("已开启新会话 — 之前的上下文已清除。");
});

clipboardBtn.addEventListener("click", async () => {
  try {
    const clipText = (await window.ucaShell.readClipboardText()).trim();
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

async function runQuickAction(action) {
  const preset = QUICK_ACTION_PRESETS[action];
  if (!preset) return;

  const hasContext = Boolean(pendingCapture?.capture || pendingFileSelection?.filePaths?.length);

  if (!hasContext && preset.contextless?.autoLoadClipboard) {
    try {
      const clipText = (await window.ucaShell.readClipboardText()).trim();
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
  exitVoiceMode();
}

/* ═══════════════════════════════════════════════
   APPLE-STYLE VOICE MODE + AUTO-HIDE POP BUBBLE
   ═══════════════════════════════════════════════ */

let voiceMode = false;
let popHideTimer = null;
let popKeptOpen = false; // user clicked input → keep overlay until they explicitly close

function enterVoiceMode() {
  voiceMode = true;
  document.body.classList.add("voice-mode");
  voiceCard?.classList.add("idle");
  voiceCard?.classList.remove("error");
  if (voiceTranscript) voiceTranscript.textContent = "\u00a0";
  cancelPopHide();
}

function exitVoiceMode() {
  voiceMode = false;
  document.body.classList.remove("voice-mode");
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
          window.ucaShell.hideWindow("overlay");
        }
      }, 320);
    }
  }, ms);
}

function markUserEngaged() {
  popKeptOpen = true;
  document.body.classList.remove("popping");
  cancelPopHide();
  hidePopBubble();
}

// Any direct interaction with the input box keeps the overlay open
commandInput.addEventListener("focus", markUserEngaged);
commandInput.addEventListener("pointerdown", markUserEngaged);
bubbleArea?.addEventListener("pointerdown", markUserEngaged);

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
      await window.ucaShell.writeClipboardText(text);
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
  setPanelOpen(voicePanel, false);
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
  if (isPanelOpen(schedulePanel)) {
    setPanelOpen(schedulePanel, false);
  } else {
    openSchedulePanel();
  }
});

scheduleCancelBtn?.addEventListener("click", () => {
  setPanelOpen(schedulePanel, false);
});

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
  scheduleSaveBtn.disabled = true;
  scheduleSaveBtn.textContent = "创建中...";
  try {
    const result = await fetchJson("/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        createdBy: "overlay-form"
      })
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

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setVoiceRecording(active) {
  voiceRecording = active;
  if (active) {
    voiceCard?.classList.remove("idle", "error");
    voiceStatus.textContent = "正在聆听...";
    voiceToggleBtn?.classList.add("recording");
    if (voiceStartBtn) voiceStartBtn.disabled = true;
    if (voiceStopBtn) voiceStopBtn.disabled = false;
  } else {
    voiceCard?.classList.add("idle");
    voiceToggleBtn?.classList.remove("recording");
    if (voiceStartBtn) voiceStartBtn.disabled = false;
    if (voiceStopBtn) voiceStopBtn.disabled = false;
  }
}

function ensureVoiceRecognizer() {
  if (voiceRecognizer) return voiceRecognizer;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognizer = new Ctor();
  recognizer.continuous = false;
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
    // Mirror in the voice card transcript so the user sees what they're saying
    if (voiceTranscript) {
      voiceTranscript.textContent = merged.trim() || "\u00a0";
    }
    if (finalText) {
      commandInput.dataset.voiceBase = (commandInput.dataset.voiceBase ?? "") + finalText;
      voiceStatus.textContent = "识别完成 · 按 Enter 发送";
    } else if (interim) {
      voiceStatus.textContent = "听到中...";
    }
  });

  recognizer.addEventListener("end", () => {
    setVoiceRecording(false);
    if (!voiceStatus.textContent || voiceStatus.textContent.startsWith("正在聆听")) {
      voiceStatus.textContent = "已停止。可以再次开始或按 Enter 发送。";
    }
    delete commandInput.dataset.voiceBase;
    commandInput.focus();
  });

  recognizer.addEventListener("error", (event) => {
    setVoiceRecording(false);
    const code = event.error ?? "unknown";
    const friendly = {
      "not-allowed": "麦克风权限被拒绝。请重启 UCA 桌面端，并在系统设置中允许麦克风访问。",
      "service-not-allowed": "操作系统拒绝了语音识别服务。请检查系统设置 → 隐私 → 语音识别。",
      "no-speech": "没有检测到语音，请再试一次。",
      "audio-capture": "无法读取麦克风音频。请检查麦克风是否连接或被其他程序占用。",
      "network": "语音识别需要联网；请检查网络后重试。",
      "aborted": "语音输入已取消。"
    }[code] ?? `识别错误：${code}`;
    voiceStatus.textContent = friendly;
    voiceCard?.classList.add("error");
    voiceCard?.classList.remove("idle");
  });

  voiceRecognizer = recognizer;
  return recognizer;
}

function startVoiceRecognition() {
  const recognizer = ensureVoiceRecognizer();
  if (!recognizer) {
    voiceStatus.textContent = "当前 Electron/Chromium 不支持 Web Speech API。请改用键盘输入。";
    return;
  }
  if (voiceRecording) return;
  recognizer.lang = voiceLangSelect?.value || "zh-CN";
  commandInput.dataset.voiceBase = commandInput.value;
  try {
    recognizer.start();
    setVoiceRecording(true);
    voiceStatus.textContent = "正在聆听...";
  } catch (error) {
    const message = (error?.message ?? "").toLowerCase();
    if (message.includes("not-allowed") || message.includes("notallowederror")) {
      voiceStatus.textContent = "麦克风权限被拒绝。请重启 UCA 桌面端，并在系统设置中允许麦克风访问。";
      voiceCard?.classList.add("error");
      voiceCard?.classList.remove("idle");
    } else if (message.includes("invalidstate") && voiceRecognizer) {
      // already running — just keep going
      setVoiceRecording(true);
      voiceStatus.textContent = "正在聆听...";
      return;
    } else {
      voiceStatus.textContent = `无法启动识别：${error.message}`;
      voiceCard?.classList.add("error");
      voiceCard?.classList.remove("idle");
    }
    setVoiceRecording(false);
  }
}

function stopVoiceRecognition() {
  if (voiceRecognizer && voiceRecording) {
    try { voiceRecognizer.stop(); } catch { /* ignore */ }
  }
  setVoiceRecording(false);
}

function openVoicePanel({ autoStart = false } = {}) {
  setPanelOpen(schedulePanel, false);
  enterVoiceMode();
  if (autoStart) startVoiceRecognition();
}

function closeVoicePanel({ submit = false } = {}) {
  if (voiceRecording) stopVoiceRecognition();
  exitVoiceMode();
  if (submit) {
    void handleUserSend();
  } else {
    commandInput.focus();
  }
}

voiceToggleBtn?.addEventListener("click", () => {
  if (voiceMode) {
    closeVoicePanel({ submit: false });
  } else {
    openVoicePanel({ autoStart: true });
  }
});

voiceStartBtn?.addEventListener("click", () => startVoiceRecognition());
voiceStopBtn?.addEventListener("click", () => stopVoiceRecognition());
voiceCancelBtn?.addEventListener("click", () => {
  if (voiceRecording) stopVoiceRecognition();
  commandInput.value = commandInput.dataset.voiceBase ?? "";
  delete commandInput.dataset.voiceBase;
  exitVoiceMode();
});

// Enter while in voice mode → submit and exit
document.addEventListener("keydown", (event) => {
  if (!voiceMode) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    closeVoicePanel({ submit: true });
  } else if (event.key === "Escape") {
    if (voiceRecording) stopVoiceRecognition();
    commandInput.value = commandInput.dataset.voiceBase ?? "";
    delete commandInput.dataset.voiceBase;
    exitVoiceMode();
  }
});

/* ═══════════════════════════════════════════════
   SETTINGS BUTTON
   ═══════════════════════════════════════════════ */

settingsBtn?.addEventListener("click", async () => {
  try {
    if (window.ucaShell.navigateConsole) {
      await window.ucaShell.navigateConsole({ tabId: "settings" });
    } else {
      await window.ucaShell.showWindow("console");
    }
    addSystemBubble("已打开 Console 设置。");
  } catch (error) {
    addSystemBubble(`无法打开 Console：${error.message}`);
  }
});

/* ═══════════════════════════════════════════════
   SMART INTENT DETECTION
   ═══════════════════════════════════════════════ */

function detectSpecialIntent(text) {
  if (isScheduleIntentText(text)) {
    return { type: "schedule", text };
  }

  // template detection
  const lower = text.toLowerCase();
  if (/(?:保存(?:为|成)?模板|记住这个流程|save\s+(?:as\s+)?template|create\s+template|保存这个(?:操作|流程|指令))/.test(lower)) {
    return { type: "template", text };
  }

  return null;
}

async function createScheduleFromText(userText, trigger = parseScheduleTriggerFromText(userText)) {
  const name = userText.slice(0, 40);
  const scheduledAction = buildScheduleActionFromText(userText);
  const result = await fetchJson("/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      trigger,
      action: scheduledAction.action,
      executionMode: scheduledAction.executionMode,
      oneShot: Boolean(trigger.oneShot),
      title: "UCA 提醒",
      message: userText,
      userCommand: userText,
      createdBy: "overlay"
    })
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
  info.innerHTML = `<div>Name: ${name}</div><div>Schedule: <code>${trigger.label ?? trigger.expression ?? `${trigger.seconds}s`}</code></div><div>Command: ${userText.slice(0, 80)}</div>`;

  const actions = document.createElement("div");
  actions.className = "bubble-options";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm";
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Creating...";
    try {
      const schedule = await createScheduleFromText(userText, trigger);
      addBubble("assistant", `Schedule created: "${name}"\nNext: ${schedule?.next_run_at ?? "pending"}`);
    } catch (error) {
      addBubble("assistant", `Failed to create schedule: ${error.message}`);
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    addSystemBubble("Schedule creation cancelled.");
  });

  const asTaskBtn = document.createElement("button");
  asTaskBtn.textContent = "Run once instead";
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
      await fetchJson("/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: "overlay",
          template: {
            schema_version: "1.0",
            id: templateId,
            name,
            version: "1.0.0",
            steps: [{ id: "draft", kind: "executor", target: "fast", inputs: { prompt: userText } }]
          }
        })
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

async function handleUserSend() {
  const text = commandInput.value.trim();
  if (!text && !pendingFileSelection?.filePaths?.length && !pendingCapture?.capture) return;

  // smart intent detection — check before submitting as task
  if (text) {
    const intent = detectSpecialIntent(text);
    if (intent?.type === "schedule") {
      addBubble("user", text);
      commandInput.value = "";
      autoSizeInput();
      const trigger = parseScheduleTriggerFromText(text);
      if (trigger.oneShot) {
        addBubble("assistant", "Creating reminder...");
        try {
          const schedule = await createScheduleFromText(text, trigger);
          addBubble("assistant", `Reminder created.\nNext: ${schedule?.next_run_at ?? "pending"}`);
        } catch (error) {
          addBubble("assistant", `Failed to create reminder: ${error.message}`);
        }
        return;
      }
      showScheduleConfirmCard(text);
      return;
    }
    if (intent?.type === "template") {
      addBubble("user", text);
      commandInput.value = "";
      autoSizeInput();
      showTemplateConfirmCard(text);
      return;
    }
  }

  // normal task submission
  if (text && conversationPhase === "idle") {
    addBubble("user", text);
  }

  // Record the user's turn in persistent conversation memory. If no seed
  // capture has been attached yet, the current pendingCapture becomes it.
  if (text) {
    const seed = pendingCapture?.capture ?? conversationState?.seedCapture ?? null;
    ensureConversation(seed, conversationState?.seedCommand ?? text);
    appendTurn("user", text);
  }

  await submitTask();
}

/* ═══════════════════════════════════════════════
   SHELL EVENTS
   ═══════════════════════════════════════════════ */

window.ucaShell.onShortcutTriggered((payload) => {
  if (payload.shortcutId === "toggle-overlay") {
    showWelcome();
  }
  if (payload.shortcutId === "voice-wake") {
    showWelcome();
    openVoicePanel({ autoStart: true });
  }
});

window.ucaShell.onShellReady((payload) => {
  if (payload.windowId === "overlay") {
    serviceBaseUrl = payload.serviceBaseUrl ?? serviceBaseUrl;
    refreshStatus();
    showWelcome();
  }
});

window.ucaShell.onWindowFocused((payload) => {
  if (payload.windowId === "overlay") {
    // Each time the user re-summons the overlay, start in "ephemeral" mode.
    // The first interaction with the input box will switch it to "kept" mode.
    popKeptOpen = false;
    document.body.classList.remove("popping");
    if (bubbleArea.children.length === 0) {
      if (conversationState?.turns?.length) {
        renderConversationState();
      } else {
        showWelcome();
      }
    }
  }
});

window.ucaShell.onContextReceived((payload) => {
  if (payload.targetWindow === "overlay" || payload.source_app === "explorer.exe" || payload.capture) {
    applyShellHandoff(payload);
  }
});

/* ── init ── */
restoreConversation();
if (conversationState?.turns?.length) {
  renderConversationState();
} else {
  showWelcome();
}
refreshStatus();
setInterval(refreshActiveTask, 2000);
