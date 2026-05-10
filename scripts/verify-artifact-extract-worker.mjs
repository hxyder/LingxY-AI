#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// Phase 2F.1: worker/background lane contract verification
// Verifies existing worker infrastructure without changing behavior.

// ── 1. Worker source exists and exports the entry point ──
const workerPath = "src/service/workers/artifact-extract-worker.mjs";
assert(existsSync(path.join(root, workerPath)), `worker source missing: ${workerPath}`);
const workerSrc = read(workerPath);
assert(workerSrc.includes("export async function runArtifactExtractWorker"),
  "artifact-extract-worker must export runArtifactExtractWorker");

// ── 2. Worker protocol: abort signal support ──
assert(workerSrc.includes("assertNotAborted"),
  "worker must check abort signal before each phase");
assert(workerSrc.includes("signal?.aborted"),
  "worker must handle signal.aborted for cancellation");
assert(workerSrc.includes("AbortError"),
  "worker must throw AbortError on cancellation");

// ── 3. Worker protocol: structured result shape ──
assert(workerSrc.includes("parse_status"),
  "worker result must include parse_status in quality field");
assert(workerSrc.includes("summary") && workerSrc.includes("content"),
  "worker result must include summary and content fields");
assert(workerSrc.includes("warnings"),
  "worker result must include warnings array");

// ── 4. Worker protocol: supported kinds ──
assert(workerSrc.includes("SUPPORTED_ARTIFACT_KINDS"),
  "worker must declare SUPPORTED_ARTIFACT_KINDS");
assert(workerSrc.includes("xlsx") && workerSrc.includes("pptx") && workerSrc.includes("docx"),
  "worker must support xlsx, pptx, docx as minimum foundation set");

// ── 5. Worker protocol: progress callback ──
assert(workerSrc.includes("onProgress"),
  "worker must support onProgress callback");

// ── 6. Background lane exists and creates the factory ──
const lanePath = "src/service/core/artifact-extracts/artifact-extract-background-lane.mjs";
assert(existsSync(path.join(root, lanePath)), `lane source missing: ${lanePath}`);
const laneSrc = read(lanePath);
assert(laneSrc.includes("export function createArtifactExtractBackgroundLane"),
  "artifact-extract-background-lane must export createArtifactExtractBackgroundLane");

// ── 7. Lane protocol: timeout + cancellation ──
assert(laneSrc.includes("createTimeoutAbortController"),
  "lane must provide timeout-based abort controller");
assert(laneSrc.includes("DEFAULT_TIMEOUT_MS"),
  "lane must define DEFAULT_TIMEOUT_MS");
assert(laneSrc.includes("DEFAULT_MAX_CONCURRENT"),
  "lane must define DEFAULT_MAX_CONCURRENT for concurrency control");

// ── 8. Lane protocol: structured error handling ──
assert(laneSrc.includes("failureResult"),
  "lane must produce structured failure results");
assert(laneSrc.includes("parse_status") && laneSrc.includes("failed"),
  "lane failure results must include parse_status");

// ── 9. Lane protocol: artifactExtracts integration ──
assert(laneSrc.includes("artifactExtracts.appendExtract"),
  "lane must store results via artifactExtracts.appendExtract");
assert(laneSrc.includes("ARTIFACT_EXTRACT_KINDS.SUMMARY"),
  "lane must tag stored extracts with ARTIFACT_EXTRACT_KINDS");

// ── 10. Lane protocol: queue with concurrency ──
assert(laneSrc.includes("queue") && laneSrc.includes("running"),
  "lane must manage queue and running job sets");

// ── 11. extract service defines ARTIFACT_EXTRACT_KINDS ──
const extractSvcPath = "src/service/core/artifact-extracts/artifact-extract-service.mjs";
const extractSvcSrc = read(extractSvcPath);
assert(extractSvcSrc.includes("ARTIFACT_EXTRACT_KINDS"),
  "artifact-extract-service must export ARTIFACT_EXTRACT_KINDS");

// ── 12. Behavior tests exist for this worker ──
const testPath = "tests/behavior/artifact-extract-background-lane.test.mjs";
assert(existsSync(path.join(root, testPath)),
  `behavior test missing: ${testPath}`);

console.log("[verify-artifact-extract-worker] worker/background lane contracts verified");
