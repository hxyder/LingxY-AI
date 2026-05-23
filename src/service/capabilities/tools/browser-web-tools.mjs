import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { translateText } from "../../translation/free-translator.mjs";
import { searchWeb, formatResultsForAssistant, normalizeSearchRecency } from "../../search/free-search.mjs";
import { openWithDefaultHandler } from "./open-with-default-handler.mjs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  configuredWritableArtifactRoots,
  ensureOutputDir,
  resolveOutputDirForTool,
  resolveSandboxedTarget
} from "../../core/artifact-path-helper.mjs";

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
      const searchedAt = new Date().toISOString();
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
            searched_at: searchedAt,
            attempts: result.attempts ?? [],
            results: []
          }
        });
      }

      const asText = [
        `检索时间：${searchedAt.slice(0, 10)} ${searchedAt.slice(11, 19)} UTC`,
        formatResultsForAssistant(result.results, {
          query,
          provider: result.provider,
          recency: result.recency,
          maxResults: limit
        })
      ].join("\n");
      return createActionResult({
        success: result.results.length > 0,
        observation: asText,
        metadata: {
          tool_id: "web_search_fetch",
          query,
          provider: result.provider,
          recency: result.recency,
          searched_at: searchedAt,
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

const DOWNLOAD_FILE_DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_FILE_HARD_MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_MIME_EXTENSIONS = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/rtf": ".rtf",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/gzip": ".gz",
  "application/x-7z-compressed": ".7z",
  "application/x-tar": ".tar",
  "text/html": ".html",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "application/x-python-code": ".py",
  "text/x-python": ".py",
  "application/xml": ".xml",
  "text/xml": ".xml"
});

function clampDownloadMaxBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DOWNLOAD_FILE_DEFAULT_MAX_BYTES;
  return Math.max(1, Math.min(DOWNLOAD_FILE_HARD_MAX_BYTES, Math.floor(parsed)));
}

function safeBasename(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/gu, "-")
    .replace(/\s+/gu, " ")
    .slice(0, 120)
    .replace(/^\.+/u, "")
    .trim();
}

function extensionFromContentType(contentType = "") {
  const normalized = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  return DOWNLOAD_MIME_EXTENSIONS[normalized] ?? "";
}

function extensionForKind(kind = "") {
  const normalized = String(kind ?? "").trim().toLowerCase();
  if (normalized === "image") return ".jpg";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(normalized)) {
    return normalized === "jpg" ? ".jpg" : `.${normalized}`;
  }
  if (normalized === "docx" || normalized === "word") return ".docx";
  if (normalized === "xlsx" || normalized === "excel") return ".xlsx";
  if (normalized === "pptx" || normalized === "ppt" || normalized === "powerpoint") return ".pptx";
  if (normalized === "pdf") return ".pdf";
  if (normalized === "html") return ".html";
  if (normalized === "csv") return ".csv";
  if (normalized === "json") return ".json";
  if (normalized === "md" || normalized === "markdown") return ".md";
  if (normalized === "txt" || normalized === "text") return ".txt";
  if (normalized === "mjs") return ".mjs";
  if (normalized === "js" || normalized === "javascript") return ".js";
  if (normalized === "py" || normalized === "python") return ".py";
  if (normalized === "ps1" || normalized === "powershell") return ".ps1";
  if (normalized === "zip") return ".zip";
  return "";
}

function extensionFromUrl(url = "") {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (ext && /^[.][a-z0-9]{1,12}$/u.test(ext)) return ext;
  } catch { /* best-effort filename inference */ }
  return "";
}

function filenameFromUrl(url = "") {
  try {
    return safeBasename(decodeURIComponent(path.basename(new URL(url).pathname)));
  } catch {
    return "";
  }
}

function filenameFromContentDisposition(contentDisposition = "") {
  const raw = String(contentDisposition ?? "");
  if (!raw.trim()) return "";
  const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/iu);
  if (utf8Match?.[1]) {
    try {
      return safeBasename(decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/gu, "")));
    } catch {
      return safeBasename(utf8Match[1]);
    }
  }
  const asciiMatch = raw.match(/filename\s*=\s*("[^"]+"|[^;]+)/iu);
  if (!asciiMatch?.[1]) return "";
  return safeBasename(asciiMatch[1].trim().replace(/^"|"$/gu, ""));
}

function artifactKindFromDownload({ filePath = "", contentType = "", explicitKind = "" } = {}) {
  const normalized = String(explicitKind ?? "").trim().toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(normalized)) return "image";
  if (normalized === "markdown") return "md";
  if (normalized === "word") return "docx";
  if (normalized === "excel") return "xlsx";
  if (normalized === "ppt" || normalized === "powerpoint") return "pptx";
  if (normalized) return normalized;
  const mime = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"].includes(ext)) return "image";
  return ext ? ext.slice(1) : "file";
}

function resolveDownloadTargetArg({ args = {}, url = "", contentType = "", contentDisposition = "" } = {}) {
  const pathArg = typeof args.path === "string" ? args.path.trim() : "";
  if (pathArg) return pathArg;
  const requested = safeBasename(args.filename);
  const fromDisposition = filenameFromContentDisposition(contentDisposition);
  const fromUrl = filenameFromUrl(url);
  const nameSource = requested || fromDisposition || fromUrl;
  const ext = path.extname(nameSource)
    || extensionFromUrl(url)
    || extensionFromContentType(contentType)
    || extensionForKind(args.kind)
    || ".bin";
  const stem = safeBasename(path.basename(nameSource || "downloaded-file", path.extname(nameSource)))
    || "downloaded-file";
  return `${stem}${ext}`;
}

