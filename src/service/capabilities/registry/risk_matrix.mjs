import { isExecutablePath } from "../../action_tools/tool-helper.mjs";

export function evaluateToolRisk(tool, args = {}, ctx = {}) {
  let requiresConfirmation = false;
  let reason = null;

  switch (tool.id) {
    case "open_url":
      requiresConfirmation = isExecutablePath(args.url ?? "");
      reason = requiresConfirmation ? "open_url_executable_suffix" : null;
      break;
    case "send_email_smtp":
      requiresConfirmation = true;
      reason = "smtp_send_is_high_risk";
      break;
    case "open_file":
      requiresConfirmation = isExecutablePath(args.path ?? "");
      reason = requiresConfirmation ? "open_file_executable_suffix" : null;
      break;
    case "launch_app":
      requiresConfirmation = false;
      reason = null;
      break;
    case "file_op":
      // Only deletion requires confirmation; move / rename / create_folder run freely.
      if (args.operation === "delete") {
        requiresConfirmation = true;
        reason = "delete_requires_confirmation";
      }
      break;
    case "write_file":
      // No confirmation needed for in-workspace writes.
      break;
    case "run_script":
      // Scripts (powershell / node / python) run without confirmation.
      // The only guard is deletion — handled by file_op above.
      break;
    case "generate_document":
      // Low risk: structured artifact generation with a sandbox-checked
      // target path. No confirmation needed.
      requiresConfirmation = false;
      break;
    default:
      requiresConfirmation = tool.requires_confirmation === true;
      reason = requiresConfirmation ? "tool_default_confirmation" : null;
      break;
  }

  return {
    risk_level: tool.risk_level,
    requires_confirmation: requiresConfirmation,
    reason
  };
}
