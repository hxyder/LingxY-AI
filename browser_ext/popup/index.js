export function renderTaskList(tasks, doc = document) {
  const list = doc.getElementById("task-list");
  list.innerHTML = "";

  for (const task of tasks) {
    const item = doc.createElement("li");
    item.className = "task-item";
    item.textContent = `${task.intent} · ${task.status}`;
    list.appendChild(item);
  }
}

export async function requestRecentTasks(chromeApi = chrome) {
  return new Promise((resolve) => {
    try {
      chromeApi.runtime.sendNativeMessage("com.uca.host", {
        protocolVersion: "1.0",
        requestId: crypto.randomUUID(),
        action: "get_recent_tasks"
      }, (response) => {
        // Consume chrome.runtime.lastError when the native host isn't
        // installed — otherwise Chrome logs it as an unchecked error.
        // Typical message: "Specified native messaging host not found."
        const lastError = chromeApi.runtime?.lastError;
        if (lastError) {
          console.info("[LingxY] native host unavailable:", lastError.message);
          resolve([]);
          return;
        }
        resolve(response?.payload?.tasks ?? []);
      });
    } catch (err) {
      console.info("[LingxY] native messaging threw:", err?.message ?? err);
      resolve([]);
    }
  });
}

export async function requestOverlaySettings(chromeApi = chrome) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage({
      type: "uca.overlay.getSettings"
    }, (response) => {
      resolve(response ?? {
        settings: {
          enabled: true,
          displayMode: "smart"
        },
        securityState: {
          presenterMode: false
        }
      });
    });
  });
}

export async function updateOverlaySettings(patch, chromeApi = chrome) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage({
      type: "uca.overlay.updateSettings",
      patch
    }, (response) => resolve(response));
  });
}

export async function openRuntimeTasks(chromeApi = chrome) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage({
      type: "uca.runtime.openTasks"
    }, (response) => resolve(response));
  });
}

export function renderOverlaySettings(model, doc = document) {
  doc.getElementById("overlay-status").textContent = model.securityState.presenterMode ? "Presenter Mode" : "正常";
  doc.getElementById("display-mode").value = model.settings.displayMode;
  doc.getElementById("overlay-enabled").checked = Boolean(model.settings.enabled);
}

async function requestStandaloneStatus(chromeApi = chrome) {
  return new Promise((resolve) => {
    try {
      chromeApi.runtime.sendMessage({ type: "uca.standalone.status" }, (response) => {
        resolve(response ?? { desktopAvailable: false, standaloneReady: false });
      });
    } catch {
      resolve({ desktopAvailable: false, standaloneReady: false });
    }
  });
}

function renderRunMode(status, doc = document) {
  const pill = doc.getElementById("mode-pill");
  const detail = doc.getElementById("mode-detail");
  if (!pill) return;
  pill.classList.remove("mode-desktop", "mode-standalone", "mode-offline");
  if (status.desktopAvailable) {
    pill.textContent = "桌面程序在线";
    pill.classList.add("mode-desktop");
    if (detail) detail.textContent = "任务会送到桌面程序处理。";
  } else if (status.standaloneReady) {
    pill.textContent = `独立模式 · ${status.provider ?? "llm"}`;
    pill.classList.add("mode-standalone");
    if (detail) detail.textContent = "桌面程序未开，扩展会用您配置的 API Key 直接调 LLM。";
  } else {
    pill.textContent = "未配置";
    pill.classList.add("mode-offline");
    if (detail) detail.textContent = "请启动桌面程序，或在扩展设置里填 API Key。";
  }
}

// ── Chat dialog (UCA-160) ─────────────────────────────────────────────────

const CHAT_HISTORY_KEY = "ucaPopupChatHistory";
const CHAT_HISTORY_MAX = 20;

async function loadChatHistory(chromeApi = chrome) {
  try {
    const data = await chromeApi.storage.session?.get?.(CHAT_HISTORY_KEY)
      ?? await chromeApi.storage.local.get(CHAT_HISTORY_KEY);
    return Array.isArray(data?.[CHAT_HISTORY_KEY]) ? data[CHAT_HISTORY_KEY] : [];
  } catch { return []; }
}

async function saveChatHistory(history, chromeApi = chrome) {
  const trimmed = history.slice(-CHAT_HISTORY_MAX);
  try {
    if (chromeApi.storage.session?.set) {
      await chromeApi.storage.session.set({ [CHAT_HISTORY_KEY]: trimmed });
    } else {
      await chromeApi.storage.local.set({ [CHAT_HISTORY_KEY]: trimmed });
    }
  } catch { /* best effort */ }
}

