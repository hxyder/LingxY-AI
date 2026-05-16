import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldLoadSkillContextForTask,
  summarizeSkillContext
} from "../../src/service/executors/shared/skill-context.mjs";

const skills = [
  { id: "spreadsheet", name: "Spreadsheet", description: "xlsx excel csv openpyxl workflow" },
  { id: "pdf", name: "PDF", description: "pdf extraction and generation workflow" },
  { id: "speech", name: "Speech", description: "audio narration workflow" }
];

test("non-artifact research tasks do not inject the whole local skill library", () => {
  const task = {
    user_command: "Collect current market news and email a summary.",
    task_spec: {
      synthesis: { expected_output: "summary" },
      research_quality: { profile: "multi_source_research" }
    }
  };
  assert.equal(shouldLoadSkillContextForTask(task), false);
  const context = summarizeSkillContext(skills, {
    task,
    limit: 20
  });
  assert.equal(context.active_count, 0);
  assert.deepEqual(context.skills, []);
});

test("artifact tasks keep only matching skill descriptors and workflow hints", () => {
  const task = {
    user_command: "Create an xlsx workbook from this analysis.",
    task_spec: { artifact: { kind: "xlsx" } }
  };
  assert.equal(shouldLoadSkillContextForTask(task), true);
  const context = summarizeSkillContext(skills, {
    task,
    limit: 20
  });
  assert.equal(context.active_count, 1);
  assert.equal(context.skills[0].id, "spreadsheet");
  assert.ok(context.workflow_hints.some((hint) => hint.includes("spreadsheet")));
});

test("attached editable files can load matching skill guidance without broad library injection", () => {
  const task = {
    user_command: "Update this file with the new figures.",
    context_packet: { file_paths: ["E:\\reports\\forecast.xlsx"] },
    task_spec: { artifact: { required: false, kind: null } }
  };
  assert.equal(shouldLoadSkillContextForTask(task), true);
  const context = summarizeSkillContext(skills, { task, limit: 20 });
  assert.equal(context.active_count, 1);
  assert.equal(context.skills[0].id, "spreadsheet");
});
