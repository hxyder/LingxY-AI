import test from "node:test";
import assert from "node:assert/strict";

import { classifyContextSources } from "../../src/service/core/intent/context-sources.mjs";
import { renderBackgroundContextsBlock } from "../../src/service/core/intent/background-contexts.mjs";
import {
  applyUserMemoryProfileToContext,
  buildUserMemoryBackgroundEntries,
  sanitizeUserMemoryProfile
} from "../../src/service/memory/user-profile.mjs";

test("user memory profile sanitizes editable global and project notes", () => {
  const profile = sanitizeUserMemoryProfile({
    enabled: true,
    preferences: [
      "Prefer concise answers.",
      { text: "Prefer concise answers." },
      { text: "Use Chinese for UI status summaries.", id: "语言" }
    ],
    projectMemories: [
      { projectId: "proj_a", text: "Use the local design system." },
      { project_id: "proj_b", text: "Keep exports under E:/linxiDoc." }
    ]
  }, { now: "2026-05-08T00:00:00.000Z" });

  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.enabled, true);
  assert.equal(profile.preferences.length, 2);
  assert.equal(profile.projectMemories.length, 2);
  assert.equal(profile.projectMemories[0].projectId, "proj_a");
});

test("user memory profile builds background-only entries for matching project", () => {
  const profile = sanitizeUserMemoryProfile({
    preferences: [{ text: "Prefer tables for comparisons." }],
    projectMemories: [
      { projectId: "proj_a", text: "This project uses Playwright smoke tests." },
      { projectId: "proj_b", text: "Do not inject this note." }
    ]
  });
  const entries = buildUserMemoryBackgroundEntries(profile, { projectId: "proj_a" });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "user_profile");
  assert.equal(entries[1].kind, "project_memory");
  assert.match(entries[0].content, /Current user instruction override/i);
  assert.match(entries[1].content, /Playwright smoke tests/);
  assert.doesNotMatch(entries[1].content, /Do not inject this note/);
});

test("user memory injection stamps context metadata and remains background-only", () => {
  const context = applyUserMemoryProfileToContext(
    { text: "", selection_metadata: {} },
    {
      preferences: [{ id: "pref_response", text: "Prefer direct answers." }],
      projectMemories: [{ id: "pm_1", projectId: "proj_a", text: "Use local fixtures." }]
    },
    { projectId: "proj_a" }
  );

  assert.equal(context.selection_metadata.user_memory_injected, true);
  assert.deepEqual(context.selection_metadata.user_memory_ids, ["pref_response", "pm_1"]);
  assert.equal(context.background_contexts.length, 2);

  const sources = classifyContextSources({ text: "今天天气怎么样", contextPacket: context });
  assert.equal(sources.rag_background, true);
  assert.equal(sources.real_selection, false);

  const rendered = renderBackgroundContextsBlock(context);
  assert.match(rendered, /user_profile/);
  assert.match(rendered, /project_memory/);
  assert.match(rendered, /NOT the user's current request/);
});

test("disabled user memory does not inject entries", () => {
  const context = applyUserMemoryProfileToContext(
    { text: "hello", selection_metadata: {} },
    { enabled: false, preferences: [{ text: "Use Markdown." }] }
  );

  assert.equal(context.background_contexts?.length ?? 0, 0);
  assert.equal(context.selection_metadata?.user_memory_injected, undefined);
});
