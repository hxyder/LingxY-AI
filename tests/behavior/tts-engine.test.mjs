import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createTtsEngine } from "../../src/service/audio/tts-engine.mjs";

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    child.signalCode = signal;
    queueMicrotask(() => child.emit("close", null, signal));
  };
  child._finishOk = () => {
    child.exitCode = 0;
    child.emit("close", 0, null);
  };
  return child;
}

function makeFakeSpawn(callsBucket, options = {}) {
  return (command, args) => {
    const child = makeFakeChild();
    callsBucket.push({ command, args, child });
    if (options.spawnError) {
      const err = new Error(options.spawnError.message ?? "spawn failed");
      err.code = options.spawnError.code ?? "ENOENT";
      throw err;
    }
    return child;
  };
}

test("speak() spawns the platform command and resolves on close=0", async () => {
  const calls = [];
  const engine = createTtsEngine({
    spawnImpl: makeFakeSpawn(calls),
    platform: "darwin"
  });
  const promise = engine.speak("hello world");
  // settle stdin write, then finish ok
  await new Promise((r) => setImmediate(r));
  calls[0].child._finishOk();
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "say");
});

test("speak() while another utterance is in-flight kills the previous child", async () => {
  const calls = [];
  const engine = createTtsEngine({
    spawnImpl: makeFakeSpawn(calls),
    platform: "darwin"
  });
  const first = engine.speak("first");
  await new Promise((r) => setImmediate(r));
  // start second before first closes
  const second = engine.speak("second");
  await new Promise((r) => setImmediate(r));
  // first should be killed
  assert.equal(calls[0].child.killed, true,
    "the first child must be killed when speak() is called again");
  // close events for both already queued via queueMicrotask in fake kill
  await new Promise((r) => setImmediate(r));
  // finish second normally
  calls[1].child._finishOk();
  const r1 = await first;
  const r2 = await second;
  assert.equal(r1.cancelled, true, "first call observes cancellation");
  assert.equal(r2.ok, true, "second call observes normal completion");
});

test("cancel() kills the in-flight child and is idempotent", async () => {
  const calls = [];
  const engine = createTtsEngine({
    spawnImpl: makeFakeSpawn(calls),
    platform: "darwin"
  });
  const promise = engine.speak("text");
  await new Promise((r) => setImmediate(r));
  const c1 = engine.cancel();
  const c2 = engine.cancel();
  assert.equal(c1.cancelled, true);
  assert.equal(c2.cancelled, false, "second cancel is a no-op");
  await new Promise((r) => setImmediate(r));
  const result = await promise;
  assert.equal(result.cancelled, true);
});

test("Windows path uses -EncodedCommand with UTF-16LE base64 (text never reaches argv literally)", async () => {
  const calls = [];
  const engine = createTtsEngine({
    spawnImpl: makeFakeSpawn(calls),
    platform: "win32"
  });
  // Tricky text: quotes, newline, emoji, CJK, semicolons, backticks.
  const tricky = `Hi "there"\nit's 🎉 中文 ; & |`;
  const promise = engine.speak(tricky);
  await new Promise((r) => setImmediate(r));
  calls[0].child._finishOk();
  await promise;

  assert.equal(calls[0].command, "powershell.exe");
  const args = calls[0].args;
  assert.ok(args.includes("-EncodedCommand"), "should use -EncodedCommand");
  assert.ok(args.includes("-NoProfile"));
  assert.ok(args.includes("-NonInteractive"));
  assert.ok(args.includes("-ExecutionPolicy"));
  // Verify the raw text is NOT pasted into argv anywhere.
  for (const arg of args) {
    assert.ok(!arg.includes("🎉"), "raw text must not appear in argv (must be base64-encoded)");
    assert.ok(!arg.includes("中文"), "raw text must not appear in argv");
    assert.ok(!arg.includes("\n"), "raw newline must not appear in argv");
  }
  // Decode the EncodedCommand and verify it round-trips: contains a Speak()
  // call wrapping our text after PowerShell single-quote escaping.
  const idx = args.indexOf("-EncodedCommand");
  const b64 = args[idx + 1];
  const decoded = Buffer.from(b64, "base64").toString("utf16le");
  assert.ok(decoded.includes("Speak("));
  assert.ok(decoded.includes("中文"), "decoded script preserves CJK");
  assert.ok(decoded.includes("🎉"), "decoded script preserves emoji");
});

test("ENOENT on spawn marks engine unavailable so subsequent speak() short-circuits", async () => {
  const calls = [];
  const engine = createTtsEngine({
    spawnImpl: makeFakeSpawn(calls, { spawnError: { code: "ENOENT", message: "no command" } }),
    platform: "darwin"
  });
  const r1 = await engine.speak("hello");
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "command_not_found");
  assert.equal(engine.isUnavailable(), true);
  // subsequent call must NOT spawn again — engine remembers it cannot speak.
  const r2 = await engine.speak("again");
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "command_not_found");
  assert.equal(calls.length, 1, "only the first attempt spawned");
});

test("empty / whitespace text returns empty_text without spawning", async () => {
  const calls = [];
  const engine = createTtsEngine({
    spawnImpl: makeFakeSpawn(calls),
    platform: "darwin"
  });
  const result = await engine.speak("   \n  ");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty_text");
  assert.equal(calls.length, 0);
});
