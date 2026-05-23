const MAX_FIELD_LENGTH = 160;

function cleanString(value, max = MAX_FIELD_LENGTH) {
  const text = `${value ?? ""}`.trim();
  return text ? text.slice(0, max) : "";
}

export function normalizeConversationModelOverride(value = null, { pinnedAt = null } = {}) {
  if (!value || typeof value !== "object") return null;
  const providerId = cleanString(value.providerId ?? value.provider_id ?? value.id);
  if (!providerId) return null;
  const model = cleanString(value.model ?? value.modelId ?? value.model_id);
  const mode = cleanString(value.mode);
  const reasoningEffort = cleanString(value.reasoningEffort ?? value.reasoning_effort, 48);
  const override = { providerId };
  if (model) override.model = model;
  if (mode) override.mode = mode;
  if (reasoningEffort) override.reasoningEffort = reasoningEffort;
  if (pinnedAt) override.pinnedAt = pinnedAt;
  return override;
}

export function applyConversationModelOverride(metadata = {}, override = null) {
  const next = {
    ...(metadata && typeof metadata === "object" ? metadata : {})
  };
  if (override) {
    next.modelOverride = override;
  } else {
    delete next.modelOverride;
  }
  return next;
}
