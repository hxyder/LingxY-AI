import { createSkillMarkdown, slugifySkillId } from "../../ai/skills/lifecycle.mjs";
import { validateSkillDescriptorMarkdown } from "../../ai/skills/discovery.mjs";
import { validateMcpServerDescriptor } from "../../ai/mcp/descriptor-validation.mjs";

const SUPPORTED_KINDS = new Set(["skill", "mcp"]);
const REQUIRED_FIELDS = ["purpose", "permissions", "config", "confirmation"];
const CONTROL_FIELDS = new Set(["discard"]);
const FILESYSTEM_SCOPES = new Set(["none", "read", "write"]);
const TRANSPORTS = new Set(["stdio", "http", "ws"]);
const SECRET_SOURCES = new Set(["env", "secret_ref"]);

const QUESTIONS = {
  purpose: {
    id: "purpose",
    prompt: "What is this capability for? Describe the user-facing goal in one or two sentences.",
    hint: "Focus on outcome and when it should be used; avoid implementation details."
  },
  permissions: {
    id: "permissions",
    prompt: "What permissions does it need? Specify network access, filesystem scope, and any required secret names.",
    hint: "Use environment variable names for secrets; never paste literal secret values."
  },
  config: {
    id: "config",
    prompt: "How is the capability invoked or configured?",
    hint: "Skill: list the instruction steps. MCP: choose transport plus command (stdio) or url (http/ws)."
  },
  confirmation: {
    id: "confirmation",
    prompt: "Confirm to mark this draft as ready to save?",
    hint: "Reply with confirmation=true once purpose, permissions, and config are filled in."
  }
};

const FIELD_TO_INTERVIEW = {
  id: "name",
  displayName: "name",
  name: "name",
  heading: "name",
  description: "purpose",
  purpose: "purpose",
  permissions: "permissions",
  env: "permissions",
  secrets: "permissions",
  config: "config",
  transport: "config",
  command: "config",
  url: "config",
  args: "config",
  instructions: "config",
  confirmation: "confirmation"
};

function emptyCollected() {
  return { purpose: null, permissions: null, config: null, confirmed: false };
}

function isPurposeReady(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function arePermissionsReady(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.network !== "boolean") return false;
  if (!FILESYSTEM_SCOPES.has(value.filesystem)) return false;
  return Array.isArray(value.secrets);
}

function isConfigReady(config, kind) {
  if (!config || typeof config !== "object") return false;
  if (kind === "skill") {
    return Array.isArray(config.instructions) && config.instructions.length > 0;
  }
  if (kind === "mcp") {
    if (!TRANSPORTS.has(config.transport)) return false;
    if (config.transport === "stdio") {
      return typeof config.command === "string" && config.command.trim().length > 0;
    }
    return typeof config.url === "string" && config.url.trim().length > 0;
  }
  return false;
}

function listMissing(state) {
  const missing = [];
  if (!isPurposeReady(state.collected.purpose)) missing.push("purpose");
  if (!arePermissionsReady(state.collected.permissions)) missing.push("permissions");
  if (!isConfigReady(state.collected.config, state.kind)) missing.push("config");
  if (!state.collected.confirmed) missing.push("confirmation");
  return missing;
}

function nextQuestionFor(missing) {
  return missing.length > 0 ? QUESTIONS[missing[0]] : null;
}

