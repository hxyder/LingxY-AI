import { createArtifactStore } from "../store/artifact-store.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { createRuntimeConfigStore } from "./config-store.mjs";
import { createServiceHttpServer } from "./http-server.mjs";
import { resolveRuntimePaths, ensureRuntimePaths } from "./runtime-paths.mjs";
import { createServiceBootstrap } from "./service-bootstrap.mjs";
import { createSqliteStore } from "./store/sqlite-store.mjs";

function recoverInterruptedTasks(runtime) {
  const recovered = [];
  for (const task of runtime.store.listTasks()) {
    if (task.status === "queued") {
      runtime.queue.enqueue({
        ...task,
        bypass_dedupe: true
      });
      recovered.push(task.task_id);
      continue;
    }

    if (["running", "cancelling"].includes(task.status)) {
      task.status = "failed";
      task.sub_status = "runtime_restarted";
      task.failure_category = "internal_error";
      task.failure_user_message = "本地服务重启时任务尚未完成，请重试。";
      task.retryable = true;
      runtime.store.updateTask(task.task_id, task);
      appendAuditLog(runtime, "runtime.recovered_task", {
        task_id: task.task_id,
        previous_status: "running"
      }, task.task_id);
      recovered.push(task.task_id);
    }
  }
  return recovered;
}

export function createPersistentRuntime({
  baseDir = null,
  port = 0,
  host = "127.0.0.1",
  kimiRuntime = null
} = {}) {
  const paths = ensureRuntimePaths(resolveRuntimePaths({ baseDir }));
  const configStore = createRuntimeConfigStore({
    configPath: paths.configPath,
    defaults: {
      security: {}
    }
  });
  const config = configStore.load();
  const storeAdapter = createSqliteStore({
    dbPath: paths.dbPath
  });
  const service = createServiceBootstrap({
    storeAdapter,
    artifactStore: createArtifactStore({ baseDir: paths.baseDir }),
    configStore,
    securityConfig: config.security ?? {},
    kimiRuntime,
    paths
  });
  const server = createServiceHttpServer({
    runtime: service.runtime,
    paths,
    port,
    host
  });

  recoverInterruptedTasks(service.runtime);
  service.runtime.securityBroker.recoverRedactionStateLost();
  service.runtime.scheduler.sweepExpiredApprovals();

  return {
    paths,
    service,
    runtime: service.runtime,
    async start() {
      const listening = await server.start();
      service.runtime.serverState = {
        baseUrl: `http://${listening.host}:${listening.port}`,
        ...listening
      };
      appendAuditLog(service.runtime, "runtime.started", {
        host: listening.host,
        port: listening.port
      });
      return service.runtime.serverState;
    },
    async stop() {
      appendAuditLog(service.runtime, "runtime.stopped", {});
      await server.stop();
      storeAdapter.close();
    },
    server
  };
}
