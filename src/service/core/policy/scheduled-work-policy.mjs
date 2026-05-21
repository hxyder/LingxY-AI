import { normalizeEmailFieldInput } from "./email-fields.mjs";

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/u;
const URL_PATTERN = /https?:\/\/|www\./iu;
const TOOL_OR_PROMPT_PATTERN = /(?:connector_workflow_run|fetch_url_content|account_send_email|draft_confirm_send|userCommand|contextText|请使用|调用|params|workflowId|https?:\/\/)/iu;
const SCHEDULE_PREFIX_PATTERN = /^(?:scheduled(?:\s+run)?|计划任务|定时任务)\s*[:：-]/iu;
const WEATHER_PATTERN = /(?:weather|forecast|wttr|temperature|humidity|sunrise|sunset|天气|预报|温度|湿度|日出|日落)/iu;
const MARKET_PATTERN = /(?:stock|market|finance|nasdaq|dow|s&p|sp500|marketwatch|yahoo\s+finance|股市|股票|美股|标普|纳斯达克|道琼斯|财经|市场)/iu;
const NEWS_PATTERN = /(?:news|digest|brief|summary|roundup|新闻|简报|汇总|摘要)/iu;
const EMAIL_SEND_PATTERN = /(?:send|email|mail|gmail|outlook|发送|发邮件|邮件|邮箱|收件人|@)/iu;
const REMINDER_PATTERN = /(?:remind|reminder|notify|alert|提醒|待办|通知)/iu;
const EMAIL_BODY_ENVELOPE_HEADER_RE = /^\s*(?:#{1,6}\s*)?(?:[*_`]{0,2})\s*(?:subject|to|cc|bcc|from|主题|收件人|抄送|密送|发件人)\s*(?:[*_`]{0,2})\s*[:：]/iu;
const EMAIL_BODY_COMPOSER_SCAFFOLD_RE = /^\s*(?:#{1,6}\s*)?(?:[*_`]{0,2})\s*(?:(?:(?:以下|下面|这是|这里是|以下为|下面为)\s*)?(?:是|为)?\s*(?:整理(?:后|好的)?的?\s*)?(?:邮件\s*)?(?:正文|邮件正文)(?:内容)?(?:\s*[，,]\s*(?:可直接发送|供(?:你|您)?发送|用于发送))?|(?:here(?:'s|\s+is)\s+(?:the\s+)?(?:email|message)\s+body(?:\s+to\s+send)?)|(?:(?:email|message)\s+body|body\s+content)(?:\s+(?:below|to\s+send))?)\s*(?:[:：])?\s*(?:[*_`]{0,2})\s*$/iu;
const EMAIL_BODY_LEADING_DIVIDER_RE = /^\s*[-*_]{3,}\s*$/u;
const PLACEHOLDER_SIGNATURE_RE = /^\s*\[(?:您的助手|你的助手|your assistant|assistant|name|姓名)[^\]]*\]\s*$/ium;

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function collectText(input = {}) {
  const action = input.action ?? {};
  const params = action.params ?? action.args ?? input.action_params ?? {};
  const trigger = input.trigger ?? input.trigger_config ?? {};
  return [
    input.name,
    input.description,
    input.category,
    action.type ?? input.action_type,
    action.target ?? action.tool ?? input.action_target,
    params.userCommand,
    params.command,
    params.contextText,
    params.message,
    params.body,
    trigger.natural_language,
    trigger.expression,
    input.metadata?.side_effect_contract ? JSON.stringify(input.metadata.side_effect_contract) : ""
  ].map(compactText).filter(Boolean).join("\n");
}

function hasEmailContract(input = {}) {
  return Boolean(input.metadata?.side_effect_contract?.groups?.email_send);
}

export function isPromptLikeTitle(value = "") {
  const text = compactText(value);
  if (!text) return false;
  if (SCHEDULE_PREFIX_PATTERN.test(text)) return true;
  if (EMAIL_PATTERN.test(text) || URL_PATTERN.test(text) || TOOL_OR_PROMPT_PATTERN.test(text)) return true;
  if (text.length > 56 && /[，。；、,;]|(?:然后|包括|整理|发送|获取|收集|please|then|including)/iu.test(text)) return true;
  if (text.length > 80) return true;
  return false;
}

export function isNormalScheduleTitle(value = "") {
  const text = compactText(value);
  if (!text || text.length > 48) return false;
  return !isPromptLikeTitle(text);
}

function recurrencePrefix(input = {}) {
  const trigger = input.trigger ?? input.trigger_config ?? {};
  const triggerType = trigger.type ?? trigger.kind ?? input.trigger_type;
  const expression = compactText(trigger.expression);
  if (triggerType === "cron") {
    const parts = expression.split(/\s+/);
    if (parts.length >= 5) {
      if (parts[2] === "*" && parts[3] === "*" && parts[4] === "*") return "每日";
      if (parts[2] === "*" && parts[3] === "*" && parts[4] !== "*") return "每周";
      if (parts[2] !== "*" && parts[3] === "*") return "每月";
    }
    return "定时";
  }
  if (triggerType === "interval") return "定时";
  if (triggerType === "at") return "";
  return "定时";
}

export function classifyScheduledWork(input = {}) {
  const text = collectText(input);
  const email = hasEmailContract(input) || EMAIL_SEND_PATTERN.test(text);
  const weather = WEATHER_PATTERN.test(text);
  const market = MARKET_PATTERN.test(text);
  const news = NEWS_PATTERN.test(text);
  const reminder = input.user_todo === true
    || input.userTodo === true
    || input.category === "reminder"
    || REMINDER_PATTERN.test(text);

  if (email && weather) return "weather_email";
  if (email && market) return "market_email";
  if (email && news) return "news_email";
  if (email) return "email";
  if (reminder) return "reminder";
  if (weather) return "weather";
  if (market || news) return "digest";
  return "task";
}

function baseTitleForCategory(category) {
  switch (category) {
    case "weather_email": return "天气邮件";
    case "market_email": return "美股简报邮件";
    case "news_email": return "新闻简报邮件";
    case "email": return "定时邮件";
    case "reminder": return "定时提醒";
    case "weather": return "天气任务";
    case "digest": return "信息简报";
    default: return "定时任务";
  }
}

export function deriveScheduleTitle(input = {}) {
  const direct = compactText(input.name);
  const category = classifyScheduledWork(input);
  const prefix = recurrencePrefix(input);
  if (isNormalScheduleTitle(direct)) {
    return {
      title: direct,
      category,
      audit: {
        selected_source: "input.name",
        title_policy: "normal_user_title",
        rejected_candidates: []
      }
    };
  }

  const base = baseTitleForCategory(category);
  const title = prefix && !base.startsWith(prefix) ? `${prefix}${base}` : base;
  return {
    title,
    category,
    audit: {
      selected_source: `derived.${category}`,
      title_policy: "structured_schedule_title",
      rejected_candidates: direct ? [{ source: "input.name", value: direct, reason: "prompt_like_or_unsafe" }] : []
    }
  };
}

export function scheduleRecordToTitleInput(schedule = {}) {
  return {
    name: schedule.name,
    description: schedule.description,
    category: schedule.category,
    user_todo: schedule.user_todo,
    trigger: {
      type: schedule.trigger_type,
      ...(schedule.trigger_config ?? {})
    },
    action: {
      type: schedule.action_type,
      target: schedule.action_target,
      params: schedule.action_params ?? {}
    },
    metadata: schedule.metadata ?? {}
  };
}

export function normalizeScheduleRecordTitle(schedule = {}) {
  const derived = deriveScheduleTitle(scheduleRecordToTitleInput(schedule));
  const current = compactText(schedule.name);
  const shouldReplace = !current || isPromptLikeTitle(current) || current !== derived.title && !isNormalScheduleTitle(current);
  if (!shouldReplace) {
    return { changed: false, schedule, derived };
  }
  const metadata = {
    ...(schedule.metadata ?? {}),
    naming_audit: {
      ...(schedule.metadata?.naming_audit ?? {}),
      ...derived.audit,
      previous_name: current || null
    }
  };
  return {
    changed: true,
    schedule: {
      ...schedule,
      name: derived.title,
      metadata,
      updated_at: new Date().toISOString()
    },
    derived
  };
}

export function deriveScheduledEmailSubject({ task = null, args = {}, workflowId = "" } = {}) {
  const metadata = task?.context_packet?.selection_metadata ?? {};
  if (metadata.scheduled_task_fire !== true) return args?.subject;
  const existing = compactText(args?.subject);
  if (existing && !isPromptLikeTitle(existing)) return existing;
  const input = {
    name: metadata.schedule_name,
    description: metadata.schedule_description,
    action: {
      target: metadata.schedule_action_target,
      params: {
        userCommand: task?.user_command,
        contextText: task?.context_packet?.text
      }
    },
    metadata: {
      side_effect_contract: metadata.side_effect_contract
    }
  };
  const category = classifyScheduledWork(input);
  if (category === "weather_email") return "今日天气简报";
  if (category === "market_email") return "美股市场简报";
  if (category === "news_email") return "新闻简报";
  if (workflowId || category === "email") return "LingxY 定时邮件";
  return "LingxY 定时任务";
}

export function hasEmailBodyComposerScaffold(value = "") {
  const lines = String(value ?? "").replace(/\r\n/g, "\n").split("\n");
  return lines
    .slice(0, 8)
    .some((line) => EMAIL_BODY_COMPOSER_SCAFFOLD_RE.test(line));
}

function stripEmailBodyComposerScaffold(lines = []) {
  const output = [...lines];
  let removed = false;
  for (let guard = 0; guard < 3; guard += 1) {
    const index = output.findIndex((line) => String(line ?? "").trim());
    if (index < 0 || index > 3 || !EMAIL_BODY_COMPOSER_SCAFFOLD_RE.test(output[index])) break;
    output.splice(index, 1);
    removed = true;
  }
  if (!removed) return output;

  while (output.length > 0 && !String(output[0] ?? "").trim()) output.shift();
  if (EMAIL_BODY_LEADING_DIVIDER_RE.test(output[0] ?? "")) {
    output.shift();
    while (output.length > 0 && !String(output[0] ?? "").trim()) output.shift();
  }
  return output;
}

export function normalizeEmailBodyPlainText(value = "") {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const lines = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (index < 12 && EMAIL_BODY_ENVELOPE_HEADER_RE.test(line)) continue;
    lines.push(line);
  }

  return stripEmailBodyComposerScaffold(lines).join("\n")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/giu, "$1 ($2)")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/^\s*[-*_]{3,}\s*$/gmu, "----------------")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(PLACEHOLDER_SIGNATURE_RE, "LingxY")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function normalizeScheduledEmailArgs({ toolId, args = {}, task = null } = {}) {
  if (!args || typeof args !== "object") return args;
  const metadata = task?.context_packet?.selection_metadata ?? {};
  if (metadata.scheduled_task_fire !== true) return args;
  if (toolId === "connector_workflow_run") {
    const workflowId = String(args.workflowId ?? args.workflow_id ?? args.id ?? "");
    const input = normalizeEmailFieldInput(args.input ?? {});
    return {
      ...args,
      input: {
        ...input,
        subject: deriveScheduledEmailSubject({ task, args: input, workflowId }),
        body: normalizeEmailBodyPlainText(input.body)
      }
    };
  }
  if (toolId === "account_send_email" || toolId === "send_email_smtp") {
    const normalized = normalizeEmailFieldInput(args);
    return {
      ...normalized,
      subject: deriveScheduledEmailSubject({ task, args: normalized }),
      body: normalizeEmailBodyPlainText(normalized.body)
    };
  }
  return args;
}
