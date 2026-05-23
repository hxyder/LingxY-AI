import { createProviderAdapter } from "../agentic/provider-adapter.mjs";
import { resolveProviderForModelRole } from "../shared/provider-resolver.mjs";
import { emitLlmUsage, providerRequestAdjustmentExtra } from "../../core/task-runtime/llm-usage.mjs";
import { compactTranscriptForComposer } from "./finalization.mjs";
import {
  selectSuccessContractValidationSpec,
  validateSuccessContract
} from "../../core/policy/success-contract-validator.mjs";

const DEFAULT_REVIEW_BUDGET = Object.freeze({
  timeoutMs: 8000,
  maxCandidateChars: 12000,
  maxTranscriptChars: 20000
});

const REVIEW_VERDICTS = new Set(["accept", "revise", "reject", "abstain"]);
const CONNECTOR_TOOL_PATTERN = /^(account_|connector_)/u;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function loadRuntimeConfig(runtime = null) {
  try {
    return runtime?.configStore?.load?.() ?? {};
  } catch {
    return {};
  }
}

function reviewerConfig({ task = null, runtime = null, config = null } = {}) {
  const loaded = config ?? loadRuntimeConfig(runtime);
  const fromTask = task?.reviewer_loop
    ?? task?.final_answer_reviewer
    ?? task?.context_packet?.selection_metadata?.reviewer_loop
    ?? null;
  const fromConfig = loaded?.ai?.reviewerLoop
    ?? loaded?.ai?.finalAnswerReviewer
    ?? loaded?.ai?.modelRoleRouting?.reviewerLoop
    ?? null;
  return {
    loaded,
    raw: asObject(fromTask ?? fromConfig),
    source: fromTask ? "task" : fromConfig ? "config" : "default"
  };
}

export function isFinalAnswerReviewerEnabled({ task = null, runtime = null, config = null } = {}) {
  const { raw } = reviewerConfig({ task, runtime, config });
  return raw.enabled === true;
}

export function resolveFinalAnswerReviewerBudget({ task = null, runtime = null, config = null } = {}) {
  const { raw } = reviewerConfig({ task, runtime, config });
  const budget = asObject(raw.budget);
  return {
    timeoutMs: positiveInt(budget.timeoutMs ?? budget.timeout_ms, DEFAULT_REVIEW_BUDGET.timeoutMs),
    maxCandidateChars: positiveInt(
      budget.maxCandidateChars ?? budget.max_candidate_chars,
      DEFAULT_REVIEW_BUDGET.maxCandidateChars
    ),
    maxTranscriptChars: positiveInt(
      budget.maxTranscriptChars ?? budget.max_transcript_chars,
      DEFAULT_REVIEW_BUDGET.maxTranscriptChars
    )
  };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function hasArtifactRequirement(taskSpec = {}) {
  return taskSpec?.success_contract?.artifact_created === true
    || taskSpec?.artifact?.required === true
    || taskSpec?.contract?.output_contract?.artifact_required === true;
}

function hasConnectorRisk(taskSpec = {}, transcript = []) {
  if (taskSpec?.connector_domain) return true;
  if (taskSpec?.side_effect_contract) return true;
  const groups = taskSpec?.success_contract?.required_policy_groups;
  if (Array.isArray(groups) && groups.some((group) =>
    ["email_send", "calendar_create", "file_upload", "connector_workflow"].includes(`${group ?? ""}`)
  )) return true;
  return transcript.some((entry) => {
    const toolId = `${entry?.tool ?? entry?.tool_id ?? entry?.name ?? ""}`;
    return CONNECTOR_TOOL_PATTERN.test(toolId);
  });
}

export function buildFinalAnswerReviewRiskProfile({ task = null, transcript = [], evidenceSummary = null } = {}) {
  const taskSpec = task?.task_spec ?? {};
  const reasons = [];
  if (hasArtifactRequirement(taskSpec)) reasons.push("artifact_required");
  if (taskSpec?.research_quality) reasons.push("research_quality");
  if (hasConnectorRisk(taskSpec, transcript)) reasons.push("connector_or_side_effect");
  const evidenceCount = Number(evidenceSummary?.blended_source_count
    ?? evidenceSummary?.source_count
    ?? 0);
  if (evidenceCount >= 3 && taskSpec?.synthesis?.expected_output === "analysis") {
    reasons.push("multi_source_analysis");
  }
  return {
    required: reasons.length > 0,
    reasons
  };
}

function artifactOnlyContractIsSatisfied({ task = null, transcript = [], riskProfile = {} } = {}) {
  const reasons = Array.isArray(riskProfile?.reasons) ? riskProfile.reasons : [];
  if (reasons.length !== 1 || reasons[0] !== "artifact_required") return false;
  const spec = selectSuccessContractValidationSpec(task);
  if (!spec) return false;
  return validateSuccessContract(spec, transcript).satisfied === true;
}

function parseJsonish(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/u);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

export function normalizeFinalAnswerReview(raw = null) {
  const data = parseJsonish(raw) ?? {};
  const verdict = REVIEW_VERDICTS.has(`${data.verdict ?? ""}`)
    ? `${data.verdict}`
    : "abstain";
  const confidence = Number(data.confidence);
  const corrections = Array.isArray(data.corrections)
    ? data.corrections.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 5)
    : [];
  return {
    verdict,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    reason: String(data.reason ?? data.rationale ?? "").trim().slice(0, 1000),
    corrections
  };
}

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/u.test(String(value ?? ""));
}

