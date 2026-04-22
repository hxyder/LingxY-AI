// Side-panel chat — mirrors the popup chat flow but with more real estate
// and Chrome's sidePanel lifecycle so the conversation follows the user
// across tab switches within a browser window. Uses the same streaming
// port infrastructure introduced in UCA-166/167 (uca.chat.stream +
// uca.quickaction.stream). Stored history lives in chrome.storage.local
// under a dedicated key so it doesn't collide with the popup's session-
// scoped history.

const HISTORY_KEY = "ucaSidePanelHistory";
const HISTORY_MAX = 40;
const SYSTEM_PROMPT = "You are LingxY, a helpful assistant in a browser side panel. The user is actively browsing the web. Reply in the user's language (Chinese by default). Use Markdown lists / headings / code blocks when structure helps. Be concise but thorough when the user asks you to analyze a whole page or video.";

const historyEl = document.getElementById("sp-history");
const inputEl = document.getElementById("sp-input");
const sendBtn = document.getElementById("sp-send");
const formEl = document.getElementById("sp-form");
const statusEl = document.getElementById("sp-status");
const modePillEl = document.getElementById("sp-mode-pill");
const optionsBtn = document.getElementById("sp-options-btn");
const actionClearBtn = document.getElementById("sp-action-clear");
const actionPageBtn = document.getElementById("sp-action-page");
const actionVideoBtn = document.getElementById("sp-action-video");
const actionSelectionBtn = document.getElementById("sp-action-selection");

let conversation = [];
let activeStreamPort = null;
let isBusy = false;

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
  const el = document.createElement("div");
  el.className = `sp-msg ${turn.role === "user" ? "user"
    : turn.role === "error" ? "error"
    : turn.role === "system" ? "system"
    : "assistant"}`;
  if (turn.role === "assistant") {
    el.innerHTML = renderMd(turn.content ?? "");
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
    modePillEl.classList.remove("mode-desktop", "mode-standalone", "mode-offline");
    if (response?.desktopAvailable) {
      modePillEl.textContent = "桌面在线";
      modePillEl.classList.add("mode-desktop");
    } else if (response?.standaloneReady) {
      modePillEl.textContent = `独立 · ${response.provider ?? "llm"}`;
      modePillEl.classList.add("mode-standalone");
    } else {
      modePillEl.textContent = "未配置";
      modePillEl.classList.add("mode-offline");
    }
  } catch {
    modePillEl.textContent = "未配置";
    modePillEl.classList.add("mode-offline");
  }
}

