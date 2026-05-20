import {
  ACTION_OBLIGATION_GROUPS,
  buildActionObligationGuidance
} from "../../core/policy/obligation-evaluator.mjs";
import { toolsInGroup } from "../../core/policy/policy-groups.mjs";

const REQUIRED_ACTION_POLICY_GROUPS = new Set(ACTION_OBLIGATION_GROUPS);

function missingRequiredActionGroups(stepGate) {
  if (!stepGate || !["continue", "retry", "escalate", "abort"].includes(stepGate.next_action)) return [];
  const violations = Array.isArray(stepGate.violations) ? stepGate.violations : [];
  if (violations.length === 0) return [];
  const groups = [];
  for (const violation of violations) {
    const kind = String(violation?.kind ?? "");
    const group = [...REQUIRED_ACTION_POLICY_GROUPS].find(
      (candidate) => kind === `${candidate}_required_not_called`
    );
    if (group) groups.push(group);
  }
  return [...new Set(groups)];
}

export function shouldInjectRequiredActionGuidance(stepGate, transcript = [], { allowTerminal = false } = {}) {
  const groups = missingRequiredActionGroups(stepGate);
  if (groups.length === 0) return [];
  if (["escalate", "abort"].includes(stepGate?.next_action) && !allowTerminal) return [];
  void transcript;
  return groups;
}

export function buildRequiredActionGuidance(groups = [], { actionOnly = false } = {}) {
  const obligations = groups.map((group) => ({
    group,
    status: "pending",
    members: toolsInGroup(group)
  }));
  const base = buildActionObligationGuidance(obligations);
  if (!actionOnly) return base;
  return [
    base,
    "",
    "Action-only handoff: stop research/tool exploration now.",
    "Only call a tool/workflow that satisfies the pending action obligation. Do not call web_search, web_search_fetch, fetch_url_content, download_file, or any other research/download tool again in this turn.",
    "Use the best information already collected in the transcript as the action body/content. If a required action argument is truly missing, ask one concise clarifying question."
  ].join("\n");
}

function latestActionOnlyGroups(transcript = []) {
  for (let i = (transcript ?? []).length - 1; i >= 0; i -= 1) {
    const entry = transcript[i];
    if (entry?.type !== "contract_guidance") continue;
    if (entry.action_only !== true) continue;
    return Array.isArray(entry.groups) ? entry.groups.filter(Boolean) : [];
  }
  return [];
}

export function actionOnlyToolIds(transcript = []) {
  const groups = latestActionOnlyGroups(transcript);
  return new Set(groups.flatMap((group) => toolsInGroup(group)));
}

export function filterToolsForActionOnlyGuidance(tools = [], transcript = []) {
  const allowed = actionOnlyToolIds(transcript);
  if (allowed.size === 0) return tools;
  return tools.filter((tool) => allowed.has(tool.id));
}
