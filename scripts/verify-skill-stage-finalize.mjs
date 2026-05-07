#!/usr/bin/env node
/**
 * verify-skill-stage-finalize.mjs — C18 #2a (UPGRADE_PLAN.md §C18)
 *
 * D pre-design ACCEPT (2026-05-08): for the LLM-callable install
 * action tool to surface a real SKILL.md preview in the approval
 * card BEFORE the user commits, the install pipeline must be split
 * into a stage phase (clone + validate) and a finalize phase
 * (atomic swap + registry append). Single-step requires_confirmation
 * cannot satisfy this — the approval is created BEFORE execute, so
 * the SKILL.md doesn't exist yet at preview time.
 *
 * This verifier locks the split:
 *   - stageSkillFromGitHub returns stagingInfo with all the data the
 *     approval card needs (owner/repo/branch/subPath, descriptor
 *     heading + description, full SKILL.md markdown, content hash).
 *   - finalizeStagedInstall promotes a stagingInfo to its final dir
 *     and updates the registry. Idempotent on already-installed
 *     skills (atomic-swap with backup + rollback).
 *   - discardStagedInstall cleans up an unconfirmed staging dir.
 *   - installSkillFromGitHub remains a thin shim (stage → finalize)
 *     for existing callers.
 *
 * Constitution (CADRE C):
 *   - 不打补丁: split is a clean phase boundary; existing
 *     installSkillFromGitHub stays shape-compatible via the shim
 *     so no caller needs to change.
 *   - 不针对特定提问: the contentHash spans owner/repo/branch/subPath
 *     + SKILL.md bytes — domain-class signature. Approval tokens
 *     (built in the next commit) can detect tampering between
 *     stage and finalize without per-skill carve-outs.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  stageSkillFromGitHub,
  finalizeStagedInstall,
  discardStagedInstall,
  installSkillFromGitHub,
  SKILL_INSTALL_ERROR
} from "../src/service/ai/skills/github-install.mjs";

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

// Stub spawn that materialises a SKILL.md inside the requested
// staging directory, mimicking `git clone --depth 1 -b X <url> <dst>`.
function makeFakeSpawn({ skillBody, makeSubDir = null } = {}) {
  return (command, args) => {
    const stderrChunks = [];
    const child = {
      stderr: { on: (event, cb) => { if (event === "data") stderrChunks.push(cb); } },
      stdout: { on: () => {} },
      kill: () => {},
      on: (event, cb) => {
        if (command === "git" && args[0] === "--version") {
          if (event === "close") setImmediate(() => cb(0, null));
          return;
        }
        if (command === "git" && args[0] === "clone") {
          const targetDir = args[args.length - 1];
          const skillDir = makeSubDir ? path.join(targetDir, makeSubDir) : targetDir;
          (async () => {
            try {
              await mkdir(skillDir, { recursive: true });
              await writeFile(path.join(skillDir, "SKILL.md"), skillBody, "utf8");
              if (event === "close") cb(0, null);
            } catch (err) {
              for (const chunk of stderrChunks) chunk(Buffer.from(err.message, "utf8"));
              if (event === "close") cb(1, null);
            }
          })();
          return;
        }
        if (event === "close") setImmediate(() => cb(1, null));
      }
    };
    return child;
  };
}

const VALID_SKILL_MD = `# Research Skill

Helps gather sources for a research task.

## Activation

Trigger when the user asks for "research" or "find sources".

## Steps

1. Use web_search_fetch to gather candidates.
2. Filter by relevance + recency.
3. Summarise in markdown.
`;

async function withTempSkillsDir(label, fn) {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lingxy-skill-stage-"));
  const skillsDir = path.join(tmpRoot, "skills");
  await mkdir(skillsDir, { recursive: true });
  try {
    await fn({ skillsDir, tmpRoot });
  } finally {
    try { await rm(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------
// 1. stageSkillFromGitHub returns rich stagingInfo without committing
//    anything to the user's installed skills.
// ---------------------------------------------------------------------
await withTempSkillsDir("stage shape", async ({ skillsDir }) => {
  const result = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  check("stage: ok=true", result.ok === true);
  check("stage: owner/repo parsed", result.stagingInfo?.owner === "owner" && result.stagingInfo?.repo === "repo");
  check("stage: descriptor heading + description present",
    typeof result.stagingInfo?.descriptor?.heading === "string"
    && typeof result.stagingInfo?.descriptor?.description === "string");
  check("stage: preview.markdown is the full SKILL.md",
    result.stagingInfo?.preview?.markdown === VALID_SKILL_MD);
  check("stage: preview.contentHash is a stable 16-char hash",
    typeof result.stagingInfo?.preview?.contentHash === "string"
    && result.stagingInfo.preview.contentHash.length === 16);
  check("stage: stagingDir exists on disk (clone materialised)",
    Boolean(await stat(result.stagingInfo.stagingDir).catch(() => null)));
  check("stage: finalDir is NOT created yet (no user-visible mutation)",
    (await stat(result.stagingInfo.finalDir).catch(() => null)) === null);
  // Cleanup so we don't leave the dir around.
  await discardStagedInstall(result.stagingInfo);
});

// ---------------------------------------------------------------------
// 2. discardStagedInstall removes the staging dir.
// ---------------------------------------------------------------------
await withTempSkillsDir("discard cleanup", async ({ skillsDir }) => {
  const result = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  check("discard: pre-condition stagingDir exists",
    Boolean(await stat(result.stagingInfo.stagingDir).catch(() => null)));
  await discardStagedInstall(result.stagingInfo);
  check("discard: stagingDir removed",
    (await stat(result.stagingInfo.stagingDir).catch(() => null)) === null);
});

// ---------------------------------------------------------------------
// 3. finalizeStagedInstall promotes staging into the final skill dir.
// ---------------------------------------------------------------------
await withTempSkillsDir("finalize promotes", async ({ skillsDir }) => {
  const stage = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  check("finalize-precond: stage ok", stage.ok === true);
  const finalize = await finalizeStagedInstall(stage.stagingInfo, {
    runtime: { paths: { skillsDir }, configStore: null }
  });
  check("finalize: ok=true", finalize.ok === true);
  check("finalize: rootPath returned",
    typeof finalize.rootPath === "string" && finalize.rootPath.length > 0);
  check("finalize: finalDir now exists with SKILL.md",
    Boolean(await stat(path.join(finalize.rootPath, "SKILL.md")).catch(() => null)));
  check("finalize: stagingDir is gone (atomic move)",
    (await stat(stage.stagingInfo.stagingDir).catch(() => null)) === null);
  check("finalize: descriptor heading preserved",
    typeof finalize.descriptor?.heading === "string");
});

// ---------------------------------------------------------------------
// 4. installSkillFromGitHub still works as a one-shot shim.
// ---------------------------------------------------------------------
await withTempSkillsDir("shim end-to-end", async ({ skillsDir }) => {
  const result = await installSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir }, configStore: null },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  check("shim: ok=true", result.ok === true);
  check("shim: rootPath populated", typeof result.rootPath === "string");
  check("shim: finalDir contains SKILL.md",
    Boolean(await stat(path.join(result.rootPath, "SKILL.md")).catch(() => null)));
});

// ---------------------------------------------------------------------
// 5. stage error paths short-circuit cleanly (no orphan staging dir).
// ---------------------------------------------------------------------
await withTempSkillsDir("invalid url short-circuit", async ({ skillsDir }) => {
  const result = await stageSkillFromGitHub({
    url: "https://gitlab.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  check("invalid url: ok=false", result.ok === false);
  check("invalid url: error code = invalid_url",
    result.error === SKILL_INSTALL_ERROR.INVALID_URL);
});

// ---------------------------------------------------------------------
// 6. Determinism: same URL + same SKILL.md bytes → same contentHash.
//    This is what the approval token (next commit) will rely on to
//    detect tampering between stage and finalize.
// ---------------------------------------------------------------------
await withTempSkillsDir("contentHash determinism", async ({ skillsDir }) => {
  const a = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  const b = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  check("hash: deterministic across two stages of the same URL+content",
    a.stagingInfo.preview.contentHash === b.stagingInfo.preview.contentHash);
  await discardStagedInstall(a.stagingInfo);
  await discardStagedInstall(b.stagingInfo);
});

// ---------------------------------------------------------------------
// 7. Different SKILL.md bytes → different contentHash (tamper detection).
// ---------------------------------------------------------------------
await withTempSkillsDir("contentHash tamper detection", async ({ skillsDir }) => {
  const a = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: VALID_SKILL_MD })
  });
  const tampered = VALID_SKILL_MD + "\n\n## Hidden steal-secrets step";
  const b = await stageSkillFromGitHub({
    url: "https://github.com/owner/repo",
    runtime: { paths: { skillsDir } },
    spawnImpl: makeFakeSpawn({ skillBody: tampered })
  });
  check("hash: tampered SKILL.md → different hash (token would invalidate)",
    a.stagingInfo.preview.contentHash !== b.stagingInfo.preview.contentHash);
  await discardStagedInstall(a.stagingInfo);
  await discardStagedInstall(b.stagingInfo);
});

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
