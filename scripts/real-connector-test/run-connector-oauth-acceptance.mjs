#!/usr/bin/env node
// Opt-in connector/OAuth acceptance harness.
//
// Dry-run is the default. Live mode requires --live or
// LINGXY_CONNECTOR_OAUTH_ACCEPTANCE=1. Side effects and disconnects require
// extra flags and env gates, and are not executed by default.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS,
  buildConnectorOAuthAcceptanceReport,
  redactConnectorOAuthAcceptanceReport,
  validateConnectorOAuthAcceptanceReport
} from "../../src/shared/connector-oauth-acceptance-harness.mjs";

function parseArgs(argv) {
  const out = {
    port: Number(process.env.UCA_PORT || 4360),
    spawnRuntime: true,
    live: process.env.LINGXY_CONNECTOR_OAUTH_ACCEPTANCE === "1",
    allowLiveSideEffects: false,
    allowDisconnect: false,
    outputDir: path.resolve(".tmp", "connector-oauth-acceptance")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--no-spawn") out.spawnRuntime = false;
    else if (arg === "--live") out.live = true;
    else if (arg === "--allow-live-side-effects") out.allowLiveSideEffects = true;
    else if (arg === "--allow-disconnect") out.allowDisconnect = true;
    else if (arg === "--output-dir") out.outputDir = path.resolve(argv[++i]);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = `http://127.0.0.1:${ARGS.port}`;

function currentGit(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

async function probeHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // wait for runtime
    }
    await sleep(250);
  }
  return false;
}

async function startRuntimeIfNeeded() {
  if (await probeHealth(1500)) return null;
  if (!ARGS.spawnRuntime) throw new Error(`No runtime at ${BASE_URL} and --no-spawn was set.`);
  const child = spawn(process.execPath, ["scripts/start-runtime.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, UCA_PORT: String(ARGS.port) },
    stdio: ["ignore", "inherit", "inherit"]
  });
  if (!await probeHealth(60_000)) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    throw new Error("runtime did not become healthy");
  }
  return child;
}

async function requestJson(method, pathname, body = null) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-lingxy-desktop-actor": "desktop_console"
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data, text };
}

function providerSummary(type, config, status, accounts) {
  const providerAccounts = accounts.filter((account) => account.provider === type);
  return {
    provider: type,
    configured: Boolean(config?.clientId),
    connected: Boolean(status?.connected) || providerAccounts.length > 0,
    accountCount: providerAccounts.length,
    tokenExpired: status?.tokenExpired === true,
    accountStatuses: providerAccounts.map((account) => account.tokenStatus ?? "unknown"),
    capabilities: providerAccounts.map((account) => account.capabilities ?? {})
  };
}

function countValues(payload, key) {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
}

async function tryReadLists(type, connected) {
  if (!connected) {
    return {
      status: "skipped",
      evidence: `${type} has no connected account`,
      recovery: "connect a disposable account before running live read-list acceptance"
    };
  }
  const files = await requestJson("GET", `/connectors/accounts/${type}/files?limit=1`);
  const emails = await requestJson("GET", `/connectors/accounts/${type}/emails?limit=1`);
  const calendar = await requestJson("GET", `/connectors/accounts/${type}/calendar?limit=1`);
  const ok = files.ok && emails.ok && calendar.ok;
  return {
    status: ok ? "pass" : "partial",
    evidence: [
      `${type} files status=${files.status} count=${countValues(files.data, "files")}`,
      `${type} emails status=${emails.status} count=${countValues(emails.data, "emails")}`,
      `${type} calendar status=${calendar.status} count=${countValues(calendar.data, "events")}`
    ].join("; "),
    recovery: ok ? "" : "review connector account permissions, token status, and provider service availability"
  };
}

