import {
  resolveContextBudget,
  defaultTokenEstimator
} from "../../core/policy/context-budget.mjs";
import { renderHistoryMessages } from "./conversation-prompt.mjs";

const PARTIAL_HISTORY_SHARE = 0.3;
const STRUCTURED_HISTORY_TAIL_MESSAGE_LIMIT = 120;

export function resolveCurrentTriggerMessage({ runtime, task }) {
  if (!task?.task_id) return null;
  if (typeof runtime?.store?.getTaskMessages !== "function") return null;
  if (typeof runtime.store.getMessage !== "function") return null;

  const ownLinks = runtime.store.getTaskMessages(task.task_id) ?? [];
  const ownTriggered = ownLinks.find((l) => l.relation === "triggered");
  if (ownTriggered) {
    const msg = runtime.store.getMessage(ownTriggered.message_id);
    if (msg) return msg;
  }

  if (task.parent_task_id) {
    const parentLinks = runtime.store.getTaskMessages(task.parent_task_id) ?? [];
    const parentTriggered = parentLinks.find((l) => l.relation === "triggered");
    if (parentTriggered) {
      const msg = runtime.store.getMessage(parentTriggered.message_id);
      if (msg) return msg;
    }
  }

  return null;
}

export function groupMessagesIntoTurns(messages) {
  const turns = [];
  let current = null;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const isTrigger = m.role === "user" || m.role === "system";
    if (isTrigger) {
      if (current) turns.push(current);
      current = {
        triggerSeq: m.seq,
        messages: [m],
        anyPartial: Boolean(m.metadata?.partial)
      };
    } else if (current) {
      current.messages.push(m);
      if (m.metadata?.partial) current.anyPartial = true;
    } else {
      current = {
        triggerSeq: m.seq,
        messages: [m],
        anyPartial: Boolean(m.metadata?.partial)
      };
    }
  }
  if (current) turns.push(current);
  return turns;
}

function turnTokens(turn, estimateTokens) {
  let total = 0;
  for (const m of turn.messages) total += estimateTokens(m.content);
  return total;
}

function hasStructuredValue(message = {}) {
  const metadata = message.metadata && typeof message.metadata === "object"
    ? message.metadata
    : {};
  return message.role === "tool_summary"
    || (Array.isArray(metadata.artifact_paths) && metadata.artifact_paths.length > 0)
    || (metadata.evidence_summary && typeof metadata.evidence_summary === "object");
}

function isHighValueTurn(turn = {}) {
  return Array.isArray(turn.messages) && turn.messages.some(hasStructuredValue);
}

export function pickTurnsWithinBudget(turns, totalBudget, estimateTokens = defaultTokenEstimator, opts = {}) {
  if (!Array.isArray(turns) || turns.length === 0) return [];
  const partialShare = opts.partialShare ?? PARTIAL_HISTORY_SHARE;
  const budget = Math.max(0, totalBudget | 0);
  if (budget === 0) return [];

  const liveTurns = turns.filter((t) => !t.anyPartial);
  const partialTurns = turns.filter((t) => t.anyPartial);

  const keptLive = [];
  const keptLiveSeqs = new Set();
  let liveUsed = 0;
  const highValueLiveTurns = liveTurns.filter(isHighValueTurn);
  const normalLiveTurns = liveTurns.filter((turn) => !isHighValueTurn(turn));
  const addLiveTurn = (turn) => {
    if (!turn || keptLiveSeqs.has(turn.triggerSeq)) return false;
    const cost = turnTokens(turn, estimateTokens);
    if (liveUsed + cost > budget && keptLive.length > 0) return false;
    keptLive.push(turn);
    keptLiveSeqs.add(turn.triggerSeq);
    liveUsed += cost;
    return true;
  };

  addLiveTurn(normalLiveTurns[normalLiveTurns.length - 1]);
  for (let i = highValueLiveTurns.length - 1; i >= 0; i--) {
    addLiveTurn(highValueLiveTurns[i]);
    if (liveUsed >= budget) break;
  }
  if (liveUsed < budget) {
    for (let i = normalLiveTurns.length - 1; i >= 0; i--) {
      addLiveTurn(normalLiveTurns[i]);
      if (liveUsed >= budget) break;
    }
  }

  const partialCap = Math.min(Math.floor(budget * partialShare), Math.max(0, budget - liveUsed));
  const keptPartial = [];
  if (partialCap > 0) {
    let partialUsed = 0;
    for (let i = partialTurns.length - 1; i >= 0; i--) {
      const cost = turnTokens(partialTurns[i], estimateTokens);
      if (partialUsed + cost > partialCap && keptPartial.length > 0) break;
      keptPartial.push(partialTurns[i]);
      partialUsed += cost;
      if (partialUsed >= partialCap) break;
    }
  }

  const merged = [...keptLive, ...keptPartial].sort((a, b) => a.triggerSeq - b.triggerSeq);
  return merged.flatMap((t) => t.messages);
}

