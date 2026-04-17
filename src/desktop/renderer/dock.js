const dockButton = document.querySelector("#dockButton");
const clipBadge = document.querySelector("#clipBadge");
const taskBadge = document.querySelector("#taskBadge");
const recordingBadge = document.querySelector("#recordingBadge");
let dragDepth = 0;
let clipboardReadyTimer = null;
let noteRecordingActive = false;

function applyNoteRecordingState(payload = {}) {
  noteRecordingActive = Boolean(payload.active);
  dockButton.classList.toggle("recording", noteRecordingActive);
  if (recordingBadge) recordingBadge.textContent = noteRecordingActive ? "REC" : "";
  dockButton.title = noteRecordingActive
    ? `UCA · 录音中 ${payload.elapsed ?? ""}`.trim()
    : "UCA";
  window.__orbApi?.recording?.(noteRecordingActive);
}

window.ucaShell.onNoteRecordingState?.(applyNoteRecordingState);
window.ucaShell.getNoteRecordingState?.().then(applyNoteRecordingState).catch(() => {});

/* ── clipboard change indicator ── */
window.ucaShell.onClipboardChanged((payload) => {
  dockButton.classList.add("clipboard-ready");
  clipBadge.textContent = payload.preview ?? "Copied";
  window.__orbApi?.pulse();

  clearTimeout(clipboardReadyTimer);
  clipboardReadyTimer = setTimeout(() => {
    dockButton.classList.remove("clipboard-ready");
  }, 8000);
});

/* ── task running indicator ──
   activate orb when any non-schedule task is queued or running
   deactivate when nothing's left
*/
function isUserTask(task) {
  // exclude scheduler-triggered background tasks
  if (task.source_app === "uca.scheduler") return false;
  if (task.capture_mode === "scheduler") return false;
  return true;
}

// Adaptive polling: fast while there's an active task (so the orb reflects
// completion quickly), slow when idle to save CPU/battery. Errors back off
// even further so the dock doesn't hammer a dead service.
const POLL_FAST_MS = 1500;
const POLL_IDLE_MS = 5000;
const POLL_ERROR_MS = 10000;
let pollTimer = null;
let lastHadActive = false;
let pollLastErrored = false;

function schedulePoll(delay) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollTaskState, delay);
}

async function pollTaskState() {
  try {
    const resp = await fetch("http://127.0.0.1:4310/tasks");
    const data = await resp.json();
    const tasks = data.tasks ?? [];
    const twoMinAgo = Date.now() - 2 * 60 * 1000;

    const hasActive = tasks.some((t) => {
      if (!isUserTask(t)) return false;
      if (t.status !== "running" && t.status !== "queued" && t.status !== "cancelling") return false;
      const created = new Date(t.created_at).getTime();
      // only count recent ones — old "stuck" running entries don't keep the orb spinning forever
      return Number.isFinite(created) && created > twoMinAgo;
    });
    if (hasActive) {
      if (!noteRecordingActive) window.__orbApi?.activate();
    } else {
      if (!noteRecordingActive) window.__orbApi?.deactivate();
    }

    // Task completion count badge removed per user request — orb animation
    // already conveys active/idle state; the number badge was covering other UI.
    taskBadge.textContent = "";
    dockButton.classList.remove("has-completed");
    if (!noteRecordingActive) dockButton.title = "UCA";

    lastHadActive = hasActive;
    pollLastErrored = false;
    schedulePoll(hasActive ? POLL_FAST_MS : POLL_IDLE_MS);
  } catch {
    // Runtime not ready — back off so we don't spin the CPU retrying every
    // 1.5s during startup or service crashes.
    pollLastErrored = true;
    schedulePoll(POLL_ERROR_MS);
  }
}
pollTaskState();

/* ── window drag support ── */
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;

dockButton.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragMoved = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    dragMoved = true;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    window.ucaShell.moveWindowBy("dock", dx, dy);
  }
});

window.addEventListener("mouseup", () => { isDragging = false; });

/* ── click: single = overlay, double = console ── */
let clickTimer = null;
dockButton.addEventListener("click", () => {
  if (dragMoved) { dragMoved = false; return; }
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    window.ucaShell.showWindow("console");
    return;
  }
  clickTimer = setTimeout(async () => {
    clickTimer = null;
    dockButton.classList.remove("clipboard-ready");
    clearTimeout(clipboardReadyTimer);
    await window.ucaShell.showWindow("overlay");
  }, 260);
});

/* ── file drop support ── */
function collectFilePaths(event) {
  const files = [...(event.dataTransfer?.files ?? [])];
  return window.ucaShell.resolveDroppedFilePaths(files);
}

function hasFilePayload(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

function setDragState(active) {
  dockButton.classList.toggle("dragover", active);
}

function handleDragEnter(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  dragDepth += 1;
  setDragState(true);
}

function handleDragOver(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setDragState(true);
}

function handleDragLeave(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragState(false);
}

async function handleDrop(event) {
  if (!hasFilePayload(event)) return;
  event.preventDefault();
  dragDepth = 0;
  setDragState(false);
  window.__orbApi?.pulse();
  const filePaths = collectFilePaths(event);
  if (filePaths.length === 0) {
    await window.ucaShell.notify({ title: "UCA", body: "No files detected." });
    return;
  }
  const result = await window.ucaShell.submitDroppedFiles(filePaths);
  if (result?.accepted) {
    await window.ucaShell.notify({ title: "UCA", body: `Received ${result.fileCount} file(s).` });
  }
}

["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
  window.addEventListener(name, (e) => { if (hasFilePayload(e)) e.preventDefault(); });
});

window.addEventListener("dragenter", handleDragEnter);
window.addEventListener("dragover", handleDragOver);
window.addEventListener("dragleave", handleDragLeave);
window.addEventListener("drop", handleDrop);
