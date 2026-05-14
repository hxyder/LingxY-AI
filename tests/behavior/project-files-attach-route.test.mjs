import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleNoteProjectConversationRoute } from "../../src/service/core/http-routes/note-project-conversation-routes.mjs";
import { createEmbeddingStore, EMBEDDING_NAMESPACES } from "../../src/service/embeddings/store.mjs";
import { buildDefaultProjectStore, buildProject } from "../../src/shared/project-store.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

function rawJsonRequest(body, headers = {}) {
  const request = Readable.from([JSON.stringify(body ?? {})]);
  request.headers = {
    "content-type": "application/json",
    ...headers
  };
  return request;
}

function captureResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    }
  };
}

function parsePayload(response) {
  return response.body ? JSON.parse(response.body) : null;
}

function createConfigStore(initialConfig) {
  let current = initialConfig;
  return {
    load() {
      return current;
    },
    save(next) {
      current = next;
    }
  };
}

async function projectFilesRoute({ body, actor, runtime }) {
  const response = captureResponse();
  const handled = await tryHandleNoteProjectConversationRoute({
    request: rawJsonRequest(body, actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method: "POST",
    url: new URL("http://127.0.0.1/projects/proj_a/files/attach"),
    runtime,
    saveRuntimeConfig(runtimeArg, updater) {
      const currentConfig = runtimeArg.configStore.load();
      const nextConfig = updater(currentConfig);
      runtimeArg.configStore.save(nextConfig);
      return nextConfig;
    }
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response)
  };
}

test("project file attachment requires a desktop actor", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lingxy-project-files-guard-"));
  try {
    const filePath = path.join(tmpRoot, "resume.md");
    await writeFile(filePath, "Resume content", "utf8");
    const runtime = {
      platform: { embeddingStore: createEmbeddingStore() },
      configStore: createConfigStore({
        ui: {
          projectStore: {
            ...buildDefaultProjectStore({ withUpdatedAt: false }),
            projects: [buildProject({ id: "proj_a", name: "A" })]
          }
        }
      })
    };

    const result = await projectFilesRoute({
      body: { paths: [filePath] },
      runtime
    });

    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 403);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.equal(runtime.platform.embeddingStore.list({ namespace: EMBEDDING_NAMESPACES.FILE_CONTENT }).length, 0);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("project file attachment indexes selected files into project-scoped RAG", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lingxy-project-files-attach-"));
  try {
    const filePath = path.join(tmpRoot, "resume.md");
    await writeFile(filePath, "# Resume\n\nMachine learning and product work.", "utf8");
    const runtime = {
      platform: { embeddingStore: createEmbeddingStore() },
      configStore: createConfigStore({
        ui: {
          projectStore: {
            ...buildDefaultProjectStore({ withUpdatedAt: false }),
            projects: [buildProject({ id: "proj_a", name: "A" })]
          }
        }
      })
    };

    const result = await projectFilesRoute({
      body: { paths: [filePath] },
      actor: "desktop_console",
      runtime
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.deepEqual(result.payload.attached_paths, [filePath]);
    assert.equal(result.payload.failed_paths.length, 0);
    const project = result.payload.store.projects.find((item) => item.id === "proj_a");
    assert.equal(project.attachedFilePaths.includes(filePath), true);

    const records = runtime.platform.embeddingStore.list({
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      projectId: "proj_a"
    });
    assert.equal(records.length, result.payload.indexed_count);
    assert.equal(records.length > 0, true);
    assert.equal(records[0].metadata.project_id, "proj_a");
    assert.equal(records[0].metadata.path, filePath);
    assert.match(records[0].text, /Machine learning/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("project folder attachment recursively indexes readable files but skips generated folders", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lingxy-project-folder-attach-"));
  try {
    const folderPath = path.join(tmpRoot, "project");
    await mkdir(path.join(folderPath, "src"), { recursive: true });
    await mkdir(path.join(folderPath, "node_modules"), { recursive: true });
    await writeFile(path.join(folderPath, "src", "brief.md"), "Project brief with useful retrieval text.", "utf8");
    await writeFile(path.join(folderPath, "node_modules", "ignored.md"), "Should not be indexed.", "utf8");
    const recordedProjectFiles = [];
    const runtime = {
      platform: { embeddingStore: createEmbeddingStore() },
      projectWorkspaces: {
        recordProjectFiles(projectId, paths, options) {
          recordedProjectFiles.push({ projectId, paths, options });
          return [];
        }
      },
      configStore: createConfigStore({
        ui: {
          projectStore: {
            ...buildDefaultProjectStore({ withUpdatedAt: false }),
            projects: [buildProject({ id: "proj_a", name: "A" })]
          }
        }
      })
    };

    const result = await projectFilesRoute({
      body: { paths: [folderPath] },
      actor: "desktop_console",
      runtime
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.attached_paths[0], folderPath);
    assert.equal(result.payload.attached_entries[0].kind, "folder");
    assert.equal(result.payload.attached_entries[0].files_seen, 1);
    assert.equal(recordedProjectFiles.length, 1);
    assert.equal(recordedProjectFiles[0].projectId, "proj_a");
    assert.deepEqual(recordedProjectFiles[0].paths, [folderPath]);
    assert.equal(recordedProjectFiles[0].options.status, "indexed");
    assert.equal(recordedProjectFiles[0].options.metadata.kind, "folder");
    assert.equal(recordedProjectFiles[0].options.metadata.source, "project_file_attach");
    const records = runtime.platform.embeddingStore.list({
      namespace: EMBEDDING_NAMESPACES.FILE_CONTENT,
      projectId: "proj_a"
    });
    assert.equal(records.length > 0, true);
    assert.match(records.map((record) => record.text).join("\n"), /Project brief/);
    assert.doesNotMatch(records.map((record) => record.text).join("\n"), /Should not be indexed/);
    assert.equal(records[0].metadata.recursive, true);
    assert.equal(records[0].metadata.coverage_scope, "folder_recursive_text");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
