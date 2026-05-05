// Side-panel chat — mirrors the popup chat flow but with more real estate
// and Chrome's sidePanel lifecycle so the conversation follows the user
// across tab switches within a browser window. Uses the same streaming
// port infrastructure introduced in UCA-166/167 (uca.chat.stream +
// uca.quickaction.stream). Stored history lives in chrome.storage.local
// under a dedicated key so it doesn't collide with the popup's session-
// scoped history.

import {
  buildRunModeView,
  renderRunModeDetail
} from "../shared/run-mode-view.js";

const HISTORY_KEY = "ucaSidePanelHistory";
const HISTORY_MAX = 40;
const PENDING_ANALYSIS_KEY = "ucaSidePanelPendingAnalysis";
const SYSTEM_PROMPT = [
  "You are LingxY, a helpful assistant in a browser side panel.",
  "The user is actively browsing the web and opens this panel to analyze pages, videos, and selections, then ask follow-up questions.",
  "Conversation continuity matters: when the user asks a short follow-up (e.g. '第 3 点展开', '反驳观点', '更短一点', '为什么'), assume they are referring to the most recent page/video/selection the user shared and your last answer. Reference that material concretely by name or section.",
  "Reply in the user's language (Chinese by default) and use Markdown lists / headings / code blocks when structure helps.",
  "Be concise by default; be thorough when the user explicitly asks you to analyze a whole page or video."
].join(" ");

const historyEl = document.getElementById("sp-history");
const inputEl = document.getElementById("sp-input");
const sendBtn = document.getElementById("sp-send");
const formEl = document.getElementById("sp-form");
const statusEl = document.getElementById("sp-status");
const modePillEl = document.getElementById("sp-mode-pill");
const modeDetailEl = document.getElementById("sp-mode-detail");
const optionsBtn = document.getElementById("sp-options-btn");
const actionClearBtn = document.getElementById("sp-action-clear");
const actionPageBtn = document.getElementById("sp-action-page");
const actionVideoBtn = document.getElementById("sp-action-video");
const actionSelectionBtn = document.getElementById("sp-action-selection");
const actionLocationBtn = document.getElementById("sp-action-location");

let conversation = [];
let activeStreamPort = null;
let isBusy = false;
let lastPendingRequestId = "";
// Timeline meta counter — assistant turns track their own sequence number
// so the UI can show "第 N 轮" and providers can see how many turns the
// conversation has been through.
let turnCounter = 0;

