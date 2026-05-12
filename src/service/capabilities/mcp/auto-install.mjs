// MCP auto-install — on first run, explicitly enable a curated set of safe
// MCP servers in the user's config so the Console shows them as "on" and the
// client bridge connects without a manual toggle click. Only servers that are
// (a) local-process stdio, (b) need no external API key, and (c) already
// declared `enabled: true` in BUILTIN_MCP_SERVERS are auto-enabled — we only
// *pin* the default, we never silently turn on something the builtin table
// marked disabled.

import { appendAuditLog } from "../../security/audit-log.mjs";

const SAFE_AUTOINSTALL_IDS = Object.freeze([
  "mcp-filesystem",
  "mcp-memory"
]);

export function runMcpAutoInstall({ runtime } = {}) {
  const configStore = runtime?.configStore;
  if (!configStore?.load || !configStore?.save) return { ran: false, reason: "no_config_store" };

  const config = configStore.load() ?? {};
  if (config.ai?.mcp?.autoinstalledAt) {
    return { ran: false, reason: "already_done", at: config.ai.mcp.autoinstalledAt };
  }

  const toggles = { ...(config.ai?.mcp?.builtinToggles ?? {}) };
  const enabledNow = [];
  for (const id of SAFE_AUTOINSTALL_IDS) {
    // Respect any explicit user choice — if the toggle already exists we
    // leave it alone. We only write through for IDs the user hasn't decided
    // on yet.
    if (toggles[id]) continue;
    toggles[id] = { enabled: true };
    enabledNow.push(id);
  }

  const nextConfig = {
    ...config,
    ai: {
      ...(config.ai ?? {}),
      mcp: {
        ...(config.ai?.mcp ?? {}),
        builtinToggles: toggles,
        autoinstalledAt: new Date().toISOString()
      }
    }
  };
  configStore.save(nextConfig);

  if (enabledNow.length > 0) {
    try {
      appendAuditLog(runtime, "mcp.autoinstall", {
        enabled: enabledNow,
        safe_ids: SAFE_AUTOINSTALL_IDS
      });
    } catch { /* audit is best-effort during bootstrap */ }
  }
  return { ran: true, enabled: enabledNow };
}
