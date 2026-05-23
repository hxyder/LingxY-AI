import { FAILURE_DISABLE_THRESHOLD } from "./store.mjs";

export function applyScheduleRunOutcome(schedule, status, threshold = FAILURE_DISABLE_THRESHOLD) {
  if (status === "success" || status === "partial_success") {
    schedule.consecutive_failure_count = 0;
    return {
      disabled: false,
      thresholdReached: false
    };
  }

  if (status === "failed") {
    schedule.failure_count += 1;
    schedule.consecutive_failure_count += 1;
  }

  const thresholdReached = schedule.consecutive_failure_count >= threshold;
  if (thresholdReached) {
    schedule.enabled = false;
  }

  return {
    disabled: thresholdReached,
    thresholdReached
  };
}
