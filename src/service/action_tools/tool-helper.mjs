import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createActionResult } from "./types.mjs";

export function createNoopTool(definition) {
  return {
    ...definition,
    async execute(args, ctx) {
      return createActionResult({
        success: true,
        observation: definition.formatObservation(args, ctx),
        metadata: {
          tool_id: definition.id
        }
      });
    }
  };
}

export function isExecutablePath(targetPath = "") {
  return [".exe", ".msi", ".bat", ".cmd", ".ps1"].some((suffix) => targetPath.toLowerCase().endsWith(suffix));
}

export function isSafePath(targetPath = "", allowedRoots = []) {
  if (!targetPath || targetPath.includes("..")) {
    return false;
  }

  if (allowedRoots.length === 0) {
    return true;
  }

  const normalized = path.resolve(targetPath);
  return allowedRoots.some((root) => normalized.startsWith(path.resolve(root)));
}

export async function writeToolArtifact(ctx, relativeName, contents) {
  const outputDir = ctx.outputDir ?? path.join(process.cwd(), ".uca-runtime", "tool-artifacts");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, relativeName);
  await writeFile(artifactPath, contents, "utf8");
  return artifactPath;
}
