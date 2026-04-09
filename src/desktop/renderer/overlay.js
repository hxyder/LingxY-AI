const overlayState = document.querySelector("#overlayState");
const overlayCommand = document.querySelector("#overlayCommand");
const overlayContext = document.querySelector("#overlayContext");
const overlayResult = document.querySelector("#overlayResult");
const submitButton = document.querySelector("#submitButton");
const closeButton = document.querySelector("#closeButton");
const openConsoleButton = document.querySelector("#openConsoleButton");
const quickActions = [...document.querySelectorAll(".quick-action")];

let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";

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

window.ucaShell.onShortcutTriggered((payload) => {
  if (payload.shortcutId === "toggle-overlay") {
    overlayResult.textContent = "浮窗已通过快捷键唤起";
  }
});

refreshStatus();
