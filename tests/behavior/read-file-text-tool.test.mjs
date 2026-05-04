import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../src/service/action_tools/tools/index.mjs";
import { filterToolsForTask } from "../../src/service/executors/tool_using/tool-surface.mjs";

test("read_file_text extracts text from an attached local file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-read-file-text-"));
  try {
    const filePath = path.join(dir, "resume.md");
    await writeFile(filePath, "# Resume\n\nProductivity tooling and AI workflow design.", "utf8");
    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_file_text", { path: filePath, max_chars: 200 }, {
      task: { context_packet: { file_paths: [filePath] } }
    });
    assert.equal(result.success, true);
    assert.match(result.observation, /Productivity tooling/);
    assert.equal(result.metadata.tool_id, "read_file_text");
    assert.equal(result.metadata.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file_read capability exposes read_file_text to the planner", () => {
  const tools = filterToolsForTask(BUILTIN_ACTION_TOOLS, {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["file_read"]
      }
    }
  });
  assert.ok(tools.some((tool) => tool.id === "read_file_text"));
});

test("read_folder_text recursively extracts bounded text from a folder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-read-folder-text-"));
  try {
    await writeFile(path.join(dir, "overview.md"), "# Overview\n\nAlpha project context.", "utf8");
    await mkdir(path.join(dir, "notes"), { recursive: true });
    await writeFile(path.join(dir, "notes", "plan.txt"), "Beta execution plan.", "utf8");
    await mkdir(path.join(dir, "node_modules", "ignored"), { recursive: true });
    await writeFile(path.join(dir, "node_modules", "ignored", "noise.txt"), "Should not be read.", "utf8");

    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_folder_text", {
      path: dir,
      pattern: "*.{md,txt}",
      max_depth: 3,
      max_files: 10,
      max_total_chars: 5000
    });
    assert.equal(result.success, true);
    assert.match(result.observation, /Alpha project context/);
    assert.match(result.observation, /Beta execution plan/);
    assert.doesNotMatch(result.observation, /Should not be read/);
    assert.equal(result.metadata.tool_id, "read_folder_text");
    assert.equal(result.metadata.files_read, 2);
    assert.equal(result.metadata.truncated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file_read capability exposes read_folder_text to the planner", () => {
  const tools = filterToolsForTask(BUILTIN_ACTION_TOOLS, {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["file_read"]
      }
    }
  });
  assert.ok(tools.some((tool) => tool.id === "read_folder_text"));
});
