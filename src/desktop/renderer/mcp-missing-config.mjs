// Pure helpers for surfacing MCP `missing_config` status in the renderer.
// The backend (env-resolver / configured.mjs / builtin.mjs) reports
// `detail: "missing_config"` together with `missingEnv: [{ envKey, type, name }]`
// when a server descriptor references env/secret values that are not yet
// resolvable. These helpers turn that contract into renderer-friendly bits
// without ever touching the actual secret values.

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isMcpMissingConfig(server = {}) {
  if (!server || typeof server !== "object") return false;
  if (server.detail === "missing_config") return true;
  return Array.isArray(server.missingEnv) && server.missingEnv.length > 0;
}

export function listMcpMissingNames(server = {}) {
  const entries = Array.isArray(server?.missingEnv) ? server.missingEnv : [];
  const seen = new Set();
  const names = [];
  for (const entry of entries) {
    const name = asString(entry?.name) || asString(entry?.envKey);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function formatMissingNamesSummary(names = []) {
  const list = Array.isArray(names) ? names.filter((value) => asString(value)) : [];
  if (list.length === 0) return "";
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")} +${list.length - 3}`;
}

export function describeMcpMissingConfig(server = {}) {
  const missing = isMcpMissingConfig(server);
  const names = listMcpMissingNames(server);
  return {
    missing,
    names,
    summary: formatMissingNamesSummary(names)
  };
}
