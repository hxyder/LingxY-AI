/**
 * Free web-search client.
 *
 * Primary:  DuckDuckGo HTML endpoint (html.duckduckgo.com/html/)
 * Fallback: DuckDuckGo Lite endpoint (lite.duckduckgo.com/lite/)
 *
 * No API key, no rate-limit registration. Both endpoints are scraped with
 * browser-realistic headers. The parsers are tolerant of markup changes.
 */

import {
  decodeHtmlEntities,
  htmlMentionsHost,
  htmlToPlainText,
  urlHostnameMatches
} from "../security/html-utils.mjs";

const DEFAULT_FETCH = (typeof fetch === "function") ? fetch : null;
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";
const GOOGLE_URL = "https://www.google.com/search";
const BING_URL = "https://www.bing.com/search";
const BAIDU_URL = "https://www.baidu.com/s";

// Very rough CN-query detection — any CJK character triggers the Baidu
// fallback ahead of Bing. Latin-only queries prefer Bing first.
const CJK_RE = /[\u3400-\u9fff]/;
function looksChinese(query) { return CJK_RE.test(String(query ?? "")); }

// Realistic Chrome User-Agent — avoids bot-detection on DDG's scrape checks.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const RECENCY_ALIASES = Object.freeze({
  d: "d",
  day: "d",
  today: "d",
  w: "w",
  week: "w",
  m: "m",
  month: "m",
  y: "y",
  year: "y"
});

const MONTH_INDEX = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
});

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function extractPublishedDate(text = "") {
  const raw = String(text ?? "");
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  if (iso) return { date: isoDate(iso[1], iso[2], iso[3]), precision: "day" };

  const cn = raw.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\b/u);
  if (cn) return { date: isoDate(cn[1], cn[2], cn[3]), precision: "day" };

  const monthDayYear = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s*(20\d{2})\b/iu);
  if (monthDayYear) {
    return {
      date: isoDate(monthDayYear[3], MONTH_INDEX[monthDayYear[1].toLowerCase().replace(/\.$/u, "")], monthDayYear[2]),
      precision: "day"
    };
  }

  const monthYear = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(20\d{2})\b/iu);
  if (monthYear) {
    return {
      date: isoDate(monthYear[2], MONTH_INDEX[monthYear[1].toLowerCase().replace(/\.$/u, "")], 1),
      precision: "month"
    };
  }

  return { date: null, precision: null };
}

function attachPublishedDate(result = {}) {
  const extracted = extractPublishedDate([result.title, result.snippet].filter(Boolean).join(" "));
  if (!extracted.date) return result;
  return {
    ...result,
    published_date: extracted.date,
    published_date_precision: extracted.precision
  };
}

export function inferSearchRecency(query = "") {
  const text = String(query ?? "").toLowerCase();
  if (/(今天|今日|24\s*小时|today|breaking)/i.test(text)) return "d";
  if (/(本周|一周|近\s*7\s*天|week)/i.test(text)) return "w";
  if (/(本月|一个月|近\s*30\s*天|month)/i.test(text)) return "m";
  if (/(今年|一年|近\s*12\s*个月|year)/i.test(text)) return "y";
  if (/(时政|要闻|最新|最近|新闻|消息|近况|latest|recent|current|news)/i.test(text)) return "w";
  return null;
}

export function normalizeSearchRecency(recency, query = "") {
  const explicit = RECENCY_ALIASES[String(recency ?? "").trim().toLowerCase()];
  return explicit ?? inferSearchRecency(query);
}

function stripTags(html = "") {
  return htmlToPlainText(html)
    .replace(/\s+/g, " ")
    .trim();
}

function decodeUddg(url = "") {
  url = decodeHtmlEntities(url);
  if (url.startsWith("//")) url = `https:${url}`;
  const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try { return decodeURIComponent(uddgMatch[1]); } catch { /* keep as-is */ }
  }
  return url;
}

