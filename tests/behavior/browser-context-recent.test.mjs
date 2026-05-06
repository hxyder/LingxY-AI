import assert from "node:assert/strict";
import test from "node:test";

import {
  listRecentBrowserContexts
} from "../../src/service/core/http-routes/browser-context-routes.mjs";

test("recent browser context can require exact URL match", () => {
  const contexts = [
    {
      url: "https://mail.example.com/message/old",
      pageTitle: "Old Mail",
      text: "old message",
      receivedAt: new Date().toISOString()
    },
    {
      url: "https://mail.example.com/message/current",
      pageTitle: "Current Mail",
      text: "current message",
      receivedAt: new Date().toISOString()
    }
  ];

  const loose = listRecentBrowserContexts(contexts, {
    url: "https://mail.example.com/message/missing",
    title: "Mail",
    limit: 1
  });
  assert.equal(loose.length, 1, "loose matching may fall back to same host/title when callers allow it");

  const strict = listRecentBrowserContexts(contexts, {
    url: "https://mail.example.com/message/missing",
    title: "Mail",
    requireExactUrl: true,
    limit: 1
  });
  assert.equal(strict.length, 0, "current-page callers must not reuse a same-host stale page");

  const exact = listRecentBrowserContexts(contexts, {
    url: "https://mail.example.com/message/current",
    requireExactUrl: true,
    limit: 1
  });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].text, "current message");
});
