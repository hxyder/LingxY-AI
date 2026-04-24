import { sanitizeProviderConfig, sanitizeTaskRouteForProvider } from "../../shared/provider-catalog.mjs";
import { buildStoreManifest } from "./store/sqlite-schema.mjs";
import { createInMemoryStoreScaffold } from "./store/memory-store.mjs";
import { createEventBusScaffold } from "./events/event-bus.mjs";
import { createTaskQueueScaffold } from "./queue/task-queue.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { createFastExecutorScaffold } from "../executors/fast/fast-executor.mjs";
import { createKimiCliExecutorScaffold } from "../executors/kimi/kimi-cli-executor.mjs";
import { createToolUsingExecutorScaffold } from "../executors/tool_using/agent-loop.mjs";
import { createMultiModalExecutorScaffold } from "../executors/multi_modal/multi-modal-executor.mjs";
import { createTranslateExecutorScaffold } from "../executors/translate/translate-executor.mjs";
import { createAgenticExecutorScaffold } from "../executors/agentic/executor.mjs";
import { createExecutorRegistry } from "../executors/registry.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { createNotesStore } from "../store/notes-store.mjs";
import { createPreviewRegistry } from "../preview/registry.mjs";
import { BUILTIN_PREVIEW_PROVIDERS } from "../preview/providers/index.mjs";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createActionToolRegistry } from "../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { createSchedulerRuntime } from "../scheduler/engine.mjs";
import { createOfficeHttpsRuntime } from "../https/port-9413.mjs";
import { createBuiltinTemplateRegistry, createPersistentTemplateRegistry } from "../templates/runtime.mjs";
import { createBudgetManager } from "../cost/budget.mjs";
import { createEmbeddingStore } from "../embeddings/store.mjs";
import { createAIIntegrationRuntime } from "../ai/integrations/runtime.mjs";
import { runMcpAutoInstall } from "../ai/mcp/auto-install.mjs";
import { createDagCheckpointStore } from "../dag/scheduler.mjs";
import { createEmailMonitor } from "../email/monitor.mjs";
import { createConnectorCatalog } from "../connectors/core/catalog.mjs";
import { createPluginRegistry } from "../connectors/core/plugin-registry.mjs";

// Minimal in-memory config store: survives within a single process lifetime
// but doesn't persist to disk. Used when createServiceBootstrap() is called
// without an explicit configStore (e.g. from verify scripts). Production code
// passes a real disk-backed configStore from createPersistentRuntime().

function createInMemoryConfigStore() {
  let state = {};
  return {
    configPath: null,
    load() { return JSON.parse(JSON.stringify(state)); },
    save(config) { state = JSON.parse(JSON.stringify(config)); return state; },
    patch(nextPatch) {
      function deepMerge(base, patch) {
        const merged = { ...base };
        for (const [key, value] of Object.entries(patch ?? {})) {
          if (value && typeof value === "object" && !Array.isArray(value)
              && merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
            merged[key] = deepMerge(merged[key], value);
          } else {
            merged[key] = value;
          }
        }
        return merged;
      }
      state = deepMerge(state, nextPatch);
      return state;
    }
  };
}

