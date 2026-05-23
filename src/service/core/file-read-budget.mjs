import { hasLocalAnchor } from "./intent/context-sources.mjs";
import { RESEARCH_PROFILES } from "./policy/research-quality.mjs";

export const FILE_READ_DEPTHS = Object.freeze({
  FOCUSED: "focused",
  STANDARD: "standard",
  DEEP: "deep"
});

export const FILE_READ_BUDGETS = Object.freeze({
  [FILE_READ_DEPTHS.FOCUSED]: Object.freeze({
    depth: FILE_READ_DEPTHS.FOCUSED,
    max_depth: 2,
    max_files: 12,
    max_total_chars: 20000,
    max_chars_per_file: 5000,
    max_chars: 8000
  }),
  [FILE_READ_DEPTHS.STANDARD]: Object.freeze({
    depth: FILE_READ_DEPTHS.STANDARD,
    max_depth: 4,
    max_files: 30,
    max_total_chars: 50000,
    max_chars_per_file: 8000,
    max_chars: 12000
  }),
  [FILE_READ_DEPTHS.DEEP]: Object.freeze({
    depth: FILE_READ_DEPTHS.DEEP,
    max_depth: 6,
    max_files: 60,
    max_total_chars: 90000,
    max_chars_per_file: 12000,
    max_chars: 18000
  })
});

const SR_FILE_READ_DEPTH_MAP = Object.freeze({
  shallow: FILE_READ_DEPTHS.FOCUSED,
  focused: FILE_READ_DEPTHS.FOCUSED,
  standard: FILE_READ_DEPTHS.STANDARD,
  deep: FILE_READ_DEPTHS.DEEP
});

const SR_RESEARCH_DEPTH_MAP = Object.freeze({
  single_lookup: FILE_READ_DEPTHS.FOCUSED,
  multi_source: FILE_READ_DEPTHS.STANDARD,
  deep_research: FILE_READ_DEPTHS.DEEP
});

const SR_SOURCE_MODE_MAP = Object.freeze({
  provided_context: FILE_READ_DEPTHS.STANDARD,
  single_lookup: FILE_READ_DEPTHS.FOCUSED,
  multi_source_research: FILE_READ_DEPTHS.STANDARD,
  deep_research: FILE_READ_DEPTHS.DEEP
});

function normalizeMappedDepth(value = "", map = {}) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  return map[key] ?? null;
}

export function normalizeFileReadDepth(value = "") {
  const key = String(value ?? "").trim();
  return Object.values(FILE_READ_DEPTHS).includes(key) ? key : null;
}

function hasLocalFileContext(contextSources = null, contextPacket = {}) {
  return Boolean(
    contextSources?.uploaded_files
    || contextSources?.file_text
    || contextSources?.editable_artifact
    || hasLocalAnchor(contextSources)
    || (Array.isArray(contextPacket?.file_paths) && contextPacket.file_paths.length > 0)
  );
}

function budget(depth, reason) {
  const profile = FILE_READ_BUDGETS[depth] ?? FILE_READ_BUDGETS[FILE_READ_DEPTHS.STANDARD];
  return {
    ...profile,
    reason
  };
}

/**
 * Derive local file-read budgets from framework state. This intentionally
 * reads SR/task-spec outcomes, not user-topic regexes; topics belong in SR.
 *
 * @param {{
 *   contextSources?: object,
 *   contextPacket?: object,
 *   researchQuality?: object | null,
 *   srDecision?: object | null
 * }} input
 * @returns {object | null}
 */
export function inferFileReadBudget({
  contextSources = null,
  contextPacket = {},
  researchQuality = null,
  srDecision = null
} = {}) {
  const explicitDepth = normalizeFileReadDepth(srDecision?.file_read_depth)
    ?? normalizeMappedDepth(srDecision?.file_read_depth, SR_FILE_READ_DEPTH_MAP);
  if (explicitDepth) {
    return budget(explicitDepth, "Semantic router supplied file_read_depth.");
  }

  const sourceDepth = normalizeMappedDepth(srDecision?.source_mode, SR_SOURCE_MODE_MAP);
  if (sourceDepth === FILE_READ_DEPTHS.DEEP) {
    return budget(FILE_READ_DEPTHS.DEEP, "Semantic router supplied deep source_mode.");
  }

  if (researchQuality?.profile === RESEARCH_PROFILES.DEEP_RESEARCH) {
    return budget(FILE_READ_DEPTHS.DEEP, "TaskSpec research_quality requires deep research.");
  }

  const researchDepth = normalizeMappedDepth(srDecision?.research_depth, SR_RESEARCH_DEPTH_MAP);
  if (researchDepth === FILE_READ_DEPTHS.DEEP) {
    return budget(FILE_READ_DEPTHS.DEEP, "Semantic router supplied deep research_depth.");
  }

  if (researchQuality?.profile === RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH
      || researchDepth === FILE_READ_DEPTHS.STANDARD
      || sourceDepth === FILE_READ_DEPTHS.STANDARD) {
    return budget(FILE_READ_DEPTHS.STANDARD, "Research-class task gets standard local evidence budget.");
  }

  if (researchQuality?.profile === RESEARCH_PROFILES.SINGLE_LOOKUP
      || researchDepth === FILE_READ_DEPTHS.FOCUSED
      || sourceDepth === FILE_READ_DEPTHS.FOCUSED) {
    return budget(FILE_READ_DEPTHS.FOCUSED, "Single-lookup task gets focused local evidence budget.");
  }

  if (hasLocalFileContext(contextSources, contextPacket)) {
    return budget(FILE_READ_DEPTHS.STANDARD, "Local file context present.");
  }

  return null;
}

export function resolveFileReadBudgetFromTask(task = null) {
  const fileRead = task?.task_spec?.file_read ?? task?.task_spec_initial?.file_read ?? null;
  const depth = normalizeFileReadDepth(fileRead?.depth);
  if (!depth) return FILE_READ_BUDGETS[FILE_READ_DEPTHS.STANDARD];
  const defaults = FILE_READ_BUDGETS[depth];
  return {
    ...defaults,
    depth,
    max_depth: numberOrDefault(fileRead?.max_depth, defaults.max_depth),
    max_files: numberOrDefault(fileRead?.max_files, defaults.max_files),
    max_total_chars: numberOrDefault(fileRead?.max_total_chars, defaults.max_total_chars),
    max_chars_per_file: numberOrDefault(fileRead?.max_chars_per_file, defaults.max_chars_per_file),
    max_chars: numberOrDefault(fileRead?.max_chars, defaults.max_chars),
    reason: typeof fileRead?.reason === "string" ? fileRead.reason : defaults.reason
  };
}

function numberOrDefault(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
