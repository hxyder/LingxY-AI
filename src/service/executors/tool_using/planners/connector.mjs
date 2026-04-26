/**
 * UCA-077 P3-01: Connector-domain planner.
 *
 * Runs when the user is clearly asking about a connected account / service
 * (gmail, calendar, drive, etc) but the deterministic planner did not catch
 * a complete workflow trigger. Picks the cheapest correct read tool:
 *   1. account_list_connected_accounts — for "list my accounts" style asks
 *   2. capability-driven read tool from the catalog (provider-aware)
 *   3. fallback to canonical account_list_* action tools
 *
 * Always returns a tool_call (never null) once we are inside a connector
 * domain — the LLM planner does not need a chance to refuse.
 */

import {
  isConnectorAccountIdentityRequest,
  isConnectorDomainRequest,
  inferConnectorLimit,
  inferConnectorProvider,
  matchWorkflowByTrigger,
  extractWorkflowInput
} from "../../../connectors/core/connector-intent.mjs";
import {
  fallbackReadToolForCapability,
  inferCapabilityFromText,
  pickReadActionToolFromCatalog
} from "./connector-helpers.mjs";

/**
 * @param {string} userCommand
 * @param {object|null} catalog
 * @returns {{ type: "tool_call", tool: string, args: object } | null}
 */
export function planConnectorToolCall(userCommand = "", catalog = null) {
  const text = String(userCommand ?? "");
  if (!isConnectorDomainRequest(text)) return null;

  // Same rule as planDeterministicToolCall: only dispatch a workflow if the
  // user explicitly provided every required input. Otherwise drop through to
  // the read-tool fallback so we don't hand the dispatcher empty fields.
  const workflow = catalog ? matchWorkflowByTrigger(text, catalog) : null;
  if (workflow) {
    const firstToolId = workflow.steps?.find((step) => step?.tool)?.tool;
    const firstTool = firstToolId ? catalog.getTool?.(firstToolId) : null;
    const required = firstTool?.inputSchema?.required ?? [];
    const input = extractWorkflowInput(text, workflow);
    const missing = required.filter((field) => {
      const value = input?.[field];
      if (value === undefined || value === null) return true;
      if (typeof value === "string" && !value.trim()) return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return false;
    });
    if (missing.length === 0) {
      return {
        type: "tool_call",
        tool: "connector_workflow_run",
        args: { workflowId: workflow.id, input }
      };
    }
  }

  const provider = inferConnectorProvider(text);
  const withProvider = provider ? { provider } : {};
  const limit = inferConnectorLimit(text, 10);

  if (isConnectorAccountIdentityRequest(text)) {
    return {
      type: "tool_call",
      tool: "account_list_connected_accounts",
      args: withProvider
    };
  }

  // Capability-driven read fallback: agent-loop no longer hardcodes Gmail /
  // Outlook strings. It asks the catalog for a read tool matching the
  // capability implied by the user's wording, so new providers pick this up
  // for free once they ship a contract. When the catalog is unavailable (eg
  // minimal test runtimes) we fall back to the provider-agnostic
  // account_list_* action tools using the same capability inference.
  const capability = inferCapabilityFromText(text);
  if (capability) {
    if (catalog) {
      const matches = catalog.listTools({ capability, provider: provider ?? undefined, risk: "low" });
      if (matches.length > 0) {
        const readToolId = pickReadActionToolFromCatalog(catalog, matches[0].id);
        if (readToolId) {
          return {
            type: "tool_call",
            tool: readToolId,
            args: { ...withProvider, limit }
          };
        }
      }
    }
    const fallback = fallbackReadToolForCapability(capability);
    if (fallback) {
      return {
        type: "tool_call",
        tool: fallback,
        args: { ...withProvider, limit }
      };
    }
  }

  return {
    type: "tool_call",
    tool: "account_list_connected_accounts",
    args: withProvider
  };
}
