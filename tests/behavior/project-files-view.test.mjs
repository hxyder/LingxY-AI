import test from "node:test";
import assert from "node:assert/strict";

import {
  renderProjectArtifactListHtml,
  renderProjectWorkspaceSummaryHtml
} from "../../src/desktop/renderer/console-projects-view.mjs";

test("project files view renders durable attached files separately from generated artifacts", () => {
  const html = renderProjectArtifactListHtml({
    attachedFilePaths: ["E:\\project\\brief.md"],
    projectId: "project_docs",
    artifacts: [
      {
        path: "E:\\project\\report.docx",
        status: "success",
        conversation_title: "Report task",
        created_at: "2026-05-04T12:00:00.000Z"
      }
    ],
    labelForPath: (path) => path.split("\\").pop()
  });

  assert.match(html, /Project files/);
  assert.match(html, /Generated files/);
  assert.match(html, /brief\.md/);
  assert.match(html, /Attached project file/);
  assert.match(html, /Project scope/);
  assert.match(html, /data-project-file-detach="E:\\project\\brief\.md"/);
  assert.match(html, /data-project-file-detach-project-id="project_docs"/);
  assert.match(html, /report\.docx/);
  assert.match(html, /Report task/);
});

test("project files view treats attached paths as openable local files", () => {
  const html = renderProjectArtifactListHtml({
    attachedFilePaths: ["E:\\project\\brief.md"],
    projectId: "project_docs",
    artifacts: [],
    labelForPath: (path) => path
  });

  assert.match(html, /data-project-artifact-open="E:\\project\\brief\.md"/);
  assert.match(html, /data-project-artifact-reveal="E:\\project\\brief\.md"/);
  assert.doesNotMatch(html, /Generated files/);
});

test("project workspace summary renders project-owned chats files and generated counts", () => {
  const html = renderProjectWorkspaceSummaryHtml({
    project: {
      id: "project_docs",
      name: "Docs",
      color: "#1f766e",
      metadata: { instructions: "Use the project brief before drafting." }
    },
    workspace: {
      stats: {
        conversation_count: 3,
        file_count: 2,
        artifact_count: 1,
        updated_at: "2026-05-12T12:00:00.000Z"
      }
    },
    status: "ready"
  });

  assert.match(html, /Docs/);
  assert.match(html, /Project chat/);
  assert.match(html, /Use the project brief before drafting\./);
  assert.match(html, /Chats/);
  assert.match(html, />3</);
  assert.match(html, /Files/);
  assert.match(html, />2</);
  assert.match(html, /Generated/);
  assert.match(html, />1</);
});

test("project files view can render service-owned project file records", () => {
  const html = renderProjectArtifactListHtml({
    attachedFilePaths: [{
      path: "E:\\project\\knowledge.pdf",
      status: "indexed",
      indexed_at: "2026-05-12T12:00:00.000Z"
    }],
    projectId: "project_docs",
    artifacts: [],
    labelForPath: (path) => path.split("\\").pop()
  });

  assert.match(html, /knowledge\.pdf/);
  assert.match(html, /indexed/);
  assert.match(html, /data-project-file-reindex="E:\\project\\knowledge\.pdf"/);
});
