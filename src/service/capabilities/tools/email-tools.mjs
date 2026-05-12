import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { openWithDefaultHandler } from "./open-with-default-handler.mjs";

export const SEND_EMAIL_SMTP_TOOL = {
  id: "send_email_smtp",
  name: "Send Email SMTP",
  description: "Send an email directly over SMTP using user configuration.",
  parameters: ACTION_TOOL_SCHEMAS.send_email_smtp,
  risk_level: "high",
  required_capabilities: ["network"],
  requires_confirmation: true,
  formatObservation(args) {
    return `Sent SMTP email to ${(args.to ?? []).join(", ")}`;
  },
  async execute(args = {}) {
    return createActionResult({
      success: true,
      observation: `Sent SMTP email to ${(args.to ?? []).join(", ")}`,
      metadata: { tool_id: "send_email_smtp" }
    });
  }
};

export const COMPOSE_EMAIL_TOOL = {
  id: "compose_email",
  name: "Compose Email",
  description: "Open a mail draft with prefilled recipients, subject, and body.",
  parameters: ACTION_TOOL_SCHEMAS.compose_email,
  risk_level: "low",
  required_capabilities: ["launch_app"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Prepared a draft email to ${(args.to ?? []).join(", ")}`;
  },
  async execute(args = {}) {
    let toList = [];
    if (Array.isArray(args.to)) toList = args.to;
    else if (typeof args.to === "string" && args.to.trim()) toList = [args.to.trim()];

    let ccList = [];
    if (Array.isArray(args.cc)) ccList = args.cc;
    else if (typeof args.cc === "string" && args.cc.trim()) ccList = [args.cc.trim()];

    const subject = args.subject ?? "";
    const body = args.body ?? "";

    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    if (ccList.length > 0) params.push(`cc=${encodeURIComponent(ccList.join(","))}`);
    const mailto = `mailto:${toList.join(",")}${params.length > 0 ? "?" + params.join("&") : ""}`;

    try {
      await openWithDefaultHandler(mailto);
      const recipients = toList.length > 0 ? toList.join(", ") : "(no recipient)";
      return createActionResult({
        success: true,
        observation: `Opened email draft to ${recipients}${subject ? ` with subject "${subject}"` : ""}.`
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open email draft: ${error.message}` });
    }
  }
};
