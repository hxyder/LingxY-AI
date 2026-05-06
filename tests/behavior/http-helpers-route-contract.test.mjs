import assert from "node:assert/strict";
import test from "node:test";

import { sendHtml, sendJson } from "../../src/service/core/http-helpers.mjs";

function createFakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    ended: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
      this.ended = true;
    }
  };
}

test("HTTP response helpers return handled=true for route dispatch", () => {
  const jsonResponse = createFakeResponse();
  assert.equal(sendJson(jsonResponse, 200, { ok: true }), true);
  assert.equal(jsonResponse.statusCode, 200);
  assert.equal(jsonResponse.ended, true);

  const htmlResponse = createFakeResponse();
  assert.equal(sendHtml(htmlResponse, 200, "<p>ok</p>"), true);
  assert.equal(htmlResponse.statusCode, 200);
  assert.equal(htmlResponse.ended, true);
});

test("route groups stop after a handler returns a response helper result", async () => {
  const response = createFakeResponse();
  let fallbackCalled = false;
  const groups = [
    {
      async handle() {
        return sendJson(response, 200, { route: "first" });
      }
    },
    {
      async handle() {
        fallbackCalled = true;
        return sendJson(response, 404, { route: "fallback" });
      }
    }
  ];

  let handled = false;
  for (const group of groups) {
    if (await group.handle({ response })) {
      handled = true;
      break;
    }
  }

  assert.equal(handled, true);
  assert.equal(fallbackCalled, false);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"first"/);
});
