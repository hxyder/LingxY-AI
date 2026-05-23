import * as OpenCC from "opencc-js/t2cn";

let traditionalToSimplified = null;
const HAN_TEXT_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;

function outputLocaleKey(value = "") {
  return String(value || "").trim().toLowerCase().replace("_", "-");
}

export function wantsSimplifiedChineseOutput(locale = "") {
  const key = outputLocaleKey(locale);
  if (!key) return false;
  return key === "zh"
    || key === "zh-cn"
    || key === "zh-hans"
    || key.startsWith("zh-cn-")
    || key.startsWith("zh-hans-")
    || key === "cmn"
    || key === "cmn-cn"
    || key.startsWith("cmn-hans")
    || key === "cn";
}

export function normalizeTranscriptionTextForLocale(text = "", {
  outputLocale = "",
  lang = ""
} = {}) {
  const raw = String(text ?? "");
  if (!raw || !wantsSimplifiedChineseOutput(outputLocale || lang)) return raw;
  if (!HAN_TEXT_RE.test(raw)) return raw;
  traditionalToSimplified ??= OpenCC.Converter({ from: "tw", to: "cn" });
  return traditionalToSimplified(raw);
}

export function normalizeTranscriptionEventForLocale(event = {}, options = {}) {
  if (!event || typeof event !== "object") return event;
  const next = { ...event };
  if (typeof next.text === "string") {
    next.text = normalizeTranscriptionTextForLocale(next.text, options);
  }
  if (typeof next.transcript === "string") {
    next.transcript = normalizeTranscriptionTextForLocale(next.transcript, options);
  }
  return next;
}
