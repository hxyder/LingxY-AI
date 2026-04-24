// Popup-card renderer. Receives its init payload from main via
// `uca:popup-card-init`, renders a kind-specific card (approval / success /
// info / error), and wires the buttons back through the preload bridge.

const cardEl = document.getElementById("pc-card");
const titleEl = document.getElementById("pc-title");
const bodyEl = document.getElementById("pc-body");
const actionsEl = document.getElementById("pc-actions");
const pinBtn = document.getElementById("pc-pin");
const closeBtn = document.getElementById("pc-close");

const state = {
  cardId: null,
  kind: "info",
  pinned: false,
  resolved: false,
  autoHideTimer: null,
  lastReportedHeight: 0
};

const THEME_KEY = "uca-console-theme";

function syncPopupTheme() {
  try {
    const theme = localStorage.getItem("lingxy.theme") ?? localStorage.getItem(THEME_KEY) ?? "default";
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
      document.body.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);
    }
  } catch {
    // ignore
  }
}

syncPopupTheme();
window.addEventListener("storage", (event) => {
  if (event.key === "lingxy.theme" || event.key === THEME_KEY) syncPopupTheme();
});

function measureAndResize() {
  if (!state.cardId || !cardEl) return;
  // The card fills the window (height: 100%), so the real required height is
  // the sum of its internal parts. Use scrollHeight of the root card + a
  // small buffer for the drop shadow / body padding.
  const headH = document.getElementById("pc-head")?.offsetHeight ?? 40;
  const bodyH = bodyEl?.scrollHeight ?? 0;
  const actionsH = actionsEl?.offsetHeight ?? 40;
  const needed = Math.ceil(headH + bodyH + actionsH + 20); // +20 = body top/bottom padding + breathing
  if (Math.abs(needed - state.lastReportedHeight) < 4) return;
  state.lastReportedHeight = needed;
  try { window.ucaShell?.resizePopupCard?.(state.cardId, needed); } catch { /* ignore */ }
}

// Observe size changes for dynamic content (e.g. approval cards whose
// title/body updates after init).
if (typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(() => measureAndResize());
  queueMicrotask(() => {
    if (bodyEl) ro.observe(bodyEl);
    if (actionsEl) ro.observe(actionsEl);
  });
}

function resolveCardId() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("cardId");
  } catch {
    return null;
  }
}
state.cardId = resolveCardId();

function setText(el, text) {
  if (!el) return;
  el.textContent = text == null ? "" : String(text);
}

