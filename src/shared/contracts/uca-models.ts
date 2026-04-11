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
  html?: string;
  url?: string;
  file_paths?: string[];
  file_metadata?: Array<Record<string, unknown>>;
  image_paths?: string[];
  image_metadata?: Record<string, unknown>;
  selection_metadata?: Record<string, unknown>;
  entity_hints?: Record<string, unknown>;
  captured_at: string;
}

export interface TaskRecord {
  task_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  sub_status?: string;
  progress?: number;
  current_step?: string | null;
  completed_steps?: string[];
  remaining_steps_estimate?: string[];
  failure_category?: string | null;
  failure_user_message?: string | null;
  failure_internal_log_excerpt?: string | null;
  retryable?: boolean;
  parent_task_id?: string | null;
  child_task_ids?: string[] | null;
  child_index?: number | null;
  retry_count?: number;
  executor_history?: Array<Record<string, unknown>>;
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
