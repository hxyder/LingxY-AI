import path from "node:path";

function isString(value) {
  return typeof value === "string";
}

function validateAgainstSchema(schema, args) {
  if (schema.type !== "object" || typeof args !== "object" || args === null || Array.isArray(args)) {
    return false;
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in args)) {
      return false;
    }
  }

  for (const [key, descriptor] of Object.entries(schema.properties ?? {})) {
    if (!(key in args)) {
      continue;
    }
    const value = args[key];

    if (descriptor.type === "string" && !isString(value)) {
      return false;
    }
    if (descriptor.type === "array" && !Array.isArray(value)) {
      return false;
    }
    if (descriptor.type === "array" && descriptor.items?.type === "string" && !value.every((item) => typeof item === "string")) {
      return false;
    }
    if (descriptor.enum && !descriptor.enum.includes(value)) {
      return false;
    }
  }

  return true;
}

export function validateToolCall(tool, args, ctx = {}) {
  if (!validateAgainstSchema(tool.parameters, args)) {
    return {
      ok: false,
      error: "schema_validation_failed"
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
