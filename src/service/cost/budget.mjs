import pricing from "./pricing.json" with { type: "json" };

function percent(value, total) {
  if (!total) {
    return 0;
  }
  return (value / total) * 100;
}

export function createBudgetManager(initialSpent = {
  this_month_usd: 0,
  this_month_tokens_in: 0,
  this_month_tokens_out: 0
}) {
  const state = {
    limits: { ...pricing.defaults },
    spent: { ...initialSpent }
  };

  return {
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
    preview(costEstimate) {
      const nextUsd = state.spent.this_month_usd + costEstimate.usd;
      const limitPercent = percent(nextUsd, state.limits.monthly_usd_limit);
      return {
        allowed: nextUsd <= state.limits.monthly_usd_limit,
        warn: limitPercent >= state.limits.warn_at_percent,
        hardStop: limitPercent >= state.limits.hard_stop_at_percent,
        nextUsd,
        limitPercent
      };
    },
    apply(costEstimate) {
      state.spent.this_month_usd = Number((state.spent.this_month_usd + costEstimate.usd).toFixed(6));
      state.spent.this_month_tokens_in += costEstimate.tokensIn;
      state.spent.this_month_tokens_out += costEstimate.tokensOut;
      return this.preview({
        ...costEstimate,
        usd: 0
      });
    }
  };
}
