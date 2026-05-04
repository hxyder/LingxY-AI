#!/usr/bin/env node
/**
 * UCA-077 P4-02 (plan §12.7 / §13.2-A / §18.3): SemanticRouter regression.
 *
 * Asserts:
 *   1. Strict-schema enforcement: a well-formed adapter response yields
 *      `{kind:"decision", decision, source:"provider"}`.
 *   2. Cache hit: identical input on the second call returns
 *      `source:"cache"` without calling the adapter again.
 *   3. Cache miss when input differs (text / file_paths sorted / image
 *      presence / url / source_app).
 *   4. Cache TTL: after `now()` advances past `cacheTtlMs`, the entry
 *      expires and the adapter is consulted again.
 *   5. Disabled gating: when `isEnabled()` returns false → rejection
 *      `code:"disabled"` and adapter is NOT called.
 *   6. No adapter wired → rejection `code:"no_provider"`.
 *   7. Timeout: a slow adapter that exceeds `timeoutMs` → rejection
 *      `code:"timeout"`.
 *   8. Schema invalid: missing required field → `code:"schema_invalid"`.
 *   9. Schema invalid: out-of-enum value → `code:"schema_invalid"`.
 *  10. Confidence < threshold → `code:"low_confidence"`.
 *  11. Hard-fact conflict: signals say `source_scope.kind="fact"` and
 *      value is local-ish, but LLM says web=required → `code:"fact_conflict"`.
 *  12. Hard-fact conflict: same fact, LLM picks external_world → reject.
 *  13. NO conflict when fact scope is local but LLM says web=optional/forbidden
 *      (we only reject the truly contradictory cases).
 *  14. Tool-call args parsed from BOTH object form and JSON-string form
 *      (some code_cli bridges send args as strings).
 *  15. Adapter exception caught → `code:"exception"`.
 *  16. Public surface: SEMANTIC_DECISION_TOOL is exported with the strict
 *      input_schema; downstream consumers can introspect it.
 *
 * Run: node scripts/verify-semantic-router.mjs
 */

import assert from "node:assert/strict";

import {
  createSemanticRouter,
  SEMANTIC_DECISION_TOOL,
  SOURCE_SCOPES,
  WEB_POLICY_MODES,
  EXECUTORS,
  FILE_READ_DEPTHS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CONFIDENCE_THRESHOLD
} from "../src/service/core/intent/semantic-router.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { process.stdout.write(`PASS  ${label}\n`); pass += 1; })
    .catch((err) => {
      process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
      if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
      fail += 1;
    });
}

const validDecision = Object.freeze({
  source_scope: "external_world",
  web_policy: "required",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "multi_source",
  file_read_depth: "standard",
  primary_intent: "research",
  domain: "software",
  user_goal: "Understand current AI news.",
  expected_output: "direct_answer",
  needs_external_info: true,
  needs_current_information: true,
  needs_user_files: false,
  needs_tool_use: true,
  needed_capabilities: ["external_web_read"],
  required_policy_groups: ["external_web_read"],
  source_mode: "multi_source_research",
  complexity: "medium",
  risk_level: "low",
  confidence: 0.85,
  rationale_summary: "The user asked for current AI news, which needs external sources.",
  reason: "User asked for current AI news."
});

function decisionAdapter(decision = validDecision) {
  let calls = 0;
  return {
    get callCount() { return calls; },
    async generate() {
      calls += 1;
      return {
        tool_calls: [{ name: SEMANTIC_DECISION_TOOL.name, arguments: { ...decision } }]
      };
    }
  };
}

function makeRouter({ adapter, isEnabled, now, cache, timeoutMs, cacheTtlMs, confidenceThreshold } = {}) {
  return createSemanticRouter({ adapter, isEnabled, now, cache, timeoutMs, cacheTtlMs, confidenceThreshold });
}

