import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, rm, rename, stat } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
// Codex round-1: the branch capture in the tree-URL regex MUST NOT
// span `/` because a URL like `.../tree/feat/x/skills/research`
// is genuinely ambiguous from the URL alone — `feat` could be the
// branch with `x/skills/research` as the path, OR `feat/x` could be
// the branch with `skills/research` as the path. Without an API call
// we cannot tell. Restricting tree-form branches to a strict
// charset (no `/`) closes the ambiguity. Users with a slash-branch
// fall back to the repo-root URL + #branch form, where the fragment
// is unambiguously the branch.
const GITHUB_TREE_HTTPS_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.git)?\/tree\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+?)\/?(?:#([^\s?#]+))?$/;
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

// Codex round-1 catch: round-0 only used the leaf segment, so
// `skills/research` and `tools/research` in the same repo collided
// at `owner--repo--research`. Round-1 fix: slug the FULL subPath
// (segments joined with `--`), then either keep it verbatim if
// short, OR truncate + append a deterministic 6-char hash of the
// raw subPath so identical subPaths always yield identical dirs.
export function deriveFinalDirName(owner, repo, subPath = null) {
  const base = `${owner}--${repo}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (typeof subPath !== "string" || !subPath.trim()) return base;
  const segments = subPath.split("/").filter(Boolean);
  if (segments.length === 0) return base;
  const fullSlug = segments
    .map((seg) => seg.toLowerCase().replace(/[^a-z0-9._-]/g, "-"))
    .join("--");
  // Cap suffix at ~32 chars so the total dir name stays comfortably
  // under common path-length limits. When truncated, suffix the
  // SHA-256 prefix of the raw subPath so two distinct deep paths
  // that share a leaf slug still resolve to distinct dirs.
  const MAX_SLUG = 32;
  if (fullSlug.length <= MAX_SLUG) {
    return `${base}--${fullSlug}`;
  }
  const hash = createHash("sha256").update(subPath).digest("hex").slice(0, 6);
  const leafSlug = segments[segments.length - 1].toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  const trimmedLeaf = leafSlug.slice(0, MAX_SLUG - 7); // room for "-XXXXXX"
  return `${base}--${trimmedLeaf}-${hash}`;
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

// C18 #2 (D pre-design ACCEPT, 2026-05-08): installSkillFromGitHub is
// split into a stage phase (clone + validate, no user-visible mutation)
// and a finalize phase (atomic swap + registry update). The split lets
// the LLM-callable action tool surface a real SKILL.md PREVIEW in the
// approval card before the user commits to install — D's "preview-then-
// install" requirement that single-step requires_confirmation can't
// satisfy. installSkillFromGitHub is preserved as a thin shim that
// chains stage → finalize so existing callers (POST /skills/install/
// github + verify-skill-github-install behavior tests) keep working.

/**
 * Stage a skill clone for a GitHub URL. Clones to a temp staging dir,
 * validates SKILL.md, but does NOT touch the user's installed skill set.
 *
 * Returns either a failure shape (error code + message) OR a success
 * shape:
 *   { ok: true, stagingInfo: {
 *       stagingDir, finalName, finalDir, owner, repo, branch, subPath,
 *       descriptor: { heading, description },
 *       preview: { markdown, sizeBytes, contentHash },
 *       gitRemoveFailed: bool
 *     } }
 *
 * The caller must EITHER finalizeStagedInstall(stagingInfo) to commit
 * OR call discardStagedInstall(stagingInfo) to clean up the temp dir.
 * Leaving staging dirs orphaned is a slow-leak bug.
 */
export async function stageSkillFromGitHub({
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

  const subPathValidation = validateSubPath(subPath ?? urlValidation.subPath);
  if (!subPathValidation.ok) {
    return { ok: false, error: subPathValidation.reason, message: subPathValidation.message };
  }
  const effectiveSubPath = subPathValidation.subPath;
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
    // codex round-1: when the user pasted a tree URL like
    // .../tree/feat/x/skills/research and their actual branch is
    // `feat/x`, our parser can only guess (branch=feat,
    // subPath=x/...). The clone then fails with "Remote branch
    // 'feat' not found". Detect that pattern and surface a specific
    // actionable hint so the user knows to use the #branch form.
    const stderr = cloneResult.stderr ?? "";
    const branchNotFound = /Remote branch .* not found|couldn't find remote ref|fatal: Remote branch/i.test(stderr);
    let cloneMessage = cloneResult.error?.message ?? "git clone failed";
    if (branchNotFound && effectiveSubPath && effectiveSubPath.includes("/")) {
      cloneMessage = `Branch '${effectiveBranch}' not found in ${urlValidation.owner}/${urlValidation.repo}. If your branch is actually a slash-form (e.g. ${effectiveBranch}/${effectiveSubPath.split("/")[0]}), paste the URL as https://github.com/${urlValidation.owner}/${urlValidation.repo}#<full/branch> and pass the sub-path separately.`;
    } else if (branchNotFound) {
      cloneMessage = `Branch '${effectiveBranch}' not found in ${urlValidation.owner}/${urlValidation.repo}.`;
    }
    return {
      ok: false,
      error: cloneResult.timedOut ? SKILL_INSTALL_ERROR.CLONE_TIMED_OUT : SKILL_INSTALL_ERROR.CLONE_FAILED,
      message: cloneMessage,
      stderr,
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
  // than failing the install — critical on Windows where file locks can
  // block recursive rm. Done in stage so the staged content already has
  // the right shape for finalize's atomic move.
  let gitRemoveFailed = false;
  if (removeGitDir) {
    const gitDir = path.join(stagingDir, ".git");
    if (await dirExists(gitDir)) {
      gitRemoveFailed = !(await tryRm(gitDir));
    }
  }

  // C18 #2: bind the previewed content to a deterministic hash so the
  // approval token (next commit) can detect any tampering between
  // stage-time and finalize-time. The hash spans owner/repo/branch/
  // subPath + the SKILL.md bytes the user is implicitly approving by
  // clicking Confirm.
  const contentHash = createHash("sha256")
    .update([urlValidation.owner, urlValidation.repo, effectiveBranch ?? "", effectiveSubPath ?? "", guarded.markdown].join(" "))
    .digest("hex")
    .slice(0, 16);

  return {
    ok: true,
    stagingInfo: {
      stagingDir,
      finalName,
      finalDir,
      owner: urlValidation.owner,
      repo: urlValidation.repo,
      branch: effectiveBranch,
      subPath: effectiveSubPath,
      targetIdentifier,
      skillDir: located.skillDir,
      entryPath: located.entryPath,
      descriptor: {
        heading: validation.heading,
        description: validation.description
      },
      preview: {
        markdown: guarded.markdown,
        // codex round-1: JS string `.length` is UTF-16 code units, not
        // bytes. A SKILL.md with CJK / emoji content would report the
        // wrong size. Use Buffer.byteLength(..., "utf8") for the real
        // on-disk byte count, matching how readSkillMarkdownGuarded
        // checks against SKILL_MD_MAX_BYTES.
        sizeBytes: Buffer.byteLength(guarded.markdown, "utf8"),
        contentHash
      },
      gitRemoveFailed,
      // codex round-1: removeGitDir is dead state at finalize time
      // (the .git removal already ran in stage). Dropped. `now` is
      // kept because finalize uses it for the backup-dir timestamp;
      // it's session-scoped so the function-as-state is acceptable.
      now
    }
  };
}

/**
 * Discard a staged install — clean up the temp clone dir without
 * promoting it. Safe to call on any non-finalized stagingInfo.
 */
export async function discardStagedInstall(stagingInfo) {
  if (!stagingInfo?.stagingDir) return;
  await tryRm(stagingInfo.stagingDir);
}

/**
 * Finalize a previously-staged install. Atomic-swaps the staging dir
 * into the final skills location and registers the rootPath. Returns
 * the same success shape installSkillFromGitHub used to return.
 *
 * The fsImpl + now opts default to staging's bound values so callers
 * don't need to track them; they can be overridden for tests.
 */
export async function finalizeStagedInstall(stagingInfo, {
  runtime,
  fsImpl = { rm, rename, mkdir, stat },
  now = stagingInfo?.now ?? (() => Date.now())
} = {}) {
  if (!stagingInfo || typeof stagingInfo !== "object") {
    return { ok: false, error: SKILL_INSTALL_ERROR.IO_FAILED, message: "stagingInfo is required" };
  }
  const { stagingDir, finalDir, owner, repo, branch, subPath, descriptor, gitRemoveFailed, skillDir } = stagingInfo;
  // codex round-1: `now` from stagingInfo is preferred so the backup
  // dir timestamp aligns with stage-time bookkeeping. Caller-supplied
  // `now` (the destructured kwarg above) overrides for tests.
  let backupDir = null;
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

  const skillRoot = skillDir === stagingDir
    ? finalDir
    : path.join(finalDir, path.relative(stagingDir, skillDir));

  const registries = appendRegistryEntry(runtime, skillRoot);

  return {
    ok: true,
    owner,
    repo,
    branch,
    subPath,
    rootPath: skillRoot,
    descriptor,
    registries: registries ?? [],
    warnings: gitRemoveFailed ? ["git_dir_remove_failed"] : []
  };
}

/**
 * Backwards-compatible wrapper. Stages, then if successful, finalizes.
 * Existing callers (POST /skills/install/github and the trial scripts)
 * continue to work unchanged.
 */
export async function installSkillFromGitHub(opts = {}) {
  const stageResult = await stageSkillFromGitHub(opts);
  if (!stageResult.ok) return stageResult;
  return finalizeStagedInstall(stageResult.stagingInfo, opts);
}
