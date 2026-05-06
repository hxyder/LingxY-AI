import test from "node:test";
import assert from "node:assert/strict";

import { __test as visionTest } from "../../src/service/action_tools/tools/vision-analyze.mjs";

test("vision_analyze allows same-task generated image artifacts without allowing arbitrary files", () => {
  const screenshotPath = "E:\\linxiDoc\\task_a\\screen.png";
  const docPath = "E:\\linxiDoc\\task_a\\report.docx";
  const allowlist = visionTest.buildAttachedAllowlist({
    task: {
      context_packet: {
        image_paths: ["E:\\user\\attached.jpg"],
        file_paths: []
      }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "take_screenshot",
        success: true,
        artifact_paths: [screenshotPath]
      },
      {
        type: "tool_result",
        tool: "generate_document",
        success: true,
        artifact_paths: [docPath]
      },
      {
        type: "tool_result",
        tool: "render_svg",
        success: false,
        metadata: { path: "E:\\linxiDoc\\task_a\\failed.png" }
      }
    ]
  });

  assert.ok([...allowlist.values()].includes("E:\\user\\attached.jpg"));
  assert.ok([...allowlist.values()].includes(screenshotPath));
  assert.ok(![...allowlist.values()].includes(docPath));
  assert.ok(![...allowlist.values()].includes("E:\\linxiDoc\\task_a\\failed.png"));
});
