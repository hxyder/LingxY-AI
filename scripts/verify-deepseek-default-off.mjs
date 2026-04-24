// Phase 22b verifier (UCA-182) — thinking must actually be OFF by
// default. The user's question was: if I never ticked the thinking
// switch, why did the API even return reasoning_content (triggering
// the echo 400)? Answer: the saved provider config was dragging three
// stale bits forward — legacy model id, Qwen-format reasoning leftover,
// and no positive "disabled" signal on the wire. This test locks each.

import assert from "node:assert/strict";
import {
  sanitizeProviderConfig,
  sanitizeTaskRouteForProvider,
  applyReasoningSelectionToBody,
  modelLooksStaleForProvider
} from "../src/shared/provider-catalog.mjs";

const deepseekProvider = {
  id: "deepseek", kind: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  defaultModel: "deepseek-chat"   // saved legacy
};

// --- 1. legacy deepseek-chat / deepseek-reasoner are flagged stale --
{
  assert.equal(modelLooksStaleForProvider(deepseekProvider, "deepseek-chat"), true,
    "saved deepseek-chat must be treated as stale so config auto-upgrades");
  assert.equal(modelLooksStaleForProvider(deepseekProvider, "deepseek-reasoner"), true,
    "saved deepseek-reasoner must be treated as stale");
  assert.equal(modelLooksStaleForProvider(deepseekProvider, "deepseek-v4-flash"), false);
  assert.equal(modelLooksStaleForProvider(deepseekProvider, "deepseek-v4-pro"), false);
}

// --- 2. sanitizeProviderConfig upgrades legacy → v4-flash ----------
{
  const upgraded = sanitizeProviderConfig(deepseekProvider, "chat");
  assert.equal(upgraded.defaultModel, "deepseek-v4-flash",
    "sanitize must upgrade saved legacy provider to v4-flash");
}

// --- 3. stale Qwen-format reasoning leak is scrubbed on DeepSeek ---
{
  // This is the exact shape we found in the user's runtime.json:
  // taskRouting.chat.reasoningEffort = "enable_thinking:true" on a
  // deepseek provider. Must be dropped so it doesn't leak onto the
  // wire.
  const dirtyRoute = {
    providerId: "deepseek",
    model: "deepseek-v4-flash",
    mode: "default",
    reasoningEffort: "enable_thinking:true"
  };
  const cleaned = sanitizeTaskRouteForProvider(deepseekProvider, dirtyRoute, "chat");
  assert.ok(!cleaned.reasoningEffort,
    "Qwen-format reasoningEffort must be dropped when the route is on DeepSeek");
}

// --- 4. empty/absent selection → explicit thinking.disabled ---------
{
  // Legacy ids: no thinking field; body untouched.
  const legacyBody = applyReasoningSelectionToBody({}, deepseekProvider, "deepseek-chat", "");
  assert.deepEqual(legacyBody, {},
    "legacy deepseek-chat must NOT get thinking field — the model doesn't accept it");

  // v4 with empty selection → explicit disabled
  const v4Body = applyReasoningSelectionToBody({}, deepseekProvider, "deepseek-v4-flash", "");
  assert.deepEqual(v4Body.thinking, { type: "disabled" },
    "v4 default must emit explicit thinking.disabled so the upstream default can't sneak it on");
  assert.equal(v4Body.reasoning_effort, undefined,
    "disabled path does not set reasoning_effort");

  // v4-pro also gets the explicit disabled when user didn't choose.
  const proBody = applyReasoningSelectionToBody({}, deepseekProvider, "deepseek-v4-pro", "");
  assert.deepEqual(proBody.thinking, { type: "disabled" });

  // User explicitly picked enabled → we honour that, no disabled override.
  const onBody = applyReasoningSelectionToBody({}, deepseekProvider, "deepseek-v4-flash", "thinking:enabled|medium");
  assert.deepEqual(onBody.thinking, { type: "enabled" });
  assert.equal(onBody.reasoning_effort, "medium");

  // User explicitly picked disabled → emits disabled (same as default now).
  const offBody = applyReasoningSelectionToBody({}, deepseekProvider, "deepseek-v4-flash", "thinking:disabled");
  assert.deepEqual(offBody.thinking, { type: "disabled" });
}

// --- 5. other providers untouched by the v4 disabled-by-default rule
{
  const gpt = applyReasoningSelectionToBody({}, { kind: "openai", baseUrl: "https://api.openai.com/v1" }, "gpt-4o", "");
  assert.deepEqual(gpt, {},
    "non-DeepSeek body remains untouched when no reasoning is selected");
  const qwen = applyReasoningSelectionToBody({}, { kind: "openai", name: "qwen" }, "qwen3.6-plus", "");
  assert.deepEqual(qwen, {},
    "qwen body remains untouched when no reasoning is selected");
}

// --- 6. End-to-end: user's actual runtime.json config produces a
//        clean, thinking-off request body.
{
  const rawRoute = {
    providerId: "deepseek",
    model: "deepseek-v4-flash",
    mode: "default",
    reasoningEffort: "enable_thinking:true"  // the real leftover bit
  };
  const saneProvider = sanitizeProviderConfig(deepseekProvider, "chat");
  const saneRoute = sanitizeTaskRouteForProvider(saneProvider, rawRoute, "chat");
  const body = { messages: [] };
  applyReasoningSelectionToBody(body, saneProvider, saneRoute.model, saneRoute.reasoningEffort ?? "");
  assert.deepEqual(body.thinking, { type: "disabled" },
    "a user's dirty config must resolve to thinking.disabled end-to-end");
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.enable_thinking, undefined,
    "Qwen-style enable_thinking must never reach the wire for DeepSeek");
}

console.log("ok verify-deepseek-default-off");
