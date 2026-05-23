const CONNECTOR_RESOURCE_PATTERN = /(邮件|邮箱|\bemails?\b|\bmail\b|gmail|outlook|日历|\bcalendar\b|google\s*calendar|google\s*drive|onedrive|云端文件|网盘|连接账户|连接的账户|已连接账户|账户|账号|connected\s+accounts?|[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i;
// UCA-179: the CONTEXT pattern previously only matched read-side verbs
// (list / recent / latest). A user saying "把这两个附件发给 alice@gmail.com"
// has "gmail" from the address (so RESOURCE matches) but no
// 我的/连接/列出/查看, so CONTEXT missed and the task collapsed into "qa"
// → fast executor → no tools → LLM drafts a fallback reply. Add the
// send/share/upload verb family so connector-write intents are kept in
// the connector domain and routed to the tool_using executor, where
// account_send_email + account_upload_file live.
const CONNECTOR_CONTEXT_PATTERN = /(我的|我连接|连接的|已连接|账户|账号|邮箱|邮件|日历|\bcalendar\b|gmail|outlook|google\s*drive|onedrive|云端文件|网盘|最近|最新|列出|查看|读取|具体|多少|哪个|发送|发给|寄|转发|分享|上传|\blist\b|\bshow\b|\bread\b|\brecent\b|\blatest\b|\bconnected\b|\bsend\b|\bmail\b|\bemail\b|\bforward\b|\bshare\b|\bupload\b)/i;
const CONNECTOR_IDENTITY_PATTERN = /(邮箱|邮件|gmail|outlook|google|microsoft|连接|已连接|connected).{0,20}(账户|账号|帐号|邮箱地址)|(?:账户|账号|帐号).{0,20}(邮箱|邮件|gmail|outlook|google|microsoft|连接|已连接|connected)|我的邮箱账号|我的邮箱账户|具体账户/i;
const CONNECTOR_SEARCH_TOPIC_PATTERN = /(新闻|资讯|动态|价格|股价|汇率|天气|航班|机票|酒店|\bnews\b|\bprice\b|\bstock\b|\bweather\b|\bflight\b|\bhotel\b)/i;
const TIME_CONTEXT_PATTERN = /(今天|明天|后天|今晚|上午|下午|中午|晚上|早上|下周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}\s*(?:点|时)(?:\s*\d{1,2}\s*分)?|\d{1,2}\s*[:：]\s*\d{2}|\b(?:today|tomorrow|tonight|morning|afternoon|evening|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}\s*(?:am|pm)\b)/i;
const SELF_AVAILABILITY_PATTERN = /(我|我的|俺|本人).{0,30}(有空|空闲|没空|忙不忙|有没有空|是否有空)|(?:\bam\s+I\b|\bI\s+am\b|\bI'm\b).{0,30}(?:available|availability|free|busy)|\bmy\s+(?:calendar|schedule|availability)\b.{0,30}(?:available|availability|free|busy)|(?:我有没有空|我是否有空|我明天.*有空|am\s+I\s+(?:free|available|busy))/i;
const CALENDAR_ACTION_PATTERN = /(安排|约|预约|创建|新建|加到|加入|放到|排).{0,30}(会议|会面|日程|日历|meeting|event|appointment)|(?:schedule|book|set\s+up|create|add).{0,30}(?:meeting|event|appointment)/i;
const CONDITIONAL_CALENDAR_ACTION_PATTERN = /(?:如果|if).{0,30}(?:有空|空闲|available|free).{0,50}(?:安排|约|预约|schedule|book|set\s+up|create|meeting|event|appointment)/i;

/**
 * Connector capability detection stays capability-oriented, not topical:
 * calendar availability checks and meeting scheduling imply access to a
 * connected calendar even when the user omits the literal word "日历".
 *
 * @param {string} value
 * @returns {{ matched: boolean, domain: "calendar"|null, capabilities: string[], operation: "read"|"write"|"read_write"|null, reason: string|null }}
 */
export function detectConnectorCapabilityIntent(value = "") {
  const text = String(value ?? "");
  if (!text.trim()) {
    return { matched: false, domain: null, capabilities: [], operation: null, reason: null };
  }

  const hasTimeContext = TIME_CONTEXT_PATTERN.test(text);
  const asksOwnAvailability = SELF_AVAILABILITY_PATTERN.test(text);
  const schedulesCalendarItem = CALENDAR_ACTION_PATTERN.test(text);
  const conditionallySchedules = CONDITIONAL_CALENDAR_ACTION_PATTERN.test(text);

  if ((asksOwnAvailability && hasTimeContext) || conditionallySchedules) {
    const capabilities = schedulesCalendarItem || conditionallySchedules
      ? ["calendarRead", "calendarWrite"]
      : ["calendarRead"];
    return {
      matched: true,
      domain: "calendar",
      capabilities,
      operation: capabilities.includes("calendarWrite") ? "read_write" : "read",
      reason: "calendar availability/scheduling capability implied by user-owned availability or meeting action"
    };
  }

  if (schedulesCalendarItem && hasTimeContext) {
    return {
      matched: true,
      domain: "calendar",
      capabilities: ["calendarWrite"],
      operation: "write",
      reason: "calendar scheduling action with time context"
    };
  }

  return { matched: false, domain: null, capabilities: [], operation: null, reason: null };
}

/**
 * Infer a coarse calendar query window from date/period words. This is only
 * used to scope connector read tools; it never decides whether the user needs
 * a connector by itself.
 *
 * @param {string} value
 * @param {Date} now
 * @returns {{ startTime: string, endTime: string } | null}
 */
export function inferCalendarTimeWindow(value = "", now = new Date()) {
  const text = String(value ?? "");
  if (!TIME_CONTEXT_PATTERN.test(text)) return null;

  let dayOffset = 0;
  if (/(后天|day\s+after\s+tomorrow)/i.test(text)) {
    dayOffset = 2;
  } else if (/(明天|tomorrow)/i.test(text)) {
    dayOffset = 1;
  } else if (/(下周|next\s+week)/i.test(text)) {
    dayOffset = 7;
  }

  let startHour = 0;
  let endHour = 24;
  if (/(早上|上午|morning)/i.test(text)) {
    startHour = 8;
    endHour = 12;
  } else if (/(下午|afternoon)/i.test(text)) {
    startHour = 13;
    endHour = 18;
  } else if (/(晚上|今晚|evening|tonight)/i.test(text)) {
    startHour = 18;
    endHour = 22;
  } else if (/(中午|noon)/i.test(text)) {
    startHour = 11;
    endHour = 14;
  }

  const start = new Date(now);
  start.setDate(start.getDate() + dayOffset);
  start.setHours(startHour, 0, 0, 0);

  const end = new Date(start);
  if (endHour === 24) {
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
  } else {
    end.setHours(endHour, 0, 0, 0);
  }

  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

export function isConnectorDomainRequest(value = "") {
  const text = String(value ?? "");
  if (detectConnectorCapabilityIntent(text).matched) return true;
  if (!CONNECTOR_RESOURCE_PATTERN.test(text)) return false;

  // "最新 Gmail 新闻" is a web/news request, while "我的 Gmail 最新邮件"
  // is a connector request. Anchor provider words to account/resource context.
  if (CONNECTOR_SEARCH_TOPIC_PATTERN.test(text) && !/(我的|连接|已连接|账户|账号|邮箱|邮件|日历|文件|drive|onedrive)/i.test(text)) {
    return false;
  }

  return CONNECTOR_CONTEXT_PATTERN.test(text);
}

export function isConnectorAccountIdentityRequest(value = "") {
  const text = String(value ?? "");
  return CONNECTOR_IDENTITY_PATTERN.test(text)
    || (isConnectorDomainRequest(text) && /(账户|账号|帐号|邮箱地址|具体账户|connected\s+accounts?)/i.test(text));
}

export function inferConnectorProvider(value = "") {
  const text = String(value ?? "");
  if (/(gmail|google|谷歌)/i.test(text)) return "google";
  if (/(outlook|microsoft|微软|onedrive)/i.test(text)) return "microsoft";
  return null;
}

export function inferConnectorLimit(value = "", fallback = 10) {
  const text = String(value ?? "");
  const arabic = text.match(/(\d{1,3})\s*(?:个|封|条|封邮件|emails?|messages?)/i);
  if (arabic) return Math.max(1, Math.min(100, Number(arabic[1])));
  if (/(三|three)/i.test(text)) return 3;
  if (/(五|five)/i.test(text)) return 5;
  if (/(十|ten)/i.test(text)) return 10;
  return fallback;
}

function triggerMatchesText(pattern = "", text = "") {
  if (!pattern) return false;
  const trimmed = String(pattern).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) {
    try {
      return new RegExp(trimmed.slice(1, -1), "i").test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Scan the connector catalog for a workflow whose triggerPatterns match the
 * user command. Returns the highest-priority match (first defined workflow
 * wins) or null. Preferring an explicit provider (if the text mentions one)
 * avoids Outlook triggers stealing Gmail phrasing and vice versa.
 */
export function matchWorkflowByTrigger(text = "", catalog = null) {
  if (!catalog || typeof catalog.listWorkflows !== "function") return null;
  const haystack = String(text ?? "");
  if (!haystack.trim()) return null;
  const preferred = inferConnectorProvider(haystack);
  const workflows = typeof catalog.getWorkflow === "function"
    ? catalog.listWorkflows().map((summary) => catalog.getWorkflow(summary.id)).filter(Boolean)
    : catalog.listWorkflows();
  const hits = [];
  for (const workflow of workflows) {
    const patterns = Array.isArray(workflow?.triggerPatterns) ? workflow.triggerPatterns : [];
    if (patterns.some((pattern) => triggerMatchesText(pattern, haystack))) {
      hits.push(workflow);
    }
  }
  if (hits.length === 0) return null;
  if (preferred) {
    const preferredHit = hits.find((workflow) => workflow?.provider === preferred);
    if (preferredHit) return preferredHit;
  }
  return hits[0];
}

const EMAIL_ADDRESS_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

/**
 * Very lightweight input extractor used by agent-loop when it decides to call
 * a connector workflow directly. We deliberately avoid hallucinating content:
 * if we can't pull a subject/body from the text we return empty strings and
 * let the workflow's nonempty_string validators fail loudly.
 */
export function extractWorkflowInput(text = "", workflow = null) {
  const value = String(text ?? "");
  const addresses = Array.from(new Set((value.match(EMAIL_ADDRESS_RE) ?? []).map((email) => email.toLowerCase())));
  const input = {};
  if (addresses.length > 0) {
    input.to = addresses;
  }

  const subjectMatch = value.match(/(?:主题|subject)\s*[：:]\s*(.*?)(?=\s*(?:正文|内容|body|标题|title)\s*[：:]|\n|$)/i);
  if (subjectMatch) {
    input.subject = subjectMatch[1].trim();
  }

  const bodyMatch = value.match(/(?:正文|内容|body)\s*[：:]\s*([\s\S]{1,2000})$/i);
  if (bodyMatch) {
    input.body = bodyMatch[1].trim();
  }

  const titleMatch = value.match(/(?:标题|title)\s*[：:]\s*(.*?)(?=\s*(?:正文|内容|body|主题|subject)\s*[：:]|\n|$)/i);
  if (titleMatch) {
    input.title = titleMatch[1].trim();
  }

  const limit = inferConnectorLimit(value, 0);
  if (limit > 0) {
    input.limit = limit;
  }

  if (workflow?.service?.endsWith(".calendar")) {
    const timeMatch = value.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
    if (timeMatch) {
      input.startTime = timeMatch[1];
    }
  }

  return input;
}
