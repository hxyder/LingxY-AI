/**
 * Pure resolver for MCP descriptor env values.
 *
 * Capability-creator drafts produce env entries shaped as
 *   ${env:NAME}        — read from process.env (or an injected env map)
 *   ${secret_ref:REF}  — read via secretStore.getSync(REF)
 *
 * This module is the single place we expand those references before either
 * (a) spawning a stdio MCP server, or (b) reporting status to the user.
 *
 * Design notes:
 * - Pure: no I/O, no fallback to process.env unless caller passes it.
 * - Narrow parser: only the two reference forms above; everything else is
 *   a literal and passes through unchanged.
 * - Missing references are returned as structured entries (envKey + type +
 *   name); the actual secret value is never echoed back even when present.
 */

const REFERENCE_PATTERN = /^\$\{(env|secret_ref):([A-Za-z0-9_.:/\-]+)\}$/;

function classifyValue(value) {
  if (typeof value !== "string") {
    return { kind: "literal", value };
  }
  const match = REFERENCE_PATTERN.exec(value);
  if (!match) {
    return { kind: "literal", value };
  }
  return { kind: match[1], name: match[2] };
}

/**
 * Resolve a single env entry. Returns either { resolved: string } or
 * { missing: { envKey, type, name } }. Never returns the secret store value
 * inside the missing branch.
 */
function resolveEntry(envKey, rawValue, { processEnv, secretStore }) {
  const classification = classifyValue(rawValue);
  if (classification.kind === "literal") {
    return { resolved: classification.value };
  }
  if (classification.kind === "env") {
    const value = processEnv ? processEnv[classification.name] : undefined;
    if (typeof value === "string" && value.length > 0) {
      return { resolved: value };
    }
    return { missing: { envKey, type: "env", name: classification.name } };
  }
  if (classification.kind === "secret_ref") {
    const value = secretStore?.getSync?.(classification.name);
    if (typeof value === "string" && value.length > 0) {
      return { resolved: value };
    }
    return { missing: { envKey, type: "secret_ref", name: classification.name } };
  }
  return { resolved: rawValue };
}

/**
 * Resolve every entry in `env`. Literals pass through; references are
 * substituted from processEnv / secretStore. Missing references are
 * collected and the corresponding env key is omitted from `env`.
 *
 * @param {Record<string, unknown> | null | undefined} env
 * @param {object} [opts]
 * @param {Record<string, string|undefined>} [opts.processEnv]  defaults to {}
 * @param {{ getSync(ref: string): string|null }} [opts.secretStore]
 * @returns {{
 *   ok: boolean,
 *   env: Record<string, string>,
 *   missing: Array<{ envKey: string, type: "env"|"secret_ref", name: string }>
 * }}
 */
export function resolveMcpEnv(env, { processEnv = {}, secretStore = null } = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return { ok: true, env: {}, missing: [] };
  }
  const resolved = {};
  const missing = [];
  for (const [key, rawValue] of Object.entries(env)) {
    const result = resolveEntry(key, rawValue, { processEnv, secretStore });
    if (result.missing) {
      missing.push(result.missing);
      continue;
    }
    resolved[key] = result.resolved;
  }
  return {
    ok: missing.length === 0,
    env: resolved,
    missing
  };
}

/**
 * Inspection helper for status reporting: tells callers whether an env map
 * needs configuration without performing any substitution. Useful when a
 * status endpoint just wants to surface "missing config" without exposing
 * resolved values.
 */
export function describeMcpEnvRequirements(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return { references: [], hasReferences: false };
  }
  const references = [];
  for (const [key, rawValue] of Object.entries(env)) {
    const classification = classifyValue(rawValue);
    if (classification.kind === "env" || classification.kind === "secret_ref") {
      references.push({ envKey: key, type: classification.kind, name: classification.name });
    }
  }
  return { references, hasReferences: references.length > 0 };
}