/**
 * Bing wraps every organic result href in a tracking redirect of the form:
 *   https://www.bing.com/ck/a?!&...&u=a1<URL-safe base64 of target>&ntb=1
 *
 * The `a1` is a 2-char scheme prefix Bing prepends before the base64. Without
 * decoding, downstream consumers see every result as `bing.com` domain (which
 * breaks evidence-normalizer's distinct_domain_count) and `fetch_url_content`
 * calls hit Bing instead of the actual publisher.
 *
 * Returns the decoded URL or the original href if no Bing-redirect pattern
 * matches / the base64 decode fails. Other Bing URL kinds (e.g. image cards
 * with non-URL `u=` payloads) fall through unchanged.
 */
export function decodeBingRedirect(url = "") {
  if (typeof url !== "string" || url.length === 0) return url;
  url = decodeHtmlEntities(url);
  if (!/^https?:\/\/(?:www\.)?bing\.com\/ck\/a/i.test(url)) return url;
  const uMatch = url.match(/[?&]u=([^&]+)/);
  if (!uMatch) return url;
  let raw = uMatch[1];
  try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
  // Strip the 2-char scheme prefix Bing prepends (a1 most common; very
  // occasionally a2 / a3 appear). If the prefix is missing, fall through.
  const prefixed = raw.match(/^a[0-9]([A-Za-z0-9_-]+={0,2})$/);
  if (!prefixed) return url;
  // URL-safe base64: `-` → `+`, `_` → `/`, then standard atob.
  const b64 = prefixed[1].replace(/-/g, "+").replace(/_/g, "/");
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch { /* fall through */ }
  return url;
}

/**
 * Parse DuckDuckGo HTML result page.
 * Tries multiple selector strategies to handle markup variations.
 */
export function parseDuckDuckGoHtml(html = "", limit = 5) {
  if (!html) return [];
  const results = [];

  // Strategy 1: split by result divs — handles both old and new DDG HTML markup.
  // DDG has used at least three class naming conventions over the years:
  //   "result results_links results_links_deep web-result"  (current)
  //   "result result--url"                                   (older)
  //   "results_links"                                        (legacy)
  // We match any <div …class="… result …"> block.
  const blockSplit = html.split(/<div[^>]*\bclass="[^"]*\bresult(?:s_links|__body|\s|")[^"]*"/i);

  for (let i = 1; i < blockSplit.length && results.length < limit; i++) {
    const block = blockSplit[i];

    // Title + URL: look for result__a, result-link, or any prominent link in block
    const titleHrefRe = /<a[^>]*class="[^"]*result(?:__a|[-_]link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
    let titleMatch = block.match(titleHrefRe);
    // Fallback: first <b><a …> inside block (DDG Lite pattern inside HTML fallback)
    if (!titleMatch) {
      titleMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>\s*<b>([\s\S]*?)<\/b>/i);
    }
    const title = titleMatch ? stripTags(titleMatch[2] ?? titleMatch[1]) : "";
    const rawUrl = titleMatch ? (titleMatch[1] ?? "") : "";
    const url = rawUrl ? decodeUddg(rawUrl) : "";

    // Snippet: result__snippet class, or first non-title text-heavy element
    const snippetRe = /<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i;
    let snippetMatch = block.match(snippetRe);
    if (!snippetMatch) {
      // try result-snippet (DDG Lite class)
      snippetMatch = block.match(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    }
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";

    if (title && url && !urlHostnameMatches(url, "duckduckgo.com")) {
      results.push({ title, url, snippet });
    }
  }

  // Strategy 2: if strategy 1 yielded nothing, try a simpler approach —
  // find all result__a links in the page
  if (results.length === 0) {
    const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(html)) && results.length < limit) {
      const url = decodeUddg(m[1]);
      const title = stripTags(m[2]);
      if (title && url && !urlHostnameMatches(url, "duckduckgo.com")) {
        results.push({ title, url, snippet: "" });
      }
    }
  }

  return results;
}

/**
 * Parse DuckDuckGo Lite result page.
 * DDG Lite returns a simple <table> without JavaScript.
 * Structure: alternating rows of title links and snippet cells.
 */
