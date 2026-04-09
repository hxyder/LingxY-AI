import academicSummary from "./academic_summary.json" with { type: "json" };
import competitorScan from "./competitor_scan.json" with { type: "json" };
import dataBriefing from "./data_briefing.json" with { type: "json" };
import emailDraft from "./email_draft.json" with { type: "json" };
import legalContractReview from "./legal_contract_review.json" with { type: "json" };
import { normalizeTemplateDocument } from "../parser.mjs";
import { validateTemplateDocument } from "../schema.mjs";

function prepareTemplate(template) {
  const normalized = normalizeTemplateDocument(template);
  const validation = validateTemplateDocument(normalized);
  if (!validation.ok) {
    throw new Error(`invalid_builtin_template:${normalized.id ?? "unknown"}`);
  }
  return normalized;
}

export const BUILTIN_TEMPLATES = Object.freeze([
  legalContractReview,
  academicSummary,
  dataBriefing,
  emailDraft,
  competitorScan
].map(prepareTemplate));
