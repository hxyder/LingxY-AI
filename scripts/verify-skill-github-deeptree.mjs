#!/usr/bin/env node
/**
 * verify-skill-github-deeptree.mjs — C18 #3 (UPGRADE_PLAN.md §C18)
 *
 * R asked (2026-05-08): "粘贴的是项目链接还是准确的路径的链接".
 *
 * Before this commit, validateGitHubSkillUrl only accepted
 * https://github.com/owner/repo[.git][#branch] — repo-root URLs.
 * A user pasting https://github.com/owner/repo/tree/main/skills/research
 * (the natural form when they're already viewing the skill folder in
 * their browser) would get an "Only https://github.com/owner/repo
 * URLs are supported" error.
 *
 * This verifier locks the new behaviour:
 *   - validateGitHubSkillUrl accepts /tree/<branch>/<sub/path> form.
 *   - validateSubPath rejects ../, leading slash, shell metas, and
 *     empty segments.
 *   - deriveFinalDirName disambiguates two repos with the same leaf
 *     name (`repoA/tools/research` vs `repoB/skills/research`).
 *   - Combining /tree/... with #branch is rejected as ambiguous.
 *
 * Constitution (CADRE C):
 *   - 不打补丁: validateSubPath + locateSkillDescriptorAt are class-
 *     level (charset / lstat / realpath). No per-repo carve-outs.
 *   - 不针对特定提问: a deep-tree URL from any repo with any branch
 *     name + any sub-path goes through the same validators.
 */

import assert from "node:assert/strict";
import {
  validateGitHubSkillUrl,
  validateSubPath,
  deriveFinalDirName,
  SKILL_INSTALL_ERROR
} from "../src/service/capabilities/skills/github-install.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------
// 1. Repo-root URLs still work (regression).
// ---------------------------------------------------------------------
{
  const r = validateGitHubSkillUrl("https://github.com/openai/agents");
  check("repo-root: ok=true", r.ok === true);
  check("repo-root: owner/repo parsed", r.owner === "openai" && r.repo === "agents");
  check("repo-root: subPath null", r.subPath === null);
  check("repo-root: fragmentBranch null", r.fragmentBranch === null);
}

{
  const r = validateGitHubSkillUrl("https://github.com/openai/agents.git#main");
  check("repo-root + #branch: ok=true", r.ok === true);
  check("repo-root + #branch: branch parsed", r.fragmentBranch === "main");
  check("repo-root + #branch: subPath null", r.subPath === null);
}

// ---------------------------------------------------------------------
// 2. Deep-tree URL form parses owner/repo/branch/subPath.
// ---------------------------------------------------------------------
{
  const r = validateGitHubSkillUrl("https://github.com/openai/agents/tree/main/skills/research");
  check("tree form: ok=true", r.ok === true);
  check("tree form: owner=openai", r.owner === "openai");
  check("tree form: repo=agents", r.repo === "agents");
  check("tree form: fragmentBranch=main (from /tree/main/)", r.fragmentBranch === "main");
  check("tree form: subPath=skills/research", r.subPath === "skills/research");
  check("tree form: cloneUrl points at the repo root",
    r.cloneUrl === "https://github.com/openai/agents.git");
}

{
  // Deeper subPath, with .git suffix on the repo segment.
  const r = validateGitHubSkillUrl("https://github.com/owner/multi.git/tree/feature-x/path/to/skill");
  check("tree form + .git suffix: ok=true", r.ok === true);
  check("tree form + .git suffix: branch=feature-x", r.fragmentBranch === "feature-x");
  check("tree form + .git suffix: subPath nested", r.subPath === "path/to/skill");
}

// ---------------------------------------------------------------------
// 3. Combining /tree/<branch>/ with #branch is rejected as ambiguous
//    (codex round-1).
// ---------------------------------------------------------------------
{
  const r = validateGitHubSkillUrl("https://github.com/owner/repo/tree/main/sub#dev");
  check("tree + #branch ambiguous: ok=false", r.ok === false);
  check("tree + #branch ambiguous: error code = invalid_url", r.reason === SKILL_INSTALL_ERROR.INVALID_URL);
  check("tree + #branch ambiguous: message names the conflict",
    typeof r.message === "string" && r.message.includes("ambiguous") || r.message.includes("exactly one"));
}