function isChineseTask(task = null) {
  return hasCjk(task?.user_command ?? task?.context_packet?.user_command ?? "");
}

function formatReviewCaution({ task = null } = {}) {
  if (isChineseTask(task)) {
    return "质量检查：这条回答可能仍缺少可靠证据或必要修正，请先按上文谨慎使用。";
  }
  return "Accuracy check: this answer may still need stronger evidence or correction before you rely on it.";
}

function formatRejectedFinalAnswer({ task = null } = {}) {
  const zh = isChineseTask(task);
  if (zh) {
    return [
      "这次任务没有可靠完成，我不会把候选答案当作完成结果。",
      "质量检查：缺少足够可靠的工具证据，或必需操作尚未确认完成。",
      "请重新执行；我会先完成必要的数据获取或操作确认，再给出结论。"
    ].join("\n");
  }
  return [
    "This task did not complete reliably, so I will not present the candidate answer as finished.",
    "Accuracy check: required tool evidence is missing, or a required action was not confirmed complete.",
    "Please retry after the required evidence-gathering tools and required actions have completed."
  ].join("\n");
}

export function applyFinalAnswerReview(candidateText = "", review = {}, { visibleWarnings = true, task = null } = {}) {
  const text = String(candidateText ?? "").trim();
  if (!text) return text;
  if (!["revise", "reject"].includes(review?.verdict)) return text;
  if (review.verdict === "reject") {
    return formatRejectedFinalAnswer({ task });
  }
  if (visibleWarnings === false) return text;
  return [
    text,
    "",
    formatReviewCaution({ task })
  ].join("\n");
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      const error = new Error("final_answer_reviewer_timeout");
      error.code = "FINAL_REVIEW_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function runInjectedReviewer({ runtime, task, transcript, candidateText, reason, evidenceSummary, riskProfile }) {
  if (typeof runtime?.finalAnswerReviewer !== "function") return null;
  return runtime.finalAnswerReviewer({
    task,
    transcript,
    candidate_text: candidateText,
    reason,
    evidence_summary: evidenceSummary,
    risk_profile: riskProfile
  });
}

async function runProviderReviewer({
  task,
  transcript,
  runtime,
  candidateText,
  reason,
  signal,
  evidenceSummary,
  riskProfile
}) {
  const provider = resolveProviderForModelRole("reviewer", "reviewer", process.env, {
    task,
    store: runtime?.store
  });
  if (!provider) return null;
  const adapter = createProviderAdapter(provider);
  const taskSpec = task?.task_spec ?? {};
  const compactTranscript = compactTranscriptForComposer(transcript);
  const system = [
    "You are LingxY's final answer reviewer.",
    "Review the candidate answer against the user request, task spec, and sanitized tool transcript.",
    "Return strict JSON only: {\"verdict\":\"accept|revise|reject|abstain\",\"confidence\":0-1,\"reason\":\"...\",\"corrections\":[\"...\"]}.",
    "Do not rewrite the answer. Identify unsupported claims, missing required artifacts, missing connector action confirmation, or weak research evidence.",
    "Use reject only for unsafe or materially wrong final answers. Use revise for answerable gaps."
  ].join("\n");
  const user = [
    `[User request]\n${task?.user_command ?? ""}`,
    `[Review reason]\n${reason || "normal"}`,
    `[Risk profile]\n${JSON.stringify(riskProfile)}`,
    `[Task spec]\n${JSON.stringify({
      goal: taskSpec.goal,
      connector_domain: taskSpec.connector_domain,
      success_contract: taskSpec.success_contract,
      synthesis: taskSpec.synthesis,
      artifact: taskSpec.artifact,
      research_quality: taskSpec.research_quality
    })}`,
    `[Evidence summary]\n${JSON.stringify(evidenceSummary ?? {})}`,
    `[Candidate answer]\n${candidateText}`,
    `[Tool transcript]\n${compactTranscript || "(no tool transcript)"}`
  ].join("\n\n");
  const response = await adapter.generate({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    tools: [],
    maxTokens: 512,
    signal
  });
  emitLlmUsage({
    runtime,
    task,
    callSite: "tool_using.final_reviewer",
    usage: response?.usage,
    provider: adapter,
    stream: false,
    promptSegments: [
      { name: "system", content: system },
      { name: "current", content: user }
    ],
    extra: {
      ...providerRequestAdjustmentExtra(response),
      reason: reason || "normal"
    }
  });
  return response?.text ?? "";
}

