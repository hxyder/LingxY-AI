import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Resolve the output directory for a tool execution.
 * Prefers ctx.outputDir, then runtime config, then falls back to Desktop/UCA.
 */
export function resolveOutputDirForTool(ctx) {
  if (ctx?.outputDir) return ctx.outputDir;
  const configuredDir = ctx?.runtime?.configStore?.load?.()?.output?.defaultDir;
  if (configuredDir && typeof configuredDir === "string" && configuredDir.trim()) {
    return path.join(configuredDir.trim(), ctx?.task?.task_id ?? `scratch-${Date.now()}`);
  }
  return path.join(os.homedir(), "Desktop", "UCA", ctx?.task?.task_id ?? `scratch-${Date.now()}`);
}

/**
 * Ensure the output directory exists, creating it recursively if needed.
 */
export async function ensureOutputDir(outputDir) {
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

/**
 * Return the list of configured writable artifact roots for sandbox validation.
 */
export function configuredWritableArtifactRoots(ctx = {}) {
  return [
    ctx?.runtime?.paths?.outputsDir,
    ctx?.runtime?.configStore?.load?.()?.output?.defaultDir,
    path.join(os.homedir(), "Desktop", "UCA")
  ]
    .filter((candidate) => typeof candidate === "string" && candidate.trim())
    .map((candidate) => path.resolve(candidate));
}

/**
 * Validate and resolve a target path within the output directory sandbox.
 * Rejects `..` segments and paths outside allowed roots.
 */
export async function resolveSandboxedTarget(outputDir, relativePath, { allowedRoots = [] } = {}) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("path is required");
  }
  if (relativePath.includes("..")) {
    throw new Error("path must not contain '..'");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  let target = path.resolve(resolvedOutputDir, relativePath);
  // If the target is absolute and inside the output dir, keep it;
  // otherwise prepend the output dir.
  if (!target.startsWith(resolvedOutputDir + path.sep) && target !== resolvedOutputDir) {
    // Check if it's inside any allowed root
    const roots = [resolvedOutputDir, ...allowedRoots.map((r) => path.resolve(r))];
    const inside = roots.some((root) => target.startsWith(root + path.sep) || target === root);
    if (!inside) {
      // Prepend output dir as a fallback
      target = path.resolve(resolvedOutputDir, path.basename(relativePath));
    }
  }
  // Final check: still inside at least one allowed root
  const allRoots = [resolvedOutputDir, ...allowedRoots.map((r) => path.resolve(r))];
  const isInside = allRoots.some((root) => target.startsWith(root + path.sep) || target === root);
  if (!isInside) {
    throw new Error(`path escapes the output directory: ${relativePath}`);
  }
  return target;
}
