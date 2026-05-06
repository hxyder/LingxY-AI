/**
 * Free translation client.
 *
 * Provides translation without an API key by using two free, public endpoints:
 *   1. Google web translate_a/single endpoint — primary for low-latency selections
 *   2. MyMemory  (https://api.mymemory.translated.net) — fallback, ~5000 chars/IP/day
 *
 * Both providers are no-key, no-signup. The module is designed for short-to-medium
 * snippets (selection text, paragraphs). Long inputs are chunked on sentence
 * boundaries before being sent to providers.
 *
 * The fetch implementation can be injected for testing.
 */

const DEFAULT_FETCH = (typeof fetch === "function") ? fetch : null;

const MAX_CHUNK_CHARS = 480;       // MyMemory single-request limit is ~500
const PROVIDERS = ["google_web", "mymemory"];

// ─────────────────────────────────────────────────────────────────────────────
// Language helpers

const CHINESE_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/;
const KOREAN_REGEX = /[\uac00-\ud7af]/;
const CYRILLIC_REGEX = /[\u0400-\u04ff]/;
const ARABIC_REGEX = /[\u0600-\u06ff]/;

const LANGUAGE_ALIASES = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  cn: "zh-CN",
  chinese: "zh-CN",
  english: "en",
  japanese: "ja",
  korean: "ko",
  french: "fr",
  german: "de",
  spanish: "es",
  russian: "ru",
  arabic: "ar"
};

export function normalizeLanguageCode(code) {
  if (!code) return null;
  const lower = String(code).trim().toLowerCase();
  if (LANGUAGE_ALIASES[lower]) return LANGUAGE_ALIASES[lower];
  // tolerate case variants like "EN", "Fr"
  if (lower.length === 2) return lower;
  if (lower.length === 5 && lower[2] === "-") return `${lower.slice(0, 2)}-${lower.slice(3).toUpperCase()}`;
  return lower;
}

export function detectSourceLanguage(text = "") {
  if (!text) return "en";
  if (CHINESE_REGEX.test(text)) return "zh-CN";
  if (JAPANESE_REGEX.test(text)) return "ja";
  if (KOREAN_REGEX.test(text)) return "ko";
  if (CYRILLIC_REGEX.test(text)) return "ru";
  if (ARABIC_REGEX.test(text)) return "ar";
  return "en";
}

// If no target is provided, translate non-Chinese -> Chinese, Chinese -> English.
export function pickDefaultTarget(sourceLang) {
  return sourceLang === "zh-CN" || sourceLang === "zh-TW" ? "en" : "zh-CN";
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking

export function splitIntoChunks(text, maxChars = MAX_CHUNK_CHARS) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // split on sentence boundaries (Chinese & Latin), keeping inter-sentence whitespace
  const parts = trimmed.split(/(?<=[。！？!?.\n])/);
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    if (!part) continue;
    if (buffer.length + part.length > maxChars) {
      if (buffer) {
        chunks.push(buffer);
        buffer = "";
      }
      if (part.length > maxChars) {
        // hard split very long sentences
        for (let i = 0; i < part.length; i += maxChars) {
          chunks.push(part.slice(i, i + maxChars));
        }
        continue;
      }
    }
    buffer += part;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementations

async function callMyMemory({ text, source, target, fetchImpl, signal }) {
  // MyMemory expects pairs like "en|zh-CN"
  const langPair = `${source === "auto" ? "autodetect" : mapToMyMemoryCode(source)}|${mapToMyMemoryCode(target)}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}&de=uca@local`;
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`mymemory_http_${response.status}`);
  }
  const data = await response.json();
  if (data?.responseStatus && Number(data.responseStatus) >= 400) {
    throw new Error(`mymemory_${data.responseStatus}_${(data.responseDetails ?? "").slice(0, 80)}`);
  }
  const translated = data?.responseData?.translatedText;
  if (!translated || typeof translated !== "string") {
    throw new Error("mymemory_no_text");
  }
  return {
    text: translated,
    detectedSource: data?.responseData?.detectedLanguage ?? source,
    provider: "mymemory"
  };
}

