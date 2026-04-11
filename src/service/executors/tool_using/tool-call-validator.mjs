import path from "node:path";

function isString(value) {
  return typeof value === "string";
}

function validateAgainstSchema(schema, args) {
  if (schema.type !== "object" || typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, reason: "args must be an object" };
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in args)) {
      return { ok: false, reason: `missing required field: ${requiredKey}` };
    }
  }

  for (const [key, descriptor] of Object.entries(schema.properties ?? {})) {
    if (!(key in args)) {
      continue;
    }
    const value = args[key];

    // empty schema {} means accept anything
    if (!descriptor.type && !descriptor.enum) continue;

    if (descriptor.type === "string" && !isString(value)) {
      return { ok: false, reason: `${key} must be string, got ${typeof value}` };
    }
    if (descriptor.type === "array" && !Array.isArray(value)) {
      return { ok: false, reason: `${key} must be array` };
    }
    if (descriptor.type === "array" && descriptor.items?.type === "string" && !value.every((item) => typeof item === "string")) {
      return { ok: false, reason: `${key} array items must be strings` };
    }
    if (descriptor.type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) {
      return { ok: false, reason: `${key} must be integer` };
    }
    if (descriptor.type === "boolean" && typeof value !== "boolean") {
      return { ok: false, reason: `${key} must be boolean` };
    }
    if (descriptor.enum && !descriptor.enum.includes(value)) {
      return { ok: false, reason: `${key} must be one of: ${descriptor.enum.join(", ")}` };
    }
  }

  return { ok: true };
}

export function validateToolCall(tool, args, ctx = {}) {
  const result = validateAgainstSchema(tool.parameters, args);
  if (!result.ok) {
    return {
      ok: false,
      error: `schema validation failed: ${result.reason}`
    };
  }

  if ((tool.id === "file_op" || tool.id === "open_file" || tool.id === "reveal_in_explorer") && typeof args.path === "string") {
    const normalized = path.normalize(args.path);
    if (normalized.includes("..")) {
      return {
        ok: false,
        error: "path_traversal_blocked"
      };
    }
  }

  if (tool.id === "launch_app" && Array.isArray(ctx.allowedApps) && !ctx.allowedApps.includes(args.app)) {
    return {
      ok: true,
      warning: "launch_app_outside_whitelist"
    };
  }

  return {
    ok: true,
    warning: null
  };
}
