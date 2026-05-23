export const FOLLOWUP_ARTIFACT_EVAL_MINIMUMS = Object.freeze({
  pronoun_followup: 8,
  artifact_format_conversion: 8,
  artifact_edit_refinement: 6,
  multi_artifact_ambiguity: 6,
  stale_parent_avoidance: 6,
  cross_conversation_isolation: 5,
  user_correction_rejected_assumption: 5,
  direct_task_vs_master_plan: 4,
  validator_failure_clarification: 4,
  scheduled_system_task_context_isolation: 3
});

function artifact(id, taskId, kind = "xlsx") {
  return {
    artifact_id: id,
    task_id: taskId,
    kind,
    path: `E:\\linxiDoc\\${taskId}\\${id}.${kind}`,
    created_at: "2026-05-09T08:01:00.000Z"
  };
}

function caseOf(id, category, userCommand, expected, extra = {}) {
  const parentTaskId = extra.parentTaskId ?? `task_${id}_parent`;
  const conversationId = extra.conversationId ?? `conv_${id}`;
  const artifacts = extra.artifacts ?? [artifact(`artifact_${id}_main`, parentTaskId, extra.kind ?? "xlsx")];
  return {
    id,
    category,
    user_command: userCommand,
    setup: {
      conversation_id: conversationId,
      active_task_id: parentTaskId,
      parent_task_id: parentTaskId,
      parent_summary: extra.parentSummary ?? "Prior task completed successfully.",
      artifacts,
      extra_conversations: extra.extraConversations ?? [],
      runtime_notes: extra.runtimeNotes ?? []
    },
    expected: {
      parent_task_id: expected.parentTaskId ?? parentTaskId,
      required_artifact_ids: expected.requiredArtifactIds ?? artifacts.map((item) => item.artifact_id).slice(0, 1),
      forbidden_artifact_ids: expected.forbiddenArtifactIds ?? [],
      requires_clarification: Boolean(expected.requiresClarification),
      rejected_assumption_required: Boolean(expected.rejectedAssumptionRequired),
      direct_task: Boolean(expected.directTask),
      target_kind: expected.targetKind ?? null
    }
  };
}

