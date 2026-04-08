export function createInMemoryStoreScaffold() {
  return {
    tasks: new Map(),
    taskEvents: [],
    artifacts: [],
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
    }
  };
}
