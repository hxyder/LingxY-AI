import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeUserMemoryClient } from "../../src/desktop/renderer/shared/runtime-user-memory-client.mjs";

test("runtime user memory client owns save, proposal, delete, and undo mutations", async () => {
  const calls = [];
  const client = createRuntimeUserMemoryClient({
    actor: "desktop_console",
    httpClient: {
      async fetchJson(pathname, options) {
        calls.push({ pathname, options });
        return { ok: true };
      }
    }
  });

  await client.saveUserMemory({ enabled: true });
  await client.decideProposal("proposal 1", "approve");
  await client.deleteMemory("memory 1");
  await client.undoReview("review 1");

  assert.equal(calls[0].pathname, "/config/user-memory");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { enabled: true });
  assert.equal(calls[1].pathname, "/config/user-memory/proposals/proposal%201");
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: "approve" });
  assert.equal(calls[2].pathname, "/config/user-memory/memories/memory%201");
  assert.equal(calls[2].options.method, "DELETE");
  assert.equal(calls[3].pathname, "/config/user-memory/reviews/review%201/undo");
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[3].options.headers["X-Lingxy-Desktop-Actor"], "desktop_console");
});
