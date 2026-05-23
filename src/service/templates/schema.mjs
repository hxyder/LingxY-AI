export const TEMPLATE_SCHEMA_VERSION = "1.0";

export const TEMPLATE_STEP_KINDS = Object.freeze([
  "executor",
  "action_tool",
  "template_ref"
]);

export function validateTemplateDocument(template) {
  const errors = [];

  if (!template || typeof template !== "object") {
    errors.push("template must be an object");
    return {
      ok: false,
      errors
    };
  }

  if (template.schema_version !== TEMPLATE_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${TEMPLATE_SCHEMA_VERSION}`);
  }

  for (const field of ["id", "name", "version"]) {
    if (!template[field]) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (!Array.isArray(template.steps) || template.steps.length === 0) {
    errors.push("steps must contain at least one node");
  }

  for (const step of template.steps ?? []) {
    if (!step.id) {
      errors.push("every step requires an id");
    }
    if (!TEMPLATE_STEP_KINDS.includes(step.kind)) {
      errors.push(`unsupported step kind: ${step.kind}`);
    }
    if (!step.target) {
      errors.push(`step ${step.id ?? "<unknown>"} requires a target`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
