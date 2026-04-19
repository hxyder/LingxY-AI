export function createInMemoryStoreScaffold() {
  return {
    tasks: new Map(),
    taskEvents: [],
    artifacts: [],
    pendingApprovals: [],
    auditLogs: [],
    schedules: new Map(),
    scheduleRuns: [],
    connectedAccounts: new Map(),
    oauthTokens: new Map(),
    reauthRequests: new Map(),
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
    deleteTask(taskId) {
      const existed = this.tasks.has(taskId);
      this.tasks.delete(taskId);
      this.taskEvents = this.taskEvents.filter((e) => e.task_id !== taskId);
      this.artifacts = this.artifacts.filter((a) => a.task_id !== taskId);
      return existed;
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
    getPendingApproval(approvalId) {
      return this.pendingApprovals.find((approval) => approval.approval_id === approvalId) ?? null;
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
    insertSchedule(schedule) {
      this.schedules.set(schedule.schedule_id, schedule);
      return schedule;
    },
    updateSchedule(scheduleId, schedule) {
      this.schedules.set(scheduleId, schedule);
      return schedule;
    },
    getSchedule(scheduleId) {
      return this.schedules.get(scheduleId) ?? null;
    },
    listSchedules() {
      return [...this.schedules.values()];
    },
    deleteSchedule(scheduleId) {
      const schedule = this.schedules.get(scheduleId) ?? null;
      this.schedules.delete(scheduleId);
      return schedule;
    },
    appendScheduleRun(run) {
      this.scheduleRuns.push(run);
      return run;
    },
    updateScheduleRun(runId, patch) {
      const index = this.scheduleRuns.findIndex((run) => run.run_id === runId);
      if (index === -1) {
        return null;
      }

      this.scheduleRuns[index] = {
        ...this.scheduleRuns[index],
        ...patch
      };
      return this.scheduleRuns[index];
    },
    getScheduleRun(runId) {
      return this.scheduleRuns.find((run) => run.run_id === runId) ?? null;
    },
    listScheduleRuns(scheduleId = null) {
      if (!scheduleId) {
        return [...this.scheduleRuns];
      }
      return this.scheduleRuns.filter((run) => run.schedule_id === scheduleId);
    },
    appendAuditLog(entry) {
      this.auditLogs.push(entry);
      return entry;
    },
    listAuditLogs() {
      return [...this.auditLogs];
    },
    upsertConnectedAccount(account) {
      const accountId = account.id ?? account.accountId;
      this.connectedAccounts.set(accountId, { ...account, id: accountId, accountId });
      return this.connectedAccounts.get(accountId);
    },
    getConnectedAccount(accountId) {
      return this.connectedAccounts.get(accountId) ?? null;
    },
    listConnectedAccounts() {
      return [...this.connectedAccounts.values()];
    },
    deleteConnectedAccount(accountId) {
      const existing = this.getConnectedAccount(accountId);
      this.connectedAccounts.delete(accountId);
      this.oauthTokens.delete(accountId);
      return existing;
    },
    upsertOAuthToken(record) {
      this.oauthTokens.set(record.accountId, { ...record });
      return this.oauthTokens.get(record.accountId);
    },
    getOAuthToken(accountId) {
      return this.oauthTokens.get(accountId) ?? null;
    },
    deleteOAuthToken(accountId) {
      const existing = this.getOAuthToken(accountId);
      this.oauthTokens.delete(accountId);
      return existing;
    },
    upsertReauthRequest(record) {
      this.reauthRequests.set(record.requestId, { ...record });
      return this.reauthRequests.get(record.requestId);
    },
    getReauthRequest(requestId) {
      return this.reauthRequests.get(requestId) ?? null;
    },
    listReauthRequests() {
      return [...this.reauthRequests.values()];
    }
  };
}
