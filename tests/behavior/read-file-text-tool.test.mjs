import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../src/service/action_tools/tools/index.mjs";
import { filterToolsForTask } from "../../src/service/executors/tool_using/tool-surface.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";

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
    assert.equal(result.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT);
    assert.equal(result.metadata.content_extracted, true);
    assert.equal(result.metadata.recursive, false);
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
    assert.equal(result.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT);
    assert.equal(result.metadata.content_extracted, true);
    assert.equal(result.metadata.recursive, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read_file_text delegates directory paths to recursive folder extraction", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-read-file-directory-"));
  try {
    await writeFile(path.join(dir, "root.md"), "Root folder brief.", "utf8");
    await mkdir(path.join(dir, "deep"), { recursive: true });
    await writeFile(path.join(dir, "deep", "details.txt"), "Nested implementation details.", "utf8");

    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_file_text", {
      path: dir,
      max_chars: 2000,
      max_depth: 3
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata.tool_id, "read_folder_text");
    assert.equal(result.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT);
    assert.match(result.observation, /Root folder brief/);
    assert.match(result.observation, /Nested implementation details/);
    assert.equal(result.metadata.files_read, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file enumeration tools mark shallow coverage without claiming content extraction", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-file-coverage-"));
  try {
    await writeFile(path.join(dir, "one.md"), "One", "utf8");
    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);

    const listed = await registry.call("list_files", { dir, limit: 5 });
    assert.equal(listed.success, true);
    assert.equal(listed.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW);
    assert.equal(listed.metadata.content_extracted, false);
    assert.equal(listed.metadata.recursive, false);

    const globbed = await registry.call("glob_files", { pattern: path.join(dir, "**", "*.md") });
    assert.equal(globbed.success, true);
    assert.equal(globbed.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE);
    assert.equal(globbed.metadata.content_extracted, false);
    assert.equal(globbed.metadata.recursive, true);
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
