const PATTERNS = [
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
  for (const pattern of PATTERNS) {
    const match = text.match(pattern.test);
    if (!match) {
      continue;
    }

    return {
      ok: true,
      trigger: {
        ...pattern.build(match),
        timezone
      }
    };
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

  if (trigger.type === "file_watch") {
    return `watch ${trigger.path}`;
  }

  return trigger.type ?? "unknown";
}
