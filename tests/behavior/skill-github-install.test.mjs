import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  installSkillFromGitHub,
  validateGitHubSkillUrl,
  validateBranchName,
  SKILL_INSTALL_ERROR
} from "../../src/service/ai/skills/github-install.mjs";
import { deriveSkillRegistryId } from "../../src/service/ai/skills/discovery.mjs";

// ─── URL / branch validation ───────────────────────────────────────────────

test("validateGitHubSkillUrl accepts canonical and trailing-slash forms", () => {
  for (const url of [
    "https://github.com/owner/repo",
    "https://github.com/owner/repo.git",
    "https://github.com/owner/repo/",
    "https://github.com/owner/repo#main"
  ]) {
    const result = validateGitHubSkillUrl(url);
    assert.equal(result.ok, true, `expected pass: ${url}`);
    assert.equal(result.owner, "owner");
    assert.equal(result.repo, "repo");
  }
});

test("validateGitHubSkillUrl rejects non-github / non-https / userinfo / path traversal", () => {
  for (const bad of [
    "git@github.com:owner/repo.git",
    "http://github.com/owner/repo",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.com/owner/repo",
    "https://x:y@github.com/owner/repo",
    "https://github.com/../etc/passwd/repo",
    "",
    "not a url"
  ]) {
    const result = validateGitHubSkillUrl(bad);
    assert.equal(result.ok, false, `expected reject: ${bad}`);
    assert.equal(result.reason, SKILL_INSTALL_ERROR.INVALID_URL);
  }
});

test("validateBranchName accepts common legal git ref names", () => {
  for (const name of ["main", "feature-x", "feat/x", "v1.2.3", "release-2026.05"]) {
    const result = validateBranchName(name);
    assert.equal(result.ok, true, JSON.stringify(name) + ": " + JSON.stringify(result));
    assert.equal(result.branch, name);
  }
});

test("validateBranchName rejects argument-injection shapes and git-illegal refs", () => {
  assert.equal(validateBranchName("").ok, true);
  assert.equal(validateBranchName(null).ok, true);
  for (const bad of [
    "-main", "--upload-pack=foo",
    "with space", "tab\there", "quote'name", "back`tick",
    "main^", "main:foo", "main?", "main*", "main[", "main\\",
    "main..", "main@{1}", "main/", "main.", "foo.lock",
    // Codex final-review additions: full git check-ref-format set.
    "/main", "feat//x", ".foo", "foo/.bar", "foo.lock/bar", "@"
  ]) {
    const result = validateBranchName(bad);
    assert.equal(result.ok, false, "expected reject: " + JSON.stringify(bad) + " got " + JSON.stringify(result));
    assert.equal(result.reason, SKILL_INSTALL_ERROR.INVALID_BRANCH);
  }
});

// ─── installSkillFromGitHub end-to-end with fake spawn + real fs ───────────

function makeSpawnImpl({ scenarios }) {
  return (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit("close", null, "SIGTERM"); };

    const handler = scenarios.shift();
    if (!handler) {
      throw new Error(`no scenario for ${command} ${args.join(" ")}`);
    }
    setImmediate(() => handler({ command, args, child }));
    return child;
  };
}

function gitVersionScenario() {
  return ({ child }) => {
    child.stdout.write("git version 2.46.0\n");
    child.emit("close", 0, null);
  };
}

function gitCloneScenario({ skillFiles = { "SKILL.md": "# My Skill\n\ndescription: a test skill\n" }, exitCode = 0, stderr = "" } = {}) {
  return async ({ args, child }) => {
    if (exitCode === 0) {
      // The last arg is the staging dir. Materialise it on disk so the
      // descriptor locator and atomic swap can run for real.
      const stagingDir = args[args.length - 1];
      await mkdir(stagingDir, { recursive: true });
      // Always lay down a .git/ so we test the "remove .git" path too.
      await mkdir(path.join(stagingDir, ".git"), { recursive: true });
      await writeFile(path.join(stagingDir, ".git", "HEAD"), "ref: refs/heads/main\n");
      for (const [relPath, body] of Object.entries(skillFiles)) {
        const full = path.join(stagingDir, relPath);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, body, "utf8");
      }
      child.emit("close", 0, null);
    } else {
      if (stderr) child.stderr.write(stderr);
      child.emit("close", exitCode, null);
    }
  };
}

