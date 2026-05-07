import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, rm, rename, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateSkillDescriptorMarkdown } from "./discovery.mjs";

// Codex review (2026-05-03): Skill GitHub install is not "execute code" —
// SKILL.md is markdown — but it IS prompt-injection surface, so we cap
// SKILL.md size and document the third-party nature in UI. Path-injection
// and git argument-injection are real, so the URL/branch validators below
// are deliberately strict.
//
// C18 #3 (UPGRADE_PLAN.md, 2026-05-08): the URL parser now also accepts
// the GitHub deep-tree shape — https://github.com/owner/repo/tree/<branch>/
// <sub/path> — so users can paste a link to a specific skill folder
// inside a multi-skill repo. The branch + subPath are validated strictly
// (codex round-1: lstat each path segment to reject symlinks / Windows
// junctions, realpath the final SKILL.md to ensure it stays inside the
// clone root).
//   - Tree URL form: https://github.com/owner/repo/tree/<branch>/<sub/path>
//   - Repo-root form: https://github.com/owner/repo[.git][#branch]
// Combining `#branch` with `/tree/<branch>/...` is rejected as ambiguous.

const GITHUB_HTTPS_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.git)?(?:#([^\s?#]+))?\/?$/;
const GITHUB_TREE_HTTPS_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.git)?\/tree\/([^/]+)\/(.+?)\/?(?:#([^\s?#]+))?$/;
const SKILL_MD_MAX_BYTES = 100 * 1024;
const DEFAULT_CLONE_TIMEOUT_MS = 60_000;

// Errors codes — stable for UI to render specific copy.
export const SKILL_INSTALL_ERROR = Object.freeze({
  GIT_NOT_INSTALLED: "git_not_installed",
  INVALID_URL: "invalid_url",
  INVALID_BRANCH: "invalid_branch",
  // C18 #3: deep-tree URL parsing introduces sub-path errors. Both are
  // shaped to carry a redacted, stable identifier (owner/repo@branch:/sub/path)
  // — never the temp clone path — so user-facing copy stays meaningful
  // when the install is rerun after a fix.
  INVALID_SUBPATH: "invalid_subpath",
  SUBPATH_NOT_FOUND: "subpath_not_found",
  CLONE_FAILED: "clone_failed",
  CLONE_TIMED_OUT: "clone_timed_out",
  DESCRIPTOR_MISSING: "skill_descriptor_missing",
  DESCRIPTOR_INVALID: "skill_descriptor_invalid",
  DESCRIPTOR_TOO_LARGE: "skill_descriptor_too_large",
  FINAL_LOCKED: "final_dir_locked",
  IO_FAILED: "io_failed"
});

export function validateGitHubSkillUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_URL, message: "URL required" };
  // Reject URLs with embedded user info (e.g. https://user:pass@github.com/...).
  if (/^https:\/\/[^/]*@/i.test(value)) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_URL, message: "URL must not include credentials" };
  }
  // C18 #3: try the deep-tree form first so a URL like
  //   https://github.com/owner/repo/tree/main/skills/research
  // doesn't accidentally pass the looser repo-root regex via a
  // greedy match. The deep-tree shape carries branch + sub-path.
  const treeMatch = value.match(GITHUB_TREE_HTTPS_RE);
  if (treeMatch) {
    const [, owner, repo, branch, subPath, fragmentBranch] = treeMatch;
    if (owner.includes("..") || repo.includes("..")) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_URL, message: "Owner / repo must not contain ../" };
    }
    // codex round-1: combining /tree/<branch>/... with #branch is
    // ambiguous and a sign of a malformed paste. Reject explicitly
    // rather than silently picking one.
    if (fragmentBranch) {
      return {
        ok: false,
        reason: SKILL_INSTALL_ERROR.INVALID_URL,
        message: "URL contains both /tree/<branch>/ and #branch — pass exactly one"
      };
    }
    return {
      ok: true,
      owner,
      repo,
      fragmentBranch: branch,
      subPath,
      cloneUrl: `https://github.com/${owner}/${repo}.git`
    };
  }
  const match = value.match(GITHUB_HTTPS_RE);
  if (!match) {
    return {
      ok: false,
      reason: SKILL_INSTALL_ERROR.INVALID_URL,
      message: "Only https://github.com/owner/repo URLs (optionally /tree/<branch>/<sub/path>) are supported"
    };
  }
  const [, owner, repo, fragmentBranch] = match;
  if (owner.includes("..") || repo.includes("..")) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_URL, message: "Owner / repo must not contain ../" };
  }
  return {
    ok: true,
    owner,
    repo,
    fragmentBranch: fragmentBranch ?? null,
    subPath: null,
    cloneUrl: `https://github.com/${owner}/${repo}.git`
  };
}

