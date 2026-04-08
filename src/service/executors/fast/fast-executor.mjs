export function createFastExecutorScaffold() {
  return {
    id: "fast",
    model: "placeholder-fast-model",
    supportsStreaming: true,
    async *execute(task) {
      yield {
        event_type: "step_started",
        payload: { step: "fast_executor" }
      };
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
