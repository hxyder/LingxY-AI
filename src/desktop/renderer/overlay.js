const overlayState = document.querySelector("#overlayState");
const overlayCommand = document.querySelector("#overlayCommand");
const overlayContext = document.querySelector("#overlayContext");
const overlayResult = document.querySelector("#overlayResult");
const submitButton = document.querySelector("#submitButton");
const closeButton = document.querySelector("#closeButton");
const openConsoleButton = document.querySelector("#openConsoleButton");
const pasteClipboardButton = document.querySelector("#pasteClipboardButton");
const clearContextButton = document.querySelector("#clearContextButton");
const recentTaskCard = document.querySelector("#recentTaskCard");
const quickActions = [...document.querySelectorAll(".quick-action")];

let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";
let activeTaskId = null;
let lastTask = null;

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${serviceBaseUrl}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? pathname);
  }
  return payload;
}

async function refreshStatus() {
  try {
    const shell = await window.ucaShell.getShellStatus();
    serviceBaseUrl = shell.serviceBaseUrl ?? serviceBaseUrl;
    await fetchJson("/health");
    overlayState.textContent = "Runtime ready";
    overlayState.className = "chip ready";
  } catch (error) {
    overlayState.textContent = `Runtime unavailable · ${error.message}`;
    overlayState.className = "chip danger";
  }
}

function renderRecentTask(task = null) {
  if (!recentTaskCard) {
    return;
  }

  if (!task) {
    recentTaskCard.innerHTML = `
      <span class="eyebrow">Recent Task</span>
      <strong>最近任务</strong>
      <p class="muted">还没有任务。</p>
    `;
    return;
  }

  const summary = task.userCommand ?? task.prompt ?? "已提交任务";
  const status = task.status ?? "queued";
  recentTaskCard.replaceChildren();

  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Recent Task";

  const title = document.createElement("strong");
  title.textContent = summary;

  const taskIdLine = document.createElement("p");
  taskIdLine.className = "muted";
  taskIdLine.textContent = `任务 ID：${task.task_id}`;

  const statusLine = document.createElement("p");
  statusLine.className = "muted";
  statusLine.textContent = `当前状态：${status}`;

  recentTaskCard.append(eyebrow, title, taskIdLine, statusLine);
}

async function loadClipboardIntoContext() {
  try {
    const clipboardText = (await window.ucaShell.readClipboardText()).trim();
    if (clipboardText) {
      overlayContext.value = clipboardText;
      overlayResult.textContent = "已读取剪贴板内容";
    }
  } catch (error) {
    overlayResult.textContent = `读取剪贴板失败：${error.message}`;
  }
}

async function refreshActiveTask() {
  if (!activeTaskId) {
    return;
  }

  try {
    const payload = await fetchJson(`/task/${activeTaskId}`);
    const task = payload.task ?? payload;
    lastTask = task;
    renderRecentTask(task);
    if (task.status) {
      overlayResult.textContent = `任务 ${task.task_id} · ${task.status}`;
    }
  } catch (error) {
    overlayResult.textContent = `刷新任务失败：${error.message}`;
  }
}

async function submitTask() {
  overlayResult.textContent = "提交中…";
  try {
    const result = await fetchJson("/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceApp: "uca.overlay",
        captureMode: "overlay",
        sourceType: "clipboard",
        text: overlayContext.value,
        userCommand: overlayCommand.value || "请处理当前上下文",
        executionMode: "interactive"
      })
    });
    activeTaskId = result.task.task_id;
    lastTask = result.task;
    renderRecentTask(result.task);
    overlayResult.textContent = `已提交 ${result.task.task_id}`;
  } catch (error) {
    overlayResult.textContent = `提交失败：${error.message}`;
  }
}

quickActions.forEach((button) => {
  button.addEventListener("click", () => {
    overlayCommand.value = button.dataset.command ?? "";
  });
});

submitButton.addEventListener("click", () => {
  submitTask();
});

closeButton.addEventListener("click", () => {
  window.ucaShell.hideWindow("overlay");
});

openConsoleButton.addEventListener("click", async () => {
  await window.ucaShell.showWindow("console");
});

pasteClipboardButton.addEventListener("click", () => {
  loadClipboardIntoContext();
});

clearContextButton.addEventListener("click", () => {
  overlayContext.value = "";
  overlayResult.textContent = "已清空上下文";
});

window.ucaShell.onShortcutTriggered((payload) => {
  if (payload.shortcutId === "toggle-overlay") {
    overlayResult.textContent = "浮窗已通过快捷键唤起";
    loadClipboardIntoContext();
  }
});

window.ucaShell.onShellReady((payload) => {
  if (payload.windowId === "overlay") {
    serviceBaseUrl = payload.serviceBaseUrl ?? serviceBaseUrl;
    refreshStatus();
  }
});

window.ucaShell.onWindowFocused((payload) => {
  if (payload.windowId === "overlay") {
    loadClipboardIntoContext();
  }
});

renderRecentTask(lastTask);
loadClipboardIntoContext();
refreshStatus();
setInterval(refreshActiveTask, 2000);
