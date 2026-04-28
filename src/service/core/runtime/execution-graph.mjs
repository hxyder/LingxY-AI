export const EXECUTION_STATES = Object.freeze({
  RECEIVED: "RECEIVED",
  ROUTING: "ROUTING",
  PLANNING: "PLANNING",
  TOOL_RUNNING: "TOOL_RUNNING",
  SYNTHESIZING_FINAL: "SYNTHESIZING_FINAL",
  FINAL_CHECK: "FINAL_CHECK",
  DONE: "DONE",
  FAILED: "FAILED"
});

export const EXECUTION_PHASES = Object.freeze({
  SEMANTIC_ROUTER: "semantic_router_preflight",
  DECOMPOSITION: "decomposition",
  EXECUTOR: "executor",
  FINAL_SYNTHESIS: "final_synthesis",
  FINAL_CHECK: "final_check"
});

export function emitExecutionPhaseStarted({ runtime, taskId, phase, step = phase, progress = null, state = null }) {
  runtime?.emitTaskEvent?.("phase_started", {
    phase,
    state,
    step,
    progress
  });
  runtime?.emitTaskEvent?.("step_started", {
    step,
    progress
  });
}

export function emitExecutionPhaseTiming({ runtime, taskId, phase, startedAt, payload = {} }) {
  runtime?.emitTaskEvent?.("phase_timing", {
    phase,
    duration_ms: Math.max(0, Date.now() - startedAt),
    ...payload
  });
}

export async function runExecutionPhase({
  runtime,
  taskId,
  phase,
  step = phase,
  progress = null,
  state = null,
  timingPayload = null,
  fn
}) {
  if (typeof fn !== "function") {
    throw new TypeError("runExecutionPhase requires fn");
  }
  const startedAt = Date.now();
  emitExecutionPhaseStarted({ runtime, taskId, phase, step, progress, state });
  try {
    const result = await fn();
    const payload = typeof timingPayload === "function" ? timingPayload(result) : (timingPayload ?? {});
    emitExecutionPhaseTiming({ runtime, taskId, phase, startedAt, payload });
    return result;
  } catch (error) {
    emitExecutionPhaseTiming({
      runtime,
      taskId,
      phase,
      startedAt,
      payload: {
        failed: true,
        error: error?.message ?? String(error)
      }
    });
    throw error;
  }
}
