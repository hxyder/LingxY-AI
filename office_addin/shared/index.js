// UCA Office task pane — chat-first UI.
//
// Design intent (post-redesign): act like Copilot / Claude in Office. One
// conversation scrollback, one composer with a single scope chip, no pile of
// "capture / refresh / analyze-whole / replace / insert / copy" buttons. Quick
// actions appear only in the empty state; after the first exchange the user
// drives everything from text input + inline per-message actions.
//
// The bridge API (captureSelection / submitSelection / writeResult) is
// unchanged — this rewrite only touches presentation + conversation state.

import { createOfficeBridge } from "./office_bridge.js";

const RUNTIME_BASE_URL = "http://127.0.0.1:4310";
const bridge = createOfficeBridge();

const chatEl = document.getElementById("chat");
const inputArea = document.getElementById("inputArea");
const sendBtn = document.getElementById("sendBtn");
const scopeChip = document.getElementById("scopeChip");
const scopeLabel = document.getElementById("scopeLabel");
const headerHost = document.getElementById("headerHost");

const QUICK_ACTIONS = [
  { label: "📝 总结要点", command: "请用要点总结下面的内容，输出简洁的 markdown。" },
  { label: "✏️ 改写得更清晰", command: "请把下面的内容改写得更清晰流畅，保留原意。" },
  { label: "🌐 翻译成英文", command: "请把下面的内容翻译成地道的英文。" },
  { label: "🔍 审阅并建议", command: "请审阅下面的内容，指出问题并给出改进建议。" }
];

/** @type {{role:"user"|"assistant"|"system", text:string, applyable?:boolean}[]} */
const messages = [];
let latestSelection = null;
let currentScope = "selection"; // "selection" | "document"
let submitting = false;

/* ═══════════════════════════════════════════════
   SELECTION / SCOPE
   ═══════════════════════════════════════════════ */

function humanChars(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function renderScopeChip() {
  const selText = (latestSelection?.selectionText ?? "").trim();
  scopeChip.classList.toggle("document", currentScope === "document");

  if (currentScope === "document") {
    scopeLabel.textContent = "整份文档";
  } else if (selText.length > 0) {
    scopeLabel.textContent = `选中 · ${humanChars(selText.length)} 字`;
  } else {
    scopeLabel.textContent = "暂无选中";
  }
}

async function refreshSelection(scope = currentScope) {
  currentScope = scope;
  try {
    latestSelection = await bridge.captureSelection({ scope });
    headerHost.textContent = latestSelection?.officeApp ?? "Office";
  } catch {
    /* leave last-known selection */
  }
  renderScopeChip();
  return latestSelection;
}

async function toggleScope() {
  const next = currentScope === "selection" ? "document" : "selection";
  await refreshSelection(next);
}

/* ═══════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════ */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "textContent") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => { chatEl.scrollTop = chatEl.scrollHeight; });
}

function renderEmptyState() {
  chatEl.innerHTML = "";
  const chips = QUICK_ACTIONS.map((qa) =>
    el("button", {
      className: "empty-chip",
      type: "button",
      onclick: () => submit(qa.command)
    }, qa.label)
  );
  const host = latestSelection?.officeApp ?? "Office";
  chatEl.appendChild(el("div", { className: "empty" }, [
    el("h2", { textContent: `UCA for ${host}` }),
    el("p", { textContent: "告诉我你要做什么 —— 总结、改写、翻译、审阅都行。" }),
    el("div", { className: "empty-chips" }, chips)
  ]));
}

function renderMessages() {
  if (messages.length === 0) {
    renderEmptyState();
    return;
  }
  chatEl.innerHTML = "";
  for (const msg of messages) {
    chatEl.appendChild(renderMessageNode(msg));
  }
  scrollChatToBottom();
}

function renderMessageNode(msg) {
  const wrapper = el("div", { className: `msg ${msg.role}` });
  if (msg.streaming) wrapper.classList.add("streaming");
  wrapper.appendChild(el("div", { className: "msg-body", textContent: msg.text || " " }));

  if (msg.role === "assistant" && msg.text && !msg.streaming) {
    const actions = el("div", { className: "msg-actions" });

    // Apply buttons only visible when writeback makes sense — we always keep
    // Copy available; Replace/Insert depend on whether Office host has a
    // writable selection.
    const canWriteBack = latestSelection && latestSelection.officeApp !== undefined;

    if (canWriteBack && currentScope === "selection") {
      actions.appendChild(iconBtn("↩ 替换选中", "替换当前选中内容", () => applyResult(msg.text, "replace_selection")));
    }
    if (canWriteBack) {
      actions.appendChild(iconBtn("↓ 插入", "在光标位置插入", () => applyResult(msg.text, "insert_with_label")));
    }
    actions.appendChild(iconBtn("⧉ 复制", "复制到剪贴板", async () => {
      await navigator.clipboard?.writeText(msg.text);
      flashHint("已复制");
    }));
    wrapper.appendChild(actions);
  }

  return wrapper;
}

