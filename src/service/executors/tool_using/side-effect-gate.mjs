import { applySideEffectContractToToolArgs } from "../../core/policy/side-effect-contracts.mjs";
import { normalizeScheduledEmailArgs } from "../../core/policy/scheduled-work-policy.mjs";
import {
  isSideEffectTool,
  transcriptHasSuccessfulToolCall
} from "./tool-call-guards.mjs";

export function applySideEffectContractToDecisionArgs({ decision, tool, task, runtime }) {
  if (decision?.type !== "tool_call") return decision?.args;
  const contractedArgs = applySideEffectContractToToolArgs(tool.id, decision.args, { task, runtime });
  return normalizeScheduledEmailArgs({ toolId: tool.id, args: contractedArgs, task });
}

export function planRedundantSideEffectGuard({
  tool,
  registry,
  transcript,
  synthesisRetriesUsed,
  maxSynthesisRetries
}) {
  if (!isSideEffectTool(tool, registry) || !transcriptHasSuccessfulToolCall(transcript, tool.id)) {
    return null;
  }

  const reason = "redundant_side_effect_call";
  if (synthesisRetriesUsed < maxSynthesisRetries) {
    return {
      action: "retry",
      reason,
      transcriptEntry: {
        type: "synthesis_retry",
        violations: [{
          kind: reason,
          message: `${tool.id} already succeeded earlier in this run; do not re-fire side-effect tools — finalize from the existing result.`
        }]
      },
      eventPayload: {
        attempt: synthesisRetriesUsed + 1,
        reason,
        tool_id: tool.id
      }
    };
  }

  return {
    action: "partial_success",
    reason
  };
}