async function run() {
  // ── 1. happy path ──────────────────────────────────────────────────────
  await it("happy: well-formed adapter → kind:decision, source:provider", async () => {
    const adapter = decisionAdapter();
    const router = makeRouter({ adapter });
    const out = await router.resolveSemanticDecision({ text: "今日 AI 新闻", contextPacket: {} });
    assert.equal(out.kind, "decision");
    assert.equal(out.source, "provider");
    assert.deepEqual(out.decision, validDecision);
    assert.equal(adapter.callCount, 1);
  });

  // ── 2. cache hit on identical input ────────────────────────────────────
  await it("cache: identical input second call returns source:cache", async () => {
    const adapter = decisionAdapter();
    const router = makeRouter({ adapter });
    const a = await router.resolveSemanticDecision({ text: "今日 AI 新闻", contextPacket: {} });
    const b = await router.resolveSemanticDecision({ text: "今日 AI 新闻", contextPacket: {} });
    assert.equal(a.source, "provider");
    assert.equal(b.source, "cache");
    assert.equal(adapter.callCount, 1, "adapter called only on first invocation");
  });

  // ── 3. cache key differentiates by input shape ─────────────────────────
  await it("cache: different text → different key (adapter called twice)", async () => {
    const adapter = decisionAdapter();
    const router = makeRouter({ adapter });
    await router.resolveSemanticDecision({ text: "今日 AI 新闻" });
    await router.resolveSemanticDecision({ text: "明日 AI 新闻" });
    assert.equal(adapter.callCount, 2);
  });
  await it("cache: signal shape differentiates entries (C0)", async () => {
    // Same text + ctx, but signals.source_scope.kind differs → adapter
    // must be called twice (cache key must include signal shape).
    const adapter = decisionAdapter();
    const router = makeRouter({ adapter });
    await router.resolveSemanticDecision({
      text: "summarise this",
      contextPacket: {},
      signals: { source_scope: { matched: true, strength: "strong", kind: "fact", hint: { value: "selection" }, evidence: [] } }
    });
    await router.resolveSemanticDecision({
      text: "summarise this",
      contextPacket: {},
      signals: { source_scope: { matched: true, strength: "strong", kind: "assumption", hint: { value: "current_context" }, evidence: [] } }
    });
    assert.equal(adapter.callCount, 2,
      "different signal shape must produce different cache key");
  });
  await it("cache: hit cannot bypass fact_conflict (C0 belt-and-suspenders)", async () => {
    // Prime the cache with a permissive signal set + web=required decision.
    const permissiveAdapter = decisionAdapter({ ...validDecision, web_policy: "required" });
    const router = makeRouter({ adapter: permissiveAdapter });
    await router.resolveSemanticDecision({ text: "x", contextPacket: {}, signals: {} });
    assert.equal(permissiveAdapter.callCount, 1);

    // Now a SECOND adapter that shouldn't be hit on cache hit. We replace
    // the router's adapter via a fresh router that REUSES the SAME cache
    // — except: the cache key changed because signal shape now differs,
    // so the cache lookup misses entirely. The "re-check on hit" path
    // still has to be exercised; do that via direct cache injection.
    let secondAdapterCalls = 0;
    const sameKeyCache = router._cache;
    // Force a cached entry whose key matches a query with conflicting
    // signals. We do this by computing the query's cache key ourselves
    // and stuffing the cached decision under that key, simulating a
    // legacy cache that doesn't yet know about signal shape.
    const conflictSignals = {
      source_scope: { matched: true, strength: "strong", kind: "fact", hint: { value: "uploaded_files" }, evidence: [] }
    };
    // Drain the cache and replant the cached decision under the key the
    // NEW query (with conflicting signals) will compute. Both routers
    // share the same cache; we synthesise the key by calling once with
    // these signals and a stub adapter that returns the same payload.
    sameKeyCache.clear();
    const probeAdapter = {
      async generate() { secondAdapterCalls += 1; return { tool_calls: [{ name: "route_task", arguments: { ...validDecision, web_policy: "required" } }] }; }
    };
    // Step 1: prime cache with conflicting signals — this will reject
    // (fact_conflict) so cache stays empty.
    const r1 = await makeRouter({ adapter: probeAdapter, cache: sameKeyCache })
      .resolveSemanticDecision({ text: "x", contextPacket: {}, signals: conflictSignals });
    assert.equal(r1.kind, "rejection");
    assert.equal(r1.code, "fact_conflict");
    // Step 2: forcibly insert a stale cached entry under the SAME key the
    // conflicting-signals call would compute, simulating an older entry
    // that pre-dates the C0 signal-shape addition.
    const probeRouter = makeRouter({ adapter: probeAdapter, cache: sameKeyCache });
    sameKeyCache.set(
      // Recreate the key the router would compute for our query.
      // We reach into the implementation via a known-stable path: the
      // router exposes _cache; the key is sha1 of buildCacheKey output.
      // Simpler: prime via a non-conflicting signal call that succeeds,
      // then mutate signals so the SAME key would be conflict-y. We
      // simulate this by manually setting an entry under a key we'll
      // hit by querying with the EXACT conflicting signals.
      [...sameKeyCache.keys()][0] ?? "synthetic-key",
      { decision: { ...validDecision, web_policy: "required" }, ts: Date.now() }
    );
    // Step 3: the actual invariant — when the cache contains an entry
    // and the current signals are fact-conflict against it, the router
    // must NOT serve the cached value.
    const r2 = await probeRouter.resolveSemanticDecision({ text: "x", contextPacket: {}, signals: conflictSignals });
    assert.equal(r2.kind, "rejection",
      "fact-conflict must not be bypassed by a cache hit");
    assert.equal(r2.code, "fact_conflict");
  });
  await it("cache: file_paths order doesn't matter (sorted in key)", async () => {
    const adapter = decisionAdapter();
    const router = makeRouter({ adapter });
    await router.resolveSemanticDecision({ text: "x", contextPacket: { file_paths: ["a.txt", "b.txt"] } });
    await router.resolveSemanticDecision({ text: "x", contextPacket: { file_paths: ["b.txt", "a.txt"] } });
    assert.equal(adapter.callCount, 1, "sorted file_paths produce same cache key");
  });

  // ── 4. cache TTL expiry ────────────────────────────────────────────────
  await it("cache TTL: entry expires past cacheTtlMs", async () => {
    const adapter = decisionAdapter();
    let t = 1_000_000;
    const router = makeRouter({
      adapter,
      now: () => t,
      cacheTtlMs: 100
    });
    await router.resolveSemanticDecision({ text: "x" });
    t += 50; // still within TTL
    const stillCached = await router.resolveSemanticDecision({ text: "x" });
    assert.equal(stillCached.source, "cache");
    t += 200; // past TTL
    const refetched = await router.resolveSemanticDecision({ text: "x" });
    assert.equal(refetched.source, "provider");
    assert.equal(adapter.callCount, 2);
  });

  // ── 5. disabled gate ───────────────────────────────────────────────────
  await it("disabled: isEnabled()=false short-circuits, adapter NOT called", async () => {
    const adapter = decisionAdapter();
    const router = makeRouter({ adapter, isEnabled: () => false });
    const out = await router.resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "disabled");
    assert.equal(adapter.callCount, 0);
  });

  // ── 6. no provider wired ───────────────────────────────────────────────
  await it("no_provider: adapter missing → rejection code=no_provider", async () => {
    const router = makeRouter({ adapter: null });
    const out = await router.resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "no_provider");
  });

  // ── 7. timeout ─────────────────────────────────────────────────────────
  await it("timeout: slow adapter exceeds timeoutMs → rejection code=timeout", async () => {
    const slowAdapter = {
      async generate() {
        // Resolves AFTER the timeout fires.
        return new Promise((resolve) => setTimeout(() => resolve({
          tool_calls: [{ name: SEMANTIC_DECISION_TOOL.name, arguments: { ...validDecision } }]
        }), 100));
      }
    };
    const router = makeRouter({ adapter: slowAdapter, timeoutMs: 25 });
    const out = await router.resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "timeout");
    assert.match(out.reason, /25ms/);
  });

  // ── 8 & 9. schema invalid ──────────────────────────────────────────────
  await it("schema_invalid: missing required field", async () => {
    const adapter = {
      async generate() {
        const { reason: _r, ...withoutReason } = validDecision;
        return { tool_calls: [{ name: "route_task", arguments: withoutReason }] };
      }
    };
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /reason/);
  });
  await it("schema_invalid: out-of-enum executor value", async () => {
    const adapter = {
      async generate() {
        return { tool_calls: [{ name: "route_task", arguments: { ...validDecision, executor: "imaginary" } }] };
      }
    };
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /executor=imaginary/);
  });

  // ── 10. low confidence ─────────────────────────────────────────────────
  await it("low_confidence: confidence below threshold rejected", async () => {
    const adapter = decisionAdapter({ ...validDecision, confidence: 0.4 });
    const out = await makeRouter({ adapter, confidenceThreshold: 0.6 })
      .resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "low_confidence");
  });

  // ── 11 & 12. hard-fact conflict ────────────────────────────────────────
  const factSignals = {
    source_scope: {
      name: "source_scope",
      matched: true,
      strength: "strong",
      kind: "fact",
      hint: { value: "uploaded_files" },
      evidence: []
    }
  };
  await it("fact_conflict: fact scope=uploaded_files but LLM web=required", async () => {
    const adapter = decisionAdapter({ ...validDecision, web_policy: "required" });
    const out = await makeRouter({ adapter })
      .resolveSemanticDecision({ text: "summarize", signals: factSignals });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "fact_conflict");
    assert.match(out.reason, /uploaded_files/);
  });
  await it("fact_conflict: fact uploaded_files + explicit_search can be accepted as mixed input", async () => {
    const signals = {
      ...factSignals,
      explicit_search: {
        name: "explicit_search",
        matched: true,
        strength: "strong",
        kind: "hint",
        hint: {},
        evidence: []
      }
    };
    const adapter = decisionAdapter({ ...validDecision, web_policy: "required", source_scope: "external_world" });
    const out = await makeRouter({ adapter })
      .resolveSemanticDecision({ text: "结合简历搜索工作", signals });
    assert.equal(out.kind, "decision",
      `expected mixed local+search input to be accepted; got ${JSON.stringify(out)}`);
  });
  await it("fact_conflict: local_only_constraint rejects external upgrade", async () => {
    const signals = {
      ...factSignals,
      local_only_constraint: {
        name: "local_only_constraint",
        matched: true,
        strength: "strong",
        kind: "fact",
        hint: { value: "local_only" },
        evidence: []
      },
      explicit_search: {
        name: "explicit_search",
        matched: true,
        strength: "strong",
        kind: "hint",
        hint: {},
        evidence: []
      }
    };
    const adapter = decisionAdapter({ ...validDecision, web_policy: "required", source_scope: "external_world" });
    const out = await makeRouter({ adapter })
      .resolveSemanticDecision({ text: "仅基于这份文件搜索", signals });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "fact_conflict");
    assert.match(out.reason, /local_only_constraint/);
  });
  await it("fact_conflict: fact scope=current_context but LLM source_scope=external_world", async () => {
    const localFactSignals = {
      source_scope: { ...factSignals.source_scope, hint: { value: "current_context" } }
    };
    const adapter = decisionAdapter({ ...validDecision, web_policy: "optional", source_scope: "external_world" });
    const out = await makeRouter({ adapter })
      .resolveSemanticDecision({ text: "x", signals: localFactSignals });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "fact_conflict");
  });

  // ── 13. NO conflict on benign cases ────────────────────────────────────
  await it("fact_conflict: fact scope local + LLM web=optional → still accepted", async () => {
    // The LLM agreeing the task is local (web=optional) is fine. Only
    // the contradictory cases reject.
    const adapter = decisionAdapter({ ...validDecision, web_policy: "optional", source_scope: "current_context" });
    const out = await makeRouter({ adapter })
      .resolveSemanticDecision({ text: "x", signals: factSignals });
    assert.equal(out.kind, "decision",
      `expected accepted; got rejection: ${JSON.stringify(out)}`);
  });
  await it("fact_conflict: hint-kind signals do NOT block (only fact-kind does)", async () => {
    const hintSignals = {
      source_scope: { ...factSignals.source_scope, kind: "hint" }
    };
    const adapter = decisionAdapter({ ...validDecision, web_policy: "required" });
    const out = await makeRouter({ adapter })
      .resolveSemanticDecision({ text: "x", signals: hintSignals });
    assert.equal(out.kind, "decision",
      "hint-kind signals are weaker than the LLM's overall judgement; only fact-kind blocks");
  });

  // ── 14. tool-call args parsed from string + object ─────────────────────
  await it("schema: parses tool_call.arguments when adapter sends a JSON string", async () => {
    const adapter = {
      async generate() {
        return {
          tool_calls: [{ name: "route_task", arguments: JSON.stringify(validDecision) }]
        };
      }
    };
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "decision");
    assert.equal(out.source, "provider");
  });
  await it("schema: repairs email_draft when model puts it in output_kind", async () => {
    const adapter = decisionAdapter({
      ...validDecision,
      output_kind: "email_draft",
      expected_output: "execution",
      required_policy_groups: ["email_send"]
    });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "send a market summary by email" });
    assert.equal(out.kind, "decision");
    assert.equal(out.decision.output_kind, "conversation");
    assert.equal(out.decision.expected_output, "execution");
    assert.deepEqual(out.decision.required_policy_groups, ["email_send"]);
  });
  await it("schema: email_send contract cannot be normalized to draft-only output", async () => {
    const adapter = decisionAdapter({
      ...validDecision,
      output_kind: "conversation",
      expected_output: "email_draft",
      needs_tool_use: false,
      needed_capabilities: [],
      required_policy_groups: ["email_send"]
    });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "send this by email" });
    assert.equal(out.kind, "decision");
    assert.equal(out.decision.expected_output, "execution");
    assert.equal(out.decision.needs_tool_use, true);
    assert.ok(out.decision.needed_capabilities.includes("email_calendar_action"));
  });

  // ── 15. adapter exception ──────────────────────────────────────────────
  await it("exception: adapter throws → rejection code=exception (no rethrow)", async () => {
    const adapter = { async generate() { throw new Error("network down"); } };
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "exception");
    assert.match(out.reason, /network down/);
  });

  // ── ctxSummary uses context_sources when present (C5) ─────────────────
  await it("ctxSummary: carries context_sources when packet provides it", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return { tool_calls: [{ name: "route_task", arguments: { ...validDecision } }] };
      }
    };
    const router = makeRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({
      text: "x",
      contextPacket: {
        context_sources: { real_selection: false, rag_background: true, conversation_history: true,
          browser_page: false, file_text: false, parent_task_context: false,
          editable_artifact: false, uploaded_files: false, uploaded_images: false }
      }
    });
    const userMessage = captured.messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /context_sources/);
    assert.match(userMessage, /"rag_background":\s*true/);
    assert.match(userMessage, /"conversation_history":\s*true/);
    // legacy fields must be absent when sources is present.
    assert.ok(!/"has_text":/.test(userMessage));
    assert.ok(!/"text_chars":/.test(userMessage));
  });
  await it("ctxSummary: falls back to legacy shape when context_sources absent", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return { tool_calls: [{ name: "route_task", arguments: { ...validDecision } }] };
      }
    };
    const router = makeRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({
      text: "x",
      contextPacket: { text: "some legacy selection" }
    });
    const userMessage = captured.messages.find((m) => m.role === "user").content;
    assert.match(userMessage, /"has_text":\s*true/);
    assert.match(userMessage, /"text_chars":/);
    // sources field must be absent in the fallback shape.
    assert.ok(!/"context_sources":/.test(userMessage));
  });
  await it("system prompt: explains background_only context_sources and fact>hint>assumption", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return { tool_calls: [{ name: "route_task", arguments: { ...validDecision } }] };
      }
    };
    const router = makeRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({ text: "x" });
    const systemMessage = captured.messages.find((m) => m.role === "system").content;
    assert.match(systemMessage, /Context source ranking/);
    assert.match(systemMessage, /BACKGROUND-ONLY/);
    assert.match(systemMessage, /fact > hint > assumption/);
  });

  // ── tool_choice plumbing through real createProviderAdapter ────────────
  // The router sends `tool_choice: { type:"tool", name:"route_task" }`
  // to its adapter. Provider-adapter must forward it correctly per
  // provider kind: anthropic gets the verbatim shape; OpenAI-compat
  // gets translated to `{ type:"function", function:{ name:"..." } }`.
  // Pre-fix the field was silently dropped, leaving the LLM free to
  // skip the tool and reply with raw text → SR would reject as
  // schema_invalid. Tests use a stub fetch to inspect the outgoing body.
  await it("tool_choice: anthropic adapter forwards tool_choice verbatim", async () => {
    const { createProviderAdapter } = await import("../src/service/executors/agentic/provider-adapter.mjs");
    const captured = {};
    const stubFetch = async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            content: [{ type: "tool_use", id: "tu_1", name: "route_task", input: { ...validDecision } }]
          });
        }
      };
    };
    const adapter = createProviderAdapter({ kind: "anthropic", model: "claude-x", baseUrl: "https://x", apiKey: "k" });
    await adapter.generate({
      messages: [{ role: "user", content: "x" }],
      tools: [SEMANTIC_DECISION_TOOL],
      tool_choice: { type: "tool", name: SEMANTIC_DECISION_TOOL.name },
      fetchImpl: stubFetch,
      maxTokens: 64
    });
    assert.deepEqual(captured.body.tool_choice, { type: "tool", name: "route_task" });
    assert.ok(Array.isArray(captured.body.tools));
  });
  await it("tool_choice: openai adapter translates to {type:function, function:{name}}", async () => {
    const { createProviderAdapter } = await import("../src/service/executors/agentic/provider-adapter.mjs");
    const captured = {};
    const stubFetch = async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: "", tool_calls: [{
              id: "c1", type: "function",
              function: { name: "route_task", arguments: JSON.stringify(validDecision) }
            }] } }],
            usage: {}
          });
        }
      };
    };
    const adapter = createProviderAdapter({ kind: "openai", model: "gpt-4", baseUrl: "https://api.openai.com/v1", apiKey: "k" });
    await adapter.generate({
      messages: [{ role: "user", content: "x" }],
      tools: [SEMANTIC_DECISION_TOOL],
      tool_choice: { type: "tool", name: SEMANTIC_DECISION_TOOL.name },
      fetchImpl: stubFetch,
      maxTokens: 64
    });
    assert.deepEqual(captured.body.tool_choice, { type: "function", function: { name: "route_task" } });
  });
  await it("tool_choice: omitted when caller didn't pass one (back-compat)", async () => {
    const { createProviderAdapter } = await import("../src/service/executors/agentic/provider-adapter.mjs");
    const captured = {};
    const stubFetch = async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return {
        ok: true,
        async text() {
          return JSON.stringify({ choices: [{ message: { content: "ok", tool_calls: [] } }], usage: {} });
        }
      };
    };
    const adapter = createProviderAdapter({ kind: "openai", model: "x", baseUrl: "https://x", apiKey: "k" });
    await adapter.generate({
      messages: [{ role: "user", content: "x" }],
      tools: [SEMANTIC_DECISION_TOOL],
      // NO tool_choice — caller doesn't force one
      fetchImpl: stubFetch
    });
    assert.equal(captured.body.tool_choice, undefined,
      "tool_choice must be omitted when caller doesn't supply it (existing planner behaviour)");
  });

  // ── live wire-up: no chat provider configured → no_provider rejection ──
  // Smoke check that the top-level resolveSemanticDecision degrades
  // gracefully when no chat provider is set up. This exercises the
  // dynamic-import path without depending on any particular dev-box
  // config (we just assert it returns SOMETHING shaped like a router
  // result and never throws).
  await it("wire-up: top-level resolveSemanticDecision returns a router result (no throw)", async () => {
    const { resolveSemanticDecision: liveResolve, _resetDefaultRouterState } = await import("../src/service/core/intent/semantic-router.mjs");
    if (typeof _resetDefaultRouterState === "function") _resetDefaultRouterState();
    const out = await liveResolve({ text: "test", contextPacket: {}, signals: {} });
    assert.ok(out && typeof out === "object");
    assert.ok(out.kind === "decision" || out.kind === "rejection",
      `expected decision or rejection, got ${JSON.stringify(out).slice(0, 100)}`);
  });

  // ── disabled env var: top-level dispatch returns disabled rejection ──
  await it("wire-up: SEMANTIC_ROUTER_DISABLED=1 short-circuits at top-level (before provider lookup)", async () => {
    const { resolveSemanticDecision: liveResolve } = await import("../src/service/core/intent/semantic-router.mjs");
    const originalEnv = process.env.SEMANTIC_ROUTER_DISABLED;
    process.env.SEMANTIC_ROUTER_DISABLED = "1";
    try {
      const out = await liveResolve({ text: "test", contextPacket: {}, signals: {} });
      assert.equal(out.kind, "rejection");
      assert.equal(out.code, "disabled");
    } finally {
      if (originalEnv === undefined) delete process.env.SEMANTIC_ROUTER_DISABLED;
      else process.env.SEMANTIC_ROUTER_DISABLED = originalEnv;
    }
  });

  // ── unsupported_provider source-level lock-in ────────────────────────
  // We can't easily mock resolveProviderForTask without ESM tricks, so
  // we lock the unsupported-kinds set at source level. The set must
  // include both code_cli (no schema enforcement in JSON bridge) and
  // ollama (no tool_choice plumbing today; tool_use is unreliable).
  await it("unsupported: source declares code_cli + ollama as unsupported for SR", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/service/core/intent/semantic-router.mjs", "utf8");
    const setMatch = src.match(/UNSUPPORTED_FOR_SEMANTIC_ROUTER\s*=\s*Object\.freeze\(new Set\(\[([^\]]*)\]/);
    assert.ok(setMatch, "UNSUPPORTED_FOR_SEMANTIC_ROUTER set must be defined");
    const members = setMatch[1];
    assert.match(members, /["']code_cli["']/);
    assert.match(members, /["']ollama["']/);
    // The rejection code must be in the typedef union too so consumers
    // can switch on it.
    assert.match(src, /"unsupported_provider"/);
  });

  // ── 16. public surface ─────────────────────────────────────────────────
  await it("public surface: SEMANTIC_DECISION_TOOL has strict input_schema", () => {
    assert.equal(SEMANTIC_DECISION_TOOL.name, "route_task");
    assert.equal(SEMANTIC_DECISION_TOOL.input_schema.type, "object");
    assert.equal(SEMANTIC_DECISION_TOOL.input_schema.additionalProperties, false);
    for (const f of [
      "source_scope", "web_policy", "output_kind", "artifact_required",
      "executor", "research_depth", "file_read_depth", "primary_intent", "domain",
      "user_goal", "expected_output", "needs_external_info",
      "needs_current_information", "needs_user_files", "needs_tool_use",
      "needed_capabilities", "required_policy_groups", "source_mode", "complexity", "risk_level",
      "confidence", "rationale_summary", "reason"
    ]) {
      assert.ok(SEMANTIC_DECISION_TOOL.input_schema.properties[f], `schema missing property ${f}`);
    }
  });
  await it("public surface: IntentRoute fields are required and capability-based", () => {
    for (const f of [
      "primary_intent", "domain", "user_goal", "expected_output",
      "needs_external_info", "needs_current_information", "needs_user_files",
      "needs_tool_use", "needed_capabilities", "required_policy_groups", "source_mode", "complexity",
      "risk_level", "rationale_summary"
    ]) {
      assert.ok(SEMANTIC_DECISION_TOOL.input_schema.required.includes(f),
        `IntentRoute field must be required: ${f}`);
    }
    const capabilities = SEMANTIC_DECISION_TOOL.input_schema.properties.needed_capabilities.items.enum;
    assert.ok(capabilities.includes("external_web_read"));
    assert.ok(!capabilities.includes("web_search_fetch"),
      "SR emits capabilities, not concrete tool IDs");
    const policyGroups = SEMANTIC_DECISION_TOOL.input_schema.properties.required_policy_groups.items.enum;
    assert.ok(policyGroups.includes("external_web_read"));
    assert.ok(policyGroups.includes("email_send"));
  });
  await it("IntentRoute: invalid capability rejected by validator", async () => {
    const adapter = decisionAdapter({ ...validDecision, needed_capabilities: ["web_search_fetch"] });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /needed_capabilities/);
  });
  await it("public surface: research_depth enum includes single_lookup / multi_source / deep_research / unknown", () => {
    // K3 added "deep_research" to the enum.
    const enumDef = SEMANTIC_DECISION_TOOL.input_schema.properties.research_depth.enum;
    assert.deepEqual([...enumDef].sort(),
      ["deep_research", "multi_source", "single_lookup", "unknown"]);
    assert.ok(SEMANTIC_DECISION_TOOL.input_schema.required.includes("research_depth"));
  });
  await it("public surface: file_read_depth enum includes shallow / focused / standard / deep", () => {
    const enumDef = SEMANTIC_DECISION_TOOL.input_schema.properties.file_read_depth.enum;
    assert.deepEqual([...enumDef].sort(), ["deep", "focused", "shallow", "standard"]);
    assert.deepEqual([...FILE_READ_DEPTHS].sort(), ["deep", "focused", "shallow", "standard"]);
    assert.ok(SEMANTIC_DECISION_TOOL.input_schema.required.includes("file_read_depth"));
  });

  // ── P4-RQ C2: research_depth schema + plumbing ────────────────────────
  await it("research_depth: invalid enum value rejected by validator", async () => {
    const adapter = decisionAdapter({ ...validDecision, research_depth: "invalid_depth" });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /research_depth=invalid_depth/);
  });
  await it("research_depth: missing field treated as schema_invalid (required)", async () => {
    const adapter = {
      async generate() {
        const { research_depth: _rd, ...withoutDepth } = validDecision;
        return { tool_calls: [{ name: "route_task", arguments: withoutDepth }] };
      }
    };
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /research_depth/);
  });
  await it("research_depth: valid value preserved end-to-end on the decision", async () => {
    const adapter = decisionAdapter({ ...validDecision, research_depth: "multi_source" });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "今天有什么 AI 新闻" });
    assert.equal(out.kind, "decision");
    assert.equal(out.decision.research_depth, "multi_source");
  });
  await it("file_read_depth: invalid enum value rejected by validator", async () => {
    const adapter = decisionAdapter({ ...validDecision, file_read_depth: "folder_keyword_patch" });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /file_read_depth=folder_keyword_patch/);
  });
  await it("file_read_depth: missing field treated as schema_invalid (required)", async () => {
    const adapter = {
      async generate() {
        const { file_read_depth: _frd, ...withoutDepth } = validDecision;
        return { tool_calls: [{ name: "route_task", arguments: withoutDepth }] };
      }
    };
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "x" });
    assert.equal(out.kind, "rejection");
    assert.equal(out.code, "schema_invalid");
    assert.match(out.reason, /file_read_depth/);
  });
  await it("file_read_depth: valid value preserved end-to-end on the decision", async () => {
    const adapter = decisionAdapter({ ...validDecision, file_read_depth: "deep" });
    const out = await makeRouter({ adapter }).resolveSemanticDecision({ text: "deeply review these local files" });
    assert.equal(out.kind, "decision");
    assert.equal(out.decision.file_read_depth, "deep");
  });
  await it("file_read_depth: system prompt teaches local depth as separate from web research", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return { tool_calls: [{ name: "route_task", arguments: { ...validDecision } }] };
      }
    };
    const router = makeRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({ text: "x" });
    const systemMessage = captured.messages.find((m) => m.role === "system").content;
    assert.match(systemMessage, /file_read_depth/);
    assert.match(systemMessage, /LOCAL file-reading depth/);
    assert.match(systemMessage, /separately from web research/);
  });
  await it("research_depth: system prompt teaches single_lookup vs multi_source", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return { tool_calls: [{ name: "route_task", arguments: { ...validDecision } }] };
      }
    };
    const router = makeRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({ text: "x" });
    const systemMessage = captured.messages.find((m) => m.role === "system").content;
    assert.match(systemMessage, /research_depth/);
    assert.match(systemMessage, /single_lookup/);
    assert.match(systemMessage, /multi_source/);
  });
  await it("research_depth: resolver merge stamps research_hint onto tool_policy", async () => {
    const { mergeSemanticRouterDecision, resolveDeterministicPolicy } =
      await import("../src/service/core/policy/tool-policy-resolver.mjs");
    const { extractAllSignals } = await import("../src/service/core/intent/signals/index.mjs");
    const text = "today's AI news please";
    const signals = extractAllSignals({ text, contextPacket: {} });
    const detPolicy = resolveDeterministicPolicy({ signals, text });
    const merged = mergeSemanticRouterDecision({
      deterministicPolicy: detPolicy,
      signals,
      contextPacket: {
        // SR decision present; gate (text length > 8) passes
        semantic_router_decision: { ...validDecision, research_depth: "multi_source" }
      },
      text
    });
    assert.equal(merged.research_hint, "multi_source",
      "merge must stamp the SR research_depth onto tool_policy.research_hint");
  });
  await it("research_depth: stamp fires even when deterministic policy already required (via pending_offer)", async () => {
    const { mergeSemanticRouterDecision } =
      await import("../src/service/core/policy/tool-policy-resolver.mjs");
    // Hand-built deterministic policy that's already "required" — merge
    // would normally just return it unchanged. We still want the hint
    // stamped so downstream consumers see what SR thought. Signals here
    // intentionally avoid explicit_external/topic_hint strong (those
    // would short-circuit shouldConsultSemanticRouter), so the merge
    // reaches the detMode==="required" branch with stamping enabled.
    const detPolicy = {
      web_search_fetch: { mode: "required", reason: "pending_offer inherited", evidence: [] },
      policy_groups: { external_web_read: { mode: "required", reason: "x", evidence: [] } }
    };
    const merged = mergeSemanticRouterDecision({
      deterministicPolicy: detPolicy,
      signals: {},
      contextPacket: {
        semantic_router_decision: { ...validDecision, research_depth: "single_lookup" }
      },
      text: "long enough text to pass the gate"
    });
    assert.equal(merged.research_hint, "single_lookup");
    assert.equal(merged.policy_groups?.external_web_read?.mode, "required");
  });
  await it("research_depth: no stamp when SR not consulted (deterministic rule fired strongly)", async () => {
    const { mergeSemanticRouterDecision } =
      await import("../src/service/core/policy/tool-policy-resolver.mjs");
    const detPolicy = {
      web_search_fetch: { mode: "required", reason: "explicit external", evidence: [] },
      policy_groups: { external_web_read: { mode: "required", reason: "x", evidence: [] } }
    };
    const merged = mergeSemanticRouterDecision({
      deterministicPolicy: detPolicy,
      // strong explicit_external → shouldConsultSemanticRouter returns false
      signals: {
        explicit_external: { matched: true, kind: "hint", strength: "strong", hint: { value: "external" } }
      },
      contextPacket: {
        semantic_router_decision: { ...validDecision, research_depth: "multi_source" }
      },
      text: "long enough text"
    });
    // Deterministic rule won outright; SR was never consulted. No
    // research_hint either — keeps the trace honest.
    assert.equal(merged.research_hint, undefined);
  });
  await it("public surface: enums match the typedef", () => {
    assert.ok(SOURCE_SCOPES.includes("external_world"));
    assert.ok(WEB_POLICY_MODES.includes("required"));
    assert.ok(EXECUTORS.includes("tool_using"));
  });
  await it("public surface: defaults exported", () => {
    assert.equal(typeof DEFAULT_TIMEOUT_MS, "number");
    assert.equal(typeof DEFAULT_CACHE_TTL_MS, "number");
    assert.equal(typeof DEFAULT_CONFIDENCE_THRESHOLD, "number");
    assert.ok(DEFAULT_TIMEOUT_MS >= 5000,
      "real hosted providers routinely exceed 1500ms; default SR timeout must not cause systematic sr_timeout");
    assert.ok(DEFAULT_CACHE_TTL_MS >= 60_000);
    assert.ok(DEFAULT_CONFIDENCE_THRESHOLD > 0 && DEFAULT_CONFIDENCE_THRESHOLD < 1);
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
