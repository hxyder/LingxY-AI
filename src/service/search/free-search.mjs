/**
 * Free web-search client.
 *
 * Primary:  DuckDuckGo HTML endpoint (html.duckduckgo.com/html/)
 * Fallback: DuckDuckGo Lite endpoint (lite.duckduckgo.com/lite/)
 *
 * No API key, no rate-limit registration. Both endpoints are scraped with
 * browser-realistic headers. The parsers are tolerant of markup changes.
 */

const DEFAULT_FETCH = (typeof fetch === "function") ? fetch : null;
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";

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

function decodeUddg(url = "") {
  if (url.startsWith("//")) url = `https:${url}`;
  const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try { return decodeURIComponent(uddgMatch[1]); } catch { /* keep as-is */ }
  }
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

    if (title && url && !url.includes("duckduckgo.com")) {
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
      if (title && url && !url.includes("duckduckgo.com")) {
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
    if (!title || url.includes("duckduckgo.com")) continue;
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
    if (!response.ok) return { results: [], provider: "duckduckgo_html", ok: false, fetchFailed: true };
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
    if (!response.ok) return { results: [], provider: "duckduckgo_lite", ok: false, fetchFailed: true };
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

  // Try primary DDG HTML endpoint, fall back to DDG Lite on empty results.
  const primary = await tryDdgHtml({ q, recency: normalizedRecency, fetchImpl, signal, limit });
  if (primary.results.length > 0) {
    return { query: q, results: primary.results, provider: primary.provider, recency: normalizedRecency, fetchFailed: false };
  }

  const fallback = await tryDdgLite({ q, recency: normalizedRecency, fetchImpl, signal, limit });
  if (fallback.results.length > 0) {
    return { query: q, results: fallback.results, provider: fallback.provider, recency: normalizedRecency, fetchFailed: false };
  }

  // Both endpoints returned no results. Report a network failure only when
  // at least one of them had a fetch-level error (HTTP error, timeout, or bot
  // detection page). If both responded normally with no organic results that
  // is a genuine "no results" case rather than a connectivity problem.
  const fetchFailed = primary.fetchFailed || fallback.fetchFailed;
  return {
    query: q,
    results: [],
    provider: primary.provider,
    recency: normalizedRecency,
    fetchFailed
  };
}
