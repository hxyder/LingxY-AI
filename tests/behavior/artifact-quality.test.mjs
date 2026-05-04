import test from "node:test";
import assert from "node:assert/strict";

import {
  artifactQualityRequirements,
  evaluateDocumentOutlineQuality,
  inspectDocumentOutline
} from "../../src/service/core/artifact-quality.mjs";

test("artifact quality inspection counts structure without reading topic domains", () => {
  const metrics = inspectDocumentOutline({
    title: "Guide",
    sections: [
      {
        heading: "Flow",
        body: "```mermaid\nflowchart TD\nA --> B\n```"
      },
      {
        heading: "Table",
        bullets: ["One", "Two"],
        table: { headers: ["A"], rows: [["B"]] },
        svg: "<svg viewBox=\"0 0 10 10\"></svg>"
      }
    ]
  });

  assert.equal(metrics.title, "Guide");
  assert.equal(metrics.sectionCount, 2);
  assert.equal(metrics.tableCount, 1);
  assert.equal(metrics.mermaidCount, 1);
  assert.equal(metrics.svgCount, 1);
  assert.equal(metrics.bulletCount, 2);
});

test("artifact quality only enforces rich rules for rich artifact requests", () => {
  assert.equal(artifactQualityRequirements({
    kind: "pdf",
    task: {
      user_command: "写一份请假条 PDF",
      task_spec: { artifact: { required: true, kind: "pdf" } }
    }
  }).enforce, false);

  assert.equal(artifactQualityRequirements({
    kind: "pdf",
    task: {
      user_command: "调研公开资料，生成 PDF",
      task_spec: {
        artifact: { required: true, kind: "pdf" },
        research_quality: { profile: "multi_source_research" }
      }
    }
  }).enforce, true);
});

test("artifact quality rejects thin research artifact outlines", () => {
  const result = evaluateDocumentOutlineQuality({
    kind: "pdf",
    outline: {
      title: "Research Guide",
      sections: [{ heading: "Overview", body: "Too short." }]
    },
    task: {
      user_command: "调研公开资料，生成 PDF",
      task_spec: {
        artifact: { required: true, kind: "pdf" },
        research_quality: { profile: "multi_source_research" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("too_few_sections"));
});

test("artifact quality accepts rich research outlines with table and Mermaid", () => {
  const result = evaluateDocumentOutlineQuality({
    kind: "pdf",
    outline: {
      title: "Research Guide",
      sections: [
        {
          heading: "Architecture",
          body: "```mermaid\nflowchart TD\nA[User] --> B[Planner]\nB --> C[Tools]\n```"
        },
        {
          heading: "Implementation Layers",
          body: "A detailed section that explains planning, memory, tool execution, observation handling, artifact writing, evaluation, recovery, and user review. ".repeat(5),
          table: {
            headers: ["Layer", "Responsibility"],
            rows: [["Planner", "Plan steps"], ["Tools", "Act"], ["Evaluator", "Check quality"]]
          }
        }
      ]
    },
    task: {
      user_command: "调研公开资料，生成 PDF",
      task_spec: {
        artifact: { required: true, kind: "pdf" },
        research_quality: { profile: "multi_source_research" }
      }
    }
  });

  assert.equal(result.ok, true);
});
