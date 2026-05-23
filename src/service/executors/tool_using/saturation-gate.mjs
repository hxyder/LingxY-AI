import { detectSearchSaturation } from "../../core/policy/evidence-normalizer.mjs";
import { shouldCheckSaturation } from "./loop-policy.mjs";

export function planSaturationHint({ task, transcript, alreadyFired = false, windowSize = 3 }) {
  if (alreadyFired || !shouldCheckSaturation(task)) return null;
  const saturation = detectSearchSaturation(transcript, windowSize);
  if (!saturation.saturated) return null;

  return {
    transcriptEntry: {
      type: "saturation_hint",
      window_size: saturation.window_size,
      repeated_domains: saturation.repeated_domains
    },
    eventPayload: {
      window_size: saturation.window_size,
      repeated_domains: saturation.repeated_domains,
      baseline_domain_count: saturation.baseline_domain_count
    },
    auditPayload: {
      window_size: saturation.window_size,
      repeated_domains: saturation.repeated_domains
    }
  };
}
