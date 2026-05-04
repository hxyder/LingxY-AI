import { createProviderAdapter } from "../agentic/provider-adapter.mjs";
import { resolveProviderForTask } from "../shared/provider-resolver.mjs";
import {
  evaluateActionObligations,
  findWaitingActionApproval,
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";
import { extractEvidence } from "../../core/policy/evidence-normalizer.mjs";
import {
  compactTranscriptForComposer,
  localFallbackFinal
} from "./finalization.mjs";

const EVIDENCE_LIST_LIMIT = 6;

function topList(values = [], limit = EVIDENCE_LIST_LIMIT) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function formatEvidenceSummaryForComposer(evidence = null) {
  if (!evidence || typeof evidence !== "object") return "";
  const webCount = Number(evidence.source_count ?? 0);
  const localCount = Number(evidence.local_source_count ?? 0);
  const indexedCount = Number(evidence.indexed_file_source_count ?? 0);
  const shallowCount = Number(evidence.local_shallow_source_count ?? 0);
  const blendedCount = Number(evidence.blended_source_count ?? (webCount + localCount + indexedCount));
  if (blendedCount <= 0 && shallowCount <= 0) return "";

  const lines = [
    `content_sources=${blendedCount}; web_urls=${webCount}; web_domains=${Number(evidence.distinct_domain_count ?? 0)}`,
    `fresh_local_text=${localCount}; indexed_file_hits=${indexedCount}; listed_only_local=${shallowCount}`
  ];
  const domains = topList(evidence.domains);
  const urls = topList(evidence.urls);
  const local = topList(evidence.local_sources);
  const indexed = topList(evidence.indexed_file_sources);
  const shallow = topList(evidence.local_shallow_sources);
  if (domains.length) lines.push(`web_domains: ${domains.join(", ")}`);
  if (urls.length) lines.push(`web_urls: ${urls.join(", ")}`);
  if (local.length) lines.push(`fresh_local_text_sources: ${local.join(", ")}`);
  if (indexed.length) lines.push(`indexed_file_hits_locator_only: ${indexed.join(", ")}`);
  if (shallow.length) lines.push(`listed_only_local_paths_not_content: ${shallow.join(", ")}`);
  if (Number(evidence.local_deep_text_source_count ?? 0) > 0) {
    lines.push(`deep_local_reads=${Number(evidence.local_deep_text_source_count)}`);
  }
  if (Number(evidence.local_truncated_source_count ?? 0) > 0
      || Number(evidence.indexed_file_truncated_source_count ?? 0) > 0) {
    lines.push(`truncated_sources=${Number(evidence.local_truncated_source_count ?? 0) + Number(evidence.indexed_file_truncated_source_count ?? 0)}`);
  }
  lines.push("Use fresh local text and web evidence together when both are present. Indexed hits or listed-only paths are locator evidence, not proof that the file contents were read in this run.");
  return lines.join("\n");
}

export async function composeFinalAnswer({ task, transcript, runtime, reason = "" }) {
  runtime?.emitTaskEvent?.("final_composer_started", { reason });
  const started = Date.now();
  try {
    const taskSpec = task?.task_spec ?? {};
    const evidenceSummary = extractEvidence(transcript);
    const evidenceBlock = formatEvidenceSummaryForComposer(evidenceSummary);
    const waitingAction = findWaitingActionApproval(
      evaluateActionObligations(taskSpec, transcript)
    ) ?? findWaitingActionApprovalInTranscript(transcript);
    if (waitingAction) {
      return formatWaitingActionFinal({ task, obligation: waitingAction });
    }

    if (typeof runtime?.finalAnswerComposer === "function") {
      const composed = await runtime.finalAnswerComposer({
        task,
        transcript,
        reason,
        evidence_summary: evidenceSummary
      });
      const text = String(composed ?? "").trim();
      if (text) return text;
    }
    const provider = resolveProviderForTask("chat", process.env, {
      task,
      store: runtime?.store
    });
    if (!provider || provider.kind === "code_cli") {
      return localFallbackFinal({ task, transcript, reason });
    }
    const adapter = createProviderAdapter(provider);
    let text = "";
    const userCommand = task?.user_command ?? "";
    const expected = taskSpec?.synthesis?.expected_output ?? null;
    const system = [
      "You are LingxY's final answer composer.",
      "Use only the user request, task spec, and sanitized tool transcript below.",
      "Do not call tools. Do not mention internal pipeline, retries, budgets, validators, or raw tool protocol.",
      "Turn tool observations into the final answer the user asked for, in the user's language.",
      "If the transcript contains concrete values or facts that directly answer the request, use them. Do not claim data is unavailable just because the same observation also contains page boilerplate, navigation text, warnings, or unrelated errors.",
      "Preserve relevant source, timestamp, location, units, and uncertainty from the transcript when they matter to the answer.",
      "Never output raw internal control/event JSON. If you see fields like iteration, next_action, violation_kinds, or satisfied, treat them as internal diagnostics and omit them.",
      "If a tool failed, say what could be completed and what could not, without exposing stack traces."
    ].join("\n");
    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          `[User request]\n${userCommand}`,
          `[Expected output]\n${expected ?? "infer from user request"}`,
          `[Task spec]\n${JSON.stringify({
            goal: taskSpec.goal,
            connector_domain: taskSpec.connector_domain,
            tool_policy: taskSpec.tool_policy,
            synthesis: taskSpec.synthesis,
            research_quality: taskSpec.research_quality
          })}`,
          `[Stop reason]\n${reason || "normal"}`,
          evidenceBlock ? `[Evidence summary]\n${evidenceBlock}` : null,
          `[Tool transcript]\n${compactTranscriptForComposer(transcript) || "(no tool transcript)"}`
        ].filter(Boolean).join("\n\n")
      }
    ];
    const response = await adapter.generate({
      messages,
      tools: [],
      maxTokens: 1024,
      onTextDelta: adapter.supportsStreaming === true
        ? (delta) => {
            if (!delta) return;
            text += delta;
            runtime?.emitTaskEvent?.("text_delta", { delta });
          }
        : undefined
    });
    if (!text) text = response?.text ?? "";
    const finalText = String(text ?? "").trim();
    return finalText || localFallbackFinal({ task, transcript, reason });
  } catch {
    return localFallbackFinal({ task, transcript, reason });
  } finally {
    runtime?.emitTaskEvent?.("phase_timing", {
      phase: "final_composer",
      duration_ms: Math.max(0, Date.now() - started),
      reason
    });
  }
}
