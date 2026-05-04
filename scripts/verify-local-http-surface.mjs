#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeDir = path.join(repoRoot, "src", "service", "core", "http-routes");

const ALLOWED_BOUNDARIES = new Set([
  "audio_session_guard_pending",
  "guarded_desktop_actor",
  "read_probe_no_guard",
  "task_entrypoint",
  "context_entrypoint",
  "oauth_flow_entrypoint",
  "local_ui_pending_guard"
]);

function surface(file, method, matcher, {
  domain,
  effect,
  boundary,
  migration
}) {
  return {
    file,
    method,
    matcher,
    domain,
    effect,
    boundary,
    migration
  };
}

const expectedSurfaces = [
  surface("ai-status-routes.mjs", "PATCH", "/^\\/ai\\/mcp\\/[^/]+\\/config$/", {
    domain: "mcp_runtime",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("ai-status-routes.mjs", "PATCH", "/^\\/ai\\/mcp\\/[^/]+\\/toggle$/", {
    domain: "mcp_runtime",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("audio-routes.mjs", "POST", "/echo/enroll-keyword", {
    domain: "audio",
    effect: "local_audio_training",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("audio-routes.mjs", "POST", "/echo/kws", {
    domain: "audio",
    effect: "local_audio_processing",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("audio-routes.mjs", "POST", "/note/transcribe", {
    domain: "audio",
    effect: "local_file_processing",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("browser-context-routes.mjs", "DELETE", "/location", {
    domain: "browser_context",
    effect: "context_state_write",
    boundary: "context_entrypoint",
    migration: "browser_extension_boundary"
  }),
  surface("browser-context-routes.mjs", "POST", "/browser/context", {
    domain: "browser_context",
    effect: "context_state_write",
    boundary: "context_entrypoint",
    migration: "browser_extension_boundary"
  }),
  surface("browser-context-routes.mjs", "POST", "/location", {
    domain: "browser_context",
    effect: "context_state_write",
    boundary: "context_entrypoint",
    migration: "browser_extension_boundary"
  }),
  surface("browser-context-routes.mjs", "POST", "/location/windows", {
    domain: "browser_context",
    effect: "local_probe",
    boundary: "context_entrypoint",
    migration: "browser_extension_boundary"
  }),
  surface("browser-context-routes.mjs", "POST", "/overlay/handoff", {
    domain: "browser_context",
    effect: "handoff_file_write",
    boundary: "context_entrypoint",
    migration: "browser_extension_boundary"
  }),
  surface("browser-context-routes.mjs", "POST", "/page/explain", {
    domain: "browser_context",
    effect: "handoff_file_write",
    boundary: "context_entrypoint",
    migration: "browser_extension_boundary"
  }),

  surface("config-provider-routes.mjs", "DELETE", "/config/code-cli/adapters/*", {
    domain: "code_cli_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "DELETE", "/config/email/accounts/*", {
    domain: "email_config",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "DELETE", "/config/mcp/servers/*", {
    domain: "mcp_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "DELETE", "/config/providers/*", {
    domain: "provider_config",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "DELETE", "/config/skills/registries/*", {
    domain: "skills_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "PATCH", "/^\\/config\\/onboarding\\/suggestions\\/([^/]+)$/", {
    domain: "provider_onboarding",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/code-cli/adapters", {
    domain: "code_cli_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/email/accounts", {
    domain: "email_config",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/email/settings", {
    domain: "email_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/features", {
    domain: "runtime_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/mcp/servers", {
    domain: "mcp_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/mcp/drafts/import", {
    domain: "mcp_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done_review_first_disabled_import"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/mcp/test", {
    domain: "mcp_config",
    effect: "descriptor_validation",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),
  surface("config-provider-routes.mjs", "POST", "/^\\/config\\/mcp\\/servers\\/[^/]+\\/test$/", {
    domain: "mcp_config",
    effect: "readiness_probe",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/output", {
    domain: "runtime_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/providers", {
    domain: "provider_config",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/routing", {
    domain: "runtime_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/skills/registries", {
    domain: "skills_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/config/skills/test", {
    domain: "skills_config",
    effect: "descriptor_validation",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),
  surface("config-provider-routes.mjs", "POST", "/email/digest/check", {
    domain: "email",
    effect: "local_probe",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/skills/save", {
    domain: "skills_config",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "GET", "/skills/read", {
    domain: "skills_config",
    effect: "local_file_read",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/skills/write", {
    domain: "skills_config",
    effect: "local_file_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/skills/create", {
    domain: "skills_config",
    effect: "local_file_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/skills/duplicate", {
    domain: "skills_config",
    effect: "local_file_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "GET", "/skills/history", {
    domain: "skills_config",
    effect: "local_file_read",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/skills/rollback", {
    domain: "skills_config",
    effect: "local_file_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("config-provider-routes.mjs", "POST", "/skills/test", {
    domain: "skills_config",
    effect: "local_file_read",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("connector-routes.mjs", "DELETE", "/^\\/connectors\\/accounts\\/(microsoft|google)$/", {
    domain: "connector_accounts",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "DELETE", "/^\\/connectors\\/connected-accounts\\/[^/]+$/", {
    domain: "connector_accounts",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "DELETE", "/^\\/plugins\\/[^/]+$/", {
    domain: "plugins",
    effect: "plugin_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "PATCH", "/^\\/connectors\\/accounts\\/(microsoft|google)\\/config$/", {
    domain: "connector_accounts",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "PATCH", "/^\\/connectors\\/connected-accounts\\/[^/]+\\/defaults$/", {
    domain: "connector_accounts",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "PATCH", "/^\\/connectors\\/connected-accounts\\/[^/]+$/", {
    domain: "connector_accounts",
    effect: "credential_config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "PATCH", "/^\\/plugins\\/[^/]+\\/enabled$/", {
    domain: "plugins",
    effect: "plugin_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "POST", "/^\\/connectors\\/accounts\\/(microsoft|google)\\/auth\\/start$/", {
    domain: "connector_accounts",
    effect: "oauth_start",
    boundary: "oauth_flow_entrypoint",
    migration: "connector_oauth_boundary"
  }),
  surface("connector-routes.mjs", "POST", "/^\\/connectors\\/catalog\\/workflows\\/[^/]+\\/run$/", {
    domain: "connector_workflows",
    effect: "task_submission",
    boundary: "task_entrypoint",
    migration: "connector_workflow_entrypoint"
  }),
  surface("connector-routes.mjs", "POST", "/^\\/connectors\\/connected-accounts\\/[^/]+\\/reauth\\/start$/", {
    domain: "connector_accounts",
    effect: "oauth_start",
    boundary: "oauth_flow_entrypoint",
    migration: "connector_oauth_boundary"
  }),
  surface("connector-routes.mjs", "POST", "/plugins/install", {
    domain: "plugins",
    effect: "plugin_install",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("connector-routes.mjs", "POST", "/plugins/reload", {
    domain: "plugins",
    effect: "plugin_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("mcp-install-routes.mjs", "POST", "/config/mcp/install/plan", {
    domain: "mcp_install",
    effect: "sandbox_plan",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),
  surface("mcp-install-routes.mjs", "POST", "/config/mcp/install/preview", {
    domain: "mcp_install",
    effect: "local_file_read_probe",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("mcp-install-routes.mjs", "POST", "/config/mcp/install/run", {
    domain: "mcp_install",
    effect: "external_command",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("note-project-conversation-routes.mjs", "DELETE", "/^\\/conversation\\/([^/]+)$/", {
    domain: "conversation",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "PATCH", "/^\\/conversation\\/([^/]+)$/", {
    domain: "conversation",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "PATCH", "/^\\/conversation\\/([^/]+)\\/model$/", {
    domain: "conversation",
    effect: "model_route_override",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/conversations", {
    domain: "conversation",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/notes", {
    domain: "notes",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/notes/append-chip", {
    domain: "notes",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/notes/delete", {
    domain: "notes",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/notes/restore", {
    domain: "notes",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "soft_delete_restore"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/notes/upsert", {
    domain: "notes",
    effect: "local_state_write",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/projects/store", {
    domain: "projects",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/^\\/projects\\/([^/]+)\\/files\\/attach$/", {
    domain: "projects",
    effect: "local_file_index_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("note-project-conversation-routes.mjs", "POST", "/^\\/projects\\/([^/]+)\\/files\\/remove-index$/", {
    domain: "projects",
    effect: "local_file_index_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("office-routes.mjs", "POST", "/setup/office-addins", {
    domain: "office_setup",
    effect: "local_app_setup",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("preview-file-routes.mjs", "POST", "/preview/cache/clear", {
    domain: "preview_cache",
    effect: "cache_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("runtime-admin-routes.mjs", "POST", "/^\\/approvals\\/([^/]+)\\/approve$/", {
    domain: "approvals",
    effect: "side_effect_authorization",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "POST", "/^\\/approvals\\/([^/]+)\\/reject$/", {
    domain: "approvals",
    effect: "side_effect_authorization",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "POST", "/export/bundle", {
    domain: "data_export",
    effect: "privacy_sensitive_read",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "POST", "/diagnostics/bundle", {
    domain: "diagnostics",
    effect: "privacy_sensitive_read",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "POST", "/budget", {
    domain: "budget",
    effect: "config_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "POST", "/history/search", {
    domain: "history",
    effect: "read_search",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),
  surface("runtime-admin-routes.mjs", "GET", "/history/file-content", {
    domain: "history",
    effect: "privacy_sensitive_read",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "DELETE", "/^\\/history\\/file-content\\/([^/]+)$/", {
    domain: "history",
    effect: "local_index_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("runtime-admin-routes.mjs", "POST", "/security/state", {
    domain: "security",
    effect: "security_policy_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),

  surface("scheduler-template-routes.mjs", "DELETE", "/^\\/schedules\\/([^/]+)$/", {
    domain: "scheduler",
    effect: "scheduler_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "DELETE", "/^\\/templates\\/([^/]+)$/", {
    domain: "templates",
    effect: "template_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "PATCH", "/^\\/schedules\\/([^/]+)$/", {
    domain: "scheduler",
    effect: "scheduler_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/^\\/dag\\/executions\\/([^/]+)\\/resume$/", {
    domain: "dag",
    effect: "manual_execution",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/^\\/schedules\\/([^/]+)\\/runs$/", {
    domain: "scheduler",
    effect: "manual_execution",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/dag/preview", {
    domain: "dag",
    effect: "descriptor_validation",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/schedules", {
    domain: "scheduler",
    effect: "scheduler_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/templates", {
    domain: "templates",
    effect: "template_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/templates/import", {
    domain: "templates",
    effect: "template_mutation",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("scheduler-template-routes.mjs", "POST", "/templates/validate", {
    domain: "templates",
    effect: "descriptor_validation",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),

  surface("task-routes.mjs", "DELETE", "/^\\/task\\/([^/]+)$/", {
    domain: "tasks",
    effect: "task_control",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("task-routes.mjs", "POST", "/^\\/task\\/([^/]+)\\/cancel$/", {
    domain: "tasks",
    effect: "task_control",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("task-routes.mjs", "POST", "/^\\/task\\/([^/]+)\\/retry$/", {
    domain: "tasks",
    effect: "task_control",
    boundary: "guarded_desktop_actor",
    migration: "done"
  }),
  surface("task-routes.mjs", "POST", "/^\\/task\\/([^/]+)\\/restore$/", {
    domain: "tasks",
    effect: "task_control",
    boundary: "guarded_desktop_actor",
    migration: "soft_delete_restore"
  }),
  surface("task-routes.mjs", "POST", "/context", {
    domain: "tasks",
    effect: "security_context_probe",
    boundary: "read_probe_no_guard",
    migration: "not_needed_read_probe"
  }),
  surface("task-routes.mjs", "POST", "/task", {
    domain: "tasks",
    effect: "task_submission",
    boundary: "task_entrypoint",
    migration: "submission_policy_boundary"
  }),
  surface("task-routes.mjs", "POST", "/task/clarify", {
    domain: "tasks",
    effect: "task_submission",
    boundary: "task_entrypoint",
    migration: "submission_policy_boundary"
  })
];

const explicitlyInventoriedGetSignatures = new Set(
  expectedSurfaces
    .filter((entry) => entry.method === "GET")
    .map(signature)
);

function readRegexLiteral(text, start) {
  if (text[start] !== "/") return null;
  let escaped = false;
  let inClass = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      continue;
    }
    if (ch === "]") {
      inClass = false;
      continue;
    }
    if (ch === "/" && !inClass) {
      let end = index + 1;
      while (/[a-z]/i.test(text[end] ?? "")) end += 1;
      return text.slice(start, end);
    }
  }
  return null;
}

function discoverFile(file) {
  const source = readFileSync(path.join(routeDir, file), "utf8");
  const lines = source.split(/\r?\n/);
  const matchVariables = new Map();
  const discovered = [];
  const pushDiscovered = (entry) => {
    if (entry.method === "GET" && !explicitlyInventoriedGetSignatures.has(signature(entry))) {
      return;
    }
    discovered.push(entry);
  };

  for (const line of lines) {
    const matchCall = line.match(/const\s+(\w+)\s*=\s*url\.pathname\.match\(/);
    if (!matchCall) continue;
    const slashIndex = line.indexOf("/", matchCall.index);
    const matcher = readRegexLiteral(line, slashIndex);
    if (matcher) {
      matchVariables.set(matchCall[1], matcher);
    }
  }

  for (const line of lines) {
    const methodMatch = line.match(/method\s*===\s*"(GET|POST|PATCH|DELETE)"/);
    if (!methodMatch) continue;
    const method = methodMatch[1];
    const literalMatch = line.match(/url\.pathname\s*===\s*"([^"]+)"/);
    if (literalMatch) {
      pushDiscovered({ file, method, matcher: literalMatch[1] });
    }

    const prefixMatch = line.match(/url\.pathname\.startsWith\("([^"]+)"\)/);
    if (prefixMatch) {
      pushDiscovered({ file, method, matcher: `${prefixMatch[1]}*` });
    }

    if (line.includes(".test(url.pathname)")) {
      const slashIndex = line.indexOf("/");
      const matcher = readRegexLiteral(line, slashIndex);
      if (matcher) {
        pushDiscovered({ file, method, matcher });
      }
    }

    for (const [variable, matcher] of matchVariables) {
      if (!line.includes("url.pathname.match") && new RegExp(`\\b${variable}\\b`).test(line)) {
        pushDiscovered({ file, method, matcher });
      }
    }
  }

  return [...new Map(discovered.map((entry) => [signature(entry), entry])).values()];
}

function signature(entry) {
  return `${entry.file}|${entry.method}|${entry.matcher}`;
}

function sortedSignatures(entries) {
  return entries.map(signature).sort();
}

function diffSets(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    unexpected: actual.filter((item) => !expectedSet.has(item)),
    missing: expected.filter((item) => !actualSet.has(item))
  };
}

function escapeRegExp(value) {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertDesktopActorGuard(surfaceEntry) {
  const source = readFileSync(path.join(routeDir, surfaceEntry.file), "utf8");
  let routeIndex = -1;
  if (surfaceEntry.matcher.startsWith("/^")) {
    const variableMatch = source.match(new RegExp(
      `const\\s+(\\w+)\\s*=\\s*url\\.pathname\\.match\\(${escapeRegExp(surfaceEntry.matcher)}\\)`
    ));
    if (variableMatch) {
      routeIndex = source.indexOf(`if (${variableMatch[1]} && method === "${surfaceEntry.method}"`);
      if (routeIndex < 0) {
        routeIndex = source.indexOf(`if (method === "${surfaceEntry.method}" && ${variableMatch[1]}`);
      }
      if (routeIndex < 0) {
        const compoundMethodIndex = source.indexOf(`if ((method === "${surfaceEntry.method}"`);
        if (compoundMethodIndex >= 0) {
          const compoundLine = source.slice(compoundMethodIndex, source.indexOf("\n", compoundMethodIndex));
          if (compoundLine.includes(variableMatch[1])) {
            routeIndex = compoundMethodIndex;
          }
        }
      }
    } else {
      routeIndex = source.indexOf(`if (method === "${surfaceEntry.method}" && ${surfaceEntry.matcher}.test(url.pathname))`);
      if (routeIndex < 0) {
        routeIndex = source.indexOf(`if (${surfaceEntry.matcher}.test(url.pathname) && method === "${surfaceEntry.method}")`);
      }
      if (routeIndex < 0) {
        routeIndex = source.indexOf(surfaceEntry.matcher);
      }
    }
  } else if (surfaceEntry.matcher.endsWith("*")) {
    routeIndex = source.indexOf(`url.pathname.startsWith("${surfaceEntry.matcher.slice(0, -1)}")`);
  } else {
    routeIndex = source.indexOf(`if (method === "${surfaceEntry.method}" && url.pathname === "${surfaceEntry.matcher}")`);
    if (routeIndex < 0) {
      routeIndex = source.indexOf(`if (url.pathname === "${surfaceEntry.matcher}" && method === "${surfaceEntry.method}")`);
    }
    if (routeIndex < 0) {
      routeIndex = source.indexOf(`url.pathname === "${surfaceEntry.matcher}"`);
    }
  }
  assert.ok(routeIndex >= 0, `${signature(surfaceEntry)} must have a source matcher`);
  const nextRouteIndex = source.indexOf("\n  if (", routeIndex + 1);
  const routeBlock = source.slice(routeIndex, nextRouteIndex >= 0 ? nextRouteIndex : undefined);
  assert.match(routeBlock, /\brequireDesktopActor\s*\(/, `${signature(surfaceEntry)} must use requireDesktopActor in its route block`);
}

const routeFiles = readdirSync(routeDir)
  .filter((name) => name.endsWith(".mjs"))
  .sort();
const actualSurfaces = routeFiles.flatMap(discoverFile);
const actual = sortedSignatures(actualSurfaces);
const expected = sortedSignatures(expectedSurfaces);
const diff = diffSets(actual, expected);
assert.deepEqual(diff, { unexpected: [], missing: [] }, [
  "Local HTTP side-effect and explicitly inventoried sensitive-read surface drifted.",
  "Classify new routes here before landing them; do not add local mutation or sensitive-read routes anonymously.",
  `Unexpected: ${diff.unexpected.join(", ") || "none"}`,
  `Missing: ${diff.missing.join(", ") || "none"}`
].join("\n"));

assert.equal(
  new Set(expected).size,
  expectedSurfaces.length,
  "local HTTP surface inventory must not contain duplicate signatures"
);

for (const entry of expectedSurfaces) {
  assert.ok(entry.domain, `${signature(entry)} must declare a domain`);
  assert.ok(entry.effect, `${signature(entry)} must declare an effect`);
  assert.ok(ALLOWED_BOUNDARIES.has(entry.boundary), `${signature(entry)} has unknown boundary ${entry.boundary}`);
  assert.ok(entry.migration, `${signature(entry)} must declare a migration/status note`);
  if (entry.boundary === "guarded_desktop_actor") {
    assertDesktopActorGuard(entry);
  }
  if (entry.boundary === "read_probe_no_guard") {
    assert.match(
      entry.effect,
      /probe|validation|search|sandbox_plan/,
      `${signature(entry)} is marked read_probe_no_guard but effect is ${entry.effect}`
    );
  }
}

const summary = expectedSurfaces.reduce((acc, entry) => {
  acc.boundaries.set(entry.boundary, (acc.boundaries.get(entry.boundary) ?? 0) + 1);
  acc.domains.set(entry.domain, (acc.domains.get(entry.domain) ?? 0) + 1);
  return acc;
}, { boundaries: new Map(), domains: new Map() });

console.log("Local HTTP surface inventory audit passed.");
console.log(`- surfaces: ${expectedSurfaces.length}`);
for (const [boundary, count] of [...summary.boundaries.entries()].sort()) {
  console.log(`- boundary ${boundary}: ${count}`);
}
