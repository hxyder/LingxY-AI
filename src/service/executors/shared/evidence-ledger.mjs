import { extractEvidence } from "../../core/policy/evidence-normalizer.mjs";

const DEFAULT_LEDGER_LIMIT = 16;

function shortLocator(locator = "") {
  const text = String(locator ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.replace(/^www\./i, "") || text;
    }
  } catch {
    /* local path */
  }
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || text;
}

function sourceRank(source = {}) {
  const kindWeight = source.kind === "web" ? 4
    : source.kind === "file" ? 3
      : source.kind === "chunk" ? 2
        : source.kind === "image" ? 2
          : 1;
  const score = Number.isFinite(Number(source.score)) ? Number(source.score) : 0;
  return kindWeight + score;
}

function formatSourceRow(source = {}) {
  const parts = [
    `[${source.id}]`,
    source.kind,
    shortLocator(source.locator)
  ];
  if (source.scope) parts.push(source.scope);
  if (source.range) parts.push(`chars ${source.range.char_start}-${source.range.char_end}`);
  if (Number.isFinite(Number(source.score))) parts.push(`score=${Number(source.score).toFixed(2)}`);
  if (source.truncated) parts.push("truncated");
  const title = source.title && source.title !== shortLocator(source.locator)
    ? ` "${source.title}"`
    : "";
  return `${parts.join(" | ")}${title}`;
}

export function renderEvidenceLedgerFromSummary(evidence, { limit = DEFAULT_LEDGER_LIMIT } = {}) {
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  if (sources.length === 0) return "";
  const capped = [...sources]
    .sort((a, b) => {
      const rankDiff = sourceRank(b) - sourceRank(a);
      if (rankDiff !== 0) return rankDiff;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    })
    .slice(0, Math.max(1, Math.min(50, Number(limit) || DEFAULT_LEDGER_LIMIT)));
  return capped.map(formatSourceRow).join("\n");
}

export function renderEvidenceLedger(transcript, options = {}) {
  return renderEvidenceLedgerFromSummary(extractEvidence(transcript), options);
}
