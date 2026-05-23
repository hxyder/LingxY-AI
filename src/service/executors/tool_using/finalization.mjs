import { SYNTHESIS_REQUIRED_OUTPUTS } from "../../core/intent/semantic-router.mjs";
import {
  detectNetworkFailureInTranscript,
  formatFailureMessage
} from "./failure-classifier.mjs";

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/.test(String(value ?? ""));
}

function formatAccountLabel(account = {}, fallback = {}) {
  const provider = account.provider ?? fallback.provider ?? "connector";
  const email = account.email || fallback.accountId || "";
  const display = account.displayName ? ` (${account.displayName})` : "";
  return `${provider}${email ? ` ${email}` : ""}${display}`.trim();
}

export function formatConnectorFinal(entry, userCommand = "") {
  const metadata = entry?.metadata ?? {};
  const zh = hasCjk(userCommand);

  if (entry?.tool === "account_list_connected_accounts") {
    const accounts = metadata.accounts ?? [];
    if (accounts.length === 0) return zh ? "我查了一下，目前没有已连接的 Google/Microsoft 账户。" : "No connected Google/Microsoft accounts were found.";
    const lines = accounts.map((account, index) => {
      const caps = Object.entries(account.capabilities ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(", ") || "none";
      return zh
        ? `${index + 1}. ${formatAccountLabel(account)}，状态 ${account.tokenStatus}，能力：${caps}`
        : `${index + 1}. ${formatAccountLabel(account)}; status=${account.tokenStatus}; capabilities=${caps}`;
    });
    return zh
      ? `我查到当前已连接账户：\n${lines.join("\n")}`
      : `Connected accounts:\n${lines.join("\n")}`;
  }

  if (entry?.tool === "account_list_emails") {
    const emails = metadata.emails ?? [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (emails.length === 0) return zh ? `我查看了 ${formatAccountLabel(account)}，没有找到邮件。` : `No emails were found in ${formatAccountLabel(account)}.`;
    const lines = emails.map((email, index) => {
      const sender = email.fromName ? `${email.fromName} <${email.from ?? ""}>` : (email.from ?? "unknown sender");
      return `${index + 1}. ${email.received ?? "unknown date"} | ${sender} | ${email.subject ?? "(no subject)"}`;
    });
    return zh
      ? `我从 ${formatAccountLabel(account)} 查到 ${emails.length} 封邮件：\n${lines.join("\n")}`
      : `I found ${emails.length} emails in ${formatAccountLabel(account)}:\n${lines.join("\n")}`;
  }

  if (entry?.tool === "account_list_files") {
    const files = metadata.files ?? [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (files.length === 0) return zh ? `我查看了 ${formatAccountLabel(account)}，没有找到云端文件。` : `No cloud files were found in ${formatAccountLabel(account)}.`;
    const lines = files.map((file, index) => `${index + 1}. ${file.name ?? "(untitled)"} | modified ${file.modified ?? "unknown"}${file.url ? ` | ${file.url}` : ""}`);
    return zh
      ? `我从 ${formatAccountLabel(account)} 查到 ${files.length} 个云端文件：\n${lines.join("\n")}`
      : `I found ${files.length} cloud files in ${formatAccountLabel(account)}:\n${lines.join("\n")}`;
  }

  if (entry?.tool === "account_list_events") {
    const events = metadata.events ?? [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (events.length === 0) return zh ? `我查看了 ${formatAccountLabel(account)}，没有找到日历事件。` : `No calendar events were found in ${formatAccountLabel(account)}.`;
    const lines = events.map((event, index) => `${index + 1}. ${event.start ?? "unknown time"} | ${event.title ?? "(untitled)"}${event.location ? ` | ${event.location}` : ""}`);
    return zh
      ? `我从 ${formatAccountLabel(account)} 查到 ${events.length} 个日历事件：\n${lines.join("\n")}`
      : `I found ${events.length} calendar events in ${formatAccountLabel(account)}:\n${lines.join("\n")}`;
  }

  return null;
}

export function allowsRawConnectorFinal(taskSpec) {
  return taskSpec?.synthesis?.expected_output === "raw_results";
}

function countBy(values = [], selector = () => "") {
  const counts = new Map();
  for (const value of values) {
    const key = String(selector(value) ?? "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
}

function compactList(values = [], selector = (value) => value, limit = 5) {
  return values
    .map(selector)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function formatCountSummary(items = []) {
  return items.map(([label, count]) => `${label} (${count})`).join(", ");
}

export function formatConnectorSynthesisFinal(entry, userCommand = "", taskSpec = null) {
  if (allowsRawConnectorFinal(taskSpec)) return null;
  const expected = taskSpec?.synthesis?.expected_output;
  const needsSynthesis = expected === null
    || expected === undefined
    || expected === ""
    || SYNTHESIS_REQUIRED_OUTPUTS.has(expected);
  if (!needsSynthesis) return null;

  const metadata = entry?.metadata ?? {};
  const zh = hasCjk(userCommand);

  if (entry?.tool === "account_list_emails") {
    const emails = Array.isArray(metadata.emails) ? metadata.emails : [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (emails.length === 0) {
      return zh
        ? `总结来看，${formatAccountLabel(account)} 目前没有查到邮件。`
        : `In summary, no emails were found in ${formatAccountLabel(account)}.`;
    }
    const senders = formatCountSummary(countBy(emails, (email) => email.fromName || email.from));
    const subjects = compactList(emails, (email) => email.subject || "(no subject)", 5);
    if (expected === "action_items") {
      return zh
        ? [
            `总结来看，我查看了 ${formatAccountLabel(account)} 的 ${emails.length} 封邮件。`,
            senders ? `主要来源：${senders}。` : null,
            "建议下一步：",
            ...subjects.map((subject) => `- 查看并判断是否需要回复：${subject}`)
          ].filter(Boolean).join("\n")
        : [
            `In summary, I reviewed ${emails.length} emails in ${formatAccountLabel(account)}.`,
            senders ? `Main senders: ${senders}.` : null,
            "Recommended next steps:",
            ...subjects.map((subject) => `- Review and decide whether to reply: ${subject}`)
          ].filter(Boolean).join("\n");
    }
    return zh
      ? [
          `总结来看，我查看了 ${formatAccountLabel(account)} 的 ${emails.length} 封邮件。`,
          senders ? `主要来源：${senders}。` : null,
          subjects.length ? `最近涉及的主题包括：${subjects.join("；")}。` : null,
          "如果需要，我可以继续按重要性、待回复事项或时间范围做进一步整理。"
        ].filter(Boolean).join("\n")
      : [
          `In summary, I reviewed ${emails.length} emails in ${formatAccountLabel(account)}.`,
          senders ? `Main senders: ${senders}.` : null,
          subjects.length ? `Recent subjects include: ${subjects.join("; ")}.` : null,
          "I can further organize them by priority, reply-needed items, or date range."
        ].filter(Boolean).join("\n");
  }

  if (entry?.tool === "account_list_files") {
    const files = Array.isArray(metadata.files) ? metadata.files : [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    const names = compactList(files, (file) => file.name || "(untitled)", 6);
    return zh
      ? [
          `总结来看，我查看了 ${formatAccountLabel(account)} 的云端文件，共 ${files.length} 个结果。`,
          names.length ? `主要文件：${names.join("；")}。` : null,
          "这些是文件清单信息；若要分析内容，需要继续下载或读取具体文件。"
        ].filter(Boolean).join("\n")
      : [
          `In summary, I found ${files.length} cloud-file results in ${formatAccountLabel(account)}.`,
          names.length ? `Main files: ${names.join("; ")}.` : null,
          "These are file listings; content analysis requires downloading or reading the specific files."
        ].filter(Boolean).join("\n");
  }

  if (entry?.tool === "account_list_events") {
    const events = Array.isArray(metadata.events) ? metadata.events : [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    const titles = compactList(events, (event) => event.title || "(untitled)", 6);
    return zh
      ? [
          `总结来看，我查看了 ${formatAccountLabel(account)} 的日历，共 ${events.length} 个事件。`,
          titles.length ? `主要事件：${titles.join("；")}。` : null,
          "如果需要，我可以继续按时间冲突、优先级或待准备事项整理。"
        ].filter(Boolean).join("\n")
      : [
          `In summary, I found ${events.length} calendar events in ${formatAccountLabel(account)}.`,
          titles.length ? `Main events: ${titles.join("; ")}.` : null,
          "I can further organize them by conflicts, priority, or preparation items."
        ].filter(Boolean).join("\n");
  }

  return null;
}

export function connectorFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const rawAllowed = allowsRawConnectorFinal(taskSpec);
  const entry = [...(transcript ?? [])].reverse().find((item) =>
    item.type === "tool_result"
    && item.success === true
    && ["account_list_connected_accounts", "account_list_emails", "account_list_files", "account_list_events"].includes(item.tool)
  );
  if (!entry) return fallbackText;
  if (rawAllowed) return formatConnectorFinal(entry, userCommand);
  const expected = taskSpec?.synthesis?.expected_output;
  const needsSynthesis = expected === null
    || expected === undefined
    || expected === ""
    || SYNTHESIS_REQUIRED_OUTPUTS.has(expected);
  if (needsSynthesis) {
    const zh = hasCjk(userCommand);
    return zh
      ? "工具已经返回了连接器数据，但最终答复仍需要按你的请求进行总结/分析，不能直接把原始记录列表当作答案。"
      : "The connector returned data, but the final answer still needs synthesis rather than a raw record list.";
  }
  return fallbackText ?? entry.observation ?? null;
}

const ACTION_CONFIRMATION_TOOLS = new Set(["launch_app", "open_url", "open_file", "copy_to_clipboard", "notify"]);

export function actionCompletionFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const completed = (transcript ?? []).filter((entry) =>
    entry?.type === "tool_result"
    && entry.success === true
    && ACTION_CONFIRMATION_TOOLS.has(entry.tool)
    && typeof entry.observation === "string"
    && entry.observation.trim()
  );
  void taskSpec;
  if (completed.length === 0) return fallbackText;
  const observations = [...new Set(completed.map((entry) => entry.observation.trim()))];
  const zh = hasCjk(userCommand);
  return zh
    ? `已完成这些操作：\n${observations.map((line) => `- ${line}`).join("\n")}`
    : `Completed these actions:\n${observations.map((line) => `- ${line}`).join("\n")}`;
}

export function isLaunchDisambiguationResult(entry = {}) {
  return entry?.tool === "launch_app"
    && entry.success === false
    && entry.metadata?.disambiguation_required === true
    && entry.metadata?.disambiguation_type === "launch_app_candidate"
    && Array.isArray(entry.metadata?.candidates)
    && entry.metadata.candidates.length > 0;
}

export function formatLaunchDisambiguationFallback(attempts = [], userCommand = "") {
  const entries = attempts.filter(isLaunchDisambiguationResult);
  if (entries.length === 0) return null;
  const zh = hasCjk(userCommand);
  const lines = [
    zh
      ? "我找到了多个可能的应用，请选择要打开哪一个："
      : "I found multiple possible apps. Please choose which one to open:"
  ];
  for (const entry of entries) {
    const target = entry.metadata?.target_app || entry.args?.app || "";
    if (target) lines.push(`${target}:`);
    for (const [index, candidate] of entry.metadata.candidates.entries()) {
      const label = candidate.display_name || candidate.app_id || candidate.exe_path || `Candidate ${index + 1}`;
      const targetPath = candidate.exe_path || candidate.app_id || "";
      const devSuffix = candidate.is_dev_tool ? (zh ? "（开发工具）" : " (developer tool)") : "";
      lines.push(`${index + 1}. ${label}${devSuffix}${targetPath ? ` — ${targetPath}` : ""}`);
    }
  }
  lines.push(zh ? "你确认后我会继续打开对应应用。" : "Once you choose, I can continue with that app.");
  return lines.join("\n");
}

export function actionAttemptFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const attempts = (transcript ?? []).filter((entry) =>
    entry?.type === "tool_result"
    && ACTION_CONFIRMATION_TOOLS.has(entry.tool)
    && typeof entry.observation === "string"
    && entry.observation.trim()
  );
  void taskSpec;
  if (attempts.length === 0) return fallbackText;
  const completed = [...new Set(attempts
    .filter((entry) => entry.success !== false)
    .map((entry) => entry.observation.trim()))];
  const disambiguation = formatLaunchDisambiguationFallback(attempts, userCommand);
  const failed = [...new Set(attempts
    .filter((entry) => entry.success === false && !isLaunchDisambiguationResult(entry))
    .map((entry) => entry.observation.trim()))];
  const zh = hasCjk(userCommand);
  const lines = [];
  if (completed.length > 0) {
    lines.push(zh ? "已完成这些操作：" : "Completed:");
    lines.push(...completed.map((line) => `- ${line}`));
  }
  if (disambiguation) {
    lines.push(disambiguation);
  }
  if (failed.length > 0) {
    lines.push(zh ? "还有这些操作没有完成：" : "Not completed:");
    lines.push(...failed.map((line) => `- ${line}`));
  }
  return lines.length > 0 ? lines.join("\n") : fallbackText;
}

export function finalFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const actionAttempt = actionAttemptFallbackText(transcript, userCommand, taskSpec);
  if (actionAttempt) return actionAttempt;
  const actionFallback = actionCompletionFallbackText(transcript, userCommand, taskSpec);
  if (actionFallback) return actionFallback;
  return connectorFallbackText(transcript, userCommand, taskSpec)
    ?? fallbackText;
}

export function hasToolTranscript(transcript = []) {
  return transcript.some((entry) => entry?.type === "tool_result");
}

function isActionConfirmationOnly(transcript = []) {
  const results = transcript.filter((entry) => entry?.type === "tool_result");
  return results.length > 0
    && results.every((entry) => entry.success !== false && ACTION_CONFIRMATION_TOOLS.has(entry.tool));
}

export function hasActionAttempts(transcript = []) {
  return transcript.some((entry) =>
    entry?.type === "tool_result"
    && ACTION_CONFIRMATION_TOOLS.has(entry.tool)
  );
}

function actionAttemptKey(entry = {}) {
  return `${entry.tool}::${JSON.stringify(entry.args ?? {})}`;
}

export function hasUnresolvedActionFailure(transcript = []) {
  const latestStatusByAction = new Map();
  for (const entry of transcript ?? []) {
    if (entry?.type !== "tool_result" || !ACTION_CONFIRMATION_TOOLS.has(entry.tool)) continue;
    latestStatusByAction.set(actionAttemptKey(entry), entry.success === false ? "failed" : "succeeded");
  }
  return [...latestStatusByAction.values()].some((status) => status === "failed");
}

export function needsFinalComposer(task, transcript = []) {
  if (!hasToolTranscript(transcript)) return false;
  if (allowsRawConnectorFinal(task?.task_spec)) return false;
  if ((task?.task_spec ?? task?.task_spec_initial)?.goal === "launch_and_act" && hasActionAttempts(transcript)) return false;
  if (isActionConfirmationOnly(transcript)) return false;
  return true;
}

export function compactTranscriptForComposer(transcript = []) {
  const lines = [];
  for (const [index, entry] of transcript.entries()) {
    if (entry?.type === "tool_result") {
      const status = entry.success === false ? "failed" : "success";
      const obs = String(entry.observation ?? "").replace(/\s+/g, " ").trim().slice(0, 5000);
      const metadata = entry.metadata
        ? ` metadata=${JSON.stringify(entry.metadata).slice(0, 1000)}`
        : "";
      lines.push(`${index + 1}. ${entry.tool}(${JSON.stringify(entry.args ?? {}).slice(0, 500)}) ${status}: ${obs}${metadata}`);
    } else if (entry?.type === "tool_denied") {
      lines.push(`${index + 1}. ${entry.tool} denied: ${entry.reason ?? "denied"}`);
    } else if (entry?.type === "validation_error") {
      lines.push(`${index + 1}. ${entry.tool} validation_error: ${entry.error ?? "invalid arguments"}`);
    }
  }
  return lines.join("\n").slice(0, 24000);
}

export function localFallbackFinal({ task, transcript, reason = "" }) {
  const userCommand = task?.user_command ?? "";
  const actionAttempt = actionAttemptFallbackText(transcript, userCommand, task?.task_spec);
  if (actionAttempt) return actionAttempt;
  const action = actionCompletionFallbackText(transcript, userCommand, task?.task_spec);
  if (action) return action;
  const connectorEntry = [...(transcript ?? [])].reverse().find((item) =>
    item.type === "tool_result"
    && item.success === true
    && ["account_list_emails", "account_list_files", "account_list_events"].includes(item.tool)
  );
  const connectorSynthesis = connectorEntry
    ? formatConnectorSynthesisFinal(connectorEntry, userCommand, task?.task_spec)
    : null;
  if (connectorSynthesis) return connectorSynthesis;
  const connector = connectorFallbackText(transcript, userCommand, { synthesis: { expected_output: "raw_results" } });
  if (connector) return connector;
  // C15: classify network-class failures and surface a specific
  // user-facing message ("needs network" / "needs provider config" /
  // "needs connected account" / "rate limited") instead of a generic
  // "Reason: <opaque>". Per R's rule the message MUST tell the user
  // what to do, not pretend the task is impossible. Local progress
  // (transcript observations from successful tools) is preserved
  // below — the classified message is appended to the existing
  // observation summary.
  const networkFailure = detectNetworkFailureInTranscript(transcript);
  const failureMsg = networkFailure ? formatFailureMessage(networkFailure) : null;
  const latest = [...(transcript ?? [])].reverse()
    .find((entry) => entry?.type === "tool_result" && String(entry.observation ?? "").trim());
  const zh = hasCjk(userCommand);
  const obs = String(latest?.observation ?? "").trim().slice(0, 800);
  if (obs) {
    const summaryHeader = zh
      ? `我已经拿到工具返回的信息，但最终整理没有完成。可用信息如下：\n${obs}`
      : `I collected tool results, but final synthesis did not complete. Available information:\n${obs}`;
    if (failureMsg) {
      const tail = zh ? failureMsg.zh : failureMsg.en;
      return `${summaryHeader}\n\n${tail}`;
    }
    return summaryHeader;
  }
  if (failureMsg) {
    return zh ? failureMsg.zh : failureMsg.en;
  }
  return zh
    ? `这次没有拿到足够的工具结果来完成最终答复。${reason ? `原因：${reason}` : ""}`.trim()
    : `I could not collect enough tool results to finish the answer.${reason ? ` Reason: ${reason}` : ""}`.trim();
}
