#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readAudioFixtureManifest,
  summarizeRealAudioCorpus
} from "../src/service/audio/audio-fixture-corpus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultCorpusRoot = path.join(root, "tests", "fixtures", "audio");
const defaultManifestPath = path.join(defaultCorpusRoot, "manifest.json");

async function verifyCorpus(manifestPath, corpusRoot, label) {
  const manifest = await readAudioFixtureManifest(manifestPath);
  const summary = await summarizeRealAudioCorpus(manifest, { corpusRoot });

  assert.equal(manifest.version, 1, `${label} corpus manifest must be versioned`);
  assert.ok(manifest.optionalPrivateFixtureEnv,
    `${label} corpus must document the optional private fixture env`);
  assert.ok(summary.audio_count >= 10, `${label} corpus must include checked audio samples`);
  assert.ok(summary.transcription_count >= 3,
    `${label} corpus must include voice/note transcription samples`);
  assert.ok(summary.wake_count >= 8,
    `${label} corpus must include wake positives, near misses, and custom profiles`);
  assert.ok(summary.wake_positive_count >= 5, `${label} corpus needs wake positives`);
  assert.ok(summary.wake_negative_count >= 3, `${label} corpus needs wake near-miss negatives`);
  assert.equal(summary.transcription_empty_rate, 0,
    `${label} transcription fixtures must not be empty`);
  assert.ok(summary.transcription_average_wer <= 0.02,
    `${label} transcription WER too high: ${summary.transcription_average_wer}`);
  assert.equal(summary.wake_false_negative_rate, 0,
    `${label} wake positives must match`);
  assert.equal(summary.wake_false_positive_rate, 0,
    `${label} wake near-misses must not match`);

  const locales = new Set(summary.transcription_results.map((result) => result.output_locale));
  assert.ok(locales.has("en-US"), `${label} corpus must cover en-US transcription`);
  assert.ok(locales.has("zh-CN"), `${label} corpus must cover zh-CN transcription`);

  const audioIds = new Set(summary.audio_entries.map((entry) => entry.id));
  for (const requiredId of [
    "voice_en_short_command",
    "note_zh_cn_final_chunk",
    "default_latin_exact",
    "default_note_intent",
    "near_miss_generic_recording_command",
    "custom_profile_exact",
    "custom_profile_excludes_default"
  ]) {
    assert.ok(audioIds.has(requiredId), `${label} corpus missing ${requiredId}`);
  }

  for (const entry of summary.audio_entries) {
    assert.equal(entry.wav.format, "pcm_s16le", `${label} ${entry.id} must be PCM WAV`);
    assert.ok(entry.wav.duration_ms >= 350, `${label} ${entry.id} must have real duration`);
    assert.ok(entry.wav.rms >= 0.001, `${label} ${entry.id} must not be silent`);
    assert.ok(/^[a-f0-9]{64}$/u.test(entry.sha256), `${label} ${entry.id} must have a SHA-256 lock`);
  }

  return summary;
}

await verifyCorpus(defaultManifestPath, defaultCorpusRoot, "checked-in");

const privateRoot = process.env.LINGXY_REAL_AUDIO_FIXTURE_DIR;
if (privateRoot) {
  const privateManifest = path.join(privateRoot, "manifest.json");
  assert.ok(existsSync(privateManifest),
    "LINGXY_REAL_AUDIO_FIXTURE_DIR must point to a directory containing manifest.json");
  await verifyCorpus(privateManifest, privateRoot, "private");
}

console.log("[verify-real-audio-kws-fixtures] real audio and KWS fixture corpus OK");
