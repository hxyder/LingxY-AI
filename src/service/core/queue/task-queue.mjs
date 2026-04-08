export const QUEUE_POOLS = Object.freeze({
  fast: { maxConcurrent: 8 },
  tool: { maxConcurrent: 4 },
  kimi: { maxConcurrent: 2 }
});

export function createTaskQueueScaffold() {
  return {
    pools: QUEUE_POOLS,
    queued: [],
    enqueue(task) {
      this.queued.push(task);
      return { accepted: true, position: this.queued.length };
    }
  };
}
