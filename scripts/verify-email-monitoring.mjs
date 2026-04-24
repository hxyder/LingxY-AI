import assert from "node:assert/strict";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { upsertEmailAccount } from "../src/service/email/accounts.mjs";
import { createEmailMonitor } from "../src/service/email/monitor.mjs";

const service = createServiceBootstrap();
const runtime = service.runtime;

// UCA-181: auto-creating schedules from email is gated behind a separate
// feature flag (default OFF) — the previous default of always-on
// surfaced AI-extracted summaries straight into the user's schedule list
// without provenance. Tests still need to exercise the auto-create code
// path, so enable the flag here explicitly.
runtime.configStore?.save?.({
  ...(runtime.configStore?.load?.() ?? {}),
  features: {
    ...((runtime.configStore?.load?.() ?? {}).features ?? {}),
    email_auto_schedule: { enabled: true }
  }
});

await upsertEmailAccount(runtime, {
  id: "imap-account",
  provider: "imap",
  displayName: "Inbox",
  email: "me@example.com",
  enabled: true
}, { secret: "placeholder" });

const monitor = createEmailMonitor({
  runtime,
  clientFactory() {
    return {
      async listUnread() {
        return [
          {
            id: "m1",
            threadId: "t1",
            from: "boss@example.com",
            subject: "请在明天 10 点前回复",
            bodyText: "请在明天10点前回复这封邮件。",
            receivedAt: new Date(Date.now() - 1000).toISOString()
          },
          {
            id: "m2",
            threadId: "t1",
            from: "me@example.com",
            subject: "Re: 请在明天 10 点前回复",
            bodyText: "已回复。",
            receivedAt: new Date(Date.now()).toISOString(),
            direction: "out"
          }
        ];
      },
      async markSeen() {}
    };
  }
});

const results = await monitor.pollAllAccounts();
assert.equal(results.length >= 1, true);
const schedules = runtime.store.listSchedules();
assert.equal(schedules.length >= 1, true);
const schedule = schedules[0];
assert.equal(schedule.metadata?.category, "email");
assert.equal(schedule.metadata?.threadId, "t1");

console.log("Email monitoring verification passed.");
