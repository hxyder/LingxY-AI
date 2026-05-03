import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";

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

  if (method === "GET" && url.pathname === "/security/state") {
    sendJson(response, 200, {
      security: runtime.securityBroker.getConfig()
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/security/state") {
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

  return false;
}
