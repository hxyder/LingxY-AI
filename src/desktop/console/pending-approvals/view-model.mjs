export function buildPendingApprovalsViewModel(approvals = []) {
  return {
    title: "待我处理",
    actions: ["approve", "reject", "edit_then_approve", "defer_to_tomorrow"],
    count: approvals.filter((approval) => approval.status === "pending").length,
    items: approvals.map((approval) => ({
      approval_id: approval.approval_id,
      source_type: approval.source_type,
      proposed_target: approval.proposed_target,
      status: approval.status,
      expires_at: approval.expires_at,
      preview_text: approval.preview_text
    }))
  };
}
