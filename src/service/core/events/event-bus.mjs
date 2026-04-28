export const EVENT_TYPES = Object.freeze([
  "task_created",
  "status_changed",
  "cancel_requested",
  "cancelled",
  "partial_success",
  "tool_call_started",
  "tool_call_proposed",
  "tool_call_completed",
  "tool_call_denied",
  "phase_gate_signal",
  "error_budget_signal",
  "pending_approval_created",
  "step_started",
  "step_finished",
  "planner_request_started",
  "log",
  "artifact_created",
  "text_delta",
  "tool_input_delta",
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