function mapToMyMemoryCode(code) {
  if (!code) return "en";
  const norm = normalizeLanguageCode(code);
  // MyMemory uses dashes (zh-CN) — same as our normalized form
  return norm;
}

async function callGoogleWeb({ text, source, target, fetchImpl, signal }) {
  const sl = source === "auto" ? "auto" : mapToGoogleCode(source);
  const tl = mapToGoogleCode(target);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`google_http_${response.status}`);
  }
  const data = await response.json();
  // Shape: [[ ["你好","Hello",null,null,1], ... ], null, "en", ...]
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = segments.map((segment) => (Array.isArray(segment) ? segment[0] : "")).join("");
  if (!translated) {
    throw new Error("google_no_text");
  }
  return {
    text: translated,
    detectedSource: data?.[2] ?? source,
    provider: "google_web"
  };
}

function mapToGoogleCode(code) {
  if (!code) return "en";
  const norm = normalizeLanguageCode(code);
  // Google web endpoint uses lowercase regional codes for Chinese
  if (norm === "zh-CN") return "zh-CN";
  if (norm === "zh-TW") return "zh-TW";
  return norm;
}

const PROVIDER_FUNCS = {
  mymemory: callMyMemory,
  google_web: callGoogleWeb
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API

export async function translateChunk({
  text,
  source = "auto",
  target = "zh-CN",
  fetchImpl = DEFAULT_FETCH,
  signal,
  preferredProvider = null
} = {}) {
  if (!fetchImpl) {
    throw new Error("translate_no_fetch_available");
  }
  if (!text || !text.trim()) {
    return { text: "", detectedSource: source, provider: "noop" };
  }

  const order = preferredProvider
    ? [preferredProvider, ...PROVIDERS.filter((p) => p !== preferredProvider)]
    : PROVIDERS;

  const errors = [];
  for (const provider of order) {
    const fn = PROVIDER_FUNCS[provider];
    if (!fn) continue;
    try {
      return await fn({ text, source, target, fetchImpl, signal });
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);
    }
  }
  throw new Error(`free_translator_all_failed (${errors.join(" | ")})`);
}

export async function translateText({
  text,
  source = "auto",
  target = null,
  fetchImpl = DEFAULT_FETCH,
  signal,
  preferredProvider = null
} = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return {
      input: "",
      text: "",
      source_language: source,
      target_language: target ?? "zh-CN",
      provider: "noop",
      chunks: []
    };
  }

  const detectedSource = source === "auto" ? detectSourceLanguage(trimmed) : normalizeLanguageCode(source);
  const resolvedTarget = normalizeLanguageCode(target) ?? pickDefaultTarget(detectedSource);

  // If source already matches target, no-op (avoid pointless API calls)
  if (resolvedTarget && detectedSource && resolvedTarget === detectedSource) {
    return {
      input: trimmed,
      text: trimmed,
      source_language: detectedSource,
      target_language: resolvedTarget,
      provider: "noop_same_language",
      chunks: [{ source: trimmed, translated: trimmed, provider: "noop_same_language" }]
    };
  }

  const pieces = splitIntoChunks(trimmed);
  const chunks = [];
  let providerUsed = null;
  let detectedFromProvider = null;

  for (const piece of pieces) {
    const result = await translateChunk({
      text: piece,
      source: source === "auto" ? "auto" : detectedSource,
      target: resolvedTarget,
      fetchImpl,
      signal,
      preferredProvider
    });
    chunks.push({
      source: piece,
      translated: result.text,
      provider: result.provider
    });
    providerUsed ??= result.provider;
    detectedFromProvider ??= result.detectedSource;
  }

  return {
    input: trimmed,
    text: chunks.map((c) => c.translated).join(""),
    source_language: detectedFromProvider ?? detectedSource,
    target_language: resolvedTarget,
    provider: providerUsed ?? "unknown",
    chunks
  };
}

export const FREE_TRANSLATOR_PROVIDERS = Object.freeze([...PROVIDERS]);
