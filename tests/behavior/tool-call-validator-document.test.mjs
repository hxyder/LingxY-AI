import test from "node:test";
import assert from "node:assert/strict";

import { validateToolCall } from "../../src/service/executors/tool_using/tool-call-validator.mjs";

const generateDocumentTool = {
  id: "generate_document",
  parameters: {
    type: "object",
    required: ["kind", "outline"],
    properties: {
      kind: { type: "string" },
      outline: {},
      filename: { type: "string" },
      path: { type: "string" }
    }
  }
};

const editFileTool = {
  id: "edit_file",
  parameters: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" },
      kind: { type: "string" },
      outline: {},
      content: { type: "string" },
      text: { type: "string" }
    }
  }
};

const renderDiagramTool = {
  id: "render_diagram",
  parameters: {
    type: "object",
    required: ["code"],
    properties: {
      code: { type: "string" },
      filename: { type: "string" }
    }
  }
};

const renderSvgTool = {
  id: "render_svg",
  parameters: {
    type: "object",
    required: ["svg"],
    properties: {
      svg: { type: "string" },
      filename: { type: "string" }
    }
  }
};

test("generate_document validation rejects empty outlines before execution", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "pdf",
    outline: {}
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /outline_required/);
});

test("generate_document validation accepts structured rich outlines", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "pdf",
    outline: {
      title: "Research map",
      sections: [
        {
          heading: "Architecture",
          body: "```mermaid\nflowchart TD\nA[Plan] --> B[Act]\n```"
        },
        {
          heading: "Framework comparison",
          table: {
            headers: ["Framework", "Use case"],
            rows: [["LangGraph", "Stateful control"]]
          }
        }
      ]
    }
  });

  assert.equal(result.ok, true);
});

test("generate_document validation accepts html document kind", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "html",
    outline: {
      title: "Interactive Report",
      sections: [{ heading: "Summary", body: "A standalone HTML report." }]
    }
  });

  assert.equal(result.ok, true);
});

test("generate_document validation asks the planner to enrich thin research artifacts", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "pdf",
    outline: {
      title: "Research Guide",
      sections: [{ heading: "Overview", body: "Too short." }]
    }
  }, {
    task: {
      user_command: "调研公开资料，生成 PDF",
      task_spec: {
        artifact: { required: true, kind: "pdf" },
        research_quality: { profile: "multi_source_research" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /outline_quality_failed/);
});

test("edit_file validation applies artifact quality to existing document updates", () => {
  const result = validateToolCall(editFileTool, {
    path: "E:/linxiDoc/task/report.html",
    kind: "html",
    outline: {
      title: "Research Guide",
      sections: [{ heading: "Overview", body: "Too short." }]
    }
  }, {
    task: {
      user_command: "把刚才的调研报告改丰富一点",
      task_spec: {
        artifact: { required: true, kind: "html" },
        research_quality: { profile: "multi_source_research" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /edit_file_outline_quality_failed/);
});

test("render_diagram validation rejects empty diagram source before execution", () => {
  const result = validateToolCall(renderDiagramTool, { code: "   " });

  assert.equal(result.ok, false);
  assert.match(result.error, /code_required/);
});

test("render_svg validation rejects unsafe or missing vector markup before execution", () => {
  const result = validateToolCall(renderSvgTool, { svg: "not svg" });

  assert.equal(result.ok, false);
  assert.match(result.error, /markup_required/);
});
