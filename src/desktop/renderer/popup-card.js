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
  payload: null,
  autoHideTimer: null,
  autoHideMs: 0,
  interacting: false,
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

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value = "") {
  const placeholders = [];
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const token = `@@CODE_${placeholders.length}@@`;
    placeholders.push(`<code>${code}</code>`);
    return token;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, href) =>
    `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
  );
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, prefix, href) =>
    `${prefix}<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`
  );
  placeholders.forEach((snippet, index) => {
    html = html.replace(`@@CODE_${index}@@`, snippet);
  });
  return html;
}

function markdownBlockFor(line = "", index = 0) {
  const text = String(line ?? "").trimEnd();
  if (!text.trim()) return `<div class="pc-md-spacer" aria-hidden="true"></div>`;
  const heading = text.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    return `<div class="pc-md-heading pc-md-h${level}">${renderInlineMarkdown(heading[2])}</div>`;
  }
  const bullet = text.match(/^[-*]\s+(.+)$/);
  if (bullet) return `<div class="pc-md-bullet"><span></span><p>${renderInlineMarkdown(bullet[1])}</p></div>`;
  const numbered = text.match(/^\d+[.)]\s+(.+)$/);
  if (numbered) return `<div class="pc-md-numbered"><span>${index + 1}</span><p>${renderInlineMarkdown(numbered[1])}</p></div>`;
  return `<div class="${index === 0 ? "pc-body-primary" : "pc-body-sub"}">${renderInlineMarkdown(text)}</div>`;
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
  state.autoHideMs = Number(ms) || 0;
  if (!state.autoHideMs || state.pinned || state.interacting) return;
  state.autoHideTimer = setTimeout(() => {
    closeCard("auto_hide");
  }, state.autoHideMs);
}

function pauseAutoHide() {
  state.interacting = true;
  clearAutoHide();
}

function resumeAutoHide() {
  state.interacting = false;
  if (state.autoHideMs && !state.pinned && !state.resolved) {
    scheduleAutoHide(state.autoHideMs);
  }
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
  const raw = Array.isArray(lines) ? lines.join("\n") : String(lines ?? "");
  const items = raw.split(/\r?\n/);
  const fragment = document.createElement("div");
  fragment.className = "pc-md";
  fragment.innerHTML = items.map((item, i) => markdownBlockFor(item, i)).join("");
  bodyEl.appendChild(fragment);
  bodyEl.scrollTop = 0;
}

function renderActions(buttons = []) {
  actionsEl.innerHTML = "";
  const seenLabels = new Set();
  for (const spec of buttons) {
    const label = String(spec?.label ?? "").trim();
    const isPager = label === "‹" || label === "›";
    if (label && !isPager) {
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
    }
    actionsEl.appendChild(makeButton(spec));
  }
}

// 83.2 — Batched notification state. When kind === "batched", we hold the
// entries array here and let prev/next nav switch which entry is currently
// rendered. Kept in module state so an in-flight re-init (same dedupeKey)
// can append entries without losing the user's currentIndex.
const batchState = {
  entries: [],
  currentIndex: 0,
  taskId: null
};

function renderBatchedEntry() {
  const entry = batchState.entries[batchState.currentIndex];
  if (!entry) return;
  cardEl.setAttribute("data-kind", entry.kind || "info");
  setText(titleEl, `${entry.title ?? "LingxY"}  ${batchState.currentIndex + 1}/${batchState.entries.length}`);
  renderBody(entry.lines ?? []);
  const buttons = [];
  // Pagination — hidden when there's only one entry (caller already routes
  // single-entry batches through the plain "info" kind, but guard here too).
  if (batchState.entries.length > 1) {
    buttons.push({
      label: "‹", variant: "ghost",
      onClick: () => {
        batchState.currentIndex =
          (batchState.currentIndex - 1 + batchState.entries.length) % batchState.entries.length;
        renderBatchedEntry();
      }
    });
    buttons.push({
      label: "›", variant: "ghost",
      onClick: () => {
        batchState.currentIndex = (batchState.currentIndex + 1) % batchState.entries.length;
        renderBatchedEntry();
      }
    });
  }
  // Per-entry action (artifact → 预览, conversational → 查看详情, fallback → 好)
  if (entry.artifactPath) {
    buttons.push({
      label: "预览",
      variant: "primary",
      onClick: () => resolveCard("preview", { artifactPath: entry.artifactPath, mime: entry.mime ?? null })
    });
    if (entry.openWindow === "overlay" || entry.handoff) {
      buttons.push({
        label: "打开对话框",
        variant: "ghost",
        onClick: () => resolveCard("open_overlay", {
          taskId: entry.taskId ?? batchState.taskId ?? null,
          artifactPath: entry.artifactPath,
          mime: entry.mime ?? null,
          inlinePreview: entry.inlinePreview ?? null,
          handoff: entry.handoff ?? null,
          title: entry.title ?? null,
          lines: entry.lines ?? null
        })
      });
    }
  } else {
    buttons.push({
      label: entry.openWindow === "overlay" ? "打开对话框" : "查看详情",
      variant: "primary",
      onClick: () => entry.openWindow === "overlay" || entry.handoff
        ? resolveCard("open_overlay", {
            taskId: entry.taskId ?? batchState.taskId ?? null,
            inlinePreview: entry.inlinePreview ?? null,
            handoff: entry.handoff ?? null,
            title: entry.title ?? null,
            lines: entry.lines ?? null
          })
        : openTaskDetail(batchState.taskId, entry)
    });
  }
  if (entry.inlinePreview || entry.artifactPath) {
    buttons.push({
      label: "复制",
      variant: "ghost",
      onClick: () => resolveCard("copy", {
        artifactPath: entry.artifactPath ?? null,
        inlinePreview: entry.inlinePreview ?? null
      })
    });
  }
  if (entry.allowContinue !== false) {
    buttons.push({
      label: "继续追问",
      variant: "ghost",
      onClick: () => resolveCard("continue", {
        taskId: entry.taskId ?? batchState.taskId ?? null,
        conversationId: entry.conversationId ?? null
      })
    });
  }
  buttons.push({ label: "关闭", variant: "ghost", onClick: () => closeCard("dismissed") });
  renderActions(buttons);
  measureAndResize();
}

function applyInit(payload) {
  const kind = payload?.kind ?? "info";
  state.resolved = false;
  state.interacting = false;
  state.kind = kind;
  state.payload = payload ?? null;
  cardEl.setAttribute("data-kind", kind);
  setText(titleEl, payload?.title ?? defaultTitleFor(kind));

  // 83.2 — Batched kind: hold entries in module state, render by index, let
  // the user page through with ‹ ›. Skip the normal renderBody because the
  // body is re-rendered per entry.
  if (kind === "batched") {
    const incoming = Array.isArray(payload?.entries) ? payload.entries : [];
    if (batchState.taskId && batchState.taskId === payload?.taskId) {
      // Same task re-fired (dedupeKey hit) — append new entries rather than
      // resetting the carousel so the user's current view is preserved.
      for (const e of incoming) {
        const alreadyPresent = batchState.entries.some((existing) =>
          existing.addedAt === e.addedAt && existing.title === e.title
        );
        if (!alreadyPresent) batchState.entries.push(e);
      }
    } else {
      batchState.entries = incoming.slice();
      batchState.currentIndex = 0;
      batchState.taskId = payload?.taskId ?? null;
    }
    renderBatchedEntry();
    scheduleAutoHide(payload?.autoHideMs ?? 12000);
    requestAnimationFrame(() => {
      cardEl.classList.add("show");
      measureAndResize();
      setTimeout(measureAndResize, 260);
    });
    return;
  }

  renderBody(payload?.lines ?? payload?.body ?? []);
  const detailLabel = payload?.openWindow === "overlay" ? "打开对话框" : "查看详情";

  if (kind === "approval") {
    renderActions([
      { label: "拒绝", variant: "danger", onClick: () => resolveCard("reject") },
      { label: detailLabel, variant: "ghost", onClick: () => openTaskDetail(payload?.taskId, payload) },
      { label: "通过", variant: "primary", onClick: () => resolveCard("approve") }
    ]);
  } else if (kind === "success") {
    // UCA-182 Phase 8: success cards now carry artifact actions. When
    // payload.artifactPath is present we expose 预览 / 打开文件夹 /
    // 复制 alongside the usual "继续追问" handoff. This is the sole
    // replacement for the retired result-toast (overlay bottom-center).
    const hasArtifact = Boolean(payload?.artifactPath);
    const hasInline = Boolean(payload?.inlinePreview || payload?.artifactPath);
    const shouldOpenOverlay = payload?.openWindow === "overlay" || payload?.handoff;
    const buttons = [];
    if (hasArtifact) {
      buttons.push({ label: "预览", variant: "primary", onClick: () => resolveCard("preview", { artifactPath: payload.artifactPath, mime: payload.mime ?? null }) });
      buttons.push({ label: "打开文件夹", variant: "ghost", onClick: () => resolveCard("reveal", { artifactPath: payload.artifactPath }) });
    } else if (!shouldOpenOverlay) {
      buttons.push({ label: detailLabel, variant: "ghost", onClick: () => openTaskDetail(payload?.taskId, payload) });
    }
    if (shouldOpenOverlay) {
      buttons.push({
        label: "打开对话框",
        variant: hasArtifact ? "ghost" : "primary",
        onClick: () => resolveCard("open_overlay", {
          taskId: payload?.taskId ?? null,
          artifactPath: payload?.artifactPath ?? null,
          mime: payload?.mime ?? null,
          inlinePreview: payload?.inlinePreview ?? null,
          handoff: payload?.handoff ?? null,
          title: payload?.title ?? null,
          lines: payload?.lines ?? null
        })
      });
    }
    if (hasInline) {
      buttons.push({ label: "复制", variant: "ghost", onClick: () => resolveCard("copy", { artifactPath: payload?.artifactPath ?? null, inlinePreview: payload?.inlinePreview ?? null }) });
    }
    if (payload?.allowContinue !== false) {
      buttons.push({ label: "继续追问", variant: "ghost", onClick: () => resolveCard("continue", {
        taskId: payload?.taskId ?? null,
        conversationId: payload?.conversationId ?? null
      }) });
    }
    if (buttons.length === 0) {
      buttons.push({ label: "好", variant: "primary", onClick: () => closeCard("dismissed") });
    }
    renderActions(buttons);
    scheduleAutoHide(payload?.autoHideMs ?? 10000);
  } else if (kind === "error") {
    renderActions([
      { label: "查看日志", variant: "ghost", onClick: () => resolveCard("view_log", { taskId: payload?.taskId ?? null }) },
      { label: detailLabel, variant: "ghost", onClick: () => openTaskDetail(payload?.taskId, payload) },
      { label: "关闭", variant: "primary", onClick: () => closeCard("dismissed") }
    ]);
    scheduleAutoHide(payload?.autoHideMs ?? 12000);
  } else {
    const buttons = [];
    const shouldOpenOverlay = payload?.openWindow === "overlay" || payload?.handoff;
    if (payload?.artifactPath) {
      buttons.push({ label: "预览", variant: "primary", onClick: () => resolveCard("preview", { artifactPath: payload.artifactPath, mime: payload.mime ?? null }) });
      buttons.push({ label: "打开文件夹", variant: "ghost", onClick: () => resolveCard("reveal", { artifactPath: payload.artifactPath }) });
    }
    if (shouldOpenOverlay) {
      buttons.push({
        label: "打开对话框",
        variant: buttons.length ? "ghost" : "primary",
        onClick: () => resolveCard("open_overlay", {
          taskId: payload?.taskId ?? null,
          artifactPath: payload?.artifactPath ?? null,
          mime: payload?.mime ?? null,
          inlinePreview: payload?.inlinePreview ?? null,
          handoff: payload?.handoff ?? null,
          title: payload?.title ?? null,
          lines: payload?.lines ?? null
        })
      });
    }
    if ((payload?.taskId || payload?.openWindow) && !shouldOpenOverlay) {
      buttons.push({ label: detailLabel, variant: buttons.length ? "ghost" : "primary", onClick: () => openTaskDetail(payload?.taskId, payload) });
    }
    if (payload?.inlinePreview || payload?.artifactPath) {
      buttons.push({ label: "复制", variant: "ghost", onClick: () => resolveCard("copy", { artifactPath: payload?.artifactPath ?? null, inlinePreview: payload?.inlinePreview ?? null }) });
    }
    buttons.push({ label: "好", variant: buttons.length ? "ghost" : "primary", onClick: () => closeCard("dismissed") });
    renderActions(buttons);
    scheduleAutoHide(payload?.autoHideMs ?? 6000);
  }

  requestAnimationFrame(() => {
    cardEl.classList.add("show");
    measureAndResize();
    // one more pass after the transition so button metrics settle
    setTimeout(measureAndResize, 260);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || state.resolved) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (`${event.key ?? ""}`.toLowerCase() !== "v") return;
  const payload = state.payload ?? {};
  if (payload.allowContinue === false) return;
  const taskId = payload.taskId ?? batchState.entries[batchState.currentIndex]?.taskId ?? batchState.taskId ?? null;
  if (!taskId) return;
  event.preventDefault();
  void resolveCard("voice_continue", {
    taskId,
    conversationId: payload.conversationId ?? batchState.entries[batchState.currentIndex]?.conversationId ?? null
  });
});

function defaultTitleFor(kind) {
  if (kind === "approval") return "等待确认";
  if (kind === "success") return "已完成";
  if (kind === "error") return "任务失败";
  if (kind === "batched") return "LingxY";
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

cardEl.addEventListener("pointerenter", pauseAutoHide);
cardEl.addEventListener("pointerleave", resumeAutoHide);
cardEl.addEventListener("focusin", pauseAutoHide);
cardEl.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!cardEl.contains(document.activeElement)) resumeAutoHide();
  }, 0);
});

let scrollResumeTimer = null;
bodyEl.addEventListener("scroll", () => {
  pauseAutoHide();
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  scrollResumeTimer = setTimeout(() => {
    if (!cardEl.matches(":hover") && !cardEl.contains(document.activeElement)) {
      resumeAutoHide();
    }
  }, 1800);
}, { passive: true });

window.ucaShell?.onPopupCardInit?.((payload) => {
  if (!payload) return;
  if (payload.cardId && payload.cardId !== state.cardId) return;
  applyInit(payload);
});
