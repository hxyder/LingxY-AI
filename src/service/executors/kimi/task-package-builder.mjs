import { detectRequestedOutputFormat } from "./output-format.mjs";

export function buildKimiTaskPackage({ task, outputDir }) {
  const requestedFormat = detectRequestedOutputFormat(task.user_command);
  return {
    task_id: task.task_id,
    task_type: task.intent,
    user_command: task.user_command,
    context: {
      source_type: task.context_packet.source_type,
      file_paths: task.context_packet.file_paths ?? [],
      text: task.context_packet.text ?? "",
      metadata: {
        source_app: task.context_packet.source_app,
        capture_mode: task.context_packet.capture_mode
      }
    },
    output_requirements: {
      primary: requestedFormat.primaryRequirement,
      format_id: requestedFormat.id,
      suggested_extension: requestedFormat.extension,
      save_required: true,
      output_dir: outputDir
    },
    rules: {
      must_read_source: true,
      must_save_result: true,
      must_return_artifact_paths: true,
      must_emit_progress: true,
      max_runtime_seconds: 600
    },
    trace_id: task.context_packet.trace_id
  };
}
