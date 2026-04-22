import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const {
  applyReasoningSelectionToBody,
  reasoningOptionsForProvider,
  sanitizeTaskRouteForProvider
} = await import("../src/shared/provider-catalog.mjs");

const {
  providerCanVision
} = await import("../src/service/executors/multi_modal/multi-modal-executor.mjs");

const doubaoProvider = {
  id: "doubao",
  kind: "openai",
  name: "豆包",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "test",
  defaultModel: "doubao-seed-2-0-lite-260215"
};

{
  const options = reasoningOptionsForProvider(doubaoProvider, doubaoProvider.defaultModel);
  const ids = options.map((option) => option.id);
  assert.deepEqual(
    ids,
    ["", "thinking:disabled|minimal", "thinking:enabled|low", "thinking:enabled|medium", "thinking:enabled|high"],
    "Doubao should expose disable + low/medium/high reasoning controls"
  );
}

{
  const route = sanitizeTaskRouteForProvider(doubaoProvider, {
    providerId: "doubao",
    model: "doubao-seed-2-0-lite-260215",
    mode: "default",
    reasoningEffort: "thinking:enabled"
  }, "chat");
  assert.equal(
    route.reasoningEffort,
    "thinking:enabled|medium",
    "Legacy Doubao thinking:enabled should normalize to the medium preset"
  );
}

{
  const body = {};
  applyReasoningSelectionToBody(body, doubaoProvider, doubaoProvider.defaultModel, "thinking:enabled|high");
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "high");
}

{
  assert.equal(
    providerCanVision(doubaoProvider),
    true,
    "Doubao Ark providers should be considered vision-capable"
  );
}

{
  const standaloneClient = fs.readFileSync(path.join("browser_ext", "background", "standalone-client.js"), "utf8");
  assert.match(standaloneClient, /"doubao"/, "Standalone direct-vision support list should include Doubao");
}

{
  const emailMonitor = fs.readFileSync(path.join("src", "service", "email", "monitor.mjs"), "utf8");
  assert.doesNotMatch(
    emailMonitor,
    /sendNotification\(runtime,\s*"新邮件摘要"/,
    "Email monitor should not toast every new mail summary"
  );
}

console.log("Doubao routing / vision / mail-notify verification passed.");
