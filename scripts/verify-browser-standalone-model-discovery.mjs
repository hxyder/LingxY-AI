import assert from "node:assert/strict";
import {
  PROVIDER_DEFAULT_MODELS,
  normalizeStandaloneConfig
} from "../browser_ext/shared/provider-catalog.js";
import { discoverProviderModels } from "../browser_ext/shared/model-discovery.js";

assert.equal(PROVIDER_DEFAULT_MODELS.deepseek, "deepseek-v4-flash");

const normalized = normalizeStandaloneConfig({
  provider: "deepseek",
  model: "deepseek-chat",
  apiKey: "sk-test"
});
assert.equal(normalized.model, "deepseek-v4-flash");

const discovered = await discoverProviderModels("deepseek", { apiKey: "" });
assert.equal(Array.isArray(discovered.models), true);
assert.equal(discovered.models.includes("deepseek-v4-flash"), true);
assert.equal(discovered.models[0], "deepseek-v4-flash");

console.log("Browser standalone model discovery verification passed.");
