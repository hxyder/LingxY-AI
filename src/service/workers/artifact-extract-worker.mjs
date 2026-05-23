import { stat } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_ARTIFACT_KINDS = new Set(["xlsx", "pptx", "docx", "pdf", "html"]);

function normalizeKind(input = {}) {
  const fromKind = String(input.kind ?? "").trim().toLowerCase();
  if (fromKind) return fromKind.replace(/^\./, "");
  const fromPath = path.extname(String(input.path ?? "")).replace(/^\./, "").toLowerCase();
  return fromPath || "unknown";
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("artifact extraction aborted");
    error.name = "AbortError";
    throw error;
  }
}

export async function runArtifactExtractWorker(input = {}, { signal = null, onProgress = null } = {}) {
  assertNotAborted(signal);
  const artifactId = input.artifactId ?? input.artifact_id ?? null;
  const artifactPath = input.path ?? null;
  const kind = normalizeKind(input);
  onProgress?.({ phase: "inspect", artifactId, kind });
  if (!artifactId) {
    throw new Error("artifactId required");
  }
  if (!artifactPath) {
    return {
      artifactId,
      kind,
      quality: { parse_status: "failed", reason: "missing_path" },
      summary: "Artifact extraction skipped because no artifact path was provided.",
      content: "",
      warnings: ["missing_path"]
    };
  }

  let fileStat = null;
  try {
    fileStat = await stat(artifactPath);
  } catch (error) {
    return {
      artifactId,
      kind,
      quality: { parse_status: "failed", reason: "file_not_found" },
      summary: `Artifact extraction failed because the file was not readable: ${error.code ?? error.message}`,
      content: "",
      warnings: ["file_not_found"]
    };
  }
  assertNotAborted(signal);
  if (!fileStat.isFile()) {
    return {
      artifactId,
      kind,
      quality: { parse_status: "failed", reason: "not_a_file" },
      summary: "Artifact extraction failed because the artifact path is not a file.",
      content: "",
      warnings: ["not_a_file"]
    };
  }

  const supported = SUPPORTED_ARTIFACT_KINDS.has(kind);
  return {
    artifactId,
    kind,
    quality: {
      parse_status: supported ? "partial" : "failed",
      reason: supported ? "worker_foundation_metadata_only" : "unsupported_kind",
      bytes: fileStat.size
    },
    summary: supported
      ? `Artifact ${artifactId} (${kind}) is queued through the background extraction lane; typed deep parsing is deferred.`
      : `Artifact extraction does not support ${kind}.`,
    content: "",
    warnings: supported ? ["metadata_only_foundation"] : ["unsupported_kind"]
  };
}
