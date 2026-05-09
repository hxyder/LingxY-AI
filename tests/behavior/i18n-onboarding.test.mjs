import test from "node:test";
import assert from "node:assert/strict";

import { buildFirstRunWizardViewModel } from "../../src/desktop/console/first_run_wizard/view-model.mjs";
import { buildProviderSetupStatus } from "../../src/service/ai/onboarding/provider-setup-status.mjs";
import { dictionaryForLocale, normalizeLocale, t } from "../../src/shared/i18n/index.mjs";

test("shared i18n lookup normalizes locale aliases and interpolates variables", () => {
  assert.equal(normalizeLocale("zh"), "zh-CN");
  assert.equal(normalizeLocale("en-GB"), "en-US");
  assert.equal(t("en-US", "providerSetup.providerNeedsSetup", { providerName: "OpenAI" }), "OpenAI needs setup");
  assert.equal(t("zh-CN", "providerSetup.providerNeedsSetup", { providerName: "OpenAI" }), "OpenAI 需要配置");
  assert.equal(t("zh-CN", "missing.key"), "missing.key");
});

test("first-run wizard can render zh-CN and en-US labels from dictionaries", () => {
  const zh = buildFirstRunWizardViewModel({ locale: "zh-CN" });
  const en = buildFirstRunWizardViewModel({ locale: "en-US" });

  assert.equal(zh.steps.find((step) => step.id === "welcome")?.title, "欢迎");
  assert.equal(en.steps.find((step) => step.id === "welcome")?.title, "Welcome");
  assert.equal(zh.steps.find((step) => step.id === "file_access")?.detail, "Explorer / uca-cli 入口是可选项，但建议启用");
  assert.equal(en.steps.find((step) => step.id === "file_access")?.detail, "Explorer / uca-cli entry is optional but recommended");
});

test("provider setup status localizes recovery copy without leaking secrets", () => {
  const status = buildProviderSetupStatus({
    locale: "zh-CN",
    config: {
      ai: {
        customProviders: [{
          id: "openai-main",
          name: "OpenAI Main",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1"
        }]
      }
    }
  });

  assert.equal(status.primaryIssue?.title, "OpenAI Main 需要配置");
  assert.match(status.primaryIssue?.detail ?? "", /API key|secret/u);
  assert.doesNotMatch(JSON.stringify(status), /sk-test|secret-value|"apiKey":/u);
});

test("locale dictionaries keep onboarding keys aligned", () => {
  const enKeys = Object.keys(dictionaryForLocale("en-US")).sort();
  const zhKeys = Object.keys(dictionaryForLocale("zh-CN")).sort();
  assert.deepEqual(zhKeys, enKeys);
});
