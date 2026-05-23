function commandName(command = "") {
  const raw = `${command ?? ""}`.trim();
  if (!raw) return "";
  const leaf = raw.split(/[\\/]/).filter(Boolean).pop() ?? raw;
  return leaf.replace(/\.(exe|cmd|ps1|bat)$/i, "").toLowerCase();
}

export function getCodeCliFamily(command = "") {
  const name = commandName(command);
  if (name === "codex") return "codex";
  if (name === "claude") return "claude";
  if (name === "kimi") return "kimi";
  if (name === "gemini" || name === "qwen") return "gemini_like";
  return "generic_print";
}

function argMatchesFlag(arg, flag) {
  const value = `${arg ?? ""}`;
  return value === flag || value.startsWith(`${flag}=`);
}

export function hasAnyFlag(args = [], ...flags) {
  return args.some((arg) => flags.some((flag) => argMatchesFlag(arg, flag)));
}

function pushFlagValue(args, flag, value) {
  if (!value || hasAnyFlag(args, flag)) return;
  args.push(flag, value);
}

function pushRepeatableFlagValue(args, flag, value) {
  if (!value) return;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] === value) return;
    if (`${args[index]}` === `${flag}=${value}`) return;
  }
  args.push(flag, value);
}

function hasCodexSubcommand(args = []) {
  const firstPositional = args.find((arg) => !String(arg).startsWith("-"));
  return ["exec", "resume", "review", "help"].includes(`${firstPositional ?? ""}`);
}

export function normalizeCodexReasoningEffort(value = "") {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "extra_high" || normalized === "extra-high") return "xhigh";
  if (["low", "medium", "high", "xhigh"].includes(normalized)) return normalized;
  return "";
}

export function normalizeClaudeEffort(value = "") {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "extra_high" || normalized === "extra-high") return "xhigh";
  if (["low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  return "";
}

function normalizeKnownDisplayModel(value = "") {
  const model = `${value ?? ""}`.trim();
  const lookup = new Map([
    ["gpt-5.5", "gpt-5.5"],
    ["gpt-5.4", "gpt-5.4"],
    ["gpt-5.4 mini", "gpt-5.4-mini"],
    ["gpt-5.4 nano", "gpt-5.4-nano"],
    ["gpt-5", "gpt-5"],
    ["gpt-5.2", "gpt-5.2"],
    ["gpt-5.2 codex", "gpt-5.2-codex"],
    ["gpt-5 codex", "gpt-5-codex"],
    ["gpt-5.1 codex", "gpt-5.1-codex"],
    ["gpt-5.1 codex max", "gpt-5.1-codex-max"],
    ["gpt-5.1 codex mini", "gpt-5.1-codex-mini"],
    ["gpt-5 mini", "gpt-5-mini"],
    ["gpt-5 nano", "gpt-5-nano"],
    ["codex mini", "codex-mini-latest"],
    ["sonnet", "sonnet"],
    ["claude sonnet", "sonnet"],
    ["opus", "opus"],
    ["claude opus", "opus"],
    ["haiku", "haiku"],
    ["claude haiku", "haiku"],
    ["best", "best"],
    ["claude best", "best"],
    ["default", "default"],
    ["opusplan", "opusplan"],
    ["opus 1m", "opus[1m]"],
    ["sonnet 1m", "sonnet[1m]"],
    ["claude opus 4.7", "claude-opus-4-7"],
    ["claude sonnet 4.6", "claude-sonnet-4-6"],
    ["claude haiku 4.5", "claude-haiku-4-5"]
  ]);
  return lookup.get(model.toLowerCase()) ?? model;
}

export function normalizeCodeCliModel({ command = "", model = "" } = {}) {
  const family = getCodeCliFamily(command);
  let normalized = normalizeKnownDisplayModel(model);
  if (!normalized) return "";

  if (family === "codex") {
    // ChatGPT-backed Codex CLI rejects old general chat models that were
    // previously offered by the UI. Let Codex use its configured default.
    if (/^(?:openai\/)?gpt-4o(?:-mini)?$/i.test(normalized)) return "";
    return normalized;
  }

  if (family === "claude") {
    normalized = normalized
      .replace(/^claude-(sonnet|opus|haiku)-4-5-\d{8}$/i, "claude-$1-4-5")
      .replace(/^claude-(sonnet|opus|haiku)-4-6-\d{8}$/i, "claude-$1-4-6")
      .replace(/^claude-(sonnet|opus|haiku)-4-7-\d{8}$/i, "claude-$1-4-7");
  }

  return normalized;
}

function pushCodexConfig(args, key, value) {
  if (!value) return;
  const prefix = `${key}=`;
  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === "-c" || args[index] === "--config") && `${args[index + 1] ?? ""}`.startsWith(prefix)) {
      return;
    }
  }
  args.push("-c", `${key}="${value}"`);
}

