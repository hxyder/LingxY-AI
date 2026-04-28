#!/usr/bin/env node
/**
 * free-search parser + redirect-decoder coverage.
 *
 * Most-important assertion: the Bing redirect decoder MUST unwrap the
 * `bing.com/ck/a?...&u=a1<base64>` form so downstream consumers
 * (evidence-normalizer, fetch_url_content) see real publisher URLs
 * instead of `bing.com`. The same shape (Google's `/url?q=...`) is
 * exercised for the Google parser. We also lock in:
 *
 *   - parseBingHtml drops results whose redirect couldn't be unwrapped
 *     (would otherwise feed fetch_url_content a Bing tracking URL).
 *   - parseGoogleHtml decodes /url?q= and skips google.com results.
 *
 * Run: node scripts/verify-free-search-parsers.mjs
 */

import assert from "node:assert/strict";

import {
  decodeBingRedirect,
  decodeGoogleRedirect,
  parseBingHtml,
  parseGoogleHtml,
  searchWeb
} from "../src/service/search/free-search.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

function bingTrackedUrl(target) {
  const b64 = Buffer.from(target, "utf8").toString("base64").replace(/=+$/, "");
  return `https://www.bing.com/ck/a?!&&p=abc&u=a1${b64}&ntb=1`;
}

it("decodeBingRedirect: unwraps a1<base64> tracking URL to the real target", () => {
  const target = "https://www.showtimes.com/movies-coming-soon/";
  const tracked = bingTrackedUrl(target);
  assert.equal(decodeBingRedirect(tracked), target);
});

it("decodeBingRedirect: returns the input unchanged for non-bing URLs", () => {
  const url = "https://en.wikipedia.org/wiki/2026";
  assert.equal(decodeBingRedirect(url), url);
});

it("decodeBingRedirect: returns input unchanged when prefix is missing", () => {
  const url = "https://www.bing.com/ck/a?u=" + Buffer.from("https://x.com").toString("base64");
  // No `a1` (or other ax) prefix → leave as-is rather than mis-decode
  assert.equal(decodeBingRedirect(url), url);
});

