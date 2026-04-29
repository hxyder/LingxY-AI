import { toolsInGroup } from "./policy-groups.mjs";

export const ACTION_OBLIGATION_GROUPS = Object.freeze([
  "email_send",
  "calendar_create",
  "file_upload",
  "schedule_create"
]);

const ACTION_OBLIGATION_SET = new Set(ACTION_OBLIGATION_GROUPS);
const WORKFLOW_TOOL = "connector_workflow_run";

const GROUP_LABELS = Object.freeze({
  email_send: "email send",
  calendar_create: "calendar event creation",
  file_upload: "file upload",
  schedule_create: "scheduled task creation"
});

const GROUP_HINTS = Object.freeze({
  email_send: "Use the transcript/context to fill recipient, subject, and body. Prefer connector_workflow_run with a Gmail/Outlook send workflow when available so the user receives the normal confirmation card.",
  calendar_create: "Use title, start/end time, attendees, description, and location from the request/context. Prefer connector_workflow_run with a calendar create workflow when available; otherwise call account_create_event or a provider create-event tool.",
  file_upload: "Use an absolute local path from attachments/artifacts/context. Call account_upload_file or a provider Drive/OneDrive upload tool; ask for the smallest missing file/path/destination detail only if it cannot be inferred.",
  schedule_create: "Call create_scheduled_task with a name, a trigger ({natural_language:'5 分钟后'} / {type:'at',run_at:'<ISO>'} / {type:'cron',expression:'0 9 * * *'}), and an action ({type:'task',target:'<label>',params:{userCommand:'<full natural-language instruction>'}}). Do NOT execute the work now — schedule it and let the firing path do the work."
});

const MISSING_INPUT_PATTERNS = Object.freeze({
  email_send: [
    /(?:missing|required|invalid|empty).{0,40}(?:recipient|to|email|subject|body)/i,
    /(?:recipient|to|email|subject|body).{0,40}(?:missing|required|invalid|empty)/i,
    /(?:收件人|邮箱|邮件地址|主题|正文|内容).{0,12}(?:缺少|未指定|不能为空|需要|必填)/
  ],
  calendar_create: [
    /(?:missing|required|invalid|empty).{0,40}(?:title|start|end|time|date|attendee)/i,
    /(?:title|start|end|time|date|attendee).{0,40}(?:missing|required|invalid|empty)/i,
    /(?:标题|时间|日期|开始|结束|参会人|会议).{0,12}(?:缺少|未指定|不能为空|需要|必填)/
  ],
  file_upload: [
    /(?:missing|required|invalid|empty).{0,40}(?:file|path|localPath|folder|destination)/i,
    /(?:file|path|localPath|folder|destination).{0,40}(?:missing|required|invalid|empty)/i,
    /(?:文件|路径|本地路径|目标|文件夹).{0,12}(?:缺少|未指定|不能为空|需要|必填)/
  ],
  schedule_create: [
    /(?:missing|required|invalid|empty).{0,40}(?:trigger|cron|run_at|when|action|userCommand)/i,
    /(?:trigger|cron|run_at|when|action|userCommand).{0,40}(?:missing|required|invalid|empty)/i,
    /(?:触发|时间|什么时候|执行内容|任务内容).{0,12}(?:缺少|未指定|不能为空|需要|必填)/
  ]
});

const FINAL_CLARIFICATION_PATTERNS = Object.freeze({
  email_send: [
    /(?:which|what).{0,24}(?:recipient|email address)/i,
    /(?:recipient|email address).{0,24}(?:needed|missing|required|should i use)/i,
    /(?:发给谁|收件人|邮箱|邮件地址|发送到哪里)/
  ],
  calendar_create: [
    /(?:when|what time|which date|start time|end time|title).{0,40}\?/i,
    /(?:时间|日期|几点|什么时候|标题|持续多久|结束时间)/
  ],
  file_upload: [
    /(?:which file|file path|local path|where should i upload|destination).{0,40}\?/i,
    /(?:哪个文件|文件路径|上传到哪里|目标文件夹|网盘位置)/
  ],
  schedule_create: [
    /(?:when should i run|what time|how often|which trigger).{0,40}\?/i,
    /(?:几点|什么时候|多久一次|触发时间|频率)/
  ]
});

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/.test(String(value ?? ""));
}

