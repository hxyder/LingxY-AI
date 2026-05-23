export function listChildTasks(runtime, parentTask) {
  if (!parentTask) return [];
  const childIds = Array.isArray(parentTask.child_task_ids) ? parentTask.child_task_ids : [];
  if (childIds.length > 0) {
    return childIds.map((id) => runtime.store.getTask(id)).filter(Boolean);
  }
  return runtime.store.listTasks().filter((task) => task.parent_task_id === parentTask.task_id && task.child_index != null);
}

export function aggregateCompositeStatus(childTasks) {
  if (childTasks.length === 0) {
    return { status: "running", sub_status: "composite_waiting", progress: 0 };
  }

  const statuses = childTasks.map((task) => task.status);
  // Progress counts only successful/partial outcomes. Failed/cancelled
  // children are surfaced through failure_count instead of inflating progress.
  const succeeded = statuses.filter((status) => status === "success" || status === "partial_success").length;
  const failed = statuses.filter((status) => status === "failed" || status === "cancelled").length;
  const total = childTasks.length;
  const progress = Math.min(1, succeeded / total);

  if (statuses.every((status) => status === "success")) {
    return { status: "success", sub_status: "completed", progress: 1, failure_count: 0 };
  }

  if (statuses.some((status) => status === "failed" || status === "cancelled")) {
    return { status: "partial_success", sub_status: "completed_with_warnings", progress, failure_count: failed };
  }

  if (statuses.some((status) => status === "partial_success")) {
    return { status: "partial_success", sub_status: "completed_with_warnings", progress, failure_count: failed };
  }

  if (statuses.some((status) => ["running", "queued", "cancelling"].includes(status))) {
    return { status: "running", sub_status: "composite_running", progress, failure_count: failed };
  }

  return { status: "running", sub_status: "composite_pending", progress, failure_count: failed };
}
