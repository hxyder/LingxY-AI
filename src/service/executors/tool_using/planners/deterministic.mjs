/**
 * UCA-077 P3-01: Deterministic tool planner.
 *
 * Returns a tool_call when a single, unambiguous mapping exists between the
 * user's text and a tool — no LLM round-trip needed. Today that covers:
 *   - `open_url`        — explicit "打开 X / open X" + a URL in the text
 *   - `connector_workflow_run` — a workflow trigger phrase plus all required
 *                                inputs already present in the text
 *   - `launch_app`      — explicit launch verb + a recognised app name
 *
 * Returns null when the text is ambiguous; callers fall through to the
 * connector planner / LLM planner / final-text fallback.
 *
 * Why this lives in its own file:
 *   - It is the cheapest/fastest path. Putting it next to launch-helpers
 *     and connector-helpers makes its dependency graph obvious.
 *   - It has zero side effects — easy to unit-test without the runtime.
 */

import { matchWorkflowByTrigger, extractWorkflowInput } from "../../../connectors/core/connector-intent.mjs";
import { detect as detectExplicitSearch } from "../../../core/intent/signals/explicit-search.mjs";
import { extractUrl, extractLaunchAppName } from "./launch-helpers.mjs";

/**
 * @param {string} userCommand
 * @param {object|null} catalog
 * @returns {{ type: "tool_call", tool: string, args: object } | null}
 */
export function planDeterministicToolCall(userCommand = "", catalog = null) {
  const text = String(userCommand ?? "").trim();
  const url = extractUrl(text);
  if (url && /(打开|访问|open|visit|go to|网页|网站|链接|url)/i.test(text)) {
    return {
      type: "tool_call",
      tool: "open_url",
      args: { url }
    };
  }

  // Workflow dispatch is the LLM planner's job; this no-LLM fallback planner
  // only runs when no chat provider is configured. Only short-circuit here
  // when the user explicitly provided every required workflow input in the
  // text (e.g. "主题：xx 正文：yy") — otherwise let the capability-based read
  // path below take over so the user still sees something useful instead of
  // a validation-failed workflow.
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

  // Connector-domain guesswork (account_list_emails for anything mentioning
  // "邮件"/"gmail") is intentionally NOT done here. It would short-circuit
  // write-intent commands like "给 X 发一份邮件" into a read call and never
  // let the LLM see the request. The LLM planner has catalog hints and picks
  // connector_workflow_run itself. Only no-LLM defaultPlanner uses
  // planConnectorToolCall (as a separate step, not from here).
  // UCA-077 P1-06: short-circuit out of planDeterministicToolCall when the
  // request looks like a connector / file / search task — the LLM planner or
  // dedicated handlers own those. We use the explicit-search signal directly
  // (same regex source) instead of the deleted isSearchOrNewsRequest helper.
  if (/(邮件|email|gmail|outlook|日历|calendar|drive|onedrive|文件|网盘)/i.test(text) || detectExplicitSearch(text, {}).matched) {
    return null;
  }

  const launchApp = extractLaunchAppName(text);
  if (launchApp) {
    return {
      type: "tool_call",
      tool: "launch_app",
      args: { app: launchApp }
    };
  }

  return null;
}
