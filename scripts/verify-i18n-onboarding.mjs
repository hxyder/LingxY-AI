#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import { dictionaryForLocale, t } from "../src/shared/i18n/index.mjs";

const i18n = readFileSync("src/shared/i18n/index.mjs", "utf8");
const firstRun = readFileSync("src/desktop/console/first_run_wizard/view-model.mjs", "utf8");
const providerSetup = readFileSync("src/service/ai/onboarding/provider-setup-status.mjs", "utf8");
const behavior = readFileSync("tests/behavior/i18n-onboarding.test.mjs", "utf8");

assert.match(i18n, /SUPPORTED_LOCALES/u, "shared i18n module must declare supported locales");
assert.match(i18n, /locales\/en-US\.json/u, "shared i18n module must load en-US JSON");
assert.match(i18n, /locales\/zh-CN\.json/u, "shared i18n module must load zh-CN JSON");
assert.match(i18n, /export function t/u, "shared i18n module must expose t(locale,key,vars)");

assert.match(firstRun, /t\(locale,\s*"firstRun\.welcome\.title"/u, "first-run wizard must use i18n labels");
assert.match(providerSetup, /t\(locale,\s*"providerSetup\.providerNeedsSetup"/u, "provider setup issues must use i18n labels");
assert.match(providerSetup, /apiKeyAuthHint/u, "provider setup auth hints must be localized");

const enKeys = Object.keys(dictionaryForLocale("en-US")).sort();
const zhKeys = Object.keys(dictionaryForLocale("zh-CN")).sort();
assert.deepEqual(zhKeys, enKeys, "locale dictionaries must keep key parity");
assert.equal(t("zh", "firstRun.welcome.title"), "欢迎");
assert.equal(t("en-GB", "firstRun.welcome.title"), "Welcome");
assert.match(behavior, /provider setup status localizes recovery copy/u, "behavior tests must cover provider setup localization");

const command = "node scripts/verify-i18n-onboarding.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include i18n onboarding verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include i18n onboarding verifier");

console.log("[verify-i18n-onboarding] FW-021 onboarding i18n contract OK");