it("decodeBingRedirect: handles URL-safe base64 with - and _ chars", () => {
  // craft a URL whose base64 contains both - and _
  const target = "https://example.com/?a=b+c&d=e/f";
  const stdB64 = Buffer.from(target).toString("base64").replace(/=+$/, "");
  const urlSafe = stdB64.replace(/\+/g, "-").replace(/\//g, "_");
  const tracked = `https://www.bing.com/ck/a?!&u=a1${urlSafe}&ntb=1`;
  assert.equal(decodeBingRedirect(tracked), target);
});

it("decodeBingRedirect: bad input is safe", () => {
  // empty string short-circuits to "". null hits the `typeof !== "string"`
  // guard and is returned as-is. undefined falls through to the default
  // param, which is "" — that's fine, the function never throws.
  assert.equal(decodeBingRedirect(""), "");
  assert.equal(decodeBingRedirect(null), null);
  assert.doesNotThrow(() => decodeBingRedirect(undefined));
});

it("parseBingHtml: extracts decoded URLs, drops un-unwrappable bing redirects", () => {
  const target1 = "https://www.imdb.com/calendar/";
  const target2 = "https://www.rottentomatoes.com/browse/movies_coming_soon/";
  const tracked1 = bingTrackedUrl(target1);
  const tracked2 = bingTrackedUrl(target2);
  // Third result has a bare bing.com URL with no decodable u= → must drop
  const undecodable = "https://www.bing.com/search?q=fallback";
  const html = `
    <li class="b_algo"><h2><a href="${tracked1}">IMDb Calendar</a></h2><div class="b_caption"><p>Movie release calendar</p></div></li>
    <li class="b_algo"><h2><a href="${tracked2}">Rotten Tomatoes</a></h2><div class="b_caption"><p>Coming soon</p></div></li>
    <li class="b_algo"><h2><a href="${undecodable}">Stuck on Bing</a></h2><div class="b_caption"><p>tracking</p></div></li>
  `;
  const results = parseBingHtml(html, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, target1);
  assert.equal(results[0].title, "IMDb Calendar");
  assert.equal(results[1].url, target2);
});

it("parseBingHtml: supports current Bing h2 attributes + HTML-entity redirects", () => {
  const target = "https://www.goodnightscomedy.com/calendar";
  const tracked = bingTrackedUrl(target).replace(/&/g, "&amp;");
  const html = `
    <li class="b_algo" data-id iid=SERP.1>
      <div class="b_tpcn"><a href="${tracked}"><cite>https://www.goodnightscomedy.com</cite></a></div>
      <h2 class=""><a target="_blank" href="${tracked}">Goodnights Comedy Club</a></h2>
      <div class="b_caption"><p class="b_lineclamp2">Apr 15, 2026 &#0183;&#32;Upcoming comedy shows in Raleigh.</p></div>
    </li>
  `;
  const results = parseBingHtml(html, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, target);
  assert.equal(results[0].title, "Goodnights Comedy Club");
  assert.match(results[0].snippet, /Apr 15, 2026 · Upcoming/);
});

it("parseBingHtml: empty / falsy input → []", () => {
  assert.deepEqual(parseBingHtml("", 5), []);
  assert.deepEqual(parseBingHtml(null, 5), []);
});

it("decodeGoogleRedirect: absolute google.com/url?q= → target", () => {
  const target = "https://en.wikipedia.org/wiki/2026_in_film";
  const wrapped = `https://www.google.com/url?q=${encodeURIComponent(target)}&sa=U&ved=abc`;
  assert.equal(decodeGoogleRedirect(wrapped), target);
});

it("decodeGoogleRedirect: relative /url?q= → target", () => {
  const target = "https://www.imdb.com/calendar/";
  const wrapped = `/url?q=${encodeURIComponent(target)}&usg=foo`;
  assert.equal(decodeGoogleRedirect(wrapped), target);
});

it("decodeGoogleRedirect: bare URL passes through", () => {
  const url = "https://en.wikipedia.org/wiki/Coffee";
  assert.equal(decodeGoogleRedirect(url), url);
});

it("parseGoogleHtml: extracts decoded URLs, skips google.com results, dedupes", () => {
  const t1 = "https://www.imdb.com/calendar/";
  const t2 = "https://www.rottentomatoes.com/browse/movies_coming_soon/";
  const html = `
    <div class="g">
      <a href="/url?q=${encodeURIComponent(t1)}&usg=foo"><h3>IMDb Calendar</h3></a>
      <div class="VwiC3b"><span>Find upcoming movies</span></div>
    </div>
    <div class="MjjYud">
      <a href="/url?q=${encodeURIComponent(t2)}&usg=bar"><h3>Rotten Tomatoes</h3></a>
      <div class="VwiC3b">Coming soon list</div>
    </div>
    <div class="g">
      <a href="/url?q=${encodeURIComponent(t1)}&usg=baz"><h3>IMDb (dup)</h3></a>
      <div class="VwiC3b">should be deduped</div>
    </div>
    <div class="g">
      <a href="https://www.google.com/maps"><h3>Google Maps</h3></a>
      <div class="VwiC3b">should be skipped</div>
    </div>
  `;
  const results = parseGoogleHtml(html, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, t1);
  assert.equal(results[0].title, "IMDb Calendar");
  assert.equal(results[1].url, t2);
});

it("parseGoogleHtml: empty / falsy input → []", () => {
  assert.deepEqual(parseGoogleHtml("", 5), []);
  assert.deepEqual(parseGoogleHtml(null, 5), []);
});

it("parseGoogleHtml: respects limit", () => {
  const blocks = Array.from({ length: 12 }, (_, i) => {
    const target = `https://example${i}.com/page`;
    return `<div class="g"><a href="/url?q=${encodeURIComponent(target)}&usg=x"><h3>Title ${i}</h3></a><div class="VwiC3b">snip ${i}</div></div>`;
  }).join("\n");
  const results = parseGoogleHtml(blocks, 4);
  assert.equal(results.length, 4);
});

await (async function testSearchWebFallsThroughChallengePagesToBing() {
  try {
    const target = "https://www.goodnightscomedy.com/calendar";
    const tracked = bingTrackedUrl(target).replace(/&/g, "&amp;");
    const bingHtml = `
      <html><body><ol id="b_results">
        <li class="b_algo">
          <h2 class=""><a target="_blank" href="${tracked}">Goodnights Comedy Club</a></h2>
          <div class="b_caption"><p>Upcoming comedy shows in Raleigh.</p></div>
        </li>
      </ol><div>${"organic result padding ".repeat(80)}</div></body></html>
    `;
    const calls = [];
    const fakeFetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("duckduckgo.com")) {
        return new Response("<html><title>DuckDuckGo</title></html>", { status: 202 });
      }
      if (String(url).includes("google.com")) {
        return new Response("<html><body><noscript>/httpservice/retry/enablejs</noscript>Trouble accessing Google Search</body></html>", { status: 200 });
      }
      if (String(url).includes("bing.com")) {
        return new Response(bingHtml, { status: 200 });
      }
      return new Response("<html><title>百度安全验证</title></html>", { status: 200 });
    };
    const result = await searchWeb({
      query: "Goodnights Raleigh comedy shows May 2026",
      limit: 3,
      fetchImpl: fakeFetch
    });
    assert.equal(result.provider, "bing");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].url, target);
    assert.deepEqual(
      result.attempts.map((a) => [a.provider, a.fetchFailed]),
      [
        ["duckduckgo_html", true],
        ["duckduckgo_lite", true],
        ["google", true],
        ["bing", false]
      ]
    );
    process.stdout.write("PASS  searchWeb: challenge pages fall through to current Bing markup\n");
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  searchWeb: challenge pages fall through to current Bing markup\n  ${err.message}\n`);
    fail += 1;
  }
})();

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
