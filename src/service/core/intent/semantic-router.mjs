/**
 * UCA-077 P4-02 (plan §12.7 / §13.2-A / §18.3): Semantic router.
 *
 * The SemanticRouter is the LLM-driven understanding layer. It takes the
 * user's text plus the context packet plus the existing signal bundle,
 * asks a strict-schema chat model to map them onto a routing decision
 * (source_scope / web_policy / output_kind / executor), and returns that
 * decision to the caller — typically tool-policy-resolver (P4-03).
 *
 * Critical contract — what this module is NOT:
 *
 *   - It is NOT a final authority. The registry policy guard, the
 *     resolver invariants, and the success-contract validator are still
 *     the only enforcement points. SemanticRouter only suggests.
 *   - It does NOT bypass hard facts. If `signals.source_scope.kind ===
 *     "fact"` says local AND the LLM says web=required, the router
 *     rejects its own LLM output rather than escalate. Hard facts beat
 *     soft inferences (§18.3 design constraint).
 *   - It is FAIL-SAFE. Any failure path (disabled / no provider /
 *     timeout / schema error / low confidence / fact conflict /
 *     exception) returns a `{kind:"rejection", code, reason}` object
 *     instead of throwing. The caller is expected to silently fall back
 *     to the Phase 1-3 regex resolver and to record the rejection on
 *     the DecisionTrace under the SEMANTIC_ROUTER stage (P4-07).
 *
 * P4-03 will wire the default adapter via provider-adapter.mjs; P4-05
 * adds the env-flag kill switch; P4-06 adds the daily-budget counter;
 * P4-07 adds the DecisionTrace stage. This file ships with all those
 * extension points but stays minimal: the public API + cache + timeout
 * + schema check + the four hard-fail paths.
 */

import crypto from "node:crypto";

import { SIGNAL_KINDS } from "./signals/index.mjs";

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_CACHE_TTL_MS = 300_000; // 5 minutes
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

const SOURCE_SCOPES = Object.freeze([
  "none", "selection", "uploaded_files", "current_context",
  "local_project", "browser_page", "external_world"
]);
const WEB_POLICY_MODES = Object.freeze(["forbidden", "optional", "required"]);
const OUTPUT_KINDS = Object.freeze([
  "conversation", "markdown", "file", "docx", "pptx", "xlsx", "pdf",
  "html", "csv", "dashboard"
]);
const EXECUTORS = Object.freeze([
  "fast", "tool_using", "agentic", "translate", "multi_modal", "kimi"
]);
// P4-RQ C2: research_depth is a SUGGESTION the LLM emits alongside
// web_policy. `single_lookup` ⇒ "this is a single fact / single URL
// summary"; `multi_source` ⇒ "this is research / news / comparison /
// competitor / open-source survey — independent sources matter";
// `unknown` ⇒ "model isn't confident enough to label". Resolver copies
// it onto tool_policy.research_hint for downstream observability;
// no determinism rests on it.
const RESEARCH_DEPTHS = Object.freeze(["single_lookup", "multi_source", "unknown"]);

/**
 * The strict tool-input schema the LLM must satisfy. Embedded in the
 * tool_use call so providers that support function-calling enforce
 * structure server-side; client-side `validateDecision` is the second
 * line of defense against providers that softly comply.
 */
export const SEMANTIC_DECISION_TOOL = Object.freeze({
  name: "route_task",
  description: "Classify the user's request along the routing axes UCA needs.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      source_scope: { type: "string", enum: [...SOURCE_SCOPES] },
      web_policy: { type: "string", enum: [...WEB_POLICY_MODES] },
      output_kind: { type: "string", enum: [...OUTPUT_KINDS] },
      artifact_required: { type: "boolean" },
      executor: { type: "string", enum: [...EXECUTORS] },
      research_depth: { type: "string", enum: [...RESEARCH_DEPTHS] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", maxLength: 400 }
    },
    required: ["source_scope", "web_policy", "output_kind", "artifact_required", "executor", "research_depth", "confidence", "reason"]
  }
});

