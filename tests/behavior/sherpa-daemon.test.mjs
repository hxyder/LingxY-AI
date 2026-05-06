import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createSherpaKwsDaemon } from "../../src/service/audio/sherpa-daemon.mjs";

function makeFakeSpawn(onPayload, calls = []) {
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
    let buffer = "";
    child.stdin.on("data", (chunk) => {
      buffer += Buffer.from(chunk).toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        const response = onPayload(payload);
        child.stdout.write(`${JSON.stringify({ id: payload.id, ...response })}\n`, "utf8");
      }
    });
    return child;
  };
}

test("sherpa KWS daemon reuses a JSONL sidecar for wake detections", async () => {
  const spawnCalls = [];
  const seen = [];
  const daemon = createSherpaKwsDaemon({
    pythonCommand: "python",
    scriptPath: "scripts/local-sherpa-kws.py",
    spawnImpl: makeFakeSpawn((payload) => {
      seen.push(payload);
      return {
        ok: true,
        matched: true,
        keyword: "灵犀",
        audio_seconds: 1.4
      };
    }, spawnCalls),
    requestTimeoutMs: 1000,
    idleTimeoutMs: 0
  });

  const first = await daemon.detect({
    audioPath: "a.webm",
    personalized: true,
    templateFallback: true,
    keywords: ["灵犀"]
  });
  const second = await daemon.detect({ audioPath: "b.webm" });

  assert.equal(first.matched, true);
  assert.equal(second.keyword, "灵犀");
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0].args, ["scripts/local-sherpa-kws.py", "--server"]);
  assert.equal(seen[0].audio_path, "a.webm");
  assert.equal(seen[0].personalized, true);
  assert.equal(seen[0].template_fallback, true);
  assert.deepEqual(seen[0].keywords, ["灵犀"]);
  assert.equal(seen[1].audio_path, "b.webm");
  daemon.stop();
});
