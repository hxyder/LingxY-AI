import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicArtifactPlan } from "../../src/service/executors/shared/deterministic-artifact-plan.mjs";

test("explicit html filename recovery writes raw html with requested literals", () => {
  const marker = "LXHTML-MP8HCSELM0CK1";
  const targetPath = String.raw`E:\linxiDoc\followup_artifact_seed_mp8hcselm0ck1.html`;
  const plan = buildDeterministicArtifactPlan({
    task: {
      user_command: `生成一个 HTML 文件，文件名 followup_artifact_seed_mp8hcselm0ck1.html，title 和正文都必须包含 ${marker}。必须保存为真实文件，不要只在回复里给代码。`
    },
    taskSpec: {
      artifact: { required: true, kind: "html" },
      success_contract: { artifact_created: true }
    },
    finalText: "这次任务没有可靠完成，我不会把候选答案当作完成结果。",
    transcript: [
      {
        type: "tool_result",
        tool: "resolve_output_path",
        success: true,
        metadata: { path: targetPath },
        observation: `Resolved output path: ${targetPath}`
      }
    ]
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.toolId, "write_file");
  assert.equal(plan.args.path, targetPath);
  assert.equal(plan.args.overwrite, true);
  assert.match(plan.args.content, new RegExp(`<title>${marker}</title>`));
  assert.match(plan.args.content, new RegExp(`<p>${marker}</p>`));
  assert.doesNotMatch(plan.args.content, /没有可靠完成/u);
});

test("rendered html documents without explicit filenames still use generate_document", () => {
  const plan = buildDeterministicArtifactPlan({
    task: { user_command: "生成一个 HTML 报告，总结本周项目进展。" },
    taskSpec: {
      artifact: { required: true, kind: "html" },
      success_contract: { artifact_created: true }
    },
    finalText: "项目整体进展稳定。"
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.toolId, "generate_document");
  assert.equal(plan.args.kind, "html");
});
