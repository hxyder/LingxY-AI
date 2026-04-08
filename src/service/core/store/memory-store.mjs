export function createInMemoryStoreScaffold() {
  return {
    tasks: new Map(),
    taskEvents: [],
    artifacts: [],
    pendingApprovals: [],
    auditLogs: [],
    insertTask(task) {
      this.tasks.set(task.task_id, task);
      return task;
    },
    updateTask(taskId, task) {
      this.tasks.set(taskId, task);
      return task;
    },
    getTask(taskId) {
      return this.tasks.get(taskId) ?? null;
    },
    listTasks() {
      return [...this.tasks.values()];
    },
    appendEvent(event) {
      this.taskEvents.push(event);
      return event;
    },
    getTaskEvents(taskId) {
      return this.taskEvents.filter((event) => event.task_id === taskId);
    },
    getTaskEventsSince(taskId, since) {
      const events = this.getTaskEvents(taskId);
      if (!since) {
        return events;
      }

      const index = events.findIndex((event) => event.event_id === since);
      return index === -1 ? events : events.slice(index + 1);
    },
    appendArtifact(artifact) {
      this.artifacts.push(artifact);
      return artifact;
    },
    getArtifactsForTask(taskId) {
      return this.artifacts.filter((artifact) => artifact.task_id === taskId);
    },
    appendPendingApproval(approval) {
      this.pendingApprovals.push(approval);
      return approval;
    },
    listPendingApprovals() {
      return [...this.pendingApprovals];
    },
    updatePendingApproval(approvalId, patch) {
      const index = this.pendingApprovals.findIndex((approval) => approval.approval_id === approvalId);
      if (index === -1) {
        return null;
      }

      this.pendingApprovals[index] = {
        ...this.pendingApprovals[index],
        ...patch
      };
      return this.pendingApprovals[index];
    },
    appendAuditLog(entry) {
      this.auditLogs.push(entry);
      return entry;
    },
    listAuditLogs() {
      return [...this.auditLogs];
    }
  };
}
