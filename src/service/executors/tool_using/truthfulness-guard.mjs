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

const LOCAL_FILE_READ_TOOLS = new Set(["read_file_text", "vision_analyze"]);

function hasSuccessfulLocalRead(transcript = []) {
  return transcript.some((entry) =>
    entry?.type === "tool_result"
    && entry.success === true
    && LOCAL_FILE_READ_TOOLS.has(entry.tool)
  );
}

function hasEmbeddedFileText(task = {}) {
  const context = task?.context_packet ?? {};
  if (context?.context_sources?.file_text === true) return true;
  const text = typeof context.text === "string" ? context.text.trim() : "";
  return text.length >= 240 && Array.isArray(context.file_metadata) && context.file_metadata.length > 0;
}

function claimsLocalFileContent(finalText = "") {
  const text = String(finalText ?? "");
  if (!text) return false;
  if (/(未|没|无法|不能|没有|尚未).{0,8}(读取|阅读|查看|分析)|(?:couldn['’]?t|cannot|can['’]?t|did not|haven['’]?t).{0,30}(read|inspect|analy[sz]e)/i.test(text)) {
    return false;
  }
  return /(?:已|已经|我(?:已|已经)?|根据|结合|基于).{0,24}(?:读取|阅读|查看|分析|总结|梳理).{0,24}(?:文件|文档|附件|简历|资料)/
    .test(text)
    || /(?:I(?:'ve| have)?|based on|after).{0,40}(?:read|reviewed|inspected|analy[sz]ed|summari[sz]ed).{0,40}(?:file|document|attachment|resume|CV)\b/i
      .test(text);
}

export function detectUnbackedLocalFileClaim(result, task = null) {
  const filePaths = task?.context_packet?.file_paths;
  if (!Array.isArray(filePaths) || filePaths.length === 0) return null;
  if (!claimsLocalFileContent(result?.final_text ?? "")) return null;
  if (hasEmbeddedFileText(task) || hasSuccessfulLocalRead(result?.transcript ?? [])) return null;
  return {
    kind: "local_file_read_claim_unsupported",
    message: "Final answer claims local file contents were read or analyzed, but no file-content extraction was available or called."
  };
}

export function buildHallucinatedClaimBanner(violation) {
  const group = String(violation?.kind ?? "").replace(/_claim_unsupported$/, "");
  if (group === "local_file_read") {
    return "⚠️ 文件内容实际并未读取。系统只看到了文件路径/元数据，没有检测到成功的文件正文抽取；下面的文字可能是模型猜测。请重新执行或先读取文件内容。";
  }
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
