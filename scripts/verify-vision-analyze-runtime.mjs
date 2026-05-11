#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { VISION_ANALYZE_TOOL, __test } from "../src/service/action_tools/tools/vision-analyze.mjs";

// CAP-1 vision-analyze runtime rejection-path preflight.
// Uses the test seam (__test) to verify security allowlist and rejection
// paths without making real provider calls.
// This is necessary but not sufficient for the physical move: provider stubbing
// for the full successful execute() flow is still required.

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
  assert.deepEqual(result.metadata?.rejected_image_paths, ["C:\\Users\\hacker\\stolen.png"],
    "rejection metadata must include the unattached path");
  assert.deepEqual(result.metadata?.accepted_image_paths, [],
    "rejection metadata must not accept any unattached path");
  assert(!result.observation.includes("Failed to read image"),
    "rejection must happen before filesystem image read");
  assert(!result.observation.includes("vision_analyze failed"),
    "rejection must happen before provider upload/call");
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

// ── 8-11. Provider gates (tested via __test.callVisionProvider seam) ──
const { callVisionProvider } = __test;

// 8. No provider → informative error
{
  try {
    await callVisionProvider({ provider: null, prompt: "test", images: [], signal: null });
    fail("callVisionProvider must throw when provider is null");
  } catch (e) {
    assert(e.message.includes("No Vision-capable provider configured"),
      "no-provider error must be informative");
  }
}

// 9. code_cli provider → refused
{
  try {
    await callVisionProvider({ provider: { kind: "code_cli", id: "test-cli", providerName: "TestCLI" }, prompt: "t", images: [], signal: null });
    fail("callVisionProvider must refuse code_cli");
  } catch (e) {
    assert(e.message.includes("code_cli"),
      "code_cli refusal must mention code_cli");
  }
}

// 10. supportsVision:false → refused
{
  try {
    await callVisionProvider({ provider: { kind: "openai", id: "test", supportsVision: false, providerName: "NoVision" }, prompt: "t", images: [], signal: null });
    fail("callVisionProvider must refuse supportsVision:false");
  } catch (e) {
    assert(e.message.includes("supportsVision"),
      "supportsVision:false refusal must mention supportsVision");
  }
}

// 11. ollama provider → refused
{
  try {
    await callVisionProvider({ provider: { kind: "ollama", id: "ollama-test", providerName: "OllamaTest" }, prompt: "t", images: [], signal: null });
    fail("callVisionProvider must refuse ollama");
  } catch (e) {
    assert(e.message.includes("Ollama"),
      "ollama refusal must mention Ollama");
  }
}

if (!process.exitCode) {
  console.log("[vision-analyze-runtime] security allowlist, rejection paths, and provider gates verified");
}
