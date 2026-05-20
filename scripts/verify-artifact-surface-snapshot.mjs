import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/artifact-surface-inventory.md");
const documentArtifactHelpersPath = path.join(root, "src/service/capabilities/tools/document-artifact-helpers.mjs");

const requiredOwnerPaths = [
  "src/service/store/artifact-store.mjs",
  "src/service/core/store/artifact-metadata.mjs",
  "src/service/core/artifact-action-contract.mjs",
  "src/service/core/artifact-quality.mjs",
  "src/service/core/artifact-fallback-policy.mjs",
  "src/service/core/action-tool-submission.mjs",
  "src/service/core/browser-submission.mjs",
  "src/service/core/artifact-extracts/artifact-extract-service.mjs",
  "src/service/core/artifact-extracts/artifact-extract-background-lane.mjs",
  "src/service/workers/artifact-extract-worker.mjs",
  "src/service/core/artifact-lineage/artifact-lineage-service.mjs",
  "src/service/core/artifact-transforms/artifact-transform-service.mjs",
  "src/service/preview/registry.mjs",
  "src/service/core/http-routes/preview-file-routes.mjs",
  "src/service/capabilities/tools/file-reversibility.mjs",
  "src/service/capabilities/tools/browser-web-tools.mjs",
  "src/service/capabilities/tools/file-content-tools.mjs",
  "src/service/capabilities/tools/file-mutation-execution-tools.mjs",
  "src/service/capabilities/tools/document-artifact-helpers.mjs",
  "src/service/capabilities/tools/document-render-tools.mjs",
  "src/service/core/artifact-path-helper.mjs"
];

const artifactToolIds = [
  "account_download_file",
  "download_file",
  "edit_file",
  "generate_document",
  "register_artifact",
  "render_diagram",
  "render_svg",
  "take_screenshot",
  "write_file"
];

const expectedOutlineKinds = ["pptx", "docx", "xlsx", "pdf", "html"];
const documentedKinds = ["pptx", "docx", "xlsx", "pdf", "html", "image", "svg", "png", "jpg", "webp", "txt", "md", "csv", "json"];

function fail(message) {
  console.error(`[artifact-surface] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("Artifact Surface Inventory"), "artifact inventory missing title");
for (const filePath of requiredOwnerPaths) {
  assert(existsSync(path.join(root, filePath)), `artifact owner path missing in source: ${filePath}`);
  assert(doc.includes(filePath), `artifact inventory missing owner path: ${filePath}`);
}

const toolIds = new Set(BUILTIN_ACTION_TOOLS.map((tool) => tool.id));
for (const id of artifactToolIds) {
  assert(toolIds.has(id), `artifact-producing tool id missing from registry: ${id}`);
  assert(doc.includes(id), `artifact inventory missing artifact-producing tool id: ${id}`);
}

for (const kind of documentedKinds) {
  assert(doc.includes(kind), `artifact inventory missing documented kind: ${kind}`);
}

const toolsSource = readFileSync(documentArtifactHelpersPath, "utf8");
const outlineKindsMatch = toolsSource.match(/(?:export\s+)?const\s+OUTLINE_KINDS\s*=\s*new Set\(\[([^\]]+)\]\)/);
assert(Boolean(outlineKindsMatch), "OUTLINE_KINDS declaration missing from document artifact helpers");
if (outlineKindsMatch) {
  const actualKinds = [...outlineKindsMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  assert(
    JSON.stringify(actualKinds) === JSON.stringify(expectedOutlineKinds),
    "document outline kind snapshot changed; update inventory intentionally."
  );
}

// Phase 2E.0: artifact boundary call-site inventory must be documented
const callSiteCategories = [
  "Kind Inference",
  "Path Inference",
  "Registration",
  "Preview / Open / Reveal",
  "Lineage",
  "Transform",
  "Fallback",
  "Extract"
];
for (const category of callSiteCategories) {
  assert(doc.includes(`### ${category}`) || doc.includes(`${category}`),
    `artifact inventory missing call-site section: ${category}`);
}
assert(doc.includes("Phase 2E Consolidation Priorities"),
  "artifact inventory must document Phase 2E consolidation priorities");
assert(doc.includes("Path Inference (heaviest category)"),
  "artifact inventory must identify path inference as the heaviest category");

// Phase 2E.2: registration contract invariants
const artifactStoreSrc = readFileSync(path.join(root, "src/service/store/artifact-store.mjs"), "utf8");
assert(artifactStoreSrc.includes("registerArtifact"),
  "artifact-store.mjs must export registerArtifact");
assert(artifactStoreSrc.includes("artifact_id") && artifactStoreSrc.includes("task_id"),
  "registerArtifact must return artifact_id and task_id fields");

const artifactContractSrc = readFileSync(path.join(root, "src/service/core/artifact-action-contract.mjs"), "utf8");
assert(artifactContractSrc.includes("artifactRegistrationOptionsForPath"),
  "artifact-action-contract.mjs must export artifactRegistrationOptionsForPath");

// Registration call sites: browser-submission and context-submission must
// exist and use registerArtifact (Phase 2E.2 lock — prevents silent drift)
for (const filePath of [
  "src/service/core/browser-submission.mjs",
  "src/service/core/context-submission.mjs",
  "src/service/core/file-submission.mjs",
  "src/service/core/image-submission.mjs"
]) {
  const submissionSrc = readFileSync(path.join(root, filePath), "utf8");
  assert(submissionSrc.includes("registerArtifact"),
    `${filePath} must call registerArtifact for artifact registration`);
  assert(submissionSrc.includes("appendArtifact"),
    `${filePath} must call appendArtifact after registration`);
}

// metadata-aware registration: both browser and context submission must use
// artifactRegistrationOptionsForPath to preserve tool metadata on artifact records
for (const filePath of [
  "src/service/core/browser-submission.mjs",
  "src/service/core/context-submission.mjs"
]) {
  const submissionSrc = readFileSync(path.join(root, filePath), "utf8");
  assert(submissionSrc.includes("artifactRegistrationOptionsForPath"),
    `${filePath} must use artifactRegistrationOptionsForPath for metadata-aware registration`);
}

if (!process.exitCode) {
  console.log("[artifact-surface] artifact surface snapshot verified.");
}
