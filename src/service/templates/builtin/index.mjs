import { loadBuiltinJson } from "./load-json.mjs";
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
  loadBuiltinJson("legal_contract_review.json"),
  loadBuiltinJson("academic_summary.json"),
  loadBuiltinJson("data_briefing.json"),
  loadBuiltinJson("email_draft.json"),
  loadBuiltinJson("competitor_scan.json")
].map(prepareTemplate));
