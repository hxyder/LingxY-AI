import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { SQLITE_SCHEMA_SQL, SQLITE_INDEX_SQL } from "./sqlite-schema.mjs";
import { applyConversationV1 } from "./migrations/conversation_v1.mjs";
import { applyArtifactConversationIndexV1 } from "./migrations/artifact_conversation_index_v1.mjs";
import { applyArtifactMetadataV1 } from "./migrations/artifact_metadata_v1.mjs";
import { applyArtifactVersioningV1 } from "./migrations/artifact_versioning_v1.mjs";
import {
  normalizeArtifactMetadata,
  normalizeArtifactVersionMetadata
} from "./artifact-metadata.mjs";
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

function mapConversationSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    conversation_id: row.conversation_id,
    project_id: row.project_id,
    parent_task_id: row.parent_task_id,
    active_task_id: row.active_task_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapProject(row) {
  if (!row) return null;
  return {
    project_id: row.project_id,
    id: row.project_id,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    createdAt: Date.parse(row.created_at) || 0,
    archived: Boolean(row.archived),
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapProjectFile(row) {
  if (!row) return null;
  return {
    project_id: row.project_id,
    path: row.path,
    status: row.status,
    indexed_at: row.indexed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: decodeJson(row.metadata_json, {})
  };
}

function mapSessionItem(row) {
  if (!row) return null;
  return {
    item_id: row.item_id,
    session_id: row.session_id,
    order_index: row.order_index,
    kind: row.kind,
    role: row.role,
    task_id: row.task_id,
    artifact_id: row.artifact_id,
    message_id: row.message_id,
    ts: row.ts,
    content_text: row.content_text,
    payload: decodeJson(row.payload_json, {}),
    provenance: decodeJson(row.provenance_json, {})
  };
}

function mapSessionCompaction(row) {
  if (!row) return null;
  return {
    compaction_id: row.compaction_id,
    session_id: row.session_id,
    conversation_id: row.conversation_id,
    project_id: row.project_id,
    source_start_order: row.source_start_order,
    source_end_order: row.source_end_order,
    source_item_count: row.source_item_count,
    summary_text: row.summary_text,
    facts: decodeJson(row.facts_json, []),
    open_threads: decodeJson(row.open_threads_json, []),
    artifact_ids: decodeJson(row.artifact_ids_json, []),
    task_ids: decodeJson(row.task_ids_json, []),
    metadata: decodeJson(row.metadata_json, {}),
    created_at: row.created_at
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
  const version = normalizeArtifactVersionMetadata(row);
  return {
    artifact_id: row.artifact_id,
    task_id: row.task_id,
    conversation_id: row.conversation_id ?? null,
    ...(row.project_id !== undefined ? { project_id: row.project_id ?? null } : {}),
    ...(row.conversation_title !== undefined ? { conversation_title: row.conversation_title ?? null } : {}),
    path: row.path,
    mime_type: row.mime_type,
    kind: metadata.kind,
    source: metadata.source,
    bytes: metadata.bytes,
    sha256: metadata.sha256,
    status: metadata.status,
    parent_artifact_id: version.parent_artifact_id,
    revision_of: version.revision_of,
    version_label: version.version_label,
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
  applyArtifactVersioningV1(db);

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
    getEventsForTask: db.prepare("SELECT event_id, task_id, ts, event_type, payload_json FROM task_events WHERE task_id = ? ORDER BY ts ASC, event_id ASC"),
    getEventsForTaskSince: db.prepare(`
      WITH ordered AS (
        SELECT event_id, task_id, ts, event_type, payload_json,
               ROW_NUMBER() OVER (ORDER BY ts ASC, event_id ASC) AS rn
          FROM task_events
         WHERE task_id = @task_id
      ),
      marker AS (
        SELECT rn FROM ordered WHERE event_id = @since_event_id LIMIT 1
      )
      SELECT event_id, task_id, ts, event_type, payload_json
        FROM ordered
       WHERE rn > COALESCE((SELECT rn FROM marker), 0)
       ORDER BY rn ASC
    `),
    insertArtifact: db.prepare(`INSERT OR REPLACE INTO artifacts (
      artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status,
      parent_artifact_id, revision_of, version_label, created_at
    ) VALUES (
      @artifact_id, @task_id, @conversation_id, @path, @mime_type, @kind, @source, @bytes, @sha256, @status,
      @parent_artifact_id, @revision_of, @version_label, @created_at
    )`),
    insertArtifactExtract: db.prepare(`INSERT OR REPLACE INTO artifact_extracts (
      extract_id, artifact_id, task_id, conversation_id, kind, label, locator_json,
      content_text, data_json, source, confidence, metadata_json, created_at
    ) VALUES (
      @extract_id, @artifact_id, @task_id, @conversation_id, @kind, @label, @locator_json,
      @content_text, @data_json, @source, @confidence, @metadata_json, @created_at
    )`),
    insertArtifactLineage: db.prepare(`INSERT OR REPLACE INTO artifact_lineage (
      lineage_id, task_id, conversation_id, action, target_artifact_id, target_kind,
      transform_kind, contract_json, validation_json, metadata_json, created_at
    ) VALUES (
      @lineage_id, @task_id, @conversation_id, @action, @target_artifact_id, @target_kind,
      @transform_kind, @contract_json, @validation_json, @metadata_json, @created_at
    )`),
    deleteArtifactLineageSources: db.prepare("DELETE FROM artifact_lineage_sources WHERE lineage_id = ?"),
    insertArtifactLineageSource: db.prepare(`INSERT OR REPLACE INTO artifact_lineage_sources (
      lineage_source_id, lineage_id, source_artifact_id, source_extract_id, relation, created_at
    ) VALUES (
      @lineage_source_id, @lineage_id, @source_artifact_id, @source_extract_id, @relation, @created_at
    )`),
    getArtifactById: db.prepare("SELECT artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status, parent_artifact_id, revision_of, version_label, created_at FROM artifacts WHERE artifact_id = ?"),
    getArtifactsForTask: db.prepare("SELECT artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status, parent_artifact_id, revision_of, version_label, created_at FROM artifacts WHERE task_id = ? ORDER BY created_at ASC"),
    listArtifactExtractsForArtifact: db.prepare(`
      SELECT extract_id, artifact_id, task_id, conversation_id, kind, label, locator_json,
             content_text, data_json, source, confidence, metadata_json, created_at
        FROM artifact_extracts
       WHERE artifact_id = @artifact_id
       ORDER BY created_at DESC
       LIMIT @limit
    `),
    listArtifactExtractsForTask: db.prepare(`
      SELECT extract_id, artifact_id, task_id, conversation_id, kind, label, locator_json,
             content_text, data_json, source, confidence, metadata_json, created_at
        FROM artifact_extracts
       WHERE task_id = @task_id
       ORDER BY created_at DESC
       LIMIT @limit
    `),
    getArtifactLineageById: db.prepare(`
      SELECT lineage_id, task_id, conversation_id, action, target_artifact_id, target_kind,
             transform_kind, contract_json, validation_json, metadata_json, created_at
        FROM artifact_lineage
       WHERE lineage_id = ?
    `),
    listArtifactLineageSources: db.prepare(`
      SELECT lineage_source_id, lineage_id, source_artifact_id, source_extract_id, relation, created_at
        FROM artifact_lineage_sources
       WHERE lineage_id = ?
       ORDER BY created_at ASC
    `),
    listArtifactLineageForTarget: db.prepare(`
      SELECT lineage_id, task_id, conversation_id, action, target_artifact_id, target_kind,
             transform_kind, contract_json, validation_json, metadata_json, created_at
        FROM artifact_lineage
       WHERE target_artifact_id = @artifact_id
       ORDER BY created_at DESC
       LIMIT @limit
    `),
    listArtifactLineageIdsForSource: db.prepare(`
      SELECT lineage_id, MAX(created_at) AS last_seen_at
        FROM artifact_lineage_sources
       WHERE source_artifact_id = @artifact_id
       GROUP BY lineage_id
       ORDER BY last_seen_at DESC
       LIMIT @limit
    `),
    listArtifactLineageForTask: db.prepare(`
      SELECT lineage_id, task_id, conversation_id, action, target_artifact_id, target_kind,
             transform_kind, contract_json, validation_json, metadata_json, created_at
        FROM artifact_lineage
       WHERE task_id = @task_id
       ORDER BY created_at DESC
       LIMIT @limit
    `),
    getArtifactsForConversation: db.prepare(`
      SELECT artifact_id, task_id, conversation_id, path, mime_type, kind, source, bytes, sha256, status,
             parent_artifact_id, revision_of, version_label, created_at
        FROM artifacts
       WHERE conversation_id = @conversation_id
       ORDER BY created_at DESC
       LIMIT @limit
    `),
    getArtifactsForProject: db.prepare(`
      SELECT artifacts.artifact_id, artifacts.task_id, artifacts.conversation_id,
             conversations.project_id, conversations.title AS conversation_title,
             artifacts.path, artifacts.mime_type, artifacts.kind, artifacts.source,
             artifacts.bytes, artifacts.sha256, artifacts.status,
             artifacts.parent_artifact_id, artifacts.revision_of, artifacts.version_label,
             artifacts.created_at
        FROM artifacts
        JOIN conversations ON conversations.conversation_id = artifacts.conversation_id
       WHERE conversations.project_id = @project_id
         AND conversations.archived = 0
       ORDER BY artifacts.created_at DESC
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
    upsertProject: db.prepare(`INSERT INTO projects (
      project_id, name, color, created_at, updated_at, archived, metadata_json
    ) VALUES (
      @project_id, @name, @color, @created_at, @updated_at, @archived, @metadata_json
    )
    ON CONFLICT(project_id) DO UPDATE SET
      name = excluded.name,
      color = excluded.color,
      archived = excluded.archived,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`),
    getProject: db.prepare("SELECT * FROM projects WHERE project_id = ?"),
    listProjects: db.prepare(`
      SELECT * FROM projects
       WHERE (@archived = -1 OR archived = @archived)
       ORDER BY updated_at DESC, created_at DESC
       LIMIT @limit`),
    upsertProjectFile: db.prepare(`INSERT INTO project_files (
      project_id, path, status, indexed_at, metadata_json, created_at, updated_at
    ) VALUES (
      @project_id, @path, @status, @indexed_at, @metadata_json, @created_at, @updated_at
    )
    ON CONFLICT(project_id, path) DO UPDATE SET
      status = excluded.status,
      indexed_at = excluded.indexed_at,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`),
    listProjectFiles: db.prepare(`
      SELECT * FROM project_files
       WHERE project_id = @project_id
       ORDER BY updated_at DESC
       LIMIT @limit`),
    deleteProjectFile: db.prepare("DELETE FROM project_files WHERE project_id = ? AND path = ?"),
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
    listMessagesBefore: db.prepare(`
      SELECT * FROM (
        SELECT * FROM conversation_messages
         WHERE conversation_id = @conversation_id
           AND seq < @before_seq
         ORDER BY seq DESC LIMIT @limit
      ) ORDER BY seq ASC`),
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
       WHERE task_id = ? ORDER BY created_at ASC`),
    upsertConversationSession: db.prepare(`INSERT INTO conversation_sessions
      (session_id, conversation_id, project_id, parent_task_id, active_task_id, status, created_at, updated_at, metadata_json)
      VALUES (@session_id, @conversation_id, @project_id, @parent_task_id, @active_task_id, @status, @created_at, @updated_at, @metadata_json)
      ON CONFLICT(session_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        project_id = excluded.project_id,
        parent_task_id = excluded.parent_task_id,
        active_task_id = excluded.active_task_id,
        status = excluded.status,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json`),
    getConversationSession: db.prepare("SELECT * FROM conversation_sessions WHERE session_id = ?"),
    getLatestConversationSession: db.prepare(`
      SELECT * FROM conversation_sessions
       WHERE conversation_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`),
    nextSessionItemOrder: db.prepare(`
      SELECT COALESCE(MAX(order_index), -1) + 1 AS next
        FROM session_items
       WHERE session_id = ?`),
    insertSessionItem: db.prepare(`INSERT INTO session_items
      (item_id, session_id, order_index, kind, role, task_id, artifact_id, message_id, ts, content_text, payload_json, provenance_json)
      VALUES (@item_id, @session_id, @order_index, @kind, @role, @task_id, @artifact_id, @message_id, @ts, @content_text, @payload_json, @provenance_json)`),
    listSessionItems: db.prepare(`
      SELECT * FROM session_items
       WHERE session_id = @session_id
         AND order_index >= @since_order
       ORDER BY order_index ASC
       LIMIT @limit`),
    insertSessionCompaction: db.prepare(`INSERT INTO session_compactions
      (compaction_id, session_id, conversation_id, project_id, source_start_order, source_end_order, source_item_count, summary_text, facts_json, open_threads_json, artifact_ids_json, task_ids_json, metadata_json, created_at)
      VALUES (@compaction_id, @session_id, @conversation_id, @project_id, @source_start_order, @source_end_order, @source_item_count, @summary_text, @facts_json, @open_threads_json, @artifact_ids_json, @task_ids_json, @metadata_json, @created_at)`),
    listSessionCompactions: db.prepare(`
      SELECT * FROM session_compactions
       WHERE session_id = @session_id
       ORDER BY source_end_order DESC, created_at DESC
       LIMIT @limit`),
    getLatestSessionCompaction: db.prepare(`
      SELECT * FROM session_compactions
       WHERE session_id = ?
       ORDER BY source_end_order DESC, created_at DESC
       LIMIT 1`)
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
    // Underlying handle for cross-cutting features (search index, diagnostics)
    // that need to add their own virtual tables / triggers. Exposed
    // intentionally — the store still owns lifecycle (close()).
    db,
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
      if (!since) {
        return this.getTaskEvents(taskId);
      }
      return statements.getEventsForTaskSince.all({
        task_id: taskId,
        since_event_id: since
      }).map(mapEvent);
    },
    appendArtifact(artifact) {
      const conversationId = artifact.conversation_id
        ?? artifact.conversationId
        ?? mapTask(statements.getTask.get(artifact.task_id))?.conversation_id
        ?? null;
      const metadata = normalizeArtifactMetadata(artifact);
      const version = normalizeArtifactVersionMetadata(artifact);
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
        parent_artifact_id: version.parent_artifact_id,
        revision_of: version.revision_of,
        version_label: version.version_label,
        created_at: artifact.created_at ?? nowIso()
      };
      statements.insertArtifact.run(record);
      return clone(record);
    },
    getArtifact(artifactId) {
      return mapArtifact(statements.getArtifactById.get(artifactId));
    },
    getArtifactsForTask(taskId) {
      return statements.getArtifactsForTask.all(taskId).map(mapArtifact);
    },
    appendArtifactExtract(extract) {
      if (!extract?.artifact_id) throw new Error("appendArtifactExtract: artifact_id required");
      const artifact = mapArtifact(statements.getArtifactById.get(extract.artifact_id));
      const record = {
        extract_id: extract.extract_id ?? newId("aext"),
        artifact_id: extract.artifact_id,
        task_id: extract.task_id ?? artifact?.task_id ?? null,
        conversation_id: extract.conversation_id ?? artifact?.conversation_id ?? null,
        kind: String(extract.kind ?? "text"),
        label: extract.label ?? null,
        locator_json: encodeJson(extract.locator ?? {}),
        content_text: extract.content_text ?? extract.content ?? null,
        data_json: encodeJson(extract.data ?? null),
        source: extract.source ?? "artifact_extract_service",
        confidence: Number.isFinite(extract.confidence) ? extract.confidence : null,
        metadata_json: encodeJson(extract.metadata ?? {}),
        created_at: extract.created_at ?? nowIso()
      };
      statements.insertArtifactExtract.run(record);
      return mapArtifactExtract(record);
    },
    listArtifactExtractsForArtifact(artifactId, { limit = 50 } = {}) {
      return statements.listArtifactExtractsForArtifact.all({
        artifact_id: artifactId,
        limit: Math.max(1, Math.min(limit ?? 50, 500))
      }).map(mapArtifactExtract);
    },
    listArtifactExtractsForTask(taskId, { limit = 100 } = {}) {
      return statements.listArtifactExtractsForTask.all({
        task_id: taskId,
        limit: Math.max(1, Math.min(limit ?? 100, 500))
      }).map(mapArtifactExtract);
    },
    appendArtifactLineage(lineage) {
      if (!lineage?.target_artifact_id) throw new Error("appendArtifactLineage: target_artifact_id required");
      const target = mapArtifact(statements.getArtifactById.get(lineage.target_artifact_id));
      const sourceArtifactIds = Array.isArray(lineage.source_artifact_ids)
        ? lineage.source_artifact_ids.filter(Boolean)
        : [];
      const sourceExtractIds = Array.isArray(lineage.source_extract_ids)
        ? lineage.source_extract_ids.filter(Boolean)
        : [];
      const record = {
        lineage_id: lineage.lineage_id ?? newId("alineage"),
        task_id: lineage.task_id ?? target?.task_id ?? null,
        conversation_id: lineage.conversation_id ?? target?.conversation_id ?? null,
        action: String(lineage.action ?? "create_new"),
        target_artifact_id: lineage.target_artifact_id,
        target_kind: lineage.target_kind ?? target?.kind ?? null,
        transform_kind: lineage.transform_kind ?? null,
        contract_json: encodeJson(lineage.contract ?? {}),
        validation_json: encodeJson(lineage.validation ?? {}),
        metadata_json: encodeJson(lineage.metadata ?? {}),
        created_at: lineage.created_at ?? nowIso()
      };
      const writeLineage = db.transaction(() => {
        statements.insertArtifactLineage.run(record);
        statements.deleteArtifactLineageSources.run(record.lineage_id);
        for (const [index, sourceArtifactId] of sourceArtifactIds.entries()) {
          statements.insertArtifactLineageSource.run({
            lineage_source_id: newId("alinsrc"),
            lineage_id: record.lineage_id,
            source_artifact_id: sourceArtifactId,
            source_extract_id: sourceExtractIds[index] ?? null,
            relation: "source",
            created_at: record.created_at
          });
        }
      });
      writeLineage();
      return this.getArtifactLineage(record.lineage_id);
    },
    getArtifactLineage(lineageId) {
      return mapArtifactLineage(
        statements.getArtifactLineageById.get(lineageId),
        statements.listArtifactLineageSources.all(lineageId)
      );
    },
    listArtifactLineageForArtifact(artifactId, { role = "any", limit = 50 } = {}) {
      const boundedLimit = Math.max(1, Math.min(limit ?? 50, 500));
      const byTarget = role === "source"
        ? []
        : statements.listArtifactLineageForTarget.all({ artifact_id: artifactId, limit: boundedLimit });
      const bySource = role === "target"
        ? []
        : statements.listArtifactLineageIdsForSource
          .all({ artifact_id: artifactId, limit: boundedLimit })
          .map((row) => statements.getArtifactLineageById.get(row.lineage_id))
          .filter(Boolean);
      const byId = new Map([...byTarget, ...bySource].map((row) => [row.lineage_id, row]));
      return [...byId.values()]
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, boundedLimit)
        .map((row) => mapArtifactLineage(row, statements.listArtifactLineageSources.all(row.lineage_id)));
    },
    listArtifactLineageForTask(taskId, { limit = 100 } = {}) {
      return statements.listArtifactLineageForTask.all({
        task_id: taskId,
        limit: Math.max(1, Math.min(limit ?? 100, 500))
      }).map((row) => mapArtifactLineage(row, statements.listArtifactLineageSources.all(row.lineage_id)));
    },
    getArtifactsForConversation(conversationId, { limit = 100 } = {}) {
      if (!conversationId) return [];
      return statements.getArtifactsForConversation.all({
        conversation_id: conversationId,
        limit: Math.max(1, Math.min(limit ?? 100, 500))
      }).map(mapArtifact);
    },
    listProjectArtifacts({ projectId = null, limit = 100 } = {}) {
      if (!projectId) return [];
      return statements.getArtifactsForProject.all({
        project_id: projectId,
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

    upsertProject(project = {}) {
      const id = String(project.project_id ?? project.id ?? "").trim();
      if (!id) throw new Error("upsertProject: project_id required");
      const existing = mapProject(statements.getProject.get(id));
      const ts = nowIso();
      const createdAt = typeof project.created_at === "string"
        ? project.created_at
        : typeof project.createdAt === "number"
          ? new Date(project.createdAt).toISOString()
          : existing?.created_at ?? ts;
      statements.upsertProject.run({
        project_id: id,
        name: String(project.name ?? existing?.name ?? "New project").slice(0, 200),
        color: project.color ?? existing?.color ?? null,
        created_at: createdAt,
        updated_at: ts,
        archived: project.archived === true ? 1 : 0,
        metadata_json: encodeJson(project.metadata ?? existing?.metadata ?? {})
      });
      return mapProject(statements.getProject.get(id));
    },
    getProject(projectId) {
      return mapProject(statements.getProject.get(projectId));
    },
    listProjects({ archived = 0, limit = 100 } = {}) {
      const archivedFilter = archived === "any" || archived === -1 ? -1 : archived ? 1 : 0;
      return statements.listProjects.all({
        archived: archivedFilter,
        limit: Math.max(1, Math.min(limit ?? 100, 500))
      }).map(mapProject);
    },
    upsertProjectFile(file = {}) {
      const projectId = String(file.project_id ?? file.projectId ?? "").trim();
      const filePath = String(file.path ?? file.filePath ?? "").trim();
      if (!projectId) throw new Error("upsertProjectFile: project_id required");
      if (!filePath) throw new Error("upsertProjectFile: path required");
      const existing = mapProjectFile(statements.listProjectFiles.all({
        project_id: projectId,
        limit: 500
      }).find((row) => row.path === filePath));
      const ts = nowIso();
      statements.upsertProjectFile.run({
        project_id: projectId,
        path: filePath,
        status: file.status ?? existing?.status ?? "attached",
        indexed_at: file.indexed_at ?? file.indexedAt ?? existing?.indexed_at ?? null,
        metadata_json: encodeJson(file.metadata ?? existing?.metadata ?? {}),
        created_at: file.created_at ?? existing?.created_at ?? ts,
        updated_at: ts
      });
      return this.listProjectFiles(projectId, { limit: 500 }).find((item) => item.path === filePath) ?? null;
    },
    listProjectFiles(projectId, { limit = 200 } = {}) {
      return statements.listProjectFiles.all({
        project_id: projectId,
        limit: Math.max(1, Math.min(limit ?? 200, 1000))
      }).map(mapProjectFile);
    },
    deleteProjectFile(projectId, filePath) {
      return statements.deleteProjectFile.run(projectId, filePath).changes > 0;
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
    getConversationMessagesBefore(conversation_id, { beforeSeq, limit = 500 } = {}) {
      const rows = statements.listMessagesBefore.all({
        conversation_id,
        before_seq: Math.max(0, beforeSeq | 0),
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
    },
    upsertConversationSession(session) {
      const existing = session.session_id
        ? mapConversationSession(statements.getConversationSession.get(session.session_id))
        : null;
      const ts = nowIso();
      const record = {
        session_id: session.session_id ?? newId("session"),
        conversation_id: session.conversation_id,
        project_id: session.project_id ?? existing?.project_id ?? null,
        parent_task_id: session.parent_task_id ?? existing?.parent_task_id ?? null,
        active_task_id: session.active_task_id ?? existing?.active_task_id ?? null,
        status: session.status ?? existing?.status ?? "active",
        created_at: session.created_at ?? existing?.created_at ?? ts,
        updated_at: session.updated_at ?? ts,
        metadata_json: encodeJson(session.metadata ?? existing?.metadata ?? {})
      };
      statements.upsertConversationSession.run(record);
      return mapConversationSession(statements.getConversationSession.get(record.session_id));
    },
    getConversationSession(sessionId) {
      return mapConversationSession(statements.getConversationSession.get(sessionId));
    },
    getLatestConversationSession(conversationId) {
      return mapConversationSession(statements.getLatestConversationSession.get(conversationId));
    },
    appendSessionItem(item) {
      if (!item?.session_id) throw new Error("appendSessionItem: session_id required");
      return db.transaction(() => {
        const session = mapConversationSession(statements.getConversationSession.get(item.session_id));
        if (!session) throw new Error(`appendSessionItem: session ${item.session_id} not found`);
        const ts = item.ts ?? nowIso();
        const order_index = item.order_index ?? statements.nextSessionItemOrder.get(item.session_id).next;
        const record = {
          item_id: item.item_id ?? newId("sitem"),
          session_id: item.session_id,
          order_index,
          kind: String(item.kind ?? "runtime_note"),
          role: item.role ?? null,
          task_id: item.task_id ?? null,
          artifact_id: item.artifact_id ?? null,
          message_id: item.message_id ?? null,
          ts,
          content_text: item.content_text ?? item.content ?? null,
          payload_json: encodeJson(item.payload ?? {}),
          provenance_json: encodeJson(item.provenance ?? {})
        };
        statements.insertSessionItem.run(record);
        statements.upsertConversationSession.run({
          session_id: session.session_id,
          conversation_id: session.conversation_id,
          project_id: session.project_id,
          parent_task_id: session.parent_task_id,
          active_task_id: record.task_id ?? session.active_task_id,
          status: session.status,
          created_at: session.created_at,
          updated_at: ts,
          metadata_json: encodeJson(session.metadata ?? {})
        });
        return mapSessionItem({
          ...record,
          payload_json: record.payload_json,
          provenance_json: record.provenance_json
        });
      })();
    },
    listSessionItems(sessionId, { sinceOrder = 0, limit = 500 } = {}) {
      return statements.listSessionItems.all({
        session_id: sessionId,
        since_order: Math.max(0, sinceOrder | 0),
        limit: Math.max(1, Math.min(limit ?? 500, 5000))
      }).map(mapSessionItem);
    },
    appendSessionCompaction(compaction) {
      if (!compaction?.session_id) throw new Error("appendSessionCompaction: session_id required");
      const session = mapConversationSession(statements.getConversationSession.get(compaction.session_id));
      if (!session) throw new Error(`appendSessionCompaction: session ${compaction.session_id} not found`);
      const record = {
        compaction_id: compaction.compaction_id ?? newId("scomp"),
        session_id: compaction.session_id,
        conversation_id: compaction.conversation_id ?? session.conversation_id ?? null,
        project_id: compaction.project_id ?? session.project_id ?? null,
        source_start_order: Number.isInteger(compaction.source_start_order) ? compaction.source_start_order : 0,
        source_end_order: Number.isInteger(compaction.source_end_order) ? compaction.source_end_order : 0,
        source_item_count: Number.isInteger(compaction.source_item_count) ? compaction.source_item_count : 0,
        summary_text: String(compaction.summary_text ?? ""),
        facts_json: encodeJson(Array.isArray(compaction.facts) ? compaction.facts : []),
        open_threads_json: encodeJson(Array.isArray(compaction.open_threads) ? compaction.open_threads : []),
        artifact_ids_json: encodeJson(Array.isArray(compaction.artifact_ids) ? compaction.artifact_ids : []),
        task_ids_json: encodeJson(Array.isArray(compaction.task_ids) ? compaction.task_ids : []),
        metadata_json: encodeJson(compaction.metadata ?? {}),
        created_at: compaction.created_at ?? nowIso()
      };
      statements.insertSessionCompaction.run(record);
      return mapSessionCompaction(record);
    },
    listSessionCompactions(sessionId, { limit = 20 } = {}) {
      return statements.listSessionCompactions.all({
        session_id: sessionId,
        limit: Math.max(1, Math.min(limit ?? 20, 200))
      }).map(mapSessionCompaction);
    },
    getLatestSessionCompaction(sessionId) {
      return mapSessionCompaction(statements.getLatestSessionCompaction.get(sessionId));
    }
  };
}

function mapArtifactExtract(row) {
  if (!row) {
    return null;
  }
  return {
    extract_id: row.extract_id,
    artifact_id: row.artifact_id,
    task_id: row.task_id ?? null,
    conversation_id: row.conversation_id ?? null,
    kind: row.kind,
    label: row.label ?? null,
    locator: decodeJson(row.locator_json, {}),
    content_text: row.content_text ?? null,
    data: decodeJson(row.data_json, null),
    source: row.source ?? null,
    confidence: row.confidence ?? null,
    metadata: decodeJson(row.metadata_json, {}),
    created_at: row.created_at
  };
}

function mapArtifactLineage(row, sources = []) {
  if (!row) {
    return null;
  }
  const sourceRows = Array.isArray(sources) ? sources : [];
  return {
    lineage_id: row.lineage_id,
    task_id: row.task_id ?? null,
    conversation_id: row.conversation_id ?? null,
    action: row.action,
    target_artifact_id: row.target_artifact_id,
    target_kind: row.target_kind ?? null,
    transform_kind: row.transform_kind ?? null,
    source_artifact_ids: sourceRows.map((source) => source.source_artifact_id).filter(Boolean),
    source_extract_ids: sourceRows.map((source) => source.source_extract_id).filter(Boolean),
    sources: sourceRows.map((source) => ({
      lineage_source_id: source.lineage_source_id,
      source_artifact_id: source.source_artifact_id,
      source_extract_id: source.source_extract_id ?? null,
      relation: source.relation,
      created_at: source.created_at
    })),
    contract: decodeJson(row.contract_json, {}),
    validation: decodeJson(row.validation_json, {}),
    metadata: decodeJson(row.metadata_json, {}),
    created_at: row.created_at
  };
}
