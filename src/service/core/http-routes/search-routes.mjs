import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";

const SEARCH_ACTORS = ["desktop_console", "desktop_overlay"];
const VALID_SCOPES = Object.freeze(["note", "task", "conversation"]);

function normaliseRequestScope(rawScope) {
  if (rawScope === undefined || rawScope === null) return [...VALID_SCOPES];
  if (!Array.isArray(rawScope)) return null;
  const seen = new Set();
  for (const entry of rawScope) {
    if (typeof entry !== "string") return null;
    if (!VALID_SCOPES.includes(entry)) return null;
    seen.add(entry);
  }
  return [...seen];
}

export async function tryHandleSearchRoute({ request, response, method, url, runtime }) {
  if (method !== "POST" || url.pathname !== "/search") return false;
  if (!requireDesktopActor({ request, response, allowedActors: SEARCH_ACTORS })) return true;
  if (!runtime?.searchIndex) {
    sendJson(response, 503, { ok: false, reason: "search_index_unavailable" });
    return true;
  }

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 4096 });
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: "invalid_json", message: String(error?.message ?? error) });
    return true;
  }
  body = body && typeof body === "object" ? body : {};

  const q = String(body.q ?? "").trim();
  if (!q) {
    sendJson(response, 400, { ok: false, reason: "missing_query" });
    return true;
  }
  const scope = normaliseRequestScope(body.scope);
  if (!scope) {
    sendJson(response, 400, { ok: false, reason: "invalid_scope", valid_scopes: VALID_SCOPES });
    return true;
  }
  if (body.include_deleted !== undefined && typeof body.include_deleted !== "boolean") {
    sendJson(response, 400, { ok: false, reason: "include_deleted_must_be_boolean" });
    return true;
  }
  const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0
    ? Math.min(100, Math.floor(Number(body.limit)))
    : 30;

  const hits = runtime.searchIndex.search({
    q,
    scope,
    includeDeleted: Boolean(body.include_deleted),
    limit
  });
  sendJson(response, 200, { ok: true, query: q, scope, results: hits });
  return true;
}
