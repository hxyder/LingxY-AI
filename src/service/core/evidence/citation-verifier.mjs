const CITATION_ID_PATTERN = /\[([wfci]_[0-9a-f]{8})\]/g;

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function paragraphCount(text = "") {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Math.max(1, paragraphs.length);
}

export function verifyCitations(finalText = "", sources = []) {
  const sourceIds = new Set(
    (Array.isArray(sources) ? sources : [])
      .map((source) => source?.id)
      .filter(Boolean)
  );
  const claimed = unique([...String(finalText ?? "").matchAll(CITATION_ID_PATTERN)]
    .map((match) => match[1]));
  const missing = claimed.filter((id) => !sourceIds.has(id));
  const unused = [...sourceIds].filter((id) => !claimed.includes(id)).sort();
  return {
    claimed,
    missing,
    unused,
    claim_density: claimed.length / paragraphCount(finalText)
  };
}

export function citationViolations(citations = {}) {
  const missing = Array.isArray(citations?.missing) ? citations.missing : [];
  if (missing.length === 0) return [];
  return [{
    kind: "citation_unresolved",
    message: `Final answer cited source id(s) not present in the evidence ledger: ${missing.join(", ")}`,
    missing
  }];
}
