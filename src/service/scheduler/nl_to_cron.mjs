// Relative one-shot: "5 分钟后", "2小时之后", "in 10 minutes", "after 30 min"
const RELATIVE_ONE_SHOT = {
  test: /(?:(\d+)\s*(分钟|分|小时|时|天|minutes?|mins?|hours?|hrs?|days?)\s*(?:以?后|之后|之内|later|from\s+now)|(?:in|after)\s+(\d+)\s*(分钟|分|小时|时|天|minutes?|mins?|hours?|hrs?|days?))/i,
  build(match) {
    const amount = Number(match[1] ?? match[3]);
    const unitRaw = String(match[2] ?? match[4]).toLowerCase();
    let seconds;
    if (/(分钟|分|minute|min)/i.test(unitRaw)) seconds = amount * 60;
    else if (/(小时|时|hour|hr)/i.test(unitRaw)) seconds = amount * 3600;
    else if (/(天|day)/i.test(unitRaw)) seconds = amount * 86400;
    else seconds = amount * 60;
    return {
      type: "at",
      run_at: new Date(Date.now() + seconds * 1000).toISOString()
    };
  }
};

// Absolute one-shot: "今天晚上 8 点", "明天上午 9:30", "tomorrow at 10am"
// Builds an ISO timestamp for the next occurrence in the requested timezone.
function buildAbsoluteOneShot(hour, minute, dayOffset, timezone) {
  // Work in local wall clock — Node already uses the system timezone.
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + dayOffset);
  target.setHours(hour, minute, 0, 0);
  if (dayOffset === 0 && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return { type: "at", run_at: target.toISOString(), timezone };
}

const ABSOLUTE_ONE_SHOT = {
  test: /(今天|今晚|明天|后天|tomorrow|tonight)?\s*(上午|下午|晚上|morning|afternoon|evening|night|am|pm)?\s*(\d{1,2})\s*(?:[:：](\d{1,2}))?\s*(点|时|:00)?(?:\s*(am|pm))?\s*(?:执行|做|发送|提醒|remind|send|do|run)?/i,
  build(match, timezone) {
    const dayKey = String(match[1] ?? "").toLowerCase();
    const period = String(match[2] ?? match[6] ?? "").toLowerCase();
    let hour = Number(match[3]);
    const minute = Number(match[4] ?? 0);
    const dayOffset = /明天|tomorrow/.test(dayKey) ? 1 : (/后天/.test(dayKey) ? 2 : 0);
    if (/下午|evening|night|pm/i.test(period) && hour < 12) hour += 12;
    if (/上午|morning|am/i.test(period) && hour === 12) hour = 0;
    if (/晚上/i.test(period) && hour < 12) hour += 12;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return buildAbsoluteOneShot(hour, minute, dayOffset, timezone);
  }
};

const PATTERNS = [
  RELATIVE_ONE_SHOT,
  {
    test: /(每天|daily).*?(\d{1,2})\s*(?::|点|时)\s*(\d{1,2})?/i,
    build(match) {
      const hour = Number(match[2]);
      const minute = Number(match[3] ?? 0);
      return {
        type: "cron",
        expression: `${minute} ${hour} * * *`
      };
    }
  },
  {
    test: /(工作日).*?(\d{1,2})\s*(?::|点|时)\s*(\d{1,2})?/i,
    build(match) {
      const hour = Number(match[2]);
      const minute = Number(match[3] ?? 0);
      return {
        type: "cron",
        expression: `${minute} ${hour} * * 1-5`
      };
    }
  },
  {
    test: /(每周[一二三四五六日天]|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday)/i,
    build(match) {
      const weekdays = {
        "每周一": 1,
        "每周二": 2,
        "每周三": 3,
        "每周四": 4,
        "每周五": 5,
        "每周六": 6,
        "每周日": 0,
        "每周天": 0,
        "every monday": 1,
        "every tuesday": 2,
        "every wednesday": 3,
        "every thursday": 4,
        "every friday": 5,
        "every saturday": 6,
        "every sunday": 0
      };
      return {
        type: "cron",
        expression: `0 0 * * ${weekdays[String(match[1]).toLowerCase()] ?? weekdays[match[1]] ?? 1}`
      };
    }
  },
  {
    test: /(每|every)\s*(\d+)\s*(分钟|minute|min|小时|hour|hours)/i,
    build(match) {
      const amount = Number(match[2]);
      const unit = String(match[3]).toLowerCase();
      if (["分钟", "minute", "min"].includes(unit)) {
        return {
          type: "interval",
          seconds: amount * 60
        };
      }
      return {
        type: "interval",
        seconds: amount * 60 * 60
      };
    }
  }
];

function getSystemTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

export function parseNaturalLanguageTrigger(text, timezone = getSystemTimezone()) {
  // Relative one-shot wins first: "5 分钟后" should not be shadowed by the
  // daily/weekly matchers that happen to contain digits.
  for (const pattern of PATTERNS) {
    const match = text.match(pattern.test);
    if (!match) continue;
    const built = pattern.build(match, timezone);
    if (!built) continue;
    return {
      ok: true,
      trigger: { ...built, timezone: built.timezone ?? timezone }
    };
  }

  // Last resort: look for an absolute-time expression anywhere in the string.
  const abs = text.match(ABSOLUTE_ONE_SHOT.test);
  if (abs) {
    const built = ABSOLUTE_ONE_SHOT.build(abs, timezone);
    if (built) {
      return {
        ok: true,
        trigger: { ...built, timezone: built.timezone ?? timezone }
      };
    }
  }

  return {
    ok: false,
    error: "unsupported_natural_language_schedule"
  };
}

export function describeTrigger(trigger) {
  if (!trigger) {
    return "unknown";
  }

  if (trigger.type === "cron") {
    return `cron ${trigger.expression}`;
  }

  if (trigger.type === "interval") {
    return `every ${trigger.seconds}s`;
  }

  if (trigger.type === "at") {
    return `at ${trigger.run_at ?? trigger.at ?? "?"}`;
  }

  if (trigger.type === "file_watch") {
    return `watch ${trigger.path}`;
  }

  return trigger.type ?? "unknown";
}
