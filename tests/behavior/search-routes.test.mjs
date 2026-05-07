import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import Database from "better-sqlite3";

import { SQLITE_SCHEMA_SQL } from "../../src/service/core/store/sqlite-schema.mjs";
import { createSearchIndex } from "../../src/service/core/store/search-index.mjs";
import { tryHandleSearchRoute } from "../../src/service/core/http-routes/search-routes.mjs";

function makeRequest({ body = {}, actor = "desktop_console" } = {}) {
  const stream = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
  stream.headers = { "x-lingxy-desktop-actor": actor, "content-type": "application/json" };
  return stream;
}

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
    writeHead(code, headers = {}) { this.statusCode = code; Object.assign(this.headers, headers); },
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk !== undefined) this.chunks.push(chunk); }
  };
}

function decodeBody(response) {
  return JSON.parse(Buffer.concat(response.chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8"));
}

function fakeRuntime({ entries = [] } = {}) {
  const db = new Database(":memory:");
  db.exec(SQLITE_SCHEMA_SQL.unifiedSearchIndex);
  const searchIndex = createSearchIndex(db);
  for (const entry of entries) searchIndex.upsert(entry);
  return { searchIndex };
}

test("rejects non-desktop actor with 403", async () => {
  const request = makeRequest({ body: { q: "alpha" }, actor: "popup_card" });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime()
  });
  assert.equal(response.statusCode, 403);
});

test("returns 503 when search index is missing", async () => {
  const request = makeRequest({ body: { q: "alpha" } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: { searchIndex: null }
  });
  assert.equal(response.statusCode, 503);
});

test("missing query returns 400", async () => {
  const request = makeRequest({ body: { q: "  " } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime()
  });
  assert.equal(response.statusCode, 400);
  assert.equal(decodeBody(response).reason, "missing_query");
});

test("invalid scope returns 400", async () => {
  const request = makeRequest({ body: { q: "alpha", scope: ["bogus"] } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime()
  });
  assert.equal(response.statusCode, 400);
  assert.equal(decodeBody(response).reason, "invalid_scope");
});

test("default search returns hits across all scopes, deleted excluded", async () => {
  const request = makeRequest({ body: { q: "alpha" } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime({
      entries: [
        { source_type: "note", source_id: "n1", title: "alpha note", body: "" },
        { source_type: "task", source_id: "t1", title: "alpha task", body: "" },
        { source_type: "conversation", source_id: "c1", title: "alpha chat", body: "" },
        { source_type: "note", source_id: "gone", title: "alpha gone", body: "", deleted_at: "2026-05-01" }
      ]
    })
  });
  assert.equal(response.statusCode, 200);
  const data = decodeBody(response);
  assert.equal(data.ok, true);
  assert.deepEqual(
    data.results.map((r) => r.source_type).sort(),
    ["conversation", "note", "task"]
  );
});

test("scope=['note'] restricts to notes only", async () => {
  const request = makeRequest({ body: { q: "alpha", scope: ["note"] } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime({
      entries: [
        { source_type: "note", source_id: "n1", title: "alpha", body: "" },
        { source_type: "task", source_id: "t1", title: "alpha", body: "" }
      ]
    })
  });
  assert.equal(response.statusCode, 200);
  const data = decodeBody(response);
  assert.deepEqual(data.results.map((r) => r.source_type), ["note"]);
});

test("include_deleted=true surfaces soft-deleted records", async () => {
  const request = makeRequest({ body: { q: "alpha", include_deleted: true } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime({
      entries: [
        { source_type: "note", source_id: "alive", title: "alpha", body: "" },
        { source_type: "note", source_id: "gone", title: "alpha", body: "", deleted_at: "2026-05-01" }
      ]
    })
  });
  const data = decodeBody(response);
  assert.deepEqual(data.results.map((r) => r.source_id).sort(), ["alive", "gone"]);
});

test("Chinese 2-char query returns hits", async () => {
  const request = makeRequest({ body: { q: "讨论" } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime({
      entries: [{ source_type: "note", source_id: "n1", title: "明日会议", body: "讨论产品发布计划" }]
    })
  });
  assert.equal(response.statusCode, 200);
  const data = decodeBody(response);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].source_id, "n1");
});

test("limit clamps to 100 and respects user-specified bound", async () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({
    source_type: "note", source_id: `n${i}`, title: "alpha", body: ""
  }));
  const request = makeRequest({ body: { q: "alpha", limit: 5 } });
  const response = makeResponse();
  await tryHandleSearchRoute({
    request, response, method: "POST",
    url: new URL("http://x/search"),
    runtime: fakeRuntime({ entries })
  });
  const data = decodeBody(response);
  assert.equal(data.results.length, 5);
});

test("only the /search POST route is handled", async () => {
  const request = makeRequest({ body: {} });
  const response = makeResponse();
  const handled = await tryHandleSearchRoute({
    request, response, method: "GET",
    url: new URL("http://x/search"),
    runtime: fakeRuntime()
  });
  assert.equal(handled, false);
});
