export interface ContextPacketRecord {
  schema_version: "1.0";
  context_id: string;
  trace_id: string;
  source_type: string;
  source_app: string;
  capture_mode: string;
  security_level: string;
  redaction_applied: boolean;
  text?: string;
  file_paths?: string[];
  captured_at: string;
}

export interface TaskRecord {
  task_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  intent: string;
  executor: string;
  user_command: string;
  execution_mode: "interactive" | "unattended_safe" | "approval_required";
  context_packet: ContextPacketRecord;
}

export interface TaskEventRecord {
  event_id: string | number;
  task_id: string;
  ts: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface ArtifactRecord {
  artifact_id: string;
  task_id: string;
  path: string;
  created_at: string;
  mime_type?: string;
}
