export const SQLITE_SCHEMA_SQL = Object.freeze({
  tasks: `CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  intent TEXT NOT NULL,
  executor TEXT NOT NULL,
  user_command TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  context_packet_json TEXT NOT NULL
);`,
  taskEvents: `CREATE TABLE task_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);`,
  artifacts: `CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  created_at TEXT NOT NULL
);`,
  schedules: `CREATE TABLE schedules (
  schedule_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config_json TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_target TEXT NOT NULL,
  action_params_json TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  catchup_policy TEXT NOT NULL,
  max_runtime_seconds INTEGER,
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failure_count INTEGER NOT NULL DEFAULT 0
);`,
  scheduleRuns: `CREATE TABLE schedule_runs (
  run_id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  task_id TEXT,
  approval_id TEXT,
  triggered_at TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  metadata_json TEXT
);`,
  pendingApprovals: `CREATE TABLE pending_approvals (
  approval_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  proposed_target TEXT NOT NULL,
  proposed_params_json TEXT NOT NULL,
  preview_text TEXT,
  status TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  resulting_task_id TEXT,
  metadata_json TEXT
);`
});

export function buildStoreManifest() {
  return {
    engine: "sqlite",
    ownership: "service-only",
    tables: Object.keys(SQLITE_SCHEMA_SQL),
    writeMode: "wal",
    eventPersistenceOrder: "persist-before-broadcast"
  };
}
