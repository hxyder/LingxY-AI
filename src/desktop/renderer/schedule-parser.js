function getLocalTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildAtTrigger(date, labelPrefix = "at") {
  return {
    type: "at",
    run_at: date.toISOString(),
    timezone: getLocalTimezone(),
    oneShot: true,
    label: `${labelPrefix} ${date.toLocaleString("zh-CN", { hour12: false })}`
  };
}

function stripScheduleWords(text) {
  return text
    .replace(/(?:请)?(?:在|于)?\s*(?:今天|明天|后天|下周|这周|本周)?\s*(?:周|星期|礼拜)?[一二三四五六日天]?\s*(?:上午|下午|晚上|早上|中午|凌晨)?\s*\d{1,2}\s*(?:点|[:：.])\s*(?:半|\d{1,2}\s*分?)?/g, "")
    .replace(/\d+\s*(?:分钟|分|小时|天|minute|minutes|min|mins|hour|hours|day|days)\s*(?:以后|后|later|from now)/gi, "")
    .replace(/\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*(?:日|号)?/g, "")
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?/g, "")
    .replace(/提醒我|remind me|schedule|定时/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildScheduleActionFromText(commandText = "") {
  const lower = commandText.toLowerCase();
  const aiWorkPattern = /总结|分析|检查|生成|写|整理|翻译|改写|润色|搜索|汇总|复盘|审查|review|summarize|analyse|analyze|draft|write|translate|rewrite|check|search|generate|report/;
  const riskyPattern = /发送|删除|付款|购买|提交|改动|写入|覆盖|send|delete|purchase|pay|commit|push|modify|write\s+to/;
  if (!aiWorkPattern.test(lower)) {
    return {
      action: {
        type: "action_tool",
        target: "notify",
        params: {
          title: "UCA 提醒",
          body: commandText
        }
      },
      executionMode: "unattended_safe",
      kind: "notify"
    };
  }

  const userCommand = stripScheduleWords(commandText) || commandText;
  return {
    action: {
      type: "task",
      target: "context_task",
      params: {
        userCommand,
        contextText: commandText
      }
    },
    executionMode: riskyPattern.test(lower) ? "approval_required" : "unattended_safe",
    kind: "ai_task"
  };
}

function inferClockTime(text, fallbackHour = 9, fallbackMinute = 0) {
  const lower = text.toLowerCase();
  let hour = fallbackHour;
  let minute = fallbackMinute;
  let matched = false;

  const colonTime = lower.match(/(?:at\s*)?(\d{1,2})\s*[:：.]\s*(\d{1,2})(?:\s*(am|pm))?/i);
  if (colonTime) {
    hour = Number(colonTime[1]);
    minute = Number(colonTime[2]);
    matched = true;
    if (colonTime[3] === "pm" && hour < 12) hour += 12;
    if (colonTime[3] === "am" && hour === 12) hour = 0;
  }

  const chineseTime = lower.match(/(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?/);
  if (chineseTime) {
    hour = Number(chineseTime[1]);
    minute = chineseTime[2] === "半" ? 30 : Number(chineseTime[3] ?? 0);
    matched = true;
  }

  const isAfternoon = /下午|晚上|傍晚|pm/.test(lower);
  const isMorning = /凌晨|上午|早上|am/.test(lower);
  const isNoon = /中午/.test(lower);
  if (isAfternoon && hour < 12) hour += 12;
  if (isNoon && hour < 11) hour += 12;
  if (isMorning && hour === 12) hour = 0;

  return {
    hour: Math.min(Math.max(hour, 0), 23),
    minute: Math.min(Math.max(minute, 0), 59),
    matched
  };
}

function makeLocalDate(year, month, day, time) {
  return new Date(year, month - 1, day, time.hour, time.minute, 0, 0);
}

function ensureFuture(date, now = new Date(), unit = "day") {
  if (date.getTime() > now.getTime()) {
    return date;
  }
  const next = new Date(date);
  if (unit === "year") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function parseAbsoluteDateTrigger(text, now = new Date()) {
  const time = inferClockTime(text);
  const isoDate = text.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*(?:日|号)?/);
  if (isoDate) {
    const date = makeLocalDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]), time);
    return buildAtTrigger(date, "once");
  }

  const cnDate = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
  if (cnDate) {
    const date = makeLocalDate(now.getFullYear(), Number(cnDate[1]), Number(cnDate[2]), time);
    return buildAtTrigger(ensureFuture(date, now, "year"), "once");
  }

  const slashDate = text.match(/(?:^|\D)(\d{1,2})\s*\/\s*(\d{1,2})(?:\D|$)/);
  if (slashDate && !text.match(/\d{4}\s*\/\s*\d{1,2}\s*\/\s*\d{1,2}/)) {
    const date = makeLocalDate(now.getFullYear(), Number(slashDate[1]), Number(slashDate[2]), time);
    return buildAtTrigger(ensureFuture(date, now, "year"), "once");
  }

  return null;
}

function parseRelativeDateTrigger(text, now = new Date()) {
  const lower = text.toLowerCase();
  const relativeDay = lower.match(/(\d+)\s*(天|day|days)\s*(以后|后|later|from now)/i);
  if (relativeDay) {
    const seconds = Number(relativeDay[1]) * 24 * 60 * 60;
    return {
      type: "interval",
      seconds,
      oneShot: true,
      label: `${relativeDay[1]} days from now`
    };
  }

  let dayOffset = null;
  if (/后天|day after tomorrow/.test(lower)) dayOffset = 2;
  else if (/明天|tomorrow/.test(lower)) dayOffset = 1;
  else if (/今天|today/.test(lower)) dayOffset = 0;

  if (dayOffset !== null) {
    const time = inferClockTime(text);
    const base = addDays(now, dayOffset);
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), time.hour, time.minute, 0, 0);
    return buildAtTrigger(ensureFuture(date, now), "once");
  }

  return null;
}

