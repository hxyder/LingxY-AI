import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { upsertEmailAccount } from "../src/service/email/accounts.mjs";
import { maybeRunMorningDigest } from "../src/service/email/digest.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "uca-email-digest-"));
const outputsDir = path.join(tempRoot, "outputs");
const dataDir = path.join(tempRoot, "data");
await mkdir(outputsDir, { recursive: true });
await mkdir(dataDir, { recursive: true });

const configStore = {
  data: {},
  load() { return this.data; },
  save(next) { this.data = next; },
  patch(patch) {
    this.data = {
      ...this.data,
      ...patch,
      email: {
        ...(this.data.email ?? {}),
        ...(patch.email ?? {})
      }
    };
  }
};

const service = createServiceBootstrap({
  configStore,
  paths: {
    baseDir: tempRoot,
    outputsDir,
    dataDir
  }
});
const runtime = service.runtime;

const now = new Date("2026-04-11T08:30:00");
const yesterday = new Date(now);
yesterday.setDate(now.getDate() - 1);
yesterday.setHours(9, 0, 0, 0);

await upsertEmailAccount(runtime, {
  id: "mock-digest",
  provider: "mock",
  displayName: "Mock Inbox",
  email: "me@example.com",
  enabled: true,
  mockMessages: [
    {
      id: "m1",
      threadId: "t1",
      from: "boss@example.com",
      subject: "请在明天 10 点前回复",
      bodyText: "请在明天10点前回复这封邮件。",
      receivedAt: yesterday.toISOString()
    },
    {
      id: "m2",
      threadId: "t2",
      from: "hr@example.com",
      subject: "周会通知",
      bodyText: "周会时间调整。",
      receivedAt: yesterday.toISOString()
    }
  ]
}, { secret: "placeholder" });

const result = await maybeRunMorningDigest({ runtime, now });
assert.equal(result.ok, true);
assert.ok(result.digestPath?.includes("email-digest"));

const digestText = await readFile(result.digestPath, "utf8");
assert.equal(digestText.includes("昨日邮件汇总"), true);
assert.equal(digestText.includes("需要回复"), true);

const notificationsDir = path.join(tempRoot, "notifications");
const candidates = (await readdir(notificationsDir)).filter((name) => name.startsWith("notification-") && name.endsWith(".json"));
assert.equal(candidates.length > 0, true);

const detailed = await Promise.all(candidates.map(async (name) => ({
  name,
  fullPath: path.join(notificationsDir, name),
  stats: await stat(path.join(notificationsDir, name))
})));
const latest = detailed.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)[0];
const payload = JSON.parse(await readFile(latest.fullPath, "utf8"));
assert.equal(payload.title, "早晨邮件汇总");
assert.equal(Array.isArray(payload.handoff?.file_paths), true);
assert.equal(payload.handoff.file_paths.includes(result.digestPath), true);

const forced = await maybeRunMorningDigest({
  runtime,
  now: new Date("2026-04-11T15:30:00"),
  force: true
});
assert.equal(forced.ok, true);
assert.equal(forced.forced, true);
assert.ok(forced.digestPath?.includes("email-digest"));

console.log("Morning email digest verification passed.");
