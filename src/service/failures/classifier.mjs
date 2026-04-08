export const FAILURE_CATEGORIES = Object.freeze([
  "context_capture_error",
  "permission_denied",
  "parse_error",
  "tool_unavailable",
  "cli_execution_error",
  "model_call_error",
  "output_save_error",
  "user_interrupted",
  "network_error",
  "timeout",
  "redaction_state_lost",
  "internal_error"
]);

const USER_MESSAGES = Object.freeze({
  context_capture_error: "上下文读取失败，请确认原始内容仍然可访问后重试。",
  permission_denied: "权限不足，请检查文件或系统权限后重试。",
  parse_error: "内容解析失败，请确认源文件未损坏、未加密。",
  tool_unavailable: "所需外部工具不可用，请先安装或配置对应执行器。",
  cli_execution_error: "外部执行器异常退出，请查看日志或切换执行器重试。",
  model_call_error: "模型调用失败，请稍后重试或更换模型。",
  output_save_error: "结果保存失败，请检查磁盘空间和输出目录权限。",
  user_interrupted: "任务已被手动取消，可在调整后重新执行。",
  network_error: "网络异常导致任务失败，可稍后自动或手动重试。",
  timeout: "任务执行超时，请缩小范围或延长运行时限制。",
  redaction_state_lost: "由于程序异常退出，含敏感数据的任务无法恢复，请重新运行原命令。",
  internal_error: "发生未分类内部错误，请复制日志并上报。"
});

const USER_ACTIONS = Object.freeze({
  context_capture_error: ["重新捕获上下文", "检查原文件或页面是否仍然存在"],
  permission_denied: ["检查权限", "以更高权限重新执行"],
  parse_error: ["确认文件未损坏", "尝试更换文件格式后重试"],
  tool_unavailable: ["安装缺失工具", "切换到其它执行器"],
  cli_execution_error: ["查看 stderr 日志", "切换执行器后重试"],
  model_call_error: ["稍后重试", "缩小输入范围", "切换模型"],
  output_save_error: ["释放磁盘空间", "更换输出目录"],
  user_interrupted: ["直接重试", "修改命令后重试"],
  network_error: ["等待网络恢复", "再次重试"],
  timeout: ["拆分任务", "提高 max runtime"],
  redaction_state_lost: ["重新采集原始上下文", "重新运行任务"],
  internal_error: ["复制日志", "提交 issue 或人工排查"]
});

function clip(value) {
  return typeof value === "string" ? value.slice(0, 240) : null;
}

export function classifyFailure(errorLike) {
  const code = `${errorLike?.code ?? errorLike?.name ?? ""}`.toLowerCase();
  const message = `${errorLike?.message ?? errorLike?.stderr ?? errorLike?.summary ?? ""}`.toLowerCase();

  let category = "internal_error";
  if (code.includes("enoent") || message.includes("not found")) {
    category = "tool_unavailable";
  } else if (code.includes("eacces") || code.includes("eperm") || message.includes("permission")) {
    category = "permission_denied";
  } else if (code.includes("abort") || message.includes("cancel")) {
    category = "user_interrupted";
  } else if (code.includes("timeout") || message.includes("timeout")) {
    category = "timeout";
  } else if (message.includes("redaction_state_lost") || message.includes("敏感数据的任务无法恢复")) {
    category = "redaction_state_lost";
  } else if (code.includes("enotfound") || code.includes("econn") || message.includes("network")) {
    category = "network_error";
  } else if (message.includes("parse") || message.includes("pdf") || message.includes("docx")) {
    category = "parse_error";
  } else if (message.includes("429") || message.includes("rate limit") || message.includes("model")) {
    category = "model_call_error";
  } else if (message.includes("save") || message.includes("disk") || message.includes("write")) {
    category = "output_save_error";
  } else if (errorLike?.exitCode && errorLike.exitCode !== 0) {
    category = "cli_execution_error";
  } else if (message.includes("capture") || message.includes("selection")) {
    category = "context_capture_error";
  }

  return {
    category,
    retryable: !["permission_denied", "parse_error", "redaction_state_lost"].includes(category),
    userMessage: USER_MESSAGES[category],
    userActions: USER_ACTIONS[category],
    internalExcerpt: clip(errorLike?.message ?? errorLike?.stderr ?? errorLike?.stack ?? errorLike?.summary ?? "")
  };
}

export function getFailureUserMessages() {
  return USER_MESSAGES;
}

export function getFailureUserActions(category) {
  return USER_ACTIONS[category] ?? USER_ACTIONS.internal_error;
}
