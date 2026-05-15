import assert from "node:assert/strict";
import test from "node:test";

import {
  getScheduleOccurrences,
  getScheduleOccurrencesForRange,
  localDateKey
} from "../../src/shared/schedule-occurrences.mjs";

function schedule(overrides = {}) {
  return {
    schedule_id: "sched_daily",
    name: "Daily digest",
    enabled: true,
    trigger_type: "cron",
    trigger_config: {
      expression: "0 9 * * *",
      timezone: "UTC"
    },
    next_run_at: "2026-05-16T09:00:00.000Z",
    ...overrides
  };
}

test("daily cron schedules expand across every day in a visible range", () => {
  const occurrences = getScheduleOccurrences(
    schedule(),
    new Date("2026-05-15T00:00:00.000Z"),
    new Date("2026-05-17T23:59:59.999Z")
  );
  assert.deepEqual(occurrences.map((entry) => localDateKey(entry.run_at)), [
    "2026-05-15",
    "2026-05-16",
    "2026-05-17"
  ]);
});

test("weekly cron schedules expand only on matching weekdays", () => {
  const occurrences = getScheduleOccurrences(
    schedule({
      schedule_id: "sched_weekly",
      trigger_config: { expression: "30 10 * * 1", timezone: "UTC" }
    }),
    new Date("2026-05-10T00:00:00.000Z"),
    new Date("2026-05-16T23:59:59.999Z")
  );
  assert.equal(occurrences.length, 1);
  assert.equal(localDateKey(occurrences[0].run_at), "2026-05-11");
});

test("one-shot schedules still use run_at or next_run_at only once", () => {
  const occurrences = getScheduleOccurrences(
    schedule({
      schedule_id: "sched_once",
      trigger_type: "at",
      trigger_config: { run_at: "2026-05-16T13:00:00.000Z" }
    }),
    new Date("2026-05-15T00:00:00.000Z"),
    new Date("2026-05-17T23:59:59.999Z")
  );
  assert.equal(occurrences.length, 1);
  assert.equal(localDateKey(occurrences[0].run_at), "2026-05-16");
});

test("range expansion sorts occurrences from multiple schedules by run time", () => {
  const occurrences = getScheduleOccurrencesForRange([
    schedule({ schedule_id: "later", trigger_config: { expression: "0 17 * * *", timezone: "UTC" } }),
    schedule({ schedule_id: "earlier", trigger_config: { expression: "0 9 * * *", timezone: "UTC" } })
  ], new Date("2026-05-15T00:00:00.000Z"), new Date("2026-05-15T23:59:59.999Z"));
  assert.deepEqual(occurrences.map((entry) => entry.schedule_id), ["earlier", "later"]);
});
