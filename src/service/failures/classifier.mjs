export const FAILURE_CATEGORIES = Object.freeze([
  "context_capture_error",
  "permission_denied",
  "parse_error",
  "missing_artifact",
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
  missing_artifact: "任务需要生成文件，但执行结束时没有可用文件。请重新生成，或改为先生成可预览草稿。",
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
  missing_artifact: ["重新生成文件", "检查输出目录权限", "先生成可预览草稿再导出"],
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

const PROVIDER_LABELS = Object.freeze({
  openai: "OpenAI",
  anthropic: "Anthropic/Claude",
  deepseek: "DeepSeek",
  gemini: "Google Gemini",
  ollama: "Ollama",
  kimi: "Kimi",
  code_cli: "代码 CLI",
  google: "Google",
  microsoft: "Microsoft"
});

const TOOL_LABELS = Object.freeze({
  generate_document: "文件生成",
  write_file: "文件写入",
  edit_file: "文件编辑",
  read_file_text: "本地文件读取",
  read_folder_text: "文件夹读取",
  web_search: "网页搜索",
  fetch_url_content: "网页读取",
  download_file: "文件下载",
  account_send_email: "邮件发送",
  account_create_calendar_event: "日历创建",
  account_update_calendar_event: "日历更新",
  gui_click: "桌面点击",
  gui_type_text: "桌面输入",
  preview_skill_from_github: "Skill 预览",
  install_skill_from_github: "Skill 安装"
});

function uniqActions(...groups) {
  const out = [];
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const text = typeof item === "string" ? item.trim() : "";
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out.slice(0, 6);
}

function compactText(...parts) {
  return parts
    .filter((part) => part != null)
    .map((part) => String(part))
    .join(" ")
    .toLowerCase();
}

function detectProvider(errorLike = {}, text = "") {
  const explicit = compactText(
    errorLike.providerFamily,
    errorLike.provider_family,
    errorLike.providerId,
    errorLike.provider_id,
    errorLike.providerKind,
    errorLike.provider_kind,
    errorLike.provider,
    errorLike.model,
    errorLike.model_id
  );
  const haystack = `${explicit} ${text}`;
  if (/anthropic|claude/.test(haystack)) return "anthropic";
  if (/deepseek/.test(haystack)) return "deepseek";
  if (/gemini|google\s+ai|generativelanguage/.test(haystack)) return "gemini";
  if (/ollama|llama3|qwen|mistral/.test(haystack)) return "ollama";
  if (/\bkimi\b|moonshot/.test(haystack)) return "kimi";
  if (/code[_ -]?cli|codex|claude\s+code/.test(haystack)) return "code_cli";
  if (/openai|chatgpt|\bgpt[-_ ]?\d|^o\d/.test(haystack)) return "openai";
  if (/gmail|googleapis|oauth2\.google|calendar\.google|google/.test(haystack)) return "google";
  if (/microsoft|graph\.microsoft|outlook|office365|azure/.test(haystack)) return "microsoft";
  return "";
}

function detectTool(errorLike = {}, text = "") {
  const explicit = compactText(
    errorLike.toolId,
    errorLike.tool_id,
    errorLike.tool,
    errorLike.action,
    errorLike.workflow,
    errorLike.capability
  );
  const haystack = `${explicit} ${text}`;
  for (const toolId of Object.keys(TOOL_LABELS)) {
    const pattern = new RegExp(`\\b${toolId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(haystack)) return toolId;
  }
  if (/email|gmail|send mail|邮件/.test(haystack)) return "account_send_email";
  if (/calendar|日历|event/.test(haystack)) return "account_create_calendar_event";
  if (/generate[_ -]?document|document render|文件生成|生成文档/.test(haystack)) return "generate_document";
  if (/web search|search failed|搜索/.test(haystack)) return "web_search";
  if (/download_file|下载文件|文件下载|download/.test(haystack)) return "download_file";
  if (/fetch|http|url|网页/.test(haystack)) return "fetch_url_content";
  if (/write_file|写入|save file/.test(haystack)) return "write_file";
  if (/edit_file|编辑文件/.test(haystack)) return "edit_file";
  return "";
}

function detectRecoveryIssue(errorLike = {}, text = "") {
  const code = compactText(errorLike.code, errorLike.name, errorLike.status, errorLike.statusCode);
  const haystack = `${code} ${text}`;
  if (/invalid_grant|reauth_required|unauthori[sz]ed|authentication|invalid api key|api[_ -]?key|401|403|forbidden|scope|consent/.test(haystack)) {
    return "auth";
  }
  if (/429|rate limit|rate_limit|too many requests|quota|resource_exhausted|insufficient_quota/.test(haystack)) {
    return "rate_limit";
  }
  if (/context length|max context|token limit|maximum context|too many tokens/.test(haystack)) {
    return "context_limit";
  }
  if (/model.*(?:not found|does not exist|unsupported|invalid)|404.*model/.test(haystack)) {
    return "model_unavailable";
  }
  if (/econnrefused|connection refused|ollama.*(?:not running|unavailable)|spawn.*enoent|command.*not found/.test(haystack)) {
    return "runtime_unavailable";
  }
  if (/enospc|no space|disk full/.test(haystack)) return "disk";
  if (/eacces|eperm|permission/.test(haystack)) return "permission";
  return "";
}

function providerRecovery(provider, issue) {
  if (!provider || !issue) return null;
  const label = PROVIDER_LABELS[provider] ?? provider;
  if (issue === "auth") {
    return {
      hint: `${label} 鉴权或授权失效：请重新连接账号/API Key，确认所需 scope 已授权后再重试。`,
      actions: provider === "google" || provider === "microsoft"
        ? ["重新连接账号", "确认邮件/日历 scope 已授权", "重新发起任务"]
        : ["检查 API Key/环境变量", "确认当前 provider 已启用", "保存后重新发起任务"],
      retryable: false
    };
  }
  if (issue === "rate_limit") {
    return {
      hint: `${label} 限流或额度不足：等待额度恢复，或切换到可用模型/provider。`,
      actions: ["稍后重试", "切换模型或 provider", "缩小输入范围"],
      retryable: true
    };
  }
  if (issue === "context_limit") {
    return {
      hint: `${label} 上下文过长：需要缩小输入、分批处理，或切换长上下文模型。`,
      actions: ["缩小输入范围", "分批处理", "切换长上下文模型"],
      retryable: true
    };
  }
  if (issue === "model_unavailable") {
    return {
      hint: `${label} 当前模型不可用：请选择该 provider 支持的模型后再运行。`,
      actions: ["打开 Provider 设置", "选择可用模型", "保存后重新发起任务"],
      retryable: false
    };
  }
  if (issue === "runtime_unavailable") {
    return {
      hint: `${label} 本地运行时或 CLI 不可用：请启动服务或修复命令路径。`,
      actions: provider === "ollama"
        ? ["启动 Ollama 服务", "确认模型已 pull", "重试任务"]
        : ["检查 CLI 命令路径", "确认工具可在终端运行", "重试任务"],
      retryable: false
    };
  }
  return null;
}

function toolRecovery(toolId, issue) {
  if (!toolId) return null;
  const label = TOOL_LABELS[toolId] ?? toolId;
  if (toolId === "generate_document") {
    return {
      hint: `${label}失败：请检查输出目录、磁盘空间和目标文件是否被其它程序占用。`,
      actions: issue === "disk"
        ? ["释放磁盘空间", "更换输出目录", "重新生成文件"]
        : ["检查输出目录权限", "关闭占用文件的程序", "重新生成文件"],
      retryable: issue !== "permission"
    };
  }
  if (toolId === "write_file" || toolId === "edit_file") {
    return {
      hint: `${label}失败：通常需要确认路径在允许目录内、文件未被锁定且有写入权限。`,
      actions: ["检查文件权限", "关闭占用文件的程序", "换到项目/产物目录后重试"],
      retryable: issue !== "permission"
    };
  }
  if (toolId === "account_send_email" || toolId.includes("calendar")) {
    return {
      hint: `${label}失败：请确认账号仍在线、目标收件人/日历字段有效，并完成任何授权提示。`,
      actions: ["重新连接账号", "检查收件人/日历字段", "通过审批后重试"],
      retryable: issue !== "auth"
    };
  }
  if (toolId === "web_search" || toolId === "fetch_url_content" || toolId === "download_file") {
    return {
      hint: `${label}失败：可以换一个更具体的查询、换直接文件链接、打开原网页，或稍后重试网络请求。`,
      actions: ["换更具体的关键词", "换直接文件链接", "稍后重试"],
      retryable: true
    };
  }
  if (toolId === "gui_click" || toolId === "gui_type_text") {
    return {
      hint: `${label}失败：目标窗口可能已变化，请重新聚焦窗口或重新捕获界面后再执行。`,
      actions: ["重新聚焦目标窗口", "重新捕获界面", "确认目标控件仍可见"],
      retryable: true
    };
  }
  if (toolId === "preview_skill_from_github" || toolId === "install_skill_from_github") {
    return {
      hint: `${label}失败：请检查仓库地址、网络访问、目标 skill 路径和本地写入权限。`,
      actions: ["检查 GitHub 地址", "确认 skill 子路径", "检查本地写入权限"],
      retryable: issue !== "permission"
    };
  }
  return null;
}

function clip(value) {
  return typeof value === "string" ? value.slice(0, 240) : null;
}

export function classifyFailure(errorLike) {
  const code = `${errorLike?.code ?? errorLike?.name ?? ""}`.toLowerCase();
  const message = `${errorLike?.message ?? errorLike?.stderr ?? errorLike?.summary ?? ""}`.toLowerCase();
  const contextText = compactText(
    errorLike?.message,
    errorLike?.stderr,
    errorLike?.summary,
    errorLike?.stack,
    errorLike?.error,
    errorLike?.observation
  );
  const provider = detectProvider(errorLike, contextText);
  const toolId = detectTool(errorLike, contextText);
  const issue = detectRecoveryIssue(errorLike, contextText);
  const providerHint = providerRecovery(provider, issue);
  const toolHint = toolRecovery(toolId, issue);

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
  } else if (
    message.includes("artifact")
    && (
      message.includes("no artifact")
      || message.includes("requires a")
      || message.includes("required")
      || message.includes("missing")
      || message.includes("was not created")
    )
  ) {
    category = "missing_artifact";
  } else if (message.includes("parse") || message.includes("pdf") || message.includes("docx")) {
    category = "parse_error";
  } else if (message.includes("429") || message.includes("rate limit") || message.includes("model")) {
    category = "model_call_error";
  } else if (message.includes("save") || message.includes("disk") || message.includes("write")) {
    category = "output_save_error";
  } else if ((errorLike?.exitCode != null && errorLike.exitCode !== 0) || message.includes("cli failed") || message.includes("kimi cli failed") || message.includes("code cli failed")) {
    category = "cli_execution_error";
  } else if (message.includes("capture") || message.includes("selection")) {
    category = "context_capture_error";
  } else if (code.includes("eisdir") || message.includes("is a directory") || message.includes("illegal operation on a directory")) {
    // Folder dropped where a file was expected — commonly hits when the user
    // drags a directory onto the overlay. Surface it as a parse-style error
    // with an actionable message rather than "unclassified internal error".
    category = "parse_error";
  }

  if (issue === "disk") {
    category = "output_save_error";
  } else if (category === "internal_error") {
    if (issue === "auth" || issue === "permission") {
      category = "permission_denied";
    } else if (provider && ["rate_limit", "context_limit", "model_unavailable"].includes(issue)) {
      category = "model_call_error";
    } else if (issue === "runtime_unavailable") {
      category = "tool_unavailable";
    }
  }

  const internalExcerpt = clip(errorLike?.message ?? errorLike?.stderr ?? errorLike?.stack ?? errorLike?.summary ?? "");

  // For unclassified internal errors, appending the raw excerpt is the
  // difference between "file a bug" and "oh, it was a missing folder". It's
  // only 240 chars max and only shown on the unclassified path, so it won't
  // leak noise into the known-category messages.
  let userMessage = USER_MESSAGES[category];
  if (category === "internal_error" && internalExcerpt) {
    userMessage = `${userMessage}（错误详情：${internalExcerpt}）`;
  }

  const recoveryHint = [providerHint?.hint, toolHint?.hint].filter(Boolean).join(" ");
  if (recoveryHint && !userMessage.includes(recoveryHint)) {
    userMessage = `${userMessage}\n${recoveryHint}`;
  }
  const retryable = providerHint?.retryable ?? toolHint?.retryable
    ?? !["permission_denied", "parse_error", "redaction_state_lost"].includes(category);

  return {
    category,
    retryable,
    userMessage,
    userActions: uniqActions(providerHint?.actions, toolHint?.actions, USER_ACTIONS[category]),
    internalExcerpt,
    recoveryHint: recoveryHint || null,
    recoveryPolicy: {
      provider: provider || null,
      provider_label: provider ? (PROVIDER_LABELS[provider] ?? provider) : null,
      tool_id: toolId || null,
      tool_label: toolId ? (TOOL_LABELS[toolId] ?? toolId) : null,
      issue: issue || null,
      retryable
    }
  };
}

export function getFailureUserMessages() {
  return USER_MESSAGES;
}

export function getFailureUserActions(category) {
  return USER_ACTIONS[category] ?? USER_ACTIONS.internal_error;
}
