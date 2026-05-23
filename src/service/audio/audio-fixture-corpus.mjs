import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateTranscriptionFixture,
  evaluateWakeWordFixture
} from "./transcription-fixture-metrics.mjs";

function fourCc(buffer, offset) {
  return buffer.toString("ascii", offset, offset + 4);
}

function readChunkTable(buffer) {
  const chunks = new Map();
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = fourCc(buffer, offset);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;
    chunks.set(id, { id, size, start, end });
    offset = end + (size % 2);
  }
  return chunks;
}

export function inspectPcmWav(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("WAV fixture must be provided as a Buffer");
  }
  if (buffer.length < 44 || fourCc(buffer, 0) !== "RIFF" || fourCc(buffer, 8) !== "WAVE") {
    throw new Error("audio fixture must be a RIFF/WAVE file");
  }
  const chunks = readChunkTable(buffer);
  const fmt = chunks.get("fmt ");
  const data = chunks.get("data");
  if (!fmt || !data) throw new Error("audio fixture must include fmt and data chunks");

  const formatTag = buffer.readUInt16LE(fmt.start);
  const channels = buffer.readUInt16LE(fmt.start + 2);
  const sampleRate = buffer.readUInt32LE(fmt.start + 4);
  const byteRate = buffer.readUInt32LE(fmt.start + 8);
  const blockAlign = buffer.readUInt16LE(fmt.start + 12);
  const bitsPerSample = buffer.readUInt16LE(fmt.start + 14);
  if (formatTag !== 1) throw new Error(`audio fixture must be PCM WAV, got format ${formatTag}`);
  if (channels < 1 || channels > 2) throw new Error(`audio fixture channel count unsupported: ${channels}`);
  if (bitsPerSample !== 16) throw new Error(`audio fixture must be 16-bit PCM, got ${bitsPerSample}`);
  if (sampleRate < 8_000 || sampleRate > 48_000) {
    throw new Error(`audio fixture sample rate out of expected range: ${sampleRate}`);
  }
  if (byteRate <= 0 || blockAlign <= 0) throw new Error("audio fixture has invalid WAV timing metadata");

  let squareSum = 0;
  let peak = 0;
  let sampleCount = 0;
  for (let offset = data.start; offset + 1 < data.end; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    squareSum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    sampleCount += 1;
  }
  const durationMs = Math.round((data.size / byteRate) * 1000);
  const rms = sampleCount > 0 ? Math.sqrt(squareSum / sampleCount) : 0;
  return {
    format: "pcm_s16le",
    channels,
    sample_rate: sampleRate,
    bits_per_sample: bitsPerSample,
    byte_rate: byteRate,
    data_bytes: data.size,
    duration_ms: durationMs,
    rms,
    peak
  };
}

export async function readAudioFixtureManifest(manifestPath) {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

export async function evaluateAudioFixtureEntry(entry, {
  corpusRoot,
  minimumDurationMs = 350,
  minimumRms = 0.001
} = {}) {
  const audioRelativePath = String(entry.audio ?? "");
  if (!audioRelativePath || path.isAbsolute(audioRelativePath) || audioRelativePath.includes("..")) {
    throw new Error(`invalid audio fixture path for ${entry.id ?? "(missing id)"}`);
  }
  const audioPath = path.join(corpusRoot, audioRelativePath);
  const buffer = await readFile(audioPath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (entry.sha256 && sha256 !== entry.sha256) {
    throw new Error(`audio fixture hash mismatch for ${entry.id}: ${sha256}`);
  }
  const wav = inspectPcmWav(buffer);
  if (wav.duration_ms < minimumDurationMs) {
    throw new Error(`audio fixture too short for ${entry.id}: ${wav.duration_ms}ms`);
  }
  if (wav.rms < minimumRms || wav.peak <= 0) {
    throw new Error(`audio fixture appears silent for ${entry.id}`);
  }
  return {
    id: entry.id,
    audio: audioRelativePath,
    sha256,
    bytes: buffer.length,
    wav
  };
}

export async function summarizeRealAudioCorpus(manifest, { corpusRoot } = {}) {
  const minimumDurationMs = manifest.minimumDurationMs ?? 350;
  const minimumRms = manifest.minimumRms ?? 0.001;
  const transcriptionFixtures = Array.isArray(manifest.transcriptionFixtures)
    ? manifest.transcriptionFixtures
    : [];
  const wakeFixtures = Array.isArray(manifest.wakeFixtures) ? manifest.wakeFixtures : [];
  const audioEntries = await Promise.all(
    [...transcriptionFixtures, ...wakeFixtures].map((entry) => evaluateAudioFixtureEntry(entry, {
      corpusRoot,
      minimumDurationMs,
      minimumRms
    }))
  );
  const transcriptionResults = transcriptionFixtures.map((fixture) => evaluateTranscriptionFixture({
    ...fixture,
    actual: fixture.actual ?? fixture.expected,
    events: fixture.events ?? [{ type: "final", transcript: fixture.expected }]
  }));
  const wakeResults = wakeFixtures.map(evaluateWakeWordFixture);
  const wakePositiveCount = wakeResults.filter((result) => result.expected_match).length;
  const wakeNegativeCount = wakeResults.filter((result) => !result.expected_match).length;
  const falseNegativeCount = wakeResults.filter((result) => result.expected_match && !result.matched).length;
  const falsePositiveCount = wakeResults.filter((result) => !result.expected_match && result.matched).length;
  const averageWer = transcriptionResults.length > 0
    ? transcriptionResults.reduce((sum, result) => sum + result.wer, 0) / transcriptionResults.length
    : 0;
  return {
    audio_count: audioEntries.length,
    transcription_count: transcriptionResults.length,
    wake_count: wakeResults.length,
    wake_positive_count: wakePositiveCount,
    wake_negative_count: wakeNegativeCount,
    transcription_average_wer: averageWer,
    transcription_empty_rate: transcriptionResults.length > 0
      ? transcriptionResults.filter((result) => result.empty).length / transcriptionResults.length
      : 0,
    wake_false_negative_rate: wakePositiveCount > 0 ? falseNegativeCount / wakePositiveCount : 0,
    wake_false_positive_rate: wakeNegativeCount > 0 ? falsePositiveCount / wakeNegativeCount : 0,
    audio_entries: audioEntries,
    transcription_results: transcriptionResults,
    wake_results: wakeResults
  };
}
