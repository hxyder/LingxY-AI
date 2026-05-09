import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";
import {
  describeTaskTokens
} from "./console-task-detail.mjs";

// R-feedback 2026-05-07: voice-recording tasks where transcription
// failed produced unusable titles — entire raw transcript or fallback
// text wrapped onto multiple lines. Titles get a single-line trim
// + a friendly fallback when the recording produced no transcript at all.
const TASK_TITLE_MAX_CHARS = 60;
function deriveTaskListTitle(task) {
  const raw = (typeof task?.user_command === "string" && task.user_command.trim())
    || task?.intent
    || "Unnamed";
  const single = String(raw).replace(/\s+/g, " ").trim();
  if (!single) return "Unnamed";
  // Voice-note-shape titles when the transcript is empty / placeholder.
  // Detect the "[empty transcript]" / "(无转写文本)" / dash-only patterns
  // the runtime emits and replace with a duration hint when possible.
  if (/^[-—\s]+$/.test(single) || single.length < 2) {
    const durationSec = Number(task?.metadata?.recording_duration_sec
      ?? task?.context_packet?.audio?.duration_sec
      ?? task?.task_spec?.audio?.duration_sec);
    if (Number.isFinite(durationSec) && durationSec > 0) {
      return `录音笔记（${Math.round(durationSec)}秒，未识别到文字）`;
    }
    return "录音笔记（未识别到文字）";
  }
  if (single.length <= TASK_TITLE_MAX_CHARS) return single;
  return `${single.slice(0, TASK_TITLE_MAX_CHARS)}…`;
}

export function isCompositeChildTask(task = {}) {
  return Boolean(task?.parent_task_id) && Number.isInteger(task?.child_index);
}

export function isNestedChildTask(task = {}) {
  if (!task) return false;
  if (isCompositeChildTask(task)) return true;
  return task.is_continuation === true && Boolean(task.parent_task_id);
}

const ROUTINE_CONVERSATION_SOURCES = new Set(["chat", "clipboard", "context"]);

function taskHasArtifactSurface(task = {}) {
  return Boolean(
    Number(task.artifact_count ?? 0) > 0
    || Number(task.artifacts_count ?? 0) > 0
    || (Array.isArray(task.artifacts) && task.artifacts.length > 0)
    || (Array.isArray(task.artifact_paths) && task.artifact_paths.length > 0)
    || task.task_spec?.artifact?.required === true
    || task.task_spec_initial?.artifact?.required === true
  );
}

export function isRoutineCompletedConversationTask(task = {}) {
  if (task?.status !== "success") return false;
  if (taskHasArtifactSurface(task)) return false;
  if (Number(task.child_count ?? 0) > 0 || (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0)) return false;
  if (Boolean(task.parent_task_id) || task.is_continuation === true) return false;
  const sourceType = task.source_type ?? task.context_packet?.source_type ?? "";
  return ROUTINE_CONVERSATION_SOURCES.has(sourceType);
}

function compareNestedTasks(left = {}, right = {}) {
  const leftIndex = Number.isInteger(left.child_index) ? left.child_index : null;
  const rightIndex = Number.isInteger(right.child_index) ? right.child_index : null;
  if (leftIndex != null && rightIndex != null && leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  if (leftIndex != null && rightIndex == null) return -1;
  if (leftIndex == null && rightIndex != null) return 1;
  return `${left.created_at ?? ""}`.localeCompare(`${right.created_at ?? ""}`);
}

export function buildTaskListEntries(list = [], { limit = 12, hideRoutineCompleted = false } = {}) {
  const sourceTasks = Array.isArray(list) ? list : [];
  const tasks = hideRoutineCompleted
    ? sourceTasks.filter((task) => !isRoutineCompletedConversationTask(task))
    : sourceTasks;
  const max = Math.max(1, Number(limit) || 12);
  const tasksById = new Set(tasks.map((task) => task?.task_id).filter(Boolean));
  const childrenByParent = new Map();
  for (const task of tasks) {
    if (isNestedChildTask(task) && tasksById.has(task.parent_task_id)) {
      if (!childrenByParent.has(task.parent_task_id)) {
        childrenByParent.set(task.parent_task_id, []);
      }
      childrenByParent.get(task.parent_task_id).push(task);
    }
  }

  for (const [parentId, children] of childrenByParent) {
    children.sort(compareNestedTasks);
    childrenByParent.set(parentId, children);
  }

  const parentsOrSingles = tasks.filter((task) => !isNestedChildTask(task) || !tasksById.has(task.parent_task_id));
  const sorted = parentsOrSingles.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const entries = [];
  const seen = new Set();
  const appendChildren = (parentId, indent) => {
    const children = childrenByParent.get(parentId) ?? [];
    for (const child of children) {
      if (entries.length >= max) break;
      if (seen.has(child.task_id)) continue;
      entries.push({ task: child, indent, isChild: true });
      seen.add(child.task_id);
      appendChildren(child.task_id, indent + 1);
    }
  };
  for (const task of sorted) {
    if (entries.length >= max) break;
    if (seen.has(task.task_id)) continue;
    entries.push({ task, indent: 0, isChild: false });
    seen.add(task.task_id);
    appendChildren(task.task_id, 1);
  }

  for (const task of tasks) {
    if (entries.length >= max) break;
    if (seen.has(task.task_id)) continue;
    entries.push({ task, indent: 0, isChild: false });
  }

  return entries;
}

export function taskListSignature(entries = []) {
  return entries
    .map(({ task }) => `${task.task_id}|${task.status}|${task.sub_status ?? ""}|${task.child_count ?? 0}`)
    .join("\n");
}

export function renderTaskListItemHtml({ task = {}, indent = 0, isChild = false, selectedTaskId = null } = {}) {
  const selected = task.task_id === selectedTaskId;
  const statusClass = task.status === "success" ? "ready" : task.status === "failed" ? "danger" : "warning";
  const childCount = Number(task.child_count ?? 0) || (Array.isArray(task.child_task_ids) ? task.child_task_ids.length : 0);
  const childPrefix = isChild
    ? "<span class=\"muted\" style=\"margin-right:6px;\">↳</span>"
    : childCount > 0
      ? "<span class=\"muted\" style=\"margin-right:6px;\">▸</span>"
      : "";
  const childCountChip = childCount > 0
    ? ` <span class="chip muted" style="font-size:10px;padding:2px 6px;">${escapeHtml(childCount)}</span>`
    : "";
  const tokenDisplay = describeTaskTokens(task);
  const tokenMeta = tokenDisplay ? ` · ${tokenDisplay} tokens` : "";
  return `
      <button class="task-item ${selected ? "selected" : ""}" data-task-id="${escapeHtml(task.task_id)}" style="text-align:left;${indent ? "margin-left:18px;" : ""}">
        <div class="row">
          <div>
            <h4>${childPrefix}${escapeHtml(deriveTaskListTitle(task))}${childCountChip}</h4>
            <p class="muted">${escapeHtml(task.executor ?? "unknown")} · ${escapeHtml(task.source_type ?? "unknown")}${escapeHtml(tokenMeta)}</p>
          </div>
          <span class="chip ${statusClass}">${escapeHtml(task.status)}</span>
        </div>
        <p class="muted" style="margin-top:6px;">${escapeHtml(formatDateTime(task.created_at))}</p>
      </button>
    `;
}