/**
 * Google wraps organic-result hrefs in `/url?q=<URL>&...` (sometimes
 * absolute `https://www.google.com/url?q=...`). Decode the `q=` param so
 * downstream consumers see the actual publisher URL. Returns the original
 * href when no Google-redirect pattern matches.
 */
export function decodeGoogleRedirect(url = "") {
  if (typeof url !== "string" || url.length === 0) return url;
  const isPath = url.startsWith("/url?");
  const isAbs = /^https?:\/\/(?:www\.)?google\.com\/url\?/i.test(url);
  if (!isPath && !isAbs) return url;
  const m = url.match(/[?&]q=([^&]+)/) ?? url.match(/[?&]url=([^&]+)/);
  if (!m) return url;
  try {
    const decoded = decodeURIComponent(m[1]);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch { /* fall through */ }
  return url;
}

/**
 * Parse Google's HTML search page. Google A/B-tests its markup constantly
 * so the parser is intentionally tolerant: anchor on `<h3>` for the title
 * inside any block whose class contains one of the modern container
 * markers (`g`, `tF2Cxc`, `MjjYud`, `Gx5Zad`). Snippets are pulled from
 * one of the known classes (`VwiC3b`, `aCOpRe`, `s3v9rd`, `st`). Both
 * the result block boundaries and the snippet element vary, so we keep
 * the regexes loose and rely on dropping anything that doesn't decode
 * to a real http(s) URL.
 *
 * Google bot-detects aggressively. When it serves a sorry/captcha page
 * the caller's `isBotDetectionPage` check fires before we ever get
 * here; results=[] is a routine outcome and the cascade falls through
 * to the next provider.
 */
export function parseGoogleHtml(html = "", limit = 5) {
  if (!html) return [];
  const results = [];
  // Block split is kept loose — Google's wrapper class set has at least
  // four common variants (g / tF2Cxc / MjjYud / Gx5Zad) and changes
  // between deployments. We just look for any block that has an h3 + a
  // close together.
  const linkRe = /<a[^>]*href="([^"]+)"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  const seen = new Set();
  let m;
  while ((m = linkRe.exec(html)) && results.length < limit) {
    const url = decodeGoogleRedirect(m[1]);
    const title = stripTags(m[2]);
    if (!title || !url || !/^https?:/i.test(url)) continue;
    if (/^https?:\/\/(?:www\.)?google\.com\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    // Snippet: scan the next ~1500 chars after the link for a known
    // snippet container. This is approximate but matches how Google
    // lays out the cards in practice.
    const tailStart = m.index + m[0].length;
    const tail = html.slice(tailStart, tailStart + 1500);
    const snippetMatch = tail.match(/<(?:div|span)[^>]*class="[^"]*(?:VwiC3b|aCOpRe|s3v9rd|MUxGbd|st)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
    results.push({ title, url, snippet });
  }
  return results;
}

/**
 * Parse Bing search results page. Bing's modern markup wraps each
 * organic result in an <li class="b_algo"> with <h2><a href></a></h2>
 * for the title and a <div class="b_caption"><p> for the snippet.
 * Older markup uses .b_tlbh etc. — we take the li-based scan which
 * has been stable for years.
 */
export function parseBingHtml(html = "", limit = 5) {
  if (!html) return [];
  const results = [];
  const liRe = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) && results.length < limit) {
    const block = m[1];
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
    if (!titleMatch) continue;
    const url = decodeBingRedirect(titleMatch[1]);
    const title = stripTags(titleMatch[2]);
    if (!title || !url || !/^https?:/i.test(url)) continue;
    // After decoding, drop any href that's still pointing at bing.com — that
    // means the redirect couldn't be unwrapped and we'd otherwise feed
    // fetch_url_content a tracking URL that fails or returns the SERP again.
    if (/^https?:\/\/(?:www\.)?bing\.com\//i.test(url)) continue;
    // Bing wraps snippets in <p> inside .b_caption. Occasionally there
    // are multiple — grab the first non-empty one.
    const snippetMatch = block.match(/<div[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1].replace(/<p[^>]*>/gi, " ").replace(/<\/p>/gi, " ")) : "";
    results.push({ title, url, snippet });
  }
  return results;
}