export function isActionObligationGroup(group) {
  return ACTION_OBLIGATION_SET.has(group);
}

export function requiredActionObligationGroups(taskSpec = null) {
  const groups = Array.isArray(taskSpec?.success_contract?.required_policy_groups)
    ? taskSpec.success_contract.required_policy_groups
    : [];
  return [...new Set(groups.filter(isActionObligationGroup))];
}

function workflowIdOf(entry = {}) {
  return String(
    entry?.metadata?.workflow_id
      ?? entry?.args?.workflowId
      ?? entry?.args?.id
      ?? ""
  ).toLowerCase();
}

export function workflowMatchesActionGroup(group, entry = {}) {
  if (entry?.tool !== WORKFLOW_TOOL) return true;
  const id = workflowIdOf(entry);
  // Back-compat: the original email_send claim-guard verifier used
  // connector_workflow_run without workflow_id. Keep that accepted for email
  // only; calendar/file workflows must identify themselves because the shared
  // workflow tool now belongs to more than one action group.
  if (!id) return group === "email_send";
  if (group === "email_send") {
    return /(?:gmail|outlook|email|mail).*(?:send|draft)|draft_confirm_send|email\.draft/.test(id);
  }
  if (group === "calendar_create") {
    return /calendar.*(?:create|event)|calendar\.create|create_confirm/.test(id);
  }
  if (group === "file_upload") {
    return /(?:drive|onedrive|file).*(?:upload)|upload.*(?:drive|onedrive|file)/.test(id);
  }
  return false;
}

function isMemberEntryForGroup(group, entry = {}) {
  const members = toolsInGroup(group);
  if (!members.includes(entry?.tool)) return false;
  if (entry.tool === WORKFLOW_TOOL) return workflowMatchesActionGroup(group, entry);
  return true;
}

export function isSuccessfulActionHit(entry = {}) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.type !== "tool_result") return false;
  if (entry.success === false) return false;
  if (entry.error != null && entry.error !== "") return false;
  const result = entry.result;
  if (result && typeof result === "object") {
    if (result.success === false) return false;
    if (result.error != null && result.error !== "") return false;
  }
  return true;
}

export function actionGroupHitSatisfies(group, entry = {}) {
  if (!isActionObligationGroup(group)) return false;
  if (!isMemberEntryForGroup(group, entry)) return false;
  if (!isSuccessfulActionHit(entry)) return false;
  if (entry.tool === WORKFLOW_TOOL) {
    return entry?.metadata?.connector_status === "success"
      && workflowMatchesActionGroup(group, entry);
  }
  return true;
}

function approvalPayloadFromEntry(entry = {}) {
  const metadata = entry.metadata ?? {};
  const approval = metadata.approval && typeof metadata.approval === "object"
    ? metadata.approval
    : null;
  const approvalId = approval?.approval_id
    ?? metadata.approval_id
    ?? entry.approval_id
    ?? null;
  if (approval) return approval;
  if (approvalId) return { approval_id: approvalId };
  return null;
}

export function actionGroupEntryWaitingApproval(group, entry = {}) {
  if (!isActionObligationGroup(group)) return null;
  if (!isMemberEntryForGroup(group, entry)) return null;
  if (entry?.type === "pending_approval") {
    return {
      group,
      tool: entry.tool,
      approval: approvalPayloadFromEntry(entry),
      entry
    };
  }
  if (entry?.type !== "tool_result") return null;
  const waiting = entry?.metadata?.waiting_approval === true
    || entry?.metadata?.connector_status === "waiting_external_decision";
  if (!waiting) return null;
  return {
    group,
    tool: entry.tool,
    approval: approvalPayloadFromEntry(entry),
    entry
  };
}

