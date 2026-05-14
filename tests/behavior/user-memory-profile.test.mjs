import test from "node:test";
import assert from "node:assert/strict";

import { classifyContextSources } from "../../src/service/core/intent/context-sources.mjs";
import { renderBackgroundContextsBlock } from "../../src/service/core/intent/background-contexts.mjs";
import { compileContextForTask } from "../../src/service/core/context/context-compiler.mjs";
import {
  applyUserMemoryProfileToContext,
  approveMemoryProposal,
  buildUserMemoryBackgroundEntries,
  createMemoryProposal,
  deleteApprovedMemory,
  filterMemoryGovernanceProfile,
  proposeTaskCompletionMemory,
  rejectMemoryProposal,
  sanitizeUserMemoryProfile,
  undoMemoryReview
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

test("user memory profile does not leak project memory without matching scope context", () => {
  const profile = sanitizeUserMemoryProfile({
    projectMemories: [
      { projectId: "proj_a", text: "Only project A." },
      { projectId: "proj_b", text: "Only project B." }
    ],
    approvedMemories: [
      { id: "global_1", scope: "global", type: "user_preference", text: "Global preference." },
      { id: "proj_a_1", scope: "project", projectId: "proj_a", type: "project_fact", text: "Project A fact." },
      { id: "conv_1", scope: "conversation", conversationId: "conv_a", type: "episodic_task", text: "Conversation A fact." }
    ]
  }, { now: "2026-05-08T00:00:00.000Z" });

  const unscopedBlock = buildUserMemoryBackgroundEntries(profile)
    .map((entry) => entry.content)
    .join("\n");
  assert.match(unscopedBlock, /Global preference/);
  assert.doesNotMatch(unscopedBlock, /Only project A/);
  assert.doesNotMatch(unscopedBlock, /Project A fact/);
  assert.doesNotMatch(unscopedBlock, /Conversation A fact/);

  const scopedBlock = buildUserMemoryBackgroundEntries(profile, { projectId: "proj_a" })
    .map((entry) => entry.content)
    .join("\n");
  assert.match(scopedBlock, /Only project A/);
  assert.match(scopedBlock, /Project A fact/);
  assert.doesNotMatch(scopedBlock, /Only project B/);
});

test("conversation-scoped memory injects only for the matching conversation", () => {
  const profile = sanitizeUserMemoryProfile({
    approvedMemories: [
      { id: "conv_a_1", scope: "conversation", conversationId: "conv_a", type: "episodic_task", text: "Conversation A remembers the Excel format correction." },
      { id: "conv_b_1", scope: "conversation", conversationId: "conv_b", type: "episodic_task", text: "Conversation B private detail." },
      { id: "global_1", scope: "global", type: "user_preference", text: "Global reviewed note." }
    ]
  }, { now: "2026-05-14T00:00:00.000Z" });

  const context = applyUserMemoryProfileToContext(
    { text: "", selection_metadata: {} },
    profile,
    { conversationId: "conv_a" }
  );
  assert.equal(context.selection_metadata.user_memory_injected, true);
  assert.deepEqual(context.background_contexts.map((entry) => entry.kind), ["conversation_memory", "user_profile"]);

  const rendered = renderBackgroundContextsBlock(context);
  assert.match(rendered, /Conversation A remembers the Excel format correction/);
  assert.match(rendered, /Global reviewed note/);
  assert.doesNotMatch(rendered, /Conversation B private detail/);
});

test("project-scoped memory precedes global reviewed memory for project tasks", () => {
  const profile = sanitizeUserMemoryProfile({
    approvedMemories: [
      { id: "global_1", scope: "global", type: "user_preference", text: "Global reviewed marker." },
      { id: "proj_a_1", scope: "project", projectId: "proj_a", type: "project_fact", text: "Project A marker." }
    ]
  }, { now: "2026-05-12T00:00:00.000Z" });

  const entries = buildUserMemoryBackgroundEntries(profile, { projectId: "proj_a" });

  assert.equal(entries[0].kind, "project_memory");
  assert.equal(entries[1].kind, "user_profile");
  assert.match(entries[0].content, /Project A marker/);
  assert.match(entries[1].content, /Global reviewed marker/);
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

test("memory governance requires proposal review before approved memory injection", () => {
  const proposal = createMemoryProposal({
    type: "rejected_assumption",
    text: "Do not route ordinary report requests into Master Plan.",
    source: "user_correction",
    provenance: { task_id: "task_memory_seed" },
    now: "2026-05-09T07:00:00.000Z"
  });
  const pendingProfile = sanitizeUserMemoryProfile({
    proposals: [proposal]
  }, { now: "2026-05-09T07:01:00.000Z" });
  assert.equal(pendingProfile.proposals[0].status, "pending");
  assert.equal(buildUserMemoryBackgroundEntries(pendingProfile).length, 0);

  const approvedProfile = approveMemoryProposal(
    pendingProfile,
    proposal.proposalId,
    {},
    { now: "2026-05-09T07:02:00.000Z" }
  );
  assert.equal(approvedProfile.proposals[0].status, "approved");
  assert.equal(approvedProfile.approvedMemories.length, 1);
  assert.equal(approvedProfile.reviewHistory[0].action, "approve_proposal");
  assert.equal(approvedProfile.reviewHistory[0].status, "applied");
  assert.equal(approvedProfile.approvedMemories[0].type, "rejected_assumption");
  assert.equal(approvedProfile.approvedMemories[0].provenance.proposal_id, proposal.proposalId);

  const entries = buildUserMemoryBackgroundEntries(approvedProfile);
  assert.equal(entries.length, 1);
  assert.match(entries[0].content, /rejected_assumption/);
  assert.deepEqual(entries[0].metadata.memory_types, ["rejected_assumption"]);
});

test("user memory can automatically propose bounded task completion summaries", () => {
  const profile = proposeTaskCompletionMemory(
    sanitizeUserMemoryProfile({ enabled: true }),
    {
      task: {
        task_id: "task_auto_memory",
        status: "success",
        executor: "tool_using",
        conversation_id: "conv_auto_memory",
        project_id: "proj_auto_memory",
        user_command: "帮我总结这个项目的部署偏好"
      },
      finalText: "项目部署时优先使用本地校验，再推送远程。",
      now: "2026-05-13T12:00:00.000Z"
    }
  );

  assert.equal(profile.proposals.length, 1);
  assert.equal(profile.proposals[0].type, "episodic_task");
  assert.equal(profile.proposals[0].scope, "project");
  assert.equal(profile.proposals[0].projectId, "proj_auto_memory");
  assert.equal(profile.proposals[0].provenance.task_id, "task_auto_memory");
  assert.match(profile.proposals[0].text, /User asked:/);
  assert.match(profile.proposals[0].text, /Assistant outcome:/);

  const duplicate = proposeTaskCompletionMemory(profile, {
    task: {
      task_id: "task_auto_memory",
      status: "success",
      conversation_id: "conv_auto_memory",
      user_command: "same task"
    },
    finalText: "same result",
    now: "2026-05-13T12:01:00.000Z"
  });
  assert.equal(duplicate.proposals.length, 1);
});

test("generated task memory auto-approves only after explicit user opt-in", () => {
  const profile = proposeTaskCompletionMemory(
    sanitizeUserMemoryProfile({ enabled: true, autoApproveGenerated: true }),
    {
      task: {
        task_id: "task_auto_approved_memory",
        status: "success",
        executor: "tool_using",
        conversation_id: "conv_auto_approved",
        user_command: "记住这个会话里的文件命名偏好"
      },
      finalText: "后续导出的简历文件使用中文职位名作为文件名前缀。",
      now: "2026-05-14T12:00:00.000Z"
    }
  );

  assert.equal(profile.proposals.length, 1);
  assert.equal(profile.proposals[0].status, "approved");
  assert.equal(profile.approvedMemories.length, 1);
  assert.equal(profile.approvedMemories[0].scope, "conversation");
  assert.equal(profile.approvedMemories[0].conversationId, "conv_auto_approved");
  assert.equal(profile.reviewHistory[0].action, "approve_proposal");
  assert.equal(profile.reviewHistory[0].actor, "user_opt_in_auto_memory");

  const context = applyUserMemoryProfileToContext(
    { text: "", selection_metadata: {} },
    profile,
    { conversationId: "conv_auto_approved" }
  );
  assert.ok(context.background_contexts.some((entry) => entry.kind === "conversation_memory"));
});

test("memory governance can reject proposals and delete approved memory", () => {
  const proposal = createMemoryProposal({
    type: "user_correction",
    text: "Prefer direct artifact tasks.",
    now: "2026-05-09T07:10:00.000Z"
  });
  const rejected = rejectMemoryProposal(
    { proposals: [proposal] },
    proposal.proposalId,
    { now: "2026-05-09T07:11:00.000Z" }
  );
  assert.equal(rejected.proposals[0].status, "rejected");
  assert.equal(rejected.reviewHistory[0].action, "reject_proposal");
  assert.equal(rejected.approvedMemories.length, 0);

  const approved = approveMemoryProposal(
    { proposals: [proposal] },
    proposal.proposalId,
    {},
    { now: "2026-05-09T07:12:00.000Z" }
  );
  const deleted = deleteApprovedMemory(
    approved,
    approved.approvedMemories[0].id,
    { now: "2026-05-09T07:13:00.000Z" }
  );
  assert.equal(deleted.approvedMemories.length, 0);
  assert.equal(deleted.reviewHistory[0].action, "delete_memory");
});

test("memory governance review history can undo approval, rejection, and deletion", () => {
  const proposal = createMemoryProposal({
    type: "workflow_rule",
    text: "Prefer structured acceptance checks.",
    now: "2026-05-12T15:00:00.000Z"
  });
  const approved = approveMemoryProposal(
    { proposals: [proposal] },
    proposal.proposalId,
    {},
    { now: "2026-05-12T15:01:00.000Z" }
  );
  const approvalReviewId = approved.reviewHistory[0].reviewId;
  const approvalUndone = undoMemoryReview(approved, approvalReviewId, {
    now: "2026-05-12T15:02:00.000Z"
  });
  assert.equal(approvalUndone.approvedMemories.length, 0);
  assert.equal(approvalUndone.proposals[0].status, "pending");
  assert.equal(approvalUndone.reviewHistory[0].status, "undone");

  const rejected = rejectMemoryProposal(approvalUndone, proposal.proposalId, {
    now: "2026-05-12T15:03:00.000Z"
  });
  const rejectionUndone = undoMemoryReview(rejected, rejected.reviewHistory[0].reviewId, {
    now: "2026-05-12T15:04:00.000Z"
  });
  assert.equal(rejectionUndone.proposals[0].status, "pending");

  const reapproved = approveMemoryProposal(rejectionUndone, proposal.proposalId, {}, {
    now: "2026-05-12T15:05:00.000Z"
  });
  const deleted = deleteApprovedMemory(reapproved, reapproved.approvedMemories[0].id, {
    now: "2026-05-12T15:06:00.000Z"
  });
  const deleteUndone = undoMemoryReview(deleted, deleted.reviewHistory[0].reviewId, {
    now: "2026-05-12T15:07:00.000Z"
  });
  assert.equal(deleteUndone.approvedMemories.length, 1);
  assert.equal(deleteUndone.approvedMemories[0].text, "Prefer structured acceptance checks.");
});

test("memory governance filters approved, proposed, and review records by scope", () => {
  const projectProposal = createMemoryProposal({
    type: "project_fact",
    text: "Project A uses strict screenshots.",
    scope: "project",
    projectId: "proj_a"
  });
  const otherProjectProposal = createMemoryProposal({
    type: "project_fact",
    text: "Project B uses a different flow.",
    scope: "project",
    projectId: "proj_b"
  });
  const conversationProposal = createMemoryProposal({
    type: "episodic_task",
    text: "Conversation A discussed launch notes.",
    scope: "conversation",
    conversationId: "conv_a"
  });
  const profile = sanitizeUserMemoryProfile({
    proposals: [projectProposal, otherProjectProposal, conversationProposal],
    approvedMemories: [
      { id: "global_1", type: "user_preference", text: "Global reviewed note.", scope: "global" }
    ]
  }, { now: "2026-05-08T00:00:00.000Z" });
  const approved = approveMemoryProposal(profile, projectProposal.proposalId, {}, {
    now: "2026-05-08T00:01:00.000Z"
  });
  const rejected = rejectMemoryProposal(approved, conversationProposal.proposalId, {
    now: "2026-05-08T00:02:00.000Z"
  });

  const projectFiltered = filterMemoryGovernanceProfile(rejected, {
    scope: "project",
    projectId: "proj_a"
  });
  assert.deepEqual(projectFiltered.approvedMemories.map((item) => item.projectId), ["proj_a"]);
  assert.deepEqual(projectFiltered.proposals.map((item) => item.projectId), ["proj_a"]);
  assert.equal(projectFiltered.reviewHistory.length, 1);
  assert.equal(projectFiltered.reviewHistory[0].projectId, "proj_a");

  const conversationFiltered = filterMemoryGovernanceProfile(rejected, {
    scope: "conversation",
    conversationId: "conv_a"
  });
  assert.equal(conversationFiltered.approvedMemories.length, 0);
  assert.deepEqual(conversationFiltered.proposals.map((item) => item.conversationId), ["conv_a"]);
  assert.equal(conversationFiltered.reviewHistory[0].conversationId, "conv_a");

  const projectAContext = filterMemoryGovernanceProfile(rejected, { projectId: "proj_a" });
  assert.ok(projectAContext.approvedMemories.some((item) => item.scope === "global"));
  assert.ok(projectAContext.approvedMemories.some((item) => item.projectId === "proj_a"));
  assert.ok(!projectAContext.proposals.some((item) => item.projectId === "proj_b"));
});

test("context compiler can select scoped reviewed memory", () => {
  const context = applyUserMemoryProfileToContext(
    { text: "", selection_metadata: {} },
    {
      approvedMemories: [
        {
          id: "mem_project_decision",
          type: "project_decision",
          scope: "project",
          projectId: "proj_a",
          text: "Use structure-first artifact transforms."
        },
        {
          id: "mem_other_project",
          type: "project_fact",
          scope: "project",
          projectId: "proj_b",
          text: "Do not select this."
        }
      ]
    },
    { projectId: "proj_a" }
  );
  const compiled = compileContextForTask({
    task: {
      task_id: "task_memory_context",
      project_id: "proj_a",
      user_command: "继续升级转换流程",
      context_packet: context
    }
  });
  const selected = compiled.selected.find((item) => item.source === "context_packet.background_contexts");
  assert.ok(selected);
  assert.match(selected.value.content, /structure-first artifact transforms/);
  assert.doesNotMatch(selected.value.content, /Do not select this/);
});
