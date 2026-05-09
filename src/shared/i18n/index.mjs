import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const SUPPORTED_LOCALES = Object.freeze(["en-US", "zh-CN"]);
export const DEFAULT_LOCALE = "en-US";

const DICTIONARIES = Object.freeze({
  "en-US": require("./locales/en-US.json"),
  "zh-CN": require("./locales/zh-CN.json")
});

export function normalizeLocale(locale = DEFAULT_LOCALE) {
  const raw = String(locale ?? "").trim();
  if (SUPPORTED_LOCALES.includes(raw)) return raw;
  const lowered = raw.toLowerCase();
  if (lowered === "zh" || lowered === "zh-cn" || lowered.startsWith("zh-hans")) return "zh-CN";
  if (lowered === "en" || lowered === "en-us" || lowered.startsWith("en-")) return "en-US";
  return DEFAULT_LOCALE;
}

export function t(locale, key, vars = {}) {
  const normalized = normalizeLocale(locale);
  const dict = DICTIONARIES[normalized] ?? DICTIONARIES[DEFAULT_LOCALE];
  const fallback = DICTIONARIES[DEFAULT_LOCALE]?.[key] ?? key;
  const template = dict?.[key] ?? fallback;
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

export function dictionaryForLocale(locale = DEFAULT_LOCALE) {
  return DICTIONARIES[normalizeLocale(locale)] ?? DICTIONARIES[DEFAULT_LOCALE];
}
