#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VISION_ANALYZE_TOOL, __test } from "../src/service/action_tools/tools/vision-analyze.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(`[vision-analyze-runtime] ${message}`);
  process.exitCode = 1;
}

// CAP-1 vision-analyze runtime preflight
// Uses the test seam (__test) to verify security allowlist and rejection
// paths without making real provider calls.
// Provider stubbing for full execute() flow is deferred.

const { buildAttachedAllowlist, collectGeneratedImageArtifacts } = __test;

// ── 1. allowlist: attached image path is accepted ──
{
  const ctx = {
    task: {
      context_packet: {
        image_paths: ["C:\\Users\\test\\photo.png"]
      }
    }
  };
  const allowed = buildAttachedAllowlist(ctx);
  assert(allowed.size > 0, "allowlist must accept attached image_paths");
  // The key is lowercased resolved path
  const keys = [...allowed.keys()];
  assert(keys.some(k => k.includes("photo.png")),
    "allowlist must contain the attached image path");
}

// ── 2. allowlist: unattached path is NOT accepted ──
{
  const ctx = {
    task: {
      context_packet: {
        image_paths: ["C:\\Users\\test\\photo.png"]
      }
    }
  };
  const allowed = buildAttachedAllowlist(ctx);
  const unattachedKey = path.resolve("C:\\Users\\hacker\\stolen.png").toLowerCase();
  assert(!allowed.has(unattachedKey),
    "allowlist must reject unattached paths");
}

// ── 3. allowlist: file_paths also accepted ──
{
  const ctx = {
    task: {
      context_packet: {
        file_paths: ["C:\\Users\\test\\doc.pdf", "C:\\Users\\test\\img.jpg"]
      }
    }
  };
  const allowed = buildAttachedAllowlist(ctx);
  assert(allowed.size >= 1, "allowlist must accept file_paths");
}

// ── 4. execute: rejects empty image_paths ──
{
  const result = await VISION_ANALYZE_TOOL.execute({ prompt: "test" }, {});
  assert(result.success === false, "execute must reject empty image_paths");
  assert(result.observation.includes("image_paths"),
    "rejection message must mention image_paths");
}

// ── 5. execute: rejects unattached paths (before file read/provider upload) ──
{
  const ctx = {
    task: {
      context_packet: {
        image_paths: ["C:\\Users\\test\\photo.png"]
      }
    }
  };
  const result = await VISION_ANALYZE_TOOL.execute(
    { image_paths: ["C:\\Users\\hacker\\stolen.png"], prompt: "test" },
    ctx
  );
  assert(result.success === false, "execute must reject unattached paths");
  assert(result.observation && !result.observation.includes("describe"),
    "rejection must not be a Vision provider response");
}

// ── 6. collectGeneratedImageArtifacts: empty transcript → no images ──
{
  const artifacts = collectGeneratedImageArtifacts([]);
  assert(artifacts.length === 0, "empty transcript must produce no artifacts");
}

// ── 7. collectGeneratedImageArtifacts: generated image artifact is collected ──
{
  const artifacts = collectGeneratedImageArtifacts([
    { success: true, tool: "take_screenshot", artifact_paths: ["C:\\output\\screen.png"] }
  ]);
  assert(artifacts.length === 1, "generated screenshot must be collected");
  assert(artifacts[0].endsWith("screen.png"), "collected path must match");
}

if (!process.exitCode) {
  console.log("[vision-analyze-runtime] security allowlist and rejection paths verified");
}
