const DAY_OF_WEEK_ALIASES = new Map([
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6]
]);

const MAX_OCCURRENCES_PER_SCHEDULE = 96;

function getSystemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function parseCronField(field, min, max) {
  if (field === "*") return { any: true, values: [] };
  const values = new Set();
  for (const token of String(field ?? "").split(",")) {
    if (!token) continue;
    if (token.includes("/")) {
      const [base, stepText] = token.split("/");
      const step = Number(stepText);
      if (!Number.isFinite(step) || step <= 0) continue;
      const range = base === "*" ? `${min}-${max}` : base;
      const [start, end] = range.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      for (let cursor = Math.max(min, start); cursor <= Math.min(max, end); cursor += step) {
        values.add(cursor);
      }
      continue;
    }
    if (token.includes("-")) {
      const [start, end] = token.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      for (let cursor = Math.max(min, start); cursor <= Math.min(max, end); cursor += 1) {
        values.add(cursor);
      }
      continue;
    }
    const numeric = Number(token);
    if (Number.isFinite(numeric) && numeric >= min && numeric <= max) values.add(numeric);
    if (max === 6 && numeric === 7) values.add(0);
  }
  return { any: false, values: [...values].sort((a, b) => a - b) };
}

function dateParts(date, timezone = getSystemTimezone()) {
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

function matchesField(matcher, value) {
  return matcher.any || matcher.values.includes(value);
}

function matchesCron(expression, date, timezone) {
  const fields = String(expression ?? "").trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const parts = dateParts(date, timezone);
  return matchesField(parseCronField(minuteField, 0, 59), parts.minute)
    && matchesField(parseCronField(hourField, 0, 23), parts.hour)
    && matchesField(parseCronField(dayField, 1, 31), parts.day)
    && matchesField(parseCronField(monthField, 1, 12), parts.month)
    && matchesField(parseCronField(weekdayField, 0, 6), parts.weekday);
}

function candidateValues(matcher, min, max) {
  if (!matcher.any) return matcher.values;
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function eachDay(rangeStart, rangeEnd) {
  const days = [];
  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(23, 59, 59, 999);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function pushOccurrence(results, schedule, runAt) {
  if (!runAt || Number.isNaN(runAt.getTime())) return;
  results.push({
    schedule_id: schedule.schedule_id,
    schedule,
    run_at: runAt.toISOString()
  });
}

export function getScheduleOccurrences(schedule, rangeStart, rangeEnd) {
  if (!schedule?.enabled) return [];
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const results = [];
  const triggerType = schedule.trigger_type ?? schedule.trigger?.type ?? schedule.trigger_config?.type;
  const triggerConfig = schedule.trigger_config ?? schedule.trigger ?? {};

  if (triggerType === "at") {
    const runAt = new Date(triggerConfig.run_at ?? triggerConfig.at ?? schedule.next_run_at ?? "");
    if (runAt >= start && runAt <= end) pushOccurrence(results, schedule, runAt);
    return results;
  }

  if (triggerType !== "cron") {
    const runAt = new Date(schedule.next_run_at ?? "");
    if (runAt >= start && runAt <= end) pushOccurrence(results, schedule, runAt);
    return results;
  }

  const fields = String(triggerConfig.expression ?? "").trim().split(/\s+/);
  if (fields.length !== 5) return results;
  const [minuteField, hourField] = fields;
  const minuteValues = candidateValues(parseCronField(minuteField, 0, 59), 0, 59);
  const hourValues = candidateValues(parseCronField(hourField, 0, 23), 0, 23);
  const timezone = triggerConfig.timezone ?? getSystemTimezone();
  if (timezone !== getSystemTimezone()) {
    const cursor = new Date(start);
    cursor.setSeconds(0, 0);
    while (cursor <= end) {
      if (matchesCron(triggerConfig.expression, cursor, timezone)) {
        pushOccurrence(results, schedule, cursor);
        if (results.length >= MAX_OCCURRENCES_PER_SCHEDULE) return results;
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return results;
  }

  for (const day of eachDay(start, end)) {
    for (const hour of hourValues) {
      for (const minute of minuteValues) {
        const candidate = new Date(day);
        candidate.setHours(hour, minute, 0, 0);
        if (candidate < start || candidate > end) continue;
        if (!matchesCron(triggerConfig.expression, candidate, timezone)) continue;
        pushOccurrence(results, schedule, candidate);
        if (results.length >= MAX_OCCURRENCES_PER_SCHEDULE) {
          return results;
        }
      }
    }
  }
  return results;
}

export function getScheduleOccurrencesForRange(schedules = [], rangeStart, rangeEnd) {
  const occurrences = [];
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    occurrences.push(...getScheduleOccurrences(schedule, rangeStart, rangeEnd));
  }
  return occurrences.sort((a, b) => String(a.run_at).localeCompare(String(b.run_at)));
}

export function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
