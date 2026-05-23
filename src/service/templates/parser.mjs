import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateTemplateDocument } from "./schema.mjs";

export function normalizeTemplateDocument(document) {
  return {
    ...document,
    description: document.description ?? "",
    input: document.input ?? {},
    output: document.output ?? {
      primary: null
    },
    permissions: document.permissions ?? {},
    cost_estimate: document.cost_estimate ?? {
      tokens_in: 0,
      tokens_out: 0
    }
  };
}

export async function loadTemplateFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = normalizeTemplateDocument(parsed);
  const validation = validateTemplateDocument(normalized);
  if (!validation.ok) {
    throw new Error(`Invalid template ${path.basename(filePath)}: ${validation.errors.join("; ")}`);
  }
  return normalized;
}

export function parseTemplateString(raw) {
  const parsed = JSON.parse(raw);
  const normalized = normalizeTemplateDocument(parsed);
  const validation = validateTemplateDocument(normalized);
  return {
    template: normalized,
    validation
  };
}