function parseWeekdayTrigger(text, now = new Date()) {
  const match = text.match(/(下周|这周|本周)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
  if (!match) {
    return null;
  }

  const weekdayMap = new Map([
    ["日", 0],
    ["天", 0],
    ["一", 1],
    ["二", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6]
  ]);
  const target = weekdayMap.get(match[2]);
  const current = now.getDay();
  let daysAhead = (target - current + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  if (match[1] === "下周" && current < target) daysAhead += 7;

  const time = inferClockTime(text);
  const base = addDays(now, daysAhead);
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), time.hour, time.minute, 0, 0);
  return buildAtTrigger(date, "once");
}

function parseOneShotTrigger(text) {
  const lower = text.toLowerCase();
  const relativeMinute = lower.match(/(\d+)\s*(分钟|分|minute|minutes|min|mins)\s*(以后|后|later|from now)/i);
  if (relativeMinute) {
    return {
      type: "interval",
      seconds: Number(relativeMinute[1]) * 60,
      oneShot: true,
      label: `${relativeMinute[1]} minutes from now`
    };
  }

  const relativeHour = lower.match(/(\d+)\s*(小时|hour|hours)\s*(以后|后|later|from now)/i);
  if (relativeHour) {
    return {
      type: "interval",
      seconds: Number(relativeHour[1]) * 60 * 60,
      oneShot: true,
      label: `${relativeHour[1]} hours from now`
    };
  }

  return parseRelativeDateTrigger(text) ?? parseWeekdayTrigger(text) ?? parseAbsoluteDateTrigger(text);
}

export function isScheduleIntentText(text = "") {
  const lower = text.toLowerCase();
  const scheduleVerbPattern = /(?:提醒我|提醒|定时|安排|创建(?:一个)?(?:日程|提醒|任务)|schedule|remind\s+me|set\s+(?:a\s+)?reminder)/i;
  const clockTimePattern = /(?:上午|下午|晚上|早上|中午|凌晨)?\s*\d{1,2}\s*(?:点|[:：.])\s*(?:半|\d{1,2}\s*分?)?|(?:at\s+)?\d{1,2}[:.]\d{2}/i;
  const relativeDelayPattern = /(\d+)\s*(分钟|分|minute|minutes|min|mins|小时|hour|hours|天|day|days)\s*(以后|后|later|from now)/i;
  const dateOnlyPattern = /今天|明天|后天|下周|这周|本周|(?:周|星期|礼拜)[一二三四五六日天]|\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?/i;
  const recurringPattern = /(?:每天|每周|每月|定时|每隔|提醒我|schedule|every\s+(?:day|week|hour|morning|evening)|remind\s+me|cron|定期|每个?(?:工作日|周[一二三四五六日天])|at\s+\d{1,2}[:.]\d{2})/i;
  return recurringPattern.test(lower)
    || relativeDelayPattern.test(lower)
    || (dateOnlyPattern.test(lower) && (scheduleVerbPattern.test(lower) || clockTimePattern.test(lower)));
}

export function parseScheduleTriggerFromText(text, { fallback = "daily_cron" } = {}) {
  const lower = text.toLowerCase();
  const oneShot = parseOneShotTrigger(text);
  if (oneShot) return oneShot;

  if (/每天.*(?:早上|上午|9[点:])/.test(lower) || /every\s+(?:day|morning)\s+(?:at\s+)?9/.test(lower)) return { type: "cron", expression: "0 9 * * *", timezone: getLocalTimezone(), label: "every day at 09:00" };
  if (/每天.*(?:下午|17[点:]|5[点:].*下午)/.test(lower) || /every\s+(?:day|evening)\s+(?:at\s+)?5\s*pm/.test(lower)) return { type: "cron", expression: "0 17 * * *", timezone: getLocalTimezone(), label: "every day at 17:00" };
  if (/每天.*(?:中午|12[点:])/.test(lower)) return { type: "cron", expression: "0 12 * * *", timezone: getLocalTimezone(), label: "every day at 12:00" };
  if (/每周一/.test(lower) || /every\s+monday/.test(lower)) return { type: "cron", expression: "0 9 * * 1", timezone: getLocalTimezone(), label: "every Monday at 09:00" };
  if (/每小时/.test(lower) || /every\s+hour/.test(lower)) return { type: "interval", seconds: 3600, label: "every hour" };
  if (/每天/.test(lower) || /every\s+day/.test(lower)) return { type: "cron", expression: "0 9 * * *", timezone: getLocalTimezone(), label: "every day at 09:00" };
  if (/每周/.test(lower) || /every\s+week/.test(lower)) return { type: "cron", expression: "0 9 * * 1", timezone: getLocalTimezone(), label: "every week at 09:00" };
  if (/每月/.test(lower) || /every\s+month/.test(lower)) return { type: "cron", expression: "0 9 1 * *", timezone: getLocalTimezone(), label: "monthly at 09:00" };

  if (fallback === "natural_language") {
    return { natural_language: text, timezone: getLocalTimezone() };
  }

  return { type: "cron", expression: "0 9 * * *", timezone: getLocalTimezone(), label: "every day at 09:00" };
}
