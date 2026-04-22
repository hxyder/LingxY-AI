// Context enrichment for summarize / explain actions.
//
// When the user asks LingxY to summarize / explain a selection, the vanilla
// path sends only the selected text plus title + URL. That's enough for short
// one-paragraph selections but produces shallow answers when the user meant
// "summarize this page" with a representative snippet highlighted, or when
// the selection references external links that carry the real substance.
//
// Three enrichment channels:
//   1. Full-page overview — the section headings and meta description give
//      the LLM a skeleton of the surrounding context.
//   2. Selection neighbourhood — contextBefore/contextAfter from the content
//      script already capture this; we reuse them.
//   3. External links inside the selection — if the selection contains URLs
//      we fetch each (with a tight timeout, concurrency-capped) and inline
//      a short excerpt so the LLM can ground its summary on the linked
//      pages rather than hallucinate from the anchor text alone.

// UCA-168: tightened budgets. The old defaults (3 links × 3 s timeout, 6 s
// total) added up to 4-6 s of wall time when a page had several slow-to-
// respond inlined URLs, which the user felt as "summarize is slow". Most
// pages yield a useful outline + 0-2 fetched links well under 2 s, so a
// 2 s link timeout + 3 s total budget covers the common case without
// dragging the worst case.
const MAX_LINKS = 2;
const LINK_TIMEOUT_MS = 2_000;
const LINK_MAX_CHARS = 1500;
const PAGE_OUTLINE_MAX_CHARS = 800;
const TOTAL_ENRICH_BUDGET_MS = 3_000;

const ENRICH_ACTIONS = new Set([
  "summarize",
  "explain",
  "uca.summarize-selection",
  "uca.explain-page",
  "uca.fetch-link"
]);

export function shouldEnrichForAction(action) {
  return ENRICH_ACTIONS.has(action);
}

function extractUrlsFromText(text = "") {
  const out = [];
  const seen = new Set();
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0].replace(/[),.;!?'"]+$/, "");
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

// Run inside the page's isolated world so we can read the full DOM without
// disturbing page JS. Returns an outline object.
function pageOutlineExtractor() {
  const title = document.title || "";
  const metaDesc = document.querySelector('meta[name="description"]')?.content
    ?? document.querySelector('meta[property="og:description"]')?.content
    ?? "";
  const headings = [];
  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text) headings.push({ level: el.tagName.toLowerCase(), text: text.slice(0, 180) });
  });
  const firstP = document.querySelector("article p, main p, p")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return {
    url: location.href,
    hostname: location.hostname,
    title,
    description: metaDesc,
    headings: headings.slice(0, 20),
    leadParagraph: firstP.slice(0, 600)
  };
}

async function capturePageOutline(tabId, chromeApi = chrome) {
  if (!tabId || !chromeApi.scripting?.executeScript) return null;
  try {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId },
      func: pageOutlineExtractor
    });
    return results?.[0]?.result ?? null;
  } catch {
    return null;
  }
}

async function fetchLinkText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "Accept": "text/html,application/xhtml+xml" }
    });
    clearTimeout(t);
    if (!response.ok) return { url, ok: false, error: `http_${response.status}` };
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/.test(contentType)) {
      return { url, ok: false, error: `content_type:${contentType.split(";")[0]}` };
    }
    const raw = await response.text();
    // cheap strip: remove <script>/<style>/<head> then tags. Good enough for
    // LLM grounding — we're not rendering, just handing it a text corpus.
    const noScripts = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    const text = noScripts
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    return { url, ok: true, title, text: text.slice(0, LINK_MAX_CHARS) };
  } catch (error) {
    clearTimeout(t);
    return { url, ok: false, error: error?.name === "AbortError" ? "timeout" : (error?.message ?? "fetch_error") };
  }
}

function withDeadline(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

export async function enrichContextForAction({ action, selectionState, tab, chromeApi = chrome }) {
  if (!shouldEnrichForAction(action)) return null;

  const selectionText = `${selectionState?.text ?? ""}`;
  // For `uca.fetch-link` (right-click a link → "抓取并总结") the user's
  // selection is usually just the anchor text, not a URL. The actual target
  // lives in selectionState.url / capture.url. Seed the link-fetch list
  // with it so the enricher actually pulls the linked page's text. Without
  // this, fetch-link would fall back to summarizing the anchor text alone.
  const explicitUrls = [];
  if (action === "uca.fetch-link" || action === "fetch-link") {
    const candidate = `${selectionState?.url ?? ""}`.trim();
    if (/^https?:\/\//i.test(candidate)) explicitUrls.push(candidate);
  }
  const textUrls = extractUrlsFromText(selectionText);
  const urls = Array.from(new Set([...explicitUrls, ...textUrls])).slice(0, MAX_LINKS);
  const pageOutlinePromise = capturePageOutline(tab?.id, chromeApi);
  const linkPromises = urls.map((url) => fetchLinkText(url));

  const startAt = Date.now();
  const [pageOutline, linkResults] = await Promise.all([
    withDeadline(pageOutlinePromise, TOTAL_ENRICH_BUDGET_MS, null),
    withDeadline(Promise.all(linkPromises), TOTAL_ENRICH_BUDGET_MS, [])
  ]);
  const elapsedMs = Date.now() - startAt;

  return {
    pageOutline,
    linkResults: Array.isArray(linkResults) ? linkResults.filter(Boolean) : [],
    elapsedMs
  };
}

// Shape enrichment into a Markdown block the LLM can digest. Kept
// deterministic so we can test; caller concatenates into the prompt.
export function formatEnrichmentAsMarkdown(enrichment) {
  if (!enrichment) return "";
  const parts = [];
  if (enrichment.pageOutline) {
    const o = enrichment.pageOutline;
    parts.push("【页面概况】");
    if (o.title) parts.push(`标题：${o.title}`);
    if (o.hostname) parts.push(`站点：${o.hostname}`);
    if (o.description) parts.push(`描述：${o.description.slice(0, 240)}`);
    if (Array.isArray(o.headings) && o.headings.length > 0) {
      parts.push("章节：");
      for (const h of o.headings.slice(0, 12)) {
        parts.push(`  - ${h.level}: ${h.text}`);
      }
    }
    if (o.leadParagraph) parts.push(`首段：${o.leadParagraph.slice(0, PAGE_OUTLINE_MAX_CHARS)}`);
  }
  const okLinks = (enrichment.linkResults ?? []).filter((entry) => entry?.ok);
  if (okLinks.length > 0) {
    parts.push("");
    parts.push("【选区中的链接正文】");
    for (const entry of okLinks) {
      parts.push(`- ${entry.title || entry.url}`);
      parts.push(`  ${entry.url}`);
      parts.push(`  摘录：${entry.text}`);
    }
  }
  const failedLinks = (enrichment.linkResults ?? []).filter((entry) => entry && !entry.ok);
  if (failedLinks.length > 0) {
    parts.push("");
    parts.push(`（${failedLinks.length} 个链接抓取失败：${failedLinks.map((x) => `${x.url} [${x.error}]`).join("; ")})`);
  }
  return parts.join("\n");
}
