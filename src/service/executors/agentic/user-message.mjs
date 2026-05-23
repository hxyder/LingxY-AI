import { formatUntrustedSourceMaterial } from "../shared/resource-context.mjs";

export function buildAgenticUserMessage(task) {
  const parts = [];
  parts.push(task?.user_command ?? "(no user command)");

  const filePaths = task?.context_packet?.file_paths ?? [];
  if (filePaths.length > 0) {
    parts.push("");
    parts.push(`Attached files:\n${filePaths.join("\n")}`);
  }
  const untrusted = formatUntrustedSourceMaterial(task);
  if (untrusted) {
    parts.push("");
    parts.push(untrusted);
  }
  return parts.join("\n");
}
