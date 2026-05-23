/**
 * Agentic executor — registers as `id: "agentic"` and delegates to the
 * provider-agnostic planner in `./planner.mjs`.
 *
 * Usage pattern from the submission layer:
 *   task.executor === "agentic"  → runtime.executors.find(id === "agentic").execute(task, {signal})
 *
 * The executor yields the same event shape as fast/tool_using/multi_modal
 * so the existing submission layer `runExecutor` function can consume it
 * without special-casing: step_started → tool_call_started → tool_call_completed
 * → artifact_created (zero or more) → inline_result → success.
 */

import { runAgenticPlanner } from "./planner.mjs";
import { detectRequestedOutputFormatForTask } from "../kimi/output-format.mjs";

export function createAgenticExecutorScaffold() {
  return {
    id: "agentic",
    model: "provider_adapter",
    supportsStreaming: true,
    maxIterations: 8,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Agentic executor cancelled."), { code: "ABORT_ERR" });
      }

      yield { event_type: "step_started", payload: { step: "agentic_planner", progress: 0.05 } };

      const runtime = task.__runtime;
      if (!runtime) {
        yield {
          event_type: "success",
          payload: { text: "Agentic executor missing runtime context." }
        };
        return;
      }

      // Stream planner events via a queue so the planner can call onEvent()
      // synchronously from inside its loop while we `yield` them lazily to
      // the caller.
      const pending = [];
      let resolvePending = null;
      let plannerDone = false;
      let plannerError = null;
      let plannerResult = null;

      const onEvent = (event) => {
        pending.push(event);
        if (resolvePending) {
          const resolve = resolvePending;
          resolvePending = null;
          resolve();
        }
      };

      const requestedFormat = detectRequestedOutputFormatForTask(task);

      const runPromise = runAgenticPlanner({
        task,
        runtime,
        requestedFormat,
        signal,
        onEvent
      }).then((result) => {
        plannerResult = result;
      }).catch((error) => {
        plannerError = error;
      }).finally(() => {
        plannerDone = true;
        if (resolvePending) {
          const resolve = resolvePending;
          resolvePending = null;
          resolve();
        }
      });

      while (true) {
        if (pending.length > 0) {
          yield pending.shift();
          continue;
        }
        if (plannerDone) break;
        await new Promise((resolve) => { resolvePending = resolve; });
      }

      await runPromise;

      if (plannerError) {
        if (plannerError.code === "ABORT_ERR") throw plannerError;
        yield {
          event_type: "success",
          payload: { text: `Agentic planner error: ${plannerError.message}` }
        };
        return;
      }

      const result = plannerResult ?? { finalText: "(no result)", artifactPaths: [], downgraded: false };

      yield {
        event_type: "step_finished",
        payload: { step: "agentic_planner", progress: 0.95 }
      };
      yield {
        event_type: "inline_result",
        payload: { text: result.finalText, downgraded: Boolean(result.downgraded) }
      };
      // H1a: when the planner downgraded (truthfulness guard OR
      // SuccessContract violation), emit partial_success so the runtime's
      // applyExecutorEvent stamps task.status="partial_success". Pre-H1
      // the executor always yielded success, which silently re-promoted
      // the planner's downgrade decision back to success at the runtime
      // layer — same shape of bug G6a fixed in the submission paths.
      yield {
        event_type: (result.downgraded || result.waiting_external_decision) ? "partial_success" : "success",
        payload: {
          text: result.finalText,
          summary: (result.finalText || "").slice(0, 200),
          artifact_paths: result.artifactPaths ?? [],
          downgraded: Boolean(result.downgraded),
          sub_status: result.waiting_external_decision ? "waiting_external_decision" : undefined,
          pendingApproval: result.pendingApproval ?? null,
          obligations: result.obligations ?? null,
          violations: result.violations ?? null,
          evidence_summary: result.evidence_summary ?? null
        }
      };
    }
  };
}
