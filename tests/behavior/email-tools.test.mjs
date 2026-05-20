import assert from "node:assert/strict";
import test from "node:test";

import { SEND_EMAIL_SMTP_TOOL } from "../../src/service/capabilities/tools/email-tools.mjs";

test("send_email_smtp fails closed when no SMTP transport is configured", async () => {
  const result = await SEND_EMAIL_SMTP_TOOL.execute({
    to: ["ops@example.com"],
    subject: "Status",
    body: "Body"
  }, {});

  assert.equal(result.success, false);
  assert.equal(result.metadata.connector_status, "unsupported");
  assert.equal(result.metadata.delivery_attempted, false);
  assert.match(result.observation, /SMTP email sending is not configured/);
});

test("send_email_smtp succeeds only through an injected SMTP transport", async () => {
  const sent = [];
  const result = await SEND_EMAIL_SMTP_TOOL.execute({
    to: ["ops@example.com"],
    subject: "Status",
    body: "Body"
  }, {
    smtpTransport: async (message) => {
      sent.push(message);
      return { messageId: "smtp-fixture-1" };
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual(sent[0].to, ["ops@example.com"]);
  assert.equal(sent[0].subject, "Status");
  assert.equal(result.metadata.connector_status, "success");
  assert.equal(result.metadata.email_delivery_verified, true);
  assert.equal(result.metadata.messageId, "smtp-fixture-1");
});
