import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { SQLITE_SCHEMA_SQL, SQLITE_INDEX_SQL } from "./sqlite-schema.mjs";
import { applyConversationV1 } from "./migrations/conversation_v1.mjs";
import { applyArtifactConversationIndexV1 } from "./migrations/artifact_conversation_index_v1.mjs";
import { applyArtifactMetadataV1 } from "./migrations/artifact_metadata_v1.mjs";
import { normalizeArtifactMetadata } from "./artifact-metadata.mjs";
import {
  filterDeletedRecords,
  markRecordDeleted,
  restoreDeletedRecord
} from "../deletion-lifecycle.mjs";

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function mapConversation(row) {
  if (!row) return null;
  return {
    conversation_id: row.conversation_id,
    project_id: row.project_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    message_count: row.message_count,
    task_count: row.task_count,
    archived: Boolean(row.archived),
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    ts: row.ts,
    status: row.status,
    metadata: decodeJson(row.metadata_json, {})
  };
}

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
  const metadata = normalizeArtifactMetadata(row);
  return {
    artifact_id: row.artifact_id,
    task_id: row.task_id,
    conversation_id: row.conversation_id ?? null,
    path: row.path,
    mime_type: row.mime_type,
    kind: metadata.kind,
    source: metadata.source,
    bytes: metadata.bytes,
    sha256: metadata.sha256,
    status: metadata.status,
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
    last_run_task_id: row.last_run_task_id ?? null,
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

function mapConnectedAccount(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.account_id,
    accountId: row.account_id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    scopes: decodeJson(row.scopes_json, []),
    capabilities: decodeJson(row.capabilities_json, {}),
    tokenStatus: row.token_status,
    isDefaultForEmail: Boolean(row.is_default_for_email),
    isDefaultForFiles: Boolean(row.is_default_for_files),
    isDefaultForCalendar: Boolean(row.is_default_for_calendar),
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOAuthToken(row) {
  if (!row) {
    return null;
  }
  return {
    accountId: row.account_id,
    accessTokenEncrypted: row.access_token_encrypted ?? null,
    refreshTokenEncrypted: row.refresh_token_encrypted ?? null,
    idTokenEncrypted: row.id_token_encrypted ?? null,
    expiresAt: row.expires_at ?? null,
    refreshExpiresAt: row.refresh_expires_at ?? null,
    scopes: decodeJson(row.scopes_json, []),
    updatedAt: row.updated_at
  };
}

function mapReauthRequest(row) {
  if (!row) {
    return null;
  }
  return {
    requestId: row.request_id,
    userId: row.user_id,
    accountId: row.account_id,
    provider: row.provider,
    missingCapabilities: decodeJson(row.missing_capabilities_json, []),
    missingScopes: decodeJson(row.missing_scopes_json, []),
    reason: row.reason ?? "",
    status: row.status,
    originalToolCall: decodeJson(row.original_tool_call_json, null),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null
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
  for (const sql of SQLITE_INDEX_SQL) {
    db.exec(sql);
  }

  const scheduleColumns = new Set(db.prepare("PRAGMA table_info(schedules)").all().map((column) => column.name));
  if (!scheduleColumns.has("metadata_json")) {
    db.exec("ALTER TABLE schedules ADD COLUMN metadata_json TEXT");
  }
  if (!scheduleColumns.has("last_run_task_id")) {
    db.exec("ALTER TABLE schedules ADD COLUMN last_run_task_id TEXT");
  }

  applyConversationV1(db);
  applyArtifactConversationIndexV1(db);
  applyArtifactMetadataV1(db);

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
      artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status, created_at
    ) VALUES (
      @artifact_id, @task_id, @conversation_id, @path, @mime_type, @kind, @source, @bytes, @sha256, @status, @created_at
    )`),
    getArtifactsForTask: db.prepare("SELECT artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status, created_at FROM artifacts WHERE task_id = ? ORDER BY created_at ASC"),
    getArtifactsForConversation: db.prepare(`
      SELECT artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status, created_at
        FROM artifacts
       WHERE conversation_id = @conversation_id
       ORDER BY created_at DESC
       LIMIT @limit
    `),
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
      schedule_id, name, description, enabled, created_at, updated_at, created_by, trigger_type, trigger_config_json, action_type, action_target, action_params_json, execution_mode, catchup_policy, max_runtime_seconds, next_run_at, last_run_at, last_run_status, last_run_task_id, run_count, failure_count, consecutive_failure_count, metadata_json
    ) VALUES (
      @schedule_id, @name, @description, @enabled, @created_at, @updated_at, @created_by, @trigger_type, @trigger_config_json, @action_type, @action_target, @action_params_json, @execution_mode, @catchup_policy, @max_runtime_seconds, @next_run_at, @last_run_at, @last_run_status, @last_run_task_id, @run_count, @failure_count, @consecutive_failure_count, @metadata_json
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
      last_run_task_id = excluded.last_run_task_id,
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
    listAuditLogs: db.prepare("SELECT * FROM audit_logs ORDER BY ts DESC"),
    upsertConnectedAccount: db.prepare(`INSERT INTO connected_accounts (
      account_id, user_id, provider, provider_account_id, email, display_name, scopes_json, capabilities_json, token_status, is_default_for_email, is_default_for_files, is_default_for_calendar, last_used_at, created_at, updated_at
    ) VALUES (
      @account_id, @user_id, @provider, @provider_account_id, @email, @display_name, @scopes_json, @capabilities_json, @token_status, @is_default_for_email, @is_default_for_files, @is_default_for_calendar, @last_used_at, @created_at, @updated_at
    )
    ON CONFLICT(account_id) DO UPDATE SET
      user_id = excluded.user_id,
      provider = excluded.provider,
      provider_account_id = excluded.provider_account_id,
      email = excluded.email,
      display_name = excluded.display_name,
      scopes_json = excluded.scopes_json,
      capabilities_json = excluded.capabilities_json,
      token_status = excluded.token_status,
      is_default_for_email = excluded.is_default_for_email,
      is_default_for_files = excluded.is_default_for_files,
      is_default_for_calendar = excluded.is_default_for_calendar,
      last_used_at = excluded.last_used_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`),
    getConnectedAccount: db.prepare("SELECT * FROM connected_accounts WHERE account_id = ?"),
    listConnectedAccounts: db.prepare("SELECT * FROM connected_accounts ORDER BY updated_at DESC"),
    deleteConnectedAccount: db.prepare("DELETE FROM connected_accounts WHERE account_id = ?"),
    upsertOAuthToken: db.prepare(`INSERT INTO oauth_tokens (
      account_id, access_token_encrypted, refresh_token_encrypted, id_token_encrypted, expires_at, refresh_expires_at, scopes_json, updated_at
    ) VALUES (
      @account_id, @access_token_encrypted, @refresh_token_encrypted, @id_token_encrypted, @expires_at, @refresh_expires_at, @scopes_json, @updated_at
    )
    ON CONFLICT(account_id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      id_token_encrypted = excluded.id_token_encrypted,
      expires_at = excluded.expires_at,
      refresh_expires_at = excluded.refresh_expires_at,
      scopes_json = excluded.scopes_json,
      updated_at = excluded.updated_at`),
    getOAuthToken: db.prepare("SELECT * FROM oauth_tokens WHERE account_id = ?"),
    deleteOAuthToken: db.prepare("DELETE FROM oauth_tokens WHERE account_id = ?"),
    upsertReauthRequest: db.prepare(`INSERT INTO reauth_requests (
      request_id, user_id, account_id, provider, missing_capabilities_json, missing_scopes_json, reason, status, original_tool_call_json, created_at, completed_at
    ) VALUES (
      @request_id, @user_id, @account_id, @provider, @missing_capabilities_json, @missing_scopes_json, @reason, @status, @original_tool_call_json, @created_at, @completed_at
    )
    ON CONFLICT(request_id) DO UPDATE SET
      user_id = excluded.user_id,
      account_id = excluded.account_id,
      provider = excluded.provider,
      missing_capabilities_json = excluded.missing_capabilities_json,
      missing_scopes_json = excluded.missing_scopes_json,
      reason = excluded.reason,
      status = excluded.status,
      original_tool_call_json = excluded.original_tool_call_json,
      created_at = excluded.created_at,
      completed_at = excluded.completed_at`),
    getReauthRequest: db.prepare("SELECT * FROM reauth_requests WHERE request_id = ?"),
    listReauthRequests: db.prepare("SELECT * FROM reauth_requests ORDER BY created_at DESC"),
    insertConversation: db.prepare(`INSERT INTO conversations
      (conversation_id, project_id, title, created_at, updated_at, message_count, task_count, archived, metadata_json)
      VALUES (@conversation_id, @project_id, @title, @created_at, @updated_at, 0, 0, 0, @metadata_json)`),
    getConversation: db.prepare("SELECT * FROM conversations WHERE conversation_id = ?"),
    listConversationsByProject: db.prepare(`
      SELECT * FROM conversations
       WHERE (@project_id IS NULL OR project_id = @project_id)
         AND (@archived = -1 OR archived = @archived)
       ORDER BY updated_at DESC LIMIT @limit`),
    updateConversationFields: db.prepare(`
      UPDATE conversations
         SET title = COALESCE(@title, title),
             project_id = COALESCE(@project_id, project_id),
             archived = COALESCE(@archived, archived),
             metadata_json = COALESCE(@metadata_json, metadata_json),
             updated_at = @updated_at
       WHERE conversation_id = @conversation_id`),
    softDeleteConversation: db.prepare(`
      UPDATE conversations SET archived = 1, updated_at = ? WHERE conversation_id = ?`),
    hardDeleteConversation: db.prepare("DELETE FROM conversations WHERE conversation_id = ?"),
    bumpConversationCounters: db.prepare(`
      UPDATE conversations
         SET message_count = message_count + @msg_delta,
             task_count    = task_count + @task_delta,
             updated_at    = @updated_at
       WHERE conversation_id = @conversation_id`),
    nextMessageSeq: db.prepare(`
      SELECT COALESCE(MAX(seq), -1) + 1 AS next
        FROM conversation_messages
       WHERE conversation_id = ?`),
    insertMessage: db.prepare(`INSERT INTO conversation_messages
      (message_id, conversation_id, seq, role, content, ts, status, metadata_json)
      VALUES (@message_id, @conversation_id, @seq, @role, @content, @ts, @status, @metadata_json)`),
    listMessages: db.prepare(`
      SELECT * FROM conversation_messages
       WHERE conversation_id = @conversation_id
         AND seq >= @since_seq
       ORDER BY seq ASC LIMIT @limit`),
    getMessageById: db.prepare(
      "SELECT * FROM conversation_messages WHERE message_id = ?"),
    countMessages: db.prepare(`
      SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ?`),
    insertMessageTaskLink: db.prepare(`
      INSERT OR IGNORE INTO conversation_message_tasks
        (message_id, task_id, relation, created_at) VALUES (?, ?, ?, ?)`),
    listMessageTasks: db.prepare(`
      SELECT message_id, task_id, relation, created_at
        FROM conversation_message_tasks
       WHERE message_id = ? ORDER BY created_at ASC`),
    listTaskMessages: db.prepare(`
      SELECT message_id, task_id, relation, created_at
        FROM conversation_message_tasks
       WHERE task_id = ? ORDER BY created_at ASC`)
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
      last_run_task_id: record.last_run_task_id ?? null,
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
    softDeleteTask(taskId, options = {}) {
      const existing = this.getTask(taskId);
      if (!existing) {
        return null;
      }
      return upsertTask(markRecordDeleted(existing, options));
    },
    restoreTask(taskId, options = {}) {
      const existing = this.getTask(taskId);
      if (!existing) {
        return null;
      }
      return upsertTask(restoreDeletedRecord(existing, options));
    },
    deleteTask(taskId) {
      db.prepare("DELETE FROM task_events WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
      const result = db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
      return result.changes > 0;
    },
    listTasks(options = {}) {
      return filterDeletedRecords(
        statements.listTasks.all().map((row) => decodeJson(row.task_json, null)),
        options
      );
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
      const conversationId = artifact.conversation_id
        ?? artifact.conversationId
        ?? mapTask(statements.getTask.get(artifact.task_id))?.conversation_id
        ?? null;
      const metadata = normalizeArtifactMetadata(artifact);
      const record = {
        artifact_id: artifact.artifact_id,
        task_id: artifact.task_id,
        conversation_id: conversationId,
        path: artifact.path,
        mime_type: artifact.mime_type ?? null,
        kind: metadata.kind,
        source: metadata.source,
        bytes: metadata.bytes,
        sha256: metadata.sha256,
        status: metadata.status,
        created_at: artifact.created_at ?? nowIso()
      };
      statements.insertArtifact.run(record);
      return clone(record);
    },
    getArtifactsForTask(taskId) {
      return statements.getArtifactsForTask.all(taskId).map(mapArtifact);
    },
    getArtifactsForConversation(conversationId, { limit = 100 } = {}) {
      if (!conversationId) return [];
      return statements.getArtifactsForConversation.all({
        conversation_id: conversationId,
        limit: Math.max(1, Math.min(limit ?? 100, 500))
      }).map(mapArtifact);
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
    },
    upsertConnectedAccount(account) {
      statements.upsertConnectedAccount.run({
        account_id: account.id ?? account.accountId,
        user_id: account.userId ?? "local",
        provider: account.provider,
        provider_account_id: account.providerAccountId,
        email: account.email,
        display_name: account.displayName ?? null,
        scopes_json: encodeJson(account.scopes ?? []),
        capabilities_json: encodeJson(account.capabilities ?? {}),
        token_status: account.tokenStatus ?? "active",
        is_default_for_email: account.isDefaultForEmail ? 1 : 0,
        is_default_for_files: account.isDefaultForFiles ? 1 : 0,
        is_default_for_calendar: account.isDefaultForCalendar ? 1 : 0,
        last_used_at: account.lastUsedAt ?? null,
        created_at: account.createdAt,
        updated_at: account.updatedAt
      });
      return clone(account);
    },
    getConnectedAccount(accountId) {
      return mapConnectedAccount(statements.getConnectedAccount.get(accountId));
    },
    listConnectedAccounts() {
      return statements.listConnectedAccounts.all().map(mapConnectedAccount);
    },
    deleteConnectedAccount(accountId) {
      const existing = this.getConnectedAccount(accountId);
      if (!existing) {
        return null;
      }
      statements.deleteConnectedAccount.run(accountId);
      return existing;
    },
    upsertOAuthToken(record) {
      statements.upsertOAuthToken.run({
        account_id: record.accountId,
        access_token_encrypted: record.accessTokenEncrypted ?? record.accessToken ?? null,
        refresh_token_encrypted: record.refreshTokenEncrypted ?? record.refreshToken ?? null,
        id_token_encrypted: record.idTokenEncrypted ?? record.idToken ?? null,
        expires_at: record.expiresAt ?? null,
        refresh_expires_at: record.refreshExpiresAt ?? null,
        scopes_json: encodeJson(record.scopes ?? []),
        updated_at: record.updatedAt
      });
      return clone(record);
    },
    getOAuthToken(accountId) {
      return mapOAuthToken(statements.getOAuthToken.get(accountId));
    },
    deleteOAuthToken(accountId) {
      const existing = this.getOAuthToken(accountId);
      statements.deleteOAuthToken.run(accountId);
      return existing;
    },
    upsertReauthRequest(record) {
      statements.upsertReauthRequest.run({
        request_id: record.requestId,
        user_id: record.userId,
        account_id: record.accountId,
        provider: record.provider,
        missing_capabilities_json: encodeJson(record.missingCapabilities ?? []),
        missing_scopes_json: encodeJson(record.missingScopes ?? []),
        reason: record.reason ?? "",
        status: record.status ?? "pending",
        original_tool_call_json: encodeJson(record.originalToolCall ?? null),
        created_at: record.createdAt,
        completed_at: record.completedAt ?? null
      });
      return clone(record);
    },
    getReauthRequest(requestId) {
      return mapReauthRequest(statements.getReauthRequest.get(requestId));
    },
    listReauthRequests() {
      return statements.listReauthRequests.all().map(mapReauthRequest);
    },

    runInTransaction(fn) {
      return db.transaction(fn)();
    },

    insertConversation({ conversation_id, project_id = null, title = null, metadata = {} } = {}) {
      const id = conversation_id ?? newId("conv");
      const ts = nowIso();
      statements.insertConversation.run({
        conversation_id: id,
        project_id: project_id ?? null,
        title: title ?? null,
        created_at: ts,
        updated_at: ts,
        metadata_json: encodeJson(metadata ?? {})
      });
      return mapConversation(statements.getConversation.get(id));
    },
    getConversation(id) {
      return mapConversation(statements.getConversation.get(id));
    },
    listConversations({ projectId = null, limit = 50, archived = 0 } = {}) {
      const archivedFilter = archived === "any" || archived === -1 ? -1 : archived ? 1 : 0;
      const rows = statements.listConversationsByProject.all({
        project_id: projectId ?? null,
        archived: archivedFilter,
        limit: Math.max(1, Math.min(limit ?? 50, 500))
      });
      return rows.map(mapConversation);
    },
    updateConversation(id, patch = {}) {
      statements.updateConversationFields.run({
        conversation_id: id,
        title: patch.title ?? null,
        project_id: patch.project_id ?? null,
        archived: patch.archived === undefined ? null : (patch.archived ? 1 : 0),
        metadata_json: patch.metadata !== undefined ? encodeJson(patch.metadata) : null,
        updated_at: nowIso()
      });
      return mapConversation(statements.getConversation.get(id));
    },
    patchConversationMetadata(id, patch = {}) {
      const existing = mapConversation(statements.getConversation.get(id));
      if (!existing) return null;
      const metadata = {
        ...(existing.metadata ?? {}),
        ...(patch ?? {})
      };
      statements.updateConversationFields.run({
        conversation_id: id,
        title: null,
        project_id: null,
        archived: null,
        metadata_json: encodeJson(metadata),
        updated_at: nowIso()
      });
      return mapConversation(statements.getConversation.get(id));
    },
    softDeleteConversation(id) {
      statements.softDeleteConversation.run(nowIso(), id);
      return mapConversation(statements.getConversation.get(id));
    },
    hardDeleteConversation(id) {
      statements.hardDeleteConversation.run(id);
      return true;
    },

    appendMessage({ conversation_id, role, content, status = null, metadata = {} } = {}) {
      if (!conversation_id) throw new Error("appendMessage: conversation_id required");
      if (!["user", "assistant", "system", "tool_summary"].includes(role)) {
        throw new Error(`appendMessage: invalid role ${role}`);
      }
      return db.transaction(() => {
        const seq = statements.nextMessageSeq.get(conversation_id).next;
        const message_id = newId("msg");
        const ts = nowIso();
        statements.insertMessage.run({
          message_id, conversation_id, seq, role,
          content: String(content ?? ""), ts,
          status: status ?? null,
          metadata_json: encodeJson(metadata ?? {})
        });
        statements.bumpConversationCounters.run({
          conversation_id, msg_delta: 1, task_delta: 0, updated_at: ts
        });
        return mapMessage({
          message_id, conversation_id, seq, role,
          content: String(content ?? ""), ts, status, metadata_json: encodeJson(metadata ?? {})
        });
      })();
    },
    getConversationMessages(conversation_id, { sinceSeq = 0, limit = 500 } = {}) {
      const rows = statements.listMessages.all({
        conversation_id,
        since_seq: Math.max(0, sinceSeq | 0),
        limit: Math.max(1, Math.min(limit ?? 500, 5000))
      });
      return rows.map(mapMessage);
    },
    getMessage(message_id) {
      return mapMessage(statements.getMessageById.get(message_id));
    },
    countConversationMessages(conversation_id) {
      return statements.countMessages.get(conversation_id)?.n ?? 0;
    },

    linkMessageToTask(message_id, task_id, relation) {
      if (!["triggered", "answered_by", "tool_summary_for"].includes(relation)) {
        throw new Error(`linkMessageToTask: invalid relation ${relation}`);
      }
      return db.transaction(() => {
        const ts = nowIso();
        const result = statements.insertMessageTaskLink.run(message_id, task_id, relation, ts);
        if (result.changes > 0 && relation === "triggered") {
          const row = db.prepare(
            "SELECT conversation_id FROM conversation_messages WHERE message_id = ?"
          ).get(message_id);
          if (row?.conversation_id) {
            statements.bumpConversationCounters.run({
              conversation_id: row.conversation_id, msg_delta: 0, task_delta: 1, updated_at: ts
            });
          }
        }
        return { message_id, task_id, relation, created_at: ts, inserted: result.changes > 0 };
      })();
    },
    getMessageTasks(message_id) {
      return statements.listMessageTasks.all(message_id);
    },
    getTaskMessages(task_id) {
      return statements.listTaskMessages.all(task_id);
    }
  };
}
