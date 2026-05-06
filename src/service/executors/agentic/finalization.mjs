import {
  detectUnbackedActionClaims,
  selectSuccessContractValidationSpec,
  validateAnswerSynthesis,
  validateSuccessContract
} from "../../core/policy/success-contract-validator.mjs";
import { extractEvidence } from "../../core/policy/evidence-normalizer.mjs";
import {
  citationViolations,
  verifyCitations
} from "../../core/evidence/citation-verifier.mjs";
import {
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";
import { transcriptForValidator } from "./validator-transcript.mjs";

const COMPLETION_CLAIM_PATTERNS = [
  /\b(?:done|finished|completed|saved|written|created|generated|launched|opened|executed|ran|published|sent)\b/i,
  /(?:已完成|已保存|已生成|已写入|已创建|已启动|已打开|已运行|已执行|已发送|完成了|创建了|生成了|写好了)/
];

function claimsCompletion(text = "") {
  return COMPLETION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function anyToolSucceeded(transcript = []) {
  return transcript.some((entry) => entry.role === "tool" && entry.success === true);
}

export function finalizeAgenticPlannerRun({
  task,
  finalText = "",
  transcript = [],
  earlyExitState = null,
  artifactPaths = [],
  descriptor = null,
  iterations = 0
} = {}) {
  let outputText = finalText;
  let downgraded = false;
  let violations = null;
  const validatorTranscript = transcriptForValidator(transcript);
  const validationSpec = selectSuccessContractValidationSpec(task);
  const actionObligationTerminal = earlyExitState?.kind === "action_obligation_terminal"
    ? earlyExitState.obligations
    : null;
  const waitingObligation = earlyExitState?.kind === "waiting_external_decision"
    ? earlyExitState.obligation
    : findWaitingActionApprovalInTranscript(validatorTranscript);
  const waitingExternalDecision = Boolean(waitingObligation);
  if (waitingExternalDecision) {
    outputText = formatWaitingActionFinal({ task, obligation: waitingObligation });
  }
  if (actionObligationTerminal?.length > 0) {
    downgraded = true;
    violations = (violations ?? []).concat(actionObligationTerminal.map((obligation) => ({
      kind: `${obligation.group}_${obligation.status}`,
      message: `Required action obligation ${obligation.group} ended as ${obligation.status}: ${obligation.reason ?? ""}`.trim()
    })));
  }

  if (!waitingExternalDecision && outputText && claimsCompletion(outputText) && !anyToolSucceeded(transcript)) {
    downgraded = true;
    outputText = `⚠️ The model claimed the task was completed, but no tool in this run returned success. The claim has been downgraded to "partial". See the transcript for what actually happened.\n\n---\n\n${outputText}`;
  }
  const actionClaimViolations = waitingExternalDecision
    ? []
    : detectUnbackedActionClaims(validatorTranscript, outputText);
  if (actionClaimViolations.length > 0) {
    downgraded = true;
    violations = (violations ?? []).concat(actionClaimViolations);
    const banners = actionClaimViolations.map((violation) => {
      const group = violation.kind.replace(/_claim_unsupported$/, "");
      if (group === "email_send") {
        return "⚠️ 邮件实际并未发送。系统未检测到任何成功的邮件发送工具调用，下面的文字是模型自述。";
      }
      if (group === "calendar_create") {
        return "⚠️ 日程/事件实际并未创建。下面的文字仅为模型自述。";
      }
      if (group === "file_upload") {
        return "⚠️ 文件实际并未上传。下面的文字仅为模型自述。";
      }
      return "⚠️ 模型声称完成了一项操作，但系统未检测到对应工具的成功调用。下面的文字是模型自述。";
    });
    outputText = `${banners.join("\n")}\n\n---\n\n${outputText || ""}`;
  }

  const contract = (waitingExternalDecision || actionObligationTerminal?.length > 0)
    ? { satisfied: true, violations: [] }
    : validateSuccessContract(validationSpec, validatorTranscript);
  if (!contract.satisfied) {
    downgraded = true;
    violations = (violations ?? []).concat(contract.violations);
    const reasons = contract.violations.map((violation) => violation.message).join(" ");
    outputText = `[LingxY] 注意：未通过 SuccessContract 校验：${reasons}\n\n${outputText || ""}`;
  }

  const synthesisViolations = waitingExternalDecision
    ? []
    : validateAnswerSynthesis(
      validationSpec,
      validatorTranscript,
      outputText
    );
  if (synthesisViolations.length > 0) {
    downgraded = true;
    violations = (violations ?? []).concat(synthesisViolations);
    const reason = synthesisViolations[0].message;
    outputText = `[LingxY] 注意：${reason}\n\n${outputText || ""}`;
  }

  const extractedEvidence = extractEvidence(validatorTranscript);
  const citations = verifyCitations(outputText, extractedEvidence.sources);
  const evidenceSummary = {
    ...extractedEvidence,
    citations
  };
  const advisoryCitationViolations = citationViolations(citations);
  if (advisoryCitationViolations.length > 0) {
    violations = (violations ?? []).concat(advisoryCitationViolations);
  }

  let phaseGate = null;
  let errorBudgetDiag = null;
  if (earlyExitState
      && earlyExitState.kind !== "waiting_external_decision"
      && earlyExitState.kind !== "action_obligation_terminal") {
    downgraded = true;
    if (earlyExitState.kind === "error_budget_exhausted") {
      errorBudgetDiag = earlyExitState.error_budget;
      outputText = `[LingxY] 阶段提前结束：error_budget exhausted (${errorBudgetDiag.event} at iteration ${errorBudgetDiag.iteration}). ${errorBudgetDiag.reason}\n\n${outputText || ""}`;
    } else if (earlyExitState.kind === "phase_gate_abort"
        || earlyExitState.kind === "phase_gate_escalate") {
      phaseGate = earlyExitState.phase_gate;
      const kindLabel = phaseGate.next_action;
      const violationKinds = (phaseGate.violations ?? []).map((violation) => violation.kind).join(", ") || "(none)";
      const runbookHint = phaseGate.runbook_suggested
        ? ` Runbook recommended: ${phaseGate.runbook_suggested}.`
        : "";
      outputText = `[LingxY] 阶段提前结束：phase_gate ${kindLabel} at iteration ${phaseGate.iteration} (violations: ${violationKinds}).${runbookHint}\n\n${outputText || ""}`;
    }
  }

  return {
    success: !waitingExternalDecision && !downgraded && Boolean(outputText),
    finalText: outputText || "(no response from agentic planner)",
    toolCalls: transcript.filter((entry) => entry.role === "tool"),
    artifactPaths,
    provider_descriptor: descriptor,
    iterations: iterations + 1,
    downgraded,
    waiting_external_decision: waitingExternalDecision,
    pendingApproval: waitingObligation?.approval ?? null,
    obligations: waitingObligation ? [waitingObligation] : null,
    violations,
    evidence_summary: evidenceSummary,
    phase_gate: phaseGate,
    error_budget: errorBudgetDiag
  };
}
