export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  history_share: 0.6,
  current_turn_share: 0.4,
  reserve_output_tokens: 4096
});

export const PER_EXECUTOR_OVERRIDES = Object.freeze({
  fast:        { history_share: 0.85, current_turn_share: 0.15 },
  tool_using:  { history_share: 0.4,  current_turn_share: 0.6  },
  agentic:     { history_share: 0.35, current_turn_share: 0.65 },
  translate:   { history_share: 0.2,  current_turn_share: 0.8  },
  multi_modal: { history_share: 0.5,  current_turn_share: 0.5  }
});

const MIN_MODEL_WINDOW = 2048;
const MIN_RESERVE = 256;

export function resolveContextBudget({ executor, modelContextWindow, taskTypeHint = null } = {}) {
  const base = PER_EXECUTOR_OVERRIDES[executor] ?? DEFAULT_CONTEXT_BUDGET;
  const requestedReserve = base.reserve_output_tokens ?? DEFAULT_CONTEXT_BUDGET.reserve_output_tokens;
  const window = Math.max(MIN_MODEL_WINDOW, Number(modelContextWindow) || 0);
  const reserve = Math.max(MIN_RESERVE, Math.min(requestedReserve, Math.floor(window / 2)));
  const usable = Math.max(0, window - reserve);
  const historyShare = base.history_share ?? DEFAULT_CONTEXT_BUDGET.history_share;
  const currentShare = base.current_turn_share ?? DEFAULT_CONTEXT_BUDGET.current_turn_share;
  return {
    executor: executor ?? "default",
    task_type_hint: taskTypeHint,
    history_tokens: Math.floor(usable * historyShare),
    current_tokens: Math.floor(usable * currentShare),
    reserve_output_tokens: reserve,
    policy_id: `${executor ?? "default"}/${taskTypeHint ?? "default"}`
  };
}

export function defaultTokenEstimator(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  // Cheap heuristic: 1 token ≈ 4 chars for mixed CJK / latin text. Provider
  // adapters can plug in a real tokenizer when latency matters.
  return Math.max(1, Math.ceil(text.length / 4));
}

export function pickHistoryWithinBudget(messages, tokenBudget, estimateTokens = defaultTokenEstimator) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const budget = Math.max(0, tokenBudget | 0);
  if (budget === 0) return [];

  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg?.content ?? "");
    if (used + tokens > budget && kept.length > 0) break;
    kept.push(msg);
    used += tokens;
    if (used >= budget) break;
  }
  return kept.reverse();
}
