export const EVENT_TYPES = Object.freeze([
  "task_created",
  "status_changed",
  "cancel_requested",
  "cancelled",
  "partial_success",
  "step_started",
  "step_finished",
  "log",
  "artifact_created",
  "success",
  "failed",
  "unsupported"
]);

export function createEventBusScaffold() {
  const events = [];
  const listeners = new Set();
  return {
    publish(event) {
      events.push(event);
      for (const listener of listeners) {
        listener(event);
      }
      return event;
    },
    snapshot() {
      return [...events];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
