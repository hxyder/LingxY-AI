import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../types.mjs";
import { translateText } from "../../translation/free-translator.mjs";
import { searchWeb, formatResultsForAssistant, normalizeSearchRecency } from "../../search/free-search.mjs";
import { openWithDefaultHandler } from "./open-with-default-handler.mjs";

// Real implementations for the most common tools
export const OPEN_URL_TOOL = {
  id:"open_url",name:"Open URL",description:"Open a URL in the user's default browser.",parameters:ACTION_TOOL_SCHEMAS.open_url,risk_level:"low",required_capabilities:["network"],requires_confirmation:false,
  async execute(args = {}) {
    const url = args.url;
    if (!url) return createActionResult({ success: false, observation: "url required" });
    try {
      await openWithDefaultHandler(url);
      return createActionResult({ success: true, observation: `Opened ${url}` });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open url: ${error.message}` });
    }
  }
};

export const WEB_SEARCH_TOOL = {
  id:"web_search",name:"Web Search",description:"Open a search results page.",parameters:ACTION_TOOL_SCHEMAS.web_search,risk_level:"low",required_capabilities:["network"],policy_group:"external_web_read",requires_confirmation:false,
  async execute(args = {}) {
    const q = encodeURIComponent(args.query ?? "");
    if (!q) return createActionResult({ success: false, observation: "query required" });
    const recency = normalizeSearchRecency(args.recency, args.query);
    const url = `https://www.google.com/search?q=${q}${recency ? `&tbs=qdr:${encodeURIComponent(recency)}` : ""}`;
    return OPEN_URL_TOOL.execute({ url });
  }
};

export const TRANSLATE_TEXT_TOOL = {
  id:"translate_text",name:"Translate Text",description:"Translate text to the target language.",parameters:ACTION_TOOL_SCHEMAS.translate_text,risk_level:"low",required_capabilities:["network"],requires_confirmation:false,
  async execute(args = {}) {
    const text = args.text ?? args.content ?? args.value ?? "";
    if (!text || !String(text).trim()) {
      return createActionResult({ success: false, observation: "text required" });
    }
    try {
      const result = await translateText({
        text: String(text),
        source: args.source ?? "auto",
        target: args.target ?? null
      });
      return createActionResult({
        success: true,
        observation: `Translated to ${result.target_language} via ${result.provider}: ${result.text.slice(0, 200)}${result.text.length > 200 ? "…" : ""}`,
        metadata: {
          tool_id: "translate_text",
          source_language: result.source_language,
          target_language: result.target_language,
          provider: result.provider,
          translated_text: result.text
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Free translation failed: ${error.message}`
      });
    }
  }
};

export const WEB_SEARCH_FETCH_TOOL = {
  id:"web_search_fetch",name:"Web Search Fetch",description:"Search the web and fetch results.",parameters:ACTION_TOOL_SCHEMAS.web_search_fetch,risk_level:"low",required_capabilities:["network"],policy_group:"external_web_read",requires_confirmation:false,
  async execute(args = {}) {
    const query = String(args.query ?? "").trim();
    if (!query) {
      return createActionResult({ success: false, observation: "query required" });
    }
    const limit = Math.max(1, Math.min(30, Number(args.limit) || 5));
    try {
      const recency = normalizeSearchRecency(args.recency, query);
      const result = await searchWeb({ query, limit, recency });

      // Distinguish between a network/bot-detection failure and a genuine
      // "no results" response. When both DDG endpoints had fetch-level errors
      // (HTTP error, timeout, bot-detection page), mark the tool as failed so
      // the LLM does not silently fall back to training-data answers.
      if (result.fetchFailed) {
        // Surface which providers we actually tried so the LLM — and
        // the user reading the task result_summary — knows this was a
        // real network / bot-detection problem, not the model ducking
        // the search.
        const tried = (result.attempts ?? []).map((a) => a.provider).filter(Boolean).join(", ") || result.provider;
        return createActionResult({
          success: false,
          // NOTE: do NOT mention "policy" here. The tool only reaches
          // this branch when policy ALLOWED the call and the providers
          // failed for operational reasons (timeouts, HTTP errors,
          // bot-detection). Models in a follow-up turn used to absorb
          // "or policy forbids them" and then tell the user the system
          // is denying network access — which is false. Frame this as
          // a transient operational failure and direct the model to
          // try alternate routes.
          observation: `Web search unavailable. Tried: ${tried}. All providers either timed out, returned HTTP errors, or served bot-detection pages. This is a transient network/scraping failure, NOT a policy denial — your tool permissions still allow web access. Do not tell the user the system "forbids" or "denies" external network access. Do not answer time-sensitive facts from memory. Try an alternate/broader query, or call fetch_url_content with a known authoritative URL/public data endpoint (e.g. finance.yahoo.com quote pages, query1.finance.yahoo.com chart endpoints, official exchange pages). Only after those alternate routes also fail should you tell the user live data is currently unreachable.`,
          metadata: {
            tool_id: "web_search_fetch",
            query,
            provider: result.provider,
            recency: result.recency,
            attempts: result.attempts ?? [],
            results: []
          }
        });
      }

      const asText = formatResultsForAssistant(result.results, {
        query,
        provider: result.provider,
        recency: result.recency,
        maxResults: limit
      });
      return createActionResult({
        success: result.results.length > 0,
        observation: asText,
        metadata: {
          tool_id: "web_search_fetch",
          query,
          provider: result.provider,
          recency: result.recency,
          results: result.results
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Web search failed: ${error.message}`
      });
    }
  }
};

function resolveFetchUrlFallback(url = "", status = null) {
  if (status !== 404) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)ticketmaster\.com$/i.test(parsed.hostname)) return null;
    const comedyDiscover = parsed.pathname.match(/^\/discover\/arts-theater\/comedy\/([^/?#]+)\/?$/i);
    if (!comedyDiscover) return null;
    const citySlug = comedyDiscover[1].replace(/-[a-z]{2}$/i, "");
    if (!citySlug) return null;
    const fallback = new URL(`https://www.ticketmaster.com/discover/${citySlug}`);
    fallback.searchParams.set("categoryId", "KZFzniwnSyZfZ7v7na");
    fallback.searchParams.set("classificationId", "KnvZfZ7vAe1");
    return fallback.toString();
  } catch {
    return null;
  }
}

/**
 * Fetch a URL and return its readable text content so the LLM can cite it directly.
 * This is the fallback when web_search_fetch returns no results, fails, or
 * finds only weak snippets. The LLM can call this with a known authoritative
 * URL (e.g. weather.gov, wikipedia.org, finance.yahoo.com) and get back the
 * actual page text without opening a browser.
 */
export const FETCH_URL_CONTENT_TOOL = {
  id: "fetch_url_content",
  name: "Fetch URL Content",
  description: "Fetch a URL and return its readable text content. Use this when web_search_fetch returns no results, fails, or gives weak snippets — call it with an authoritative URL to read the actual page text. Examples: weather.gov for weather, en.wikipedia.org for stable facts, official company/regulator/exchange pages, finance.yahoo.com/quote/MSFT for quote-page data, query1.finance.yahoo.com/v8/finance/chart/MSFT for quote JSON, feeds.finance.yahoo.com/rss/2.0/headline?s=MSFT&region=US&lang=en-US for ticker news. Returns up to 6000 characters by default; request max_chars up to 12000 when the task needs detailed fields.",
  parameters: ACTION_TOOL_SCHEMAS.fetch_url_content,
  risk_level: "low",
  required_capabilities: ["network"],
  // P4-00: see policy-groups.mjs.
  policy_group: "external_web_read",
  requires_confirmation: false,
  async execute(args = {}) {
    const url = String(args.url ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return createActionResult({ success: false, observation: "url required (must start with http:// or https://)" });
    }
    const maxChars = Math.max(500, Math.min(12000, Number(args.max_chars) || 6000));

    try {
      const requestHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8"
      };
      let finalUrl = url;
      let fallbackUrl = null;
      let response = await fetch(finalUrl, {
        headers: requestHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        fallbackUrl = resolveFetchUrlFallback(url, response.status);
        if (fallbackUrl) {
          response = await fetch(fallbackUrl, {
            headers: requestHeaders,
            redirect: "follow",
            signal: AbortSignal.timeout(12000)
          });
          if (response.ok) {
            finalUrl = fallbackUrl;
          }
        }
      }

      if (!response.ok) {
        const fallbackHint = fallbackUrl ? `; fallback also failed: ${fallbackUrl}` : "";
        return createActionResult({
          success: false,
          observation: `Fetch failed: HTTP ${response.status} ${response.statusText} for ${url}${fallbackHint}`
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      const rawBody = await response.text();

      let text;
      if (contentType.includes("text/html") || url.endsWith(".html") || url.endsWith(".htm")) {
        text = extractTextFromHtml(rawBody);
      } else {
        // Plain text / JSON / XML — return as-is (trimmed)
        text = rawBody.replace(/\s+/g, " ").trim();
      }

      const excerpt = text.slice(0, maxChars);
      const truncated = text.length > maxChars ? `\n\n[截断：原文共 ${text.length} 字符，仅显示前 ${maxChars} 字符]` : "";
      const fallbackNote = fallbackUrl
        ? `\n（原始 URL 返回 404，已改用当前可用页面：${finalUrl}）\n`
        : "";

      return createActionResult({
        success: true,
        observation: `来源：${finalUrl}${fallbackNote}\n${excerpt}${truncated}`,
        metadata: {
          url: finalUrl,
          requested_url: url,
          fallback_url: fallbackUrl,
          chars_extracted: text.length,
          chars_returned: excerpt.length
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Fetch error for ${url}: ${error.message}`
      });
    }
  }
};

/**
 * Extract readable text from HTML.
 * Removes scripts, styles, and all tags; decodes common entities.
 */
function extractTextFromHtml(html = "") {
  return html
    // Remove <script> blocks (including content)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    // Remove <style> blocks
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    // Remove <noscript> blocks
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    // Replace block-level tags with newlines to preserve structure
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|article|section|header|footer|nav|main|aside)[^>]*>/gi, "\n")
    // Strip all remaining HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // Collapse excessive whitespace while preserving paragraph breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}