/* ── Markdown renderer (safe escape then minimal Markdown) ───────────── */
function renderMd(raw = "") {
  const escaped = String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Pull out fenced code blocks first so their interior isn't touched.
  const codeBlocks = [];
  const withoutFences = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, body) => {
    const i = codeBlocks.push({ lang, body }) - 1;
    return `\u0000CB_${i}\u0000`;
  });
  const inline = withoutFences
    .replace(/^###\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^##\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^#\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^(\d+)\.\s+(.+)$/gm, "<div class=\"sp-li\">$1. $2</div>")
    .replace(/^[-•*]\s+(.+)$/gm, "<div class=\"sp-li\">• $1</div>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
  return inline.replace(/\u0000CB_(\d+)\u0000/g, (_, i) => {
    const cb = codeBlocks[Number(i)];
    return `<pre><code>${cb.body}</code></pre>`;
  });
}

/* ── Storage ─────────────────────────────────────────────────────────── */
async function loadHistory() {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    conversation = Array.isArray(data?.[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  } catch {
    conversation = [];
  }
}
async function saveHistory() {
  const trimmed = conversation.slice(-HISTORY_MAX);
  try { await chrome.storage.local.set({ [HISTORY_KEY]: trimmed }); } catch { /* best effort */ }
}

/* ── Rendering ───────────────────────────────────────────────────────── */
function renderHistory() {
  historyEl.innerHTML = "";
  for (const turn of conversation) {
    appendTurnEl(turn);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
}
function appendTurnEl(turn) {
  // UCA-174: user turns that carry bulky auxiliary content (a full page body,
  // a transcript, a long selection) store the heavy text under
  // `turn.attached` and render just a compact "📄 分析此页：<title>" chip
  // in the dialog. The attached content is still sent to the LLM — it's
  // the VISUAL noise we're cutting. Click the chip to expand/collapse the
  // full attached text inline.
  if (turn.role === "user" && turn.attached && turn.displayLabel) {
    const wrapper = document.createElement("div");
    wrapper.className = "sp-msg user user-compact";
    const chip = document.createElement("div");
    chip.className = "sp-user-chip";
    chip.textContent = turn.displayLabel;
    const details = document.createElement("details");
    details.className = "sp-user-attached";
    const summary = document.createElement("summary");
    summary.textContent = `展开（${turn.attached.length.toLocaleString()} 字符）`;
    const pre = document.createElement("pre");
    pre.textContent = turn.attached.slice(0, 10_000);
    details.appendChild(summary);
    details.appendChild(pre);
    wrapper.appendChild(chip);
    wrapper.appendChild(details);
    historyEl.appendChild(wrapper);
    historyEl.scrollTop = historyEl.scrollHeight;
    return wrapper;
  }

  const el = document.createElement("div");
  el.className = `sp-msg ${turn.role === "user" ? "user"
    : turn.role === "error" ? "error"
    : turn.role === "system" ? "system"
    : "assistant"}`;
  if (turn.role === "assistant") {
    el.innerHTML = renderMd(turn.content ?? "");
    // UCA-175: timeline meta strip — shows provider/tokens/turn so user
    // can see what context the model had without inspecting the DOM.
    if (turn.meta) {
      const meta = document.createElement("div");
      meta.className = "sp-turn-meta";
      meta.textContent = turn.meta;
      el.appendChild(meta);
    }
  } else {
    el.textContent = turn.content ?? "";
  }
  historyEl.appendChild(el);
  historyEl.scrollTop = historyEl.scrollHeight;
  return el;
}

/* ── Mode indicator ─────────────────────────────────────────────────── */
async function refreshMode() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "uca.standalone.status" }, resolve);
    });
    const view = buildRunModeView(response ?? {});
    modePillEl.classList.remove("mode-desktop", "mode-standalone", "mode-offline");
    modePillEl.textContent = view.mode === "desktop" ? "桌面在线" : view.label.replace("独立模式", "独立");
    modePillEl.classList.add(`mode-${view.mode}`);
    renderRunModeDetail(modeDetailEl, view, document);
  } catch {
    const view = buildRunModeView({});
    modePillEl.textContent = "未配置";
    modePillEl.classList.add("mode-offline");
    renderRunModeDetail(modeDetailEl, view, document);
  }
}

