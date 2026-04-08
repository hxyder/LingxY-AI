import { isExecutablePath, isSafePath } from "./tool-helper.mjs";

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
      requiresConfirmation = !(ctx.allowedApps ?? []).includes(args.app);
      reason = requiresConfirmation ? "launch_app_not_in_whitelist" : null;
      break;
    case "file_op":
      if (args.operation === "delete") {
        requiresConfirmation = true;
        reason = "delete_requires_confirmation";
      } else if (args.operation === "move" || args.operation === "rename") {
        requiresConfirmation = true;
        reason = "mutating_file_operation_requires_confirmation";
      } else if (args.operation === "create_folder") {
        requiresConfirmation = !isSafePath(args.path ?? "", ctx.allowedRoots ?? []);
        reason = requiresConfirmation ? "create_folder_outside_allowed_roots" : null;
      }
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
