import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SQLITE_SCHEMA_SQL } from "./sqlite-schema.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function encodeJson(value) {
  return JSON.stringify(value ?? null);
}

function decodeJson(value, fallback) {
  if (value == null) {
    return fallback;
  }
  return JSON.parse(value);
}

function mapTask(row) {
  return row ? decodeJson(row.task_json, null) : null;
}

function mapEvent(row) {
  if (!row) {
    return null;
  }
  return {
    event_id: row.event_id,
    task_id: row.task_id,
    ts: row.ts,
    event_type: row.event_type,
    payload: decodeJson(row.payload_json, {})
  };
}

function mapArtifact(row) {
  if (!row) {
    return null;
  }
  return {
    artifact_id: row.artifact_id,
    task_id: row.task_id,
    path: row.path,
    mime_type: row.mime_type,
    created_at: row.created_at
  };
}

function mapPendingApproval(row) {
  if (!row) {
    return null;
  }
  return {
    approval_id: row.approval_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    source_type: row.source_type,
    source_id: row.source_id,
    proposed_action: row.proposed_action,
    proposed_target: row.proposed_target,
    proposed_params: decodeJson(row.proposed_params_json, {}),
    preview_text: row.preview_text,
    status: row.status,
    decided_at: row.decided_at,
    decided_by: row.decided_by,
    resulting_task_id: row.resulting_task_id,
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapSchedule(row) {
  if (!row) {
    return null;
  }
  return {
    schedule_id: row.schedule_id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    trigger_type: row.trigger_type,
    trigger_config: decodeJson(row.trigger_config_json, {}),
    action_type: row.action_type,
    action_target: row.action_target,
    action_params: decodeJson(row.action_params_json, {}),
    execution_mode: row.execution_mode,
    catchup_policy: row.catchup_policy,
    max_runtime_seconds: row.max_runtime_seconds,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    last_run_status: row.last_run_status,
    run_count: row.run_count,
    failure_count: row.failure_count,
    consecutive_failure_count: row.consecutive_failure_count,
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapScheduleRun(row) {
  if (!row) {
    return null;
  }
  return {
    run_id: row.run_id,
    schedule_id: row.schedule_id,
    task_id: row.task_id,
    approval_id: row.approval_id,
    triggered_at: row.triggered_at,
    trigger_reason: row.trigger_reason,
    status: row.status,
    error_message: row.error_message,
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapAuditLog(row) {
  if (!row) {
    return null;
  }
  return {
    audit_id: row.audit_id,
    ts: row.ts,
    task_id: row.task_id,
    event_subtype: row.event_subtype,
    payload: decodeJson(row.payload_json, {})
  };
}

export function createSqliteStore({ dbPath }) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  for (const sql of Object.values(SQLITE_SCHEMA_SQL)) {
    db.exec(sql);
  }

  const scheduleColumns = new Set(db.prepare("PRAGMA table_info(schedules)").all().map((column) => column.name));
  if (!scheduleColumns.has("metadata_json")) {
    db.exec("ALTER TABLE schedules ADD COLUMN metadata_json TEXT");
  }

  const statements = {
    upsertTask: db.prepare(`INSERT INTO tasks (
      task_id, created_at, updated_at, status, sub_status, intent, executor, source_type, user_command, execution_mode, source_dedupe_key, context_packet_json, task_json
    ) VALUES (
      @task_id, @created_at, @updated_at, @status, @sub_status, @intent, @executor, @source_type, @user_command, @execution_mode, @source_dedupe_key, @context_packet_json, @task_json
    )
    ON CONFLICT(task_id) DO UPDATE SET
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      status = excluded.status,
      sub_status = excluded.sub_status,
      intent = excluded.intent,
      executor = excluded.executor,
      source_type = excluded.source_type,
      user_command = excluded.user_command,
      execution_mode = excluded.execution_mode,
      source_dedupe_key = excluded.source_dedupe_key,
      context_packet_json = excluded.context_packet_json,
      task_json = excluded.task_json`),
    getTask: db.prepare("SELECT task_json FROM tasks WHERE task_id = ?"),
    listTasks: db.prepare("SELECT task_json FROM tasks ORDER BY created_at DESC"),
    insertEvent: db.prepare(`INSERT OR REPLACE INTO task_events (
      event_id, task_id, ts, event_type, payload_json
    ) VALUES (
      @event_id, @task_id, @ts, @event_type, @payload_json
    )`),
    getEventsForTask: db.prepare("SELECT event_id, task_id, ts, event_type, payload_json FROM task_events WHERE task_id = ? ORDER BY ts ASC"),
    insertArtifact: db.prepare(`INSERT OR REPLACE INTO artifacts (
      artifact_id, task_id, path, mime_type, created_at
    ) VALUES (
      @artifact_id, @task_id, @path, @mime_type, @created_at
    )`),
    getArtifactsForTask: db.prepare("SELECT artifact_id, task_id, path, mime_type, created_at FROM artifacts WHERE task_id = ? ORDER BY created_at ASC"),
    upsertPendingApproval: db.prepare(`INSERT INTO pending_approvals (
      approval_id, created_at, expires_at, source_type, source_id, proposed_action, proposed_target, proposed_params_json, preview_text, status, decided_at, decided_by, resulting_task_id, metadata_json
    ) VALUES (
      @approval_id, @created_at, @expires_at, @source_type, @source_id, @proposed_action, @proposed_target, @proposed_params_json, @preview_text, @status, @decided_at, @decided_by, @resulting_task_id, @metadata_json
    )
    ON CONFLICT(approval_id) DO UPDATE SET
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      proposed_action = excluded.proposed_action,
      proposed_target = excluded.proposed_target,
      proposed_params_json = excluded.proposed_params_json,
      preview_text = excluded.preview_text,
      status = excluded.status,
      decided_at = excluded.decided_at,
      decided_by = excluded.decided_by,
      resulting_task_id = excluded.resulting_task_id,
      metadata_json = excluded.metadata_json`),
    getPendingApproval: db.prepare("SELECT * FROM pending_approvals WHERE approval_id = ?"),
    listPendingApprovals: db.prepare("SELECT * FROM pending_approvals ORDER BY created_at DESC"),
    upsertSchedule: db.prepare(`INSERT INTO schedules (
      schedule_id, name, description, enabled, created_at, updated_at, created_by, trigger_type, trigger_config_json, action_type, action_target, action_params_json, execution_mode, catchup_policy, max_runtime_seconds, next_run_at, last_run_at, last_run_status, run_count, failure_count, consecutive_failure_count, metadata_json
    ) VALUES (
      @schedule_id, @name, @description, @enabled, @created_at, @updated_at, @created_by, @trigger_type, @trigger_config_json, @action_type, @action_target, @action_params_json, @execution_mode, @catchup_policy, @max_runtime_seconds, @next_run_at, @last_run_at, @last_run_status, @run_count, @failure_count, @consecutive_failure_count, @metadata_json
    )
    ON CONFLICT(schedule_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      enabled = excluded.enabled,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      created_by = excluded.created_by,
      trigger_type = excluded.trigger_type,
      trigger_config_json = excluded.trigger_config_json,
      action_type = excluded.action_type,
      action_target = excluded.action_target,
      action_params_json = excluded.action_params_json,
      execution_mode = excluded.execution_mode,
      catchup_policy = excluded.catchup_policy,
      max_runtime_seconds = excluded.max_runtime_seconds,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      last_run_status = excluded.last_run_status,
      run_count = excluded.run_count,
      failure_count = excluded.failure_count,
      consecutive_failure_count = excluded.consecutive_failure_count,
      metadata_json = excluded.metadata_json`),
    getSchedule: db.prepare("SELECT * FROM schedules WHERE schedule_id = ?"),
    listSchedules: db.prepare("SELECT * FROM schedules ORDER BY created_at DESC"),
    deleteSchedule: db.prepare("DELETE FROM schedules WHERE schedule_id = ?"),
    upsertScheduleRun: db.prepare(`INSERT INTO schedule_runs (
      run_id, schedule_id, task_id, approval_id, triggered_at, trigger_reason, status, error_message, metadata_json
    ) VALUES (
      @run_id, @schedule_id, @task_id, @approval_id, @triggered_at, @trigger_reason, @status, @error_message, @metadata_json
    )
    ON CONFLICT(run_id) DO UPDATE SET
      schedule_id = excluded.schedule_id,
      task_id = excluded.task_id,
      approval_id = excluded.approval_id,
      triggered_at = excluded.triggered_at,
      trigger_reason = excluded.trigger_reason,
      status = excluded.status,
      error_message = excluded.error_message,
      metadata_json = excluded.metadata_json`),
    getScheduleRun: db.prepare("SELECT * FROM schedule_runs WHERE run_id = ?"),
    listScheduleRuns: db.prepare("SELECT * FROM schedule_runs ORDER BY triggered_at DESC"),
    listScheduleRunsBySchedule: db.prepare("SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY triggered_at DESC"),
    insertAuditLog: db.prepare(`INSERT OR REPLACE INTO audit_logs (
      audit_id, ts, task_id, event_subtype, payload_json
    ) VALUES (
      @audit_id, @ts, @task_id, @event_subtype, @payload_json
    )`),
    listAuditLogs: db.prepare("SELECT * FROM audit_logs ORDER BY ts DESC")
  };

  function upsertTask(task) {
    statements.upsertTask.run({
      task_id: task.task_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
      status: task.status,
      sub_status: task.sub_status ?? null,
      intent: task.intent,
      executor: task.executor,
      source_type: task.context_packet?.source_type ?? "unknown",
      user_command: task.user_command,
      execution_mode: task.execution_mode,
      source_dedupe_key: task.source_dedupe_key ?? null,
      context_packet_json: encodeJson(task.context_packet),
      task_json: encodeJson(task)
    });
    return clone(task);
  }

  function upsertPendingApproval(record) {
    statements.upsertPendingApproval.run({
      approval_id: record.approval_id,
      created_at: record.created_at,
      expires_at: record.expires_at,
      source_type: record.source_type,
      source_id: record.source_id,
      proposed_action: record.proposed_action,
      proposed_target: record.proposed_target,
      proposed_params_json: encodeJson(record.proposed_params),
      preview_text: record.preview_text ?? "",
      status: record.status,
      decided_at: record.decided_at ?? null,
      decided_by: record.decided_by ?? null,
      resulting_task_id: record.resulting_task_id ?? null,
      metadata_json: encodeJson(record.metadata ?? {})
    });
    return clone(record);
  }

  function upsertSchedule(record) {
    statements.upsertSchedule.run({
      schedule_id: record.schedule_id,
      name: record.name,
      description: record.description ?? "",
      enabled: record.enabled ? 1 : 0,
      created_at: record.created_at,
      updated_at: record.updated_at,
      created_by: record.created_by ?? null,
      trigger_type: record.trigger_type,
      trigger_config_json: encodeJson(record.trigger_config),
      action_type: record.action_type,
      action_target: record.action_target,
      action_params_json: encodeJson(record.action_params),
      execution_mode: record.execution_mode,
      catchup_policy: record.catchup_policy,
      max_runtime_seconds: record.max_runtime_seconds ?? null,
      next_run_at: record.next_run_at ?? null,
      last_run_at: record.last_run_at ?? null,
      last_run_status: record.last_run_status ?? null,
      run_count: record.run_count ?? 0,
      failure_count: record.failure_count ?? 0,
      consecutive_failure_count: record.consecutive_failure_count ?? 0,
      metadata_json: encodeJson(record.metadata ?? {})
    });
    return clone(record);
  }

  function upsertScheduleRun(record) {
    statements.upsertScheduleRun.run({
      run_id: record.run_id,
      schedule_id: record.schedule_id,
      task_id: record.task_id ?? null,
      approval_id: record.approval_id ?? null,
      triggered_at: record.triggered_at,
      trigger_reason: record.trigger_reason,
      status: record.status,
      error_message: record.error_message ?? null,
      metadata_json: encodeJson(record.metadata ?? {})
    });
    return clone(record);
  }

  return {
    dbPath,
    close() {
      db.close();
    },
    insertTask(task) {
      return upsertTask(task);
    },
    updateTask(_taskId, task) {
      return upsertTask(task);
    },
    getTask(taskId) {
      return mapTask(statements.getTask.get(taskId));
    },
    deleteTask(taskId) {
      db.prepare("DELETE FROM task_events WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
      const result = db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
      return result.changes > 0;
    },
    listTasks() {
      return statements.listTasks.all().map((row) => decodeJson(row.task_json, null));
    },
    appendEvent(event) {
      statements.insertEvent.run({
        event_id: event.event_id,
        task_id: event.task_id,
        ts: event.ts,
        event_type: event.event_type,
        payload_json: encodeJson(event.payload)
      });
      return clone(event);
    },
    getTaskEvents(taskId) {
      return statements.getEventsForTask.all(taskId).map(mapEvent);
    },
    getTaskEventsSince(taskId, since) {
      const events = this.getTaskEvents(taskId);
      if (!since) {
        return events;
      }

      const index = events.findIndex((event) => event.event_id === since);
      return index === -1 ? events : events.slice(index + 1);
    },
    appendArtifact(artifact) {
      statements.insertArtifact.run({
        artifact_id: artifact.artifact_id,
        task_id: artifact.task_id,
        path: artifact.path,
        mime_type: artifact.mime_type ?? null,
        created_at: artifact.created_at
      });
      return clone(artifact);
    },
    getArtifactsForTask(taskId) {
      return statements.getArtifactsForTask.all(taskId).map(mapArtifact);
    },
    appendPendingApproval(approval) {
      return upsertPendingApproval(approval);
    },
    getPendingApproval(approvalId) {
      return mapPendingApproval(statements.getPendingApproval.get(approvalId));
    },
    listPendingApprovals() {
      return statements.listPendingApprovals.all().map(mapPendingApproval);
    },
    updatePendingApproval(approvalId, patch) {
      const existing = this.getPendingApproval(approvalId);
      if (!existing) {
        return null;
      }
      return upsertPendingApproval({
        ...existing,
        ...patch
      });
    },
    insertSchedule(schedule) {
      return upsertSchedule(schedule);
    },
    updateSchedule(_scheduleId, schedule) {
      return upsertSchedule(schedule);
    },
    getSchedule(scheduleId) {
      return mapSchedule(statements.getSchedule.get(scheduleId));
    },
    listSchedules() {
      return statements.listSchedules.all().map(mapSchedule);
    },
    deleteSchedule(scheduleId) {
      const existing = this.getSchedule(scheduleId);
      if (!existing) {
        return null;
      }
      statements.deleteSchedule.run(scheduleId);
      return existing;
    },
    appendScheduleRun(run) {
      return upsertScheduleRun(run);
    },
    updateScheduleRun(runId, patch) {
      const existing = this.getScheduleRun(runId);
      if (!existing) {
        return null;
      }
      return upsertScheduleRun({
        ...existing,
        ...patch
      });
    },
    getScheduleRun(runId) {
      return mapScheduleRun(statements.getScheduleRun.get(runId));
    },
    listScheduleRuns(scheduleId = null) {
      const rows = scheduleId
        ? statements.listScheduleRunsBySchedule.all(scheduleId)
        : statements.listScheduleRuns.all();
      return rows.map(mapScheduleRun);
    },
    appendAuditLog(entry) {
      statements.insertAuditLog.run({
        audit_id: entry.audit_id,
        ts: entry.ts,
        task_id: entry.task_id ?? null,
        event_subtype: entry.event_subtype,
        payload_json: encodeJson(entry.payload ?? {})
      });
      return clone(entry);
    },
    listAuditLogs() {
      return statements.listAuditLogs.all().map(mapAuditLog);
    }
  };
}
