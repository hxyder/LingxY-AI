import {
  escapeHtml
} from "./shared-ui.mjs";

// C17 (UPGRADE_PLAN.md §C17, R rule "cost 不准 → 改 token"):
// Task detail KV grid displays Tokens (in/out/total) as the primary
// usage signal, replacing the prior `Cost` cell. The legacy `cost`
// keyword arg is accepted but no longer rendered — keeps callers
// shape-compatible while transitioning.
export function renderTaskKvGrid({
  provider,
  model,
  executor,
  source,
  retry,
  tokens,
  duration,
  transport,
  // Legacy: accepted for shape compatibility but no longer rendered.
  // The user (R) flagged cost numbers as inaccurate; tokens are the
  // honest signal.
  cost: _legacyCost
}, _legacyOptions = {}) {
  const hasText = (value) => value != null && value !== "" && value !== "—";
  const cells = [];
  if (hasText(provider)) cells.push(["Provider", provider]);
  if (hasText(model)) cells.push(["Model", model]);
  if (hasText(executor)) cells.push(["Executor", executor]);
  if (hasText(source)) cells.push(["Source", source]);
  if (retry && Number(retry) > 0) cells.push(["Retry", String(retry)]);
  if (hasText(tokens)) cells.push(["Tokens", String(tokens)]);
  if (hasText(duration)) cells.push(["Duration", duration]);
  if (hasText(transport)) cells.push(["Transport", transport]);
  if (cells.length === 0) return "";
  return `
    <div class="kv-grid kv-grid--auto">
      ${cells.map(([key, value]) => `<div class="kv-cell"><div class="kv-k">${escapeHtml(key)}</div><div class="kv-v">${escapeHtml(String(value))}</div></div>`).join("")}
    </div>
  `;
}

// C17: derive a human-readable token-usage string from a task record.
// Returns null when no token data is available so the KV grid omits
// the cell instead of rendering a misleading "0 tokens" line.
export function describeTaskTokens(task = {}) {
  const tokensIn = task?.usage_summary?.tokens_in ?? task?.usage?.input_tokens ?? null;
  const tokensOut = task?.usage_summary?.tokens_out ?? task?.usage?.output_tokens ?? null;
  const fallbackTotal = task?.tokens_used ?? task?.usage?.total_tokens ?? null;
  if (Number.isFinite(tokensIn) && Number.isFinite(tokensOut)) {
    const total = Number(tokensIn) + Number(tokensOut);
    return `${total.toLocaleString("en-US")} (${Number(tokensIn).toLocaleString("en-US")} in / ${Number(tokensOut).toLocaleString("en-US")} out)`;
  }
  if (Number.isFinite(fallbackTotal) && Number(fallbackTotal) > 0) {
    return `${Number(fallbackTotal).toLocaleString("en-US")}`;
  }
  return null;
}
