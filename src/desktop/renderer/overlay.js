const overlayState = document.querySelector("#overlayState");
const overlayCommand = document.querySelector("#overlayCommand");
const overlayContext = document.querySelector("#overlayContext");
const overlayResult = document.querySelector("#overlayResult");
const submitButton = document.querySelector("#submitButton");
const closeButton = document.querySelector("#closeButton");
const openConsoleButton = document.querySelector("#openConsoleButton");
const openResultButton = document.querySelector("#openResultButton");
const copyResultButton = document.querySelector("#copyResultButton");
const reuseResultButton = document.querySelector("#reuseResultButton");
const pasteClipboardButton = document.querySelector("#pasteClipboardButton");
const clearContextButton = document.querySelector("#clearContextButton");
const pendingFilesCard = document.querySelector("#pendingFilesCard");
const pendingFilesSummary = document.querySelector("#pendingFilesSummary");
const pendingFilesList = document.querySelector("#pendingFilesList");
const recentTaskCard = document.querySelector("#recentTaskCard");
const quickActions = [...document.querySelectorAll(".quick-action")];
const outputStyleButtons = [...document.querySelectorAll(".output-style")];
const contextBubble = document.querySelector("#contextBubble");
const userIntentBubble = document.querySelector("#userIntentBubble");
const statusBubble = document.querySelector("#statusBubble");
const resultPreviewCard = document.querySelector("#resultPreviewCard");
const resultPreviewText = document.querySelector("#resultPreviewText");

let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";
let activeTaskId = null;
let lastTask = null;
let pendingFileSelection = null;
let lastArtifactPath = null;
let autoOpenedArtifactTaskId = null;
let notifiedTaskId = null;
let selectedOutputSuffix = "";
let lastArtifactPreview = "";

function refreshConversationBubbles() {
  if (pendingFileSelection?.filePaths?.length) {
    const preview = pendingFileSelection.filePaths.slice(0, 2).join("\n");
    const remainder = pendingFileSelection.filePaths.length > 2 ? `\n还有 ${pendingFileSelection.filePaths.length - 2} 个文件。` : "";
    contextBubble.textContent = `我已经接收到这些文件：\n${preview}${remainder}`;
  } else if (overlayContext.value.trim()) {
    contextBubble.textContent = `当前上下文已就绪：\n${overlayContext.value.trim().slice(0, 160)}`;
  } else {
    contextBubble.textContent = "当前还没有接收到文件或上下文。";
  }

  const commandText = overlayCommand.value.trim();
  userIntentBubble.textContent = commandText
    ? `我的要求是：${commandText}`
    : "你可以直接输入，也可以点下面的动作按钮。";

  statusBubble.textContent = overlayResult.textContent || "尚未提交";
}

function normalisePreviewText(rawText = "") {
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderResultPreview(previewText = "") {
  lastArtifactPreview = previewText.trim();
  resultPreviewCard.hidden = lastArtifactPreview.length === 0;
  resultPreviewText.textContent = lastArtifactPreview || "结果将在这里显示。";
}

async function loadArtifactPreview(artifactPath) {
  if (!artifactPath) {
    renderResultPreview("");
    return;
  }

  try {
    const rawText = await window.ucaShell.readTextFile(artifactPath, 2400);
    const preview = normalisePreviewText(rawText).slice(0, 800);
    renderResultPreview(preview);
  } catch {
    renderResultPreview("");
  }
}

function appendOutputSuffix(baseCommand) {
  if (!selectedOutputSuffix) {
    return baseCommand;
  }
  if (!baseCommand) {
    return selectedOutputSuffix.replace(/^并/, "请");
  }
  if (baseCommand.includes(selectedOutputSuffix)) {
    return baseCommand;
  }
  return `${baseCommand}${selectedOutputSuffix}`;
}

function markActiveButton(buttons, activeButton) {
  buttons.forEach((button) => {
    button.classList.toggle("active", button === activeButton);
  });
}

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
    refreshConversationBubbles();
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

  refreshConversationBubbles();
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

  const summary = task.userCommand ?? task.user_command ?? task.prompt ?? "已提交任务";
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

  if (task.artifacts?.length) {
    const artifactLine = document.createElement("p");
    artifactLine.className = "muted";
    artifactLine.textContent = `结果文件：${task.artifacts[0].path}`;
    recentTaskCard.append(artifactLine);
  }
}

function renderResultAction(task = null) {
  lastArtifactPath = task?.artifacts?.[0]?.path ?? null;
  openResultButton.hidden = !lastArtifactPath;
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
      refreshConversationBubbles();
    }
  } catch (error) {
    overlayResult.textContent = `读取剪贴板失败：${error.message}`;
    refreshConversationBubbles();
  }
}