function sanitizeSecretEntries(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) out.push({ name, source: "env" });
      continue;
    }
    if (entry && typeof entry === "object") {
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name) continue;
      const source = SECRET_SOURCES.has(entry.source) ? entry.source : "env";
      out.push({ name, source });
    }
  }
  const seen = new Set();
  return out.filter((entry) => {
    const key = `${entry.source}:${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizePermissions(value) {
  if (!value || typeof value !== "object") return null;
  return {
    network: Boolean(value.network),
    filesystem: FILESYSTEM_SCOPES.has(value.filesystem) ? value.filesystem : "none",
    secrets: sanitizeSecretEntries(value.secrets)
  };
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

function sanitizeSkillConfig(value) {
  if (!value || typeof value !== "object") return null;
  return { instructions: sanitizeStringList(value.instructions) };
}

function sanitizeMcpConfig(value) {
  if (!value || typeof value !== "object") return null;
  const transport = TRANSPORTS.has(value.transport) ? value.transport : null;
  if (!transport) return { transport: null };
  if (transport === "stdio") {
    return {
      transport,
      command: typeof value.command === "string" ? value.command.trim() : "",
      args: Array.isArray(value.args) ? value.args.map((arg) => String(arg ?? "")) : []
    };
  }
  return {
    transport,
    url: typeof value.url === "string" ? value.url.trim() : ""
  };
}

function sanitizeConfig(value, kind) {
  if (kind === "skill") return sanitizeSkillConfig(value);
  if (kind === "mcp") return sanitizeMcpConfig(value);
  return null;
}

function freezeState(state) {
  const missing = listMissing(state);
  return {
    ...state,
    missing_fields: missing,
    next_question: nextQuestionFor(missing),
    status: missing.length === 0 ? "ready_to_save" : "interviewing"
  };
}

export function buildCapabilityInterviewState(input = {}) {
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error("capability_interview_kind_unsupported");
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  return freezeState({
    kind,
    name,
    collected: emptyCollected()
  });
}

export function applyCapabilityInterviewAnswer(state, answer = {}) {
  if (!state || !SUPPORTED_KINDS.has(state.kind)) {
    throw new Error("capability_interview_state_invalid");
  }
  const field = typeof answer.field === "string" ? answer.field : "";
  if (field !== "name" && !REQUIRED_FIELDS.includes(field) && !CONTROL_FIELDS.has(field)) {
    throw new Error("capability_interview_answer_field_unknown");
  }
  if (field === "discard") {
    return answer.value === false ? freezeState(state) : discardCapabilityInterviewState(state);
  }
  const next = {
    kind: state.kind,
    name: state.name,
    collected: { ...state.collected }
  };
  if (field === "name") {
    next.name = String(answer.value ?? "").trim() || next.name;
  } else if (field === "purpose") {
    next.collected.purpose = typeof answer.value === "string" ? answer.value.trim() : null;
    next.collected.confirmed = false;
  } else if (field === "permissions") {
    next.collected.permissions = sanitizePermissions(answer.value);
    next.collected.confirmed = false;
  } else if (field === "config") {
    next.collected.config = sanitizeConfig(answer.value, state.kind);
    next.collected.confirmed = false;
  } else if (field === "confirmation") {
    const nonConfirmationReady = isPurposeReady(next.collected.purpose)
      && arePermissionsReady(next.collected.permissions)
      && isConfigReady(next.collected.config, next.kind);
    next.collected.confirmed = answer.value === true && nonConfirmationReady;
  }
  return freezeState(next);
}

export function discardCapabilityInterviewState(state) {
  if (!state || !SUPPORTED_KINDS.has(state.kind)) {
    throw new Error("capability_interview_state_invalid");
  }
  return {
    kind: state.kind,
    name: state.name ?? "",
    collected: { ...(state.collected ?? emptyCollected()), confirmed: false },
    missing_fields: [],
    next_question: null,
    status: "discarded"
  };
}

function buildSkillDraft(state) {
  const baseName = state.name && state.name.length > 0 ? state.name : "New Skill";
  const id = slugifySkillId(baseName);
  const description = state.collected.purpose;
  const instructions = state.collected.config.instructions;
  const markdown = createSkillMarkdown({ name: baseName, description, instructions });
  return {
    kind: "skill",
    status: "ready_to_save",
    id,
    name: baseName,
    purpose: description,
    permissions: state.collected.permissions,
    secrets: state.collected.permissions.secrets,
    entry: { filename: "SKILL.md", markdown }
  };
}

function buildMcpDescriptorEnv(secrets) {
  const env = {};
  let hasEnv = false;
  for (const secret of secrets ?? []) {
    if (!secret.name) continue;
    if (secret.source === "env") {
      env[secret.name] = `\${env:${secret.name}}`;
    } else if (secret.source === "secret_ref") {
      env[secret.name] = `\${secret_ref:${secret.name}}`;
    } else {
      continue;
    }
    hasEnv = true;
  }
  return hasEnv ? env : null;
}

function buildMcpDraft(state) {
  const baseName = state.name && state.name.length > 0 ? state.name : "New MCP Server";
  const id = slugifySkillId(baseName);
  const config = state.collected.config;
  const permissions = state.collected.permissions;
  const descriptor = {
    id,
    displayName: baseName,
    transport: config.transport,
    enabled: false,
    env: buildMcpDescriptorEnv(permissions.secrets)
  };
  if (config.transport === "stdio") {
    descriptor.command = config.command;
    descriptor.args = config.args ?? [];
  } else {
    descriptor.url = config.url;
  }
  return {
    kind: "mcp",
    status: "ready_to_save",
    id,
    name: baseName,
    purpose: state.collected.purpose,
    permissions,
    secrets: permissions.secrets,
    descriptor
  };
}

export function buildCapabilityDraft(state) {
  if (!state || !SUPPORTED_KINDS.has(state.kind)) {
    throw new Error("capability_interview_state_invalid");
  }
  const missing = listMissing(state);
  if (missing.length > 0 || state.status !== "ready_to_save") {
    return {
      kind: state.kind,
      status: "needs_more_input",
      missing_fields: missing,
      next_question: nextQuestionFor(missing),
      reason: "Interview is not complete; provide remaining answers and an explicit confirmation before drafting."
    };
  }
  if (state.kind === "skill") return buildSkillDraft(state);
  if (state.kind === "mcp") return buildMcpDraft(state);
  throw new Error("capability_interview_state_invalid");
}

function secretEntriesAreReferenceOnly(secrets) {
  for (const secret of secrets ?? []) {
    if (!secret || typeof secret !== "object") {
      return { ok: false, message: "Each secret must be an object with a name and source." };
    }
    if (Object.prototype.hasOwnProperty.call(secret, "value")
      || Object.prototype.hasOwnProperty.call(secret, "literal")) {
      return { ok: false, message: "Secrets must not contain literal values; use env variable names or secret refs." };
    }
    if (!SECRET_SOURCES.has(secret.source)) {
      return { ok: false, message: "Each secret must declare source as \"env\" or \"secret_ref\"." };
    }
    if (typeof secret.name !== "string" || !secret.name.trim()) {
      return { ok: false, message: "Each secret must have a non-empty name." };
    }
  }
  return { ok: true };
}

function descriptorEnvIsReferenceOnly(env) {
  if (env == null) return { ok: true };
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return { ok: false, message: "MCP descriptor env must be an object of secret references." };
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== "string" || !key.trim()) {
      return { ok: false, message: "MCP descriptor env keys must be non-empty names." };
    }
    if (typeof value !== "string" || !/^\$\{(?:env|secret_ref):[A-Za-z0-9_.:/%-]+\}$/.test(value)) {
      return {
        ok: false,
        message: "MCP descriptor env values must be ${env:NAME} or ${secret_ref:NAME} references, never literal secrets."
      };
    }
  }
  return { ok: true };
}

export function validateCapabilityDraft(draft) {
  if (!draft || !SUPPORTED_KINDS.has(draft.kind)) {
    return {
      ok: false,
      errors: [{ field: "kind", message: "Draft kind must be \"skill\" or \"mcp\"." }],
      missing_fields: ["kind"]
    };
  }
  if (draft.status !== "ready_to_save") {
    return {
      ok: false,
      errors: [{ field: "status", message: "Draft is not ready to save. Complete the interview first." }],
      missing_fields: Array.isArray(draft.missing_fields) ? [...draft.missing_fields] : []
    };
  }
  const errors = [];
  if (draft.kind === "skill") {
    const validation = validateSkillDescriptorMarkdown(draft.entry?.markdown ?? "");
    if (!validation.ok) errors.push(...validation.errors);
  } else if (draft.kind === "mcp") {
    const validation = validateMcpServerDescriptor(draft.descriptor ?? {}, { requireId: true });
    if (!validation.ok) errors.push(...validation.errors);
    const envCheck = descriptorEnvIsReferenceOnly(draft.descriptor?.env);
    if (!envCheck.ok) errors.push({ field: "env", message: envCheck.message });
  }
  const secretCheck = secretEntriesAreReferenceOnly(draft.secrets);
  if (!secretCheck.ok) errors.push({ field: "secrets", message: secretCheck.message });
  return {
    ok: errors.length === 0,
    errors,
    missing_fields: [...new Set(errors.map((entry) => entry?.field).filter(Boolean))]
  };
}

function normalizeRecoveryInput(input) {
  if (input instanceof Error) {
    return { errors: [{ field: "exception", message: input.message }], interviewMissing: [] };
  }
  if (!input || typeof input !== "object") {
    return { errors: [], interviewMissing: [] };
  }
  return {
    errors: Array.isArray(input.errors) ? input.errors : [],
    interviewMissing: Array.isArray(input.missing_fields) ? input.missing_fields : []
  };
}

export function buildCapabilityRecoveryProposal(errorOrValidation) {
  const { errors, interviewMissing } = normalizeRecoveryInput(errorOrValidation);
  const errorFields = [...new Set(errors.map((entry) => entry?.field).filter(Boolean))];
  const missing_fields = interviewMissing.length > 0 ? [...interviewMissing] : errorFields;
  const errorSentences = errors.map((entry) => entry?.message).filter(Boolean);
  const question = errorSentences.length > 0
    ? `I cannot finalize this capability yet. ${errorSentences.join(" ")}`
    : "I need a bit more information before I can save this capability.";
  const suggested_next_actions = missing_fields.map((field) => {
    const interviewField = FIELD_TO_INTERVIEW[field] ?? field;
    const detail = errors.find((entry) => entry?.field === field)?.message ?? null;
    return {
      type: "answer_interview_field",
      field: interviewField,
      raw_field: field,
      prompt: QUESTIONS[interviewField]?.prompt ?? `Provide a value for ${field}.`,
      detail
    };
  });
  return {
    status: "recovery_required",
    question,
    missing_fields,
    suggested_next_actions
  };
}
