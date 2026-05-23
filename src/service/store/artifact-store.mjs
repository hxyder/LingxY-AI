import { statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeBaseDir } from "../core/runtime-paths.mjs";
import {
  normalizeArtifactMetadata,
  normalizeArtifactVersionMetadata
} from "../core/store/artifact-metadata.mjs";

function resolveBaseDir(baseDir) {
  if (baseDir) {
    return baseDir;
  }

  return resolveRuntimeBaseDir();
}

function inspectArtifactPath(artifactPath) {
  try {
    const stat = statSync(artifactPath);
    if (!stat.isFile()) {
      return { bytes: null, sha256: null, status: "available" };
    }
    return { bytes: stat.size, sha256: null, status: "available" };
  } catch {
    return { bytes: null, sha256: null, status: "missing" };
  }
}

export function createArtifactStore({ baseDir } = {}) {
  const rootDir = resolveBaseDir(baseDir);

  return {
    rootDir,
    async createTaskOutputDir(taskId, createdAt = new Date()) {
      const dateKey = createdAt.toISOString().slice(0, 10);
      const taskDir = path.join(rootDir, "outputs", dateKey, taskId);
      await mkdir(taskDir, { recursive: true });
      return taskDir;
    },
    registerArtifact(taskId, artifactPath, mimeType, {
      conversationId = null,
      createdAt = null,
      source = "generated",
      parentArtifactId = null,
      revisionOf = null,
      versionLabel = null
    } = {}) {
      const metadata = normalizeArtifactMetadata({
        path: artifactPath,
        mime_type: mimeType,
        source,
        ...inspectArtifactPath(artifactPath)
      });
      const version = normalizeArtifactVersionMetadata({
        parentArtifactId,
        revisionOf,
        versionLabel
      });
      return {
        artifact_id: `${taskId}:${path.basename(artifactPath)}`,
        task_id: taskId,
        conversation_id: conversationId ?? null,
        path: artifactPath,
        created_at: createdAt ?? new Date().toISOString(),
        mime_type: mimeType,
        ...metadata,
        ...version
      };
    }
  };
}
