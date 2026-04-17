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
const clearBtn = document.getElementById("clearBtn");

const COMMON_ACTIONS = [
  { label: "📝 总结要点", command: "请用要点总结下面的内容，输出简洁的 markdown。" },
  { label: "✏️ 改写得更清晰", command: "请把下面的内容改写得更清晰流畅，保留原意。" },
  { label: "🌐 翻译成英文", command: "请把下面的内容翻译成地道的英文。" }
];

// Host-specific top suggestion — ranked first so it's the thing users try
// first when they open the task pane in that app.
const HOST_ACTIONS = {
  Excel: [
    { label: "🧮 生成公式", command: "基于我当前选中的 Excel 范围，帮我生成一个 Excel 公式来完成需要的计算。**只输出一行公式，以等号开头，不要加任何解释或代码块**。" },
    { label: "🔍 审阅数据", command: "审阅我选中的 Excel 数据，指出异常/缺失/格式不一致的地方，按行号列出。" }
  ],
  PowerPoint: [
    { label: "🎞️ 从大纲生成幻灯片", command: "请根据下面的内容，生成一份 PowerPoint 大纲。每张幻灯片一个以 `#` 开头的标题行，接若干要点（每行一点，短句）。不要其他解释。" },
    { label: "🎤 写演讲备注", command: "为当前幻灯片的要点写出演讲者备注，自然口语，每条备注 1-2 句。" }
  ],
  Word: [
    { label: "💬 审阅并建议（批注形式）", command: "审阅下面的内容，指出具体可改进的地方，输出简洁的中文建议 —— 将被以批注形式插入文档。" },
    { label: "📋 生成大纲", command: "为下面的长文生成一份分层大纲（用 markdown 标题级别体现结构）。" }
  ]
};

function currentQuickActions() {
  const host = latestSelection?.officeApp ?? "Office";
  const hostSpecific = HOST_ACTIONS[host] ?? [];
  return [...hostSpecific, ...COMMON_ACTIONS];
}

/** @type {{role:"user"|"assistant"|"system", text:string, applyable?:boolean}[]} */
const messages = [];
let latestSelection = null;
let currentScope = "selection"; // "selection" | "document"
let submitting = false;

// Conversation persistence: Office.document.settings is a key/value store
// that rides with the document. We stash the last ~30 turns so reopening the
// file restores context — and "clear" wipes just that document's scrollback.
const SETTINGS_KEY = "uca.conversation.v1";
const MEMORY_MAX_MESSAGES = 30;

function loadConversation() {
  try {
    const settings = globalThis.Office?.context?.document?.settings;
    const raw = settings?.get?.(SETTINGS_KEY);
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && typeof m.role === "string" && typeof m.text === "string")
      .slice(-MEMORY_MAX_MESSAGES);
  } catch {
    return [];
  }
}

let saveConversationTimer = null;
function saveConversation() {
  // Debounce: settings.saveAsync is a real async I/O on Office's side, and we
  // update the array on every keystroke when streaming. One save per second
  // is plenty.
  clearTimeout(saveConversationTimer);
  saveConversationTimer = setTimeout(() => {
    const settings = globalThis.Office?.context?.document?.settings;
    if (!settings?.set || !settings?.saveAsync) return;
    try {
      const trimmed = messages
        .filter((m) => m.role === "user" || (m.role === "assistant" && !m.streaming))
        .slice(-MEMORY_MAX_MESSAGES)
        .map(({ role, text }) => ({ role, text }));
      settings.set(SETTINGS_KEY, JSON.stringify(trimmed));
      settings.saveAsync(() => {}); // fire-and-forget
    } catch { /* ignore */ }
  }, 1000);
}

