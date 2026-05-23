import { createFastExecutorScaffold } from "../executors/fast/fast-executor.mjs";

function buildSummaryPrompt(message) {
  const lines = [
    "请用三行要点总结这封邮件：",
    "1. 发件人是谁",
    "2. 主题的核心诉求",
    "3. 要求我做什么（如果没有请写“无明确行动”）",
    "",
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    "",
    message.bodyText
  ];
  return lines.join("\n");
}

export async function summarizeEmail({ runtime, message }) {
  const executor = runtime.executors?.find((item) => item.id === "fast") ?? createFastExecutorScaffold();
  const task = {
    task_id: `email_summary_${Date.now()}`,
    user_command: "总结这封邮件",
    context_packet: {
      schema_version: "1.0",
      context_id: `ctx_email_${Date.now()}`,
      trace_id: `trace_email_${Date.now()}`,
      source_type: "email",
      source_app: "uca.email",
      capture_mode: "system",
      security_level: "internal",
      redaction_applied: false,
      text: buildSummaryPrompt(message),
      captured_at: new Date().toISOString()
    }
  };

  let summary = "";
  for await (const event of executor.execute(task)) {
    if (event.event_type === "inline_result") {
      summary = event.payload?.text ?? summary;
    }
  }

  if (!summary) {
    summary = `发件人: ${message.from}\n主题: ${message.subject}\n行动: 无明确行动`;
  }

  return summary;
}
