import { toolsInGroup } from "./policy-groups.mjs";

const EMAIL_ADDRESS_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const WINDOWS_PATH_REGEX = /[A-Za-z]:\\(?:[^<>:"|?*\r\n]+\\)*[^<>:"|?*\r\n]+/g;
const POSIX_PATH_REGEX = /(?:^|\s)(\/(?:[^\s"'<>|]+\/)*[^\s"'<>|]+)/g;

const EMAIL_WORKFLOW_PATTERN = /(?:gmail|outlook|email|mail).*(?:send|draft)|draft_confirm_send|email\.draft/i;
const CALENDAR_WORKFLOW_PATTERN = /(?:calendar|caldav|event).*(?:create|add)|create_event/i;
const FILE_UPLOAD_WORKFLOW_PATTERN = /(?:drive|onedrive|file).*(?:upload|save)|upload_file/i;

const EMAIL_SEND_INTENT_PATTERNS = [
  /(?:发送|发出|发一封|发封|寄|转发|send|email|mail|forward).{0,40}(?:邮件|邮箱|email|mail|@)/i,
  /(?:邮件|邮箱|email|mail).{0,40}(?:发送|发出|寄出|send|to\b)/i,
  /(?:发送给|发给|寄给|转发给|send\s+(?:it|this|them|.+?)\s+to|forward\s+(?:it|this|them|.+?)\s+to).{0,80}@/i
];

const CALENDAR_CREATE_INTENT_PATTERNS = [
  /(?:安排|预约|创建|新建|添加|加到|加入|放到|排).{0,40}(?:会议|会面|日程|日历|约会|meeting|event|appointment|calendar)/i,
  /(?:schedule|book|set\s+up|create|add).{0,40}(?:meeting|event|appointment|calendar)/i
];

const FILE_UPLOAD_INTENT_PATTERNS = [
  /(?:上传|上载|传到|保存到|放到|同步到|分享到).{0,50}(?:drive|onedrive|网盘|云端|云盘|文件|附件|folder|shared\s+drive)/i,
  /(?:upload|save|sync|put|share).{0,60}(?:drive|onedrive|cloud|folder|file|attachment)/i
];
const INSTRUCTIONAL_QUERY_PATTERN = /(?:怎么|如何|怎样|教程|指南|示例|解释一下|介绍一下|how\s+to|how\s+do\s+i|how\s+can\s+i|can\s+you\s+explain|what\s+is)/i;

function unique(values = [], keyFn = (value) => String(value).toLowerCase()) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const key = keyFn(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function extractEmails(text = "") {
  return String(text ?? "").match(EMAIL_ADDRESS_REGEX) ?? [];
}

function extractPaths(text = "") {
  const value = String(text ?? "");
  const windows = value.match(WINDOWS_PATH_REGEX) ?? [];
  const posix = [...value.matchAll(POSIX_PATH_REGEX)].map((match) => match[1]);
  return [...windows, ...posix];
}

function connectedAccountEmails(runtime = null) {
  try {
    return unique((runtime?.store?.listConnectedAccounts?.() ?? [])
      .map((account) => account?.email)
      .filter(Boolean));
  } catch {
    return [];
  }
}

function textSourcesFromTask(task = null) {
  return [
    task?.user_command,
    task?.task_spec?.user_goal_text,
    task?.task_spec_initial?.user_goal_text,
    task?.context_packet?.text,
    task?.context_packet?.selection_metadata?.schedule_name,
    task?.context_packet?.selection_metadata?.schedule_description,
    task?.context_packet?.selection_metadata?.schedule_action_target
  ].filter((value) => typeof value === "string" && value.trim());
}

function contractFromTask(task = null) {
  const direct = task?.context_packet?.selection_metadata?.side_effect_contract
    ?? task?.task_spec?.side_effect_contract
    ?? task?.task_spec_initial?.side_effect_contract
    ?? null;
  return direct && typeof direct === "object" ? direct : null;
}

function groupsFromTask(task = null) {
  return unique([
    ...(task?.task_spec?.success_contract?.required_policy_groups ?? []),
    ...(task?.task_spec_initial?.success_contract?.required_policy_groups ?? []),
    ...Object.keys(contractFromTask(task)?.groups ?? {})
  ]);
}

export const SIDE_EFFECT_CONTRACT_REGISTRY = Object.freeze({
  email_send: {
    intent: {
      patterns: EMAIL_SEND_INTENT_PATTERNS,
      requiredEntities: [{ kind: "email_address", excludeRoles: ["account_identity"] }]
    },
    slots: {
      to: {
        entity: "email_address",
        excludeRoles: ["account_identity"],
        cardinality: "many",
        targets: [
          { policyGroup: "email_send", excludeToolIds: ["connector_workflow_run"], path: ["to"] },
          { toolIds: ["connector_workflow_run"], workflowPattern: EMAIL_WORKFLOW_PATTERN, path: ["input", "to"] }
        ]
      }
    }
  },
  calendar_create: {
    intent: {
      patterns: CALENDAR_CREATE_INTENT_PATTERNS
    },
    slots: {
      attendees: {
        entity: "email_address",
        excludeRoles: ["account_identity"],
        cardinality: "many",
        targets: [
          { policyGroup: "calendar_create", excludeToolIds: ["connector_workflow_run"], path: ["attendees"] },
          { toolIds: ["connector_workflow_run"], workflowPattern: CALENDAR_WORKFLOW_PATTERN, path: ["input", "attendees"] }
        ]
      }
    }
  },
  file_upload: {
    intent: {
      patterns: FILE_UPLOAD_INTENT_PATTERNS,
      requiredEntities: [{ kind: "file_path" }]
    },
    slots: {
      localPath: {
        entity: "file_path",
        cardinality: "one",
        targets: [
          { policyGroup: "file_upload", path: ["localPath"], mode: "fill_if_missing" },
          { toolIds: ["connector_workflow_run"], workflowPattern: FILE_UPLOAD_WORKFLOW_PATTERN, path: ["input", "localPath"], mode: "fill_if_missing" }
        ]
      }
    }
  }
});

export function extractSideEffectEntities({ task = null, runtime = null, sources = [] } = {}) {
  const textSources = unique([
    ...textSourcesFromTask(task),
    ...sources.filter((value) => typeof value === "string")
  ]);
  const accountEmails = new Set(connectedAccountEmails(runtime).map((email) => email.toLowerCase()));
  const entities = [];

  for (const source of textSources) {
    for (const email of extractEmails(source)) {
      const roles = accountEmails.has(email.toLowerCase())
        ? ["account_identity"]
        : ["external_identity"];
      entities.push({ kind: "email_address", value: email, roles, source: "text" });
    }
    for (const filePath of extractPaths(source)) {
      entities.push({ kind: "file_path", value: filePath, roles: ["local_file"], source: "text" });
    }
  }

  for (const filePath of task?.context_packet?.file_paths ?? []) {
    entities.push({ kind: "file_path", value: filePath, roles: ["local_file", "attached_file"], source: "context_packet.file_paths" });
  }

  return unique(entities, (entity) => `${entity.kind}:${String(entity.value).toLowerCase()}:${entity.roles.join(",")}`);
}

function sideEffectTextSources({ task = null, sources = [] } = {}) {
  return unique([
    ...textSourcesFromTask(task),
    ...sources.filter((value) => typeof value === "string")
  ]);
}

function hasRequiredEntities(intentSpec = {}, entities = []) {
  const required = intentSpec.requiredEntities ?? [];
  if (required.length === 0) return true;
  return required.every((requirement) => {
    const excluded = new Set(requirement.excludeRoles ?? []);
    return entities.some((entity) => {
      if (entity.kind !== requirement.kind) return false;
      return !entity.roles?.some((role) => excluded.has(role));
    });
  });
}

function intentMatches(groupSpec, textSources = [], entities = []) {
  const haystack = textSources.join("\n");
  if (!haystack.trim()) return false;
  if (INSTRUCTIONAL_QUERY_PATTERN.test(haystack)) return false;
  if (!hasRequiredEntities(groupSpec.intent, entities)) return false;
  return (groupSpec.intent?.patterns ?? []).some((pattern) => pattern.test(haystack));
}

export function inferSideEffectPolicyGroups({
  task = null,
  runtime = null,
  sources = [],
  existingContract = null
} = {}) {
  const contract = existingContract && typeof existingContract === "object"
    ? existingContract
    : contractFromTask(task);
  const contractGroups = Object.keys(contract?.groups ?? {})
    .filter((group) => SIDE_EFFECT_CONTRACT_REGISTRY[group]);
  const textSources = sideEffectTextSources({ task, sources });
  const entities = extractSideEffectEntities({ task, runtime, sources });
  const inferred = [];

  for (const [group, groupSpec] of Object.entries(SIDE_EFFECT_CONTRACT_REGISTRY)) {
    if (contractGroups.includes(group) || intentMatches(groupSpec, textSources, entities)) {
      inferred.push(group);
    }
  }

  return unique([...contractGroups, ...inferred]);
}

function valuesForSlot(entities, slotSpec) {
  const excluded = new Set(slotSpec.excludeRoles ?? []);
  const values = entities
    .filter((entity) => entity.kind === slotSpec.entity)
    .filter((entity) => !entity.roles?.some((role) => excluded.has(role)))
    .map((entity) => entity.value);
  const deduped = unique(values);
  return slotSpec.cardinality === "one" ? deduped.slice(0, 1) : deduped;
}

export function buildSideEffectContract({
  policyGroups = [],
  task = null,
  runtime = null,
  sources = [],
  existingContract = null,
  inferPolicyGroups = false,
  includeEntityValues = true,
  useExistingValues = true
} = {}) {
  const inferredPolicyGroups = inferPolicyGroups
    ? inferSideEffectPolicyGroups({ task, runtime, sources, existingContract })
    : [];
  const requestedGroups = unique([
    ...policyGroups,
    ...inferredPolicyGroups,
    ...groupsFromTask(task),
    ...Object.keys(existingContract?.groups ?? {})
  ]).filter((group) => SIDE_EFFECT_CONTRACT_REGISTRY[group]);
  if (requestedGroups.length === 0) return existingContract ?? null;

  const entities = includeEntityValues
    ? extractSideEffectEntities({ task, runtime, sources })
    : [];
  const groups = {};
  for (const group of requestedGroups) {
    const spec = SIDE_EFFECT_CONTRACT_REGISTRY[group];
    const slots = {};
    for (const [slotName, slotSpec] of Object.entries(spec.slots ?? {})) {
      const previous = useExistingValues
        ? (existingContract?.groups?.[group]?.slots?.[slotName]?.values ?? [])
        : [];
      const values = unique([...previous, ...valuesForSlot(entities, slotSpec)]);
      if (values.length > 0) {
        slots[slotName] = {
          entity: slotSpec.entity,
          values,
          mode: slotSpec.mode ?? "preserve"
        };
      }
    }
    if (Object.keys(slots).length > 0) groups[group] = { slots };
  }

  if (Object.keys(groups).length === 0) return existingContract ?? null;
  return {
    version: 1,
    kind: "side_effect_contract",
    groups
  };
}

function getAtPath(object, path = []) {
  return path.reduce((cursor, key) => cursor?.[key], object);
}

function setAtPath(object, path = [], value) {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  return {
    ...(object ?? {}),
    [head]: setAtPath(object?.[head], tail, value)
  };
}

function normalizeSlotValues(value, entityKind) {
  if (entityKind === "email_address") {
    return unique(Array.isArray(value) ? value.flatMap(extractEmails) : extractEmails(value));
  }
  if (entityKind === "file_path") {
    return unique(Array.isArray(value) ? value : [value]).filter(Boolean);
  }
  return unique(Array.isArray(value) ? value : [value]);
}

function mergeSlotValue(existingValue, contractValues, slotSpec, targetSpec) {
  const existing = normalizeSlotValues(existingValue, slotSpec.entity);
  if (targetSpec.mode === "fill_if_missing" || slotSpec.cardinality === "one") {
    return existing.length > 0 ? existingValue : contractValues[0];
  }
  return unique([...existing, ...contractValues]);
}

function workflowIdFromArgs(args = {}) {
  return String(args.workflowId ?? args.workflow_id ?? args.id ?? "");
}

function toolIdsForTarget(targetSpec) {
  return unique([
    ...(targetSpec.toolIds ?? []),
    ...(targetSpec.policyGroup ? toolsInGroup(targetSpec.policyGroup) : [])
  ]);
}

function targetMatches(targetSpec, toolId, args = {}) {
  if (!toolIdsForTarget(targetSpec).includes(toolId)) return false;
  if (targetSpec.excludeToolIds?.includes(toolId)) return false;
  if (toolId !== "connector_workflow_run") return true;
  if (!targetSpec.workflowPattern) return true;
  return targetSpec.workflowPattern.test(workflowIdFromArgs(args));
}

function groupsForToolCall(toolId, args = {}) {
  const groups = [];
  for (const [group, groupSpec] of Object.entries(SIDE_EFFECT_CONTRACT_REGISTRY)) {
    for (const slotSpec of Object.values(groupSpec.slots ?? {})) {
      if ((slotSpec.targets ?? []).some((target) => targetMatches(target, toolId, args))) {
        groups.push(group);
        break;
      }
    }
  }
  return unique(groups);
}

export function policyGroupsForConnectorWorkflow(workflowId) {
  return groupsForToolCall("connector_workflow_run", { workflowId });
}

export function applySideEffectContractToToolArgs(toolId, args = {}, {
  task = null,
  runtime = null,
  contract = null
} = {}) {
  if (!args || typeof args !== "object") return args;
  const existingContract = contractFromTask(task) ?? contract;
  const activeContract = buildSideEffectContract({
    policyGroups: groupsForToolCall(toolId, args),
    task: existingContract ? null : task,
    runtime,
    existingContract,
    includeEntityValues: !existingContract
  });
  if (!activeContract?.groups) return args;

  let nextArgs = args;
  for (const [group, groupContract] of Object.entries(activeContract.groups)) {
    const groupSpec = SIDE_EFFECT_CONTRACT_REGISTRY[group];
    for (const [slotName, slotContract] of Object.entries(groupContract.slots ?? {})) {
      const slotSpec = groupSpec?.slots?.[slotName];
      if (!slotSpec) continue;
      for (const targetSpec of slotSpec.targets ?? []) {
        if (!targetMatches(targetSpec, toolId, nextArgs)) continue;
        const existingValue = getAtPath(nextArgs, targetSpec.path);
        const merged = mergeSlotValue(existingValue, slotContract.values ?? [], slotSpec, targetSpec);
        nextArgs = setAtPath(nextArgs, targetSpec.path, merged);
      }
    }
  }
  return nextArgs;
}

export function applySideEffectContractToWorkflowInput(workflowId, input = {}, context = {}) {
  return applySideEffectContractToToolArgs("connector_workflow_run", {
    workflowId,
    input
  }, context).input ?? input;
}

export function renderSideEffectContractPrompt(task = null) {
  const existing = contractFromTask(task);
  if (!existing) return "";
  const contract = buildSideEffectContract({
    existingContract: existing,
    includeEntityValues: false
  });
  if (!contract?.groups || Object.keys(contract.groups).length === 0) return "";
  const lines = ["", "Side-effect contract:"];
  for (const [group, groupContract] of Object.entries(contract.groups)) {
    for (const [slotName, slot] of Object.entries(groupContract.slots ?? {})) {
      lines.push(`- ${group}.${slotName}: ${(slot.values ?? []).join(", ")}`);
    }
  }
  lines.push("- Any tool/workflow satisfying a listed side-effect group must preserve these slot values unless the user explicitly edits/removes them in an approval card.");
  return lines.join("\n");
}