/**
 * @typedef {Object} SemanticDecision
 * @property {typeof SOURCE_SCOPES[number]}     source_scope
 * @property {typeof WEB_POLICY_MODES[number]}  web_policy
 * @property {typeof OUTPUT_KINDS[number]}      output_kind
 * @property {boolean}                          artifact_required
 * @property {typeof EXECUTORS[number]}         executor
 * @property {typeof RESEARCH_DEPTHS[number]}   research_depth
 * @property {number}                           confidence
 * @property {string}                           reason
 */

/**
 * @typedef {{ kind: "decision", decision: SemanticDecision, source: "cache"|"provider" }
 *         | { kind: "rejection", code: RejectionCode, reason: string }} RouterResult
 *
 * @typedef {"disabled"|"no_provider"|"unsupported_provider"|"timeout"
 *           |"schema_invalid"|"low_confidence"|"fact_conflict"|"exception"} RejectionCode
 */

/**
 * Provider kinds whose tool_use schema enforcement is unreliable enough
 * that SemanticRouter refuses them rather than risk degraded LLM
 * judgment. The result is `{kind:"rejection", code:"unsupported_provider"}`
 * — caller (resolver merge layer) falls back to deterministic baseline.
 *
 *   - `code_cli`: bridge encodes tool calls as JSON in free-form text;
 *     no schema enforcement, prone to drift.
 *   - `ollama`: tool support varies by Ollama version + model; no
 *     `tool_choice` plumbing today, so the LLM can skip the route_task
 *     tool entirely → schema_invalid noise.
 *
 * Tracked in §19: add tool_choice support to Ollama once we standardize
 * on a model + Ollama version that reliably honours it.
 */
const UNSUPPORTED_FOR_SEMANTIC_ROUTER = Object.freeze(new Set(["code_cli", "ollama"]));

/**
 * Build a fresh router with injected dependencies. The default adapter
 * + cache + clock are wired by `getDefaultRouter()` so production code
 * uses one process-wide cache; tests pass overrides for determinism.
 *
 * @param {object} opts
 * @param {object} [opts.adapter]        provider adapter; { generate({ messages, tools, tool_choice, maxTokens }) → { tool_calls: [{name,arguments}] } }
 * @param {() => boolean} [opts.isEnabled]   gating function (default: env SEMANTIC_ROUTER_DISABLED)
 * @param {() => number} [opts.now]          clock (default: Date.now)
 * @param {Map} [opts.cache]              cache instance (default: fresh Map)
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.cacheTtlMs]
 * @param {number} [opts.confidenceThreshold]
 */
