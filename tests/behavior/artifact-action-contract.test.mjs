import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  artifactActionForTool,
  artifactEventFieldsForToolResult,
  artifactMetadataEntriesFromToolEvent,
  artifactRegistrationOptionsForPath,
  artifactSourceForTool,
  normalizeArtifactSource,
  rememberArtifactMetadataFromToolEvent
} from "../../src/service/core/artifact-action-contract.mjs";
import { createArtifactStore } from "../../src/service/store/artifact-store.mjs";

test("artifact action contract classifies create and update tools without task-topic rules", () => {
  assert.equal(artifactActionForTool("generate_document"), "create_new");
  assert.equal(artifactActionForTool("write_file"), "create_new");
  assert.equal(artifactActionForTool("render_svg"), "create_new");
  assert.equal(artifactActionForTool("edit_file"), "update_existing");
  assert.equal(artifactActionForTool("web_search"), null);
  assert.equal(artifactSourceForTool("generate_document"), "generated");
  assert.equal(artifactSourceForTool("edit_file"), "edited");
  assert.equal(normalizeArtifactSource("edited"), "edited");
  assert.equal(normalizeArtifactSource("not-a-contract-source"), null);
});

test("tool completion events carry artifact action metadata when a file tool returns paths", () => {
  assert.deepEqual(
    artifactEventFieldsForToolResult("edit_file", {
      artifact_paths: ["E:\\docs\\draft.md", ""]
    }),
    {
      artifact_paths: ["E:\\docs\\draft.md"],
      artifact_action: "update_existing",
      artifact_source: "edited"
    }
  );
  assert.deepEqual(
    artifactEventFieldsForToolResult("web_search", {
      artifact_paths: ["E:\\docs\\search.md"]
    }),
    {
      artifact_paths: ["E:\\docs\\search.md"]
    }
  );
});

test("submission layers can remember artifact source from tool events and apply it at registration time", () => {
  const metadataByPath = new Map();
  rememberArtifactMetadataFromToolEvent(metadataByPath, {
    artifact_paths: ["E:\\docs\\draft.md"],
    artifact_action: "update_existing"
  });
  assert.deepEqual(
    artifactMetadataEntriesFromToolEvent({
      artifact_paths: ["E:\\docs\\draft.md"],
      artifact_source: "edited"
    }),
    [{ path: "E:\\docs\\draft.md", source: "edited" }]
  );
  assert.deepEqual(
    artifactRegistrationOptionsForPath("E:\\docs\\draft.md", { metadataByPath }),
    { source: "edited" }
  );
  assert.deepEqual(
    artifactRegistrationOptionsForPath("E:\\docs\\new.md", {
      payload: { artifact_action: "create_new" }
    }),
    { source: "generated" }
  );
});

test("artifact store preserves edited source for in-place file updates", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "artifact-action-contract-"));
  try {
    const artifactPath = path.join(dir, "draft.md");
    writeFileSync(artifactPath, "updated contents\n");
    const artifactStore = createArtifactStore({ baseDir: dir });
    const record = artifactStore.registerArtifact("task_update_file", artifactPath, "text/markdown", {
      source: "edited"
    });
    assert.equal(record.source, "edited");
    assert.equal(record.kind, "markdown");
    assert.equal(record.status, "available");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
