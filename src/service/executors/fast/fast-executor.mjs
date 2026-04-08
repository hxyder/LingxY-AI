export function createFastExecutorScaffold() {
  return {
    id: "fast",
    model: "placeholder-fast-model",
    supportsStreaming: true,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Fast executor cancelled before start."), { code: "ABORT_ERR" });
      }
      yield {
        event_type: "step_started",
        payload: { step: "fast_executor" }
      };
      if (signal?.aborted) {
        throw Object.assign(new Error("Fast executor cancelled during execution."), { code: "ABORT_ERR" });
      }
      yield {
        event_type: "log",
        payload: { message: `Simulated execution for ${task.intent}` }
      };
      yield {
        event_type: "success",
        payload: { text: "Placeholder result from fast executor scaffold." }
      };
    }
  };
}