/* ── Chat send (port-based streaming) ────────────────────────────────── */
function sendTurn({ userContent, systemContent = null, assistantPrefix = null, displayLabel = null, attached = null, maxTokens = null } = {}) {
  return new Promise((resolve) => {
    if (isBusy) { resolve({ ok: false, error: "busy" }); return; }
    isBusy = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;
    actionPageBtn.disabled = actionVideoBtn.disabled = actionSelectionBtn.disabled = true;
    statusEl.textContent = "连接中…";
    const startedAt = Date.now();

    if (systemContent) {
      conversation.push({ role: "system", content: systemContent });
      appendTurnEl({ role: "system", content: systemContent });
    }
    // Compact user turn: what LLM sees (`content` = userContent incl. attached)
    // vs what UI shows (`displayLabel` + collapsible `attached`).
    const userTurn = displayLabel
      ? { role: "user", content: userContent, displayLabel, attached: attached ?? "" }
      : { role: "user", content: userContent };
    conversation.push(userTurn);
    appendTurnEl(userTurn);

    // Create streaming bubble up front with optional prefix. CRITICAL:
    // push the streaming turn to `conversation` BEFORE settling so the
    // later `conversation[length-1] = ...` overwrites THIS placeholder,
    // not the user turn above. Without this, every assistant reply
    // clobbered the user's question and the next follow-up saw a history
    // of assistant-only turns — which is why follow-up understanding
    // felt unreliable.
    const streamingTurn = { role: "assistant", content: assistantPrefix ?? "" };
    conversation.push(streamingTurn);
    const streamingEl = appendTurnEl(streamingTurn);
    streamingEl.classList.add("streaming");

    let port;
    try {
      port = chrome.runtime.connect({ name: "uca.chat.stream" });
    } catch (error) {
      finishWithError(streamingEl, `连接失败：${error?.message ?? error}`);
      resolve({ ok: false });
      return;
    }
    activeStreamPort = port;
    let settled = false;
    let acc = "";

    const settle = async (role, content, responseMeta = null) => {
      if (settled) return;
      settled = true;
      activeStreamPort = null;
      streamingEl.classList.remove("streaming");
      if (role === "error") {
        streamingEl.classList.remove("assistant");
        streamingEl.classList.add("error");
        streamingEl.textContent = content;
        conversation[conversation.length - 1] = { role: "error", content };
      } else {
        // UCA-175: compute timeline meta — turn number, elapsed time,
        // approximate token count (content length ÷ 4 as a rough proxy),
        // the prior-turn context size.
        turnCounter += 1;
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
        const approxTokens = Math.max(1, Math.round((content ?? "").length / 3.5));
        const priorTurns = conversation.filter((t) => t.role === "user" || t.role === "assistant").length;
        const metaPieces = [
          `第 ${turnCounter} 轮`,
          `${elapsedSec}s`,
          `~${approxTokens.toLocaleString()} tokens`
        ];
        if (priorTurns > 2) metaPieces.push(`基于前 ${priorTurns - 1} 轮对话`);
        const metaText = metaPieces.join(" · ");
        streamingEl.innerHTML = renderMd(content);
        const metaEl = document.createElement("div");
        metaEl.className = "sp-turn-meta";
        metaEl.textContent = metaText;
        streamingEl.appendChild(metaEl);
        conversation[conversation.length - 1] = { role: "assistant", content, meta: metaText };
      }
      await saveHistory();
      sendBtn.disabled = false;
      inputEl.disabled = false;
      actionPageBtn.disabled = actionVideoBtn.disabled = actionSelectionBtn.disabled = false;
      statusEl.textContent = "";
      isBusy = false;
      try { port.disconnect(); } catch { /* ignore */ }
      resolve({ ok: role !== "error" });
    };

    // 83.4 — Thinking card buffer. Reasoning chunks (from Qwen3 thinking
    // mode, DeepSeek reasoner, etc.) arrive on a separate stream event
    // type and render into a folded <details> block above the answer body
    // so the user can see "the model is thinking" instead of staring at
    // an empty bubble.
    let reasoningAcc = "";
    let thinkingEl = null;
    function ensureThinkingBlock() {
      if (thinkingEl) return thinkingEl;
      const det = document.createElement("details");
      det.className = "sp-thinking";
      det.open = true; // open while streaming so the user sees progress
      det.innerHTML = `
        <summary class="sp-thinking-summary">
          <span class="sp-thinking-icon">🧠</span>
          <span class="sp-thinking-label">思考过程</span>
          <span class="sp-thinking-status">…</span>
        </summary>
        <div class="sp-thinking-body"></div>
      `;
      // Insert before the streaming content so thinking appears above the answer.
      streamingEl.parentNode.insertBefore(det, streamingEl);
      thinkingEl = det;
      return det;
    }

    port.onMessage.addListener((msg) => {
      if (msg?.type === "start") {
        statusEl.textContent = "生成中…";
      } else if (msg?.type === "reasoning_chunk") {
        reasoningAcc = typeof msg.full === "string" ? msg.full : (reasoningAcc + (msg.delta ?? ""));
        const det = ensureThinkingBlock();
        const body = det.querySelector(".sp-thinking-body");
        if (body) body.textContent = reasoningAcc;
        historyEl.scrollTop = historyEl.scrollHeight;
      } else if (msg?.type === "chunk") {
        acc = typeof msg.full === "string" ? msg.full : (acc + (msg.delta ?? ""));
        streamingEl.innerHTML = renderMd(acc);
        // First content chunk: collapse the thinking block — user has the
        // answer now, thinking becomes inspectable rather than primary.
        if (thinkingEl && thinkingEl.open) {
          thinkingEl.open = false;
          const status = thinkingEl.querySelector(".sp-thinking-status");
          if (status) status.textContent = `${reasoningAcc.length} chars`;
        }
        historyEl.scrollTop = historyEl.scrollHeight;
      } else if (msg?.type === "done") {
        const finalText = msg.text ?? acc;
        if (thinkingEl) {
          // Mark thinking complete; preserve in the saved turn meta so
          // re-rendering history still shows it.
          thinkingEl.open = false;
          const status = thinkingEl.querySelector(".sp-thinking-status");
          if (status) status.textContent = `${reasoningAcc.length} chars · 已完成`;
        }
        settle("assistant", finalText);
      } else if (msg?.type === "error") {
        settle("error", `失败：${msg.error ?? "unknown"}`);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!settled) {
        if (acc) settle("assistant", acc);
        else settle("error", "连接意外断开");
      }
    });

    // Send prior turns only (exclude the just-added user turn — SW
    // re-appends it — AND the empty streaming assistant placeholder).
    // Map each turn to { role, content } so we don't leak displayLabel /
    // attached / meta / turn-counter side fields into the LLM request.
    const sendableHistory = conversation
      .slice(0, -2) // drop user turn + streaming placeholder we just pushed
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => ({ role: t.role, content: String(t.content ?? "") }));
    port.postMessage({
      type: "chat",
      text: userContent,
      history: sendableHistory,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens
    });
  });
}

