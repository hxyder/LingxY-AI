const INTERNAL_RETRY_HINT_PATTERN = /(?:tool[_ -]?call|工具|plain text|纯文本|final answer|最终答复|最终回答|重试|retry)/iu;
const INTERNAL_RETRY_ACK_PATTERN = /(?:不需要|无需|没有|未|只是|上面|之前|previous|retry|tool[_ -]?call|工具|plain text|纯文本|final answer|最终答复)/iu;
const FINAL_ANSWER_INTRO_PATTERN = /(?:以下|下面|here is|final answer|最终答复|最终回答|纯文本).{0,32}(?:答复|回答|final answer)?\s*[:：]/iu;
const TOOL_OUTPUT_SECTION_LABEL_PATTERN = /^(?:-+\s*)?(?:stdout|stderr)\s*(?:-+)?$/iu;

function normalizeVisibleText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function looksLikeInternalRetryPreamble(block) {
  const text = normalizeVisibleText(block);
  if (!text) return false;
  return INTERNAL_RETRY_HINT_PATTERN.test(text) && INTERNAL_RETRY_ACK_PATTERN.test(text);
}

function stripInlineFinalAnswerIntro(text) {
  const value = normalizeVisibleText(text);
  if (!looksLikeInternalRetryPreamble(value.slice(0, 360))) return null;
  const match = value.match(new RegExp(`^[\\s\\S]{0,360}${FINAL_ANSWER_INTRO_PATTERN.source}\\s*([\\s\\S]+)$`, "iu"));
  const candidate = normalizeVisibleText(match?.[1] ?? "");
  return candidate || null;
}

function stripBlockFinalAnswerIntro(text) {
  const value = normalizeVisibleText(text);
  const lines = value.split("\n");
  const leading = lines.slice(0, 6);
  if (!looksLikeInternalRetryPreamble(leading.join("\n"))) return null;

  let cutIndex = -1;
  for (let index = 0; index < leading.length; index += 1) {
    if (FINAL_ANSWER_INTRO_PATTERN.test(leading[index])) {
      cutIndex = index;
      break;
    }
  }

  if (cutIndex < 0) {
    const blankIndex = leading.findIndex((line) => !String(line ?? "").trim());
    if (blankIndex > 0) cutIndex = blankIndex;
  }

  if (cutIndex < 0) return null;
  const candidate = normalizeVisibleText(lines.slice(cutIndex + 1).join("\n").replace(/^[-*_]{3,}\s*/u, ""));
  return candidate || null;
}

export function isToolOutputSectionLabelOnly(value) {
  return TOOL_OUTPUT_SECTION_LABEL_PATTERN.test(normalizeVisibleText(value));
}

export function extractToolStdoutText(value) {
  const text = normalizeVisibleText(value);
  if (!text) return "";
  const matches = [...text.matchAll(/---\s*stdout\s*---\s*([\s\S]*?)(?:\n---\s*stderr\s*---|$)/giu)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const content = normalizeVisibleText(matches[index]?.[1] ?? "");
    if (content && content !== "(empty)") return content.slice(0, 4000);
  }
  return "";
}

function preferToolStdoutWhenTranscriptLeaked(original, candidate) {
  const value = normalizeVisibleText(candidate);
  if (!value) return value;
  const stdout = extractToolStdoutText(value) || extractToolStdoutText(original);
  if (!stdout) return value;
  if (isToolOutputSectionLabelOnly(value) || /---\s*stdout\s*---/iu.test(value)) {
    return stdout;
  }
  return value;
}

export function sanitizeUserVisibleFinalText(value) {
  const original = normalizeVisibleText(value);
  if (!original) return "";
  const stripped = stripInlineFinalAnswerIntro(original)
    ?? stripBlockFinalAnswerIntro(original)
    ?? original;
  return preferToolStdoutWhenTranscriptLeaked(original, stripped);
}
