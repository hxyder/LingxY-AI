/**
 * UCA-077 P2-05: Runtime executor resolution.
 *
 * `executor-resolver.mjs` (sibling) decides WHICH executor a task should
 * use; this module looks up the actual runtime handler for that decision
 * and applies capability fallbacks (e.g. agentic→fast when no chat
 * provider is configured).
 *
 * Replaces two byte-for-byte copies that were living in
 * `browser-submission.mjs:273` and `context-submission.mjs:301`. Keeping
 * them in sync by hand is exactly the kind of duplication the upgrade
 * plan called out (§1.3 "决策源太多, 行为不可预测").
 */

import {
  resolveProviderForTask,
  resolveCodeCliRuntimeForTask
} from "../../executors/shared/provider-resolver.mjs";

/**
 * @param {{ executor?: string }} task
 * @param {{ executors?: Array<{ id: string }>, kimiRuntime?: object }} runtime
 * @returns {object|null}  the runtime executor handler, or null if nothing matched
 */
export function pickRunnableExecutor(task, runtime) {
  const fast = () => runtime.executors?.find((executor) => executor.id === "fast") ?? null;
  const find = (id) => runtime.executors?.find((executor) => executor.id === id) ?? null;

  switch (task.executor) {
    case "multi_modal":
      return find("multi_modal") ?? fast();

    case "tool_using":
      return find("tool_using") ?? fast();

    case "agentic": {
      // Agentic executor accepts every provider kind. Native function-calling
      // providers (anthropic / openai / ollama) drive the planner directly;
      // code_cli providers go through the JSON planning-mode bridge in
      // code-cli-bridge.mjs. Falls back to fast only if no provider is
      // configured at all.
      const provider = resolveProviderForTask("chat");
      const agentic = find("agentic");
      if (agentic && provider) return agentic;
      return fast();
    }

    case "kimi":
    case "code_cli":
      if (!resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime)) return fast();
      return find(task.executor) ?? fast();

    default:
      return find(task.executor) ?? fast();
  }
}
