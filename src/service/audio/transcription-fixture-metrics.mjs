import {
  normalizeTranscriptionEventForLocale,
  normalizeTranscriptionTextForLocale
} from "./transcript-locale.mjs";
import {
  buildWakeProfile,
  classifyWakeTranscript,
  matchesWake
} from "../../shared/echo-wake-match.mjs";

function normalizeTextForComparison(text = "") {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Script=Han}]+/gu, " ")
    .trim();
}

export function tokenizeTranscript(text = "") {
  const normalized = normalizeTextForComparison(text);
  const tokens = [];
  for (const match of normalized.matchAll(/[\p{Script=Han}]|[\p{Letter}\p{Number}]+/gu)) {
    tokens.push(match[0]);
  }
  return tokens;
}

export function levenshteinDistance(a = [], b = []) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

export function wordErrorRate(expected = "", actual = "") {
  const expectedTokens = tokenizeTranscript(expected);
  const actualTokens = tokenizeTranscript(actual);
  if (expectedTokens.length === 0) return actualTokens.length === 0 ? 0 : 1;
  return levenshteinDistance(expectedTokens, actualTokens) / expectedTokens.length;
}

function eventText(event = {}) {
  return String(event.transcript ?? event.text ?? event.delta ?? "");
}

function isFinalEvent(event = {}) {
  return event.final === true
    || event.is_final === true
    || ["final", "done", "completed", "transcript_final"].includes(String(event.type ?? ""));
}

export function evaluateTranscriptionFixture(fixture = {}) {
  const outputLocale = fixture.output_locale ?? fixture.outputLocale ?? "zh-CN";
  const expected = normalizeTranscriptionTextForLocale(fixture.expected ?? "", { outputLocale });
  const events = Array.isArray(fixture.events)
    ? fixture.events.map((event) => normalizeTranscriptionEventForLocale(event, { outputLocale }))
    : [];
  const eventTexts = events.map(eventText).filter((text) => text.trim().length > 0);
  const finalEvents = events.filter(isFinalEvent);
  const finalText = normalizeTranscriptionTextForLocale(
    fixture.actual ?? finalEvents.map(eventText).filter(Boolean).at(-1) ?? eventTexts.at(-1) ?? "",
    { outputLocale }
  );
  const wer = wordErrorRate(expected, finalText);
  return {
    id: fixture.id ?? "",
    output_locale: outputLocale,
    expected,
    actual: finalText,
    event_count: events.length,
    non_empty_event_count: eventTexts.length,
    has_final_chunk: finalEvents.some((event) => eventText(event).trim().length > 0),
    empty: finalText.trim().length === 0,
    wer
  };
}

export function summarizeTranscriptionFixtures(fixtures = []) {
  const results = fixtures.map(evaluateTranscriptionFixture);
  const count = results.length;
  const emptyCount = results.filter((result) => result.empty).length;
  const finalChunkCount = results.filter((result) => result.has_final_chunk).length;
  const averageWer = count > 0
    ? results.reduce((sum, result) => sum + result.wer, 0) / count
    : 0;
  return {
    count,
    empty_count: emptyCount,
    empty_rate: count > 0 ? emptyCount / count : 0,
    final_chunk_count: finalChunkCount,
    final_chunk_rate: count > 0 ? finalChunkCount / count : 0,
    average_wer: averageWer,
    results
  };
}

export function evaluateWakeWordFixture(fixture = {}) {
  const profile = buildWakeProfile(fixture.profile ?? {});
  const transcript = String(fixture.transcript ?? fixture.text ?? "");
  const expectedMatch = fixture.expected_match ?? fixture.expectedMatch ?? fixture.matched ?? false;
  const expectedKind = fixture.expected_kind ?? fixture.expectedKind ?? null;
  const matched = matchesWake(transcript, profile);
  const kind = classifyWakeTranscript(transcript, profile);
  return {
    id: fixture.id ?? "",
    transcript,
    expected_match: Boolean(expectedMatch),
    expected_kind: expectedKind,
    matched,
    kind,
    correct: matched === Boolean(expectedMatch) && (!expectedKind || kind === expectedKind)
  };
}

export function summarizeWakeWordFixtures(fixtures = []) {
  const results = fixtures.map(evaluateWakeWordFixture);
  const count = results.length;
  const positiveResults = results.filter((result) => result.expected_match);
  const negativeResults = results.filter((result) => !result.expected_match);
  const falseNegativeCount = positiveResults.filter((result) => !result.matched).length;
  const falsePositiveCount = negativeResults.filter((result) => result.matched).length;
  return {
    count,
    positive_count: positiveResults.length,
    negative_count: negativeResults.length,
    false_negative_count: falseNegativeCount,
    false_positive_count: falsePositiveCount,
    false_negative_rate: positiveResults.length > 0 ? falseNegativeCount / positiveResults.length : 0,
    false_positive_rate: negativeResults.length > 0 ? falsePositiveCount / negativeResults.length : 0,
    accuracy: count > 0 ? results.filter((result) => result.correct).length / count : 0,
    results
  };
}