export async function reviewFinalAnswer({
  task = null,
  transcript = [],
  runtime = null,
  candidateText = "",
  reason = "",
  signal = null,
  evidenceSummary = null
} = {}) {
  const text = String(candidateText ?? "").trim();
  if (!text) return { text, review: null };
  const configInfo = reviewerConfig({ task, runtime });
  if (configInfo.raw.enabled !== true) return { text, review: null };

  const riskProfile = buildFinalAnswerReviewRiskProfile({ task, transcript, evidenceSummary });
  if (!riskProfile.required && configInfo.raw.mode !== "always") {
    runtime?.emitTaskEvent?.("final_reviewer_skipped", {
      reason: "risk_profile_not_required",
      risk_reasons: riskProfile.reasons
    });
    return { text, review: null };
  }
  if (configInfo.raw.mode !== "always" && artifactOnlyContractIsSatisfied({ task, transcript, riskProfile })) {
    runtime?.emitTaskEvent?.("final_reviewer_skipped", {
      reason: "artifact_only_contract_satisfied",
      risk_reasons: riskProfile.reasons
    });
    return { text, review: null };
  }

  const budget = resolveFinalAnswerReviewerBudget({ task, runtime, config: configInfo.loaded });
  const compactTranscript = compactTranscriptForComposer(transcript);
  if (text.length > budget.maxCandidateChars || compactTranscript.length > budget.maxTranscriptChars) {
    runtime?.emitTaskEvent?.("final_reviewer_skipped", {
      reason: "review_budget_exceeded",
      candidate_chars: text.length,
      transcript_chars: compactTranscript.length,
      budget
    });
    return { text, review: null };
  }

  const started = Date.now();
  runtime?.emitTaskEvent?.("final_reviewer_started", {
    reason: reason || "normal",
    risk_reasons: riskProfile.reasons,
    budget
  });

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener?.("abort", abortFromParent, { once: true });
  try {
    const raw = await withTimeout(
      runInjectedReviewer({ runtime, task, transcript, candidateText: text, reason, evidenceSummary, riskProfile })
        .then((injected) => injected ?? runProviderReviewer({
          task,
          transcript,
          runtime,
          candidateText: text,
          reason,
          signal: controller.signal,
          evidenceSummary,
          riskProfile
        })),
      budget.timeoutMs,
      () => controller.abort("final_answer_reviewer_timeout")
    );
    const review = normalizeFinalAnswerReview(raw);
    const reviewedText = applyFinalAnswerReview(text, review, {
      visibleWarnings: configInfo.raw.visibleWarnings !== false,
      task
    });
    runtime?.emitTaskEvent?.("final_reviewer_completed", {
      status: "completed",
      verdict: review.verdict,
      confidence: review.confidence,
      reason: review.reason,
      corrections: review.corrections,
      risk_reasons: riskProfile.reasons,
      duration_ms: Math.max(0, Date.now() - started),
      visible_note_applied: reviewedText !== text
    });
    return { text: reviewedText, review };
  } catch (error) {
    if (error?.code === "ABORT_ERR" && signal?.aborted) throw error;
    runtime?.emitTaskEvent?.("final_reviewer_completed", {
      status: error?.code === "FINAL_REVIEW_TIMEOUT" ? "timeout" : "failed",
      error_code: error?.code ?? "FINAL_REVIEW_ERROR",
      duration_ms: Math.max(0, Date.now() - started),
      risk_reasons: riskProfile.reasons
    });
    return { text, review: null };
  } finally {
    signal?.removeEventListener?.("abort", abortFromParent);
  }
}
