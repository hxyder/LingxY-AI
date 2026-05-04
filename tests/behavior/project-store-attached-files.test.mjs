import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProject,
  mergeProjectStores,
  normalizeProjectAttachedFilePaths,
  normalizeProjectStore,
  setProjectAttachedFilePath
} from "../../src/shared/project-store.mjs";

test("project store normalizes attached file paths on legacy projects", () => {
  const store = normalizeProjectStore({
    currentProjectId: "project_a",
    projects: [
      { id: "project_a", name: "A" },
      {
        id: "project_b",
        name: "B",
        attachedFilePaths: ["", " E:\\docs\\a.md ", 42, "E:\\docs\\a.md", "E:\\docs\\b.md"]
      }
    ],
    conversations: []
  });

  const projectA = store.projects.find((project) => project.id === "project_a");
  const projectB = store.projects.find((project) => project.id === "project_b");
  assert.deepEqual(projectA.attachedFilePaths, []);
  assert.deepEqual(projectB.attachedFilePaths, ["E:\\docs\\a.md", "E:\\docs\\b.md"]);
});

test("project builder and JSON round trip preserve attached file paths", () => {
  const project = buildProject({
    id: "project_docs",
    attachedFilePaths: ["E:\\docs\\brief.md"]
  });
  const roundTrip = normalizeProjectStore(JSON.parse(JSON.stringify({
    projects: [project],
    conversations: [],
    currentProjectId: "project_docs"
  })));
  const saved = roundTrip.projects.find((item) => item.id === "project_docs");
  assert.deepEqual(saved.attachedFilePaths, ["E:\\docs\\brief.md"]);
});

test("mergeProjectStores unions attached file paths regardless of pointer recency", () => {
  const remote = normalizeProjectStore({
    currentProjectId: "project_docs",
    updatedAt: 200,
    projects: [
      { id: "project_docs", name: "Docs", attachedFilePaths: ["E:\\docs\\b.md", "E:\\docs\\c.md"] }
    ],
    conversations: []
  });
  const local = normalizeProjectStore({
    currentProjectId: "project_docs",
    updatedAt: 100,
    projects: [
      { id: "project_docs", name: "Docs local", attachedFilePaths: ["E:\\docs\\a.md", "E:\\docs\\b.md"] }
    ],
    conversations: []
  });

  const merged = mergeProjectStores(local, remote);
  const project = merged.projects.find((item) => item.id === "project_docs");
  assert.deepEqual(project.attachedFilePaths, [
    "E:\\docs\\b.md",
    "E:\\docs\\c.md",
    "E:\\docs\\a.md"
  ]);
});

test("setProjectAttachedFilePath adds and removes idempotently", () => {
  const base = normalizeProjectStore({
    currentProjectId: "project_docs",
    projects: [{ id: "project_docs", name: "Docs" }],
    conversations: []
  });

  const added = setProjectAttachedFilePath(base, "project_docs", "E:\\docs\\a.md", true);
  const addedTwice = setProjectAttachedFilePath(added, "project_docs", "E:\\docs\\a.md", true);
  const removed = setProjectAttachedFilePath(addedTwice, "project_docs", "E:\\docs\\a.md", false);
  const unknown = setProjectAttachedFilePath(removed, "missing", "E:\\docs\\x.md", true);

  assert.deepEqual(added.projects.find((project) => project.id === "project_docs").attachedFilePaths, ["E:\\docs\\a.md"]);
  assert.deepEqual(addedTwice.projects.find((project) => project.id === "project_docs").attachedFilePaths, ["E:\\docs\\a.md"]);
  assert.deepEqual(removed.projects.find((project) => project.id === "project_docs").attachedFilePaths, []);
  assert.deepEqual(unknown.projects.find((project) => project.id === "project_docs").attachedFilePaths, []);
});

test("normalizeProjectAttachedFilePaths is a small pure sanitizer", () => {
  assert.deepEqual(
    normalizeProjectAttachedFilePaths([" a ", "a", null, "b"]),
    ["a", "b"]
  );
});
