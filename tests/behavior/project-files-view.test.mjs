import test from "node:test";
import assert from "node:assert/strict";

import {
  renderProjectArtifactListHtml
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
