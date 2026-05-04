#!/usr/bin/env node
/**
 * Lock-in for the retired `topic_hint` signal.
 *
 * Topic classification belongs to the SemanticRouter. The deterministic
 * signal layer keeps a `topic_hint` compatibility key, but it must not carry
 * topic-word regex or policy evidence.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { extractAllSignals, SIGNAL_NAMES } from "../src/service/core/intent/signals/index.mjs";
import { detect as detectTopicHint } from "../src/service/core/intent/signals/topic-hint.mjs";
import {
  createSemanticRouter,
  SEMANTIC_DECISION_TOOL
} from "../src/service/core/intent/semantic-router.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { process.stdout.write(`PASS  ${label}\n`); pass += 1; })
    .catch((err) => {
      process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
      fail += 1;
    });
}

async function run() {
  await it("public surface: SIGNAL_NAMES keeps 'topic_hint' for compatibility", () => {
    assert.ok([...SIGNAL_NAMES].includes("topic_hint"));
  });

  await it("detector: topic_hint no longer fires on topical examples", () => {
    for (const text of ["今天北京的天气", "今天 AI 新闻", "查一下 AVIS 暴涨", "current weather"]) {
      const s = detectTopicHint(text, {});
      assert.equal(s.matched, false, `expected no deterministic topic match for "${text}"`);
      assert.equal(s.kind, null);
      assert.deepEqual(s.evidence, []);
    }
  });

  await it("extractAllSignals: compatibility key is present but empty", () => {
    const { signals, evidence } = extractAllSignals("今天北京的天气怎么样", {});
    assert.equal(signals.topic_hint?.matched, false);
    assert.equal(evidence.some((item) => item.source === "topic_hint"), false);
  });

  await it("source boundary: topic-hint file has no topic regex table", () => {
    const src = readFileSync(new URL("../src/service/core/intent/signals/topic-hint.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(src, /const\s+PATTERN\s*=/);
    assert.doesNotMatch(src, /天气\|气温|weather\|forecast|stock\\s\*price|AI\\s\*新闻/i);
  });

  await it("SR prompt: system message stays generic and topic judgement remains model-owned", async () => {
    let captured = null;
    const probeAdapter = {
      async generate(payload) {
        captured = payload;
        return {
          tool_calls: [{
            name: SEMANTIC_DECISION_TOOL.name,
            arguments: {
              source_scope: "external_world", web_policy: "required",
              output_kind: "conversation", artifact_required: false,
              executor: "tool_using", research_depth: "single_lookup",
              confidence: 0.85, reason: "test"
            }
          }]
        };
      }
    };
    const router = createSemanticRouter({ adapter: probeAdapter });
    await router.resolveSemanticDecision({ text: "今天北京的天气怎么样", contextPacket: {} });
    const sysMsg = captured.messages.find((m) => m.role === "system").content;
    assert.doesNotMatch(sysMsg, /weather.*stock.*flight.*news/i);
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
