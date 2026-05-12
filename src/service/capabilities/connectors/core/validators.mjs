import { statSync } from "node:fs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function readPath(target, pathExpression = "") {
  if (!pathExpression) {
    return target;
  }
  return String(pathExpression)
    .split(".")
    .filter(Boolean)
    .reduce((cursor, part) => {
      if (cursor === null || cursor === undefined) {
        return undefined;
      }
      return cursor[part];
    }, target);
}

export function validateConnectorValue(kind, value, options = {}) {
  if (kind === "nonempty_string") {
    return isNonEmptyString(value);
  }

  if (kind === "email") {
    return isEmail(value);
  }

  if (kind === "email[]") {
    return Array.isArray(value) && value.length > 0 && value.every(isEmail);
  }

  if (kind === "boolean_true") {
    return value === true;
  }

  if (kind === "array_min_items") {
    return Array.isArray(value) && value.length >= Number(options.min ?? 1);
  }

  if (kind === "artifact_exists") {
    return isNonEmptyString(value);
  }

  if (kind === "pending_confirmation") {
    return value === true || value?.status === "pending" || isNonEmptyString(value?.confirmationId);
  }

  if (kind === "file_exists") {
    if (!isNonEmptyString(value)) {
      return false;
    }
    try {
      const info = statSync(value);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  return false;
}

export function validateConnectorObject(target = {}, rules = []) {
  const failures = [];
  for (const rule of rules ?? []) {
    const pathExpression = rule.path ?? rule.field ?? "";
    const value = readPath(target, pathExpression);
    const ok = validateConnectorValue(rule.kind ?? rule.type, value, rule);
    if (!ok) {
      failures.push({
        path: pathExpression,
        kind: rule.kind ?? rule.type,
        message: rule.message ?? `${pathExpression || "value"} failed ${rule.kind ?? rule.type}`
      });
    }
  }
  return {
    ok: failures.length === 0,
    failures
  };
}