/**
 * Parse Baidu search results page. Baidu wraps each organic result in
 * <div class="result c-container"> with <h3><a href>Title</a></h3> and
 * a snippet <div class="c-abstract"> or <span class="content-right_*">.
 * Important: Baidu wraps outbound URLs in its own redirector — decode
 * the <a href="http://www.baidu.com/link?url=..."> target so consumers
 * can actually cite the source URL.
 */
export function parseBaiduHtml(html = "", limit = 5) {
  if (!html) return [];
  const results = [];
  const blockRe = /<div[^>]*class="[^"]*\bc-container\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m;
  while ((m = blockRe.exec(html)) && results.length < limit) {
    const block = m[1];
    const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const url = titleMatch[1];
    const title = stripTags(titleMatch[2]);
    if (!title || !url || !/^https?:/i.test(url)) continue;
    // Snippet can be .content-right, .c-abstract, or .c-row — try in
    // order and fall back to any remaining text.
    const snippetMatch = block.match(/<(?:span|div)[^>]*class="[^"]*(?:content-right_[\w-]*|c-abstract|c-row)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
    results.push({ title, url, snippet });
  }
  return results;
}

export function parseDuckDuckGoLite(html = "", limit = 5) {
  if (!html) return [];
  const results = [];

  // Each organic result spans two table rows:
  //   Row 1: <td colspan="2"><a class="result-link" href="..."><b>Title</b></a></td>
  //   Row 2: <td class="result-snippet">Snippet</td>
  //          <td class="result-siteinfo"><a …>site</a></td>

  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links = [];
  let m;
  while ((m = linkRe.exec(html))) {
    links.push({ url: decodeUddg(m[1]), title: stripTags(m[2]) });
  }

  const snippets = [];
  while ((m = snippetRe.exec(html))) {
    snippets.push(stripTags(m[1]));
  }

  for (let i = 0; i < Math.min(links.length, limit); i++) {
    const { url, title } = links[i];
    if (!title || urlHostnameMatches(url, "duckduckgo.com")) continue;
    results.push({ title, url, snippet: snippets[i] ?? "" });
  }

  return results;
}

export function formatResultsAsText(results = [], { maxResults = 5, maxSnippetChars = 220 } = {}) {
  if (!results.length) return "(no results)";
  return results.slice(0, maxResults).map((result, index) => {
    const snippet = (result.snippet ?? "").slice(0, maxSnippetChars);
    return `${index + 1}. ${result.title}\n   ${result.url}\n   ${snippet}`;
  }).join("\n\n");
}

export function formatResultsForAssistant(results = [], {
  query = "",
  provider = "web_search",
  recency = null,
  maxResults = 5,
  maxSnippetChars = 260
} = {}) {
  const recencyLabel = {
    d: "过去一天",
    w: "过去一周",
    m: "过去一个月",
    y: "过去一年"
  }[recency] ?? "不限时间";
  const lines = [
    `搜索结果：${query || "(未命名话题)"}`,
    `来源：${provider}；时间范围：${recencyLabel}`,
    ""
  ];

  if (!results.length) {
    lines.push("没有找到可用结果。可以换一个更具体的关键词再试。");
    return lines.join("\n");
  }

  for (const [index, result] of results.slice(0, maxResults).entries()) {
    const snippet = (result.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, maxSnippetChars);
    lines.push(`${index + 1}. ${result.title}`);
    if (result.published_date) {
      lines.push(`   日期：${result.published_date}${result.published_date_precision === "month" ? "（月份级）" : ""}`);
    }
    if (snippet) lines.push(`   摘要：${snippet}`);
    lines.push(`   链接：${result.url}`);
    lines.push("");
  }

  lines.push("下一步可以基于这些结果做归纳、对比、时间线或风险点分析。");
  return lines.join("\n").trim();
}

