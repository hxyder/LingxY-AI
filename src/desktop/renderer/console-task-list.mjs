import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";

export function isCompositeChildTask(task = {}) {
  return Boolean(task?.parent_task_id) && Number.isInteger(task?.child_index);
}

export function isNestedChildTask(task = {}) {
  if (!task) return false;
  if (isCompositeChildTask(task)) return true;
  return task.is_continuation === true && Boolean(task.parent_task_id);
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

export function buildTaskListEntries(list = [], { limit = 12 } = {}) {
  const tasks = Array.isArray(list) ? list : [];
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
  return `
      <button class="task-item ${selected ? "selected" : ""}" data-task-id="${escapeHtml(task.task_id)}" style="text-align:left;${indent ? "margin-left:18px;" : ""}">
        <div class="row">
          <div>
            <h4>${childPrefix}${escapeHtml(task.user_command ?? task.intent ?? "Unnamed")}${childCountChip}</h4>
            <p class="muted">${escapeHtml(task.executor ?? "unknown")} · ${escapeHtml(task.source_type ?? "unknown")}</p>
          </div>
          <span class="chip ${statusClass}">${escapeHtml(task.status)}</span>
        </div>
        <p class="muted" style="margin-top:6px;">${escapeHtml(formatDateTime(task.created_at))}</p>
      </button>
    `;
}