function finishWithError(el, msg) {
  el.classList.remove("streaming", "assistant");
  el.classList.add("error");
  el.textContent = msg;
  isBusy = false;
  sendBtn.disabled = false;
  inputEl.disabled = false;
  actionPageBtn.disabled = actionVideoBtn.disabled = actionSelectionBtn.disabled = false;
  statusEl.textContent = "";
}

function createCompactUserTurn({ displayLabel, attached = "" }) {
  return displayLabel
    ? { role: "user", content: displayLabel, displayLabel, attached }
    : { role: "user", content: attached || displayLabel || "" };
}

async function startFreshAnalysisThread() {
  conversation = [];
  turnCounter = 0;
  await saveHistory();
  renderHistory();
}

async function runQuickActionTurn({
  action,
  selectionState = {},
  displayLabel = "",
  attached = "",
  resetConversation = true,
  routePlan = null
} = {}) {
  return new Promise((resolve) => {
    if (isBusy) { resolve({ ok: false, error: "busy" }); return; }
    void (async () => {
      if (resetConversation) {
        await startFreshAnalysisThread();
      }
      isBusy = true;
      sendBtn.disabled = true;
      inputEl.disabled = true;
      actionPageBtn.disabled = actionVideoBtn.disabled = actionSelectionBtn.disabled = true;
      statusEl.textContent = "连接中…";
      const startedAt = Date.now();

      const userTurn = createCompactUserTurn({
        displayLabel,
        attached
      });
      conversation.push(userTurn);
      appendTurnEl(userTurn);

      const streamingTurn = { role: "assistant", content: "" };
      conversation.push(streamingTurn);
      const streamingEl = appendTurnEl(streamingTurn);
      streamingEl.classList.add("streaming");

      let port;
      try {
        port = chrome.runtime.connect({ name: "uca.quickaction.stream" });
      } catch (error) {
        finishWithError(streamingEl, `连接失败：${error?.message ?? error}`);
        resolve({ ok: false });
        return;
      }

      activeStreamPort = port;
      let settled = false;
      let acc = "";
      const settle = async (role, content) => {
        if (settled) return;
        settled = true;
        activeStreamPort = null;
        streamingEl.classList.remove("streaming");
        if (role === "error") {
          streamingEl.classList.remove("assistant");
          streamingEl.classList.add("error");
          streamingEl.textContent = content;
          conversation[conversation.length - 1] = { role: "error", content };
        } else {
          turnCounter += 1;
          const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
          const approxTokens = Math.max(1, Math.round((content ?? "").length / 3.5));
          const metaText = [`第 ${turnCounter} 轮`, `${elapsedSec}s`, `~${approxTokens.toLocaleString()} tokens`].join(" · ");
          streamingEl.innerHTML = renderMd(content);
          const metaEl = document.createElement("div");
          metaEl.className = "sp-turn-meta";
          metaEl.textContent = metaText;
          streamingEl.appendChild(metaEl);
          conversation[conversation.length - 1] = { role: "assistant", content, meta: metaText };
        }
        await saveHistory();
        sendBtn.disabled = false;
        inputEl.disabled = false;
        actionPageBtn.disabled = actionVideoBtn.disabled = actionSelectionBtn.disabled = false;
        statusEl.textContent = "";
        isBusy = false;
        try { port.disconnect(); } catch { /* ignore */ }
        resolve({ ok: role !== "error" });
      };

      port.onMessage.addListener((msg) => {
        if (msg?.type === "start") {
          statusEl.textContent = "分析中…";
        } else if (msg?.type === "chunk") {
          acc = typeof msg.full === "string" ? msg.full : (acc + (msg.delta ?? ""));
          streamingEl.innerHTML = renderMd(acc);
          historyEl.scrollTop = historyEl.scrollHeight;
        } else if (msg?.type === "done") {
          settle("assistant", msg.text ?? acc);
        } else if (msg?.type === "error") {
          settle("error", `失败：${msg.error ?? "unknown"}`);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) {
          if (acc) settle("assistant", acc);
          else settle("error", "连接意外断开");
        }
      });

      port.postMessage({
        type: "quickaction",
        action,
        selectionState,
        routePlan
      });
    })();
  });
}

