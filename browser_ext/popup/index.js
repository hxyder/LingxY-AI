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

function renderChatHistory(history, doc = document) {
  const container = doc.getElementById("chat-history");
  if (!container) return;
  container.innerHTML = "";
  for (const turn of history) {
    const el = doc.createElement("div");
    el.className = `chat-msg ${turn.role === "user" ? "user" : turn.role === "error" ? "error" : "assistant"}`;
    el.textContent = turn.content;
    container.appendChild(el);
  }
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage(text, doc = document, chromeApi = chrome) {
  const statusEl = doc.getElementById("chat-status");
  const sendBtn = doc.getElementById("chat-send");
  const inputEl = doc.getElementById("chat-input");
  const history = await loadChatHistory(chromeApi);
  history.push({ role: "user", content: text });
  renderChatHistory(history, doc);
  await saveChatHistory(history, chromeApi);
  if (statusEl) statusEl.textContent = "思考中…";
  if (sendBtn) sendBtn.disabled = true;
  if (inputEl) inputEl.disabled = true;
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
      if (explainStatus) explainStatus.textContent = "正在捕获页面内容…";
      const response = await new Promise((resolve) => {
        chromeApi.runtime.sendMessage({ type: "uca.page.explain" }, resolve);
      });
      if (response?.accepted) {
        if (explainStatus) explainStatus.textContent = `已递交（${response.contentKind ?? "unknown"}），浮窗会打开显示讲解。`;
        setTimeout(() => window.close(), 400);
      } else {
        if (explainStatus) explainStatus.textContent = `失败：${response?.error ?? response?.reason ?? "unknown"}`;
        explainBtn.disabled = false;
      }
    });
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  bootPopup(document, chrome);
}