// C18 #3: validate a sub-path within a cloned repo before we let it
// influence path joins. Charset-strict; rejects ../ traversal, leading
// slash, control chars, shell metas, and empty segments. Symlink
// rejection happens AFTER clone via lstat (validateSubPathOnDisk).
export function validateSubPath(subPath) {
  if (subPath == null) return { ok: true, subPath: null };
  const value = String(subPath).trim().replace(/^\/+|\/+$/g, "");
  if (!value) return { ok: true, subPath: null };
  if (value.includes("\\")) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: "subPath must use / as separator" };
  }
  const segments = value.split("/");
  for (const seg of segments) {
    if (!seg) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: "subPath must not contain empty segments (// or trailing /)" };
    }
    if (seg === "." || seg === "..") {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: "subPath must not contain . or .. segments" };
    }
    if (seg.startsWith("-")) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: `subPath segment may not start with -: ${seg}` };
    }
    // Strict charset: alnum, dot, dash, underscore. Rejects shell metas
    // (quotes, backticks, $, %, ;, |, &, etc.) and whitespace.
    if (!/^[A-Za-z0-9._-]+$/.test(seg)) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: `subPath segment has illegal characters: ${seg}` };
    }
    if (seg.length > 80) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: `subPath segment is too long (>80 chars): ${seg}` };
    }
  }
  return { ok: true, subPath: value };
}

export function validateBranchName(branch) {
  const value = String(branch ?? "").trim();
  if (!value) return { ok: true, branch: null };
  // Codex review: align with `git check-ref-format`. Reject:
  //   - leading "-" (option injection)
  //   - leading or trailing "/", or sequence "//"
  //   - any path component (segment between slashes) starting with "."
  //   - any path component ending with ".lock"
  //   - sequences ".." or "@{"
  //   - a single bare "@"
  //   - whitespace, control chars, the documented illegal set ~^:?*[\
  //   - shell metas (quotes / backticks / $) as belt-and-braces
  // feature-x, feat/x, v1.2.3, release-2026.05 still pass.
  if (value === "@") {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch may not be a bare @" };
  }
  if (value.startsWith("-")) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch may not start with -" };
  }
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch may not start, end, or chain on /" };
  }
  if (value.endsWith(".")) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch may not end with ." };
  }
  if (value.includes("..") || value.includes("@{")) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch may not contain .. or @{" };
  }
  for (const segment of value.split("/")) {
    if (segment.startsWith(".")) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch components may not start with ." };
    }
    if (segment.endsWith(".lock")) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch components may not end with .lock" };
    }
  }
  if (/[\u0000-\u001f\u007f\s~^:?*[\\"'`$]/.test(value)) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_BRANCH, message: "branch contains illegal characters" };
  }
  return { ok: true, branch: value };
}

function spawnPromise(spawnImpl, command, args, { timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        env: { ...env },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      resolve({ ok: false, error });
      return;
    }
    let stderr = "";
    let stdout = "";
    let timedOut = false;
    let settled = false;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    child.stderr?.on?.("data", (chunk) => { stderr += Buffer.from(chunk).toString("utf8"); });
    child.stdout?.on?.("data", (chunk) => { stdout += Buffer.from(chunk).toString("utf8"); });
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs) : null;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      settle({ ok: false, error, stderr, stdout, timedOut });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        settle({ ok: false, error: new Error("clone timed out"), stderr, stdout, timedOut: true });
        return;
      }
      if (code === 0) {
        settle({ ok: true, stderr, stdout });
        return;
      }
      settle({ ok: false, error: new Error(`exit ${code} signal ${signal ?? "(none)"}`), stderr, stdout, timedOut: false });
    });
  });
}

export async function probeGitInstalled({ spawnImpl = spawn, env = process.env } = {}) {
  const result = await spawnPromise(spawnImpl, "git", ["--version"], { timeoutMs: 5_000, env });
  return Boolean(result.ok);
}

function locateSkillDescriptor(rootDir) {
  const rootEntry = path.join(rootDir, "SKILL.md");
  if (existsSync(rootEntry)) return { skillDir: rootDir, entryPath: rootEntry };
  let entries;
  try { entries = readdirSync(rootDir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name.startsWith(".")) continue;
    const candidate = path.join(rootDir, entry.name, "SKILL.md");
    if (existsSync(candidate)) {
      return { skillDir: path.join(rootDir, entry.name), entryPath: candidate };
    }
  }
  return null;
}

