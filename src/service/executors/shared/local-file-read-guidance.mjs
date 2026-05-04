const LOCAL_FILE_TEXT_READ_GROUP = "local_file_text_read";

const LOCAL_FILE_TEXT_READ_VIOLATION_KINDS = new Set([
  "local_file_text_read_required_not_called",
  "local_file_text_read_required_all_failed",
  "local_file_text_read_required_no_fresh_text",
  "local_file_text_read_required_deep_insufficient"
]);

export const DEFAULT_LOCAL_FILE_READ_GUIDANCE_LIMITS = Object.freeze({
  maxLocalFileReadGuidance: 2
});

function metadataOf(entry = {}) {
  if (entry.metadata && typeof entry.metadata === "object") return entry.metadata;
  if (entry.result?.metadata && typeof entry.result.metadata === "object") return entry.result.metadata;
  return {};
}

function toolIdOf(entry = {}) {
  return entry.tool ?? entry.name ?? null;
}

function isSuccessfulSearchFileContent(entry = {}) {
  return (entry.type === "tool_result" || entry.role === "tool")
    && toolIdOf(entry) === "search_file_content"
    && entry.success !== false
    && !entry.error;
}

export function localFileTextReadViolations(stepGate = null) {
  const violations = Array.isArray(stepGate?.violations) ? stepGate.violations : [];
  return violations.filter((violation) =>
    LOCAL_FILE_TEXT_READ_VIOLATION_KINDS.has(String(violation?.kind ?? ""))
  );
}

export function extractIndexedFileCandidates(transcript = [], { limit = 5 } = {}) {
  const candidates = [];
  const seen = new Set();
  for (const entry of transcript ?? []) {
    if (!isSuccessfulSearchFileContent(entry)) continue;
    const metadata = metadataOf(entry);
    const results = Array.isArray(metadata.results) ? metadata.results : [];
    for (const result of results) {
      const path = typeof result?.path === "string" ? result.path.trim() : "";
      if (!path || seen.has(path)) continue;
      seen.add(path);
      candidates.push({
        path,
        score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
        coverage_scope: result.coverage_scope ?? null,
        truncated: result.truncated === true
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

function candidateLines(candidates = []) {
  if (candidates.length === 0) {
    return [
      "- No reliable indexed path was returned. Use the explicit attached/local file paths from Resources if present; otherwise ask one concise clarification question."
    ];
  }
  return candidates.map((candidate, index) => {
    const details = [
      candidate.score == null ? null : `score=${candidate.score.toFixed(3)}`,
      candidate.coverage_scope ? `indexed_coverage=${candidate.coverage_scope}` : null,
      candidate.truncated ? "indexed_truncated=true" : null
    ].filter(Boolean).join(" ");
    return `- ${index + 1}. ${candidate.path}${details ? ` (${details})` : ""}`;
  });
}

export function buildLocalFileTextReadGuidance({ taskSpec = null, stepGate = null, transcript = [] } = {}) {
  const violations = localFileTextReadViolations(stepGate);
  if (violations.length === 0) return null;
  const deep = taskSpec?.file_read?.depth === "deep"
    || violations.some((violation) => violation.kind === "local_file_text_read_required_deep_insufficient");
  const candidates = extractIndexedFileCandidates(transcript);
  const toolInstruction = deep
    ? "Call read_folder_text for the relevant folder/project when the task needs deep local-file coverage. Do not finish from indexed snippets."
    : "Call read_file_text for the relevant file, or read_folder_text if the target is a folder. Do not finish from indexed snippets.";
  const instruction = [
    "The SuccessContract still requires fresh local file text (`local_file_text_read`).",
    "Indexed file search results only locate candidate paths; they do not prove the source file was read in this run.",
    toolInstruction,
    "Candidate paths from the latest indexed search:",
    ...candidateLines(candidates)
  ].join("\n");
  return { instruction, candidates, deep, violations };
}

export function planLocalFileTextReadGuidance({
  stepGate,
  transcript = [],
  taskSpec = null,
  iteration = 0,
  maxIterations = 8,
  guidanceCount = 0,
  limits = DEFAULT_LOCAL_FILE_READ_GUIDANCE_LIMITS
} = {}) {
  if (guidanceCount >= limits.maxLocalFileReadGuidance) return null;
  if (iteration >= maxIterations - 1) return null;
  const guidance = buildLocalFileTextReadGuidance({ taskSpec, stepGate, transcript });
  if (!guidance) return null;
  return {
    ...guidance,
    transcriptEntry: {
      type: "local_file_read_guidance",
      group: LOCAL_FILE_TEXT_READ_GROUP,
      instruction: guidance.instruction,
      candidates: guidance.candidates,
      deep: guidance.deep
    },
    eventPayload: {
      iteration,
      required_policy_group: LOCAL_FILE_TEXT_READ_GROUP,
      candidate_count: guidance.candidates.length,
      deep: guidance.deep
    }
  };
}