/* ── Page / video / selection analyzers ─────────────────────────────── */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function capturePageViaContentScript(tabId) {
  // Use __ucaPageSourceCapture installed by content_script/page-source-capture.js.
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => (typeof window.__ucaPageSourceCapture === "function"
        ? await window.__ucaPageSourceCapture()
        : null)
    });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

async function extractPagePlainText(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title;
        const metaDesc = document.querySelector('meta[name="description"]')?.content ?? "";
        const clone = document.body?.cloneNode(true);
        if (!clone) return { title, metaDesc, text: "" };
        clone.querySelectorAll("script, style, noscript, nav, footer, aside").forEach((n) => n.remove());
        const text = (clone.innerText || "").replace(/\s+/g, " ").trim().slice(0, 18_000);
        return { title, metaDesc, text };
      }
    });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

async function onAnalyzePageV2({ mode = "analyze", resetConversation = true } = {}) {
  if (isBusy) return;
  if (resetConversation) {
    await startFreshAnalysisThread();
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    appendTurnEl({ role: "error", content: "当前没有可分析的标签页" });
    return;
  }
  statusEl.textContent = "抓取页面…";
  const [captured, plain] = await Promise.all([
    capturePageViaContentScript(tab.id),
    extractPagePlainText(tab.id)
  ]);
  let bodyBlock = "";
  let kindLabel = "";
  let chipTitle = tab.title ?? tab.url ?? "当前页面";
  if (captured?.kind === "video" && captured.youtube?.transcriptBody) {
    kindLabel = "YouTube 视频";
    bodyBlock = `标题：${captured.youtube.title ?? tab.title ?? ""}\n作者：${captured.youtube.author ?? "未知"}\nURL：${tab.url ?? ""}\n\n字幕：\n${captured.youtube.transcriptBody.slice(0, 16_000)}`;
    chipTitle = captured.youtube.title ?? chipTitle;
  } else if (plain?.text) {
    kindLabel = "网页";
    bodyBlock = `标题：${plain.title ?? tab.title ?? ""}\nURL：${tab.url ?? ""}\n描述：${plain.metaDesc ?? ""}\n\n正文：\n${plain.text}`;
    chipTitle = plain.title ?? chipTitle;
  } else {
    appendTurnEl({ role: "error", content: "未能抓到页面文本，可能页面还没加载完。" });
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = "";
  const isExplain = mode === "explain";
  const userText = isExplain
    ? `请解释以下${kindLabel}：先给一段清楚的总述，再列出 5-8 个关键点，说明背景、核心结论和需要注意的不确定性。我可能会继续追问。\n\n---\n${bodyBlock}\n---`
    : `请分析以下${kindLabel}：先一段总体概述，再用编号列表给出 5-8 个关键要点，最后给出 3 个值得延伸的问题。我可能会基于这份分析继续追问。\n\n---\n${bodyBlock}\n---`;
  const displayLabel = `${isExplain ? "📖 解释" : "📄 分析"}${kindLabel === "YouTube 视频" ? "视频" : "此页"}：${chipTitle.slice(0, 80)}`;
  await sendTurn({
    userContent: userText,
    displayLabel,
    attached: bodyBlock,
    maxTokens: 1536
  });
}

async function onAnalyzeSelection({ resetConversation = true } = {}) {
  if (isBusy) return;
  if (resetConversation) {
    await startFreshAnalysisThread();
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    appendTurnEl({ role: "error", content: "当前没有可分析的标签页" });
    return;
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        return { text, url: location.href, title: document.title };
      }
    });
    const payload = result?.result ?? {};
    if (!payload.text) {
      appendTurnEl({ role: "error", content: "当前页面没有选中的文本。先选一段再点。" });
      return;
    }
    const userText = `请分析以下网页选区内容，给出要点和我可能感兴趣的延伸问题：\n\n标题：${payload.title}\nURL：${payload.url}\n\n选区：\n${payload.text}`;
    const preview = payload.text.slice(0, 40) + (payload.text.length > 40 ? "…" : "");
    await sendTurn({
      userContent: userText,
      displayLabel: `✂️ 分析选区：${preview}`,
      attached: payload.text,
      maxTokens: 1024
    });
  } catch {
    appendTurnEl({ role: "error", content: "无法读取页面选区（这个页面可能禁止注入脚本）" });
  }
}

