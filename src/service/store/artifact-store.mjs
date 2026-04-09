import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeBaseDir } from "../core/runtime-paths.mjs";

function resolveBaseDir(baseDir) {
  if (baseDir) {
    return baseDir;
  }

  return resolveRuntimeBaseDir();
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
    registerArtifact(taskId, artifactPath, mimeType) {
      return {
        artifact_id: `${taskId}:${path.basename(artifactPath)}`,
        task_id: taskId,
        path: artifactPath,
        created_at: new Date().toISOString(),
        mime_type: mimeType
      };
    }
  };
}