/**
 * Detect if DDG returned an anti-bot / CAPTCHA page instead of real results.
 * These pages return HTTP 200 but contain no organic result blocks.
 */
function isBotDetectionPage(html = "") {
  if (html.length < 800) return true; // too short to be a real results page
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("are you a robot") ||
    lower.includes("trouble accessing google search") ||
    lower.includes("/httpservice/retry/enablejs") ||
    lower.includes("百度安全验证") ||
    htmlMentionsHost(html, "wappass.baidu.com") ||
    lower.includes("please verify") ||
    lower.includes("unusual traffic") ||
    lower.includes("blocked") && lower.includes("duckduckgo")
  );
}

async function tryDdgHtml({ q, recency, fetchImpl, signal, limit }) {
  const params = new URLSearchParams({ q, kl: "us-en", ia: "web" });
  if (recency) params.set("df", recency);
  try {
    const response = await fetchImpl(DDG_HTML_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://html.duckduckgo.com",
        "Referer": "https://html.duckduckgo.com/"
      },
      body: params.toString(),
      signal
    });
    if (!response.ok || (typeof response.status === "number" && response.status !== 200)) return { results: [], provider: "duckduckgo_html", ok: false, fetchFailed: true };
    const html = await response.text();
    if (isBotDetectionPage(html)) {
      return { results: [], provider: "duckduckgo_html", ok: false, fetchFailed: true, botDetected: true };
    }
    const results = parseDuckDuckGoHtml(html, limit);
    return { results, provider: "duckduckgo_html", ok: true, fetchFailed: false };
  } catch {
    return { results: [], provider: "duckduckgo_html", ok: false, fetchFailed: true };
  }
}

async function tryGoogle({ q, recency, fetchImpl, signal, limit }) {
  // num caps at ~100 in practice but Google often serves ~10 organic
  // hits per page regardless. We ask for max(limit, 10) to honour
  // higher limits when the page actually cooperates.
  const params = new URLSearchParams({ q, hl: "en", num: String(Math.max(limit, 10)) });
  // Google recency: tbs=qdr:d|w|m|y
  if (recency) params.set("tbs", `qdr:${recency}`);
  try {
    const response = await fetchImpl(`${GOOGLE_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.google.com/"
      },
      signal
    });
    if (!response.ok) return { results: [], provider: "google", ok: false, fetchFailed: true };
    const html = await response.text();
    if (isBotDetectionPage(html)) {
      return { results: [], provider: "google", ok: false, fetchFailed: true, botDetected: true };
    }
    const results = parseGoogleHtml(html, limit);
    return { results, provider: "google", ok: results.length > 0, fetchFailed: false };
  } catch {
    return { results: [], provider: "google", ok: false, fetchFailed: true };
  }
}

async function tryBing({ q, recency, fetchImpl, signal, limit }) {
  const params = new URLSearchParams({ q, setlang: "en-us", count: String(Math.max(limit, 10)) });
  // Bing recency uses freshness= day|week|month (no year), so we drop
  // year-level filtering rather than send something Bing will reject.
  const fresh = { d: "day", w: "week", m: "month" }[recency];
  if (fresh) params.set("freshness", fresh);
  try {
    const response = await fetchImpl(`${BING_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.bing.com/"
      },
      signal
    });
    if (!response.ok) return { results: [], provider: "bing", ok: false, fetchFailed: true };
    const html = await response.text();
    if (isBotDetectionPage(html)) {
      return { results: [], provider: "bing", ok: false, fetchFailed: true, botDetected: true };
    }
    const results = parseBingHtml(html, limit);
    return { results, provider: "bing", ok: results.length > 0, fetchFailed: false };
  } catch {
    return { results: [], provider: "bing", ok: false, fetchFailed: true };
  }
}

