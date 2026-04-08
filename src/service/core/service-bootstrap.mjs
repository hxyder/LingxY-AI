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

export function createServiceBootstrap() {
  const storeAdapter = createInMemoryStoreScaffold();
  const queue = createTaskQueueScaffold();
  return {
    store: buildStoreManifest(),
    runtime: {
      store: storeAdapter,
      storeAdapter,
      eventBus: createEventBusScaffold(),
      queue,
      artifactStore: createArtifactStore(),
      executors: [createFastExecutorScaffold(), createKimiCliExecutorScaffold(), createToolUsingExecutorScaffold()],
      actionToolRegistry: createActionToolRegistry(BUILTIN_ACTION_TOOLS),
      metrics: createMetricsRegistry({
        store: storeAdapter,
        queue
      })
    },
    routeIntent,
    endpoints: {
      postContext: "/context",
      postTask: "/task",
      getTaskEvents: "/task/:id/events",
      cancelTask: "/task/:id/cancel",
      retryTask: "/task/:id/retry",
      getPendingApprovals: "/approvals",
      metrics: "/metrics",
      helperSelection: "pipe://uca-helper/explorer-selection",
      browserNativeHost: "native://com.uca.host"
    }
  };
}
