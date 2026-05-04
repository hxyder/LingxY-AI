export const SQLITE_SCHEMA_SQL = Object.freeze({
  tasks: `CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  sub_status TEXT,
  intent TEXT NOT NULL,
  executor TEXT NOT NULL,
  source_type TEXT NOT NULL,
  user_command TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  source_dedupe_key TEXT,
  context_packet_json TEXT NOT NULL,
  task_json TEXT NOT NULL
);`,
  taskEvents: `CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);`,
  artifacts: `CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  conversation_id TEXT,
  path TEXT NOT NULL,
  mime_type TEXT,
  kind TEXT,
  source TEXT,
  bytes INTEGER,
  sha256 TEXT,
  status TEXT,
  parent_artifact_id TEXT,
  revision_of TEXT,
  version_label TEXT,
  created_at TEXT NOT NULL
);`,
  schedules: `CREATE TABLE IF NOT EXISTS schedules (
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
  last_run_task_id TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT
);`,
  scheduleRuns: `CREATE TABLE IF NOT EXISTS schedule_runs (
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
  pendingApprovals: `CREATE TABLE IF NOT EXISTS pending_approvals (
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
);`,
  auditLogs: `CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  task_id TEXT,
  event_subtype TEXT NOT NULL,
  payload_json TEXT NOT NULL
);`,
  connectedAccounts: `CREATE TABLE IF NOT EXISTS connected_accounts (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  scopes_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  token_status TEXT NOT NULL,
  is_default_for_email INTEGER NOT NULL DEFAULT 0,
  is_default_for_files INTEGER NOT NULL DEFAULT 0,
  is_default_for_calendar INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_account_id)
);`,
  oauthTokens: `CREATE TABLE IF NOT EXISTS oauth_tokens (
  account_id TEXT PRIMARY KEY,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  id_token_encrypted TEXT,
  expires_at TEXT,
  refresh_expires_at TEXT,
  scopes_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES connected_accounts(account_id) ON DELETE CASCADE
);`,
  reauthRequests: `CREATE TABLE IF NOT EXISTS reauth_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  missing_capabilities_json TEXT NOT NULL,
  missing_scopes_json TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  original_tool_call_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(account_id) REFERENCES connected_accounts(account_id) ON DELETE CASCADE
);`,
  conversations: `CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT
);`,
  conversationMessages: `CREATE TABLE IF NOT EXISTS conversation_messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool_summary')),
  content TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT,
  metadata_json TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  UNIQUE (conversation_id, seq)
);`,
  conversationMessageTasks: `CREATE TABLE IF NOT EXISTS conversation_message_tasks (
  message_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('triggered','answered_by','tool_summary_for')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, task_id, relation),
  FOREIGN KEY(message_id) REFERENCES conversation_messages(message_id) ON DELETE CASCADE
);`,
  schemaMigrations: `CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  notes TEXT
);`
});

export const SQLITE_INDEX_SQL = Object.freeze([
  `CREATE INDEX IF NOT EXISTS idx_conversations_project
     ON conversations(project_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_active
     ON conversations(updated_at DESC) WHERE archived = 0`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conv_seq
     ON conversation_messages(conversation_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_msg_tasks_task
     ON conversation_message_tasks(task_id)`
]);

export function buildStoreManifest() {
  return {
    engine: "sqlite",
    ownership: "service-only",
    tables: Object.keys(SQLITE_SCHEMA_SQL),
    writeMode: "wal",
    eventPersistenceOrder: "persist-before-broadcast"
  };
}