// ---------------------------------------------------------------------
// 4. validateSubPath: charset / .. / leading slash / shell metas.
// ---------------------------------------------------------------------
{
  // Happy paths.
  for (const p of ["skills/research", "a", "a/b/c", "tools/skill_v1", "v1.2.3"]) {
    const r = validateSubPath(p);
    check(`validateSubPath '${p}': ok=true`, r.ok === true);
  }

  // null / empty / whitespace-only → ok with subPath=null (legitimate
  // "no sub-path" case; install proceeds via locateSkillDescriptor).
  for (const empty of [null, "", "  ", "/", "//"]) {
    const r = validateSubPath(empty);
    check(`validateSubPath ${JSON.stringify(empty)}: ok=true, subPath=null`, r.ok === true && r.subPath === null);
  }

  // Reject ..
  for (const evil of ["../escape", "skills/../etc", "..", "skills/.."]) {
    const r = validateSubPath(evil);
    check(`validateSubPath '${evil}': rejected`, r.ok === false && r.reason === SKILL_INSTALL_ERROR.INVALID_SUBPATH);
  }

  // Reject .
  for (const dot of [".", "skills/.", "./skills"]) {
    const r = validateSubPath(dot);
    check(`validateSubPath '${dot}': rejected`, r.ok === false);
  }

  // Reject shell metas / spaces
  for (const evil of ["skills/$(rm)", "skills/`whoami`", "skills/'a'", "skills/with space", "skills/a;b", "skills/a|b"]) {
    const r = validateSubPath(evil);
    check(`validateSubPath '${evil}': illegal char rejected`, r.ok === false);
  }

  // Reject backslash separator.
  {
    const r = validateSubPath("skills\\research");
    check("validateSubPath uses-backslash: rejected", r.ok === false);
  }

  // Reject leading dash on segment (looks like option injection).
  {
    const r = validateSubPath("skills/-rf");
    check("validateSubPath leading-dash segment: rejected", r.ok === false);
  }

  // Reject overlong segment.
  {
    const r = validateSubPath("a".repeat(81));
    check("validateSubPath segment >80 chars: rejected", r.ok === false);
  }
}

// ---------------------------------------------------------------------
// 5. URL with a sub-path that itself fails validation: the URL parser
//    succeeds at the URL layer; the subsequent validateSubPath layer
//    catches it. This split is intentional so the URL parser stays
//    focused on URL syntax.
// ---------------------------------------------------------------------
{
  const r = validateGitHubSkillUrl("https://github.com/owner/repo/tree/main/skills/with space");
  // The URL regex is permissive on subPath chars (URL-decoded form),
  // so parsing succeeds; validateSubPath rejects later.
  if (r.ok) {
    const subValidation = validateSubPath(r.subPath);
    check("URL with bad subPath: passes URL parser, fails subPath validator",
      subValidation.ok === false);
  } else {
    // Either layer rejecting is acceptable as long as the install
    // path doesn't accept the bad path.
    check("URL with bad subPath: rejected at URL layer", true);
  }
}

// ---------------------------------------------------------------------
// 6. Owner/repo with .. is rejected at URL level.
// ---------------------------------------------------------------------
{
  // Note: GitHub doesn't allow .. in owner/repo names anyway, but
  // defense in depth.
  const r = validateGitHubSkillUrl("https://github.com/ow..ner/repo/tree/main/skills/research");
  check("URL with .. in owner: ok=false", r.ok === false);
}

// ---------------------------------------------------------------------
// 7. Slash-branch ambiguity (codex round-1 finding 1).
//
//    A URL like `.../tree/feat/x/skills/research` is FUNDAMENTALLY
//    ambiguous from the URL alone — without a GitHub API call we
//    cannot tell whether the branch is `feat` (with subPath
//    `x/skills/research`) or `feat/x` (with subPath
//    `skills/research`). Both are valid GitHub layouts.
//
//    The parser's policy: take the first-segment-as-branch best
//    guess and let the install-time error path surface a specific
//    hint when the guess turns out wrong (the clone fails with
//    "Remote branch 'feat' not found").
//
//    Users with slash-branches must paste the URL as
//    https://github.com/owner/repo#feat/x — the `#branch` fragment
//    is unambiguous and the sub-path is then a separate kwarg.
// ---------------------------------------------------------------------
{
  const r = validateGitHubSkillUrl("https://github.com/owner/repo/tree/feat/x/skills/research");
  check("slash-branch tree: parses with first-segment best guess", r.ok === true);
  check("slash-branch tree: branch=first segment (feat)", r.fragmentBranch === "feat");
  check("slash-branch tree: subPath=remaining segments",
    r.subPath === "x/skills/research");
}

{
  // Same actual branch via #branch + repo-root form is unambiguous.
  const r = validateGitHubSkillUrl("https://github.com/owner/repo#feat/x");
  check("slash-branch via #branch: ok=true", r.ok === true);
  check("slash-branch via #branch: branch parsed", r.fragmentBranch === "feat/x");
  check("slash-branch via #branch: subPath null (must be passed separately)",
    r.subPath === null);
}

