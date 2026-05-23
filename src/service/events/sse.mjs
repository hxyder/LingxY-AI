export const SSE_HEADERS = Object.freeze({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no"
});

export function createTaskEventStream({ store, eventBus, taskId, since = null }) {
  return {
    headers: SSE_HEADERS,
    replay: store.getTaskEventsSince(taskId, since),
    subscribe(onEvent) {
      return eventBus.subscribe((event) => {
        if (event.task_id !== taskId) {
          return;
        }

        if (since) {
          const replay = store.getTaskEventsSince(taskId, since);
          if (!replay.some((candidate) => candidate.event_id === event.event_id)) {
            return;
          }
        }

        onEvent(event);
      });
    }
  };
}

export function encodeSseFrame(event) {
  return `id: ${event.event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}