function makeCases() {
  const cases = [
    caseOf("pronoun_01", "pronoun_followup", "继续", {}),
    caseOf("pronoun_02", "pronoun_followup", "把它展开一点", {}, { kind: "docx" }),
    caseOf("pronoun_03", "pronoun_followup", "这个再短一点", {}, { kind: "pptx" }),
    caseOf("pronoun_04", "pronoun_followup", "沿用刚才的结论", {}),
    caseOf("pronoun_05", "pronoun_followup", "照这个格式再来", {}, { kind: "html" }),
    caseOf("pronoun_06", "pronoun_followup", "它里面的数据再检查一下", {}),
    caseOf("pronoun_07", "pronoun_followup", "上个继续处理", {}),
    caseOf("pronoun_08", "pronoun_followup", "给这个补一段摘要", {}, { kind: "pdf" }),

    caseOf("convert_01", "artifact_format_conversion", "把这个转成 PPT", { targetKind: "pptx" }),
    caseOf("convert_02", "artifact_format_conversion", "给我换成 pptx 试试", { targetKind: "pptx" }),
    caseOf("convert_03", "artifact_format_conversion", "把上个 Excel 做成幻灯片", { targetKind: "pptx" }),
    caseOf("convert_04", "artifact_format_conversion", "这个表格整理成报告文档", { targetKind: "docx" }),
    caseOf("convert_05", "artifact_format_conversion", "把这份 markdown 导成 pdf", { targetKind: "pdf" }, { kind: "html" }),
    caseOf("convert_06", "artifact_format_conversion", "同样内容做一个网页版本", { targetKind: "html" }, { kind: "docx" }),
    caseOf("convert_07", "artifact_format_conversion", "把刚才那个预算表改成演示稿", { targetKind: "pptx" }),
    caseOf("convert_08", "artifact_format_conversion", "把它转成可以发客户的 Word", { targetKind: "docx" }),

    caseOf("edit_01", "artifact_edit_refinement", "改一下这个标题", {}),
    caseOf("edit_02", "artifact_edit_refinement", "把它里面的数字格式统一", {}),
    caseOf("edit_03", "artifact_edit_refinement", "给刚才的报告补充风险部分", {}, { kind: "docx" }),
    caseOf("edit_04", "artifact_edit_refinement", "这个 PPT 加一页结论", {}, { kind: "pptx" }),
    caseOf("edit_05", "artifact_edit_refinement", "把之前那份摘要压缩到三点", {}, { kind: "pdf" }),
    caseOf("edit_06", "artifact_edit_refinement", "继续润色这个版本", {}, { kind: "html" }),

    caseOf("ambiguous_01", "multi_artifact_ambiguity", "把这个转成 PPT", { requiresClarification: true }, {
      artifacts: [
        artifact("artifact_ambiguous_01_sales", "task_ambiguous_01_parent", "xlsx"),
        artifact("artifact_ambiguous_01_budget", "task_ambiguous_01_parent", "docx")
      ]
    }),
    caseOf("ambiguous_02", "multi_artifact_ambiguity", "改一下这个", { requiresClarification: true }, {
      artifacts: [
        artifact("artifact_ambiguous_02_sheet", "task_ambiguous_02_parent", "xlsx"),
        artifact("artifact_ambiguous_02_deck", "task_ambiguous_02_parent", "pptx")
      ]
    }),
    caseOf("ambiguous_03", "multi_artifact_ambiguity", "用刚才那个做报告", { requiresClarification: true }, {
      artifacts: [
        artifact("artifact_ambiguous_03_a", "task_ambiguous_03_parent", "xlsx"),
        artifact("artifact_ambiguous_03_b", "task_ambiguous_03_parent", "xlsx")
      ]
    }),
    caseOf("ambiguous_04", "multi_artifact_ambiguity", "这个再生成一版", { requiresClarification: true }, {
      artifacts: [
        artifact("artifact_ambiguous_04_doc", "task_ambiguous_04_parent", "docx"),
        artifact("artifact_ambiguous_04_pdf", "task_ambiguous_04_parent", "pdf")
      ]
    }),
    caseOf("ambiguous_05", "multi_artifact_ambiguity", "把它发给客户前整理一下", { requiresClarification: true }, {
      artifacts: [
        artifact("artifact_ambiguous_05_html", "task_ambiguous_05_parent", "html"),
        artifact("artifact_ambiguous_05_xlsx", "task_ambiguous_05_parent", "xlsx")
      ]
    }),
    caseOf("ambiguous_06", "multi_artifact_ambiguity", "继续处理上一个文件", { requiresClarification: true }, {
      artifacts: [
        artifact("artifact_ambiguous_06_one", "task_ambiguous_06_parent", "docx"),
        artifact("artifact_ambiguous_06_two", "task_ambiguous_06_parent", "pptx")
      ]
    }),

    caseOf("stale_01", "stale_parent_avoidance", "改一下这个", { forbiddenArtifactIds: ["artifact_stale_01_old"] }, {
      artifacts: [artifact("artifact_stale_01_current", "task_stale_01_parent", "xlsx")],
      extraConversations: [{ conversation_id: "conv_stale_old", task_id: "task_stale_old", artifacts: [artifact("artifact_stale_01_old", "task_stale_old", "pptx")] }]
    }),
    caseOf("stale_02", "stale_parent_avoidance", "把这个转成 PPT", { forbiddenArtifactIds: ["artifact_stale_02_image"] }),
    caseOf("stale_03", "stale_parent_avoidance", "继续表格那个", { forbiddenArtifactIds: ["artifact_stale_03_doc"] }),
    caseOf("stale_04", "stale_parent_avoidance", "上个问题继续", { forbiddenArtifactIds: ["artifact_stale_04_cross"] }),
    caseOf("stale_05", "stale_parent_avoidance", "这个文件再处理", { forbiddenArtifactIds: ["artifact_stale_05_deleted"] }),
    caseOf("stale_06", "stale_parent_avoidance", "照刚才那个格式", { forbiddenArtifactIds: ["artifact_stale_06_other"] }),

    caseOf("cross_01", "cross_conversation_isolation", "改一下这个", { forbiddenArtifactIds: ["artifact_cross_01_other"] }),
    caseOf("cross_02", "cross_conversation_isolation", "把这个转成 PPT", { forbiddenArtifactIds: ["artifact_cross_02_other"] }),
    caseOf("cross_03", "cross_conversation_isolation", "继续那个表格", { forbiddenArtifactIds: ["artifact_cross_03_other"] }),
    caseOf("cross_04", "cross_conversation_isolation", "给它补一页", { forbiddenArtifactIds: ["artifact_cross_04_other"] }, { kind: "pptx" }),
    caseOf("cross_05", "cross_conversation_isolation", "整理一下这个报告", { forbiddenArtifactIds: ["artifact_cross_05_other"] }, { kind: "docx" }),

    caseOf("correction_01", "user_correction_rejected_assumption", "不要走 Master Plan，直接生成这个 md", { rejectedAssumptionRequired: true, directTask: true }, { runtimeNotes: ["user rejected Master Plan routing"] }),
    caseOf("correction_02", "user_correction_rejected_assumption", "不是那个文件，是这个继续", { rejectedAssumptionRequired: true }, { runtimeNotes: ["user corrected artifact target"] }),
    caseOf("correction_03", "user_correction_rejected_assumption", "别重做，修改刚才的版本", { rejectedAssumptionRequired: true }, { runtimeNotes: ["user rejected new artifact"] }),
    caseOf("correction_04", "user_correction_rejected_assumption", "不要查网页，用已有文件生成", { rejectedAssumptionRequired: true, directTask: true }, { runtimeNotes: ["user rejected external search"] }),
    caseOf("correction_05", "user_correction_rejected_assumption", "不是总结，是把它变成表格", { rejectedAssumptionRequired: true }, { runtimeNotes: ["user corrected output intent"] }),

    caseOf("direct_01", "direct_task_vs_master_plan", "根据这个文件直接生成 md", { directTask: true }, { kind: "docx" }),
    caseOf("direct_02", "direct_task_vs_master_plan", "直接做一份销售报告", { directTask: true }),
    caseOf("direct_03", "direct_task_vs_master_plan", "不要规划，直接把这个导出", { directTask: true }, { kind: "html" }),
    caseOf("direct_04", "direct_task_vs_master_plan", "只要结果，不要拆成计划", { directTask: true }, { kind: "pdf" }),

    caseOf("validator_01", "validator_failure_clarification", "把这个做成一页 PPT", { requiresClarification: true, targetKind: "pptx" }),
    caseOf("validator_02", "validator_failure_clarification", "这个不要只给可下载链接", { requiresClarification: true }),
    caseOf("validator_03", "validator_failure_clarification", "这个不要塞进一个 Content 列", { requiresClarification: true }),
    caseOf("validator_04", "validator_failure_clarification", "这个没有数据就先问我", { requiresClarification: true }),

    caseOf("scheduled_01", "scheduled_system_task_context_isolation", "按计划继续生成摘要", {}, { conversationId: "conv_scheduled_01", kind: "docx" }),
    caseOf("scheduled_02", "scheduled_system_task_context_isolation", "系统任务继续检查文件", {}, { conversationId: "conv_scheduled_02", kind: "pdf" }),
    caseOf("scheduled_03", "scheduled_system_task_context_isolation", "提醒触发后处理这个", {}, { conversationId: "conv_scheduled_03", kind: "xlsx" })
  ];
  return cases;
}

export const FOLLOWUP_ARTIFACT_EVAL_CASES = Object.freeze(makeCases());
