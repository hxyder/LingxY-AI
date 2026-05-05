import test from "node:test";
import assert from "node:assert/strict";

import { createReadProbeCache } from "../../src/service/core/read-probe-cache.mjs";

test("read probe cache reuses results within the ttl", async () => {
  let time = 1_000;
  let calls = 0;
  const readProbe = createReadProbeCache({
    ttlMs: 100,
    now: () => time,
    probe: async () => ({ ok: true, call: ++calls })
  });

  assert.deepEqual(await readProbe(), { ok: true, call: 1 });
  time += 50;
  assert.deepEqual(await readProbe(), { ok: true, call: 1 });
  assert.equal(calls, 1);

  time += 60;
  assert.deepEqual(await readProbe(), { ok: true, call: 2 });
  assert.equal(calls, 2);
});

test("read probe cache coalesces concurrent probes", async () => {
  let calls = 0;
  let release = null;
  let markStarted = null;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const readProbe = createReadProbeCache({
    ttlMs: 100,
    probe: async () => {
      calls += 1;
      markStarted();
      await new Promise((done) => { release = done; });
      return { ok: true, call: calls };
    }
  });

  const first = readProbe();
  await started;
  const second = readProbe();
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true, call: 1 },
    { ok: true, call: 1 }
  ]);
  assert.equal(calls, 1);
});

test("read probe cache returns shallow copies so callers cannot mutate cache", async () => {
  const readProbe = createReadProbeCache({
    ttlMs: 100,
    probe: async () => ({ ok: true, value: "initial" })
  });

  const first = await readProbe();
  first.value = "mutated";

  assert.deepEqual(await readProbe(), { ok: true, value: "initial" });
});
