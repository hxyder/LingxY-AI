import {
  escapeHtml
} from "./shared-ui.mjs";

// C17 (UPGRADE_PLAN.md §C17, R rule "cost 不准 → 改 token"):
// Task detail KV grid displays Tokens (in/out/total) as the primary
// usage signal, replacing the prior `Cost` cell. Object destructuring
// silently ignores any extra keys, so legacy callers passing `cost`
// still work without an explicit binding.
export function renderTaskKvGrid({
  provider,
  model,
  executor,
  source,
  retry,
  tokens,
  duration,
  transport
} = {}) {
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
// Returns null when no MEANINGFUL token data is available so the KV
// grid omits the cell instead of rendering a misleading "0 tokens" /
// "-1 tokens" line.
//
// Codex round-1: tightened guards to require non-negative values
// AND a positive total. The previous Number.isFinite-only guard
// rendered "0 (0 in / 0 out)" for the legitimate "no usage yet"
// case and would render negative numbers from corrupted data.
export function describeTaskTokens(task = {}) {
  const isNonNegFinite = (v) => Number.isFinite(v) && Number(v) >= 0;
  const tokensIn = task?.usage_summary?.tokens_in ?? task?.usage?.input_tokens ?? null;
  const tokensOut = task?.usage_summary?.tokens_out ?? task?.usage?.output_tokens ?? null;
  const fallbackTotal = task?.tokens_used ?? task?.usage?.total_tokens ?? null;
  if (isNonNegFinite(tokensIn) && isNonNegFinite(tokensOut)) {
    const inN = Number(tokensIn);
    const outN = Number(tokensOut);
    const total = inN + outN;
    if (total > 0) {
      return `${total.toLocaleString("en-US")} (${inN.toLocaleString("en-US")} in / ${outN.toLocaleString("en-US")} out)`;
    }
  }
  if (isNonNegFinite(fallbackTotal) && Number(fallbackTotal) > 0) {
    return `${Number(fallbackTotal).toLocaleString("en-US")}`;
  }
  return null;
}