export function createServiceBootstrap({
  storeAdapter = createInMemoryStoreScaffold(),
  artifactStore = createArtifactStore(),
  configStore = null,
  securityConfig = {},
  kimiRuntime = null,
  paths = null
} = {}) {
  // Ensure configStore is always available — verify scripts and email monitor
  // need load()/save()/patch() even when no disk-backed store is provided.
  if (!configStore) {
    configStore = createInMemoryConfigStore();
  }
  const queue = createTaskQueueScaffold();
  const executors = [
    createFastExecutorScaffold(),
    createKimiCliExecutorScaffold(),
    createToolUsingExecutorScaffold(),
    createMultiModalExecutorScaffold(),
    createTranslateExecutorScaffold(),
    createAgenticExecutorScaffold()
  ];
  const runtime = {
    store: storeAdapter,
    storeAdapter,
    eventBus: createEventBusScaffold(),
    queue,
    artifactStore,
    notesStore: paths?.notesPath ? createNotesStore({ filePath: paths.notesPath }) : null,
    previewRegistry: null, // attached below once the runtime is built
    executors,
    kimiRuntime,
    configStore,
    paths,
    metrics: createMetricsRegistry({
      store: storeAdapter,
      queue
    })
  };
  runtime.securityBroker = createSecurityBroker({
    runtime,
    config: securityConfig
  });
  runtime.scheduler = createSchedulerRuntime({ runtime });
  runtime.officeHttps = createOfficeHttpsRuntime();
  runtime.connectorCatalog = createConnectorCatalog({
    pluginRootsProvider: () => runtime.pluginRegistry?.pluginRootsProvider?.() ?? []
  });
  runtime.pluginRegistry = createPluginRegistry({
    runtime,
    pluginsDir: paths?.pluginsDir ?? null
  });
  runtime.connectorCatalog.reload();
  runtime.actionToolRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  runtime.executorRegistry = createExecutorRegistry(executors);
  runtime.previewRegistry = createPreviewRegistry({
    providers: BUILTIN_PREVIEW_PROVIDERS,
    cacheDir: paths?.previewCacheDir ?? null,
    runtime
  });

  // UCA-182 Phase 6 — warm-start the heavy preview deps. `marked`
  // + `mammoth` have cold-start costs (~15ms and ~80ms respectively
  // on first call). Pre-loading here keeps the first preview the
  // user opens snappy without paying for extra ram we wouldn't
  // need otherwise. Async + unhandled errors swallowed: if a module
  // is missing the provider itself will fall through to native-open.
  void Promise.all([
    import("marked").catch(() => null),
    import("mammoth").catch(() => null)
  ]);
  runtime.platform = {
    templateRegistry: paths?.templatesDir
      ? createPersistentTemplateRegistry({ templatesDir: paths.templatesDir })
      : createBuiltinTemplateRegistry(),
    budgetManager: createBudgetManager(undefined, {
      stateFilePath: paths?.budgetStatePath ?? null
    }),
    embeddingStore: createEmbeddingStore({
      filePath: paths?.historyStorePath ?? null
    }),
    dagCheckpointStore: createDagCheckpointStore({
      runsDir: paths?.dagRunsDir ?? null
    }),
    ...createAIIntegrationRuntime({
      configStore,
      paths
    })
  };
  // Feature flags — toggled via environment variables so users can test
  // experimental paths without editing code. Set before starting the
  // desktop app:
  //   PowerShell: $env:LINGXY_DAG_PLANNER="true"; $env:LINGXY_DAG_STREAMING="true"; npm run start:desktop
  //   bash      : LINGXY_DAG_PLANNER=true LINGXY_DAG_STREAMING=true npm run start:desktop
  runtime.featureFlags = {
    dagPlanner: process.env.LINGXY_DAG_PLANNER === "true"
      || process.env.LINGXY_DAG_PLANNER === "1",
    dagStreaming: process.env.LINGXY_DAG_STREAMING === "true"
      || process.env.LINGXY_DAG_STREAMING === "1"
  };
  // First-run MCP auto-install — pins mcp-filesystem + mcp-memory as enabled
  // so users don't have to hunt for the Connectors toggle on a clean install.
  try { runMcpAutoInstall({ runtime }); } catch { /* non-fatal */ }

  // UCA-182 Phase 22b: scrub stale AI config at boot. Earlier
  // versions wrote provider.defaultModel="deepseek-chat" (now
  // deprecated, auto-upgraded to deepseek-v4-flash) and sometimes
  // leaked a reasoningEffort in the wrong format (e.g. Qwen's
  // "enable_thinking:true" on a DeepSeek route). Without this pass,
  // a user's runtime.json kept feeding stale settings into the
  // resolver every launch; the only fix was manual edit or reset.
  try {
    const cfg = runtime.configStore?.load?.() ?? {};
    const providersRaw = cfg.ai?.customProviders ?? [];
    const cleanedProviders = providersRaw.map((p) => sanitizeProviderConfig(p, "chat"));
    const byId = new Map(cleanedProviders.map((p) => [p.id, p]));
    const cleanedRouting = {};
    for (const [routeTaskType, route] of Object.entries(cfg.ai?.taskRouting ?? {})) {
      const provider = byId.get(route?.providerId);
      cleanedRouting[routeTaskType] = provider
        ? sanitizeTaskRouteForProvider(provider, route, routeTaskType)
        : route;
    }
    const before = JSON.stringify({ p: providersRaw, r: cfg.ai?.taskRouting ?? {} });
    const after = JSON.stringify({ p: cleanedProviders, r: cleanedRouting });
    if (before !== after) {
      runtime.configStore?.patch?.({
        ai: {
          ...(cfg.ai ?? {}),
          customProviders: cleanedProviders,
          taskRouting: cleanedRouting
        }
      });
    }
  } catch { /* non-fatal — resolve-time sanitize still protects */ }
  runtime.emailMonitor = createEmailMonitor({ runtime });
  runtime.emailMonitor.start();
  runtime.persistSecurityConfig = (patch) => {
    const security = runtime.securityBroker.setConfig(patch);
    runtime.configStore?.patch({
      security
    });
    return security;
  };
  return {
    store: buildStoreManifest(),
    runtime,
    routeIntent,
    endpoints: {
      postContext: "/context",
      postTask: "/task",
      getTaskEvents: "/task/:id/events",
      postOfficeTask: "/office/task",
      cancelTask: "/task/:id/cancel",
      retryTask: "/task/:id/retry",
      getPendingApprovals: "/approvals",
      approvePendingApproval: "/approvals/:id/approve",
      rejectPendingApproval: "/approvals/:id/reject",
      getAuditLogs: "/audit-log",
      getSecurityState: "/security/state",
      updateSecurityState: "/security/state",
      getSchedules: "/schedules",
      getScheduleRuns: "/schedules/:id/runs",
      getOfficeHealth: "/office/health",
      postOfficeWriteback: "/office/writeback",
      metrics: "/metrics",
      getTemplates: "/templates",
      getTemplateById: "/templates/:id",
      postTemplateSave: "/templates",
      postTemplateImport: "/templates/import",
      deleteTemplateById: "/templates/:id",
      getTemplateExport: "/templates/:id/export",
      postTemplateValidate: "/templates/validate",
      postDagPreview: "/dag/preview",
      getDagExecutions: "/dag/executions",
      getDagExecutionById: "/dag/executions/:id",
      postDagResume: "/dag/executions/:id/resume",
      getBudget: "/budget",
      postBudget: "/budget",
      postHistorySearch: "/history/search",
      getProjectStore: "/projects/store",
      postProjectStore: "/projects/store",
      getExecutors: "/executors",
      getAIProviders: "/ai/providers",
      getCodeCliAdapters: "/ai/code-cli",
      getMcpServers: "/ai/mcp",
      getSkillRegistries: "/ai/skills",
      getIntegrationConfig: "/config/integrations",
      postMcpServerConfig: "/config/mcp/servers",
      postSkillRegistryConfig: "/config/skills/registries",
      postCodeCliAdapterConfig: "/config/code-cli/adapters",
      getConnectorCatalog: "/connectors/catalog",
      health: "/health",
      listTasks: "/tasks",
      getTask: "/task/:id",
      officeHttpsBase: "https://localhost:9413",
      officeProtocolFallback: "uca://office-submit",
      helperSelection: "pipe://uca-helper/explorer-selection",
      browserNativeHost: "native://com.uca.host"
    }
  };
}