export function createSemanticRouter(opts = {}) {
  const adapter = opts.adapter ?? null;
  const isEnabled = typeof opts.isEnabled === "function"
    ? opts.isEnabled
    : () => process.env.SEMANTIC_ROUTER_DISABLED !== "1";
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const cache = opts.cache instanceof Map ? opts.cache : new Map();
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = Number.isFinite(opts.cacheTtlMs) ? opts.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const confidenceThreshold = Number.isFinite(opts.confidenceThreshold)
    ? opts.confidenceThreshold
    : DEFAULT_CONFIDENCE_THRESHOLD;

  /**
   * @param {{ text: string, contextPacket?: object, signals?: object }} input
   * @returns {Promise<RouterResult>}
   */
  async function resolveSemanticDecision({ text, contextPacket = {}, signals = {} } = {}) {
    if (!isEnabled()) {
      return reject("disabled", "SemanticRouter disabled via SEMANTIC_ROUTER_DISABLED=1 or config");
    }
    if (!adapter || typeof adapter.generate !== "function") {
      return reject("no_provider", "No chat provider adapter wired into SemanticRouter");
    }

    const cacheKey = buildCacheKey({ text, contextPacket, signals });
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.ts < cacheTtlMs) {
      // P4-02.x C0: cache safety net. The cache key already encodes signal
      // shape (so different signals → different keys), but we also re-run
      // detectHardFactConflict on the cached decision in case the signal
      // bundle changed after the cache was primed in a way the hash
      // didn't capture (e.g. a producer started emitting a fact that
      // contradicts the cached "required"). Fail-closed: drop the entry
      // and treat as a miss when conflict detected.
      const conflict = detectHardFactConflict(cached.decision, signals);
      if (!conflict) {
        return { kind: "decision", decision: cached.decision, source: "cache" };
      }
      cache.delete(cacheKey);
      // fall through to fresh provider call
    }

    let raw;
    try {
      raw = await callWithTimeout(
        adapter.generate({
          messages: buildMessages({ text, contextPacket, signals }),
          tools: [SEMANTIC_DECISION_TOOL],
          tool_choice: { type: "tool", name: SEMANTIC_DECISION_TOOL.name },
          maxTokens: 256
        }),
        timeoutMs
      );
    } catch (err) {
      if (err && err.code === "SEMANTIC_ROUTER_TIMEOUT") {
        return reject("timeout", `Adapter exceeded ${timeoutMs}ms`);
      }
      return reject("exception", err?.message ?? String(err));
    }

    const decision = extractDecisionArguments(raw);
    if (!decision) {
      return reject("schema_invalid", "Adapter returned no usable tool_call args");
    }

    const validation = validateDecision(decision);
    if (!validation.ok) {
      return reject("schema_invalid", validation.reason);
    }

    if (decision.confidence < confidenceThreshold) {
      return reject("low_confidence",
        `Confidence ${decision.confidence.toFixed(2)} below threshold ${confidenceThreshold}`);
    }

    const conflict = detectHardFactConflict(decision, signals);
    if (conflict) {
      return reject("fact_conflict", conflict);
    }

    cache.set(cacheKey, { decision, ts: now() });
    return { kind: "decision", decision, source: "provider" };
  }

  return {
    resolveSemanticDecision,
    // expose for tests / diagnostics
    _cache: cache
  };
}

// P4-03 follow-up: a process-wide cache shared across calls. We rebuild
// the router each time `resolveSemanticDecision` runs (provider config
// can hot-reload at runtime, so the adapter must be looked up live)
// but the cache survives so repeat queries hit fast paths.
const _processCache = new Map();

/**
 * No-provider router. Returned by getDefaultRouter when there's no
 * configured chat provider — every call to resolveSemanticDecision
 * yields `{kind:"rejection", code:"no_provider"}`. Tests that want a
 * mock adapter should use `createSemanticRouter` directly with their
 * own injected adapter.
 */
let _noProviderRouter = null;
function getNoProviderRouter() {
  if (!_noProviderRouter) _noProviderRouter = createSemanticRouter({ cache: _processCache });
  return _noProviderRouter;
}

/**
 * Process-wide router factory. Returns the no-provider router by default.
 * `resolveSemanticDecision` does the smart dispatch: provider lookup,
 * kind filtering (code_cli / ollama → unsupported_provider rejection),
 * adapter build, dispatch — all wrapped in fail-soft try/catch.
 *
 * Kept as a public helper for tests / direct use; production code goes
 * through `resolveSemanticDecision`.
 */
export async function getDefaultRouter() {
  return getNoProviderRouter();
}

/**
 * @param {{ text: string, contextPacket?: object, signals?: object }} input
 * @returns {Promise<RouterResult>}
 */
export async function resolveSemanticDecision(input) {
  // Top-level disabled check: if the operator turned SR off via env,
  // we don't even look up the provider. Returns `disabled` rejection
  // immediately so the inspect-routing UI shows operator intent
  // unambiguously (vs. unsupported_provider / no_provider, which mean
  // different things).
  if (process.env.SEMANTIC_ROUTER_DISABLED === "1") {
    return reject("disabled", "SemanticRouter disabled via SEMANTIC_ROUTER_DISABLED=1.");
  }

  let resolved;
  try {
    const { resolveProviderForTask } = await import("../../executors/shared/provider-resolver.mjs");
    resolved = resolveProviderForTask("chat");
  } catch (err) {
    return reject("exception", `provider lookup failed: ${err?.message ?? String(err)}`);
  }

  if (!resolved) {
    return reject("no_provider", "No chat provider configured.");
  }
  if (UNSUPPORTED_FOR_SEMANTIC_ROUTER.has(resolved.kind)) {
    // Distinguishable from no_provider so the inspect-routing UI can
    // tell the operator a provider IS configured but the kind is not
    // wired for SR yet. Reason text is short and operator-facing.
    return reject(
      "unsupported_provider",
      `Provider kind '${resolved.kind}' does not reliably support tool_use schema enforcement; SR skipped.`
    );
  }

  let adapter;
  try {
    const { createProviderAdapter } = await import("../../executors/agentic/provider-adapter.mjs");
    adapter = createProviderAdapter(resolved);
  } catch (err) {
    return reject("exception", `adapter build failed: ${err?.message ?? String(err)}`);
  }

  const router = createSemanticRouter({ adapter, cache: _processCache });
  return router.resolveSemanticDecision(input);
}

