const DEFAULT_PARTIAL_SUCCESS_FALLBACK = "see task for details";
const PARTIAL_SUCCESS_PREFIX_RE = /^Task partially succeeded:?\s*/i;
const EMPTY_DETAIL_RE = /^[\s.。:：;；,，-]+$/u;

function normalizedFallback(value) {
  const fallback = String(value ?? "").trim();
  return fallback || DEFAULT_PARTIAL_SUCCESS_FALLBACK;
}

export function normalizePartialSuccessDetail(
  message = "",
  { fallback = DEFAULT_PARTIAL_SUCCESS_FALLBACK } = {}
) {
  const cleanFallback = normalizedFallback(fallback);
  const withoutPrefix = String(message ?? "")
    .replace(PARTIAL_SUCCESS_PREFIX_RE, "")
    .trim();
  if (!withoutPrefix || EMPTY_DETAIL_RE.test(withoutPrefix)) return cleanFallback;
  return withoutPrefix;
}

export function formatPartialSuccessContent(
  message = "",
  {
    fallback = DEFAULT_PARTIAL_SUCCESS_FALLBACK,
    prefix = "Task partially succeeded"
  } = {}
) {
  const cleanPrefix = String(prefix ?? "")
    .replace(/[:：\s]+$/u, "")
    .trim() || "Task partially succeeded";
  return `${cleanPrefix}: ${normalizePartialSuccessDetail(message, { fallback })}`;
}

function meaningfulMessage(value) {
  const text = String(value ?? "").trim();
  if (!text || EMPTY_DETAIL_RE.test(text)) return null;
  const detail = normalizePartialSuccessDetail(text, { fallback: "" });
  if (!detail || EMPTY_DETAIL_RE.test(detail)) return null;
  return text;
}

export function selectPartialSuccessTaskMessage(
  task = {},
  {
    fallback = DEFAULT_PARTIAL_SUCCESS_FALLBACK,
    prefix = "Task partially succeeded"
  } = {}
) {
  const finalCandidates = [
    task?.result_summary,
    task?.result?.final_text,
    task?.result?.finalText,
    task?.final_text,
    task?.finalText
  ];
  for (const candidate of finalCandidates) {
    const message = meaningfulMessage(candidate);
    if (message) return message;
  }

  const detailCandidates = [
    task?.failure_user_message,
    task?.partial_message,
    task?.result?.partial_message,
    task?.result?.message
  ];
  for (const candidate of detailCandidates) {
    const message = meaningfulMessage(candidate);
    if (message) return formatPartialSuccessContent(message, { fallback, prefix });
  }

  return formatPartialSuccessContent("", { fallback, prefix });
}
