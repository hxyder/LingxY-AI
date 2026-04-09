import { buildStoreManifest } from "./store/sqlite-schema.mjs";
import { createInMemoryStoreScaffold } from "./store/memory-store.mjs";
import { createEventBusScaffold } from "./events/event-bus.mjs";
import { createTaskQueueScaffold } from "./queue/task-queue.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { createFastExecutorScaffold } from "../executors/fast/fast-executor.mjs";
import { createKimiCliExecutorScaffold } from "../executors/kimi/kimi-cli-executor.mjs";
import { createToolUsingExecutorScaffold } from "../executors/tool_using/agent-loop.mjs";
import { createMultiModalExecutorScaffold } from "../executors/multi_modal/multi-modal-executor.mjs";
import { createExecutorRegistry } from "../executors/registry.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createActionToolRegistry } from "../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { createSchedulerRuntime } from "../scheduler/engine.mjs";
import { createOfficeHttpsRuntime } from "../https/port-9413.mjs";
import { createBuiltinTemplateRegistry, createPersistentTemplateRegistry } from "../templates/runtime.mjs";
import { createBudgetManager } from "../cost/budget.mjs";
import { createEmbeddingStore } from "../embeddings/store.mjs";
import { createAIProviderRegistry } from "../ai/providers/registry.mjs";
import { BUILTIN_AI_PROVIDERS } from "../ai/providers/builtin.mjs";
import { createCodeCliRegistry } from "../ai/code_cli/registry.mjs";
import { BUILTIN_CODE_CLI_ADAPTERS } from "../ai/code_cli/builtin.mjs";
import { createMCPRegistry } from "../ai/mcp/registry.mjs";
import { BUILTIN_MCP_SERVERS } from "../ai/mcp/builtin.mjs";
import { createSkillRegistry } from "../ai/skills/registry.mjs";
import { BUILTIN_SKILL_REGISTRIES } from "../ai/skills/builtin.mjs";
import { createDagCheckpointStore } from "../dag/scheduler.mjs";

export function createServiceBootstrap({
  storeAdapter = createInMemoryStoreScaffold(),
  artifactStore = createArtifactStore(),
  configStore = null,
  securityConfig = {},
  kimiRuntime = null,
  paths = null
} = {}) {
  const queue = createTaskQueueScaffold();
  const executors = [
    createFastExecutorScaffold(),
    createKimiCliExecutorScaffold(),
    createToolUsingExecutorScaffold(),
    createMultiModalExecutorScaffold()
  ];
  const runtime = {
    store: storeAdapter,
    storeAdapter,
    eventBus: createEventBusScaffold(),
    queue,
    artifactStore,
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
  runtime.actionToolRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  runtime.executorRegistry = createExecutorRegistry(executors);
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
    aiProviders: createAIProviderRegistry(BUILTIN_AI_PROVIDERS),
    codeCliAdapters: createCodeCliRegistry(BUILTIN_CODE_CLI_ADAPTERS),
    mcpServers: createMCPRegistry(BUILTIN_MCP_SERVERS),
    skillRegistries: createSkillRegistry(BUILTIN_SKILL_REGISTRIES)
  };
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
      getExecutors: "/executors",
      getAIProviders: "/ai/providers",
      getCodeCliAdapters: "/ai/code-cli",
      getMcpServers: "/ai/mcp",
      getSkillRegistries: "/ai/skills",
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
