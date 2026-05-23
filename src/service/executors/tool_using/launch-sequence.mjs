import {
  extractLaunchAppCandidates,
  normalizeLaunchAppKey
} from "./planners/launch-helpers.mjs";

// The launch sequence lives in transcript state, not in a hidden side-channel
// queue. This keeps compound desktop actions auditable and recoverable after
// individual launch failures.
export function attemptedLaunchKeys(transcript = []) {
  return new Set((transcript ?? [])
    .filter((entry) => entry?.type === "tool_result" && entry.tool === "launch_app")
    .map((entry) => normalizeLaunchAppKey(entry.args?.app))
    .filter(Boolean));
}

export function nextPendingLaunchCandidate(task, transcript = []) {
  const candidates = extractLaunchAppCandidates(task?.user_command ?? "");
  if (candidates.length <= 1) return null;
  const attempted = attemptedLaunchKeys(transcript);
  return candidates.find((candidate) => !attempted.has(normalizeLaunchAppKey(candidate))) ?? null;
}

export function buildLaunchSequenceGuidance(task, transcript = []) {
  const next = nextPendingLaunchCandidate(task, transcript);
  if (!next) return null;
  const candidates = extractLaunchAppCandidates(task?.user_command ?? "");
  const attempted = attemptedLaunchKeys(transcript);
  const remaining = candidates.filter((candidate) => !attempted.has(normalizeLaunchAppKey(candidate)));
  return [
    "The user requested multiple independent desktop launch actions.",
    `Already attempted: ${[...attempted].join(", ") || "(none)"}.`,
    `Remaining targets: ${remaining.join(", ")}.`,
    `Call launch_app next with {"app": ${JSON.stringify(next)}}.`,
    "Do not finalize just because an earlier independent launch failed; continue the remaining launch targets unless the user must disambiguate that specific failed target."
  ].join("\n");
}