export function loadPriorMessagesBeforeTrigger({
  runtime,
  conversationId,
  trigger,
  limit = STRUCTURED_HISTORY_TAIL_MESSAGE_LIMIT
} = {}) {
  const boundedLimit = Math.max(1, Math.min(limit ?? STRUCTURED_HISTORY_TAIL_MESSAGE_LIMIT, 500));
  const beforeSeq = Number(trigger?.seq);
  if (!conversationId || !Number.isFinite(beforeSeq)) return [];

  if (typeof runtime?.store?.getConversationMessagesBefore === "function") {
    return runtime.store.getConversationMessagesBefore(conversationId, {
      beforeSeq,
      limit: boundedLimit
    }) ?? [];
  }

  if (typeof runtime?.store?.getConversationMessages === "function") {
    const sinceSeq = Math.max(0, beforeSeq - boundedLimit);
    return (runtime.store.getConversationMessages(conversationId, {
      sinceSeq,
      limit: boundedLimit
    }) ?? []).filter((message) => Number(message?.seq) < beforeSeq);
  }

  return [];
}

export function loadStructuredHistoryFor({ runtime, task, executor, modelContextWindow, estimateTokens = defaultTokenEstimator }) {
  if (task?.context_packet?.selection_metadata?.context_focus?.prior_context_suppressed === true
      && !task?.parent_task_id) {
    return {
      mode: "current_context_focus",
      reason: "explicit_current_context_suppressed_history",
      currentTriggerMessage: null,
      historyMessages: [],
      currentMessageRendered: null
    };
  }

  const trigger = resolveCurrentTriggerMessage({ runtime, task });
  if (!trigger) {
    return {
      mode: "legacy_fallback",
      reason: task?.conversation_id ? "no_triggered_link" : "no_conversation_id",
      currentTriggerMessage: null,
      historyMessages: [],
      currentMessageRendered: null
    };
  }

  if (typeof runtime?.store?.getConversationMessages !== "function") {
    return {
      mode: "legacy_fallback",
      reason: "store_lacks_getConversationMessages",
      currentTriggerMessage: trigger,
      historyMessages: [],
      currentMessageRendered: null
    };
  }

  const conversationId = trigger.conversation_id ?? task.conversation_id;
  const priorMessages = loadPriorMessagesBeforeTrigger({
    runtime,
    conversationId,
    trigger
  });
  const turns = groupMessagesIntoTurns(priorMessages);

  const budget = resolveContextBudget({ executor, modelContextWindow });
  const picked = pickTurnsWithinBudget(turns, budget.history_tokens, estimateTokens);

  const historyMessages = renderHistoryMessages(picked);
  const renderedTrigger = renderHistoryMessages([trigger]);
  const currentMessageRendered = renderedTrigger[0] ?? null;

  return {
    mode: "structured",
    reason: null,
    currentTriggerMessage: trigger,
    historyMessages,
    currentMessageRendered
  };
}
