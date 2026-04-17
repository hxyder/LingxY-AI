// Article readability extraction.
//
// Runs Mozilla Readability against an HTML string inside a linkedom Document,
// so the same logic works in Node (tests, scheduled fetches) and could be
// swapped to the browser's native document via dependency injection.
//
// Upstream licence: @mozilla/readability is Apache-2.0. Attribution is carried
// in THIRD_PARTY_LICENSES.md.

import { parseHTML } from "linkedom";
import { Readability, isProbablyReaderable } from "@mozilla/readability";

function truncate(text, limit) {
  if (typeof text !== "string") return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

// Attempt to run Readability over the provided HTML.
//
// - When Readability accepts the page, returns `{ ok: true, kind: "article", ...}`.
// - When the page isn't reader-friendly (too short, no prose, paywalled skeleton),
//   returns `{ ok: true, kind: "fallback", ... }` with a best-effort plain-text
//   snapshot so the caller always has *something* to feed the model.
//
// Throws only on malformed HTML that linkedom can't parse at all.
export function extractArticleFromHtml({ html, url = "", maxChars = 60000 } = {}) {
  if (typeof html !== "string" || html.length === 0) {
    return { ok: false, reason: "empty_html" };
  }

  const { document } = parseHTML(html, { url: url || undefined });
  const title = (document.querySelector("title")?.textContent ?? "").trim();
  const lang = document.documentElement?.getAttribute?.("lang") ?? "";

  const readable = isProbablyReaderable(document);
  if (readable) {
    // Readability mutates the document it reads; clone via re-parse so the
    // caller's document (if reused) isn't stripped.
    const { document: readabilityDoc } = parseHTML(html, { url: url || undefined });
    const article = new Readability(readabilityDoc).parse();
    if (article?.textContent && article.textContent.trim().length > 0) {
      return {
        ok: true,
        kind: "article",
        url,
        title: article.title || title,
        byline: article.byline ?? "",
        siteName: article.siteName ?? "",
        excerpt: article.excerpt ?? "",
        lang: article.lang || lang,
        lengthChars: article.length ?? article.textContent.length,
        text: truncate(article.textContent, maxChars),
        publishedTime: article.publishedTime ?? null
      };
    }
  }

  // Readability rejected the page — dump a trimmed body text as a fallback.
  const bodyText = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    ok: true,
    kind: "fallback",
    url,
    title,
    lang,
    text: truncate(bodyText, maxChars),
    lengthChars: bodyText.length,
    reason: readable ? "readability_empty" : "not_reader_friendly"
  };
}
