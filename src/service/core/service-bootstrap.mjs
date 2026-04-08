import { buildStoreManifest } from "./store/sqlite-schema.mjs";
import { createInMemoryStoreScaffold } from "./store/memory-store.mjs";
import { createEventBusScaffold } from "./events/event-bus.mjs";
import { createTaskQueueScaffold } from "./queue/task-queue.mjs";
import { routeIntent } from "./router/intent-router.mjs";
import { createFastExecutorScaffold } from "../executors/fast/fast-executor.mjs";

export function createServiceBootstrap() {
  return {
    store: buildStoreManifest(),
    runtime: {
      storeAdapter: createInMemoryStoreScaffold(),
      eventBus: createEventBusScaffold(),
      queue: createTaskQueueScaffold(),
      executors: [createFastExecutorScaffold()]
    },
    routeIntent,
    endpoints: {
      postContext: "/context",
      postTask: "/task",
      getTaskEvents: "/task/:id/events"
    }
  };
}
