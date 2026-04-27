import { SYNTHESIS_REQUIRED_OUTPUTS } from "../../core/intent/semantic-router.mjs";

/**
 * Returns the synthesis-guidance block to splice into a system prompt.
 * Empty string when the task has no synthesis intent — keep the prompt
 * lean for chitchat / direct_answer paths.
 *
 * Single-source-of-truth for "transform tool observations, do not dump
 * them" — every executor that calls tools should include this block.
 */
export function buildSynthesisGuidance(taskSpec) {
  const synthesis = taskSpec?.synthesis;
  if (!synthesis || typeof synthesis !== "object") return "";

  const { user_goal, expected_output } = synthesis;
  const lines = ["", "Synthesis guidance:"];
  if (typeof user_goal === "string" && user_goal.trim()) {
    lines.push(`- User goal: ${user_goal.trim().slice(0, 240)}`);
  }
  if (typeof expected_output === "string" && expected_output) {
    lines.push(`- Expected output kind: ${expected_output}`);
  }

  if (expected_output === "raw_results") {
    lines.push("- The user explicitly asked for raw / unmodified results — return them as-is.");
  } else if (SYNTHESIS_REQUIRED_OUTPUTS.has(expected_output)) {
    lines.push("- Tool observations are intermediate data, not the final answer.");
    lines.push("- Transform what tools returned into the requested form. Do not list raw records when the user asked for a summary, comparison, recommendation, analysis, or action items.");
  } else {
    lines.push("- Tool observations are intermediate data. Read them, then answer in the user's language; do not dump observation text verbatim.");
  }
  lines.push("- If observations are insufficient, say so honestly instead of fabricating.");
  return lines.join("\n");
}
