const runtimeState = document.querySelector("#runtimeState");
const summaryGrid = document.querySelector("#summaryGrid");
const integrationList = document.querySelector("#integrationList");
const taskList = document.querySelector("#taskList");
const refreshButton = document.querySelector("#refreshButton");
const taskComposer = document.querySelector("#taskComposer");
const commandInput = document.querySelector("#commandInput");
const contextInput = document.querySelector("#contextInput");
const submitState = document.querySelector("#submitState");

let serviceBaseUrl = new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310";

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${serviceBaseUrl}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? pathname);
  }
  return payload;
}

function setRuntimeBadge(ok, message) {
  runtimeState.textContent = message;
  runtimeState.className = `chip ${ok ? "ready" : "danger"}`;
}

function renderSummary(summary) {
  const items = [
    ["运行中", summary.running ?? 0],
    ["排队中", summary.queued ?? 0],
    ["今日成功", summary.today_success ?? 0],
    ["今日失败", summary.today_failed ?? 0]
  ];
  summaryGrid.innerHTML = items.map(([label, value]) => `
    <div class="summary-tile">
      <span class="muted">${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function renderIntegrations(cards) {
  integrationList.innerHTML = cards.map((card) => `
    <div class="integration-item">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:center;">
        <strong>${card.title}</strong>
        <span class="chip ${card.status === "ready" ? "ready" : card.status === "configured" ? "warning" : "danger"}">${card.status}</span>
      </div>
      <p class="muted" style="margin:8px 0 0;">${card.detail}</p>
    </div>
  `).join("");
}

function renderTasks(tasks) {
  if (tasks.length === 0) {
    taskList.innerHTML = `<div class="task-item"><p class="muted">还没有任务。</p></div>`;
    return;
  }

  taskList.innerHTML = tasks.slice(0, 8).map((task) => `
    <article class="task-item">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:start;">
        <div>
          <h4>${task.user_command ?? task.intent}</h4>
          <p class="muted">${task.executor} · ${task.source_type ?? "unknown"} · ${task.task_id}</p>
        </div>
        <span class="chip ${task.status === "success" ? "ready" : task.status === "failed" ? "danger" : "warning"}">${task.status}</span>
      </div>
    </article>
  `).join("");
}

async function refreshWorkspace() {
  try {
    const shell = await window.ucaShell.getShellStatus();
    serviceBaseUrl = shell.serviceBaseUrl ?? serviceBaseUrl;
    const [health, tasksPayload] = await Promise.all([
      fetchJson("/health"),
      fetchJson("/tasks")
    ]);

    setRuntimeBadge(true, `Runtime OK · ${serviceBaseUrl}`);
    const tasks = tasksPayload.tasks ?? [];
    const summary = {
      running: tasks.filter((task) => ["running", "cancelling"].includes(task.status)).length,
      queued: tasks.filter((task) => task.status === "queued").length,
      today_success: tasks.filter((task) => task.status === "success").length,
      today_failed: tasks.filter((task) => ["failed", "cancelled"].includes(task.status)).length
    };
    renderSummary(summary);
    renderTasks(tasks);
    renderIntegrations([
      {
        title: "Kimi Code CLI",
        status: health.kimi?.available ? "ready" : "configured",
        detail: health.kimi?.detail ?? "Not detected"
      },
      ...((health.providers ?? []).slice(0, 3).map((provider) => ({
        title: provider.displayName,
        status: provider.available ? "ready" : provider.configured ? "configured" : "missing",
        detail: provider.detail
      })))
    ]);
  } catch (error) {
    setRuntimeBadge(false, `Runtime unavailable · ${error.message}`);
  }
}

taskComposer.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitState.textContent = "提交中…";
  try {
    const result = await fetchJson("/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceApp: "uca.console",
        captureMode: "manual_console",
        sourceType: "clipboard",
        text: contextInput.value,
        userCommand: commandInput.value || "请处理这段文本",
        executionMode: "interactive"
      })
    });
    submitState.textContent = `已提交 ${result.task.task_id}`;
    contextInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    submitState.textContent = `提交失败：${error.message}`;
  }
});

refreshButton.addEventListener("click", () => {
  refreshWorkspace();
});

window.ucaShell.onShortcutTriggered((payload) => {
  submitState.textContent = `快捷键触发：${payload.shortcutId}`;
});

refreshWorkspace();
setInterval(refreshWorkspace, 5000);
