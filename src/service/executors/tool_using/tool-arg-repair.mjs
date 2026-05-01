import {
  extractLaunchAppCandidates,
  normalizeLaunchAppArg,
  normalizeLaunchAppKey
} from "./planners/launch-helpers.mjs";

export function repairSchemaArgAliases(args = {}, tool = null) {
  const repaired = { ...(args ?? {}) };
  const properties = tool?.parameters?.properties && typeof tool.parameters.properties === "object"
    ? tool.parameters.properties
    : {};
  if (!("query" in repaired) && "query" in properties && typeof repaired.q === "string") {
    repaired.query = repaired.q;
    delete repaired.q;
  }
  const propertyKeys = Object.keys(properties);
  const providedKeys = Object.keys(repaired);
  if (propertyKeys.length === 1 && providedKeys.length === 1 && !(providedKeys[0] in properties)) {
    repaired[propertyKeys[0]] = repaired[providedKeys[0]];
    delete repaired[providedKeys[0]];
  }
  return repaired;
}

export function repairToolArgs(decision, task, transcript = [], tool = null) {
  if (!decision) return {};
  if (decision.tool !== "launch_app") return repairSchemaArgAliases(decision.args ?? {}, tool);
  const args = { ...(decision.args ?? {}) };
  const explicit = normalizeLaunchAppArg(args.app ?? args.name ?? args.appName);
  if (explicit) {
    args.app = explicit;
    delete args.name;
    delete args.appName;
    return repairSchemaArgAliases(args, tool);
  }

  const candidates = extractLaunchAppCandidates(task?.user_command ?? "");
  if (candidates.length === 0) return repairSchemaArgAliases(args, tool);

  const alreadyUsed = new Set(
    transcript
      .filter((entry) => entry?.type === "tool_result" && entry.tool === "launch_app")
      .map((entry) => normalizeLaunchAppKey(entry.args?.app))
      .filter(Boolean)
  );
  const next = candidates.find((candidate) => !alreadyUsed.has(normalizeLaunchAppKey(candidate)))
    ?? candidates[0];
  args.app = next;
  delete args.name;
  delete args.appName;
  return repairSchemaArgAliases(args, tool);
}