export const DOWNLOAD_FILE_TOOL = {
  id: "download_file",
  name: "Download File",
  description: "Download a public http(s) URL directly into the task workspace and return the saved artifact path. Use this for image/PDF/file downloads when a real file artifact is required; use fetch_url_content for readable page text instead.",
  parameters: ACTION_TOOL_SCHEMAS.download_file,
  risk_level: "medium",
  required_capabilities: ["network", "file_write"],
  policy_group: "external_web_read",
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const url = String(args.url ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return createActionResult({ success: false, observation: "url required (must start with http:// or https://)" });
    }

    const maxBytes = clampDownloadMaxBytes(args.max_bytes);
    const outputDir = await ensureOutputDir(resolveOutputDirForTool(ctx));
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": [
            "application/octet-stream",
            "application/pdf",
            "application/zip",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "image/*",
            "text/*",
            "*/*;q=0.8"
          ].join(","),
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        return createActionResult({
          success: false,
          observation: `Download failed: HTTP ${response.status} ${response.statusText} for ${url}`
        });
      }

      const contentLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        return createActionResult({
          success: false,
          observation: `Download refused: content-length ${contentLength} bytes exceeds max_bytes ${maxBytes}.`
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      const contentDisposition = response.headers.get("content-disposition") ?? "";
      const targetArg = resolveDownloadTargetArg({
        args,
        url: response.url || url,
        contentType,
        contentDisposition
      });
      const absTarget = await resolveSandboxedTarget(outputDir, targetArg, {
        allowedRoots: configuredWritableArtifactRoots(ctx)
      });
      if (!args.overwrite) {
        try {
          await access(absTarget, fsConstants.F_OK);
          return createActionResult({
            success: false,
            observation: `File already exists at ${path.relative(outputDir, absTarget)}; pass overwrite:true to replace it.`,
            metadata: { tool_id: "download_file", path: absTarget, url }
          });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        return createActionResult({
          success: false,
          observation: `Download failed: empty response body for ${url}`
        });
      }
      if (buffer.length > maxBytes) {
        return createActionResult({
          success: false,
          observation: `Download refused: ${buffer.length} bytes exceeds max_bytes ${maxBytes}.`
        });
      }

      await mkdir(path.dirname(absTarget), { recursive: true });
      await writeFile(absTarget, buffer);
      const kind = artifactKindFromDownload({
        filePath: absTarget,
        contentType,
        explicitKind: args.kind
      });
      return createActionResult({
        success: true,
        observation: `Downloaded ${kind} artifact (${buffer.length} bytes): ${absTarget}`,
        artifactPaths: [absTarget],
        metadata: {
          tool_id: "download_file",
          url: response.url || url,
          requested_url: url,
          path: absTarget,
          kind,
          bytes: buffer.length,
          content_type: contentType
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `Download error for ${url}: ${error.message}`,
        metadata: { tool_id: "download_file", url }
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
      const contentQuality = assessExtractedContentQuality({
        text: excerpt,
        fullTextLength: text.length,
        maxChars,
        url: finalUrl
      });
      const truncated = text.length > maxChars ? `\n\n[截断：原文共 ${text.length} 字符，仅显示前 ${maxChars} 字符]` : "";
      const qualityNote = contentQuality.usable === false
        ? `\n\n[内容质量提示：当前截取内容疑似以导航、菜单、Cookie 或模板文本为主，可能未包含页面主体数据。]\n`
        : "";
      const fallbackNote = fallbackUrl
        ? `\n（原始 URL 返回 404，已改用当前可用页面：${finalUrl}）\n`
        : "";

      return createActionResult({
        success: true,
        observation: `来源：${finalUrl}${fallbackNote}\n${excerpt}${qualityNote}${truncated}`,
        metadata: {
          url: finalUrl,
          requested_url: url,
          fallback_url: fallbackUrl,
          chars_extracted: text.length,
          chars_returned: excerpt.length,
          truncated: text.length > maxChars,
          content_extracted: contentQuality.usable,
          content_quality: contentQuality
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

function assessExtractedContentQuality({ text = "", fullTextLength = 0, maxChars = 0, url = "" } = {}) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  const lower = source.toLowerCase();
  const charsReturned = source.length;
  const navMarkers = [
    "cookies in use",
    "privacy policy",
    "skip to content",
    "navigation menu",
    "toggle navigation",
    "search search",
    "places to stay",
    "submit an event",
    "foodie restaurants",
    "things to do",
    "plan a trip"
  ];
  const markerHits = navMarkers.filter((marker) => lower.includes(marker)).length;
  const sentenceHits = (source.match(/[.!?。！？]\s+/g) ?? []).length;
  const lineCount = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  const shortLineCount = String(text ?? "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.length <= 32).length;
  const shortLineRatio = lineCount > 0 ? shortLineCount / lineCount : 0;
  const templateMarkers = /{{\s*(?:title|date|event)|data-event|no events were found/i.test(source);
  const boilerplateDominant = markerHits >= 4 && (shortLineRatio >= 0.55 || sentenceHits <= 5);
  const truncatedEarly = Number(fullTextLength) > Number(maxChars) && Number(maxChars) > 0;
  const usable = charsReturned >= 200 && !boilerplateDominant && !templateMarkers;
  return {
    usable,
    boilerplate_dominant: boilerplateDominant,
    template_markers: templateMarkers,
    nav_marker_hits: markerHits,
    short_line_ratio: Number(shortLineRatio.toFixed(3)),
    sentence_hits: sentenceHits,
    chars_returned: charsReturned,
    chars_extracted: Number(fullTextLength) || charsReturned,
    truncated_early: truncatedEarly,
    url
  };
}
