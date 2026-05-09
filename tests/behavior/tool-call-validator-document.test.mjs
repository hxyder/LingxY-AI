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

test("generate_document validation rejects fake download text for non-xlsx artifacts", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "docx",
    outline: {
      title: "Report",
      sections: [{
        heading: "Download",
        body: "我已经为你生成了 Word 文件，你可以通过 sandbox:/mnt/data/result.docx 下载。"
      }]
    }
  }, {
    task: {
      user_command: "生成 Word 报告",
      task_spec: {
        artifact: { required: true, kind: "docx" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /fake download|fake_artifact_text|sandbox/i);
});

test("generate_document validation rejects long single-slide pptx prose dumps", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "pptx",
    outline: {
      title: "Status Deck",
      slides: [{
        heading: "Everything",
        body: "这不是一页真正的演示文稿，而是一整段没有拆分的长文本。".repeat(40)
      }]
    }
  }, {
    task: {
      user_command: "生成 PPT",
      task_spec: {
        artifact: { required: true, kind: "pptx" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /presentation prose|multiple slides|presentation_prose_dump/i);
});

test("generate_document validation rejects prose dumped into a generic xlsx Content column", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "xlsx",
    outline: {
      headers: ["Content"],
      rows: [[
        "好的，我已经为你生成了一个 Excel 文件。你可以通过 sandbox:/mnt/data/result.xlsx 下载。这里还有一段很长的说明文字，而不是实际表格单元格。"
      ]]
    }
  }, {
    task: {
      user_command: "生成 Excel 报表",
      task_spec: {
        artifact: { required: true, kind: "xlsx" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /generic_content_dump|markdown\/download prose|real spreadsheet cells/i);
});

test("generate_document validation rejects long generic single-column xlsx prose", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "xlsx",
    outline: {
      headers: ["Content"],
      rows: [[
        "这不是一个电子表格，而是一段很长的叙述性回答。它解释了应该如何创建 Excel、应该有哪些列、应该如何下载或查看文件，但没有提供任何可计算、可筛选、可编辑的真实单元格结构。这样的内容如果被写进单列工作表，会让用户打开 Excel 后只看到一大段文字。"
      ]]
    }
  }, {
    task: {
      user_command: "生成 Excel 报表",
      task_spec: {
        artifact: { required: true, kind: "xlsx" }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /generic Content column|generic_content_dump|real spreadsheet cells/i);
});

test("generate_document validation accepts structured xlsx outlines", () => {
  const result = validateToolCall(generateDocumentTool, {
    kind: "xlsx",
    outline: {
      title: "Market report",
      headers: ["Date", "Index", "Close", "Change"],
      rows: [
        ["2026-05-04", "S&P 500", 5260.3, "0.4%"],
        ["2026-05-05", "Nasdaq", 16720.1, "-0.2%"]
      ]
    }
  }, {
    task: {
      user_command: "生成 Excel 报表",
      task_spec: {
        artifact: { required: true, kind: "xlsx" }
      }
    }
  });

  assert.equal(result.ok, true);
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