async function onAnalyzeVideo({ resetConversation = true } = {}) {
  // For the sidepanel, video analysis shares the same capture path as page
  // analysis — __ucaPageSourceCapture already detects YouTube and returns
  // transcript. Users get a hint if the current page isn't a video.
  if (resetConversation) {
    await startFreshAnalysisThread();
  }
  const tab = await getActiveTab();
  if (!/youtube\.com|youtu\.be/.test(tab?.url ?? "")) {
    appendTurnEl({ role: "system", content: "(提示：当前不是 YouTube 页面。点 [分析此页] 也一样能用；视频支持正在逐步扩展到其他平台。)" });
  }
  await onAnalyzePageV2({ resetConversation: false });
}

function buildQuickActionDisplayLabel(action, selectionState = {}) {
  if (action === "uca.fetch-link") {
    const title = `${selectionState.anchorText ?? selectionState.url ?? ""}`.trim();
    return `🔗 分析链接：${title.slice(0, 80) || "当前链接"}`;
  }
  if (action === "uca.inspect-image") {
    const title = `${selectionState.text ?? selectionState.imageUrl ?? ""}`.trim();
    return `🖼️ 分析图片：${title.slice(0, 80) || "当前图片"}`;
  }
  return "开始分析";
}

function buildQuickActionAttached(action, selectionState = {}) {
  if (action === "uca.fetch-link") {
    return [`URL：${selectionState.url ?? ""}`, `锚文本：${selectionState.anchorText ?? selectionState.text ?? ""}`]
      .filter(Boolean)
      .join("\n");
  }
  if (action === "uca.inspect-image") {
    return [`图片：${selectionState.imageUrl ?? ""}`, `说明：${selectionState.text ?? ""}`]
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function runPendingAnalysis(request = null) {
  if (!request?.id || request.id === lastPendingRequestId) return;
  lastPendingRequestId = request.id;
  try {
    await chrome.storage.local.remove(PENDING_ANALYSIS_KEY);
  } catch { /* ignore */ }
  if (request.kind === "carry_result") {
    const userTurn = createCompactUserTurn({
      displayLabel: request.displayLabel ?? "💬 打开对话框追问",
      attached: request.attached ?? ""
    });
    conversation.push(userTurn);
    appendTurnEl(userTurn);
    if (request.priorResult) {
      turnCounter += 1;
      const approxTokens = Math.max(1, Math.round((request.priorResult ?? "").length / 3.5));
      const metaText = [`第 ${turnCounter} 轮`, "已带入现有结果", `~${approxTokens.toLocaleString()} tokens`].join(" · ");
      const assistantTurn = { role: "assistant", content: request.priorResult, meta: metaText };
      conversation.push(assistantTurn);
      appendTurnEl(assistantTurn);
      await saveHistory();
    }
    return;
  }
  if (request.kind === "page_explain") {
    await onAnalyzePageV2({ mode: "explain", resetConversation: true });
    return;
  }
  if (request.kind === "quickaction") {
    await runQuickActionTurn({
      action: request.action,
      selectionState: request.selectionState ?? {},
      displayLabel: request.displayLabel ?? buildQuickActionDisplayLabel(request.action, request.selectionState),
      attached: request.attached ?? buildQuickActionAttached(request.action, request.selectionState),
      resetConversation: true,
      routePlan: request.routePlan ?? null
    });
  }
}

async function consumePendingAnalysis() {
  try {
    const data = await chrome.storage.local.get(PENDING_ANALYSIS_KEY);
    if (data?.[PENDING_ANALYSIS_KEY]) {
      await runPendingAnalysis(data[PENDING_ANALYSIS_KEY]);
    }
  } catch { /* ignore */ }
}

async function onClear() {
  conversation = [];
  await saveHistory();
  renderHistory();
  statusEl.textContent = "";
}

/* ── Form handlers ──────────────────────────────────────────────────── */
formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text || isBusy) return;
  inputEl.value = "";
  await sendTurn({ userContent: text });
});
inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

