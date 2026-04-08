function todayPrefix(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function createMetricsRegistry({ store, queue }) {
  return {
    snapshot(now = new Date()) {
      const tasks = store.listTasks();
      const prefix = todayPrefix(now);
      const todayTasks = tasks.filter((task) => task.created_at.startsWith(prefix));
      const failed = tasks.filter((task) => task.status === "failed").length;
      const cancelled = tasks.filter((task) => task.status === "cancelled").length;
      const queueState = queue.snapshot();

      return {
        task_total: tasks.length,
        task_running: tasks.filter((task) => task.status === "running").length,
        task_failed_total: failed,
        task_cancelled_total: cancelled,
        failure_rate: tasks.length === 0 ? 0 : Number((failed / tasks.length).toFixed(4)),
        queue_depth: queueState.queued,
        queue_running: queueState.running,
        today_success_total: todayTasks.filter((task) => task.status === "success").length,
        today_failed_total: todayTasks.filter((task) => task.status === "failed").length
      };
    },
    renderPrometheus(now = new Date()) {
      const snapshot = this.snapshot(now);
      return [
        "# HELP uca_task_total Total number of tasks",
        "# TYPE uca_task_total gauge",
        `uca_task_total ${snapshot.task_total}`,
        "# HELP uca_task_failed_total Total failed tasks",
        "# TYPE uca_task_failed_total gauge",
        `uca_task_failed_total ${snapshot.task_failed_total}`,
        "# HELP uca_task_cancelled_total Total cancelled tasks",
        "# TYPE uca_task_cancelled_total gauge",
        `uca_task_cancelled_total ${snapshot.task_cancelled_total}`,
        "# HELP uca_failure_rate Failed tasks over total tasks",
        "# TYPE uca_failure_rate gauge",
        `uca_failure_rate ${snapshot.failure_rate}`,
        "# HELP uca_queue_depth Number of queued tasks",
        "# TYPE uca_queue_depth gauge",
        `uca_queue_depth ${snapshot.queue_depth}`,
        "# HELP uca_queue_running Number of running tasks",
        "# TYPE uca_queue_running gauge",
        `uca_queue_running ${snapshot.queue_running}`
      ].join("\n");
    }
  };
}
