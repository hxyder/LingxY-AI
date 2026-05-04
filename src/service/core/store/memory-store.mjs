import crypto from "node:crypto";
import {
  filterDeletedRecords,
  markRecordDeleted,
  restoreDeletedRecord
} from "../deletion-lifecycle.mjs";
import {
  normalizeArtifactMetadata,
  normalizeArtifactVersionMetadata
} from "./artifact-metadata.mjs";

function memNowIso() { return new Date().toISOString(); }
function memNewId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
const VALID_ROLES = new Set(["user", "assistant", "system", "tool_summary"]);
const VALID_RELATIONS = new Set(["triggered", "answered_by", "tool_summary_for"]);

export function createInMemoryStoreScaffold() {
  return {
    tasks: new Map(),
    taskEvents: [],
    artifacts: [],
    pendingApprovals: [],
    auditLogs: [],
    schedules: new Map(),
    scheduleRuns: [],
    connectedAccounts: new Map(),
    oauthTokens: new Map(),
    reauthRequests: new Map(),
    conversations: new Map(),
    conversationMessages: [],
    messageTaskLinks: [],
    insertTask(task) {
      this.tasks.set(task.task_id, task);
      return task;
    },
    updateTask(taskId, task) {
      this.tasks.set(taskId, task);
      return task;
    },
    getTask(taskId) {
      return this.tasks.get(taskId) ?? null;
    },
    softDeleteTask(taskId, options = {}) {
      const existing = this.getTask(taskId);
      if (!existing) {
        return null;
      }
      const deleted = markRecordDeleted(existing, options);
      this.tasks.set(taskId, deleted);
      return { ...deleted };
    },
    restoreTask(taskId, options = {}) {
      const existing = this.getTask(taskId);
      if (!existing) {
        return null;
      }
      const restored = restoreDeletedRecord(existing, options);
      this.tasks.set(taskId, restored);
      return { ...restored };
    },
    deleteTask(taskId) {
      const existed = this.tasks.has(taskId);
      this.tasks.delete(taskId);
      this.taskEvents = this.taskEvents.filter((e) => e.task_id !== taskId);
      this.artifacts = this.artifacts.filter((a) => a.task_id !== taskId);
      return existed;
    },
    listTasks(options = {}) {
      return filterDeletedRecords([...this.tasks.values()], options);
    },
    appendEvent(event) {
      this.taskEvents.push(event);
      return event;
    },
    getTaskEvents(taskId) {
      return this.taskEvents.filter((event) => event.task_id === taskId);
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
        ?? this.tasks.get(artifact.task_id)?.conversation_id
        ?? null;
      const metadata = normalizeArtifactMetadata(artifact);
      const version = normalizeArtifactVersionMetadata(artifact);
      const record = {
        ...artifact,
        conversation_id: conversationId,
        kind: metadata.kind,
        source: metadata.source,
        bytes: metadata.bytes,
        sha256: metadata.sha256,
        status: metadata.status,
        parent_artifact_id: version.parent_artifact_id,
        revision_of: version.revision_of,
        version_label: version.version_label,
        created_at: artifact.created_at ?? memNowIso()
      };
      this.artifacts.push(record);
      return record;
    },
    getArtifactsForTask(taskId) {
      return this.artifacts.filter((artifact) => artifact.task_id === taskId);
    },
    getArtifactsForConversation(conversationId, { limit = 100 } = {}) {
      if (!conversationId) return [];
      return this.artifacts
        .filter((artifact) => artifact.conversation_id === conversationId)
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 100, 500)));
    },
    listProjectArtifacts({ projectId = null, limit = 100 } = {}) {
      if (!projectId) return [];
      const conversationById = new Map([...this.conversations.values()]
        .filter((conversation) => conversation.project_id === projectId && !conversation.archived)
        .map((conversation) => [conversation.conversation_id, conversation]));
      return this.artifacts
        .filter((artifact) => conversationById.has(artifact.conversation_id))
        .map((artifact) => {
          const conversation = conversationById.get(artifact.conversation_id);
          return {
            ...artifact,
            project_id: projectId,
            conversation_title: conversation?.title ?? null
          };
        })
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 100, 500)));
    },
    appendPendingApproval(approval) {
      this.pendingApprovals.push(approval);
      return approval;
    },
    getPendingApproval(approvalId) {
      return this.pendingApprovals.find((approval) => approval.approval_id === approvalId) ?? null;
    },
    listPendingApprovals() {
      return [...this.pendingApprovals];
    },
    updatePendingApproval(approvalId, patch) {
      const index = this.pendingApprovals.findIndex((approval) => approval.approval_id === approvalId);
      if (index === -1) {
        return null;
      }

      this.pendingApprovals[index] = {
        ...this.pendingApprovals[index],
        ...patch
      };
      return this.pendingApprovals[index];
    },
    insertSchedule(schedule) {
      this.schedules.set(schedule.schedule_id, schedule);
      return schedule;
    },
    updateSchedule(scheduleId, schedule) {
      this.schedules.set(scheduleId, schedule);
      return schedule;
    },
    getSchedule(scheduleId) {
      return this.schedules.get(scheduleId) ?? null;
    },
    listSchedules() {
      return [...this.schedules.values()];
    },
    deleteSchedule(scheduleId) {
      const schedule = this.schedules.get(scheduleId) ?? null;
      this.schedules.delete(scheduleId);
      return schedule;
    },
    appendScheduleRun(run) {
      this.scheduleRuns.push(run);
      return run;
    },
    updateScheduleRun(runId, patch) {
      const index = this.scheduleRuns.findIndex((run) => run.run_id === runId);
      if (index === -1) {
        return null;
      }

      this.scheduleRuns[index] = {
        ...this.scheduleRuns[index],
        ...patch
      };
      return this.scheduleRuns[index];
    },
    getScheduleRun(runId) {
      return this.scheduleRuns.find((run) => run.run_id === runId) ?? null;
    },
    listScheduleRuns(scheduleId = null) {
      if (!scheduleId) {
        return [...this.scheduleRuns];
      }
      return this.scheduleRuns.filter((run) => run.schedule_id === scheduleId);
    },
    appendAuditLog(entry) {
      this.auditLogs.push(entry);
      return entry;
    },
    listAuditLogs() {
      return [...this.auditLogs];
    },
    upsertConnectedAccount(account) {
      const accountId = account.id ?? account.accountId;
      this.connectedAccounts.set(accountId, { ...account, id: accountId, accountId });
      return this.connectedAccounts.get(accountId);
    },
    getConnectedAccount(accountId) {
      return this.connectedAccounts.get(accountId) ?? null;
    },
    listConnectedAccounts() {
      return [...this.connectedAccounts.values()];
    },
    deleteConnectedAccount(accountId) {
      const existing = this.getConnectedAccount(accountId);
      this.connectedAccounts.delete(accountId);
      this.oauthTokens.delete(accountId);
      return existing;
    },
    upsertOAuthToken(record) {
      this.oauthTokens.set(record.accountId, { ...record });
      return this.oauthTokens.get(record.accountId);
    },
    getOAuthToken(accountId) {
      return this.oauthTokens.get(accountId) ?? null;
    },
    deleteOAuthToken(accountId) {
      const existing = this.getOAuthToken(accountId);
      this.oauthTokens.delete(accountId);
      return existing;
    },
    upsertReauthRequest(record) {
      this.reauthRequests.set(record.requestId, { ...record });
      return this.reauthRequests.get(record.requestId);
    },
    getReauthRequest(requestId) {
      return this.reauthRequests.get(requestId) ?? null;
    },
    listReauthRequests() {
      return [...this.reauthRequests.values()];
    },

    runInTransaction(fn) {
      return fn();
    },

    insertConversation({ conversation_id, project_id = null, title = null, metadata = {} } = {}) {
      const id = conversation_id ?? memNewId("conv");
      const ts = memNowIso();
      const conv = {
        conversation_id: id,
        project_id: project_id ?? null,
        title: title ?? null,
        created_at: ts,
        updated_at: ts,
        message_count: 0,
        task_count: 0,
        archived: false,
        metadata: metadata ?? {}
      };
      this.conversations.set(id, conv);
      return { ...conv };
    },
    getConversation(id) {
      const conv = this.conversations.get(id);
      return conv ? { ...conv } : null;
    },
    listConversations({ projectId = null, limit = 50, archived = 0 } = {}) {
      const archivedFilter = archived === "any" || archived === -1 ? null : Boolean(archived);
      let list = [...this.conversations.values()];
      if (projectId) list = list.filter((c) => c.project_id === projectId);
      if (archivedFilter !== null) list = list.filter((c) => c.archived === archivedFilter);
      list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return list.slice(0, Math.max(1, Math.min(limit ?? 50, 500))).map((c) => ({ ...c }));
    },
    updateConversation(id, patch = {}) {
      const conv = this.conversations.get(id);
      if (!conv) return null;
      if (patch.title !== undefined) conv.title = patch.title;
      if (patch.project_id !== undefined) conv.project_id = patch.project_id;
      if (patch.archived !== undefined) conv.archived = Boolean(patch.archived);
      if (patch.metadata !== undefined) conv.metadata = patch.metadata;
      conv.updated_at = memNowIso();
      return { ...conv };
    },
    patchConversationMetadata(id, patch = {}) {
      const conv = this.conversations.get(id);
      if (!conv) return null;
      conv.metadata = {
        ...(conv.metadata ?? {}),
        ...(patch ?? {})
      };
      conv.updated_at = memNowIso();
      return { ...conv };
    },
    softDeleteConversation(id) {
      const conv = this.conversations.get(id);
      if (!conv) return null;
      conv.archived = true;
      conv.updated_at = memNowIso();
      return { ...conv };
    },
    hardDeleteConversation(id) {
      this.conversationMessages = this.conversationMessages.filter((m) => m.conversation_id !== id);
      this.messageTaskLinks = this.messageTaskLinks.filter((l) => {
        const msg = this.conversationMessages.find((m) => m.message_id === l.message_id);
        return msg !== undefined;
      });
      return this.conversations.delete(id);
    },

    appendMessage({ conversation_id, role, content, status = null, metadata = {} } = {}) {
      if (!conversation_id) throw new Error("appendMessage: conversation_id required");
      if (!VALID_ROLES.has(role)) throw new Error(`appendMessage: invalid role ${role}`);
      const conv = this.conversations.get(conversation_id);
      if (!conv) throw new Error(`appendMessage: conversation ${conversation_id} not found`);
      const seq = this.conversationMessages
        .filter((m) => m.conversation_id === conversation_id)
        .reduce((max, m) => Math.max(max, m.seq), -1) + 1;
      const ts = memNowIso();
      const msg = {
        message_id: memNewId("msg"),
        conversation_id, seq, role,
        content: String(content ?? ""),
        ts, status: status ?? null,
        metadata: metadata ?? {}
      };
      this.conversationMessages.push(msg);
      conv.message_count += 1;
      conv.updated_at = ts;
      return { ...msg };
    },
    getConversationMessages(conversation_id, { sinceSeq = 0, limit = 500 } = {}) {
      return this.conversationMessages
        .filter((m) => m.conversation_id === conversation_id && m.seq >= (sinceSeq | 0))
        .sort((a, b) => a.seq - b.seq)
        .slice(0, Math.max(1, Math.min(limit ?? 500, 5000)))
        .map((m) => ({ ...m }));
    },
    getMessage(message_id) {
      const m = this.conversationMessages.find((row) => row.message_id === message_id);
      return m ? { ...m } : null;
    },
    countConversationMessages(conversation_id) {
      return this.conversationMessages.filter((m) => m.conversation_id === conversation_id).length;
    },

    linkMessageToTask(message_id, task_id, relation) {
      if (!VALID_RELATIONS.has(relation)) {
        throw new Error(`linkMessageToTask: invalid relation ${relation}`);
      }
      if (this.messageTaskLinks.some(
        (l) => l.message_id === message_id && l.task_id === task_id && l.relation === relation
      )) {
        return { message_id, task_id, relation, created_at: memNowIso(), inserted: false };
      }
      const created_at = memNowIso();
      this.messageTaskLinks.push({ message_id, task_id, relation, created_at });
      if (relation === "triggered") {
        const msg = this.conversationMessages.find((m) => m.message_id === message_id);
        if (msg) {
          const conv = this.conversations.get(msg.conversation_id);
          if (conv) {
            conv.task_count += 1;
            conv.updated_at = created_at;
          }
        }
      }
      return { message_id, task_id, relation, created_at, inserted: true };
    },
    getMessageTasks(message_id) {
      return this.messageTaskLinks
        .filter((l) => l.message_id === message_id)
        .map((l) => ({ ...l }));
    },
    getTaskMessages(task_id) {
      return this.messageTaskLinks
        .filter((l) => l.task_id === task_id)
        .map((l) => ({ ...l }));
    }
  };
}
