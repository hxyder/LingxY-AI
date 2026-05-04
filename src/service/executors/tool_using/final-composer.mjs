import { createProviderAdapter } from "../agentic/provider-adapter.mjs";
import { resolveProviderForTask } from "../shared/provider-resolver.mjs";
import {
  evaluateActionObligations,
  findWaitingActionApproval,
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";
import {
  compactTranscriptForComposer,
  localFallbackFinal
} from "./finalization.mjs";

export async function composeFinalAnswer({ task, transcript, runtime, reason = "" }) {
  runtime?.emitTaskEvent?.("final_composer_started", { reason });
  const started = Date.now();
  try {
    const taskSpec = task?.task_spec ?? {};
    const waitingAction = findWaitingActionApproval(
      evaluateActionObligations(taskSpec, transcript)
    ) ?? findWaitingActionApprovalInTranscript(transcript);
    if (waitingAction) {
      return formatWaitingActionFinal({ task, obligation: waitingAction });
    }

    if (typeof runtime?.finalAnswerComposer === "function") {
      const composed = await runtime.finalAnswerComposer({ task, transcript, reason });
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
          `[Tool transcript]\n${compactTranscriptForComposer(transcript) || "(no tool transcript)"}`
        ].join("\n\n")
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