async function tryBaidu({ q, fetchImpl, signal, limit }) {
  const params = new URLSearchParams({ wd: q, rn: String(Math.max(limit, 10)) });
  try {
    const response = await fetchImpl(`${BAIDU_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "Referer": "https://www.baidu.com/"
      },
      signal
    });
    if (!response.ok) return { results: [], provider: "baidu", ok: false, fetchFailed: true };
    const html = await response.text();
    if (isBotDetectionPage(html)) {
      return { results: [], provider: "baidu", ok: false, fetchFailed: true, botDetected: true };
    }
    const results = parseBaiduHtml(html, limit);
    return { results, provider: "baidu", ok: results.length > 0, fetchFailed: false };
  } catch {
    return { results: [], provider: "baidu", ok: false, fetchFailed: true };
  }
}

async function tryDdgLite({ q, recency, fetchImpl, signal, limit }) {
  const params = new URLSearchParams({ q });
  if (recency) params.set("df", recency);
  try {
    const response = await fetchImpl(DDG_LITE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://lite.duckduckgo.com",
        "Referer": "https://lite.duckduckgo.com/"
      },
      body: params.toString(),
      signal
    });
    if (!response.ok || (typeof response.status === "number" && response.status !== 200)) return { results: [], provider: "duckduckgo_lite", ok: false, fetchFailed: true };
    const html = await response.text();
    if (isBotDetectionPage(html)) {
      return { results: [], provider: "duckduckgo_lite", ok: false, fetchFailed: true, botDetected: true };
    }
    const results = parseDuckDuckGoLite(html, limit);
    return { results, provider: "duckduckgo_lite", ok: results.length > 0, fetchFailed: false };
  } catch {
    return { results: [], provider: "duckduckgo_lite", ok: false, fetchFailed: true };
  }
}

export async function searchWeb({
  query,
  limit = 5,
  recency = null,
  fetchImpl = DEFAULT_FETCH,
  signal
} = {}) {
  if (!fetchImpl) {
    throw new Error("free_search_no_fetch");
  }
  const q = (query ?? "").trim();
  if (!q) {
    return { query: "", results: [], provider: "noop" };
  }

  const normalizedRecency = normalizeSearchRecency(recency, q);

  // Cascade order. DDG stays primary — it respects recency filters and
  // returns clean URLs (no tracking redirect). Google sits between DDG
  // and Bing: when DDG bot-blocks, Google is preferred over Bing because
  // (a) Bing wraps every href in a `bing.com/ck/a` tracking redirect that
  // confuses domain accounting and breaks fetch_url_content even after
  // we decode it (some redirects don't unwrap), and (b) Google returns
  // higher-relevance results for most queries. CJK queries still front
  // Baidu (best for Chinese content), then Google, then Bing.
  const isChinese = looksChinese(q);
  const cascade = [
    (opts) => tryDdgHtml(opts),
    (opts) => tryDdgLite(opts),
    ...(isChinese
      ? [(opts) => tryBaidu(opts), (opts) => tryGoogle(opts), (opts) => tryBing(opts)]
      : [(opts) => tryGoogle(opts), (opts) => tryBing(opts), (opts) => tryBaidu(opts)])
  ];

  const attempts = [];
  for (const attempt of cascade) {
    const result = await attempt({ q, recency: normalizedRecency, fetchImpl, signal, limit });
    attempts.push(result);
    if (result.results.length > 0) {
      const datedResults = result.results.map(attachPublishedDate);
      return {
        query: q,
        results: datedResults,
        provider: result.provider,
        recency: normalizedRecency,
        fetchFailed: false,
        attempts: attempts.map((a) => ({ provider: a.provider, ok: a.ok, fetchFailed: a.fetchFailed }))
      };
    }
  }

  // Every provider yielded no organic results. If AT LEAST ONE had a
  // fetch-level / bot-detection failure, surface that so the LLM knows
  // the network path is compromised (UCA-039). If all responded 200 OK
  // with empty pages, that's a genuine "no results" — report truthfully.
  const fetchFailed = attempts.some((a) => a.fetchFailed);
  return {
    query: q,
    results: [],
    provider: attempts[0]?.provider ?? "none",
    recency: normalizedRecency,
    fetchFailed,
    attempts: attempts.map((a) => ({ provider: a.provider, ok: a.ok, fetchFailed: a.fetchFailed }))
  };
}
