export const QUEUE_POOLS = Object.freeze({
  fast: { maxConcurrent: 8 },
  tool: { maxConcurrent: 4 },
  kimi: { maxConcurrent: 2 }
});

export function createTaskQueueScaffold() {
  return {
    pools: QUEUE_POOLS,
    queued: [],
    running: new Set(),
    recentFingerprints: [],
    enqueue(task) {
      const cutoff = Date.now() - 5 * 60 * 1000;
      this.recentFingerprints = this.recentFingerprints.filter((entry) => entry.ts >= cutoff);
      const duplicate = task.bypass_dedupe ? null : this.recentFingerprints.find((entry) => entry.key === task.source_dedupe_key);
      if (duplicate) {
        return { accepted: false, dedupedTaskId: duplicate.taskId };
      }

      this.queued.push(task.task_id);
      this.recentFingerprints.push({
        key: task.source_dedupe_key,
        taskId: task.task_id,
        ts: Date.now()
      });
      return { accepted: true, position: this.queued.length };
    },
    markRunning(taskId) {
      this.queued = this.queued.filter((queuedId) => queuedId !== taskId);
      this.running.add(taskId);
    },
    markFinished(taskId) {
      this.queued = this.queued.filter((queuedId) => queuedId !== taskId);
      this.running.delete(taskId);
    },
    snapshot() {
      return {
        queued: this.queued.length,
        running: this.running.size
      };
    }
  };
}
