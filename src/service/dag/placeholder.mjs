/**
 * Placeholder resolution — deep-walks a params object and replaces every
 * {{nodeId.path}} / {{nodeId[0].path}} reference with the corresponding
 * value from the results map. Runs AFTER all dependencies have completed
 * (the DAG engine guarantees this by topo-ordering), so any unresolved
 * reference is a hard error — never silently substituted with undefined.
 *
 * Syntax (deliberately tiny; no expressions, no math, no conditionals):
 *   {{nodeId}}              — whole node result
 *   {{nodeId.key.nested}}   — dotted path
 *   {{nodeId.items[0]}}     — array index
 *   "Today: {{a.x}}"        — string interpolation (multiple refs OK)
 *
 * If a params value is EXACTLY one placeholder (`"{{nodeId.path}}"` with
 * no surrounding chars), the resolved value replaces the string entirely,
 * preserving non-string types (numbers, arrays, objects). Mixed-string
 * interpolation always stringifies.
 */

import { PLACEHOLDER_RE } from "./schema.mjs";

export class PlaceholderUnresolvedError extends Error {
  constructor(message, { nodeId, path, raw } = {}) {
    super(message);
    this.name = "PlaceholderUnresolvedError";
    this.nodeId = nodeId;
    this.path = path;
    this.raw = raw;
  }
}

function tokenize(path) {
  // Split "a.b[0].c" into ["a","b","0","c"].
  const tokens = [];
  const re = /([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(path))) {
    tokens.push(m[1] ?? m[2]);
  }
  return tokens;
}

function lookup(results, path, raw) {
  const tokens = tokenize(path);
  if (tokens.length === 0) {
    throw new PlaceholderUnresolvedError(`Invalid placeholder path: ${raw}`, { raw });
  }
  const nodeId = tokens[0];
  if (!(nodeId in results)) {
    throw new PlaceholderUnresolvedError(
      `Placeholder ${raw} references node "${nodeId}" which has not produced a result (not run yet, or failed).`,
      { nodeId, path, raw }
    );
  }
  let cursor = results[nodeId];
  for (let i = 1; i < tokens.length; i += 1) {
    const key = tokens[i];
    if (cursor === null || cursor === undefined) {
      throw new PlaceholderUnresolvedError(
        `Placeholder ${raw}: cannot descend into null/undefined at ${tokens.slice(0, i).join(".")}.`,
        { nodeId, path, raw }
      );
    }
    // Numeric keys apply to arrays; string keys to objects.
    if (/^\d+$/.test(key) && Array.isArray(cursor)) {
      cursor = cursor[Number(key)];
    } else if (typeof cursor === "object") {
      cursor = cursor[key];
    } else {
      throw new PlaceholderUnresolvedError(
        `Placeholder ${raw}: cannot read "${key}" of ${typeof cursor}.`,
        { nodeId, path, raw }
      );
    }
  }
  if (cursor === undefined) {
    throw new PlaceholderUnresolvedError(
      `Placeholder ${raw}: path resolved to undefined.`,
      { nodeId, path, raw }
    );
  }
  return cursor;
}

function resolveString(value, results) {
  const solo = value.match(/^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*)\s*\}\}\s*$/);
  if (solo) {
    return lookup(results, solo[1], solo[0]);
  }
  // Interpolation: replace each match in place, stringify the substitute.
  return value.replace(PLACEHOLDER_RE, (raw, path) => {
    const resolved = lookup(results, path, raw);
    if (typeof resolved === "string") return resolved;
    try { return JSON.stringify(resolved); } catch { return String(resolved); }
  });
}

/**
 * Return a new value with every placeholder recursively resolved.
 * Primitives other than strings pass through unchanged. Throws
 * PlaceholderUnresolvedError on the first unresolved reference.
 */
export function resolveParams(params, results) {
  if (params === null || params === undefined) return params;
  if (typeof params === "string") return resolveString(params, results);
  if (Array.isArray(params)) return params.map((item) => resolveParams(item, results));
  if (typeof params === "object") {
    const out = {};
    for (const [key, value] of Object.entries(params)) {
      out[key] = resolveParams(value, results);
    }
    return out;
  }
  return params;
}