function clearConversation() {
  messages.length = 0;
  const settings = globalThis.Office?.context?.document?.settings;
  try {
    settings?.remove?.(SETTINGS_KEY);
    settings?.saveAsync?.(() => {});
  } catch { /* ignore */ }
  renderMessages();
}

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
  const chips = currentQuickActions().map((qa) =>
    el("button", {
      className: "empty-chip",
      type: "button",
      onclick: () => submit(qa.command)
    }, qa.label)
  );
  const host = latestSelection?.officeApp ?? "Office";
  chatEl.appendChild(el("div", { className: "empty" }, [
    el("h2", { textContent: `UCA for ${host}` }),
    el("p", { textContent: "告诉我你要做什么 —— 或从下面选一个开始。" }),
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

// Lightweight content detection so we only show the relevant apply button
// per response instead of piling every possible action onto every message.
function looksLikeFormula(text) {
  if (!text) return false;
  const first = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return /^=\s*[A-Z_]+\s*\(/i.test(first) || /^=\s*[A-Z_]+/i.test(first);
}
function looksLikeOutline(text) {
  if (!text) return false;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith("#"));
  return lines.length >= 2;
}

function renderMessageNode(msg) {
  const wrapper = el("div", { className: `msg ${msg.role}` });
  if (msg.streaming) wrapper.classList.add("streaming");
  wrapper.appendChild(el("div", { className: "msg-body", textContent: msg.text || " " }));

  if (msg.role === "assistant" && msg.text && !msg.streaming) {
    const actions = el("div", { className: "msg-actions" });
    const host = latestSelection?.officeApp;
    const canWriteBack = host !== undefined;

    // Host-aware primary action — the one the user most likely wants.
    if (host === "Excel" && looksLikeFormula(msg.text)) {
      actions.appendChild(iconBtn("🧮 插入公式", "写入当前选中单元格", () => applyFormula(msg.text)));
    }
    if (host === "PowerPoint" && looksLikeOutline(msg.text)) {
      actions.appendChild(iconBtn("🎞️ 生成幻灯片", "按大纲创建新幻灯片", () => applyOutline(msg.text)));
    }
    if (host === "Word") {
      actions.appendChild(iconBtn("💬 作为批注", "以批注形式插入（不覆盖正文）", () => applyComment(msg.text)));
    }

    // Generic writeback (text-level replacement) — still useful for
    // summaries / translations the user wants pasted in.
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
  saveConversation();
  return msg;
}

function updateMessage(msg, patch) {
  Object.assign(msg, patch);
  renderMessages();
  // Only persist once streaming settles; noisy intermediate saves hurt perf.
  if (!msg.streaming) saveConversation();
}

// Fold recent user/assistant turns into the user command so follow-up
// questions ("再短点", "改成英文") get resolved against what was just
// discussed. We cap at 6 prior turns to keep the prompt tight.
function buildCommandWithHistory(latestCommand) {
  const prior = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text && !m.streaming)
    .slice(-6);
  if (prior.length === 0) return latestCommand;

  const lines = prior.map((m) => {
    const tag = m.role === "user" ? "用户" : "UCA";
    // Truncate each prior turn so context doesn't explode.
    const snippet = m.text.length > 600 ? `${m.text.slice(0, 600)}…` : m.text;
    return `[${tag}] ${snippet}`;
  });
  return `以下是之前的对话历史（供参考，用户新指令在最后）：\n${lines.join("\n\n")}\n\n新指令：${latestCommand}`;
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

  const effectiveCommand = buildCommandWithHistory(command);

  try {
    const result = await bridge.submitSelection(effectiveCommand, latestSelection);
    const taskId = result.task?.task_id;
    if (!taskId) {
      updateMessage(assistant, { text: "（任务未返回 task_id — 可能服务未就绪。）", streaming: false });
      return;
    }
    await streamTask(taskId, assistant);
  } catch (error) {
    updateMessage(assistant, { text: `⚠️ 出错了：${error?.message ?? error}`, streaming: false });
  } finally {
    submitting = false;
    sendBtn.disabled = inputArea.value.trim().length === 0;
  }
}

// Stream task events via SSE — users see the reply materialise word-by-word
// instead of waiting 2s+ for the next poll. Resolves once the server emits a
// terminal event (success / failed / cancelled / unsupported).
function streamTask(taskId, assistantMsg) {
  return new Promise((resolve) => {
    const url = `${RUNTIME_BASE_URL}/task/${taskId}/events`;
    // Some Office hosts use a stripped Chromium without EventSource — fall
    // back to a minimal fetch streaming reader in that case.
    if (typeof EventSource !== "function") {
      resolve(fallbackStreamTask(taskId, assistantMsg));
      return;
    }
    const src = new EventSource(url);
    let latestInline = "";
    let done = false;

    const finish = (finalText, ok = true) => {
      if (done) return;
      done = true;
      try { src.close(); } catch { /* ignore */ }
      updateMessage(assistantMsg, {
        text: finalText || assistantMsg.text || (ok ? "（没有返回内容）" : ""),
        streaming: false
      });
      resolve();
    };

    src.onmessage = (ev) => {
      let event;
      try { event = JSON.parse(ev.data); } catch { return; }

      const type = event?.event_type;
      const payloadText = event?.payload?.text;

      if (type === "inline_result" && typeof payloadText === "string" && payloadText.length > 0) {
        latestInline = payloadText;
        assistantMsg.text = payloadText;
        renderMessages();
        return;
      }

      if (type === "status_update" && event?.payload?.sub_status) {
        if (!latestInline) {
          assistantMsg.text = `…${event.payload.sub_status}`;
          renderMessages();
        }
        return;
      }

      if (type === "success") {
        finish(latestInline || payloadText || assistantMsg.text);
        return;
      }

      if (type === "failed" || type === "cancelled" || type === "unsupported") {
        const why = event?.payload?.failure_user_message ?? event?.payload?.reason ?? type;
        finish(`⚠️ ${why}`, false);
      }
    };

    src.onerror = () => {
      if (done) return;
      // Server closed (end-of-stream) without a terminal event — fetch the
      // task summary once to grab the final state.
      src.close();
      fetch(`${RUNTIME_BASE_URL}/task/${taskId}`).then((r) => r.json()).then((detail) => {
        const task = detail.task ?? {};
        const events = detail.events ?? [];
        const inline = [...events].reverse().find((e) =>
          (e.event_type === "inline_result" || e.event_type === "success")
          && typeof e.payload?.text === "string" && e.payload.text.length > 0
        );
        const text = inline?.payload?.text ?? task.result_preview ?? latestInline ?? "任务已结束但没有可预览内容。";
        finish(text);
      }).catch(() => finish(latestInline || "⚠️ 连接中断。", false));
    };

    // Safety timeout — 3 minutes. If the task is still running past this,
    // we stop streaming but leave the message in-place; user can open the
    // console for details.
    setTimeout(() => {
      if (!done) finish(latestInline || "等待结果超时。打开 UCA 主控制台查看任务详情。", false);
    }, 180_000);
  });
}

// Fallback for environments without EventSource — uses fetch + text chunks.
async function fallbackStreamTask(taskId, assistantMsg) {
  try {
    const response = await fetch(`${RUNTIME_BASE_URL}/task/${taskId}/events`, {
      headers: { Accept: "text/event-stream" }
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no_reader");
    const decoder = new TextDecoder();
    let buffer = "";
    let latestInline = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        const text = event?.payload?.text;
        if (event?.event_type === "inline_result" && typeof text === "string" && text.length > 0) {
          latestInline = text;
          assistantMsg.text = text;
          renderMessages();
        } else if (event?.event_type === "success") {
          updateMessage(assistantMsg, { text: latestInline || text || assistantMsg.text, streaming: false });
          return;
        } else if (["failed", "cancelled", "unsupported"].includes(event?.event_type)) {
          const why = event?.payload?.failure_user_message ?? event?.event_type;
          updateMessage(assistantMsg, { text: `⚠️ ${why}`, streaming: false });
          return;
        }
      }
    }
    updateMessage(assistantMsg, { text: latestInline || "（流关闭时没有内容）", streaming: false });
  } catch (err) {
    updateMessage(assistantMsg, { text: `⚠️ ${err?.message ?? err}`, streaming: false });
  }
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

async function applyFormula(text) {
  try {
    const result = await bridge.insertFormula(text);
    if (result.ok) {
      flashHint(`已写入 ${result.address ?? "当前单元格"}`);
    } else {
      pushMessage("system", `插入公式失败：${result.error ?? "unknown"}`);
    }
  } catch (error) {
    pushMessage("system", `插入公式出错：${error?.message ?? error}`);
  }
}

async function applyComment(text) {
  try {
    const result = await bridge.insertReviewComment(text);
    if (result.ok) {
      flashHint(result.mode === "comment" ? "已作为批注插入" : "已插入为行内标记");
    } else {
      pushMessage("system", `插入批注失败：${result.error ?? "unknown"}`);
    }
  } catch (error) {
    pushMessage("system", `插入批注出错：${error?.message ?? error}`);
  }
}

async function applyOutline(text) {
  try {
    const result = await bridge.insertOutline(text);
    if (result.ok) {
      flashHint(`已创建 ${result.count} 张幻灯片`);
    } else {
      pushMessage("system", `生成幻灯片失败：${result.error ?? "unknown"}`);
    }
  } catch (error) {
    pushMessage("system", `生成幻灯片出错：${error?.message ?? error}`);
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
clearBtn?.addEventListener("click", () => {
  if (messages.length === 0) return;
  clearConversation();
});

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
  // Restore prior conversation for this document before we render — users
  // picking up where they left off should never see an empty state after a
  // reopen.
  const saved = loadConversation();
  if (saved.length > 0) messages.push(...saved);
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