/**
 * Test/admin helper — clear the process-wide cache. Production code
 * never calls this; the cache is bound to process lifetime.
 */
export function _resetDefaultRouterState() {
  _processCache.clear();
  _noProviderRouter = null;
}

// ────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────

function reject(code, reason) {
  return { kind: "rejection", code, reason: String(reason ?? "") };
}

function buildMessages({ text, contextPacket, signals }) {
  // System prompt is intentionally short and policy-shaped: tell the LLM
  // exactly what each enum value means so it doesn't drift. The full
  // schema is enforced server-side via the tool_use input_schema.
  const system = [
    "You are LingxY's routing classifier. Read the user's request plus the context packet and signal bundle, then call `route_task` ONCE with your best assessment.",
    "",
    "Field guidance:",
    "- source_scope: pick the *most specific* scope. uploaded_files / selection beat current_context; current_context beats local_project; local_project beats none. external_world is for explicit online research.",
    "- web_policy: required only if the answer demands fresh external data the system does not already have; optional if a search would help but isn't critical; forbidden when the request is local-only or you have no signal that the user wants the open web.",
    "- output_kind: conversation for chat replies; pick the file kind (docx/pptx/xlsx/pdf/markdown/...) when the user asked for a document.",
    "- executor: fast for short conversational answers; tool_using for tool-driven actions; agentic for multi-step planning with artifacts; multi_modal for image-led tasks.",
    "- research_depth: `single_lookup` when the user asks for one fact / one URL / one article (weather, stock price, a specific page they shared, single-fact recall). `multi_source` when independent sources matter — news, current events, competitor research, open-source surveys, comparison shopping, fact-checking, market/price scans. `unknown` only when web_policy is `forbidden` or you genuinely cannot tell.",
    "- confidence: be honest. 0.5 means \"could go either way\", 0.9 means \"only one reading fits\". Low confidence triggers a fallback to the deterministic resolver.",
    "- reason: one short sentence in the user's language; this is shown to the operator, not the user.",
    "",
    "**Context source ranking** — `context_sources` separates real local content from background-only blocks. `real_selection`, `browser_page`, `file_text`, `uploaded_files`, `uploaded_images` are local-only anchors: they constrain the task to local data and you should NOT pick web_policy=required just because the user attached something. `conversation_history`, `rag_background`, `parent_task_context` are BACKGROUND-ONLY: they are previous turns or memory recalls injected for continuity. Never treat them as the user's current selection. A weather/news/stock question with only background_only sources still needs `web_policy=required`.",
    "",
    "**Signal-kind ranking** — fact > hint > assumption. A signal with `kind=fact` (e.g. `source_scope` from an attachment) is ground truth and you should not overrule it. `hint` is an explicit phrase pattern in the user text — strong but conventional. `assumption` is the system interpreting an indirect reference (e.g. \"这个\" → current_context); you may second-guess if other signals contradict."
  ].join("\n");

  // Strip out fields we don't want to feed the model. ctx.text and url
  // are deliberately summarized rather than dumped verbatim — the
  // resource-context trust split (P4-00.5) keeps untrusted page content
  // out of system prompts; the same principle applies here.
  //
  // P4-02.x C5: prefer the C1 `context_sources` classifier output over
  // the legacy `has_text` / `text_chars` summary. The classifier
  // distinguishes real selection from RAG / conversation history /
  // parent digest, which the LLM needs to make the right web_policy
  // call. Falls back to the legacy shape if the orchestrator hasn't
  // wired the classifier (defensive — should always be present after
  // C1 lands).
  const sources = contextPacket?.context_sources;
  const ctxSummary = sources
    ? {
        context_sources: sources,
        file_paths: Array.isArray(contextPacket?.file_paths) ? contextPacket.file_paths : [],
        image_paths: Array.isArray(contextPacket?.image_paths) ? contextPacket.image_paths : [],
        url: contextPacket?.url ?? null,
        source_app: contextPacket?.source_app ?? null
      }
    : {
        has_text: typeof contextPacket?.text === "string" && contextPacket.text.trim().length > 0,
        text_chars: typeof contextPacket?.text === "string" ? contextPacket.text.length : 0,
        file_paths: Array.isArray(contextPacket?.file_paths) ? contextPacket.file_paths : [],
        image_paths: Array.isArray(contextPacket?.image_paths) ? contextPacket.image_paths : [],
        has_url: typeof contextPacket?.url === "string" && contextPacket.url.length > 0,
        source_app: contextPacket?.source_app ?? null
      };

  const signalSummary = summariseSignals(signals);

  const user = [
    `User text: ${JSON.stringify(text ?? "")}`,
    `Context packet: ${JSON.stringify(ctxSummary)}`,
    `Signal bundle (regex-derived facts/hints/assumptions): ${JSON.stringify(signalSummary)}`
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

/**
 * Compact view of the signal bundle for the LLM. Drops Evidence detail
 * to keep prompts small and adds the SignalKind annotation so the model
 * can weigh fact > hint > assumption.
 */
function summariseSignals(signals) {
  if (!signals || typeof signals !== "object") return {};
  const out = {};
  for (const [name, signal] of Object.entries(signals)) {
    if (!signal || !signal.matched) continue;
    out[name] = {
      strength: signal.strength,
      kind: signal.kind,
      hint: signal.hint ?? null
    };
  }
  return out;
}

function buildCacheKey({ text, contextPacket, signals }) {
  const parts = {
    text: String(text ?? ""),
    file_paths: [...(contextPacket?.file_paths ?? [])].sort(),
    has_image: Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0,
    has_text: typeof contextPacket?.text === "string" && contextPacket.text.trim().length > 0,
    url: contextPacket?.url ?? null,
    source_app: contextPacket?.source_app ?? null,
    // P4-02.x C0: signal shape must differentiate cache entries. A cached
    // "web=required" decision MUST NOT be served when a later call arrives
    // with a fact-kind source_scope that contradicts it. Including the
    // shape (not the full evidence) keeps the hash stable across noisy
    // evidence rewrites while still differentiating the fact/hint/scope
    // axes that drive hard-fact conflict detection.
    signal_shape: summariseSignalsForCache(signals),
    // Forward-compat: when C1 ships, context_sources reflects whether the
    // text is real selection vs background. Different sources → different
    // cache entry. Until C1 lands, this is undefined and the key just
    // shrinks naturally.
    context_sources: contextPacket?.context_sources ?? null
  };
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Compact signal summary for cache key purposes — only the axes that
 * influence routing decisions, in stable key order.
 */
function summariseSignalsForCache(signals) {
  if (!signals || typeof signals !== "object") return null;
  const summary = {};
  const names = Object.keys(signals).sort();
  for (const name of names) {
    const signal = signals[name];
    if (!signal || !signal.matched) continue;
    summary[name] = {
      strength: signal.strength ?? null,
      kind: signal.kind ?? null,
      hint_value: signal.hint?.value ?? null
    };
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

function callWithTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const err = new Error("SemanticRouter call timed out");
      err.code = "SEMANTIC_ROUTER_TIMEOUT";
      reject(err);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Pull tool-call arguments out of an adapter response. Tolerates the
 * standard shapes — { tool_calls: [{ name, arguments }] } where args
 * may be an object (anthropic / openai SDK output) or a JSON string
 * (some code_cli bridges).
 */
function extractDecisionArguments(raw) {
  if (!raw || typeof raw !== "object") return null;
  const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
  const call = calls.find((c) => c && c.name === SEMANTIC_DECISION_TOOL.name) ?? calls[0];
  if (!call) return null;
  const args = call.arguments;
  if (args && typeof args === "object") return args;
  if (typeof args === "string") {
    try { return JSON.parse(args); } catch { return null; }
  }
  return null;
}

function validateDecision(decision) {
  if (!decision || typeof decision !== "object") {
    return { ok: false, reason: "decision is not an object" };
  }
  const required = SEMANTIC_DECISION_TOOL.input_schema.required;
  for (const field of required) {
    if (!(field in decision)) {
      return { ok: false, reason: `missing required field: ${field}` };
    }
  }
  if (!SOURCE_SCOPES.includes(decision.source_scope)) {
    return { ok: false, reason: `source_scope=${decision.source_scope} not in enum` };
  }
  if (!WEB_POLICY_MODES.includes(decision.web_policy)) {
    return { ok: false, reason: `web_policy=${decision.web_policy} not in enum` };
  }
  if (!OUTPUT_KINDS.includes(decision.output_kind)) {
    return { ok: false, reason: `output_kind=${decision.output_kind} not in enum` };
  }
  if (typeof decision.artifact_required !== "boolean") {
    return { ok: false, reason: "artifact_required must be boolean" };
  }
  if (!EXECUTORS.includes(decision.executor)) {
    return { ok: false, reason: `executor=${decision.executor} not in enum` };
  }
  if (!RESEARCH_DEPTHS.includes(decision.research_depth)) {
    return { ok: false, reason: `research_depth=${decision.research_depth} not in enum` };
  }
  if (typeof decision.confidence !== "number"
      || decision.confidence < 0 || decision.confidence > 1) {
    return { ok: false, reason: "confidence must be a number in [0, 1]" };
  }
  if (typeof decision.reason !== "string") {
    return { ok: false, reason: "reason must be a string" };
  }
  return { ok: true };
}

const LOCAL_SCOPES = new Set(["uploaded_files", "current_context", "local_project", "selection"]);

/**
 * Hard-fact conflict — when the LLM's decision contradicts a signal
 * annotated with `kind:"fact"`. Rejected because facts beat soft
 * inferences (§18.3): if the user attached files (fact-source-scope
 * = uploaded_files), the LLM cannot say web=required for that task.
 *
 * @returns {string|null}  rejection reason, or null when no conflict
 */
function detectHardFactConflict(decision, signals) {
  if (!signals || typeof signals !== "object") return null;

  // P4-RQ E1: user explicitly forbade browsing — LLM web_policy
  // anything other than `forbidden` is a hard-fact conflict. The
  // signal is kind=fact (literal user statement); SR doesn't get
  // to second-guess.
  const noSearch = signals.explicit_no_search;
  if (noSearch?.matched && noSearch.kind === "fact" && decision.web_policy !== "forbidden") {
    return `signals.explicit_no_search (kind=fact) is set; LLM web_policy=${decision.web_policy} would override an explicit user constraint`;
  }

  const sourceScope = signals.source_scope;
  if (!sourceScope?.matched || sourceScope.kind !== "fact") return null;
  const factScope = sourceScope.hint?.value;
  if (!factScope) return null;

  // Fact scope is local-ish but LLM wants web=required → reject.
  if (LOCAL_SCOPES.has(factScope) && decision.web_policy === "required") {
    return `signals.source_scope (kind=fact, value=${factScope}) is local; LLM web_policy=required would override a hard fact`;
  }
  // Fact scope is local-ish but LLM picked external_world → reject.
  if (LOCAL_SCOPES.has(factScope) && decision.source_scope === "external_world") {
    return `signals.source_scope (kind=fact, value=${factScope}) is local; LLM picked external_world`;
  }
  return null;
}

// Re-export for tests + downstream integration.
export {
  SOURCE_SCOPES,
  WEB_POLICY_MODES,
  OUTPUT_KINDS,
  EXECUTORS,
  SIGNAL_KINDS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CONFIDENCE_THRESHOLD
};
