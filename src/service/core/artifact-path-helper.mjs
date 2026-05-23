import { lstat, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function resolveOutputDirForTool(ctx) {
  if (ctx?.outputDir) return ctx.outputDir;
  const configuredDir = ctx?.runtime?.configStore?.load?.()?.output?.defaultDir;
  if (configuredDir && typeof configuredDir === "string" && configuredDir.trim()) {
    return path.join(configuredDir.trim(), ctx?.task?.task_id ?? `scratch-${Date.now()}`);
  }
  return path.join(os.homedir(), "Desktop", "UCA", ctx?.task?.task_id ?? `scratch-${Date.now()}`);
}

export async function ensureOutputDir(outputDir) {
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

export function configuredWritableArtifactRoots(ctx = {}) {
  return [
    ctx?.runtime?.paths?.outputsDir,
    ctx?.runtime?.configStore?.load?.()?.output?.defaultDir,
    path.join(os.homedir(), "Desktop", "UCA")
  ]
    .filter((candidate) => typeof candidate === "string" && candidate.trim())
    .map((candidate) => path.resolve(candidate));
}

export async function resolveSandboxedTarget(outputDir, relativePath, { allowedRoots = [] } = {}) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("path is required");
  }
  // Reject `..` segments outright, even if they'd cancel out, because LLMs
  // sometimes write things like `reports/../../etc/passwd` and we don't want
  // to rely on resolve() normalising away the mistake.
  if (relativePath.includes("..")) {
    throw new Error("path must not contain '..'");
  }
  // Treat absolute paths as "use as-is" but still check they're inside the
  // output dir so the LLM can paste a full `C:\...\outputs\xx\foo.txt` without
  // being rejected.
  const resolvedOutputDir = path.resolve(outputDir);
  const absTarget = path.isAbsolute(relativePath)
    ? path.resolve(relativePath)
    : path.resolve(resolvedOutputDir, relativePath);
  const roots = [
    resolvedOutputDir,
    ...allowedRoots
      .filter((candidate) => typeof candidate === "string" && candidate.trim())
      .map((candidate) => path.resolve(candidate))
  ];
  const containingRoot = roots.find((root) =>
    absTarget === root || absTarget.startsWith(root + path.sep)
  );
  if (!containingRoot) {
    throw new Error(`path escapes task workspace: ${relativePath}`);
  }
  // Reject any existing symlink components in the *parent* chain between the
  // workspace and the target. realpath() would silently follow them.
  let probe = path.dirname(absTarget);
  while (probe && probe.length >= containingRoot.length) {
    try {
      const info = await lstat(probe);
      if (info.isSymbolicLink()) {
        throw new Error(`parent path contains a symlink: ${probe}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  // If the target already exists, make sure it's not itself a symlink.
  try {
    const info = await lstat(absTarget);
    if (info.isSymbolicLink()) {
      throw new Error(`target path is a symlink: ${relativePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return absTarget;
}
