#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  summarizeWakeWordFixtures,
  summarizeTranscriptionFixtures,
  tokenizeTranscript,
  wordErrorRate
} from "../src/service/audio/transcription-fixture-metrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const fixtures = JSON.parse(read("tests/fixtures/voice-transcription-fixtures.json"));
const summary = summarizeTranscriptionFixtures(fixtures);
const wakeFixtures = JSON.parse(read("tests/fixtures/wake-word-fixtures.json"));
const wakeSummary = summarizeWakeWordFixtures(wakeFixtures);

assert.equal(summary.count, 3, "voice fixture testbed must keep representative note/voice cases");
assert.equal(summary.empty_rate, 0, "fixture transcripts must not be empty");
assert.equal(summary.final_chunk_rate, 1, "every fixture must prove a non-empty final chunk");
assert.ok(summary.average_wer <= 0.05, `average WER too high: ${summary.average_wer}`);

assert.equal(wakeSummary.count, 9, "wake fixture testbed must cover positives, near-misses, and custom profiles");
assert.ok(wakeSummary.positive_count >= 5, "wake fixture testbed needs positive wake samples");
assert.ok(wakeSummary.negative_count >= 4, "wake fixture testbed needs near-miss non-wake samples");
assert.equal(wakeSummary.false_negative_rate, 0, "wake fixture positives must match");
assert.equal(wakeSummary.false_positive_rate, 0, "wake near-miss fixtures must not wake Echo");
assert.equal(wakeSummary.accuracy, 1, "wake fixture classifications must all match expectations");

const noteWake = wakeSummary.results.find((result) => result.id === "default_note_intent");
assert.equal(noteWake?.kind, "note", "wake fixture must classify note-intent phrases separately");
const genericRecord = wakeSummary.results.find((result) => result.id === "near_miss_generic_recording_command");
assert.equal(genericRecord?.matched, false, "generic recording command must not wake without the wake word");

const zhCase = summary.results.find((result) => result.id === "note_zh_cn_final_chunk");
assert.ok(zhCase, "missing zh-CN note fixture");
assert.equal(zhCase.actual.includes("請"), false, "zh-CN fixture must normalize Traditional Chinese output");
assert.equal(zhCase.actual.includes("English action items"), true, "zh-CN fixture must preserve English words");

assert.deepEqual(tokenizeTranscript("打开 VS Code and Chrome"), ["打", "开", "vs", "code", "and", "chrome"]);
assert.equal(wordErrorRate("open product notes", "open product notes"), 0);
assert.ok(wordErrorRate("open product notes", "open notes") > 0);

const audioRoutes = read("src/service/core/http-routes/audio-routes.mjs");
const transcriptLocale = read("src/service/audio/transcript-locale.mjs");
assert.ok(audioRoutes.includes("normalizeTranscriptionEventForLocale"),
  "streaming audio routes must normalize event text before sending final chunks");
assert.ok(transcriptLocale.includes("normalizeTranscriptionTextForLocale"),
  "voice fixture metrics must share the production locale normalizer");

console.log("voice fixture testbed ok");
