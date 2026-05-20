import { toolsInGroup } from "../../core/policy/policy-groups.mjs";
import { neededCapabilitiesOf } from "./tool-surface.mjs";

export function taskRequiresToolUse(task) {
  const spec = task?.task_spec ?? {};
  const contract = spec.success_contract ?? {};
  const requiredToolNames = contract.required_tool_names ?? [];
  const requiredPolicyGroups = contract.required_policy_groups ?? [];
  const actionGoals = new Set([
    "launch_and_act",
    "open_or_reveal_file",
    "transform_existing_file",
    "schedule_or_notify",
    "create_or_update_calendar_event"
  ]);
  return Boolean(
    task?.__forceToolUse === true
    || spec.connector_domain === true
    || spec.artifact?.required === true
    || spec.tool_policy?.web_search_fetch?.mode === "required"
    || contract.tool_called === true
    || (Array.isArray(requiredToolNames) && requiredToolNames.length > 0)
    || (Array.isArray(requiredPolicyGroups) && requiredPolicyGroups.length > 0)
    || actionGoals.has(spec.goal)
  );
}

export function externalWebModeOf(task) {
  return task?.task_spec?.tool_policy?.policy_groups?.external_web_read?.mode
    ?? task?.task_spec?.tool_policy?.web_search_fetch?.mode
    ?? "forbidden";
}

function capabilitiesAreNone(capabilities = []) {
  return capabilities.length === 0 || capabilities.every((capability) => capability === "none");
}

export function shouldUseLeanChatMode(task) {
  if (taskRequiresToolUse(task)) return false;
  const spec = task?.task_spec ?? {};
  if (spec.artifact?.required === true) return false;
  if (spec.connector_domain === true) return false;
  if (externalWebModeOf(task) === "required") return false;
  if (Array.isArray(task?.context_packet?.file_paths) && task.context_packet.file_paths.length > 0) return false;
  if (Array.isArray(task?.context_packet?.image_paths) && task.context_packet.image_paths.length > 0) return false;

  const decision = task?.context_packet?.semantic_router_decision ?? null;
  if (decision && typeof decision === "object") {
    const capabilities = neededCapabilitiesOf(task);
    const sourceMode = decision.source_mode ?? "unknown";
    const toolFirstIntents = new Set([
      "automation",
      "computer_control",
      "email_calendar_action",
      "artifact_generation",
      "file_analysis",
      "research"
    ]);
    return Boolean(
      decision.needs_tool_use === false
      && decision.artifact_required !== true
      && decision.web_policy !== "required"
      && capabilitiesAreNone(capabilities)
      && ["no_external", "provided_context"].includes(sourceMode)
      && !toolFirstIntents.has(decision.primary_intent)
    );
  }

  // Conservative no-SR fallback. This is not a rules-answer fast path: it only
  // trims tool prompting after TaskSpec has already classified the turn as qa.
  return Boolean(
    spec.goal === "qa"
    && spec.contract?.mode === "qa"
    && externalWebModeOf(task) === "forbidden"
  );
}

function formatLeanAmbientContext() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return `Current local date and time: ${now.toLocaleString("sv-SE", { hour12: false })} (${tz}).`;
}

export function renderRequiredContractForPlanner(task) {
  const spec = task?.task_spec ?? {};
  const contract = task?.task_spec?.success_contract ?? {};
  const requiredTools = Array.isArray(contract.required_tool_names)
    ? contract.required_tool_names.filter(Boolean)
    : [];
  const requiredGroups = Array.isArray(contract.required_policy_groups)
    ? contract.required_policy_groups.filter(Boolean)
    : [];
  const artifactRequired = spec.artifact?.required === true
    || contract.artifact_created === true
    || spec.contract?.output_contract?.artifact_required === true;
  if (requiredTools.length === 0 && requiredGroups.length === 0 && !artifactRequired) return "";

  const lines = ["", "Task contract:"];
  lines.push(`- required_tools: ${requiredTools.length > 0 ? requiredTools.join(", ") : "(none)"}`);
  lines.push("- required_policy_groups:");
  if (requiredGroups.length === 0) {
    lines.push("  - (none)");
  } else {
    for (const group of requiredGroups) {
      const members = toolsInGroup(group);
      const memberHint = members.length > 0 ? ` (any of: ${members.join(", ")})` : "";
      lines.push(`  - ${group}${memberHint}`);
    }
  }
  if (artifactRequired) {
    const kind = spec.artifact?.kind ?? spec.contract?.output_contract?.kind ?? "artifact";
    lines.push(`- artifact_required: true`);
    lines.push(`- artifact_kind: ${kind}`);
    const artifactTools = spec.goal === "transform_existing_file"
      ? "edit_file (update the existing artifact path in place), register_artifact"
      : kind === "image"
        ? "download_file (direct web file URL), render_svg/write_file (generated local image), register_artifact"
        : "generate_document, write_file, register_artifact";
    lines.push(`- artifact_tools: ${artifactTools}`);
    lines.push(`- artifact_verify_tool: verify_file_exists (verifier, not a producer)`);
    lines.push(`- must_verify_artifact: ${spec.constraints?.must_verify_artifact === false ? "false" : "true"}`);
  }
  return lines.join("\n");
}

export function buildLeanChatSystemPrompt({ task, synthesisBlock }) {
  const expected = task?.task_spec?.synthesis?.expected_output ?? "direct_answer";
  return `You are LingxY, a helpful conversational AI assistant.
The current task contract says this turn should be answered directly without external tools.
If the conversation history establishes a roleplay/persona (interviewer, coach, reviewer, or another requested role), keep that role active. When that role conflicts with the generic LingxY identity, follow the conversation role unless it asks for unsafe real-world action.
Do not ask for files, folders, accounts, or apps unless the current user message explicitly asks to use them.
If fresh/current external data is actually required despite the contract, ask one short permission or clarification question instead of guessing.
Phantom-attachment rule: if the user refers to an attachment (image / file / screenshot / 图片 / 这张图 / 这张照片 / 这个文件 / 上传的) but no attachment is present in this turn, ASK which one — never describe, analyze, or guess at the contents of a fictional attachment.
Expected output: ${expected}.
${formatLeanAmbientContext()}${synthesisBlock}
Reply in the user's language.`;
}

export function shouldRetryProseTrap({ task, prose, transcript }) {
  if (!prose || typeof prose !== "string") return false;
  const anyToolRan = transcript.some((e) => e.type === "tool_result");
  if (anyToolRan) return false;
  const cmd = (task.user_command ?? "").trim();
  if (!cmd) return false;
  return taskRequiresToolUse(task);
}
