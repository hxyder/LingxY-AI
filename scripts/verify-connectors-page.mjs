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
import { readCssWithImports } from "./lib/css-imports.mjs";
import {
  getMcpStatusView,
  MCP_SERVER_META,
  renderConnectorsMcpServersHtml
} from "../src/desktop/renderer/console-mcp-view.mjs";
import {
  ACCOUNT_CONNECTOR_META,
  renderAvailableAccountConnectorHtml,
  renderConnectedAccountConnectorRowHtml
} from "../src/desktop/renderer/console-account-connectors-view.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const shared = readCssWithImports(root, "src/desktop/renderer/shared.css");

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

for (const navTarget of [
  "connAccountsTitle",
  "connEmailTitle",
  "connMcpTitle",
  "integrationsStatusPanel",
  "skillsSettingsPanel",
  "codeCliSettingsPanel",
  "officeSetupPanel"
]) {
  assert.ok(
    new RegExp(`data-connectors-nav="${navTarget}"`).test(panelMarkup),
    `connectors sidebar nav missing ${navTarget}`
  );
}
assert.ok(consoleJs.includes('initSectionNav({ selector: ".connectors-nav [data-connectors-nav]", datasetKey: "connectorsNav" });'),
  "connectors sidebar nav must use the shared section-nav wiring");

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

// ── MCP card view is a pure module, not another inline island in console.js ─
assert.ok(consoleJs.includes('from "./console-mcp-view.mjs"'),
  "console.js must import shared MCP connector view");
assert.ok(!/const\s+EXTRA_PLUGIN_OPTIONS\s*=/.test(consoleJs),
  "console.js must not own MCP extra plugin constants");
assert.ok(!/function\s+renderMcpConfigPanel\(/.test(consoleJs),
  "console.js must not own MCP config panel renderer");
assert.equal(MCP_SERVER_META["mcp-filesystem"].title, "Filesystem");
assert.deepEqual(getMcpStatusView({ available: true, enabled: true }), {
  label: "运行中",
  className: "ready"
});
assert.deepEqual(getMcpStatusView({ configured: true, enabled: false, detail: "disabled" }), {
  label: "已保存",
  className: "muted"
});

const html = renderConnectorsMcpServersHtml([
  {
    id: "mcp-brave-search",
    available: false,
    enabled: false,
    configured: true,
    transport: "stdio",
    command: "npx",
    missingEnv: [{ envKey: "BRAVE_API_KEY", name: "Brave API Key" }]
  },
  {
    id: "figma",
    available: false,
    enabled: false,
    installRequired: true,
    installSource: "figma-mcp"
  },
  {
    id: "com-mcparmory-github",
    displayName: "GitHub",
    source: "runtime_config",
    available: false,
    enabled: false,
    configured: true,
    transport: "http",
    url: "https://mcp.mcparmory.com/github"
  }
], {
  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
});
assert.ok(html.includes("mcp-card--v3"), "MCP view must render v3 cards");
assert.ok(html.includes('data-mcp-cfg-save="mcp-brave-search"'), "MCP view must render dynamic config save");
assert.ok(html.includes("mcp-needs-config"), "MCP view must surface missing config");
assert.ok(html.includes('data-mcp-install-source-click="figma-mcp"'), "MCP view must render isolated package install handoff");
assert.ok(html.includes('data-mcp-install-click="com-mcparmory-github"'), "saved runtime-config MCP cards must expose enable action");
assert.ok(html.includes('data-mcp-delete-card="com-mcparmory-github"'), "saved runtime-config MCP cards must expose delete action");
assert.ok(html.includes('data-mcp-source-badge="com-mcparmory-github"') && html.includes("Custom"),
  "runtime-config MCP cards must be normal cards with a Custom badge");
assert.ok(!html.includes("Repository issues, pull requests, and code search."),
  "extra GitHub placeholder must not duplicate a configured custom GitHub MCP card");

// ── Account connector card view is pure HTML/meta, with behavior in console.js ─
assert.ok(consoleJs.includes('from "./console-account-connectors-view.mjs"'),
  "console.js must import shared account connector view");
assert.ok(!/const\s+ACCOUNT_CONNECTOR_META\s*=/.test(consoleJs),
  "console.js must not own account connector metadata");
assert.ok(!consoleJs.includes("conn-row-logo acc-logo"),
  "console.js must not own account connector row/card HTML");
assert.ok(!consoleJs.includes("meta.setupSteps.map"),
  "console.js must not own account connector setup-panel HTML");
assert.equal(ACCOUNT_CONNECTOR_META.microsoft.label, "Microsoft 365");
assert.equal(ACCOUNT_CONNECTOR_META.google.needsSecret, true);

const connectedAccountHtml = renderConnectedAccountConnectorRowHtml({
  id: "acct-1",
  provider: "google",
  email: "person@example.com",
  displayName: "Personal Google",
  tokenStatus: "active",
  isDefaultForEmail: true,
  capabilities: { emailRead: true, fileRead: true, calendarRead: true }
});
for (const needle of [
  "conn-row",
  "conn-row-logo acc-logo google",
  "Personal Google",
  'data-connected-edit="acct-1"',
  'data-connected-reauth="acct-1"',
  'data-connected-delete="acct-1"',
  'data-connected-default="acct-1"',
  'data-purpose="email"',
  'data-purpose="files"',
  'data-purpose="calendar"'
]) {
  assert.ok(connectedAccountHtml.includes(needle),
    `account connected-card contract missing ${needle}`);
}

const availableAccountHtml = renderAvailableAccountConnectorHtml({
  type: "google",
  configured: true,
  connected: false
}, {
  configOpen: true,
  configData: { clientId: "google-client-id", hasClientSecret: true }
});
for (const needle of [
  'data-ac-type="google"',
  'data-ac-connect="google"',
  'data-ac-config-toggle="google"',
  "acc-config-panel",
  'data-ac-field="clientId"',
  'data-ac-field="clientSecret"',
  'data-ac-save-config="google"',
  "google-client-id"
]) {
  assert.ok(availableAccountHtml.includes(needle),
    `account available-card contract missing ${needle}`);
}

const connectedProviderHtml = renderAvailableAccountConnectorHtml({
  type: "microsoft",
  configured: true,
  connected: true,
  email: "work@example.com"
});
assert.ok(connectedProviderHtml.includes('data-ac-disconnect="microsoft"'),
  "account provider card must keep disconnect affordance");

console.log("ok verify-connectors-page");
