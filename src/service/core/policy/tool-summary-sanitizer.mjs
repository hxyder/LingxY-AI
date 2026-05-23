const ALLOWED_FIELDS = Object.freeze([
  "tool_id",
  "tool_name",
  "success",
  "source_count",
  "distinct_domain_count",
  "artifact_ids",
  "key_results",
  "warnings",
  "duration_ms"
]);

const KEY_RESULTS_STRING_MAX = 800;
const KEY_RESULTS_ARRAY_ITEM_MAX = 200;
const KEY_RESULTS_ARRAY_LEN_MAX = 8;
const WARNINGS_MAX = 4;
const WARNING_LEN_MAX = 200;

function takeString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function takeStringArray(value, itemMax, lenMax) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.slice(0, itemMax))
    .slice(0, lenMax);
}

export function sanitizeToolSummary(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};

  for (const field of ALLOWED_FIELDS) {
    if (raw[field] === undefined) continue;
    const value = raw[field];

    switch (field) {
      case "tool_id":
      case "tool_name":
        if (typeof value === "string" && value.length <= 200) out[field] = value;
        break;
      case "success":
        if (typeof value === "boolean") out[field] = value;
        break;
      case "source_count":
      case "distinct_domain_count":
      case "duration_ms":
        if (Number.isFinite(value)) out[field] = Math.max(0, Math.floor(value));
        break;
      case "artifact_ids": {
        const ids = takeStringArray(value, 256, 16);
        if (ids && ids.length > 0) out[field] = ids;
        break;
      }
      case "key_results": {
        const asStr = takeString(value, KEY_RESULTS_STRING_MAX);
        if (asStr !== null) {
          out[field] = asStr;
        } else {
          const asArr = takeStringArray(value, KEY_RESULTS_ARRAY_ITEM_MAX, KEY_RESULTS_ARRAY_LEN_MAX);
          if (asArr && asArr.length > 0) out[field] = asArr;
        }
        break;
      }
      case "warnings": {
        const arr = takeStringArray(value, WARNING_LEN_MAX, WARNINGS_MAX);
        if (arr && arr.length > 0) out[field] = arr;
        break;
      }
      default:
        break;
    }
  }

  return out;
}

export const TOOL_SUMMARY_SANITIZER_FIELDS = ALLOWED_FIELDS;
