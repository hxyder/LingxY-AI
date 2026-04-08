export const EVENT_TYPES = Object.freeze([
  "task_created",
  "status_changed",
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
  return {
    publish(event) {
      events.push(event);
      return event;
    },
    snapshot() {
      return [...events];
    }
  };
}
