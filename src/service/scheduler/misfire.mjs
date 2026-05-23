const DAY_OF_WEEK_ALIASES = new Map([
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6]
]);

// Kept here (rather than importing from engine.mjs) to avoid a circular
// import — misfire is a low-level helper and engine.mjs depends on it.
function getSystemTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

function toDateParts(date, timezone = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: DAY_OF_WEEK_ALIASES.get(String(parts.weekday).toLowerCase()) ?? 0
  };
}

function parseCronField(field, min, max) {
  if (field === "*") {
    return { any: true };
  }

  const values = new Set();
  for (const token of String(field).split(",")) {
    if (token.includes("/")) {
      const [base, stepText] = token.split("/");
      const step = Number(stepText);
      const range = base === "*" ? `${min}-${max}` : base;
      const [start, end] = range.split("-").map(Number);
      for (let cursor = start; cursor <= end; cursor += step) {
        values.add(cursor);
      }
      continue;
    }

    if (token.includes("-")) {
      const [start, end] = token.split("-").map(Number);
      for (let cursor = start; cursor <= end; cursor += 1) {
        values.add(cursor);
      }
      continue;
    }

    values.add(Number(token));
  }

  return { any: false, values };
}

export function isCronExpressionValid(expression) {
  const fields = String(expression).trim().split(/\s+/);
  return fields.length === 5;
}

export function matchesCron(expression, date, timezone = "UTC") {
  if (!isCronExpressionValid(expression)) {
    return false;
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = expression.trim().split(/\s+/);
  const parts = toDateParts(date, timezone);
  const matchers = [
    [parseCronField(minuteField, 0, 59), parts.minute],
    [parseCronField(hourField, 0, 23), parts.hour],
    [parseCronField(dayField, 1, 31), parts.day],
    [parseCronField(monthField, 1, 12), parts.month],
    [parseCronField(weekdayField, 0, 6), parts.weekday]
  ];

  return matchers.every(([matcher, value]) => matcher.any || matcher.values.has(value));
}

export function computeNextRunAt(schedule, {
  after = new Date().toISOString(),
  limitMinutes = 60 * 24 * 366
} = {}) {
  const afterDate = new Date(after);
  if (Number.isNaN(afterDate.getTime())) {
    throw new Error(`Invalid after timestamp: ${after}`);
  }

  if (schedule.trigger_type === "interval") {
    const seconds = Number(schedule.trigger_config.seconds ?? 0);
    return new Date(afterDate.getTime() + seconds * 1000).toISOString();
  }

  if (schedule.trigger_type === "at") {
    const runAt = new Date(schedule.trigger_config.run_at ?? schedule.trigger_config.at ?? "");
    if (Number.isNaN(runAt.getTime())) {
      throw new Error("At trigger requires a valid run_at timestamp.");
    }
    return runAt.getTime() > afterDate.getTime() ? runAt.toISOString() : null;
  }

  if (schedule.trigger_type === "file_watch") {
    return null;
  }

  if (schedule.trigger_type === "clipboard_watch") {
    const pollIntervalMs = Number(schedule.trigger_config.poll_interval_ms ?? 2000);
    return new Date(afterDate.getTime() + pollIntervalMs).toISOString();
  }

  const expression = schedule.trigger_config.expression;
  // Fall back to the host's local IANA timezone (e.g. "Asia/Shanghai") rather
  // than UTC so cron expressions without an explicit tz fire at the user's
  // wall-clock time. UTC fallback caused "0 9 * * *" to run at 5pm local in
  // UTC+8 environments.
  const timezone = schedule.trigger_config.timezone ?? getSystemTimezone();
  const cursor = new Date(afterDate.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let offset = 0; offset < limitMinutes; offset += 1) {
    const candidate = new Date(cursor.getTime() + offset * 60 * 1000);
    if (matchesCron(expression, candidate, timezone)) {
      return candidate.toISOString();
    }
  }

  return null;
}

export function computeMissedRunTimes(schedule, {
  now = new Date().toISOString(),
  maxRuns = 10
} = {}) {
  if (!schedule.enabled) {
    return [];
  }

  if (!["cron", "interval", "at", "clipboard_watch"].includes(schedule.trigger_type)) {
    return [];
  }

  const missed = [];
  let cursor = schedule.last_run_at ?? schedule.created_at;
  let next = schedule.next_run_at ?? computeNextRunAt(schedule, { after: cursor });

  while (next && next <= now && missed.length < maxRuns) {
    missed.push(next);
    cursor = next;
    next = computeNextRunAt(schedule, { after: cursor });
  }

  return missed;
}

export function applyMisfirePolicy(schedule, missedRunTimes = []) {
  if (missedRunTimes.length === 0) {
    return [];
  }

  switch (schedule.catchup_policy) {
    case "run_all":
      return missedRunTimes;
    case "run_once":
      return [missedRunTimes.at(-1)];
    case "skip":
    default:
      return [];
  }
}
