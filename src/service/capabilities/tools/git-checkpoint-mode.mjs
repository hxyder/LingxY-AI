import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function cleanString(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function safeRefSegment(value = "checkpoint") {
  return String(value || "checkpoint")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/\.lock$/iu, "_lock")
    .replace(/\.$/u, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "checkpoint";
}

function safeRefNamespace(value = "lingxy/checkpoints") {
  const segments = String(value || "lingxy/checkpoints")
    .split(/[\\/]+/u)
    .map((segment) => safeRefSegment(segment))
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.length ? segments.slice(0, 8).join("/") : "lingxy/checkpoints";
}

function enabledGitCheckpointPolicy(ctx = {}) {
  const config = ctx.reversibility?.gitCheckpoint ?? ctx.gitCheckpoint ?? null;
  return config?.enabled === true
    ? {
      enabled: true,
      refNamespace: safeRefNamespace(config.refNamespace ?? "lingxy/checkpoints"),
      label: cleanString(config.label ?? "LingxY file mutation checkpoint")
    }
    : { enabled: false };
}

async function runGit(args, { cwd, execFileImpl = execFileAsync } = {}) {
  const { stdout } = await execFileImpl("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return String(stdout ?? "").trim();
}

async function tryRunGit(args, options = {}) {
  try {
    return await runGit(args, options);
  } catch {
    return null;
  }
}

export async function createOptionalGitCheckpoint(ctx = {}, {
  targetPath,
  toolId = null,
  operation = "file_mutation",
  now = new Date().toISOString(),
  execFileImpl = execFileAsync
} = {}) {
  const policy = enabledGitCheckpointPolicy(ctx);
  if (!policy.enabled) return null;

  const absTarget = path.resolve(String(targetPath ?? ""));
  const probeCwd = path.dirname(absTarget);
  const repoRoot = await tryRunGit(["-C", probeCwd, "rev-parse", "--show-toplevel"], { cwd: probeCwd, execFileImpl });
  if (!repoRoot) {
    return {
      enabled: true,
      provider: "git",
      mode: "stash_create_ref",
      available: false,
      reason: "not_a_git_repository",
      target_path: absTarget,
      created_at: now
    };
  }
  const normalizedRepoRoot = path.resolve(repoRoot);
  const relativeTarget = path.relative(normalizedRepoRoot, absTarget);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    return {
      enabled: true,
      provider: "git",
      mode: "stash_create_ref",
      available: false,
      reason: "target_outside_repository",
      repo_root: normalizedRepoRoot,
      target_path: absTarget,
      created_at: now
    };
  }

  const headCommit = await tryRunGit(["-C", normalizedRepoRoot, "rev-parse", "--verify", "HEAD"], {
    cwd: normalizedRepoRoot,
    execFileImpl
  });
  const label = cleanString(`${policy.label}: ${toolId ?? "file_tool"} ${operation} ${relativeTarget}`);
  const stashCommit = await tryRunGit(["-C", normalizedRepoRoot, "stash", "create", label], {
    cwd: normalizedRepoRoot,
    execFileImpl
  });
  const refName = stashCommit
    ? `refs/${policy.refNamespace}/${safeRefSegment(toolId ?? "file_tool")}-${Date.now()}`
    : null;
  if (stashCommit && refName) {
    await runGit(["-C", normalizedRepoRoot, "update-ref", refName, stashCommit], {
      cwd: normalizedRepoRoot,
      execFileImpl
    });
  }

  return {
    enabled: true,
    provider: "git",
    mode: "stash_create_ref",
    available: true,
    repo_root: normalizedRepoRoot,
    target_path: absTarget,
    relative_target_path: relativeTarget,
    head_commit: headCommit,
    stash_commit: stashCommit || null,
    checkpoint_ref: refName,
    operation,
    tool_id: toolId,
    created_at: now,
    restore_hint: stashCommit
      ? `git checkout ${refName} -- ${relativeTarget}`
      : `git checkout ${headCommit ?? "HEAD"} -- ${relativeTarget}`
  };
}
