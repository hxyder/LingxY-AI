import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createWhisperDaemon } from "../../src/service/audio/whisper-daemon.mjs";

// Build a fake Python child that the test fully controls. By default it
// echoes a successful transcription for each request; tests can pass an
// onPayload responder that returns custom payloads (or returns null to
// simulate an unresponsive daemon).
function makeFakeSpawn({ onPayload, calls, beforeRespond = null, autoRespond = true }) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      child.emit("close", 0);
    };
    child._writeRaw = (line) => {
      child.stdout.write(`${line}\n`, "utf8");
    };
    let buffer = "";
    child.stdin.on("data", (chunk) => {
      buffer += Buffer.from(chunk).toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        if (beforeRespond) beforeRespond(payload, child);
        if (!autoRespond) continue;
        const response = onPayload(payload);
        if (response === null) continue;
        child.stdout.write(`${JSON.stringify({ id: payload.id, ...response })}\n`, "utf8");
      }
    });
    return child;
  };
}

test("whisper daemon reuses a single sidecar across requests", async () => {
  const spawnCalls = [];
  const seen = [];
  const daemon = createWhisperDaemon({
    pythonCommand: "python",
    scriptPath: "scripts/local-whisper-transcribe.py",
    spawnImpl: makeFakeSpawn({
      onPayload: (payload) => {
        seen.push(payload);
        return { ok: true, transcript: `t-${payload.audio_path}` };
      },
      calls: spawnCalls
    }),
    requestTimeoutMs: 2000,
    idleTimeoutMs: 0
  });

  const first = await daemon.transcribe({ audioPath: "a.webm" });
  const second = await daemon.transcribe({ audioPath: "b.webm", language: "zh" });
  assert.equal(first.transcript, "t-a.webm");
  assert.equal(second.transcript, "t-b.webm");
  assert.equal(spawnCalls.length, 1, "one spawn shared across both requests");
  assert.deepEqual(spawnCalls[0].args, ["scripts/local-whisper-transcribe.py", "--server"]);
  assert.equal(seen[0].audio_path, "a.webm");
  assert.equal(seen[1].audio_path, "b.webm");
  assert.equal(seen[1].language, "zh");
  daemon.stop();
});

test("whisper daemon serialises requests (single in-flight)", async () => {
  const spawnCalls = [];
  let activeRequests = 0;
  let maxConcurrent = 0;
  const pending = [];
  const daemon = createWhisperDaemon({
    pythonCommand: "python",
    scriptPath: "scripts/local-whisper-transcribe.py",
    spawnImpl: makeFakeSpawn({
      onPayload: () => null, // we'll respond manually below
      calls: spawnCalls,
      autoRespond: false,
      beforeRespond: (payload, child) => {
        activeRequests += 1;
        maxConcurrent = Math.max(maxConcurrent, activeRequests);
        pending.push(() => {
          activeRequests -= 1;
          child._writeRaw(JSON.stringify({ id: payload.id, ok: true, transcript: payload.audio_path }));
        });
      }
    }),
    requestTimeoutMs: 5000,
    idleTimeoutMs: 0
  });

  const p1 = daemon.transcribe({ audioPath: "a.webm" });
  const p2 = daemon.transcribe({ audioPath: "b.webm" });
  const p3 = daemon.transcribe({ audioPath: "c.webm" });

  // Poll until the first request reaches the fake child.
  while (pending.length === 0) await new Promise((r) => setImmediate(r));
  assert.equal(activeRequests, 1, "only one in-flight at a time before any response");
  assert.equal(maxConcurrent, 1);
  assert.equal(pending.length, 1, "queue holds the rest");

  // Drain in order.
  pending.shift()();
  await p1;
  while (pending.length === 0) await new Promise((r) => setImmediate(r));
  pending.shift()();
  await p2;
  while (pending.length === 0) await new Promise((r) => setImmediate(r));
  pending.shift()();
  await p3;

  assert.equal(maxConcurrent, 1, "in-flight count never exceeded 1");
  assert.equal(spawnCalls.length, 1, "single child shared across queued requests");
  daemon.stop();
});

test("whisper daemon trips circuit breaker on stdout pollution and lets fallback proceed", async () => {
  const spawnCalls = [];
  let pollutionCount = 0;
  let fakeNow = 1_000_000;
  const daemon = createWhisperDaemon({
    pythonCommand: "python",
    scriptPath: "scripts/local-whisper-transcribe.py",
    spawnImpl: makeFakeSpawn({
      onPayload: () => null,
      calls: spawnCalls,
      autoRespond: false,
      beforeRespond: (_payload, child) => {
        // Simulate a non-JSON line on stdout — third-party Python lib
        // printing something unexpected.
        pollutionCount += 1;
        child.stdout.write("warning: cuda init slow\n", "utf8");
      }
    }),
    requestTimeoutMs: 1000,
    idleTimeoutMs: 0,
    backoffSteps: [10_000, 60_000, 300_000],
    now: () => fakeNow
  });

  await assert.rejects(
    () => daemon.transcribe({ audioPath: "a.webm" }),
    /non-JSON line/i
  );
  assert.equal(pollutionCount, 1, "first request reached the fake child");
  assert.equal(daemon.circuitOpen, true, "breaker is open after one stdout pollution");
  assert.equal(daemon.running, false, "child was killed after protocol violation");

  // While the breaker is open, additional calls fail fast WITHOUT spawning.
  const beforeSpawnCount = spawnCalls.length;
  await assert.rejects(
    () => daemon.transcribe({ audioPath: "b.webm" }),
    /circuit breaker open|temporarily disabled/i
  );
  assert.equal(spawnCalls.length, beforeSpawnCount, "no new spawn while breaker is open");

  // After backoff window elapses the breaker reopens. Replace the fake
  // spawn impl with a healthy one to verify recovery is possible.
  fakeNow += 11_000; // > first backoff step
  // Note: we cannot swap the closure spawnImpl here, but circuitOpen
  // depends purely on now(). Asserting `circuitOpen===false` is enough
  // for this regression — the next call would attempt to spawn again.
  assert.equal(daemon.circuitOpen, false, "breaker closes after backoff window");
  daemon.stop();
});
