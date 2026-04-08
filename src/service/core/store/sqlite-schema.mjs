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
