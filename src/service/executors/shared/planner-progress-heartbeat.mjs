export const PLANNER_MODEL_WAIT_HEARTBEAT_DELAY_MS = 1800;
export const PLANNER_MODEL_WAIT_HEARTBEAT_INTERVAL_MS = 2500;

export function startPlannerModelWaitHeartbeat(runtime, {
  iteration = 0,
  delayMs = PLANNER_MODEL_WAIT_HEARTBEAT_DELAY_MS,
  intervalMs = PLANNER_MODEL_WAIT_HEARTBEAT_INTERVAL_MS,
  emitImmediately = false,
  plannerMode = "tool_planner"
} = {}) {
  if (typeof runtime?.emitTaskEvent !== "function") return () => {};
  let stopped = false;
  let interval = null;
  let emitted = false;
  const emit = (count) => {
    emitted = true;
    runtime.emitTaskEvent("status_changed", {
      status: "running",
      sub_status: count > 0 ? "waiting_for_planner_response" : "waiting_for_planner_first_output",
      progress: 0.35,
      iteration,
      heartbeat_count: count,
      planner_mode: plannerMode
    });
  };
  if (emitImmediately) emit(0);
  const timeout = setTimeout(() => {
    if (stopped) return;
    let count = emitted ? 1 : 0;
    emit(count);
    interval = setInterval(() => {
      if (stopped) return;
      count += 1;
      emit(count);
    }, intervalMs);
  }, delayMs);
  return () => {
    stopped = true;
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
}

export function stopPlannerHeartbeatOnDelta(stopHeartbeatRef) {
  if (typeof stopHeartbeatRef?.stop !== "function") return;
  stopHeartbeatRef.stop();
  stopHeartbeatRef.stop = () => {};
}
