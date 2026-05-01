import assert from "node:assert/strict";
import test from "node:test";

import {
  createLaunchAmbiguityResult,
  normalizeLaunchCandidates
} from "../../src/service/action_tools/tools/index.mjs";

const RAW_CANDIDATES = Object.freeze([
  {
    app_id: "alpha.desktop",
    display_name: "Alpha Desktop",
    exe_path: "C:\\Apps\\Alpha\\alpha.exe",
    is_dev_tool: false,
    score: 0.91,
    reason: "exact"
  },
  {
    app_id: "alpha.tools",
    display_name: "Alpha Tools",
    exe_path: "C:\\Apps\\AlphaTools\\alpha-tools.exe",
    is_dev_tool: true,
    score: 0.88,
    reason: "fuzzy"
  }
]);

test("launch candidates are normalized into stable disambiguation records", () => {
  const candidates = normalizeLaunchCandidates(RAW_CANDIDATES);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].index, 1);
  assert.match(candidates[0].candidate_id, /^[a-f0-9]{12}$/);
  assert.equal(candidates[0].display_name, "Alpha Desktop");
  assert.equal(candidates[0].exe_path, "C:\\Apps\\Alpha\\alpha.exe");
  assert.deepEqual(candidates[0].launch_args, { app: "C:\\Apps\\Alpha\\alpha.exe" });
  assert.equal(candidates[1].is_dev_tool, true);
});

test("launch ambiguity result exposes metadata, not just prose", () => {
  const result = createLaunchAmbiguityResult("Alpha", RAW_CANDIDATES, {
    method: "python_launcher",
    decision_reason: "ambiguous"
  });

  assert.equal(result.success, false);
  assert.equal(result.metadata.action, "ambiguous");
  assert.equal(result.metadata.disambiguation_required, true);
  assert.equal(result.metadata.disambiguation_type, "launch_app_candidate");
  assert.equal(result.metadata.target_app, "Alpha");
  assert.equal(result.metadata.candidate_count, 2);
  assert.equal(result.metadata.next_tool, "launch_app");
  assert.equal(result.metadata.selected_candidate, undefined);
  assert.deepEqual(result.metadata.candidates[0].launch_args, {
    app: "C:\\Apps\\Alpha\\alpha.exe"
  });
  assert.match(result.observation, /多个可能的匹配|multiple/i);
});
