// Built-in preview providers (UCA-182).
//
// Adding a new provider: drop a sibling file that exports a matching
// shape (see provider.mjs), import it here, push it onto the array.
// No other files need to change — registry + http-server route off the
// canHandle()/extensions contract.

import { SIDECAR_PROVIDER } from "./sidecar.mjs";
import { MARKDOWN_PROVIDER } from "./markdown.mjs";
import { DOCX_PROVIDER } from "./docx.mjs";
import { XLSX_PROVIDER } from "./xlsx.mjs";
import { TEXT_PROVIDER } from "./text.mjs";
import { CSV_PROVIDER } from "./csv.mjs";
import { IMAGE_PROVIDER } from "./image.mjs";
import { HTML_PASSTHROUGH_PROVIDER } from "./html-passthrough.mjs";

export const BUILTIN_PREVIEW_PROVIDERS = [
  SIDECAR_PROVIDER,
  MARKDOWN_PROVIDER,
  DOCX_PROVIDER,
  XLSX_PROVIDER,
  CSV_PROVIDER,
  IMAGE_PROVIDER,
  HTML_PASSTHROUGH_PROVIDER,
  TEXT_PROVIDER
  // Phase 4: PDF_PROVIDER
  // Phase 5: PPTX_PROVIDER
];
