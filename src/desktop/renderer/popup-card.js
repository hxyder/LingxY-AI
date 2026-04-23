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
  autoHideTimer: null
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
  } else {
    renderActions([{ label: "好", variant: "primary", onClick: () => closeCard("dismissed") }]);
    scheduleAutoHide(payload?.autoHideMs ?? 6000);
  }

  requestAnimationFrame(() => cardEl.classList.add("show"));
}

function defaultTitleFor(kind) {
  if (kind === "approval") return "等待确认";
  if (kind === "success") return "已完成";
  if (kind === "error") return "任务失败";
  return "LingxY";
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
