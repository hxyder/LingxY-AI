export function createInMemoryStoreScaffold() {
  return {
    tasks: new Map(),
    taskEvents: [],
    artifacts: [],
    insertTask(task) {
      this.tasks.set(task.task_id, task);
      return task;
    },
    appendEvent(event) {
      this.taskEvents.push(event);
      return event;
    },
    appendArtifact(artifact) {
      this.artifacts.push(artifact);
      return artifact;
    }
  };
}
