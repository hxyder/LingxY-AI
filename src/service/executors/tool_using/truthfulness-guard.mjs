import { detectUnbackedActionClaims } from "../../core/policy/success-contract-validator.mjs";

/**
 * Truthfulness guard for connector-write hallucinations. Delegates to the
 * shared action-claim detector so tool_using and agentic apply identical
 * evidence rules.
 */
export function detectUnbackedConnectorClaim(result) {
  const violations = detectUnbackedActionClaims(
    result?.transcript ?? [],
    result?.final_text ?? ""
  );
  return violations.length > 0 ? violations[0] : null;
}

export function buildHallucinatedClaimBanner(violation) {
  const group = String(violation?.kind ?? "").replace(/_claim_unsupported$/, "");
  if (group === "email_send") {
    return "⚠️ 邮件实际并未发送。系统未检测到任何成功的邮件发送工具调用，下面的文字是模型自述。请重新发起或人工确认。";
  }
  if (group === "calendar_create") {
    return "⚠️ 日程/事件实际并未创建。系统未检测到日历工具的成功调用，下面的文字仅为模型自述。请重新创建。";
  }
  if (group === "file_upload") {
    return "⚠️ 文件实际并未上传。系统未检测到上传工具的成功调用，下面的文字仅为模型自述。请重新上传。";
  }
  if (group === "schedule_create") {
    return "⚠️ 定时任务/提醒实际并未创建。系统未检测到 create_scheduled_task 的成功调用，下面的文字仅为模型自述。请重新创建。";
  }
  if (group === "file_modify") {
    return "⚠️ 文件实际并未修改。系统未检测到 edit_file/write_file/file_op 的成功调用，下面的文字仅为模型自述。请重新发起修改。";
  }
  if (group === "app_launch") {
    return "⚠️ 应用/页面实际并未打开。系统未检测到 launch_app/open_url 的成功调用，下面的文字仅为模型自述。";
  }
  if (group === "notification_send") {
    return "⚠️ 通知实际并未发送。系统未检测到 notify 的成功调用，下面的文字仅为模型自述。";
  }
  return "⚠️ 模型声称完成了一项操作，但系统未检测到对应工具的成功调用。下面的文字是模型自述，不是真实执行结果。";
}
