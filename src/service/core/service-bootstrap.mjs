import { buildStoreManifest } from "./store/sqlite-schema.mjs";
import { createInMemoryStoreScaffold } from "./store/memory-store.mjs";
import { createEventBusScaffold } from "./events/event-bus.mjs";
import { createTaskQueueScaffold } from "./queue/task-queue.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { createFastExecutorScaffold } from "../executors/fast/fast-executor.mjs";
import { createKimiCliExecutorScaffold } from "../executors/kimi/kimi-cli-executor.mjs";
import { createArtifactStore } from "../store/artifact-store.mjs";

export function createServiceBootstrap() {
  return {
    store: buildStoreManifest(),
    runtime: {
      storeAdapter: createInMemoryStoreScaffold(),
      eventBus: createEventBusScaffold(),
      queue: createTaskQueueScaffold(),
      artifactStore: createArtifactStore(),
      executors: [createFastExecutorScaffold(), createKimiCliExecutorScaffold()]
    },
    routeIntent,
    endpoints: {
      postContext: "/context",
      postTask: "/task",
      getTaskEvents: "/task/:id/events",
      helperSelection: "pipe://uca-helper/explorer-selection"
    }
  };
}
