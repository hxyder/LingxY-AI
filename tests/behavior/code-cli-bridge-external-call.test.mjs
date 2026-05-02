import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  extractAssistantText,
  spawnCodeCliChat
} from "../../src/service/executors/agentic/code-cli-bridge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("code-cli bridge writes prompt to stdin and captures stream-json stdout", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "uca-code-cli-bridge-"));
  const promptLog = path.join(tmpDir, "prompt.log");
  try {
    const result = await spawnCodeCliChat({
      command: process.execPath,
      args: [path.join(repoRoot, "tests", "fixtures", "mock-agentic-code-cli.mjs")],
      env: {
        ...process.env,
        UCA_MOCK_CLI_LOG: promptLog
      },
      prompt: "# User\nFind recent AI trends.",
      model: "mock-model",
      transport: "stream_json_print",
      timeoutSeconds: 5
    });

    assert.equal(result.ok, true);
    assert.equal(result.spawnError, false);
    assert.equal(result.timedOut, false);
    assert.match(await readFile(promptLog, "utf8"), /Find recent AI trends/);
    assert.match(extractAssistantText(result.stdout, "stream_json_print"), /I will search/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("code-cli bridge returns a timedOut result for a stuck subprocess", async () => {
  const result = await spawnCodeCliChat({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    prompt: "# User\nThis should time out.",
    transport: "plain",
    timeoutSeconds: 0.02
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.spawnError, false);
  assert.match(result.stderr, /\[bridge\] killed after 0\.02s timeout/);
});