// Minimal, safe Markdown renderer for assistant replies. Escapes HTML
// up-front, then applies a handful of Markdown patterns (bold, inline
// code, numbered/bulleted lists, paragraph breaks). No external library
// and no tag whitelist walk — cheaper to audit.
function renderAssistantMarkdown(raw = "") {
  const escaped = String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^###\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^##\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^#\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^(\d+)\.\s+(.+)$/gm, "<div class=\"li\">$1. $2</div>")
    .replace(/^[-•*]\s+(.+)$/gm, "<div class=\"li\">• $1</div>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

function renderChatHistory(history, doc = document) {
  const container = doc.getElementById("chat-history");
  if (!container) return;
  container.innerHTML = "";
  for (const turn of history) {
    const el = doc.createElement("div");
    el.className = `chat-msg ${turn.role === "user" ? "user" : turn.role === "error" ? "error" : "assistant"}`;
    if (turn.role === "assistant") {
      el.innerHTML = renderAssistantMarkdown(turn.content ?? "");
    } else {
      el.textContent = turn.content ?? "";
    }
    container.appendChild(el);
  }
  container.scrollTop = container.scrollHeight;
}

function sendChatMessageStreaming(text, doc, chromeApi, history, statusEl, sendBtn, inputEl) {
  return new Promise((resolve) => {
    let port;
    try {
      port = chromeApi.runtime.connect({ name: "uca.chat.stream" });
    } catch {
      resolve({ streamed: false });
      return;
    }
    if (!port) { resolve({ streamed: false }); return; }

    const container = doc.getElementById("chat-history");
    let streamingEl = null;
    let fullText = "";
    let settled = false;

    const onSettle = async (success, errorText) => {
      if (settled) return;
      settled = true;
      if (success) {
        const next = [...history, { role: "assistant", content: fullText }];
        renderChatHistory(next, doc);
        await saveChatHistory(next, chromeApi);
        if (statusEl) statusEl.textContent = "";
      } else {
        const next = [...history, { role: "error", content: `失败：${errorText ?? "unknown"}` }];
        renderChatHistory(next, doc);
        await saveChatHistory(next, chromeApi);
        if (statusEl) statusEl.textContent = `失败：${errorText ?? "unknown"}`;
      }
      if (sendBtn) sendBtn.disabled = false;
      if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
      try { port.disconnect(); } catch { /* ignore */ }
      resolve({ streamed: true });
    };

    port.onMessage.addListener((msg) => {
      if (msg?.type === "start") {
        // Create an empty streaming assistant bubble up front.
        streamingEl = doc.createElement("div");
        streamingEl.className = "chat-msg assistant streaming";
        streamingEl.textContent = "…";
        container.appendChild(streamingEl);
        container.scrollTop = container.scrollHeight;
        if (statusEl) statusEl.textContent = "流式生成中…";
      } else if (msg?.type === "chunk") {
        fullText = typeof msg.full === "string" ? msg.full : (fullText + (msg.delta ?? ""));
        if (streamingEl) {
          streamingEl.innerHTML = renderAssistantMarkdown(fullText);
          container.scrollTop = container.scrollHeight;
        }
      } else if (msg?.type === "done") {
        fullText = msg.text ?? fullText;
        onSettle(true);
      } else if (msg?.type === "error") {
        onSettle(false, msg.error);
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      // Unclean disconnect — treat as failure if we have no text, otherwise
      // accept the partial as final.
      if (fullText) onSettle(true);
      else onSettle(false, "stream_disconnected");
    });

    port.postMessage({ type: "chat", text, history });
  });
}

async function sendChatMessage(text, doc = document, chromeApi = chrome) {
  const statusEl = doc.getElementById("chat-status");
  const sendBtn = doc.getElementById("chat-send");
  const inputEl = doc.getElementById("chat-input");
  const history = await loadChatHistory(chromeApi);
  history.push({ role: "user", content: text });
  renderChatHistory(history, doc);
  await saveChatHistory(history, chromeApi);
  if (statusEl) statusEl.textContent = "连接中…";
  if (sendBtn) sendBtn.disabled = true;
  if (inputEl) inputEl.disabled = true;

  // Try streaming first. If the port can't be opened (very old Chrome, or
  // the SW hasn't registered the listener yet) fall back to the one-shot
  // sendMessage path so the user still gets a reply.
  const streamResult = await sendChatMessageStreaming(text, doc, chromeApi, history.slice(0, -1), statusEl, sendBtn, inputEl);
  if (streamResult.streamed) return;

  // Non-streaming fallback (should be rare).
  try {
    const response = await new Promise((resolve) => {
      chromeApi.runtime.sendMessage({
        type: "uca.standalone.chat",
        text,
        history: history.slice(0, -1)
      }, resolve);
    });
    if (response?.ok) {
      const next = Array.isArray(response.history) ? response.history : [...history, { role: "assistant", content: response.text }];
      renderChatHistory(next, doc);
      await saveChatHistory(next, chromeApi);
      if (statusEl) statusEl.textContent = "";
    } else {
      const err = response?.error ?? "unknown";
      const next = [...history, { role: "error", content: `失败：${err}` }];
      renderChatHistory(next, doc);
      await saveChatHistory(next, chromeApi);
      if (statusEl) statusEl.textContent = `失败：${err}`;
    }
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
  }
}

async function openSidePanelWithGesture(chromeApi = chrome) {
  const currentWindow = await chromeApi.windows?.getCurrent?.();
  const windowId = currentWindow?.id ?? null;
  const [activeTab] = await (chromeApi.tabs?.query?.({ active: true, currentWindow: true }) ?? Promise.resolve([]));
  if (chromeApi.sidePanel?.setOptions && activeTab?.id != null) {
    await chromeApi.sidePanel.setOptions({
      tabId: activeTab.id,
      path: "sidepanel/index.html",
      enabled: true
    });
  }
  if (chromeApi.sidePanel?.open && windowId != null) {
    await chromeApi.sidePanel.open({ windowId });
    return windowId;
  }
  const response = await new Promise((resolve) => {
    chromeApi.runtime.sendMessage({ type: "uca.sidepanel.open", windowId }, resolve);
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "side_panel_open_failed");
  }
  return windowId;
}

async function bootPopup(doc = document, chromeApi = chrome) {
  const [tasks, overlayModel, modeStatus, chatHistory] = await Promise.all([
    requestRecentTasks(chromeApi),
    requestOverlaySettings(chromeApi),
    requestStandaloneStatus(chromeApi),
    loadChatHistory(chromeApi)
  ]);

  renderTaskList(tasks, doc);
  renderOverlaySettings(overlayModel, doc);
  renderRunMode(modeStatus, doc);
  renderChatHistory(chatHistory, doc);

  // Chat form: Enter submits, Shift+Enter inserts newline.
  const chatForm = doc.getElementById("chat-form");
  const chatInput = doc.getElementById("chat-input");
  const chatClearBtn = doc.getElementById("chat-clear");
  if (chatForm && chatInput) {
    chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = "";
      await sendChatMessage(text, doc, chromeApi);
    });
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatForm.requestSubmit();
      }
    });
  }
  if (chatClearBtn) {
    chatClearBtn.addEventListener("click", async () => {
      await saveChatHistory([], chromeApi);
      renderChatHistory([], doc);
      doc.getElementById("chat-status").textContent = "";
    });
  }

  const openOptionsBtn = doc.getElementById("open-options");
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener("click", () => {
      try { chromeApi.runtime.openOptionsPage(); } catch { /* ignore */ }
    });
  }

  const openSidePanelBtn = doc.getElementById("open-sidepanel");
  if (openSidePanelBtn) {
    openSidePanelBtn.addEventListener("click", async () => {
      try {
        await openSidePanelWithGesture(chromeApi);
        window.close();
      } catch (error) {
        console.warn("[LingxY] open side panel failed:", error?.message ?? error);
      }
    });
  }

  doc.getElementById("display-mode").addEventListener("change", async (event) => {
    const response = await updateOverlaySettings({
      displayMode: event.target.value
    }, chromeApi);
    renderOverlaySettings({
      settings: response.settings,
      securityState: overlayModel.securityState
    }, doc);
  });

  doc.getElementById("overlay-enabled").addEventListener("change", async (event) => {
    const response = await updateOverlaySettings({
      enabled: event.target.checked
    }, chromeApi);
    renderOverlaySettings({
      settings: response.settings,
      securityState: overlayModel.securityState
    }, doc);
  });

  doc.getElementById("open-console").addEventListener("click", async () => {
    await openRuntimeTasks(chromeApi);
    window.close();
  });

  const explainBtn = doc.getElementById("explain-page");
  const explainStatus = doc.getElementById("explain-page-status");
  if (explainBtn) {
    explainBtn.addEventListener("click", async () => {
      explainBtn.disabled = true;
      if (explainStatus) explainStatus.textContent = "正在准备分析…";
      try {
        const response = await new Promise((resolve) => {
          chromeApi.runtime.sendMessage({ type: "uca.page.explain", openPanel: false }, resolve);
        });
        if (!response?.ok) {
          throw new Error(response?.error ?? response?.reason ?? "unknown");
        }
        if (explainStatus) explainStatus.textContent = "正在打开侧边栏…";
        await openSidePanelWithGesture(chromeApi);
        if (explainStatus) explainStatus.textContent = "已在侧边栏开始加载。";
        setTimeout(() => window.close(), 400);
      } catch (error) {
        if (explainStatus) explainStatus.textContent = `失败：${error?.message ?? error}`;
        explainBtn.disabled = false;
      }
    });
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  bootPopup(document, chrome);
}
