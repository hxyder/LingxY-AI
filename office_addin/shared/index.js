import { createOfficeBridge } from "./office_bridge.js";

const RUNTIME_BASE_URL = "http://127.0.0.1:4310";
const bridge = createOfficeBridge();

const hostTitle = document.getElementById("hostTitle");
const scopeSelect = document.getElementById("scopeSelect");
const refreshBtn = document.getElementById("refreshBtn");
const selectionPreview = document.getElementById("selectionPreview");
const commandInput = document.getElementById("commandInput");
const submitBtn = document.getElementById("submitBtn");
const analyzeWholeBtn = document.getElementById("analyzeWholeBtn");
const resultPanel = document.getElementById("resultPanel");
const resultArea = document.getElementById("resultArea");
const replaceSelectionBtn = document.getElementById("replaceSelectionBtn");
const insertResultBtn = document.getElementById("insertResultBtn");
const copyResultBtn = document.getElementById("copyResultBtn");
const statusText = document.getElementById("statusText");

let lastSelection = null;
let lastResultText = "";
let activeScope = "selection";

function getHostHint(selection) {
  const app = selection?.officeApp ?? "Office";
  if (app === "Excel") return "Excel: selection or active worksheet used range";
  if (app === "PowerPoint") return "PowerPoint: selected text or best-effort presentation text";
  return "Word: selection or whole document body";
}

function setStatus(message) {
  statusText.textContent = message;
}

function renderSelection(selection) {
  const text = selection?.selectionText?.trim();
  const scope = selection?.captureScope ?? activeScope;
  hostTitle.textContent = `UCA for ${selection?.officeApp ?? "Office"}`;
  selectionPreview.textContent = text || "No content detected. Select text/cells/shapes, or try Whole document.";
  setStatus(text
    ? `${getHostHint(selection)} · ${scope} · ${text.length} chars`
    : `${getHostHint(selection)} · waiting for content`);
}

function renderResult(text) {
  lastResultText = text ?? "";
  resultArea.textContent = lastResultText || "No inline result returned. Check UCA task history for artifacts.";
  resultPanel.style.display = "block";
  replaceSelectionBtn.disabled = !lastResultText;
  insertResultBtn.disabled = !lastResultText;
  copyResultBtn.disabled = !lastResultText;
}

async function refreshSelection(scope = activeScope) {
  activeScope = scope;
  scopeSelect.value = scope;
  setStatus(scope === "document" ? "Reading larger Office context..." : "Reading current selection...");
  lastSelection = await bridge.captureSelection({ scope });
  renderSelection(lastSelection);
  return lastSelection;
}

async function submit(command, scope = activeScope) {
  if (!command) {
    setStatus("Type a request first.");
    return;
  }

  setStatus("Submitting to UCA...");
  resultPanel.style.display = "none";

  try {
    const selection = await refreshSelection(scope);
    const result = await bridge.submitSelection(command, selection);
    const taskId = result.task?.task_id;
    setStatus(taskId ? `Task: ${taskId}` : "Submitted");

    if (taskId) {
      await pollTaskResult(taskId);
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

async function pollTaskResult(taskId) {
  const maxAttempts = 45;
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const response = await fetch(`${RUNTIME_BASE_URL}/task/${taskId}`);
      const detail = await response.json();
      const task = detail.task ?? {};

      if (task.status === "success" || task.status === "partial_success") {
        const events = detail.events ?? [];
        const inlineEvent = [...events].reverse().find((event) =>
          (event.event_type === "inline_result" || event.event_type === "success") && event.payload?.text?.length > 0
        );
        const text = inlineEvent?.payload?.text
          ?? task.result_preview
          ?? "";
        renderResult(text);
        setStatus("Done. Review the result, then choose a writeback action.");
        return;
      }

      if (task.status === "failed" || task.status === "cancelled" || task.status === "unsupported") {
        setStatus(`${task.status}: ${task.failure_user_message ?? task.sub_status ?? ""}`);
        return;
      }

      setStatus(`Running... ${task.sub_status ?? ""}`);
    } catch {
      setStatus("Waiting for UCA runtime...");
    }
  }
  setStatus("Timeout waiting for result.");
}

async function applyResult(mode) {
  if (!lastResultText) {
    setStatus("No result to apply yet.");
    return;
  }

  setStatus(mode === "replace_selection" ? "Replacing current selection..." : "Inserting result at cursor/selection...");
  const result = await bridge.writeResult(lastResultText, { mode });
  setStatus(result.ok ? "Applied to Office document." : `Writeback failed: ${result.error}`);
}

for (const btn of document.querySelectorAll(".quick-action")) {
  btn.addEventListener("click", () => {
    commandInput.value = btn.dataset.cmd;
    void submit(btn.dataset.cmd, activeScope);
  });
}

scopeSelect.addEventListener("change", () => {
  void refreshSelection(scopeSelect.value);
});

refreshBtn.addEventListener("click", () => {
  void refreshSelection(activeScope);
});

submitBtn.addEventListener("click", () => {
  void submit(commandInput.value.trim(), activeScope);
});

analyzeWholeBtn.addEventListener("click", () => {
  activeScope = "document";
  scopeSelect.value = "document";
  const command = commandInput.value.trim() || "Please analyze the whole Office document and list key points, risks, and suggested edits.";
  commandInput.value = command;
  void submit(command, "document");
});

replaceSelectionBtn.addEventListener("click", () => {
  void applyResult("replace_selection");
});

insertResultBtn.addEventListener("click", () => {
  void applyResult("insert_with_label");
});

copyResultBtn.addEventListener("click", async () => {
  await navigator.clipboard?.writeText(lastResultText);
  setStatus("Copied result to clipboard.");
});

commandInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void submit(commandInput.value.trim(), activeScope);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refreshSelection(activeScope);
  }
});

async function boot() {
  if (globalThis.Office?.onReady) {
    await globalThis.Office.onReady();
  }
  await refreshSelection("selection");
  setInterval(() => {
    if (activeScope === "selection") {
      void refreshSelection("selection");
    }
  }, 4000);
}

void boot();
