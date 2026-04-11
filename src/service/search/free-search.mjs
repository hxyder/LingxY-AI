/**
 * Free web-search client.
 *
 * Uses DuckDuckGo's HTML endpoint — no API key, no rate-limit registration.
 * Returns a list of `{ title, url, snippet }` entries parsed from the
 * server-rendered result page. This is best-effort: DuckDuckGo can change
 * its markup at any time, and the parser is deliberately tolerant.
 *
 * The fetch implementation can be injected for testing.
 */

const DEFAULT_FETCH = (typeof fetch === "function") ? fetch : null;
const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";

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

export function inferSearchRecency(query = "") {
  const text = String(query ?? "").toLowerCase();
  if (/(今天|今日|24\s*小时|today|breaking)/i.test(text)) return "d";
  if (/(本周|一周|近\s*7\s*天|week)/i.test(text)) return "w";
  if (/(本月|一个月|近\s*30\s*天|month)/i.test(text)) return "m";
  if (/(今年|一年|近\s*12\s*个月|year)/i.test(text)) return "y";
  if (/(今天|今日|时政|要闻|最新|最近|新闻|消息|近况|latest|recent|current|news)/i.test(text)) return "m";
  return null;
}

export function normalizeSearchRecency(recency, query = "") {
  const explicit = RECENCY_ALIASES[String(recency ?? "").trim().toLowerCase()];
  return explicit ?? inferSearchRecency(query);
}

function stripTags(html = "") {
  return String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse DuckDuckGo HTML result page. Each result lives inside a
// `<div class="result ...">` block with `.result__title a`, `.result__url`,
// and `.result__snippet`. DuckDuckGo wraps external URLs in a redirect with
// a `uddg=` query param — we decode that so the caller sees the real URL.
export function parseDuckDuckGoHtml(html = "", limit = 5) {
  if (!html) return [];
  const results = [];
  const blockRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*\bresult\b|<\/div>\s*<\/div>\s*$|$)/gi;
  let match;
  while ((match = blockRegex.exec(html)) && results.length < limit) {
    const block = match[0];

    const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a[^>]*class="[^"]*result__title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : "";

    const hrefMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"/i)
      ?? block.match(/<a[^>]*class="[^"]*result__title[^"]*"[^>]*href="([^"]+)"/i);
    let url = hrefMatch ? hrefMatch[1] : "";
    if (url.startsWith("//")) url = `https:${url}`;
    // Decode DuckDuckGo's redirect URL (?uddg=...)
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try { url = decodeURIComponent(uddgMatch[1]); } catch { /* keep as-is */ }
    }

    const snippetMatch = block.match(/<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
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
    if (snippet) lines.push(`   摘要：${snippet}`);
    lines.push(`   链接：${result.url}`);
    lines.push("");
  }

  lines.push("下一步可以基于这些结果做归纳、对比、时间线或风险点分析。");
  return lines.join("\n").trim();
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
  const params = new URLSearchParams({ q, kl: "wt-wt" });
  if (normalizedRecency) {
    params.set("df", normalizedRecency);
  }
  const body = params.toString();
  const response = await fetchImpl(DUCKDUCKGO_HTML_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UCA/1.0"
    },
    body,
    signal
  });

  if (!response.ok) {
    throw new Error(`duckduckgo_http_${response.status}`);
  }

  const html = await response.text();
  const results = parseDuckDuckGoHtml(html, limit);
  return {
    query: q,
    results,
    provider: "duckduckgo_html",
    recency: normalizedRecency
  };
}
