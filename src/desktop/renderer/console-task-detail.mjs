import {
  escapeHtml
} from "./shared-ui.mjs";

export function renderTaskKvGrid({
  provider,
  model,
  executor,
  source,
  retry,
  cost,
  duration,
  transport
}, { formatMoney = (value) => `$${Number(value ?? 0).toFixed(2)}` } = {}) {
  const hasText = (value) => value != null && value !== "" && value !== "—";
  const cells = [];
  if (hasText(provider)) cells.push(["Provider", provider]);
  if (hasText(model)) cells.push(["Model", model]);
  if (hasText(executor)) cells.push(["Executor", executor]);
  if (hasText(source)) cells.push(["Source", source]);
  if (retry && Number(retry) > 0) cells.push(["Retry", String(retry)]);
  if (cost && Number(cost) > 0) cells.push(["Cost", formatMoney(cost)]);
  if (hasText(duration)) cells.push(["Duration", duration]);
  if (hasText(transport)) cells.push(["Transport", transport]);
  if (cells.length === 0) return "";
  return `
    <div class="kv-grid kv-grid--auto">
      ${cells.map(([key, value]) => `<div class="kv-cell"><div class="kv-k">${escapeHtml(key)}</div><div class="kv-v">${escapeHtml(String(value))}</div></div>`).join("")}
    </div>
  `;
}
