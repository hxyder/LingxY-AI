import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../src/service/action_tools/tools/index.mjs";
import { filterToolsForTask } from "../../src/service/executors/tool_using/tool-surface.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";
import { FILE_READ_DEPTHS } from "../../src/service/core/file-read-budget.mjs";
import { createTaskSpec } from "../../src/service/core/task-spec.mjs";

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

test("file_read capability exposes search_file_content to the planner", () => {
  const tools = filterToolsForTask(BUILTIN_ACTION_TOOLS, {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["file_read"]
      }
    }
  });
  assert.ok(tools.some((tool) => tool.id === "search_file_content"));
});

test("file_read capability exposes confirmed index_file_content to the planner", () => {
  const tools = filterToolsForTask(BUILTIN_ACTION_TOOLS, {
    context_packet: {
      semantic_router_decision: {
        needed_capabilities: ["file_read"]
      }
    }
  });
  const tool = tools.find((item) => item.id === "index_file_content");
  assert.ok(tool);
  assert.equal(tool.requires_confirmation, true);
});

test("search_file_content queries the file_content namespace only", async () => {
  const calls = [];
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const result = await registry.call("search_file_content", {
    query: "budget notes",
    limit: 3
  }, {
    runtime: {
      platform: {
        embeddingStore: {
          async search(query, limit, options) {
            calls.push({ query, limit, options });
            return [{
              id: "file_content_1",
              text: "Budget notes from indexed file.",
              score: 0.77,
              metadata: {
                path: "E:\\workspace\\budget.md",
                coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
                artifact_id: "artifact_budget",
                revision_of: null,
                truncated: false
              }
            }];
          }
        }
      }
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.metadata.tool_id, "search_file_content");
  assert.equal(result.metadata.namespace, "file_content");
  assert.equal(result.metadata.result_count, 1);
  assert.equal(result.metadata.results[0].path, "E:\\workspace\\budget.md");
  assert.deepEqual(calls, [{
    query: "budget notes",
    limit: 3,
    options: { namespace: "file_content" }
  }]);
});

test("index_file_content persists prior file-read evidence into file_content namespace", async () => {
  const adds = [];
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const risk = registry.evaluate("index_file_content", {}, {});
  assert.equal(risk.requires_confirmation, true);
  assert.equal(risk.risk_level, "high");

  const result = await registry.call("index_file_content", {
    max_records: 5
  }, {
    task: {
      task_id: "task_index_file_content",
      conversation_id: "conv_index_file_content"
    },
    runtime: {
      platform: {
        embeddingStore: {
          add(record) {
            adds.push(record);
          }
        }
      }
    },
    transcript: [{
      type: "tool_result",
      tool: "read_file_text",
      success: true,
      observation: "Important local file content.",
      metadata: {
        tool_id: "read_file_text",
        path: "E:\\workspace\\notes.md",
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
        content_extracted: true,
        chars_extracted: 29
      }
    }]
  });

  assert.equal(result.success, true);
  assert.equal(result.metadata.tool_id, "index_file_content");
  assert.equal(result.metadata.namespace, "file_content");
  assert.equal(result.metadata.indexed_count, 1);
  assert.equal(adds.length, 1);
  assert.equal(adds[0].namespace, "file_content");
  assert.equal(adds[0].metadata.task_id, "task_index_file_content");
  assert.equal(adds[0].metadata.conversation_id, "conv_index_file_content");
  assert.equal(adds[0].metadata.path, "E:\\workspace\\notes.md");
  assert.equal(adds[0].metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT);
});

test("index_file_content does not read disk or index shallow transcript entries", async () => {
  const adds = [];
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const result = await registry.call("index_file_content", {}, {
    runtime: {
      platform: {
        embeddingStore: {
          add(record) {
            adds.push(record);
          }
        }
      }
    },
    transcript: [{
      type: "tool_result",
      tool: "list_files",
      success: true,
      observation: "notes.md",
      metadata: {
        tool_id: "list_files",
        coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW
      }
    }]
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.indexed_count, 0);
  assert.equal(adds.length, 0);
});

test("index_file_content accepts agentic tool transcript shape", async () => {
  const adds = [];
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const result = await registry.call("index_file_content", {}, {
    runtime: {
      platform: {
        embeddingStore: {
          add(record) {
            adds.push(record);
          }
        }
      }
    },
    transcript: [{
      role: "tool",
      name: "read_folder_text",
      success: true,
      observation: "Folder file A text.\n\nFolder file B text.",
      metadata: {
        tool_id: "read_folder_text",
        path: "E:\\workspace",
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        content_extracted: true,
        recursive: true,
        files: [{ path: "E:\\workspace\\a.md", success: true, chars_extracted: 18 }]
      }
    }]
  });

  assert.equal(result.success, true);
  assert.equal(adds.length, 1);
  assert.equal(adds[0].metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT);
  assert.equal(adds[0].metadata.recursive, true);
});

test("TaskSpec derives deep file_read budget from framework research depth", () => {
  const spec = createTaskSpec("Analyze the attached project materials", {
    file_paths: ["E:\\project"],
    semantic_router_decision: {
      source_scope: "uploaded_files",
      source_mode: "deep_research",
      web_policy: "forbidden",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      research_depth: "deep_research",
      confidence: 0.9,
      reason: "local project context with explicit depth"
    }
  });

  assert.equal(spec.file_read?.depth, FILE_READ_DEPTHS.DEEP);
  assert.equal(spec.file_read.max_depth, 6);
  assert.equal(spec.file_read.max_files, 60);
  assert.ok(spec.decision_trace.some((entry) => entry.stage === "file-read-budget"));
});

test("read_file_text directory delegation consumes task file_read budget when args omit limits", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-read-depth-deep-"));
  try {
    const deepDir = path.join(dir, "a", "b", "c", "d", "e");
    await mkdir(deepDir, { recursive: true });
    await writeFile(path.join(deepDir, "leaf.md"), "Deep nested project finding.", "utf8");

    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_file_text", { path: dir }, {
      task: {
        task_spec: {
          file_read: {
            depth: FILE_READ_DEPTHS.DEEP,
            max_depth: 6,
            max_files: 60,
            max_total_chars: 90000,
            max_chars_per_file: 12000,
            max_chars: 18000
          }
        }
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata.tool_id, "read_folder_text");
    assert.equal(result.metadata.file_read_depth, FILE_READ_DEPTHS.DEEP);
    assert.equal(result.metadata.max_depth, 6);
    assert.match(result.observation, /Deep nested project finding/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit read_folder_text args override task file_read budget", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-read-depth-override-"));
  try {
    await mkdir(path.join(dir, "child"), { recursive: true });
    await writeFile(path.join(dir, "child", "hidden.md"), "Nested text that requires depth.", "utf8");

    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_folder_text", {
      path: dir,
      max_depth: 0,
      max_files: 10,
      max_total_chars: 90000
    }, {
      task: {
        task_spec: {
          file_read: {
            depth: FILE_READ_DEPTHS.DEEP,
            max_depth: 6,
            max_files: 60,
            max_total_chars: 90000,
            max_chars_per_file: 12000,
            max_chars: 18000
          }
        }
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata.max_depth, 0);
    assert.equal(result.metadata.files_read, 0);
    assert.doesNotMatch(result.observation, /Nested text that requires depth/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
