import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pricing from "./pricing.json" with { type: "json" };

function percent(value, total) {
  if (!total) {
    return 0;
  }
  return (value / total) * 100;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBudgetState(raw = {}) {
  return {
    limits: {
      ...pricing.defaults,
      ...(raw.limits ?? {})
    },
    spent: {
      this_month_usd: 0,
      this_month_tokens_in: 0,
      this_month_tokens_out: 0,
      ...(raw.spent ?? {})
    }
  };
}

export function createBudgetManager(initialSpent = {
  this_month_usd: 0,
  this_month_tokens_in: 0,
  this_month_tokens_out: 0
}, {
  stateFilePath = null
} = {}) {
  if (stateFilePath) {
    mkdirSync(path.dirname(stateFilePath), { recursive: true });
  }

  const persisted = stateFilePath && existsSync(stateFilePath)
    ? JSON.parse(readFileSync(stateFilePath, "utf8"))
    : null;
  const state = {
    ...normalizeBudgetState({
      limits: persisted?.limits,
      spent: persisted?.spent ?? initialSpent
    })
  };

  function persist() {
    if (!stateFilePath) {
      return;
    }
    writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  return {
    getState() {
      return clone(state);
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
      persist();
      return this.preview({
        ...costEstimate,
        usd: 0
      });
    },
    setLimits(patch = {}) {
      state.limits = {
        ...state.limits,
        ...patch
      };
      persist();
      return this.getState();
    }
  };
}