// C18 #3 (codex round-1 hardening): when the user's URL specifies a
// sub-path, walk the clone tree segment-by-segment with lstat so we
// reject symlinks / Windows junctions / reparse points BEFORE we read
// SKILL.md. After locating SKILL.md, realpath both it and the skill
// directory and confirm they still resolve INSIDE the staging clone
// — otherwise an internal symlink could let a malicious repo escape
// the cloned tree.
function locateSkillDescriptorAt(stagingDir, subPath) {
  const realStaging = (() => {
    try { return realpathSync(stagingDir); } catch { return path.resolve(stagingDir); }
  })();
  const segments = subPath.split("/");
  let current = stagingDir;
  for (const seg of segments) {
    current = path.join(current, seg);
    let info;
    try { info = lstatSync(current); }
    catch { return { ok: false, reason: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND, missingAt: seg }; }
    if (info.isSymbolicLink()) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: `subPath segment '${seg}' is a symbolic link — refusing to traverse` };
    }
    // Windows junction / reparse-point detection. lstatSync exposes
    // the type bits; junctions show up as directories whose mode flags
    // we can't fully introspect from JS, so we additionally check that
    // realpath of the segment is still INSIDE realStaging.
    let realCurrent;
    try { realCurrent = realpathSync(current); }
    catch { return { ok: false, reason: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND, missingAt: seg }; }
    if (!isPathInside(realCurrent, realStaging)) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: `subPath segment '${seg}' resolves outside the clone root` };
    }
    if (!info.isDirectory()) {
      return { ok: false, reason: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND, missingAt: seg };
    }
  }
  // current is the resolved skill directory; confirm SKILL.md exists
  // and is a regular file (not a symlink to outside).
  const entryPath = path.join(current, "SKILL.md");
  let entryInfo;
  try { entryInfo = lstatSync(entryPath); }
  catch { return { ok: false, reason: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND, missingAt: "SKILL.md" }; }
  if (entryInfo.isSymbolicLink()) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: "SKILL.md must not be a symbolic link" };
  }
  if (!entryInfo.isFile()) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND, missingAt: "SKILL.md" };
  }
  let realEntry;
  try { realEntry = realpathSync(entryPath); }
  catch { return { ok: false, reason: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND, missingAt: "SKILL.md" }; }
  if (!isPathInside(realEntry, realStaging)) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.INVALID_SUBPATH, message: "SKILL.md resolves outside the clone root" };
  }
  return { ok: true, skillDir: current, entryPath };
}