async function refreshActiveTask() {
  if (!activeTaskId) {
    return;
  }

  try {
    const payload = await fetchJson(`/task/${activeTaskId}`);
    const task = {
      ...(payload.task ?? payload),
      artifacts: payload.artifacts ?? []
    };
    lastTask = task;
    renderRecentTask(task);
    renderResultAction(task);
    if (task.status) {
      if (task.status === "success" && task.artifacts?.length) {
        overlayResult.textContent = `已完成，结果保存在 ${task.artifacts[0].path}`;
        await loadArtifactPreview(task.artifacts[0].path);
        if (notifiedTaskId !== task.task_id) {
          notifiedTaskId = task.task_id;
          await window.ucaShell.notify({
            title: "UCA 任务已完成",
            body: task.userCommand ?? task.user_command ?? "结果已生成，可直接查看 report.md"
          });
        }
        if (autoOpenedArtifactTaskId !== task.task_id) {
          autoOpenedArtifactTaskId = task.task_id;
          await window.ucaShell.openPath(task.artifacts[0].path);
        }
      } else {
        overlayResult.textContent = `任务 ${task.task_id} · ${task.status}`;
        if (task.status !== "success") {
          renderResultPreview("");
        }
      }
      refreshConversationBubbles();
    }
  } catch (error) {
    overlayResult.textContent = `刷新任务失败：${error.message}`;
    refreshConversationBubbles();
  }
}

async function submitTask() {
  overlayResult.textContent = "提交中…";
  refreshConversationBubbles();
  try {
    const commandText = appendOutputSuffix(overlayCommand.value.trim()) || "请处理当前上下文";
    const payload = pendingFileSelection?.filePaths?.length
      ? {
        sourceApp: pendingFileSelection.sourceApp ?? "explorer.exe",
        captureMode: pendingFileSelection.captureMode ?? "shell_menu",
        filePaths: pendingFileSelection.filePaths,
        userCommand: commandText,
        executionMode: "interactive",
        executorOverride: "kimi"
      }
      : {
        sourceApp: "uca.overlay",
        captureMode: "overlay",
        sourceType: "clipboard",
        text: overlayContext.value,
        userCommand: commandText,
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
    renderResultAction(result.task);
    if (pendingFileSelection?.filePaths?.length) {
      overlayContext.value = `已从 Explorer 接收 ${pendingFileSelection.filePaths.length} 个文件`;
      pendingFileSelection = null;
      renderPendingFiles();
    }
    overlayResult.textContent = `已提交 ${result.task.task_id}`;
    renderResultPreview("");
    refreshConversationBubbles();
    setTimeout(() => {
      window.ucaShell.hideWindow("overlay");
    }, 500);
  } catch (error) {
    overlayResult.textContent = `提交失败：${error.message}`;
    refreshConversationBubbles();
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
  refreshConversationBubbles();
}

quickActions.forEach((button) => {
  button.addEventListener("click", () => {
    overlayCommand.value = button.dataset.command ?? "";
    markActiveButton(quickActions, button);
    refreshConversationBubbles();
  });
});

outputStyleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedOutputSuffix = button.dataset.suffix ?? "";
    markActiveButton(outputStyleButtons, button);
    refreshConversationBubbles();
  });
});

overlayCommand.addEventListener("input", () => {
  markActiveButton(quickActions, null);
  refreshConversationBubbles();
});

overlayContext.addEventListener("input", () => {
  refreshConversationBubbles();
});

submitButton.addEventListener("click", () => {
  submitTask();
});

closeButton.addEventListener("click", () => {
  pendingFileSelection = null;
  renderPendingFiles();
  overlayResult.textContent = "已取消本次输入";
  refreshConversationBubbles();
  window.ucaShell.hideWindow("overlay");
});

openConsoleButton.addEventListener("click", async () => {
  await window.ucaShell.showWindow("console");
});

openResultButton.addEventListener("click", async () => {
  if (!lastArtifactPath) {
    return;
  }
  await window.ucaShell.openPath(lastArtifactPath);
});

copyResultButton.addEventListener("click", async () => {
  if (!lastArtifactPreview) {
    return;
  }
  await window.ucaShell.writeClipboardText(lastArtifactPreview);
  overlayResult.textContent = "已复制结果摘要";
  refreshConversationBubbles();
});

reuseResultButton.addEventListener("click", async () => {
  if (!lastArtifactPreview) {
    return;
  }
  overlayContext.value = lastArtifactPreview;
  overlayCommand.focus();
  overlayResult.textContent = "已把结果摘要放入上下文，可继续追问";
  await window.ucaShell.showWindow("overlay");
  refreshConversationBubbles();
});

pasteClipboardButton.addEventListener("click", () => {
  loadClipboardIntoContext();
});

clearContextButton.addEventListener("click", () => {
  overlayContext.value = "";
  pendingFileSelection = null;
  renderPendingFiles();
  overlayResult.textContent = "已清空上下文";
  refreshConversationBubbles();
});

window.ucaShell.onShortcutTriggered((payload) => {
  if (payload.shortcutId === "toggle-overlay") {
    overlayResult.textContent = "浮窗已通过快捷键唤起";
    loadClipboardIntoContext();
    refreshConversationBubbles();
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
renderResultAction(lastTask);
renderResultPreview("");
loadClipboardIntoContext();
refreshStatus();
refreshConversationBubbles();
setInterval(refreshActiveTask, 2000);