function iconBtn(label, title, onclick) {
  return el("button", {
    className: "icon-btn",
    type: "button",
    title,
    onclick
  }, label);
}

function flashHint(text) {
  const original = scopeLabel.textContent;
  scopeLabel.textContent = text;
  setTimeout(() => { renderScopeChip(); }, 1200);
}

/* ═══════════════════════════════════════════════
   SUBMIT + POLL
   ═══════════════════════════════════════════════ */

function pushMessage(role, text, opts = {}) {
  const msg = { role, text, ...opts };
  messages.push(msg);
  renderMessages();
  return msg;
}

function updateMessage(msg, patch) {
  Object.assign(msg, patch);
  renderMessages();
}

async function submit(userCommand) {
  const command = (userCommand ?? inputArea.value).trim();
  if (!command || submitting) return;
  submitting = true;
  sendBtn.disabled = true;
  inputArea.value = "";
  autosizeInput();

  // Always refresh selection before submitting so the model sees the latest
  // state — cheap on Office, saves stale-capture confusion.
  await refreshSelection(currentScope);

  pushMessage("user", command);
  const assistant = pushMessage("assistant", "", { streaming: true });

  try {
    const result = await bridge.submitSelection(command, latestSelection);
    const taskId = result.task?.task_id;
    if (!taskId) {
      updateMessage(assistant, { text: "（任务未返回 task_id — 可能服务未就绪。）", streaming: false });
      return;
    }
    await pollTask(taskId, assistant);
  } catch (error) {
    updateMessage(assistant, { text: `⚠️ 出错了：${error?.message ?? error}`, streaming: false });
  } finally {
    submitting = false;
    sendBtn.disabled = inputArea.value.trim().length === 0;
  }
}

async function pollTask(taskId, assistantMsg) {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const response = await fetch(`${RUNTIME_BASE_URL}/task/${taskId}`);
      const detail = await response.json();
      const task = detail.task ?? {};

      if (task.status === "success" || task.status === "partial_success") {
        const events = detail.events ?? [];
        const inlineEvent = [...events].reverse().find((ev) =>
          (ev.event_type === "inline_result" || ev.event_type === "success")
          && typeof ev.payload?.text === "string" && ev.payload.text.length > 0
        );
        const text = inlineEvent?.payload?.text ?? task.result_preview ?? "任务已完成但没有返回可预览的文本。";
        updateMessage(assistantMsg, { text, streaming: false });
        return;
      }

      if (["failed", "cancelled", "unsupported"].includes(task.status)) {
        const why = task.failure_user_message ?? task.sub_status ?? task.status;
        updateMessage(assistantMsg, { text: `⚠️ ${why}`, streaming: false });
        return;
      }

      // still running — refresh tick; streaming indicator stays
      if (task.sub_status) assistantMsg.text = `…${task.sub_status}`;
      renderMessages();
    } catch {
      /* transient — retry */
    }
  }
  updateMessage(assistantMsg, { text: "等待结果超时。打开 UCA 主控制台查看任务详情。", streaming: false });
}

async function applyResult(text, mode) {
  if (!text) return;
  try {
    const result = await bridge.writeResult(text, { mode });
    if (result.ok) {
      flashHint(mode === "replace_selection" ? "已替换" : "已插入");
    } else {
      pushMessage("system", `写回失败：${result.error ?? "unknown"}`);
    }
  } catch (error) {
    pushMessage("system", `写回出错：${error?.message ?? error}`);
  }
}

/* ═══════════════════════════════════════════════
   INPUT BEHAVIOR
   ═══════════════════════════════════════════════ */

function autosizeInput() {
  inputArea.style.height = "auto";
  inputArea.style.height = `${Math.min(inputArea.scrollHeight, 120)}px`;
}

inputArea.addEventListener("input", () => {
  sendBtn.disabled = submitting || inputArea.value.trim().length === 0;
  autosizeInput();
});
inputArea.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
});
sendBtn.addEventListener("click", () => void submit());
scopeChip.addEventListener("click", () => void toggleScope());

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshSelection(currentScope);
});

/* ═══════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════ */

async function boot() {
  if (globalThis.Office?.onReady) {
    await globalThis.Office.onReady();
  }
  await refreshSelection("selection");
  renderMessages();

  // Keep selection fresh in the chip while user is still composing. Stops
  // polling once user is mid-scroll through a long conversation.
  setInterval(() => {
    if (currentScope === "selection" && messages.length < 20) {
      void refreshSelection("selection");
    }
  }, 3500);
}

void boot();