function stringifyReasonPart(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function reasonText(entry = {}) {
  return [
    entry.error,
    entry.reason,
    entry.observation,
    entry.result?.error,
    entry.result?.observation,
    entry.metadata?.error,
    entry.metadata?.errorCode,
    entry.metadata?.connector_status,
    entry.metadata?.validation
  ].map(stringifyReasonPart).filter(Boolean).join(" ").slice(0, 600);
}

function isMissingInputEntry(group, entry = {}) {
  const text = reasonText(entry);
  if (!text) return entry?.type === "validation_error";
  if (entry?.type === "validation_error") return true;
  return (MISSING_INPUT_PATTERNS[group] ?? []).some((pattern) => pattern.test(text));
}

function finalTextAsksForMissingInput(group, finalText = "") {
  const text = String(finalText ?? "").trim();
  if (!text) return false;
  const asks = /[?？]\s*$/.test(text)
    || /\b(?:please provide|i need|could you provide|which|what|when|where)\b/i.test(text)
    || /(?:请提供|需要你|请告诉我|缺少|未提供|无法确定|需要确认)/.test(text);
  if (!asks) return false;
  return (FINAL_CLARIFICATION_PATTERNS[group] ?? []).some((pattern) => pattern.test(text));
}

function callsForGroup(group, transcript = []) {
  return (transcript ?? []).filter((entry) =>
    ["tool_result", "pending_approval", "tool_denied", "validation_error"].includes(entry?.type)
    && isMemberEntryForGroup(group, entry)
  );
}

export function evaluateActionObligations(taskSpec = null, transcript = [], options = {}) {
  const requiredGroups = requiredActionObligationGroups(taskSpec);
  return requiredGroups.map((group) => {
    const members = toolsInGroup(group);
    const calls = callsForGroup(group, transcript);
    const satisfied = calls.find((entry) => actionGroupHitSatisfies(group, entry));
    if (satisfied) {
      return {
        group,
        status: "satisfied",
        members,
        calls,
        tool: satisfied.tool,
        reason: `${GROUP_LABELS[group] ?? group} completed by ${satisfied.tool}.`
      };
    }

    const waiting = calls.map((entry) => actionGroupEntryWaitingApproval(group, entry)).find(Boolean);
    if (waiting) {
      return {
        group,
        status: "waiting_approval",
        members,
        calls,
        tool: waiting.tool,
        approval: waiting.approval,
        reason: `${GROUP_LABELS[group] ?? group} is waiting for user approval.`
      };
    }

    if (calls.length === 0) {
      if (Array.isArray(options.availableToolIds)) {
        const available = new Set(options.availableToolIds.filter(Boolean));
        const anyAvailable = members.some((member) => available.has(member));
        if (!anyAvailable) {
          return {
            group,
            status: "abandoned_with_reason",
            members,
            calls,
            reason: `No available tool can satisfy ${GROUP_LABELS[group] ?? group}.`
          };
        }
      }
      if (finalTextAsksForMissingInput(group, options.finalText)) {
        return {
          group,
          status: "blocked_missing_input",
          members,
          calls,
          reason: `Planner asked for missing ${GROUP_LABELS[group] ?? group} input.`
        };
      }
      return {
        group,
        status: "pending",
        members,
        calls,
        reason: `${GROUP_LABELS[group] ?? group} has not been attempted.`
      };
    }

    const missingInput = calls.find((entry) => isMissingInputEntry(group, entry));
    if (missingInput) {
      return {
        group,
        status: "blocked_missing_input",
        members,
        calls,
        tool: missingInput.tool,
        reason: reasonText(missingInput) || `Missing required ${GROUP_LABELS[group] ?? group} input.`
      };
    }

    const userDenied = calls.find((entry) =>
      entry?.type === "tool_denied"
      || /user[_\s-]?denied|rejected|拒绝|取消/.test(reasonText(entry))
    );
    const last = calls[calls.length - 1];
    return {
      group,
      status: "abandoned_with_reason",
      members,
      calls,
      tool: userDenied?.tool ?? last?.tool,
      reason: userDenied
        ? (reasonText(userDenied) || "The user rejected or denied the action.")
        : (reasonText(last) || `${GROUP_LABELS[group] ?? group} could not be completed with the available tool/connector.`)
    };
  });
}

export function actionObligationsAllowFinal(obligations = []) {
  return (obligations ?? []).every((obligation) => obligation?.status !== "pending");
}

export function actionObligationsWithStatus(obligations = [], statuses = []) {
  const wanted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  return (obligations ?? []).filter((obligation) => wanted.has(obligation?.status));
}

export function findWaitingActionApproval(obligations = []) {
  return (obligations ?? []).find((obligation) => obligation?.status === "waiting_approval") ?? null;
}

export function findWaitingActionApprovalInTranscript(transcript = []) {
  for (const group of ACTION_OBLIGATION_GROUPS) {
    for (const entry of transcript ?? []) {
      const waiting = actionGroupEntryWaitingApproval(group, entry);
      if (waiting) {
        return {
          group,
          status: "waiting_approval",
          members: toolsInGroup(group),
          calls: [entry],
          tool: waiting.tool,
          approval: waiting.approval,
          reason: `${GROUP_LABELS[group] ?? group} is waiting for user approval.`
        };
      }
    }
  }
  return null;
}

export function buildActionObligationGuidance(obligations = []) {
  const actionable = (obligations ?? []).filter((obligation) =>
    obligation
    && isActionObligationGroup(obligation.group)
    && obligation.status === "pending"
  );
  if (actionable.length === 0) return "";
  const lines = [
    "Required action obligations are still pending. Do not finalize yet.",
    "Call a satisfying tool/workflow for each pending group, or ask one concise clarifying question only if a required argument is truly missing."
  ];
  for (const obligation of actionable) {
    const members = obligation.members?.length
      ? obligation.members
      : toolsInGroup(obligation.group);
    lines.push(`- ${obligation.group}: call one of ${members.join(", ")}.`);
    lines.push(`  ${GROUP_HINTS[obligation.group] ?? "Use the tool result, not prose, to satisfy this obligation."}`);
  }
  return lines.join("\n");
}

export function buildActionObligationPrompt(taskSpec = null, transcript = []) {
  const obligations = evaluateActionObligations(taskSpec, transcript);
  const pending = actionObligationsWithStatus(obligations, ["pending"]);
  if (pending.length === 0) return "";
  return [
    "",
    "Action obligation state:",
    buildActionObligationGuidance(pending)
  ].join("\n");
}

export function formatWaitingActionFinal({ task = null, obligation = null } = {}) {
  const group = obligation?.group ?? "action";
  const approvalId = obligation?.approval?.approval_id ?? "";
  const zh = hasCjk(task?.user_command ?? "");
  if (zh) {
    const noun = group === "email_send"
      ? "邮件发送"
      : group === "calendar_create"
        ? "日程创建"
        : group === "file_upload"
          ? "文件上传"
          : group === "schedule_create"
            ? "定时任务创建"
            : "操作";
    return [
      `${noun}已经生成待确认操作，但还没有真正执行完成。`,
      approvalId ? `待确认 ID：${approvalId}` : null,
      "请在桌面的确认卡片中批准或拒绝；批准后系统会继续执行原工具/工作流。"
    ].filter(Boolean).join("\n");
  }
  const noun = group === "email_send"
    ? "email send"
    : group === "calendar_create"
      ? "calendar event creation"
      : group === "file_upload"
        ? "file upload"
        : group === "schedule_create"
          ? "scheduled task creation"
          : "action";
  return [
    `The ${noun} is waiting for confirmation and has not completed yet.`,
    approvalId ? `Pending approval ID: ${approvalId}` : null,
    "Approve or reject the desktop confirmation card; approval will resume the original tool/workflow."
  ].filter(Boolean).join("\n");
}
