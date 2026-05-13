import assert from "node:assert/strict";
import test from "node:test";

import { FETCH_URL_CONTENT_TOOL } from "../../src/service/capabilities/tools/browser-web-tools.mjs";

function makeResponse(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? "";
      }
    },
    async text() {
      return body;
    }
  };
}

test("fetch_url_content marks menu-dominant HTML as low-quality extracted content", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => makeResponse(`
      <html>
        <head><title>Events</title></head>
        <body>
          <nav>
            Search Search Places to Stay Events Things to Do Plan a Trip
            Foodie Restaurants Submit an Event Privacy Policy Cookies in use
          </nav>
          <div>Events This Weekend Arts Concerts Foodie Festivals Museums Sports</div>
          <div>Search Search Places to Stay Events Things to Do Plan a Trip</div>
          <div>Search Search Places to Stay Events Things to Do Plan a Trip</div>
          <div>Search Search Places to Stay Events Things to Do Plan a Trip</div>
        </body>
      </html>
    `, { "content-type": "text/html" });

    const result = await FETCH_URL_CONTENT_TOOL.execute({
      url: "https://example.com/events",
      max_chars: 1200
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata.content_extracted, false);
    assert.equal(result.metadata.content_quality.usable, false);
    assert.equal(result.metadata.content_quality.boilerplate_dominant, true);
    assert.match(result.observation, /内容质量提示/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch_url_content keeps article-like HTML as usable content", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => makeResponse(`
      <html>
        <head><title>Community Events</title></head>
        <body>
          <main>
            <h1>Community Events</h1>
            <article>
              <h2>May 16 Spring Market</h2>
              <p>The Spring Market starts May 16 at 10:00 am at Moore Square Park.</p>
              <p>Local vendors, music, and food trucks will be on site throughout the day.</p>
              <p>Families can join workshops and outdoor games near the main stage.</p>
            </article>
          </main>
        </body>
      </html>
    `, { "content-type": "text/html" });

    const result = await FETCH_URL_CONTENT_TOOL.execute({
      url: "https://example.com/events",
      max_chars: 1200
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata.content_extracted, true);
    assert.equal(result.metadata.content_quality.usable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
