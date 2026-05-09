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
  artifactExtracts: `CREATE TABLE IF NOT EXISTS artifact_extracts (
  extract_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  task_id TEXT,
  conversation_id TEXT,
  kind TEXT NOT NULL,
  label TEXT,
  locator_json TEXT,
  content_text TEXT,
  data_json TEXT,
  source TEXT,
  confidence REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE
);`,
  artifactLineage: `CREATE TABLE IF NOT EXISTS artifact_lineage (
  lineage_id TEXT PRIMARY KEY,
  task_id TEXT,
  conversation_id TEXT,
  action TEXT NOT NULL,
  target_artifact_id TEXT NOT NULL,
  target_kind TEXT,
  transform_kind TEXT,
  contract_json TEXT,
  validation_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(target_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE
);`,
  artifactLineageSources: `CREATE TABLE IF NOT EXISTS artifact_lineage_sources (
  lineage_source_id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  source_artifact_id TEXT NOT NULL,
  source_extract_id TEXT,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(lineage_id) REFERENCES artifact_lineage(lineage_id) ON DELETE CASCADE,
  FOREIGN KEY(source_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY(source_extract_id) REFERENCES artifact_extracts(extract_id) ON DELETE SET NULL
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
  conversationSessions: `CREATE TABLE IF NOT EXISTS conversation_sessions (
  session_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  project_id TEXT,
  parent_task_id TEXT,
  active_task_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);`,
  sessionItems: `CREATE TABLE IF NOT EXISTS session_items (
  item_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  role TEXT,
  task_id TEXT,
  artifact_id TEXT,
  message_id TEXT,
  ts TEXT NOT NULL,
  content_text TEXT,
  payload_json TEXT NOT NULL,
  provenance_json TEXT,
  FOREIGN KEY(session_id) REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
  UNIQUE(session_id, order_index)
);`,
  schemaMigrations: `CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  notes TEXT
);`,
  // Cross-source search index. CJK queries below 3 chars do not work with
  // FTS5's `trigram` tokenizer, so we tokenize via `unicode61` and pre-split
  // CJK characters with spaces in the indexer (each Han / kana / katakana
  // codepoint becomes its own token). 2-char Chinese keywords like "讨论"
  // therefore match. Original title/body are not stored here — the indexer
  // looks them up from the source store at result-render time.
  unifiedSearchIndex: `CREATE VIRTUAL TABLE IF NOT EXISTS unified_search_index USING fts5(
  title,
  body,
  source_type UNINDEXED,
  source_id UNINDEXED,
  updated_at UNINDEXED,
  deleted_at UNINDEXED,
  tokenize='unicode61'
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
     ON conversation_message_tasks(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_conversation
     ON conversation_sessions(conversation_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_session_items_order
     ON session_items(session_id, order_index)`,
  `CREATE INDEX IF NOT EXISTS idx_session_items_task
     ON session_items(task_id, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_extracts_artifact
     ON artifact_extracts(artifact_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_extracts_task
     ON artifact_extracts(task_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_extracts_conversation
     ON artifact_extracts(conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_lineage_target
     ON artifact_lineage(target_artifact_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_lineage_task
     ON artifact_lineage(task_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_lineage_conversation
     ON artifact_lineage(conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_lineage_sources_source
     ON artifact_lineage_sources(source_artifact_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_lineage_sources_extract
     ON artifact_lineage_sources(source_extract_id, created_at DESC)`
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
