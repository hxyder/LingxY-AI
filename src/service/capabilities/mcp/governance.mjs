export const EXTERNAL_MCP_TOKEN_POLICY = Object.freeze({
  tokenStore: "isolated",
  oauthTokenReuse: "forbidden",
  defaultEnabled: false,
  catalogOnly: true,
  requiresConfirmation: true
});

const INTERNAL_SOURCES = new Set(["builtin", "builtin_mit", "lingxy_internal"]);
const SHARED_TOKEN_REF_PATTERNS = [
  /^oauth[:/]/i,
  /^account[:/]/i,
  /^connector[:/]/i,
  /^google[:/].*oauth/i,
  /^microsoft[:/].*oauth/i,
  /^lingxy[:/].*oauth/i
];

function sourceOf(server = {}) {
  return `${server.source ?? ""}`.trim() || "runtime_config";
}

export function isExternalMcpServer(server = {}) {
  const source = sourceOf(server);
  if (INTERNAL_SOURCES.has(source)) return false;
  if (source.startsWith("plugin:")) return true;
  return true;
}

function secretRefsFromEnv(env = null) {
  if (!env || typeof env !== "object" || Array.isArray(env)) return [];
  const refs = [];
  for (const [envKey, rawValue] of Object.entries(env)) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    const match = value.match(/^\$\{secret_ref:([A-Za-z0-9_.:/%\-]+)\}$/);
    if (match) refs.push({ envKey, name: match[1] });
  }
  return refs;
}

function isSharedTokenRef(refName = "") {
  return SHARED_TOKEN_REF_PATTERNS.some((pattern) => pattern.test(refName));
}

export function evaluateExternalMcpGovernance(server = {}) {
  const external = isExternalMcpServer(server);
  const secretRefs = secretRefsFromEnv(server.env);
  const sharedTokenRefs = external
    ? secretRefs.filter((ref) => isSharedTokenRef(ref.name))
    : [];
  const violations = [];
  if (external && sharedTokenRefs.length > 0) {
    violations.push({
      code: "shared_oauth_token_ref_forbidden",
      refs: sharedTokenRefs.map((ref) => ({ envKey: ref.envKey, name: ref.name }))
    });
  }
  return {
    schemaVersion: 1,
    external,
    source: sourceOf(server),
    tokenPolicy: EXTERNAL_MCP_TOKEN_POLICY,
    allowed: violations.length === 0,
    violations,
    catalogOnly: true,
    requiresConfirmation: true
  };
}

export function applyExternalMcpGovernanceToStatus(status = {}, server = status) {
  const governance = evaluateExternalMcpGovernance({
    ...server,
    ...status,
    env: server?.env ?? status?.env ?? null,
    source: server?.source ?? status?.source
  });
  return {
    ...status,
    governance,
    available: status.available === true && governance.allowed,
    detail: governance.allowed ? status.detail : "governance_blocked"
  };
}
