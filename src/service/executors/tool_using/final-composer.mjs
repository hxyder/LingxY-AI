import { createProviderAdapter } from "../agentic/provider-adapter.mjs";
import { resolveProviderForModelRole } from "../shared/provider-resolver.mjs";
import {
  evaluateActionObligations,
  findWaitingActionApproval,
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";
import { extractEvidence } from "../../core/policy/evidence-normalizer.mjs";
import { renderEvidenceLedgerFromSummary } from "../shared/evidence-ledger.mjs";
import { emitLlmUsage } from "../../core/task-runtime/llm-usage.mjs";
import {
  generateTextWithContinuations,
  incompleteOutputNotice
} from "../shared/output-continuation.mjs";
import {
  compactTranscriptForComposer,
  localFallbackFinal
} from "./finalization.mjs";
import { reviewFinalAnswer } from "./final-reviewer.mjs";
import { detectNetworkFailureInTranscript } from "./failure-classifier.mjs";
import { detectIncompleteFinalAnswerStructure } from "../../core/policy/success-contract-validator.mjs";

const EVIDENCE_LIST_LIMIT = 6;
const FINAL_COMPOSER_MAX_TOKENS = 2048;
const FINAL_COMPOSER_CONTINUATION_MAX_TOKENS = 2048;
const FINAL_COMPOSER_MAX_CONTINUATIONS = 2;
const COMPOSER_DRAFT_CHAR_LIMIT = 8000;
const COMPOSER_PRIOR_DRAFT_LIMIT = 3;
const NETWORK_UNAVAILABLE_CLAIM_PATTERNS = [
  /\b(?:web|network|search|browser|browsing)\s+(?:tool|tools|access|search|fetch)\s+(?:is|are|was|were)?\s*(?:temporarily\s+)?(?:unavailable|not available|disabled|blocked|failed)/i,
  /\b(?:cannot|can't|unable to)\s+(?:browse|search|fetch|access)\s+(?:the\s+)?(?:web|internet|network|site|page)/i,
  /(?:网络|联网|搜索|网页|浏览|抓取).{0,12}(?:工具|访问|功能)?.{0,10}(?:暂时不可用|不可用|无法使用|访问受限|失败)/u,
  /(?:无法|不能|没能).{0,12}(?:实时)?(?:搜索|联网|抓取|访问)/u
];
const NETWORK_EVIDENCE_TOOLS = new Set(["web_search", "web_search_fetch", "fetch_url_content", "download_file"]);

function topList(values = [], limit = EVIDENCE_LIST_LIMIT) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function claimsNetworkUnavailable(text = "") {
  const raw = String(text ?? "");
  if (!raw.trim()) return false;
  return NETWORK_UNAVAILABLE_CLAIM_PATTERNS.some((pattern) => pattern.test(raw));
}

function hasNetworkTranscript(transcript = []) {
  return (transcript ?? []).some((entry) =>
    entry?.type === "tool_result"
    && NETWORK_EVIDENCE_TOOLS.has(entry.tool)
  );
}

export function guardFinalNetworkFailureClaim({ task, transcript = [], candidateText = "" } = {}) {
  const text = String(candidateText ?? "").trim();
  if (!text || !claimsNetworkUnavailable(text)) return text;
  const failure = detectNetworkFailureInTranscript(transcript);
  if (!failure && !hasNetworkTranscript(transcript)) return text;
  const fallback = localFallbackFinal({
    task,
    transcript,
    reason: failure ? `network_failure:${failure.kind}` : "network_claim_not_supported_by_transcript"
  });
  return String(fallback ?? "").trim() || text;
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
  if (evidence.newest_web_source_date || evidence.latest_web_search_at) {
    lines.push([
      "web_freshness:",
      evidence.latest_web_search_at ? `searched_at=${evidence.latest_web_search_at}` : null,
      evidence.newest_web_source_date ? `newest_dated_source=${evidence.newest_web_source_date}` : null,
      evidence.oldest_web_source_date ? `oldest_dated_source=${evidence.oldest_web_source_date}` : null,
      Number(evidence.dated_web_source_count ?? 0) > 0 ? `dated_sources=${Number(evidence.dated_web_source_count)}` : null
    ].filter(Boolean).join(" "));
  }
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
  const ledger = renderEvidenceLedgerFromSummary(evidence, { limit: 12 });
  if (ledger) {
    lines.push("source_ledger:");
    lines.push(ledger);
  }
  lines.push("Use fresh local text and web evidence together when both are present. Indexed hits or listed-only paths are locator evidence, not proof that the file contents were read in this run.");
  return lines.join("\n");
}

function normalizeComposerDraft(text = "", limit = COMPOSER_DRAFT_CHAR_LIMIT) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  return raw.length > limit ? `${raw.slice(0, limit)}\n[Draft truncated]` : raw;
}

export function formatPriorDraftsForComposer(transcript = [], {
  limit = COMPOSER_PRIOR_DRAFT_LIMIT
} = {}) {
  const drafts = [];
  for (const entry of [...(transcript ?? [])].reverse()) {
    if (entry?.type !== "synthesis_retry") continue;
    const draft = normalizeComposerDraft(entry.assistantDraft, 3000);
    if (!draft) continue;
    const violations = Array.isArray(entry.violations)
      ? entry.violations
        .map((violation) => violation?.kind || violation?.message)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ")
      : "";
    drafts.push([
      `Draft ${drafts.length + 1}${violations ? `; quality feedback: ${violations}` : ""}:`,
      draft
    ].join("\n"));
    if (drafts.length >= limit) break;
  }
  return drafts.reverse().join("\n\n");
}

export async function composeFinalAnswer({
  task,
  transcript,
  runtime,
  reason = "",
  signal = null,
  streamToUser = true,
  purpose = "final_answer",
  draftText = null
}) {
  runtime?.emitTaskEvent?.("final_composer_started", { reason });
  const started = Date.now();
  try {
    if (signal?.aborted) {
      const err = new Error("Final composer aborted.");
      err.code = "ABORT_ERR";
      throw err;
    }
    const taskSpec = task?.task_spec ?? {};
    const evidenceSummary = extractEvidence(transcript);
    const evidenceBlock = formatEvidenceSummaryForComposer(evidenceSummary);
    const draftBlock = normalizeComposerDraft(draftText);
    const priorDraftsBlock = formatPriorDraftsForComposer(transcript);
    const finalizeCandidate = async (candidateText) => {
      const guardedText = guardFinalNetworkFailureClaim({ task, transcript, candidateText });
      if (guardedText !== String(candidateText ?? "").trim()) {
        runtime?.emitTaskEvent?.("final_composer_guarded_claim", {
          reason: "network_failure_claim_from_transcript",
          original_chars: String(candidateText ?? "").length,
          guarded_chars: guardedText.length
        });
      }
      if (purpose === "side_effect_body") {
        return guardedText;
      }
      const reviewed = await reviewFinalAnswer({
        task,
        transcript,
        runtime,
        candidateText: guardedText,
        reason,
        signal,
        evidenceSummary
      });
      return reviewed.text;
    };
    if (purpose !== "side_effect_body") {
      const waitingAction = findWaitingActionApproval(
        evaluateActionObligations(taskSpec, transcript)
      ) ?? findWaitingActionApprovalInTranscript(transcript);
      if (waitingAction) {
        return formatWaitingActionFinal({ task, obligation: waitingAction });
      }
    }

    if (typeof runtime?.finalAnswerComposer === "function") {
      const composed = await runtime.finalAnswerComposer({
        task,
        transcript,
        reason,
        evidence_summary: evidenceSummary,
        draft_text: draftBlock,
        prior_drafts: priorDraftsBlock
      });
      const text = String(composed ?? "").trim();
      if (text) return finalizeCandidate(text);
    }
    const provider = resolveProviderForModelRole("executor", "chat", process.env, {
      task,
      store: runtime?.store
    });
    if (!provider || provider.kind === "code_cli") {
      return finalizeCandidate(localFallbackFinal({ task, transcript, reason }));
    }
    const adapter = createProviderAdapter(provider);
    const userCommand = task?.user_command ?? "";
    const expected = taskSpec?.synthesis?.expected_output ?? null;
    const system = [
      purpose === "side_effect_body"
        ? "You are LingxY's side-effect content composer."
        : "You are LingxY's final answer composer.",
      `Current local date: ${new Date().toISOString().slice(0, 10)}. Interpret recency and freshness against this date.`,
      "Use only the user request, task spec, and sanitized tool transcript below.",
      "Do not call tools. Do not mention internal pipeline, retries, budgets, validators, or raw tool protocol.",
      purpose === "side_effect_body"
        ? "Write only the content body that should be sent through the pending side-effect tool, in the user's language. Do not claim the message was sent or completed."
        : "Turn tool observations into the final answer the user asked for, in the user's language.",
      "If a planner draft or prior answer draft is provided, treat it as a draft answer rather than hidden reasoning: preserve useful concrete recommendations, examples, caveats, and structure unless the tool transcript contradicts them.",
      "Do not expose private chain-of-thought or step-by-step internal deliberation. Convert useful draft analysis into concise user-facing conclusions and actions.",
      "When tool metadata marks `result_kind=record_list` and the expected output is summary, comparison, recommendation, or analysis, produce collection-level synthesis: counts, groups, priorities, implications, or next steps. Do not merely restate each record as a list.",
      "If the transcript contains concrete values or facts that directly answer the request, use them. Do not claim data is unavailable just because the same observation also contains page boilerplate, navigation text, warnings, or unrelated errors.",
      "If the user said not to open a webpage/browser, interpret that as no visible navigation. It does not prohibit using already executed search/fetch evidence or returning source/application links.",
      "Preserve relevant source, timestamp, location, units, and uncertainty from the transcript when they matter to the answer.",
      "For latest/current/recent questions, if web_freshness shows the newest dated source is older than the current local date, explicitly say it is the newest dated source found in this search rather than implying it is live current truth.",
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
          draftBlock ? `[Planner draft]\n${draftBlock}` : null,
          priorDraftsBlock ? `[Prior answer drafts and quality feedback]\n${priorDraftsBlock}` : null,
          evidenceBlock ? `[Evidence summary]\n${evidenceBlock}` : null,
          `[Tool transcript]\n${compactTranscriptForComposer(transcript) || "(no tool transcript)"}`
        ].filter(Boolean).join("\n\n")
      }
    ];
    const generation = await generateTextWithContinuations({
      adapter,
      messages,
      tools: [],
      initialMaxTokens: FINAL_COMPOSER_MAX_TOKENS,
      continuationMaxTokens: FINAL_COMPOSER_CONTINUATION_MAX_TOKENS,
      maxContinuations: FINAL_COMPOSER_MAX_CONTINUATIONS,
      signal,
      purpose,
      onTextDelta: adapter.supportsStreaming === true && streamToUser
        ? (delta) => runtime?.emitTaskEvent?.("text_delta", { delta })
        : null,
      onUsage: ({ response, continuationIndex, attemptMessages, limitReason }) => {
        emitLlmUsage({
          runtime,
          task,
          callSite: "tool_using.final_composer",
          iteration: continuationIndex,
          usage: response?.usage,
          provider: adapter,
          stream: adapter.supportsStreaming === true && streamToUser,
          promptSegments: [
            { name: "system", content: system },
            { name: "current", content: attemptMessages[1]?.content ?? "" },
            ...(continuationIndex > 0
              ? [
                  { name: "partial_answer_tail", content: attemptMessages.at(-2)?.content ?? "" },
                  { name: "continuation_instruction", content: attemptMessages.at(-1)?.content ?? "" }
                ]
              : [])
          ],
          extra: {
            reason: reason || "normal",
            finish_reason: response?.finish_reason ?? null,
            stop_reason: response?.stop_reason ?? null,
            output_limited: Boolean(limitReason),
            continuation_index: continuationIndex
          }
        });
      },
      onOutputLimited: ({ continuationIndex, limitReason, text }) => {
        runtime?.emitTaskEvent?.("final_composer_output_limited", {
          finish_reason: limitReason,
          continuation_index: continuationIndex,
          composed_chars: text.length,
          max_continuations: FINAL_COMPOSER_MAX_CONTINUATIONS
        });
      },
      onContinuationStarted: ({ continuationIndex, previousLimitReason, text }) => {
        runtime?.emitTaskEvent?.("final_composer_continuation_started", {
          continuation_index: continuationIndex,
          previous_finish_reason: previousLimitReason,
          composed_chars: text.length
        });
      },
      shouldContinue: ({ limitReason, continuationIndex, text }) => {
        if (limitReason) return true;
        if (continuationIndex >= FINAL_COMPOSER_MAX_CONTINUATIONS) return false;
        const incomplete = detectIncompleteFinalAnswerStructure(text);
        return incomplete ? { reason: incomplete.kind } : false;
      }
    });
    let finalText = generation.text;
    if (generation.outputLimited) {
      const notice = incompleteOutputNotice(task);
      finalText += notice;
      if (adapter.supportsStreaming === true && streamToUser) {
        runtime?.emitTaskEvent?.("text_delta", { delta: notice });
      }
      runtime?.emitTaskEvent?.("final_composer_incomplete", {
        reason: "output_limit_after_continuations",
        finish_reason: generation.finalLimitReason,
        composed_chars: finalText.length
      });
    }
    finalText = String(finalText ?? "").trim();
    return finalizeCandidate(finalText || localFallbackFinal({ task, transcript, reason }));
  } catch (error) {
    if (error?.code === "ABORT_ERR") throw error;
    return localFallbackFinal({ task, transcript, reason });
  } finally {
    runtime?.emitTaskEvent?.("phase_timing", {
      phase: "final_composer",
      duration_ms: Math.max(0, Date.now() - started),
      reason
    });
  }
}