/* ── Chat send (port-based streaming) ────────────────────────────────── */
function sendTurn({ userContent, systemContent = null, assistantPrefix = null } = {}) {
  return new Promise((resolve) => {
    if (isBusy) { resolve({ ok: false, error: "busy" }); return; }
    isBusy = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;
    actionPageBtn.disabled = actionVideoBtn.disabled = actionSelectionBtn.disabled = true;
    statusEl.textContent = "连接中…";

    if (systemContent) {
      conversation.push({ role: "system", content: systemContent });
      appendTurnEl({ role: "system", content: systemContent });
    }
    conversation.push({ role: "user", content: userContent });
    appendTurnEl({ role: "user", content: userContent });

    // Create streaming bubble up front with optional prefix.
    const streamingTurn = { role: "assistant", content: assistantPrefix ?? "" };
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
        streamingEl.innerHTML = renderMd(content);
        conversation[conversation.length - 1] = { role: "assistant", content };
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
        statusEl.textContent = "生成中…";
      } else if (msg?.type === "chunk") {
        acc = typeof msg.full === "string" ? msg.full : (acc + (msg.delta ?? ""));
        streamingEl.innerHTML = renderMd(acc);
        historyEl.scrollTop = historyEl.scrollHeight;
      } else if (msg?.type === "done") {
        const finalText = msg.text ?? acc;
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

    // Exclude system prompts + error turns from what we send to the LLM.
    const sendableHistory = conversation
      .slice(0, -1) // exclude the just-added empty assistant placeholder
      .filter((t) => t.role === "user" || t.role === "assistant");
    port.postMessage({
      type: "chat",
      text: userContent,
      history: sendableHistory.slice(0, -1) // exclude the just-added user turn (SW re-appends)
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

async function onAnalyzePage() {
  if (isBusy) return;
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
  let body = "";
  if (captured?.kind === "video" && captured.youtube?.transcriptBody) {
    body = `【YouTube 视频】\n标题：${captured.youtube.title ?? tab.title}\n作者：${captured.youtube.author ?? "未知"}\nURL：${tab.url}\n\n字幕：\n${captured.youtube.transcriptBody.slice(0, 16_000)}`;
  } else if (plain?.text) {
    body = `【网页】\n标题：${plain.title ?? tab.title}\nURL：${tab.url}\n描述：${plain.metaDesc ?? ""}\n\n正文：\n${plain.text}`;
  } else {
    appendTurnEl({ role: "error", content: "未能抓到页面文本，可能页面还没加载完。" });
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = "";
  const systemContent = `已抓取当前页面（${tab.url}）`;
  await sendTurn({
    userContent: "请完整分析这份页面内容：先一段总体概述，然后列出 5-8 个关键要点，最后给出值得延伸的问题。结合用户在侧边栏继续追问。",
    systemContent,
    assistantPrefix: ""
  });
  // Inject the captured body as additional context in the user turn. The SW
  // uses sendable history, so we embed it into the user's turn content:
  // we need to send the body before the user's request. Approach: send the
  // request with the body embedded directly. Re-issue:
  // Simpler: above call already included a user turn that told the model
  // what to do, but the model didn't see the body. So do it explicitly:
  // Instead of the preceding send, we issue a combined user turn here:
  // (revised below)
}

// The above onAnalyzePage has a flow issue — model doesn't see the body.
// Reimplement cleanly:
async function onAnalyzePageV2() {
  if (isBusy) return;
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
  if (captured?.kind === "video" && captured.youtube?.transcriptBody) {
    kindLabel = "YouTube 视频";
    bodyBlock = `标题：${captured.youtube.title ?? tab.title ?? ""}\n作者：${captured.youtube.author ?? "未知"}\nURL：${tab.url ?? ""}\n\n字幕：\n${captured.youtube.transcriptBody.slice(0, 16_000)}`;
  } else if (plain?.text) {
    kindLabel = "网页";
    bodyBlock = `标题：${plain.title ?? tab.title ?? ""}\nURL：${tab.url ?? ""}\n描述：${plain.metaDesc ?? ""}\n\n正文：\n${plain.text}`;
  } else {
    appendTurnEl({ role: "error", content: "未能抓到页面文本，可能页面还没加载完。" });
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = "";
  const userText = `请分析以下${kindLabel}：先一段总体概述，再用编号列表给出 5-8 个关键要点，最后给出 3 个值得延伸的问题。我可能会基于这份分析继续追问。\n\n---\n${bodyBlock}\n---`;
  await sendTurn({ userContent: userText });
}

async function onAnalyzeSelection() {
  if (isBusy) return;
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
    await sendTurn({ userContent: userText });
  } catch {
    appendTurnEl({ role: "error", content: "无法读取页面选区（这个页面可能禁止注入脚本）" });
  }
}

async function onAnalyzeVideo() {
  // For the sidepanel, video analysis shares the same capture path as page
  // analysis — __ucaPageSourceCapture already detects YouTube and returns
  // transcript. Users get a hint if the current page isn't a video.
  const tab = await getActiveTab();
  if (!/youtube\.com|youtu\.be/.test(tab?.url ?? "")) {
    appendTurnEl({ role: "system", content: "(提示：当前不是 YouTube 页面。点 [分析此页] 也一样能用；视频支持正在逐步扩展到其他平台。)" });
  }
  await onAnalyzePageV2();
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
actionPageBtn.addEventListener("click", () => { void onAnalyzePageV2(); });
actionVideoBtn.addEventListener("click", () => { void onAnalyzeVideo(); });
actionSelectionBtn.addEventListener("click", () => { void onAnalyzeSelection(); });
optionsBtn.addEventListener("click", () => {
  try { chrome.runtime.openOptionsPage(); } catch { /* ignore */ }
});

/* ── Boot ──────────────────────────────────────────────────────────── */
(async () => {
  await loadHistory();
  renderHistory();
  void refreshMode();
})();
