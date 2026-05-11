#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[vision-analyze] ${message}`);
  process.exitCode = 1;
}

// CAP-1 vision-analyze ownership verifier.
// Locks the post-move owner and no-touch contracts. Runtime/provider execution
// coverage lives in verify-vision-analyze-runtime.mjs.

// 1. Tool exists in BUILTIN_ACTION_TOOLS with correct id
const visionTool = BUILTIN_ACTION_TOOLS.find(t => t.id === "vision_analyze");
assert(visionTool, "BUILTIN_ACTION_TOOLS must include vision_analyze");
assert(visionTool.risk_level === "low", "vision_analyze risk_level must be low");
assert(visionTool.requires_confirmation === false, "vision_analyze must not require confirmation");

// 2. Current owner file exists
const currentPath = "src/service/capabilities/tools/vision-analyze.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);
assert(!existsSync(path.join(root, "src/service/action_tools/tools/vision-analyze.mjs")),
  "old action_tools vision-analyze owner must not exist after CAP-1 move");

// 3. Current owner exports VISION_ANALYZE_TOOL
const visionSrc = read(currentPath);
assert(visionSrc.includes("export const VISION_ANALYZE_TOOL"),
  "vision-analyze.mjs must export VISION_ANALYZE_TOOL");

// 4. No-touch contracts
assert(visionSrc.includes("image_paths") || visionSrc.includes("imagePaths"),
  "vision_analyze must accept image_paths parameter");
assert(visionSrc.includes("buildAttachedAllowlist"),
  "vision_analyze must enforce security allowlist on image paths");
assert(visionSrc.includes("MAX_IMAGES_PER_CALL"),
  "vision_analyze must limit images per call");
assert(visionSrc.includes("resolveProviderForTask"),
  "vision_analyze must use resolveProviderForTask for provider routing");
// Provider routing: calls through callAnthropicVision / callOpenAIVision
assert(visionSrc.includes("callAnthropicVision") || visionSrc.includes("callOpenAIVision"),
  "vision_analyze must use Vision-specific provider APIs");
// Schema reference
assert(visionSrc.includes("ACTION_TOOL_SCHEMAS.vision_analyze") ||
  visionSrc.includes('id: "vision_analyze"'),
  "vision_analyze must reference its schema");

// 5. Boundary doc must document the moved status
const boundaryDocPath = "docs/architecture/vision-analyze-boundary.md";
assert(existsSync(path.join(root, boundaryDocPath)), "vision-analyze boundary doc missing");
const boundaryDoc = read(boundaryDocPath);
assert(boundaryDoc.includes("moved to `src/service/capabilities/tools/vision-analyze.mjs`"),
  "boundary doc must state the current moved owner");

// 6. Provider boundary verifier must cover this tool
const providerVerifierSrc = read("scripts/verify-provider-boundary.mjs");
assert(providerVerifierSrc.includes("vision-analyze"),
  "provider boundary verifier must include vision-analyze in approved callers");

if (!process.exitCode) {
  console.log("[vision-analyze] contract verified");
}
