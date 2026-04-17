import { detectRequestedOutputFormat } from "./output-format.mjs";

export function buildKimiTaskPackage({ task, outputDir }) {
  const requestedFormat = detectRequestedOutputFormat(task.user_command);
  const isConversational = requestedFormat.id === "conversational";
  const filePaths = task.context_packet.file_paths ?? [];
  const imagePaths = task.context_packet.image_paths ?? [];
  return {
    task_id: task.task_id,
    task_type: task.intent,
    user_command: task.user_command,
    context: {
      source_type: task.context_packet.source_type,
      file_paths: [...filePaths, ...imagePaths],
      image_paths: imagePaths,
      text: task.context_packet.text ?? "",
      html: task.context_packet.html ?? "",
      url: task.context_packet.url ?? "",
      metadata: {
        source_app: task.context_packet.source_app,
        capture_mode: task.context_packet.capture_mode,
        selection_metadata: task.context_packet.selection_metadata ?? {}
      }
    },
    output_requirements: {
      primary: requestedFormat.primaryRequirement,
      format_id: requestedFormat.id,
      suggested_extension: requestedFormat.extension,
      save_required: !isConversational,
      output_dir: outputDir
    },
    rules: {
      must_read_source: true,
      must_save_result: !isConversational,
      must_return_artifact_paths: !isConversational,
      must_emit_progress: true,
      max_runtime_seconds: 600
    },
    trace_id: task.context_packet.trace_id
  };
}
