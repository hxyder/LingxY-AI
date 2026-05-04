import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { buildRuntimeDiagnosticBundle } from "../diagnostic-bundle.mjs";
import { buildRuntimeExportBundle } from "../export-bundle.mjs";
import { EMBEDDING_NAMESPACES } from "../../embeddings/store.mjs";
import { appendAuditLog } from "../../security/audit-log.mjs";

function summarizeEmbeddingRecord(record = {}) {
  return {
    id: record.id,
    namespace: record.namespace ?? record.metadata?.namespace ?? null,
    text_preview: String(record.text ?? "").slice(0, 500),
    metadata: record.metadata ?? {},
    embeddingType: record.embeddingType ?? null
  };
}

export async function tryHandleRuntimeAdminRoute({ request, response, method, url, runtime, paths }) {
  if (method === "GET" && url.pathname === "/health") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, {
      ok: true,
      runtime_dir: paths.baseDir,
      db_path: paths.dbPath,
      task_total: runtime.store.listTasks().length,
      kimi: runtime.kimiRuntimeStatus ?? null,
      email: runtime.emailMonitor?.status?.() ?? null,
      config: {
        output: config.output ?? {},
        features: config.features ?? {}
      },
      providers: await runtime.platform.aiProviders.listStatus({
        runtime,
        config
      })
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/metrics") {
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(runtime.metrics.renderPrometheus());
    return true;
  }

  if (method === "GET" && url.pathname === "/approvals") {
    sendJson(response, 200, {
      approvals: runtime.pendingApprovals.list()
    });
    return true;
  }

  const approvalApproveMatch = url.pathname.match(/^\/approvals\/([^/]+)\/approve$/);
  if (approvalApproveMatch && method === "POST") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) {
      return true;
    }
    const body = await readJsonBody(request);
    const result = await runtime.scheduler.approvePendingApproval(approvalApproveMatch[1], {
      ...body,
      actor
    });
    if (!result) {
      sendJson(response, 404, { error: "approval_not_found" });
      return true;
    }
    sendJson(response, 200, result);
    return true;
  }

  const approvalRejectMatch = url.pathname.match(/^\/approvals\/([^/]+)\/reject$/);
  if (approvalRejectMatch && method === "POST") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) {
      return true;
    }
    const body = await readJsonBody(request);
    const result = runtime.scheduler.rejectPendingApproval(approvalRejectMatch[1], {
      ...body,
      actor
    });
    if (!result) {
      sendJson(response, 404, { error: "approval_not_found" });
      return true;
    }
    sendJson(response, 200, { approval: result });
    return true;
  }

  if (method === "GET" && url.pathname === "/audit-log") {
    sendJson(response, 200, {
      entries: runtime.store.listAuditLogs()
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/export/bundle") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) {
      return true;
    }
    const includeTaskEvents = !["0", "false", "no"].includes(`${url.searchParams.get("includeTaskEvents") ?? ""}`.toLowerCase());
    sendJson(response, 200, {
      bundle: buildRuntimeExportBundle(runtime, { includeTaskEvents })
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/diagnostics/bundle") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) {
      return true;
    }
    sendJson(response, 200, {
      bundle: await buildRuntimeDiagnosticBundle(runtime)
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/security/state") {
    sendJson(response, 200, {
      security: runtime.securityBroker.getConfig()
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/security/state") {
    if (!requireDesktopActor({ request, response })) {
      return true;
    }
    const body = await readJsonBody(request);
    const security = runtime.persistSecurityConfig(body);
    sendJson(response, 200, { security });
    return true;
  }

  if (method === "GET" && url.pathname === "/budget") {
    sendJson(response, 200, {
      budget: runtime.platform.budgetManager.getState()
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/budget") {
    if (!requireDesktopActor({ request, response })) {
      return true;
    }
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      budget: runtime.platform.budgetManager.setLimits(body.limits ?? body)
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/history/search") {
    const body = await readJsonBody(request);
    const results = await runtime.platform.embeddingStore.search(body.query ?? "", body.limit ?? 5);
    sendJson(response, 200, { results });
    return true;
  }

  if (method === "GET" && url.pathname === "/history/file-content") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) {
      return true;
    }
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50));
    const records = runtime.platform.embeddingStore
      .list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT })
      .slice(0, limit)
      .map(summarizeEmbeddingRecord);
    sendJson(response, 200, {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      records
    });
    return true;
  }

  const fileContentDeleteMatch = url.pathname.match(/^\/history\/file-content\/([^/]+)$/);
  if (fileContentDeleteMatch && method === "DELETE") {
    const actor = requireDesktopActor({ request, response, allowedActors: ["desktop_console"] });
    if (!actor) {
      return true;
    }
    if (typeof runtime.store?.appendAuditLog !== "function") {
      sendJson(response, 503, {
        ok: false,
        error: "audit_log_unavailable",
        message: "File content index deletion requires an audit log."
      });
      return true;
    }
    const recordId = decodeURIComponent(fileContentDeleteMatch[1]);
    const target = runtime.platform.embeddingStore
      .list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT })
      .find((record) => record.id === recordId);
    if (!target) {
      sendJson(response, 404, {
        ok: false,
        error: "file_content_record_not_found",
        message: "No indexed file-content record matched that id."
      });
      return true;
    }
    appendAuditLog(runtime, "file_content_index.deleted", {
      id: target.id,
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      path: target.metadata?.path ?? null,
      actor
    });
    const removed = runtime.platform.embeddingStore.remove(recordId, {
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT
    });
    sendJson(response, 200, {
      ok: true,
      deleted: removed.id,
      record: summarizeEmbeddingRecord(removed)
    });
    return true;
  }

  return false;
}
