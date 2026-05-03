// Phase 19 verifier (UCA-182) — DeepSeek v4 model lineup + thinking toggle.
//
// Covers:
//   1. Built-in template defaults to v4-flash (not the deprecated
//      deepseek-chat).
//   2. catalogDefaultModelForProvider returns v4-flash.
//   3. Model preset list starts with v4-flash / v4-pro and demotes
//      the legacy pair.
//   4. modeOptions exposes Flash + Pro; saved taskRouting with the
//      compatibility mode ids ("chat" / "reasoner") still resolve.
//   5. reasoningOptionsForProvider surfaces the official thinking
//      toggle without inventing provider-specific effort levels.
//   6. applyReasoningSelectionToBody emits the right wire format:
//      - "thinking:disabled" → body.thinking = { type: "disabled" }
//      - "thinking:enabled|high" → body.thinking only; effort is ignored

import assert from "node:assert/strict";
import {
  BUILTIN_API_TEMPLATES,
  catalogDefaultModelForProvider,
  providerModelPresets,
  modeOptionsForProvider,
  resolveModeModel,
  reasoningOptionsForProvider,
  normalizeReasoningSelection,
  applyReasoningSelectionToBody,
  sanitizeTaskRouteForProvider
} from "../src/shared/provider-catalog.mjs";

const provider = {
  id: "deepseek", name: "DeepSeek", kind: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-v4-flash"
};

// --- 1. built-in template -------------------------------------------
{
  const t = BUILTIN_API_TEMPLATES.find((e) => e.id === "deepseek");
  assert.equal(t.defaultModel, "deepseek-v4-flash",
    "BUILTIN_API_TEMPLATES.deepseek.defaultModel must be v4-flash");
  assert.equal(t.baseUrl, "https://api.deepseek.com/v1");
}

// --- 2. catalogDefaultModelForProvider ------------------------------
assert.equal(catalogDefaultModelForProvider(provider, "chat"), "deepseek-v4-flash");

// --- 3. preset list ordering ----------------------------------------
{
  const presets = providerModelPresets(provider, "chat");
  assert.ok(presets[0] === "deepseek-v4-flash" || presets[1] === "deepseek-v4-flash",
    "v4-flash must be near the top of presets");
  assert.ok(presets.includes("deepseek-v4-pro"), "v4-pro must be present");
  // legacy entries retained until 2026-07 retirement
  assert.ok(presets.includes("deepseek-chat"));
  assert.ok(presets.includes("deepseek-reasoner"));
}

// --- 4. mode options + legacy aliasing ------------------------------
{
  const opts = modeOptionsForProvider(provider, "deepseek-v4-flash");
  const ids = opts.map((o) => o.id);
  assert.ok(ids.includes("flash") && ids.includes("pro"),
    "mode options must expose flash + pro");
  assert.ok(ids.includes("chat") && ids.includes("reasoner"),
    "compatibility mode ids kept for back-compat");

  // Explicit v4 selection
  assert.equal(resolveModeModel(provider, "deepseek-v4-flash", "pro"), "deepseek-v4-pro");

  // Compatibility aliases still map to the official alias ids.
  assert.equal(resolveModeModel(provider, "deepseek-chat", "reasoner"), "deepseek-reasoner");
  assert.equal(resolveModeModel(provider, "deepseek-chat", "chat"), "deepseek-chat");

  // sanitizeTaskRouteForProvider round-trip carries the legacy mode alias.
  const sanitized = sanitizeTaskRouteForProvider(provider, { model: "deepseek-chat", mode: "reasoner" }, "chat");
  assert.equal(sanitized.model, "deepseek-reasoner",
    "compatibility task route with mode=reasoner must resolve to deepseek-reasoner model");
}

// --- 5. thinking toggle surfaced for DeepSeek -----------------------
{
  const v4Opts = reasoningOptionsForProvider(provider, "deepseek-v4-flash");
  assert.ok(v4Opts.some((o) => o.id === "thinking:disabled"),
    "v4-flash must expose thinking:disabled");
  assert.ok(v4Opts.some((o) => o.id === "thinking:enabled"),
    "v4-flash must expose thinking:enabled");

  const proOpts = reasoningOptionsForProvider(provider, "deepseek-v4-pro");
  assert.ok(proOpts.length > 0, "v4-pro must also expose the toggle");

  const legacyOpts = reasoningOptionsForProvider(provider, "deepseek-chat");
  assert.ok(legacyOpts.some((o) => o.id === "thinking:enabled"),
    "compatibility deepseek-chat may opt into thinking via the documented parameter");
}

// --- 6. normalize + applyReasoningSelectionToBody ------------------
{
  assert.equal(normalizeReasoningSelection(provider, "deepseek-v4-flash", "thinking:enabled"),
    "thinking:enabled");
  assert.equal(normalizeReasoningSelection(provider, "deepseek-v4-flash", "thinking:disabled"),
    "thinking:disabled");

  const body1 = applyReasoningSelectionToBody({}, provider, "deepseek-v4-flash", "thinking:disabled");
  assert.deepEqual(body1.thinking, { type: "disabled" },
    "disabled → body.thinking.type = 'disabled'");
  assert.equal(body1.reasoning_effort, undefined);

  const body2 = applyReasoningSelectionToBody({}, provider, "deepseek-v4-pro", "thinking:enabled|high");
  assert.deepEqual(body2.thinking, { type: "enabled" });
  assert.equal(body2.reasoning_effort, undefined);

  const body3 = applyReasoningSelectionToBody({}, provider, "deepseek-v4-flash", "thinking:enabled|low");
  assert.deepEqual(body3.thinking, { type: "enabled" });
  assert.equal(body3.reasoning_effort, undefined);

  // UCA-182 Phase 22b: when the user hasn't picked anything, the v4
  // path now emits thinking:{type:"disabled"} explicitly so the
  // upstream default can't turn thinking back on. Compatibility aliases
  // keep the untouched body behaviour unless the user selects a toggle.
  const body4 = applyReasoningSelectionToBody({ temperature: 0.3 }, provider, "deepseek-v4-flash", "");
  assert.deepEqual(body4, { temperature: 0.3, thinking: { type: "disabled" } });
  const body4b = applyReasoningSelectionToBody({ temperature: 0.3 }, provider, "deepseek-chat", "");
  assert.deepEqual(body4b, { temperature: 0.3 });
}

console.log("ok verify-deepseek-v4");