actionClearBtn.addEventListener("click", () => { void onClear(); });
actionPageBtn.addEventListener("click", () => { void onAnalyzePageV2({ resetConversation: true }); });
actionVideoBtn.addEventListener("click", () => { void onAnalyzeVideo({ resetConversation: true }); });
actionSelectionBtn.addEventListener("click", () => { void onAnalyzeSelection({ resetConversation: true }); });
actionLocationBtn.addEventListener("click", () => { void onLocationChipClick(); });
optionsBtn.addEventListener("click", () => {
  try { chrome.runtime.openOptionsPage(); } catch { /* ignore */ }
});

/* ── Location chip ───────────────────────────────────────────────────
 * Shows cached status; on click requests real geolocation. Chrome-origin
 * permission is gated to a user gesture, so this MUST stay wired to the
 * direct click listener — no async detour before requestPreciseLocation.
 */
async function refreshLocationChip() {
  try {
    const { getCachedLocation, formatLocationLabel } = await import("../shared/location.js");
    const cached = await getCachedLocation();
    if (cached) {
      actionLocationBtn.textContent = `📍 ${formatLocationLabel(cached)}`;
      actionLocationBtn.title = "已授权。点击刷新或清除";
      actionLocationBtn.classList.remove("sp-chip-ghost");
    } else {
      actionLocationBtn.textContent = "📍 定位：未授权";
      actionLocationBtn.title = "点击以启用精确定位（会弹权限）";
      actionLocationBtn.classList.add("sp-chip-ghost");
    }
  } catch {
    /* best effort */
  }
}

