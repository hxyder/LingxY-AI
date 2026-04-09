import { buildStoreManifest } from "./store/sqlite-schema.mjs";
import { createInMemoryStoreScaffold } from "./store/memory-store.mjs";
import { createEventBusScaffold } from "./events/event-bus.mjs";
import { createTaskQueueScaffold } from "./queue/task-queue.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { createFastExecutorScaffold } from "../executors/fast/fast-executor.mjs";
import { createKimiCliExecutorScaffold } from "../executors/kimi/kimi-cli-executor.mjs";
import { createToolUsingExecutorScaffold } from "../executors/tool_using/agent-loop.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";
import { createMetricsRegistry } from "../metrics/registry.mjs";
import { createActionToolRegistry } from "../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../action_tools/tools/index.mjs";
import { createSecurityBroker } from "../security/broker.mjs";
import { createSchedulerRuntime } from "../scheduler/engine.mjs";
import { createOfficeHttpsRuntime } from "../https/port-9413.mjs";

export function createServiceBootstrap() {
  const storeAdapter = createInMemoryStoreScaffold();
  const queue = createTaskQueueScaffold();
  const runtime = {
    store: storeAdapter,
    storeAdapter,
    eventBus: createEventBusScaffold(),
    queue,
    artifactStore: createArtifactStore(),
    executors: [createFastExecutorScaffold(), createKimiCliExecutorScaffold(), createToolUsingExecutorScaffold()],
    metrics: createMetricsRegistry({
      store: storeAdapter,
      queue
    })
  };
  runtime.securityBroker = createSecurityBroker({ runtime });
  runtime.scheduler = createSchedulerRuntime({ runtime });
  runtime.officeHttps = createOfficeHttpsRuntime();
  runtime.actionToolRegistry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
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
      getSchedules: "/schedules",
      getScheduleRuns: "/schedules/:id/runs",
      getOfficeHealth: "/office/health",
      postOfficeWriteback: "/office/writeback",
      metrics: "/metrics",
      officeHttpsBase: "https://localhost:9413",
      officeProtocolFallback: "uca://office-submit",
      helperSelection: "pipe://uca-helper/explorer-selection",
      browserNativeHost: "native://com.uca.host"
    }
  };
}
