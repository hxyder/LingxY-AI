export const FILE_EVIDENCE_COVERAGE = Object.freeze({
  SINGLE_FILE_TEXT: "single_file_text",
  FOLDER_RECURSIVE_TEXT: "folder_recursive_text",
  DIRECTORY_LISTING_SHALLOW: "directory_listing_shallow",
  FILE_ENUMERATION_RECURSIVE: "file_enumeration_recursive",
  FILE_METADATA: "file_metadata"
});

const KNOWN_SCOPES = new Set(Object.values(FILE_EVIDENCE_COVERAGE));
const TEXT_SCOPES = new Set([
  FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
  FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT
]);
const DEEP_TEXT_SCOPES = new Set([
  FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT
]);

export function normalizeFileCoverageScope(value = "") {
  const scope = String(value ?? "").trim();
  return KNOWN_SCOPES.has(scope) ? scope : null;
}

export function isFileTextCoverageScope(value = "") {
  const scope = normalizeFileCoverageScope(value);
  return scope ? TEXT_SCOPES.has(scope) : false;
}

export function isDeepFileTextCoverageScope(value = "") {
  const scope = normalizeFileCoverageScope(value);
  return scope ? DEEP_TEXT_SCOPES.has(scope) : false;
}
