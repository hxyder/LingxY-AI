#!/usr/bin/env node
/**
 * verify-connectors-page.mjs — UCA-112 (Phase 4f-2)
 *
 * Asserts the Connectors tab uses the new panel-section card layout
 * and that every connector-specific style rule resolves through the
 * design token system (so both themes render correctly).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleHtml = read("src/desktop/renderer/console.html");
const shared = read("src/desktop/renderer/shared.css");

// ── panel-section component exists in shared.css ───────────────────────
for (const cls of [
  "panel-section", "panel-section-header", "panel-section-title",
  "panel-section-sub", "panel-section-body", "panel-card-grid"
]) {
  assert.ok(
    new RegExp(`\\.${cls}\\s*\\{`).test(shared),
    `shared.css missing .${cls}`
  );
}

// ── Connectors tab has panel-sections with the expected working titles ─
// Isolate the connectors panel markup. The panel itself is a <section>
// with nested <section class="panel-section">s, so we slice until the
// next sibling top-level tab panel rather than trying to count.
const connStart = consoleHtml.indexOf('id="panel-connectors"');
assert.ok(connStart > 0, "panel-connectors not found");
const nextPanelStart = consoleHtml.indexOf('id="panel-settings"', connStart);
assert.ok(nextPanelStart > connStart, "panel-settings not found after connectors");
const panelMarkup = consoleHtml.slice(connStart, nextPanelStart);

// UCA-121: Morning digest moved from Connectors to Schedules.
// UCA-190: Remove the Webhooks "Coming soon" placeholder; only working
// connector surfaces should appear here.
const expectedTitles = [
  { id: "connAccountsTitle", text: "Accounts" },
  { id: "connEmailTitle", text: "Email inbox" },
  { id: "connMcpTitle", text: "MCP tools" }
];
for (const { id, text } of expectedTitles) {
  assert.ok(
    new RegExp(`id="${id}"[^>]*>${text}`).test(panelMarkup),
    `connectors missing section titled "${text}"`
  );
}
// Each titled section must be aria-labelledby its title.
for (const { id } of expectedTitles) {
  assert.ok(
    new RegExp(`aria-labelledby="${id}"`).test(panelMarkup),
    `connectors section "${id}" missing aria-labelledby`
  );
}

// ── bilingual Chinese suffixes present on each section title ───────────
for (const zh of ["账户连接", "邮箱", "工具服务器"]) {
  assert.ok(
    panelMarkup.includes(zh),
    `connectors section missing Chinese suffix "${zh}"`
  );
}
assert.ok(!/connWebhooksTitle|Webhook 集成|Coming soon/.test(panelMarkup),
  "connectors must not ship a Webhooks placeholder without a working surface");

// ── existing IDs preserved (panel renderers depend on them) ────────────
// UCA-121: connDigest* ids moved to the Schedules panel; verified there
// via verify-console-rendered-workspace.
for (const id of [
  "accountConnectorsList", "connEmailList", "connEmailPicker",
  "connEmailInlineForm", "connEmailConnectBtn", "connEmailCancelBtn",
  "connectorsMcpList", "connectorsMcpRefreshBtn",
  "connectorsConfigMount", "emailAdvancedMount"
]) {
  assert.ok(
    new RegExp(`id="${id}"`).test(panelMarkup),
    `connectors preserved-id check: #${id} missing`
  );
}

// ── Connectors CSS no longer falls back to hardcoded dark hex ──────────
// The rules were rewritten in UCA-111 to resolve through tokens. Guard
// against accidental re-introduction of hardcoded fallbacks.
const connectorCssSlice = consoleHtml.slice(consoleHtml.indexOf("/* ── Account connector cards ── */"), consoleHtml.indexOf("/* ── editorial console pass"));
if (connectorCssSlice) {
  assert.ok(
    !/var\(--surface2,\s*#/.test(connectorCssSlice),
    "Connectors CSS must not use --surface2 with hardcoded hex fallback"
  );
  assert.ok(
    !/var\(--text,\s*#/.test(connectorCssSlice),
    "Connectors CSS must not use --text with hardcoded hex fallback"
  );
  assert.ok(
    !/rgba\(255,\s*255,\s*255,\s*0\.0[69]\)/.test(connectorCssSlice),
    "Connectors CSS must not rely on white alpha-line colors (break in light mode)"
  );
}

// ── inline connect form uses tokens, not dark fallback ─────────────────
assert.ok(
  /id="connEmailInlineForm"[^>]*background:\s*var\(--surface-soft\)/.test(consoleHtml),
  "#connEmailInlineForm inline style must use var(--surface-soft)"
);

console.log("ok verify-connectors-page");
