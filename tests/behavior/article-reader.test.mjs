import assert from "node:assert/strict";
import test from "node:test";

import { extractArticleFromHtml } from "../../src/service/extractors/page_source/article-reader.mjs";

test("article reader extracts readable content and keeps fallback text available", () => {
  const html = `<!doctype html>
  <html lang="en">
    <head><title>Example Article</title></head>
    <body>
      <article>
        <h1>Example Article</h1>
        <p>This is a readable paragraph with enough content to be useful.</p>
        <p>This second paragraph helps the readerability heuristic identify the article body.</p>
      </article>
    </body>
  </html>`;

  const result = extractArticleFromHtml({ html, url: "https://example.com/article" });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.com/article");
  assert.match(result.text, /readable paragraph|second paragraph/);
});