async function withTempRuntime(fn) {
  const skillsDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-skills-"));
  let savedConfig = { ai: { skills: { registries: [] } } };
  const runtime = {
    paths: { skillsDir },
    configStore: {
      load: () => JSON.parse(JSON.stringify(savedConfig)),
      save: (next) => { savedConfig = JSON.parse(JSON.stringify(next)); return savedConfig; }
    }
  };
  try {
    return await fn({ runtime, skillsDir, getConfig: () => savedConfig });
  } finally {
    await rm(skillsDir, { recursive: true, force: true });
  }
}

test("happy path: clones, validates SKILL.md, swaps into final, registers rootPath", async () => {
  await withTempRuntime(async ({ runtime, skillsDir, getConfig }) => {
    const spawnImpl = makeSpawnImpl({
      scenarios: [gitVersionScenario(), gitCloneScenario()]
    });
    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/repo",
      runtime,
      spawnImpl
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.owner, "owner");
    assert.equal(result.repo, "repo");
    const finalDir = path.join(skillsDir, "external", "owner--repo");
    assert.equal(result.rootPath, finalDir);
    assert.ok(existsSync(path.join(finalDir, "SKILL.md")), "SKILL.md present at final path");
    assert.ok(!existsSync(path.join(finalDir, ".git")), ".git was removed");
    const registries = getConfig().ai.skills.registries;
    assert.equal(registries.length, 1);
    assert.equal(registries[0].id, deriveSkillRegistryId(finalDir, { source: "github_install" }));
    assert.equal(registries[0].displayName, "My Skill");
    assert.equal(registries[0].rootPath, finalDir);
    assert.equal(registries[0].source, "github_install");
  });
});

test("descriptor missing: cleans staging and does NOT touch config", async () => {
  await withTempRuntime(async ({ runtime, skillsDir, getConfig }) => {
    const spawnImpl = makeSpawnImpl({
      scenarios: [
        gitVersionScenario(),
        gitCloneScenario({ skillFiles: { "README.md": "# nope" } })
      ]
    });
    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/repo",
      runtime,
      spawnImpl
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, SKILL_INSTALL_ERROR.DESCRIPTOR_MISSING);
    const externals = await readdir(path.join(skillsDir, "external")).catch(() => []);
    assert.deepEqual(externals.filter((e) => !e.startsWith(".")), [], "no externals registered");
    assert.deepEqual(externals.filter((e) => e.startsWith(".staging")), [], "staging dir cleaned");
    assert.equal(getConfig().ai.skills.registries.length, 0, "config registries untouched");
  });
});

test("descriptor too large: rejects without registering", async () => {
  await withTempRuntime(async ({ runtime, getConfig }) => {
    const big = `# big\n${"x".repeat(105 * 1024)}`;
    const spawnImpl = makeSpawnImpl({
      scenarios: [gitVersionScenario(), gitCloneScenario({ skillFiles: { "SKILL.md": big } })]
    });
    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/repo",
      runtime,
      spawnImpl
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, SKILL_INSTALL_ERROR.DESCRIPTOR_TOO_LARGE);
    assert.equal(getConfig().ai.skills.registries.length, 0);
  });
});

test("clone failure: surfaces clone_failed and cleans staging", async () => {
  await withTempRuntime(async ({ runtime, skillsDir }) => {
    const spawnImpl = makeSpawnImpl({
      scenarios: [
        gitVersionScenario(),
        gitCloneScenario({ exitCode: 128, stderr: "fatal: repository not found" })
      ]
    });
    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/missing",
      runtime,
      spawnImpl
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, SKILL_INSTALL_ERROR.CLONE_FAILED);
    const externals = await readdir(path.join(skillsDir, "external")).catch(() => []);
    assert.deepEqual(externals, [], "no leftovers under external");
  });
});

test("git not installed: returns git_not_installed without attempting clone", async () => {
  await withTempRuntime(async ({ runtime }) => {
    const spawnImpl = makeSpawnImpl({
      scenarios: [
        ({ child }) => { child.emit("close", 127, null); }
      ]
    });
    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/repo",
      runtime,
      spawnImpl
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, SKILL_INSTALL_ERROR.GIT_NOT_INSTALLED);
  });
});