function makeButton({ label, variant = "ghost", onClick }) {
  const btn = document.createElement("button");
  btn.className = `pc-btn pc-btn-${variant}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function clearAutoHide() {
  if (state.autoHideTimer) {
    clearTimeout(state.autoHideTimer);
    state.autoHideTimer = null;
  }
}

function scheduleAutoHide(ms) {
  clearAutoHide();
  if (!ms || state.pinned) return;
  state.autoHideTimer = setTimeout(() => {
    closeCard("auto_hide");
  }, ms);
}

async function closeCard(reason) {
  clearAutoHide();
  cardEl.classList.remove("show");
  try {
    await window.ucaShell?.closePopupCard?.(state.cardId, { reason: reason ?? "user" });
  } catch { /* ignore */ }
}

async function resolveCard(action, extra = {}) {
  if (state.resolved) return;
  state.resolved = true;
  clearAutoHide();
  setButtonsDisabled(true);
  try {
    await window.ucaShell?.resolvePopupCard?.(state.cardId, { action, ...extra });
  } catch { /* swallow — main will close the window */ }
  cardEl.classList.remove("show");
  setTimeout(() => closeCard("resolved"), 200);
}

function setButtonsDisabled(disabled) {
  actionsEl.querySelectorAll("button").forEach((btn) => {
    btn.disabled = disabled;
  });
}

function renderBody(lines) {
  bodyEl.innerHTML = "";
  const items = Array.isArray(lines) ? lines : [lines].filter(Boolean);
  items.forEach((item, i) => {
    const el = document.createElement("div");
    el.className = i === 0 ? "pc-body-primary" : "pc-body-sub";
    el.textContent = String(item ?? "");
    bodyEl.appendChild(el);
  });
}

function renderActions(buttons = []) {
  actionsEl.innerHTML = "";
  for (const spec of buttons) {
    actionsEl.appendChild(makeButton(spec));
  }
}

function applyInit(payload) {
  const kind = payload?.kind ?? "info";
  state.kind = kind;
  cardEl.setAttribute("data-kind", kind);
  setText(titleEl, payload?.title ?? defaultTitleFor(kind));
  renderBody(payload?.lines ?? payload?.body ?? []);
  const detailLabel = payload?.openWindow === "overlay" ? "打开对话框" : "查看详情";

  if (kind === "approval") {
    renderActions([
      { label: "拒绝", variant: "danger", onClick: () => resolveCard("reject") },
      { label: detailLabel, variant: "ghost", onClick: () => openTaskDetail(payload?.taskId, payload) },
      { label: "通过", variant: "primary", onClick: () => resolveCard("approve") }
    ]);
  } else if (kind === "success") {
    renderActions([
      { label: detailLabel, variant: "ghost", onClick: () => openTaskDetail(payload?.taskId, payload) },
      { label: "好", variant: "primary", onClick: () => closeCard("dismissed") }
    ]);
    // success cards auto-hide unless pinned
    scheduleAutoHide(payload?.autoHideMs ?? 8000);
  } else if (kind === "error") {
    renderActions([
      { label: detailLabel, variant: "ghost", onClick: () => openTaskDetail(payload?.taskId, payload) },
      { label: "关闭", variant: "primary", onClick: () => closeCard("dismissed") }
    ]);
    scheduleAutoHide(payload?.autoHideMs ?? 12000);
  } else if (kind === "libreoffice") {
    // Install nudge for the pptx Tier 1 renderer. Three explicit paths:
    // auto-install via winget (streams progress inline), manual download,
    // or dismiss and continue with the text-structure preview (Tier 2).
    renderActions([
      { label: "用文本预览", variant: "ghost", onClick: () => resolveCard("use_text") },
      { label: "手动安装", variant: "ghost", onClick: () => resolveCard("manual_install") },
      { label: "自动安装 (winget)", variant: "primary", onClick: () => startWingetInstall(payload) }
    ]);
    // Never auto-hide: user needs to read + choose.
  } else {
    renderActions([{ label: "好", variant: "primary", onClick: () => closeCard("dismissed") }]);
    scheduleAutoHide(payload?.autoHideMs ?? 6000);
  }

  requestAnimationFrame(() => {
    cardEl.classList.add("show");
    measureAndResize();
    // one more pass after the transition so button metrics settle
    setTimeout(measureAndResize, 260);
  });
}

function defaultTitleFor(kind) {
  if (kind === "approval") return "等待确认";
  if (kind === "success") return "已完成";
  if (kind === "error") return "任务失败";
  if (kind === "libreoffice") return "安装 LibreOffice";
  return "LingxY";
}

// Stream winget install progress into the body area. The runtime
// exposes /preview/libreoffice/install as an SSE endpoint; we consume
// it here and append each line. The popup stays open until the user
// dismisses it (ResizeObserver keeps the window height in sync).
async function startWingetInstall(payload) {
  setButtonsDisabled(true);
  const runtimeBaseUrl = payload?.runtimeBaseUrl
    || window.__lingxyRuntimeBaseUrl
    || "http://127.0.0.1:4310";
  bodyEl.innerHTML = "";
  const status = document.createElement("div");
  status.className = "pc-body-primary";
  status.textContent = "正在调用 winget…";
  bodyEl.appendChild(status);
  const logEl = document.createElement("pre");
  logEl.style.cssText = "margin:10px 0 0;max-height:160px;overflow:auto;background:rgba(0,0,0,.06);padding:8px 10px;border-radius:6px;font:12px/1.4 ui-monospace,Consolas,monospace;";
  bodyEl.appendChild(logEl);

  let response;
  try {
    response = await fetch(`${runtimeBaseUrl}/preview/libreoffice/install`, { method: "POST" });
  } catch (error) {
    status.textContent = `无法连接到运行时：${error.message}`;
    renderActions([{ label: "关闭", variant: "primary", onClick: () => closeCard("install_failed") }]);
    setButtonsDisabled(false);
    return;
  }
  if (!response.ok || !response.body) {
    status.textContent = `winget 启动失败（HTTP ${response.status}）`;
    renderActions([{ label: "关闭", variant: "primary", onClick: () => closeCard("install_failed") }]);
    setButtonsDisabled(false);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop();
    for (const chunk of chunks) {
      let event = "message";
      let dataLine = "";
      chunk.split("\n").forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      });
      currentEvent = event;
      const parsed = safeJsonParse(dataLine);
      if (event === "start") status.textContent = "安装中…请稍候";
      else if (event === "stdout" || event === "stderr") {
        const line = parsed?.line ?? dataLine;
        logEl.textContent += line + "\n";
        logEl.scrollTop = logEl.scrollHeight;
      } else if (event === "error") {
        status.textContent = `失败：${parsed?.message ?? dataLine}`;
      } else if (event === "done") {
        const present = parsed?.capability?.present;
        status.textContent = present
          ? "安装完成。下次打开 pptx 将使用真实渲染。"
          : `winget 退出 (code=${parsed?.exitCode ?? "?"})。可能需要手动重试。`;
      }
    }
  }
  renderActions([
    { label: "关闭", variant: "primary", onClick: () => resolveCard(currentEvent === "done" ? "installed" : "install_failed") }
  ]);
  setButtonsDisabled(false);
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function openTaskDetail(taskId, payload = null) {
  if (payload?.openWindow) {
    await window.ucaShell?.showWindow?.(payload.openWindow);
    closeCard("opened_detail");
    return;
  }
  if (!taskId) {
    await window.ucaShell?.showWindow?.("console");
    return;
  }
  await window.ucaShell?.navigateConsole?.({ tab: "tasks", taskId });
  closeCard("opened_detail");
}

pinBtn.addEventListener("click", () => {
  state.pinned = !state.pinned;
  pinBtn.classList.toggle("is-active", state.pinned);
  if (state.pinned) {
    clearAutoHide();
  }
  window.ucaShell?.togglePopupCardPin?.(state.cardId, state.pinned);
});

closeBtn.addEventListener("click", () => closeCard("user"));

window.ucaShell?.onPopupCardInit?.((payload) => {
  if (!payload) return;
  if (payload.cardId && payload.cardId !== state.cardId) return;
  applyInit(payload);
});
