import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeSubmissionClient,
  runtimeJsonOptions,
  runtimeMutationOptions
} from "../../src/desktop/renderer/shared/runtime-submission-client.mjs";

test("runtime submission client routes task and clarification mutations through typed methods", async () => {
  const calls = [];
  const client = createRuntimeSubmissionClient({
    actor: "desktop_overlay",
    httpClient: {
      async fetchJson(pathname, options) {
        calls.push({ pathname, options });
        return { ok: true, pathname };
      }
    }
  });

  await client.submitTask({ userCommand: "hello" });
  await client.clarifyTask({ clarificationAnswer: "yes" });

  assert.equal(calls[0].pathname, "/task");
  assert.equal(calls[1].pathname, "/task/clarify");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-Lingxy-Desktop-Actor"], "desktop_overlay");
  assert.deepEqual(JSON.parse(calls[0].options.body), { userCommand: "hello" });
});

test("runtime submission client owns conversation model mutations", async () => {
  const calls = [];
  const client = createRuntimeSubmissionClient({
    actor: "desktop_console",
    httpClient: {
      async fetchJson(pathname, options) {
        calls.push({ pathname, options });
        return { ok: true };
      }
    }
  });

  await client.createConversation({ conversation_id: "conv_a" });
  await client.updateConversationModel("conv_a", { providerId: "openai", model: "gpt" });
  await client.clearConversationModel("conv_a");

  assert.equal(calls[0].pathname, "/conversations");
  assert.equal(calls[1].pathname, "/conversation/conv_a/model");
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[2].pathname, "/conversation/conv_a/model");
  assert.equal(calls[2].options.method, "DELETE");
  assert.equal(calls[2].options.headers["X-Lingxy-Desktop-Actor"], "desktop_console");
});

test("runtime json helpers preserve actor headers and payload encoding", () => {
  assert.deepEqual(runtimeJsonOptions("POST", { a: 1 }, { actor: "desktop_console" }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Lingxy-Desktop-Actor": "desktop_console"
    },
    body: "{\"a\":1}"
  });
  assert.deepEqual(runtimeMutationOptions("DELETE", { actor: "desktop_console" }), {
    method: "DELETE",
    headers: {
      "X-Lingxy-Desktop-Actor": "desktop_console"
    }
  });
});
