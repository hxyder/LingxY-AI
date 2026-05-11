#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { VISION_ANALYZE_TOOL, __test } from "../src/service/capabilities/tools/vision-analyze.mjs";

// CAP-1 vision-analyze runtime rejection-path preflight.
// Uses the test seam (__test) to verify security allowlist and rejection
// paths without making real provider calls.
// The successful execute() path uses ctx._testSeam; provider branch selection
// is verified through __test.callVisionProvider with injected vision clients.

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
    assert.fail("callVisionProvider must throw when provider is null");
  } catch (e) {
    assert(e.message.includes("No Vision-capable provider configured"),
      "no-provider error must be informative");
  }
}

// 9. code_cli provider → refused
{
  try {
    await callVisionProvider({ provider: { kind: "code_cli", id: "test-cli", providerName: "TestCLI" }, prompt: "t", images: [], signal: null });
    assert.fail("callVisionProvider must refuse code_cli");
  } catch (e) {
    assert(e.message.includes("code_cli"),
      "code_cli refusal must mention code_cli");
  }
}

// 10. supportsVision:false → refused
{
  try {
    await callVisionProvider({ provider: { kind: "openai", id: "test", supportsVision: false, providerName: "NoVision" }, prompt: "t", images: [], signal: null });
    assert.fail("callVisionProvider must refuse supportsVision:false");
  } catch (e) {
    assert(e.message.includes("supportsVision"),
      "supportsVision:false refusal must mention supportsVision");
  }
}

// 11. ollama provider → refused
{
  try {
    await callVisionProvider({ provider: { kind: "ollama", id: "ollama-test", providerName: "OllamaTest" }, prompt: "t", images: [], signal: null });
    assert.fail("callVisionProvider must refuse ollama");
  } catch (e) {
    assert(e.message.includes("Ollama"),
      "ollama refusal must mention Ollama");
  }
}

// ── 12-13. Provider branch selection (injected clients, no network) ──
{
  let anthropicCalls = 0;
  let openAiCalls = 0;
  const result = await callVisionProvider({
    provider: { id: "anthropic", kind: "anthropic", providerName: "Anthropic", model: "claude-test" },
    prompt: "describe",
    images: [{ mimeType: "image/png", data: "stub" }],
    signal: null
  }, {
    callAnthropicVision: async ({ providerName, model, images }) => {
      anthropicCalls += 1;
      assert.equal(model, "claude-test", "Anthropic branch must pass model");
      assert.equal(images.length, 1, "Anthropic branch must pass images");
      return `anthropic ok ${providerName ?? ""}`.trim();
    },
    callOpenAIVision: async () => {
      openAiCalls += 1;
      throw new Error("OpenAI branch must not be used for Anthropic provider");
    }
  });
  assert.equal(result, "anthropic ok", "Anthropic branch must return injected client result");
  assert.equal(anthropicCalls, 1, "Anthropic branch must call Anthropic client once");
  assert.equal(openAiCalls, 0, "Anthropic branch must not call OpenAI client");
}

{
  let anthropicCalls = 0;
  let openAiCalls = 0;
  const result = await callVisionProvider({
    provider: { id: "openai-compatible", kind: "openai", providerName: "OpenAICompat", model: "gpt-vision-test" },
    prompt: "describe",
    images: [{ mimeType: "image/png", data: "stub" }],
    signal: null
  }, {
    callAnthropicVision: async () => {
      anthropicCalls += 1;
      throw new Error("Anthropic branch must not be used for OpenAI-compatible provider");
    },
    callOpenAIVision: async ({ model, images }) => {
      openAiCalls += 1;
      assert.equal(model, "gpt-vision-test", "OpenAI branch must pass model");
      assert.equal(images.length, 1, "OpenAI branch must pass images");
      return "openai ok";
    }
  });
  assert.equal(result, "openai ok", "OpenAI branch must return injected client result");
  assert.equal(openAiCalls, 1, "OpenAI branch must call OpenAI client once");
  assert.equal(anthropicCalls, 0, "OpenAI branch must not call Anthropic client");
}

// ── 14. Successful execute path (stubbed via ctx._testSeam) ──
{
  const ctx = {
    task: {
      context_packet: {
        image_paths: ["C:\\Users\\test\\photo.png"]
      }
    },
    _testSeam: {
      resolveProvider: (_taskType) => ({
        id: "anthropic",
        kind: "anthropic",
        providerName: "TestAnthropic",
        model: "claude-test",
        apiKey: "sk-test",
        baseUrl: "https://test.example.com"
      }),
      loadImage: async (_p) => ({ mimeType: "image/png", data: "base64stub" }),
      callVision: async ({ provider, prompt, images }) =>
        `Vision analysis: ${images.length} image(s) processed by ${provider.providerName} using ${provider.model}`
    }
  };
  const result = await VISION_ANALYZE_TOOL.execute(
    { image_paths: ["C:\\Users\\test\\photo.png"], prompt: "describe" },
    ctx
  );
  assert(result.success === true,
    "stubbed execute must return success for accepted attached path");
  assert(result.metadata?.provider === "TestAnthropic",
    "success metadata must include provider name");
  assert(result.metadata?.model === "claude-test",
    "success metadata must include model");
  assert(result.metadata?.image_count === 1,
    "success metadata must include image count");
  assert.deepEqual(result.metadata?.image_paths, ["C:\\Users\\test\\photo.png"],
    "success metadata must include accepted image paths");
  assert(result.observation.includes("TestAnthropic"),
    "success observation must reference the provider");
}

if (!process.exitCode) {
  console.log("[vision-analyze-runtime] security allowlist, rejection paths, provider gates, provider branch selection, and stubbed success path verified");
}
