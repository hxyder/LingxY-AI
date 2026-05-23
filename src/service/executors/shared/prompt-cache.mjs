export const EPHEMERAL_PROMPT_CACHE_CONTROL = Object.freeze({ type: "ephemeral" });

export function cacheableSystemMessage(text) {
  const stableText = String(text ?? "").trim();
  return {
    role: "system",
    content: stableText
      ? [{ type: "text", text: stableText, cache_control: EPHEMERAL_PROMPT_CACHE_CONTROL }]
      : ""
  };
}

export function cacheableSystemSegment(name, content) {
  return {
    name,
    content
  };
}
