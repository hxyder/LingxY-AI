import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