async function buildDryRunReport() {
  return buildConnectorOAuthAcceptanceReport({
    commit: currentGit(["rev-parse", "--short", "HEAD"]),
    branch: currentGit(["branch", "--show-current"]),
    mode: "dry_run",
    liveOptIn: false,
    runtimeBaseUrl: BASE_URL,
    scenarios: [
      {
        id: "connector_catalog",
        status: "skipped",
        command: "node scripts/real-connector-test/run-connector-oauth-acceptance.mjs --live",
        evidence: "dry-run validates the report contract without OAuth or connector network calls"
      },
      ...[
        "oauth_config_and_start",
        "oauth_callback_connect",
        "connected_accounts",
        "token_refresh",
        "read_lists",
        "guarded_side_effect",
        "disconnect_recovery",
        "auth_permission_recovery"
      ].map((id) => ({
        id,
        status: "skipped",
        command: "live connector acceptance",
        evidence: "not run in dry-run mode",
        recovery: id.endsWith("recovery")
          ? "runner must record user-visible recovery copy when this condition is induced"
          : ""
      }))
    ],
    notes: ["dry-run wrote a valid redacted report; no OAuth request was made"]
  });
}

async function buildLiveReport() {
  const child = await startRuntimeIfNeeded();
  try {
    const catalog = await requestJson("GET", "/connectors/catalog");
    const status = await requestJson("GET", "/connectors/accounts");
    const connected = await requestJson("GET", "/connectors/connected-accounts");
    const accounts = Array.isArray(connected.data?.accounts) ? connected.data.accounts : [];
    const providerReports = [];
    const oauthStarts = [];
    const readResults = [];

    for (const provider of CONNECTOR_OAUTH_ACCEPTANCE_PROVIDERS) {
      const config = await requestJson("GET", `/connectors/accounts/${provider}/config`);
      const providerStatus = (status.data?.connectors ?? []).find((entry) => entry.type === provider) ?? {};
      providerReports.push(providerSummary(provider, config.data, providerStatus, accounts));
      if (config.data?.clientId) {
        const started = await requestJson("POST", `/connectors/accounts/${provider}/auth/start`, {});
        oauthStarts.push({
          provider,
          status: started.status,
          ok: started.ok,
          hasAuthUrl: typeof started.data?.authUrl === "string" && started.data.authUrl.includes("state=")
        });
      } else {
        oauthStarts.push({ provider, status: 400, ok: false, hasAuthUrl: false, reason: "missing_client_id" });
      }
      readResults.push({ provider, ...(await tryReadLists(provider, providerReports.at(-1).connected)) });
    }

    const catalogOk = catalog.ok
      && (catalog.data?.providers ?? []).some((entry) => entry.provider === "google")
      && (catalog.data?.providers ?? []).some((entry) => entry.provider === "microsoft");
    const oauthStartOk = oauthStarts.some((entry) => entry.ok && entry.hasAuthUrl);
    const connectedCount = providerReports.reduce((sum, provider) => sum + provider.accountCount, 0);
    const readPass = readResults.filter((entry) => entry.status === "pass").length;
    const tokenRefreshSignals = providerReports.filter((provider) =>
      provider.connected && !provider.accountStatuses.includes("reauth_required") && provider.tokenExpired !== true
    ).length;

    const scenarios = [
      {
        id: "connector_catalog",
        status: catalogOk ? "pass" : "fail",
        command: "GET /connectors/catalog",
        evidence: catalogOk
          ? `providers=${(catalog.data?.providers ?? []).map((entry) => entry.provider).join(",")}`
          : `status=${catalog.status}`
      },
      {
        id: "oauth_config_and_start",
        status: oauthStartOk ? "pass" : "partial",
        command: "GET /connectors/accounts/:type/config + POST /connectors/accounts/:type/auth/start",
        evidence: oauthStarts.map((entry) => `${entry.provider}:status=${entry.status}:authUrl=${entry.hasAuthUrl}`).join("; "),
        recovery: oauthStartOk ? "" : "configure connector client IDs before starting OAuth"
      },
      {
        id: "oauth_callback_connect",
        status: connectedCount > 0 ? "pass" : "skipped",
        command: "GET /connectors/connected-accounts",
        evidence: connectedCount > 0
          ? `connected account count=${connectedCount}`
          : "no disposable account has completed the browser OAuth callback in this environment",
        recovery: connectedCount > 0 ? "" : "complete OAuth in the browser with a disposable test account, then rerun live acceptance"
      },
      {
        id: "connected_accounts",
        status: connected.ok ? "pass" : "fail",
        command: "GET /connectors/connected-accounts",
        evidence: `status=${connected.status}; account_count=${connectedCount}`
      },
      {
        id: "token_refresh",
        status: tokenRefreshSignals > 0 ? "pass" : (connectedCount > 0 ? "partial" : "skipped"),
        command: "GET /connectors/accounts/:type/{files,emails,calendar}",
        evidence: tokenRefreshSignals > 0
          ? `token refresh/list path usable for ${tokenRefreshSignals} provider(s)`
          : "no connected account token refresh path was exercised",
        recovery: tokenRefreshSignals > 0 ? "" : "connect a disposable account with refresh token scope and rerun live read-list acceptance"
      },
      {
        id: "read_lists",
        status: readPass > 0 ? "pass" : (connectedCount > 0 ? "partial" : "skipped"),
        command: "GET /connectors/accounts/:type/files|emails|calendar",
        evidence: readResults.map((entry) => `${entry.provider}:${entry.status}:${entry.evidence}`).join(" | "),
        recovery: readPass > 0 ? "" : "grant read scopes and verify provider service availability"
      },
      {
        id: "guarded_side_effect",
        status: "skipped",
        command: "POST /connectors/catalog/workflows/:id/run",
        evidence: ARGS.allowLiveSideEffects && process.env.LINGXY_CONNECTOR_ACCEPTANCE_ALLOW_SIDE_EFFECTS === "1"
          ? "side-effect gate enabled, but no auto-approval driver is implemented in this harness"
          : "side effects blocked by default",
        recovery: "enable disposable-account side effects with --allow-live-side-effects and LINGXY_CONNECTOR_ACCEPTANCE_ALLOW_SIDE_EFFECTS=1"
      },
      {
        id: "disconnect_recovery",
        status: "skipped",
        command: "DELETE /connectors/accounts/:type",
        evidence: ARGS.allowDisconnect && process.env.LINGXY_CONNECTOR_ACCEPTANCE_ALLOW_DISCONNECT === "1"
          ? "disconnect gate enabled, but destructive disconnect execution is intentionally manual"
          : "disconnect blocked by default",
        recovery: "disconnect only disposable accounts after exporting the connected account id and recovery evidence"
      },
      {
        id: "auth_permission_recovery",
        status: "partial",
        command: "GET config/status/list endpoints",
        evidence: providerReports.map((provider) =>
          `${provider.provider}:configured=${provider.configured}:connected=${provider.connected}:tokenExpired=${provider.tokenExpired}`
        ).join("; "),
        recovery: "missing_client_id starts in connector settings; no_account starts OAuth; reauth_required starts account reauth"
      }
    ];

    return buildConnectorOAuthAcceptanceReport({
      commit: currentGit(["rev-parse", "--short", "HEAD"]),
      branch: currentGit(["branch", "--show-current"]),
      mode: "live",
      liveOptIn: true,
      runtimeBaseUrl: BASE_URL,
      providers: providerReports,
      sideEffects: {
        allowed: ARGS.allowLiveSideEffects === true,
        executed: false,
        approval: "required_before_execution"
      },
      scenarios,
      notes: ["read-list reports include counts/status only; message bodies and file contents are not stored"]
    });
  } finally {
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
}

function writeReport(report) {
  mkdirSync(ARGS.outputDir, { recursive: true });
  const file = path.join(ARGS.outputDir, `report-${nowStamp()}.json`);
  const redacted = redactConnectorOAuthAcceptanceReport(report);
  writeFileSync(file, JSON.stringify(redacted, null, 2), "utf8");
  return file;
}

async function main() {
  const report = ARGS.live ? await buildLiveReport() : await buildDryRunReport();
  const file = writeReport(report);
  const validation = validateConnectorOAuthAcceptanceReport(report);
  console.log(JSON.stringify({
    ok: validation.ok,
    mode: report.mode,
    liveOptIn: report.liveOptIn,
    report: path.relative(process.cwd(), file),
    missing: validation.missing,
    leaks: validation.leaks
  }, null, 2));
  if (!validation.ok) process.exitCode = 1;
  if (ARGS.live && report.scenarios.some((scenario) => scenario.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[connector-oauth-acceptance] fatal:", error);
  process.exit(2);
});
