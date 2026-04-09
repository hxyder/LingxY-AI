export function createMultiModalExecutorScaffold() {
  return {
    id: "multi_modal",
    model: "placeholder-vision-model",
    supportsStreaming: true,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Multi-modal executor cancelled before start."), { code: "ABORT_ERR" });
      }

      yield {
        event_type: "step_started",
        payload: {
          step: "vision_reasoning"
        }
      };
      yield {
        event_type: "log",
        payload: {
          message: `Processed ${task.context_packet.image_paths?.length ?? 0} image(s) with OCR assist.`
        }
      };
      yield {
        event_type: "success",
        payload: {
          text: "Placeholder result from multi-modal executor scaffold."
        }
      };
    }
  };
}
