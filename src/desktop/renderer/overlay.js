const overlayState = document.querySelector("#overlayState");
const overlayCommand = document.querySelector("#overlayCommand");
const overlayContext = document.querySelector("#overlayContext");
const overlayResult = document.querySelector("#overlayResult");
const submitButton = document.querySelector("#submitButton");
const closeButton = document.querySelector("#closeButton");
const openConsoleButton = document.querySelector("#openConsoleButton");
const pasteClipboardButton = document.querySelector("#pasteClipboardButton");
const clearContextButton = document.querySelector("#clearContextButton");
const pendingFilesCard = document.querySelector("#pendingFilesCard");
const pendingFilesSummary = document.querySelector("#pendingFilesSummary");
const pendingFilesList = document.querySelector("#pendingFilesList");
const recentTaskCard = document.querySelector("#recentTaskCard");
const quickActions = [...document.querySelectorAll(".quick-action")];

let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";
let activeTaskId = null;
let lastTask = null;
let pendingFileSelection = null;

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

function formatFileSelectionSummary(filePaths = []) {
  if (filePaths.length === 0) {
    return "当前没有待处理文件。";
  }
  if (filePaths.length === 1) {
    return `已接收 1 个文件，准备打开输入流程。`;
  }
  return `已接收 ${filePaths.length} 个文件，准备合并提交。`;
}

function renderPendingFiles(selection = null) {
  pendingFilesCard.hidden = false;
  pendingFilesList.replaceChildren();

  if (!selection?.filePaths?.length) {
    pendingFilesSummary.textContent = "当前没有待处理文件。";
    const placeholder = document.createElement("p");
    placeholder.className = "muted";
    placeholder.textContent = "你可以继续使用剪贴板文本，也可以从 Explorer 右键把文件交给这里。";
    pendingFilesList.append(placeholder);
    return;
  }

  pendingFilesSummary.textContent = formatFileSelectionSummary(selection.filePaths);
  selection.filePaths.slice(0, 6).forEach((filePath) => {
    const row = document.createElement("p");
    row.className = "muted";
    row.textContent = filePath;
    pendingFilesList.append(row);
  });

  if (selection.filePaths.length > 6) {
    const remainder = document.createElement("p");
    remainder.className = "muted";
    remainder.textContent = `还有 ${selection.filePaths.length - 6} 个文件未展开显示。`;
    pendingFilesList.append(remainder);
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
  if (pendingFileSelection?.filePaths?.length) {
    return;
  }
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
    const payload = pendingFileSelection?.filePaths?.length
      ? {
        sourceApp: pendingFileSelection.sourceApp ?? "explorer.exe",
        captureMode: pendingFileSelection.captureMode ?? "shell_menu",
        filePaths: pendingFileSelection.filePaths,
        userCommand: overlayCommand.value || "请分析这些文件并给出结论",
        executionMode: "interactive"
      }
      : {
        sourceApp: "uca.overlay",
        captureMode: "overlay",
        sourceType: "clipboard",
        text: overlayContext.value,
        userCommand: overlayCommand.value || "请处理当前上下文",
        executionMode: "interactive"
      };

    const result = await fetchJson("/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    activeTaskId = result.task.task_id;
    lastTask = result.task;
    renderRecentTask(result.task);
    if (pendingFileSelection?.filePaths?.length) {
      overlayContext.value = `已从 Explorer 接收 ${pendingFileSelection.filePaths.length} 个文件`;
      pendingFileSelection = null;
      renderPendingFiles();
    }
    overlayResult.textContent = `已提交 ${result.task.task_id}`;
  } catch (error) {
    overlayResult.textContent = `提交失败：${error.message}`;
  }
}

function applyExplorerHandoff(payload) {
  pendingFileSelection = {
    sourceApp: payload.source_app ?? "explorer.exe",
    captureMode: payload.capture_mode ?? "shell_menu",
    filePaths: payload.file_paths ?? []
  };
  renderPendingFiles(pendingFileSelection);
  overlayCommand.focus();
  overlayResult.textContent = "已接收文件列表，请输入你的要求后执行";
  overlayContext.value = pendingFileSelection.filePaths.join("\n");
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
  pendingFileSelection = null;
  renderPendingFiles();
  overlayResult.textContent = "已取消本次输入";
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
  pendingFileSelection = null;
  renderPendingFiles();
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

window.ucaShell.onContextReceived((payload) => {
  if (payload.targetWindow === "overlay" || payload.source_app === "explorer.exe") {
    applyExplorerHandoff(payload);
  }
});

renderPendingFiles();
renderRecentTask(lastTask);
loadClipboardIntoContext();
refreshStatus();
setInterval(refreshActiveTask, 2000);