// Path-containment check using normalised + suffix form. Both inputs
// must already be realpath()'d by the caller for symlink semantics
// to be correct.
function isPathInside(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function readSkillMarkdownGuarded(entryPath) {
  const sizeBytes = statSync(entryPath).size;
  if (sizeBytes > SKILL_MD_MAX_BYTES) {
    return { ok: false, reason: SKILL_INSTALL_ERROR.DESCRIPTOR_TOO_LARGE, sizeBytes, max: SKILL_MD_MAX_BYTES };
  }
  return { ok: true, markdown: readFileSync(entryPath, "utf8") };
}

async function tryRm(target) {
  try { await rm(target, { recursive: true, force: true }); return true; }
  catch { return false; }
}

async function dirExists(target) {
  try { const s = await stat(target); return s.isDirectory(); } catch { return false; }
}

function deriveFinalDirName(owner, repo, subPath = null) {
  const base = `${owner}--${repo}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  // C18 #3 (codex round-1): when the URL specifies a sub-path, append
  // a slug derived from the LAST segment so two repos with the same
  // leaf name don't collide (`repoA/tools/research` vs
  // `repoB/skills/research`). Keeping the owner--repo prefix means
  // even within a single repo two installs of different sub-paths
  // get distinct directories.
  if (typeof subPath === "string" && subPath.trim()) {
    const segments = subPath.split("/").filter(Boolean);
    const leaf = segments[segments.length - 1];
    if (leaf) {
      const leafSlug = leaf.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
      return `${base}--${leafSlug}`;
    }
  }
  return base;
}

function appendRegistryEntry(runtime, rootPath) {
  const store = runtime?.configStore;
  if (!store?.load || !store?.save) return null;
  const config = store.load();
  const ai = config.ai && typeof config.ai === "object" ? { ...config.ai } : {};
  const skills = ai.skills && typeof ai.skills === "object" ? { ...ai.skills } : {};
  const registries = Array.isArray(skills.registries) ? [...skills.registries] : [];
  const normalised = path.resolve(rootPath);
  const exists = registries.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry.rootPath ?? entry.path;
    return candidate ? path.resolve(candidate) === normalised : false;
  });
  if (!exists) {
    registries.push({ rootPath: normalised, source: "github_install" });
  }
  skills.registries = registries;
  ai.skills = skills;
  config.ai = ai;
  store.save(config);
  return registries;
}

export async function installSkillFromGitHub({
  url,
  branch = null,
  subPath = null,
  runtime,
  spawnImpl = spawn,
  fsImpl = { rm, rename, mkdir, stat },
  cloneTimeoutMs = DEFAULT_CLONE_TIMEOUT_MS,
  now = () => Date.now(),
  randomId = randomUUID,
  removeGitDir = true
} = {}) {
  const skillsDir = runtime?.paths?.skillsDir;
  if (!skillsDir) {
    return { ok: false, error: SKILL_INSTALL_ERROR.IO_FAILED, message: "runtime.paths.skillsDir is required" };
  }

  const urlValidation = validateGitHubSkillUrl(url);
  if (!urlValidation.ok) return { ok: false, error: urlValidation.reason, message: urlValidation.message };

  const branchValidation = validateBranchName(branch ?? urlValidation.fragmentBranch);
  if (!branchValidation.ok) return { ok: false, error: branchValidation.reason, message: branchValidation.message };
  const effectiveBranch = branchValidation.branch;

  // C18 #3: explicit subPath kwarg (from action tool / future API)
  // takes precedence over the one parsed from the URL. validateSubPath
  // is strict — charset, no .. , no leading /, no shell metas.
  const subPathValidation = validateSubPath(subPath ?? urlValidation.subPath);
  if (!subPathValidation.ok) {
    return { ok: false, error: subPathValidation.reason, message: subPathValidation.message };
  }
  const effectiveSubPath = subPathValidation.subPath;
  // Stable identifier for user-facing error copy. Never includes the
  // temp clone path; safe to surface even if recovery succeeds later.
  const targetIdentifier = effectiveSubPath
    ? `${urlValidation.owner}/${urlValidation.repo}@${effectiveBranch ?? "default"}:/${effectiveSubPath}`
    : `${urlValidation.owner}/${urlValidation.repo}@${effectiveBranch ?? "default"}`;

  if (!await probeGitInstalled({ spawnImpl })) {
    return {
      ok: false,
      error: SKILL_INSTALL_ERROR.GIT_NOT_INSTALLED,
      message: "git was not found on PATH. Install Git for Windows / Xcode CLT and retry."
    };
  }

  const externalDir = path.join(skillsDir, "external");
  await fsImpl.mkdir(externalDir, { recursive: true });

  const finalName = deriveFinalDirName(urlValidation.owner, urlValidation.repo, effectiveSubPath);
  const finalDir = path.join(externalDir, finalName);
  const stagingDir = path.join(externalDir, `.staging-${now()}-${randomId().slice(0, 8)}`);
  let backupDir = null;

  // git clone --depth 1 [-b branch] <url> <stagingDir>
  const args = ["clone", "--depth", "1"];
  if (effectiveBranch) args.push("-b", effectiveBranch);
  args.push(urlValidation.cloneUrl, stagingDir);

  const cloneResult = await spawnPromise(spawnImpl, "git", args, {
    timeoutMs: cloneTimeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  if (!cloneResult.ok) {
    await tryRm(stagingDir);
    return {
      ok: false,
      error: cloneResult.timedOut ? SKILL_INSTALL_ERROR.CLONE_TIMED_OUT : SKILL_INSTALL_ERROR.CLONE_FAILED,
      message: cloneResult.error?.message ?? "git clone failed",
      stderr: cloneResult.stderr ?? "",
      timedOut: Boolean(cloneResult.timedOut)
    };
  }

  // C18 #3: when the URL specified a sub-path, locate SKILL.md at
  // <staging>/<subPath>/SKILL.md with strict symlink / junction
  // protection. Otherwise fall back to the root-or-1-level scan
  // that handles the common "single-skill repo" layout.
  let located;
  if (effectiveSubPath) {
    const result = locateSkillDescriptorAt(stagingDir, effectiveSubPath);
    if (!result.ok) {
      await tryRm(stagingDir);
      // Map missing-segment / not-found to SUBPATH_NOT_FOUND with the
      // stable identifier; map symlink / out-of-clone-root to
      // INVALID_SUBPATH so the UI can colour them differently.
      if (result.reason === SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND) {
        return {
          ok: false,
          error: SKILL_INSTALL_ERROR.SUBPATH_NOT_FOUND,
          message: `Path '${effectiveSubPath}/SKILL.md' not found in ${targetIdentifier}`
        };
      }
      return {
        ok: false,
        error: result.reason,
        message: result.message ?? `subPath rejected for ${targetIdentifier}`
      };
    }
    located = { skillDir: result.skillDir, entryPath: result.entryPath };
  } else {
    located = locateSkillDescriptor(stagingDir);
    if (!located) {
      await tryRm(stagingDir);
      return { ok: false, error: SKILL_INSTALL_ERROR.DESCRIPTOR_MISSING, message: `SKILL.md not found at root or in any top-level subdirectory of ${targetIdentifier}` };
    }
  }

  // Size + structural validation.
  const guarded = readSkillMarkdownGuarded(located.entryPath);
  if (!guarded.ok) {
    await tryRm(stagingDir);
    return {
      ok: false,
      error: guarded.reason,
      message: `SKILL.md is too large (${guarded.sizeBytes} bytes, limit ${guarded.max})`
    };
  }
  const validation = validateSkillDescriptorMarkdown(guarded.markdown);
  if (!validation.ok) {
    await tryRm(stagingDir);
    return {
      ok: false,
      error: SKILL_INSTALL_ERROR.DESCRIPTOR_INVALID,
      message: validation.errors.map((entry) => `${entry.field}: ${entry.message}`).join("; ") || "invalid descriptor"
    };
  }

  // Best-effort .git removal so the user does not get a "ghost git repo"
  // shape in their skills dir. Failure is downgraded to a warning rather
  // than failing the install — Codex review noted this is critical on
  // Windows where file locks can block recursive rm.
  let gitRemoveFailed = false;
  if (removeGitDir) {
    const gitDir = path.join(stagingDir, ".git");
    if (await dirExists(gitDir)) {
      gitRemoveFailed = !(await tryRm(gitDir));
    }
  }

  // Atomic swap. If `finalDir` exists, move it aside as a backup, then
  // rename staging -> final. On any failure, rollback. Codex review:
  // never delete the user's previous skill until the new one is fully in
  // place. If the rollback rename also fails (worst-case Windows file
  // lock), we MUST NOT clean up `backupDir` — it holds the user's last
  // good skill and must be reachable for manual recovery. `backupTaken`
  // ensures we don't lie about a backup path that was never actually
  // created (e.g. when the very first rename throws).
  let rollbackFailedBackup = null;
  let backupTaken = false;
  try {
    if (await dirExists(finalDir)) {
      backupDir = `${finalDir}.backup-${now()}`;
      await fsImpl.rename(finalDir, backupDir);
      backupTaken = true;
    }
    await fsImpl.rename(stagingDir, finalDir);
  } catch (error) {
    if (backupTaken && backupDir) {
      try {
        await fsImpl.rename(backupDir, finalDir);
        backupDir = null;
      } catch (rollbackError) {
        rollbackFailedBackup = backupDir;
        backupDir = null;
      }
    }
    await tryRm(stagingDir);
    return {
      ok: false,
      error: SKILL_INSTALL_ERROR.FINAL_LOCKED,
      message: error?.message ?? "Could not place the skill in its final directory",
      ...(rollbackFailedBackup
        ? {
            backupPath: rollbackFailedBackup,
            recovery: `Previous skill survives at ${rollbackFailedBackup}. Rename it back to ${finalDir} once the lock clears.`
          }
        : {})
    };
  }
  if (backupDir) await tryRm(backupDir);

  const skillRoot = located.skillDir === stagingDir
    ? finalDir
    : path.join(finalDir, path.relative(stagingDir, located.skillDir));

  const registries = appendRegistryEntry(runtime, skillRoot);

  return {
    ok: true,
    owner: urlValidation.owner,
    repo: urlValidation.repo,
    branch: effectiveBranch,
    subPath: effectiveSubPath,
    rootPath: skillRoot,
    descriptor: {
      heading: validation.heading,
      description: validation.description
    },
    registries: registries ?? [],
    warnings: gitRemoveFailed ? ["git_dir_remove_failed"] : []
  };
}
