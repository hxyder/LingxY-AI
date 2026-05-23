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
import { DEFAULT_PROJECT_ID } from "../../../shared/project-store.mjs";

function memNowIso() { return new Date().toISOString(); }
function memNewId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
const VALID_ROLES = new Set(["user", "assistant", "system", "tool_summary"]);
const VALID_RELATIONS = new Set(["triggered", "answered_by", "tool_summary_for"]);
const VALID_SESSION_STATUSES = new Set(["active", "archived", "closed"]);

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
    projects: new Map(),
    projectFiles: [],
    conversations: new Map(),
    conversationMessages: [],
    messageTaskLinks: [],
    conversationSessions: new Map(),
    sessionItems: [],
    sessionCompactions: [],
    artifactExtracts: [],
    artifactLineage: [],
    artifactLineageSources: [],
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
      const removedLineageIds = new Set(
        this.artifactLineage
          .filter((lineage) => lineage.task_id === taskId)
          .map((lineage) => lineage.lineage_id)
      );
      this.artifactLineage = this.artifactLineage.filter((lineage) => lineage.task_id !== taskId);
      this.artifactLineageSources = this.artifactLineageSources
        .filter((source) => !removedLineageIds.has(source.lineage_id));
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
    getArtifact(artifactId) {
      return this.artifacts.find((artifact) => artifact.artifact_id === artifactId) ?? null;
    },
    getArtifactsForConversation(conversationId, { limit = 100 } = {}) {
      if (!conversationId) return [];
      return this.artifacts
        .filter((artifact) => artifact.conversation_id === conversationId)
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 100, 500)));
    },
    appendArtifactExtract(extract) {
      if (!extract?.artifact_id) throw new Error("appendArtifactExtract: artifact_id required");
      const artifact = this.artifacts.find((row) => row.artifact_id === extract.artifact_id) ?? null;
      const record = {
        extract_id: extract.extract_id ?? memNewId("aext"),
        artifact_id: extract.artifact_id,
        task_id: extract.task_id ?? artifact?.task_id ?? null,
        conversation_id: extract.conversation_id ?? artifact?.conversation_id ?? null,
        kind: String(extract.kind ?? "text"),
        label: extract.label ?? null,
        locator: extract.locator ?? {},
        content_text: extract.content_text ?? extract.content ?? null,
        data: extract.data ?? null,
        source: extract.source ?? "artifact_extract_service",
        confidence: Number.isFinite(extract.confidence) ? extract.confidence : null,
        metadata: extract.metadata ?? {},
        created_at: extract.created_at ?? memNowIso()
      };
      this.artifactExtracts.push(record);
      return {
        ...record,
        locator: { ...(record.locator ?? {}) },
        metadata: { ...(record.metadata ?? {}) }
      };
    },
    listArtifactExtractsForArtifact(artifactId, { limit = 50 } = {}) {
      return this.artifactExtracts
        .filter((extract) => extract.artifact_id === artifactId)
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 50, 500)))
        .map((extract) => ({
          ...extract,
          locator: { ...(extract.locator ?? {}) },
          metadata: { ...(extract.metadata ?? {}) }
        }));
    },
    listArtifactExtractsForTask(taskId, { limit = 100 } = {}) {
      return this.artifactExtracts
        .filter((extract) => extract.task_id === taskId)
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 100, 500)))
        .map((extract) => ({
          ...extract,
          locator: { ...(extract.locator ?? {}) },
          metadata: { ...(extract.metadata ?? {}) }
        }));
    },
    appendArtifactLineage(lineage) {
      if (!lineage?.target_artifact_id) throw new Error("appendArtifactLineage: target_artifact_id required");
      const target = this.getArtifact(lineage.target_artifact_id);
      const sourceArtifactIds = Array.isArray(lineage.source_artifact_ids)
        ? lineage.source_artifact_ids.filter(Boolean)
        : [];
      const sourceExtractIds = Array.isArray(lineage.source_extract_ids)
        ? lineage.source_extract_ids.filter(Boolean)
        : [];
      const record = {
        lineage_id: lineage.lineage_id ?? memNewId("alineage"),
        task_id: lineage.task_id ?? target?.task_id ?? null,
        conversation_id: lineage.conversation_id ?? target?.conversation_id ?? null,
        action: String(lineage.action ?? "create_new"),
        target_artifact_id: lineage.target_artifact_id,
        target_kind: lineage.target_kind ?? target?.kind ?? null,
        transform_kind: lineage.transform_kind ?? null,
        contract: lineage.contract ?? {},
        validation: lineage.validation ?? {},
        metadata: lineage.metadata ?? {},
        created_at: lineage.created_at ?? memNowIso()
      };
      this.artifactLineage.push(record);
      for (const [index, sourceArtifactId] of sourceArtifactIds.entries()) {
        this.artifactLineageSources.push({
          lineage_source_id: memNewId("alinsrc"),
          lineage_id: record.lineage_id,
          source_artifact_id: sourceArtifactId,
          source_extract_id: sourceExtractIds[index] ?? null,
          relation: "source",
          created_at: record.created_at
        });
      }
      return this.getArtifactLineage(record.lineage_id);
    },
    getArtifactLineage(lineageId) {
      const record = this.artifactLineage.find((lineage) => lineage.lineage_id === lineageId);
      if (!record) return null;
      const sources = this.artifactLineageSources.filter((source) => source.lineage_id === lineageId);
      return {
        ...record,
        source_artifact_ids: sources.map((source) => source.source_artifact_id),
        source_extract_ids: sources.map((source) => source.source_extract_id).filter(Boolean),
        contract: { ...(record.contract ?? {}) },
        validation: { ...(record.validation ?? {}) },
        metadata: { ...(record.metadata ?? {}) }
      };
    },
    listArtifactLineageForArtifact(artifactId, { role = "any", limit = 50 } = {}) {
      const lineageIdsFromSource = new Set(
        this.artifactLineageSources
          .filter((source) => source.source_artifact_id === artifactId)
          .map((source) => source.lineage_id)
      );
      return this.artifactLineage
        .filter((lineage) => {
          const isTarget = lineage.target_artifact_id === artifactId;
          const isSource = lineageIdsFromSource.has(lineage.lineage_id);
          if (role === "target") return isTarget;
          if (role === "source") return isSource;
          return isTarget || isSource;
        })
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 50, 500)))
        .map((lineage) => this.getArtifactLineage(lineage.lineage_id));
    },
    listArtifactLineageForTask(taskId, { limit = 100 } = {}) {
      return this.artifactLineage
        .filter((lineage) => lineage.task_id === taskId)
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, Math.max(1, Math.min(limit ?? 100, 500)))
        .map((lineage) => this.getArtifactLineage(lineage.lineage_id));
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

    upsertProject(project = {}) {
      const id = String(project.project_id ?? project.id ?? "").trim();
      if (!id) throw new Error("upsertProject: project_id required");
      const existing = this.projects.get(id) ?? null;
      const ts = memNowIso();
      const record = {
        project_id: id,
        id,
        name: String(project.name ?? existing?.name ?? "New project").slice(0, 200),
        color: project.color ?? existing?.color ?? null,
        created_at: typeof project.created_at === "string" ? project.created_at : existing?.created_at ?? ts,
        updated_at: ts,
        createdAt: Number.isFinite(Number(project.createdAt)) ? Number(project.createdAt) : existing?.createdAt ?? Date.parse(ts),
        archived: project.archived === true,
        metadata: project.metadata ?? existing?.metadata ?? {}
      };
      this.projects.set(id, record);
      return { ...record, metadata: { ...(record.metadata ?? {}) } };
    },
    getProject(projectId) {
      const project = this.projects.get(projectId);
      return project ? { ...project, metadata: { ...(project.metadata ?? {}) } } : null;
    },
    listProjects({ archived = 0, limit = 100 } = {}) {
      const archivedFilter = archived === "any" || archived === -1 ? null : Boolean(archived);
      let list = [...this.projects.values()];
      if (archivedFilter !== null) list = list.filter((project) => project.archived === archivedFilter);
      list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return list.slice(0, Math.max(1, Math.min(limit ?? 100, 500)))
        .map((project) => ({ ...project, metadata: { ...(project.metadata ?? {}) } }));
    },
    upsertProjectFile(file = {}) {
      const projectId = String(file.project_id ?? file.projectId ?? "").trim();
      const filePath = String(file.path ?? file.filePath ?? "").trim();
      if (!projectId) throw new Error("upsertProjectFile: project_id required");
      if (!filePath) throw new Error("upsertProjectFile: path required");
      const ts = memNowIso();
      const index = this.projectFiles.findIndex((item) => item.project_id === projectId && item.path === filePath);
      const existing = index >= 0 ? this.projectFiles[index] : null;
      const record = {
        project_id: projectId,
        path: filePath,
        status: file.status ?? existing?.status ?? "attached",
        indexed_at: file.indexed_at ?? file.indexedAt ?? existing?.indexed_at ?? null,
        created_at: file.created_at ?? existing?.created_at ?? ts,
        updated_at: ts,
        metadata: file.metadata ?? existing?.metadata ?? {}
      };
      if (index >= 0) this.projectFiles[index] = record;
      else this.projectFiles.push(record);
      return { ...record, metadata: { ...(record.metadata ?? {}) } };
    },
    listProjectFiles(projectId, { limit = 200 } = {}) {
      return this.projectFiles
        .filter((file) => file.project_id === projectId)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(0, Math.max(1, Math.min(limit ?? 200, 1000)))
        .map((file) => ({ ...file, metadata: { ...(file.metadata ?? {}) } }));
    },
    deleteProjectFile(projectId, filePath) {
      const before = this.projectFiles.length;
      this.projectFiles = this.projectFiles.filter((file) => !(file.project_id === projectId && file.path === filePath));
      return this.projectFiles.length !== before;
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
    listConversations({ projectId = null, conversationScope = null, limit = 50, archived = 0 } = {}) {
      const archivedFilter = archived === "any" || archived === -1 ? null : Boolean(archived);
      let list = [...this.conversations.values()];
      if (projectId) {
        list = list.filter((c) => c.project_id === projectId);
      } else if (conversationScope === "ordinary") {
        list = list.filter((c) => !c.project_id || c.project_id === DEFAULT_PROJECT_ID);
      }
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
    getConversationMessagesBefore(conversation_id, { beforeSeq, limit = 500 } = {}) {
      return this.conversationMessages
        .filter((m) => m.conversation_id === conversation_id && m.seq < (beforeSeq | 0))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, Math.max(1, Math.min(limit ?? 500, 5000)))
        .sort((a, b) => a.seq - b.seq)
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
    },

    upsertConversationSession(session) {
      if (!session?.session_id) throw new Error("upsertConversationSession: session_id required");
      if (!session?.conversation_id) throw new Error("upsertConversationSession: conversation_id required");
      const existing = this.conversationSessions.get(session.session_id);
      const ts = memNowIso();
      const record = {
        session_id: session.session_id,
        conversation_id: session.conversation_id,
        project_id: session.project_id ?? existing?.project_id ?? null,
        parent_task_id: session.parent_task_id ?? existing?.parent_task_id ?? null,
        active_task_id: session.active_task_id ?? existing?.active_task_id ?? null,
        status: VALID_SESSION_STATUSES.has(session.status) ? session.status : (existing?.status ?? "active"),
        created_at: session.created_at ?? existing?.created_at ?? ts,
        updated_at: session.updated_at ?? ts,
        metadata: session.metadata ?? existing?.metadata ?? {}
      };
      this.conversationSessions.set(record.session_id, record);
      return { ...record, metadata: { ...(record.metadata ?? {}) } };
    },
    getConversationSession(sessionId) {
      const session = this.conversationSessions.get(sessionId);
      return session ? { ...session, metadata: { ...(session.metadata ?? {}) } } : null;
    },
    getLatestConversationSession(conversationId) {
      if (!conversationId) return null;
      const sessions = [...this.conversationSessions.values()]
        .filter((session) => session.conversation_id === conversationId)
        .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
      const session = sessions[0] ?? null;
      return session ? { ...session, metadata: { ...(session.metadata ?? {}) } } : null;
    },
    appendSessionItem(item) {
      if (!item?.session_id) throw new Error("appendSessionItem: session_id required");
      const session = this.conversationSessions.get(item.session_id);
      if (!session) throw new Error(`appendSessionItem: session ${item.session_id} not found`);
      const ts = item.ts ?? memNowIso();
      const order_index = item.order_index ?? this.sessionItems
        .filter((row) => row.session_id === item.session_id)
        .reduce((max, row) => Math.max(max, row.order_index), -1) + 1;
      const record = {
        item_id: item.item_id ?? memNewId("sitem"),
        session_id: item.session_id,
        order_index,
        kind: String(item.kind ?? "runtime_note"),
        role: item.role ?? null,
        task_id: item.task_id ?? null,
        artifact_id: item.artifact_id ?? null,
        message_id: item.message_id ?? null,
        ts,
        content_text: item.content_text ?? item.content ?? null,
        payload: item.payload ?? {},
        provenance: item.provenance ?? {}
      };
      this.sessionItems.push(record);
      session.updated_at = ts;
      if (record.task_id) session.active_task_id = record.task_id;
      return {
        ...record,
        payload: { ...(record.payload ?? {}) },
        provenance: { ...(record.provenance ?? {}) }
      };
    },
    listSessionItems(sessionId, { sinceOrder = 0, limit = 500 } = {}) {
      return this.sessionItems
        .filter((item) => item.session_id === sessionId && item.order_index >= (sinceOrder | 0))
        .sort((a, b) => a.order_index - b.order_index)
        .slice(0, Math.max(1, Math.min(limit ?? 500, 5000)))
        .map((item) => ({
          ...item,
          payload: { ...(item.payload ?? {}) },
          provenance: { ...(item.provenance ?? {}) }
        }));
    },
    appendSessionCompaction(compaction) {
      if (!compaction?.session_id) throw new Error("appendSessionCompaction: session_id required");
      const session = this.conversationSessions.get(compaction.session_id);
      if (!session) throw new Error(`appendSessionCompaction: session ${compaction.session_id} not found`);
      const record = {
        compaction_id: compaction.compaction_id ?? memNewId("scomp"),
        session_id: compaction.session_id,
        conversation_id: compaction.conversation_id ?? session.conversation_id ?? null,
        project_id: compaction.project_id ?? session.project_id ?? null,
        source_start_order: Number.isInteger(compaction.source_start_order) ? compaction.source_start_order : 0,
        source_end_order: Number.isInteger(compaction.source_end_order) ? compaction.source_end_order : 0,
        source_item_count: Number.isInteger(compaction.source_item_count) ? compaction.source_item_count : 0,
        summary_text: String(compaction.summary_text ?? ""),
        facts: Array.isArray(compaction.facts) ? [...compaction.facts] : [],
        open_threads: Array.isArray(compaction.open_threads) ? [...compaction.open_threads] : [],
        artifact_ids: Array.isArray(compaction.artifact_ids) ? [...compaction.artifact_ids] : [],
        task_ids: Array.isArray(compaction.task_ids) ? [...compaction.task_ids] : [],
        metadata: compaction.metadata ?? {},
        created_at: compaction.created_at ?? memNowIso()
      };
      this.sessionCompactions.push(record);
      return {
        ...record,
        facts: [...record.facts],
        open_threads: [...record.open_threads],
        artifact_ids: [...record.artifact_ids],
        task_ids: [...record.task_ids],
        metadata: { ...(record.metadata ?? {}) }
      };
    },
    listSessionCompactions(sessionId, { limit = 20 } = {}) {
      return this.sessionCompactions
        .filter((compaction) => compaction.session_id === sessionId)
        .sort((a, b) => {
          if (b.source_end_order !== a.source_end_order) return b.source_end_order - a.source_end_order;
          return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
        })
        .slice(0, Math.max(1, Math.min(limit ?? 20, 200)))
        .map((compaction) => ({
          ...compaction,
          facts: [...(compaction.facts ?? [])],
          open_threads: [...(compaction.open_threads ?? [])],
          artifact_ids: [...(compaction.artifact_ids ?? [])],
          task_ids: [...(compaction.task_ids ?? [])],
          metadata: { ...(compaction.metadata ?? {}) }
        }));
    },
    getLatestSessionCompaction(sessionId) {
      return this.listSessionCompactions(sessionId, { limit: 1 })[0] ?? null;
    }
  };
}
