import { createArtifactStore } from "../store/artifact-store.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { createRuntimeConfigStore } from "./config-store.mjs";
import { createServiceHttpServer } from "./http-server.mjs";
import { resolveRuntimePaths, ensureRuntimePaths } from "./runtime-paths.mjs";
import { createServiceBootstrap } from "./service-bootstrap.mjs";
import { createLocalSecretStore } from "../security/secret-store.mjs";
import { createSqliteStore } from "./store/sqlite-store.mjs";
import { createExplorerSelectionPipeServer, DEFAULT_EXPLORER_PIPE_NAME } from "./windows-pipe-server.mjs";
import { getKimiRuntimeStatus, resolveKimiRuntime } from "../ai/code_cli/kimi/runtime.mjs";
import { disconnectAll as disconnectMcpClients } from "../ai/mcp/client-bridge.mjs";
import { createReminderWatcher } from "../scheduler/reminder-watcher.mjs";
import { backfillConversationTitles } from "./task-runtime.mjs";

const QUEUED_RECOVERY_MAX_AGE_MS = 60 * 60 * 1000;

function recoverInterruptedTasks(runtime) {
  const recovered = [];
  const nowMs = Date.now();
  for (const task of runtime.store.listTasks()) {
    if (task.status === "queued") {
      const createdAtMs = Date.parse(task.created_at);
      const isStaleQueued = Number.isFinite(createdAtMs) && nowMs - createdAtMs > QUEUED_RECOVERY_MAX_AGE_MS;
      if (isStaleQueued) {
        task.status = "failed";
        task.sub_status = "stale_queued_after_restart";
        task.failure_category = "internal_error";
        task.failure_user_message = "本地服务重启后发现过期排队任务，已停止自动恢复，请按需重试。";
        task.retryable = true;
        runtime.store.updateTask(task.task_id, task);
        appendAuditLog(runtime, "runtime.recovered_task", {
          task_id: task.task_id,
          previous_status: "queued",
          stale: true
        }, task.task_id);
        recovered.push(task.task_id);
        continue;
      }

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
  kimiRuntime = null,
  pipeName = DEFAULT_EXPLORER_PIPE_NAME
} = {}) {
  const paths = ensureRuntimePaths(resolveRuntimePaths({ baseDir }));
  const secretStore = createLocalSecretStore({ paths });
  const configStore = createRuntimeConfigStore({
    configPath: paths.configPath,
    secretStore,
    defaults: {
      security: {}
    }
  });
  const config = configStore.load();
  const kimiConfig = config.ai?.codeCli?.kimi ?? {};
  // Boot-time Kimi runtime resolution is now strictly a *last-resort fallback*
  // for fresh installs where the user has not configured any AI provider yet.
  // Every submission path re-resolves the active code_cli runtime per task via
  // `resolveCodeCliRuntimeForTask`, which reads `config.ai.customProviders` +
  // `config.ai.taskRouting` on every call. That means the user can switch
  // providers in Console → Settings and the next task immediately respects it
  // without a service restart. See UCA-049 bug #7.
  const resolvedKimiRuntime = resolveKimiRuntime({
    explicitRuntime: kimiRuntime,
    config: kimiConfig
  });
  const kimiRuntimeStatus = getKimiRuntimeStatus({
    explicitRuntime: resolvedKimiRuntime ?? kimiRuntime,
    config: kimiConfig
  });
  const storeAdapter = createSqliteStore({
    dbPath: paths.dbPath
  });
  const service = createServiceBootstrap({
    storeAdapter,
    artifactStore: createArtifactStore({ baseDir: paths.baseDir }),
    configStore,
    securityConfig: config.security ?? {},
    kimiRuntime: resolvedKimiRuntime,
    paths,
    secretStore
  });
  service.runtime.kimiRuntimeStatus = kimiRuntimeStatus;
  const server = createServiceHttpServer({
    runtime: service.runtime,
    paths,
    port,
    host
  });
  const pipeServer = createExplorerSelectionPipeServer({
    runtime: service.runtime,
    pipeName
  });
  let schedulePollTimer = null;
  const reminderWatcher = createReminderWatcher({ runtime: service.runtime });

  recoverInterruptedTasks(service.runtime);
  service.runtime.securityBroker.recoverRedactionStateLost();
  service.runtime.scheduler.sweepExpiredApprovals();
  // One-shot back-fill: legacy conversations that pre-date the
  // auto-title shipping carry empty / conv_xxx titles. Walk the store
  // once on boot and derive a title from each conversation's first
  // user message. Idempotent — conversations with a real title (or
  // no user messages) are skipped.
  try {
    const result = backfillConversationTitles(service.runtime);
    if (result.updated > 0) {
      appendAuditLog(service.runtime, "conversation.titles_backfilled", result);
    }
  } catch (error) {
    appendAuditLog(service.runtime, "conversation.titles_backfill_failed", {
      message: error?.message ?? String(error)
    });
  }

  return {
    paths,
    service,
    runtime: service.runtime,
    async start() {
      const [listening, pipeState] = await Promise.all([
        server.start(),
        pipeServer.start()
      ]);
      service.runtime.serverState = {
        baseUrl: `http://${listening.host}:${listening.port}`,
        pipeName: pipeState.pipeName,
        ...listening
      };
      appendAuditLog(service.runtime, "runtime.started", {
        host: listening.host,
        port: listening.port,
        pipe_name: pipeState.pipeName
      });
      schedulePollTimer = setInterval(() => {
        service.runtime.scheduler.runDueSchedules().catch((error) => {
          appendAuditLog(service.runtime, "schedule.dispatch_failed", {
            message: error.message
          });
        });
      }, 5000);
      reminderWatcher.start();
      return service.runtime.serverState;
    },
    async stop() {
      appendAuditLog(service.runtime, "runtime.stopped", {});
      reminderWatcher.stop();
      if (schedulePollTimer) {
        clearInterval(schedulePollTimer);
        schedulePollTimer = null;
      }
      await Promise.all([
        pipeServer.stop(),
        server.stop()
      ]);
      await disconnectMcpClients();
      storeAdapter.close();
    },
    server,
    pipeServer
  };
}