test("re-install of same repo overwrites via atomic swap and dedupes registry", async () => {
  await withTempRuntime(async ({ runtime, skillsDir, getConfig }) => {
    const spawnImpl = makeSpawnImpl({
      scenarios: [
        gitVersionScenario(),
        gitCloneScenario({ skillFiles: { "SKILL.md": "# v1\ndescription: first\n" } }),
        gitVersionScenario(),
        gitCloneScenario({ skillFiles: { "SKILL.md": "# v2\ndescription: second\n" } })
      ]
    });
    const r1 = await installSkillFromGitHub({ url: "https://github.com/owner/repo", runtime, spawnImpl });
    const r2 = await installSkillFromGitHub({ url: "https://github.com/owner/repo", runtime, spawnImpl });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    const finalDir = path.join(skillsDir, "external", "owner--repo");
    const skillBody = await readFile(path.join(finalDir, "SKILL.md"), "utf8");
    assert.match(skillBody, /# v2/);
    assert.equal(getConfig().ai.skills.registries.length, 1, "registry deduped");
    const externals = await readdir(path.join(skillsDir, "external")).catch(() => []);
    assert.deepEqual(externals.filter((e) => e.startsWith(".backup")), [], "backup cleaned after swap");
    assert.deepEqual(externals.filter((e) => e.startsWith(".staging")), [], "staging cleaned after swap");
  });
});

test("rollback failure during atomic swap preserves backupPath in the error", async () => {
  await withTempRuntime(async ({ runtime, skillsDir }) => {
    const finalDir = path.join(skillsDir, "external", "owner--repo");
    await mkdir(finalDir, { recursive: true });
    await writeFile(path.join(finalDir, "SKILL.md"), "# old\ndescription: previous version\n");

    const spawnImpl = makeSpawnImpl({
      scenarios: [
        gitVersionScenario(),
        gitCloneScenario({ skillFiles: { "SKILL.md": "# new\ndescription: next\n" } })
      ]
    });

    const fsModule = await import("node:fs/promises");
    let renameCalls = 0;
    const fsImpl = {
      mkdir: fsModule.mkdir,
      stat: fsModule.stat,
      rm: fsModule.rm,
      rename: async (from, to) => {
        renameCalls += 1;
        // 1st: final -> backup (succeed)
        // 2nd: staging -> final (fail with EBUSY)
        // 3rd: backup -> final rollback (also fail)
        if (renameCalls === 1) return fsModule.rename(from, to);
        if (renameCalls === 2) {
          const err = new Error("EBUSY: locked"); err.code = "EBUSY"; throw err;
        }
        if (renameCalls === 3) {
          const err = new Error("EPERM: rollback also blocked"); err.code = "EPERM"; throw err;
        }
        return fsModule.rename(from, to);
      }
    };

    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/repo",
      runtime,
      spawnImpl,
      fsImpl
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, SKILL_INSTALL_ERROR.FINAL_LOCKED);
    assert.match(result.backupPath ?? "", /\.backup-/);
    assert.match(result.recovery ?? "", /Rename it back/);
    assert.ok(existsSync(result.backupPath), "backup must remain on disk for manual recovery");
    const backupSkill = await readFile(path.join(result.backupPath, "SKILL.md"), "utf8");
    assert.match(backupSkill, /# old/);
  });
});

test("locates SKILL.md in a top-level subdirectory when not at the repo root", async () => {
  await withTempRuntime(async ({ runtime }) => {
    const spawnImpl = makeSpawnImpl({
      scenarios: [
        gitVersionScenario(),
        gitCloneScenario({ skillFiles: {
          "my-skill/SKILL.md": "# Sub Skill\ndescription: in subfolder\n",
          "README.md": "# top-level"
        } })
      ]
    });
    const result = await installSkillFromGitHub({ url: "https://github.com/owner/repo", runtime, spawnImpl });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.rootPath, /external[\\/]+owner--repo[\\/]+my-skill$/);
  });
});

test("branch arg is forwarded to git clone via -b", async () => {
  await withTempRuntime(async ({ runtime }) => {
    let observedArgs;
    const spawnImpl = makeSpawnImpl({
      scenarios: [
        gitVersionScenario(),
        async ({ args, child }) => {
          observedArgs = args;
          await mkdir(args[args.length - 1], { recursive: true });
          await writeFile(path.join(args[args.length - 1], "SKILL.md"), "# x\ndescription: y\n");
          child.emit("close", 0, null);
        }
      ]
    });
    const result = await installSkillFromGitHub({
      url: "https://github.com/owner/repo",
      branch: "feat/x",
      runtime,
      spawnImpl
    });
    assert.equal(result.ok, true);
    assert.equal(result.branch, "feat/x");
    assert.ok(observedArgs.includes("-b"));
    assert.equal(observedArgs[observedArgs.indexOf("-b") + 1], "feat/x");
    assert.ok(observedArgs.includes("--depth"));
    assert.equal(observedArgs[observedArgs.indexOf("--depth") + 1], "1");
  });
});
