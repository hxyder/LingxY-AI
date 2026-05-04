import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createEditableSkill,
  duplicateEditableSkill,
  listSkillHistory,
  resolveEditableSkillEntryPath,
  rollbackSkillMarkdown,
  slugifySkillId,
  testEditableSkill,
  writeSkillMarkdownWithBackup
} from "../../src/service/ai/skills/lifecycle.mjs";
import { createSkillRegistry } from "../../src/service/ai/skills/registry.mjs";
import { createConfiguredSkillRegistry } from "../../src/service/ai/skills/builtin.mjs";

async function makeRuntime() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingxy-skills-"));
  return {
    paths: { skillsDir: root },
    configStore: { load: () => ({}) }
  };
}

test("skill lifecycle creates editable skills under the runtime skills root", async () => {
  const runtime = await makeRuntime();
  const created = await createEditableSkill(runtime, {
    name: "Write Reports",
    description: "Create repeatable report workflows."
  });

  assert.equal(created.ok, true);
  assert.equal(created.id, "write-reports");
  assert.equal(path.basename(created.entryPath), "SKILL.md");
  assert.equal(resolveEditableSkillEntryPath(runtime, created.entryPath), created.entryPath);
  assert.equal(created.validation.ok, true);
  assert.match(await readFile(created.entryPath, "utf8"), /# Write Reports/);
});

test("skill lifecycle duplicates a skill without overwriting the source", async () => {
  const runtime = await makeRuntime();
  const created = await createEditableSkill(runtime, {
    id: "draft-email",
    name: "Draft Email",
    description: "Draft reusable email replies."
  });
  const duplicate = await duplicateEditableSkill(runtime, {
    entryPath: created.entryPath,
    name: "Draft Email Variant"
  });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.id, "draft-email-copy");
  assert.notEqual(duplicate.entryPath, created.entryPath);
  assert.match(await readFile(duplicate.entryPath, "utf8"), /# Draft Email Variant/);
  assert.match(await readFile(created.entryPath, "utf8"), /# Draft Email/);
});

test("skill lifecycle writes backups and restores the latest backup", async () => {
  const runtime = await makeRuntime();
  const created = await createEditableSkill(runtime, {
    id: "qa",
    name: "QA",
    description: "Check quality."
  });
  const first = await writeSkillMarkdownWithBackup(runtime, {
    entryPath: created.entryPath,
    markdown: "# QA\n\ndescription: Updated once.\n"
  });
  assert.ok(first.backup?.id);
  const second = await writeSkillMarkdownWithBackup(runtime, {
    entryPath: created.entryPath,
    markdown: "# QA\n\ndescription: Updated twice.\n"
  });
  assert.ok(second.backup?.id);

  const history = await listSkillHistory(runtime, created.entryPath);
  assert.equal(history.history.length, 2);
  const restored = await rollbackSkillMarkdown(runtime, { entryPath: created.entryPath });
  assert.equal(restored.ok, true);
  assert.match(restored.markdown, /Updated once|Check quality/);
  assert.match(await readFile(created.entryPath, "utf8"), /Updated once|Check quality/);
});

test("skill lifecycle prunes old history entries with a bounded retention limit", async () => {
  const runtime = await makeRuntime();
  runtime.skillHistoryLimit = 3;
  const created = await createEditableSkill(runtime, {
    id: "retention",
    name: "Retention",
    description: "Check history retention."
  });

  for (let index = 0; index < 6; index += 1) {
    const written = await writeSkillMarkdownWithBackup(runtime, {
      entryPath: created.entryPath,
      markdown: `# Retention\n\ndescription: version ${index}\n`
    });
    assert.equal(written.backup?.retention.limit, 3);
  }

  const history = await listSkillHistory(runtime, created.entryPath);
  assert.equal(history.history.length, 3);
  const uniqueIds = new Set(history.history.map((entry) => entry.id));
  assert.equal(uniqueIds.size, 3);
});

test("skill lifecycle test reports validation, saved state, and runtime discovery", async () => {
  const runtime = await makeRuntime();
  const created = await createEditableSkill(runtime, {
    id: "planner-visible",
    name: "Planner Visible",
    description: "Visible to the skill registry."
  });
  runtime.platform = {
    skillRegistries: createSkillRegistry([
      createConfiguredSkillRegistry({
        id: "runtime-skills",
        rootPath: runtime.paths.skillsDir
      })
    ])
  };

  const ready = await testEditableSkill(runtime, { entryPath: created.entryPath });
  assert.equal(ready.ok, true);
  assert.equal(ready.validation.ok, true);
  assert.equal(ready.saved, true);
  assert.equal(ready.discovery.checked, true);
  assert.equal(ready.discovery.discovered, true);
  assert.equal(ready.discovery.registry, "runtime-skills");

  const draft = await testEditableSkill(runtime, {
    entryPath: created.entryPath,
    markdown: "# Planner Visible\n\n"
  });
  assert.equal(draft.ok, false);
  assert.equal(draft.saved, false);
  assert.equal(draft.validation.ok, false);
  assert.ok(draft.checks.some((check) => check.id === "saved_to_disk" && check.ok === false));
});

test("skill lifecycle rejects paths outside editable skill roots", async () => {
  const runtime = await makeRuntime();
  const outside = path.join(os.tmpdir(), "outside-skill", "SKILL.md");

  assert.equal(resolveEditableSkillEntryPath(runtime, outside), null);
  await assert.rejects(
    () => writeSkillMarkdownWithBackup(runtime, { entryPath: outside, markdown: "# Outside\n\ndescription: no\n" }),
    /skill_path_not_allowed/
  );
});

test("skill ids are path-safe and not topic-specific", () => {
  assert.equal(slugifySkillId("Draft Email++ v2"), "draft-email-v2");
  assert.equal(slugifySkillId(""), "skill");
});