// Forward a fresh fix to the desktop service so the agent-loop sees it
// without waiting for the next capture submission. Best effort — if the
// desktop isn't up, the next task POST will carry the location anyway.
async function pushLocationToDesktop(location, { clear = false } = {}) {
  try {
    const status = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "uca.standalone.status" }, resolve);
    });
    const base = status?.runtimeUrl;
    if (!base || !status?.desktopAvailable) return;
    if (clear) {
      await fetch(`${base}/location`, { method: "DELETE" });
    } else if (location) {
      await fetch(`${base}/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location })
      });
    }
  } catch {
    /* desktop offline is fine */
  }
}

async function onLocationChipClick() {
  const { requestPreciseLocation, clearCachedLocation, getCachedLocation, formatLocationLabel } =
    await import("../shared/location.js");
  const existing = await getCachedLocation();
  if (existing) {
    const choice = window.confirm(
      `当前定位：${formatLocationLabel(existing)}\n\n按「确定」重新获取，按「取消」清除 LingxY 缓存。浏览器定位授权可在 Chrome 站点/扩展权限里管理。`
    );
    if (choice) {
      actionLocationBtn.textContent = "📍 定位中…";
      const r = await requestPreciseLocation();
      if (r.ok) {
        actionLocationBtn.textContent = `📍 ${formatLocationLabel(r.location)}`;
        void pushLocationToDesktop(r.location);
      } else {
        actionLocationBtn.textContent = `📍 失败：${r.reason}`;
      }
    } else {
      // Clear LingxY's cache and tell the desktop service to drop its mirror.
      // Chrome owns the browser-level geolocation permission; MV3 requires it
      // as a normal manifest permission, not an optional runtime permission.
      await clearCachedLocation();
      void pushLocationToDesktop(null, { clear: true });
      actionLocationBtn.textContent = "📍 定位：已撤销";
      actionLocationBtn.classList.add("sp-chip-ghost");
      setTimeout(() => void refreshLocationChip(), 600);
    }
    return;
  }
  actionLocationBtn.textContent = "📍 请求授权…";
  const r = await requestPreciseLocation();
  if (r.ok) {
    actionLocationBtn.textContent = `📍 ${formatLocationLabel(r.location)}`;
    actionLocationBtn.classList.remove("sp-chip-ghost");
    void pushLocationToDesktop(r.location);
  } else if (r.reason === "permission_denied") {
    actionLocationBtn.textContent = "📍 已拒绝";
    actionLocationBtn.title = "你拒绝了授权。可在 Chrome 的站点/扩展权限中重新允许定位。";
  } else if (r.reason === "unsupported") {
    actionLocationBtn.textContent = "📍 不支持";
  } else {
    actionLocationBtn.textContent = `📍 失败：${r.reason}`;
  }
}

/* ── Boot ──────────────────────────────────────────────────────────── */
(async () => {
  await loadHistory();
  renderHistory();
  void refreshMode();
  void refreshLocationChip();
  await consumePendingAnalysis();
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes?.[PENDING_ANALYSIS_KEY]?.newValue ?? null;
    if (next) void runPendingAnalysis(next);
    if (changes?.ucaUserLocation) void refreshLocationChip();
  });
})();
