const EXPORT_SCHEMA_VERSION = 1;

const SECRET_KEY_RE = /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|credential|authorization|cookie)/i;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function redactValue(value, key = "") {
  if (value == null) return value;
  if (SECRET_KEY_RE.test(key)) {
    if (/ref$/i.test(key) && typeof value === "string" && value.startsWith("secret://")) {
      return "[secret-ref-redacted]";
    }
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (typeof value === "object") {
    const next = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      next[childKey] = redactValue(childValue, childKey);
    }
    return next;
  }
  return value;
}

export function redactForExport(value) {
  return redactValue(cloneJson(value));
}

function providerRequiresKey(provider = {}) {
  if (!provider || provider.kind === "code_cli" || provider.kind === "ollama") return false;
  return Boolean(provider.apiKey || provider.apiKeyRef || provider.apiKeyConfigured);
}

export function redactRuntimeConfigForExport(config = {}) {
  const next = redactValue(cloneJson(config)) ?? {};
  const providers = Array.isArray(config.ai?.customProviders) ? config.ai.customProviders : [];
  if (Array.isArray(next.ai?.customProviders)) {
    next.ai.customProviders = next.ai.customProviders.map((provider, index) => {
      const original = providers[index] ?? {};
      const redacted = { ...provider };
      delete redacted.apiKey;
      delete redacted.apiKeyRef;
      delete redacted.apiKeyConfigured;
      if (providerRequiresKey(original)) {
        redacted.requiresApiKey = true;
      }
      return redacted;
    });
  }
  return next;
}

function collectConversations(store) {
  const conversations = typeof store?.listConversations === "function"
    ? store.listConversations({ archived: "any", limit: 500 })
    : [];
  return conversations.map((conversation) => ({
    ...conversation,
    messages: typeof store?.getConversationMessages === "function"
      ? store.getConversationMessages(conversation.conversation_id, { limit: 5000 })
      : []
  }));
}

function collectTaskEvents(store, taskId) {
  if (typeof store?.getTaskEvents !== "function") return [];
  return store.getTaskEvents(taskId).map((event) => redactValue(event));
}

function collectArtifacts(store, taskId) {
  if (typeof store?.getArtifactsForTask !== "function") return [];
  return store.getArtifactsForTask(taskId).map((artifact) => ({
    artifact_id: artifact.artifact_id,
    task_id: artifact.task_id,
    path: artifact.path,
    mime_type: artifact.mime_type ?? null,
    created_at: artifact.created_at ?? null
  }));
}

function collectTasks(store, { includeTaskEvents = true } = {}) {
  const tasks = typeof store?.listTasks === "function" ? store.listTasks({ deleted: "any" }) : [];
  return tasks.map((task) => {
    const taskId = task?.task_id;
    return {
      task: redactValue(task),
      artifacts: taskId ? collectArtifacts(store, taskId) : [],
      events: includeTaskEvents && taskId ? collectTaskEvents(store, taskId) : []
    };
  });
}

export function buildRuntimeExportBundle(runtime, {
  includeTaskEvents = true
} = {}) {
  const config = runtime?.configStore?.load?.() ?? {};
  const store = runtime?.store ?? runtime?.storeAdapter ?? null;
  const schedules = typeof store?.listSchedules === "function" ? store.listSchedules() : [];
  const scheduleRuns = typeof store?.listScheduleRuns === "function" ? store.listScheduleRuns() : [];
  const auditLogs = typeof store?.listAuditLogs === "function" ? store.listAuditLogs() : [];
  const connectedAccounts = typeof store?.listConnectedAccounts === "function" ? store.listConnectedAccounts() : [];

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    app: {
      name: "LingxY",
      export_kind: "runtime_bundle"
    },
    config: redactRuntimeConfigForExport(config),
    notes: runtime?.notesStore?.listNotes?.({ deleted: "any" }) ?? [],
    projectStore: config.ui?.projectStore ?? null,
    conversations: collectConversations(store),
    tasks: collectTasks(store, { includeTaskEvents }),
    schedules: {
      schedules,
      runs: scheduleRuns
    },
    connectedAccounts: connectedAccounts.map((account) => redactValue(account)),
    auditLogs: auditLogs.map((entry) => redactValue(entry)),
    manifest: {
      includes: [
        "config_redacted",
        "notes",
        "projectStore",
        "conversations",
        "tasks",
        "task_events",
        "artifact_manifest",
        "schedules",
        "connected_accounts_redacted",
        "audit_logs_redacted"
      ],
      excludes: [
        "provider_api_keys",
        "oauth_tokens",
        "email_passwords",
        "secret_store",
        "raw_artifact_files",
        "sqlite_database"
      ]
    }
  };
}
