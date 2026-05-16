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
  SEMANTIC_ROUTER_PATCH: "semantic_router_patch",
  DECOMPOSITION: "decomposition",
  EXECUTOR: "executor",
  FINAL_SYNTHESIS: "final_synthesis",
  FINAL_CHECK: "final_check"
});

function phaseVisibilityPayload({ visibility = "foreground", background = false } = {}) {
  const diagnostic = background === true || visibility === "diagnostic" || visibility === "background";
  return {
    visibility: diagnostic ? "diagnostic" : "foreground",
    background: diagnostic
  };
}

export function emitExecutionPhaseStarted({
  runtime,
  taskId,
  phase,
  step = phase,
  progress = null,
  state = null,
  visibility = "foreground",
  background = false
}) {
  const visibilityPayload = phaseVisibilityPayload({ visibility, background });
  runtime?.emitTaskEvent?.("phase_started", {
    phase,
    state,
    step,
    progress,
    ...visibilityPayload
  });
  runtime?.emitTaskEvent?.("step_started", {
    step,
    progress,
    ...visibilityPayload
  });
}

export function emitExecutionPhaseTiming({
  runtime,
  taskId,
  phase,
  startedAt,
  payload = {},
  visibility = "foreground",
  background = false
}) {
  runtime?.emitTaskEvent?.("phase_timing", {
    phase,
    duration_ms: Math.max(0, Date.now() - startedAt),
    ...phaseVisibilityPayload({ visibility, background }),
    ...payload
  });
}

export function emitExecutionPhaseFinished({
  runtime,
  taskId,
  phase,
  step = phase,
  progress = null,
  visibility = "foreground",
  background = false
}) {
  runtime?.emitTaskEvent?.("step_finished", {
    step,
    phase,
    progress,
    ...phaseVisibilityPayload({ visibility, background })
  });
}

export async function runExecutionPhase({
  runtime,
  taskId,
  phase,
  step = phase,
  progress = null,
  state = null,
  visibility = "foreground",
  background = false,
  timingPayload = null,
  fn
}) {
  if (typeof fn !== "function") {
    throw new TypeError("runExecutionPhase requires fn");
  }
  const startedAt = Date.now();
  emitExecutionPhaseStarted({ runtime, taskId, phase, step, progress, state, visibility, background });
  try {
    const result = await fn();
    const payload = typeof timingPayload === "function" ? timingPayload(result) : (timingPayload ?? {});
    emitExecutionPhaseTiming({ runtime, taskId, phase, startedAt, payload, visibility, background });
    emitExecutionPhaseFinished({ runtime, taskId, phase, step, progress, visibility, background });
    return result;
  } catch (error) {
    emitExecutionPhaseTiming({
      runtime,
      taskId,
      phase,
      startedAt,
      visibility,
      background,
      payload: {
        failed: true,
        error: error?.message ?? String(error)
      }
    });
    throw error;
  }
}