// ---------------------------------------------------------------------
// 7b. Install-time helper for slash-branch ambiguity. When clone
//     fails with "Remote branch 'X' not found" AND the user pasted
//     a tree URL with a multi-segment subPath, the error message
//     points them at the #branch fallback form.
// ---------------------------------------------------------------------
{
  const { installSkillFromGitHub } = await import("../src/service/capabilities/skills/github-install.mjs");
  // Stub spawnImpl that fails with a "Remote branch not found" stderr.
  let cloneAttempted = false;
  const stubSpawn = (command, args) => {
    cloneAttempted = true;
    const stderrChunks = [];
    const child = {
      stderr: { on: (event, cb) => { if (event === "data") stderrChunks.push(cb); } },
      stdout: { on: () => {} },
      kill: () => {},
      on: (event, cb) => {
        if (command === "git" && args[0] === "--version") {
          // probe: succeed
          if (event === "close") setImmediate(() => cb(0, null));
          return;
        }
        // git clone -b feat → fail with branch-not-found stderr
        if (event === "data") return;
        if (event === "close") {
          setImmediate(() => {
            for (const cb2 of stderrChunks) {
              cb2(Buffer.from("fatal: Remote branch feat not found in upstream origin\n", "utf8"));
            }
            cb(1, null);
          });
        }
      }
    };
    return child;
  };
  const stubRuntime = {
    paths: { skillsDir: "/tmp/lingxy-test-skills" }
  };
  const result = await installSkillFromGitHub({
    url: "https://github.com/owner/repo/tree/feat/x/skills/research",
    runtime: stubRuntime,
    spawnImpl: stubSpawn,
    fsImpl: {
      mkdir: async () => {},
      rename: async () => {},
      rm: async () => {},
      stat: async () => ({ isDirectory: () => false })
    }
  });
  check("install-time helper: result.ok=false on branch-not-found", result.ok === false);
  check("install-time helper: error code = clone_failed",
    result.error === SKILL_INSTALL_ERROR.CLONE_FAILED);
  check("install-time helper: message hints at slash-branch + #branch fallback",
    typeof result.message === "string"
      && result.message.includes("slash-form")
      && result.message.includes("#"));
  check("install-time helper: clone was actually attempted", cloneAttempted === true);
}

// ---------------------------------------------------------------------
// 8. Final dir naming: subPath disambiguation (codex round-1 finding 2).
//    Round-0 only used the leaf segment, so `skills/research` and
//    `tools/research` in the same repo collided at
//    `owner--repo--research`. Round-1 fix: slug the FULL subPath.
// ---------------------------------------------------------------------
{
  const a = deriveFinalDirName("owner", "repo", "skills/research");
  const b = deriveFinalDirName("owner", "repo", "tools/research");
  check("naming: skills/research and tools/research are distinct dirs", a !== b);
  check("naming: skills/research includes both segments",
    a.includes("skills") && a.includes("research"));
  check("naming: tools/research includes both segments",
    b.includes("tools") && b.includes("research"));
}

{
  // Same repo + same subPath → same dir (deterministic).
  const a1 = deriveFinalDirName("owner", "repo", "skills/research");
  const a2 = deriveFinalDirName("owner", "repo", "skills/research");
  check("naming: deterministic — same input → same dir", a1 === a2);
}

{
  // Repo-root install (subPath null) keeps the legacy shape.
  const a = deriveFinalDirName("owner", "repo");
  check("naming: no subPath → owner--repo only", a === "owner--repo");
  const b = deriveFinalDirName("owner", "repo", "");
  check("naming: empty subPath → owner--repo only", b === "owner--repo");
}

{
  // Long subPath gets truncated + hashed; two distinct long paths
  // with same leaf still produce distinct dirs.
  const long1 = "a/very/deep/and/long/path/to/research";
  const long2 = "another/very/deep/and/long/path/to/research";
  const a = deriveFinalDirName("owner", "repo", long1);
  const b = deriveFinalDirName("owner", "repo", long2);
  check(`naming: long subPaths with same leaf are distinct (${a} vs ${b})`, a !== b);
  check("naming: long subPaths produce dir name within reasonable length",
    a.length < 80 && b.length < 80);
  // Determinism even after hashing.
  const a2 = deriveFinalDirName("owner", "repo", long1);
  check("naming: long subPath also deterministic", a === a2);
}

{
  // Repo-name collision: same subPath in two different repos still distinct.
  const a = deriveFinalDirName("alice", "shared", "skills/research");
  const b = deriveFinalDirName("bob", "shared", "skills/research");
  check("naming: cross-repo same subPath still distinct dirs", a !== b);
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