function pushPrintFlags(args) {
  if (!hasAnyFlag(args, "--print", "-p")) args.push("--print");
  if (!hasAnyFlag(args, "--output-format")) args.push("--output-format", "stream-json");
  if (!hasAnyFlag(args, "--input-format")) args.push("--input-format", "text");
}

function pushClaudePrintCompatibilityFlags(args) {
  if (!hasAnyFlag(args, "--verbose")) args.push("--verbose");
}

function pushClaudeEffortFlag(args, value = "") {
  pushFlagValue(args, "--effort", normalizeClaudeEffort(value));
}

function pushGeminiLikeHeadlessFlags(args) {
  if (!hasAnyFlag(args, "--prompt", "-p")) args.push("--prompt", "");
  if (!hasAnyFlag(args, "--output-format", "-o")) args.push("--output-format", "stream-json");
}

export function buildCodeCliInvocationArgs({
  command,
  args = [],
  transport = "stream_json_print",
  model = null,
  reasoningEffort = "",
  configFile = null,
  mcpConfigFiles = [],
  workDir = "",
  addDirs = [],
  imagePaths = []
} = {}) {
  const invocationArgs = [...(Array.isArray(args) ? args : [])];
  const family = getCodeCliFamily(command);
  const normalizedModel = normalizeCodeCliModel({ command, model });

  if (transport !== "stream_json_print") {
    pushFlagValue(invocationArgs, "--model", normalizedModel);
    return invocationArgs;
  }

  if (family === "codex") {
    if (!hasCodexSubcommand(invocationArgs)) invocationArgs.unshift("exec");
    if (!hasAnyFlag(invocationArgs, "--json")) invocationArgs.push("--json");
    if (!hasAnyFlag(invocationArgs, "-C", "--cd") && workDir) invocationArgs.push("-C", workDir);
    if (!hasAnyFlag(invocationArgs, "--skip-git-repo-check")) invocationArgs.push("--skip-git-repo-check");
    if (!hasAnyFlag(invocationArgs, "--model", "-m")) pushFlagValue(invocationArgs, "--model", normalizedModel);
    pushCodexConfig(invocationArgs, "model_reasoning_effort", normalizeCodexReasoningEffort(reasoningEffort));
    if (!hasAnyFlag(invocationArgs, "--image", "-i")) {
      for (const imagePath of imagePaths) {
        pushRepeatableFlagValue(invocationArgs, "--image", imagePath);
      }
    }
    for (const extraDir of addDirs) {
      pushRepeatableFlagValue(invocationArgs, "--add-dir", extraDir);
    }
    return invocationArgs;
  }

  if (family === "gemini_like") {
    pushGeminiLikeHeadlessFlags(invocationArgs);
    pushFlagValue(invocationArgs, "--model", normalizedModel);
    for (const extraDir of addDirs) {
      pushRepeatableFlagValue(invocationArgs, "--include-directories", extraDir);
    }
    return invocationArgs;
  }

  pushPrintFlags(invocationArgs);

  if (family === "claude") {
    pushClaudePrintCompatibilityFlags(invocationArgs);
    pushClaudeEffortFlag(invocationArgs, reasoningEffort);
  }

  if (family === "kimi" && !hasAnyFlag(invocationArgs, "-w", "--work-dir") && workDir) {
    invocationArgs.push("-w", workDir);
  }

  if (!hasAnyFlag(invocationArgs, "--model", "-m")) {
    pushFlagValue(invocationArgs, "--model", normalizedModel);
  }

  if (configFile && family === "kimi") {
    pushFlagValue(invocationArgs, "--config-file", configFile);
  } else if (configFile && family === "claude") {
    pushFlagValue(invocationArgs, "--settings", configFile);
  }

  for (const extraDir of addDirs) {
    pushRepeatableFlagValue(invocationArgs, "--add-dir", extraDir);
  }

  for (const mcpConfigFile of mcpConfigFiles ?? []) {
    if (family === "kimi") {
      pushRepeatableFlagValue(invocationArgs, "--mcp-config-file", mcpConfigFile);
    } else if (family === "claude") {
      pushRepeatableFlagValue(invocationArgs, "--mcp-config", mcpConfigFile);
    }
  }

  return invocationArgs;
}
