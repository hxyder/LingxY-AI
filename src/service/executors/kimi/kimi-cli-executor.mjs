import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { finalizeJsonLines, parseJsonLinesChunk } from "./jsonl-parser.mjs";
import { buildKimiPrintPrompt, deriveKimiWorkspace } from "./print-mode-prompt.mjs";
import { detectRequestedOutputFormat, writeRequestedArtifacts } from "./output-format.mjs";

export function createKimiCliExecutorScaffold() {
  return {
    id: "kimi",
    displayName: "Kimi CLI Executor",
    executionMode: "approval_required",
    transport: "jsonl_stdio",
    maxConcurrent: 2
  };
}

export async function executeKimiTask({
  command,
  args = [],
  env = process.env,
  taskPackage,
  transport = "jsonl_task_package",
  model = null,
  reasoningEffort = "",
  configFile = null,
  mcpConfigFiles = [],
  maxRuntimeSeconds = 600,
  onEvent = () => {},
  abortSignal
}) {
  if (transport === "stream_json_print") {
    return executeKimiPrintModeTask({
      command,
      args,
      env,
      taskPackage,
      model,
      reasoningEffort,
      configFile,
      mcpConfigFiles,
      maxRuntimeSeconds,
      onEvent,
      abortSignal
    });
  }

  return executeKimiJsonlTask({
    command,
    args,
    env,
    taskPackage,
    maxRuntimeSeconds,
    onEvent,
    abortSignal
  });
}

async function executeKimiJsonlTask({
  command,
  args = [],
  env = process.env,
  taskPackage,
  maxRuntimeSeconds = 600,
  onEvent = () => {},
  abortSignal
}) {
  const child = spawn(command, args, {
    env: {
      ...env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdin.setDefaultEncoding?.("utf8");

  const events = [];
  const artifacts = [];
  const parserState = { remainder: "" };
  const stderrPath = path.join(taskPackage.output_requirements.output_dir, "kimi.stderr.log");
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });
  let aborted = abortSignal?.aborted ?? false;
  let forceKillTimer = null;

  child.stderr.pipe(stderrStream);

  const publish = (event) => {
    const normalized = {
      type: event.type,
      ts: event.ts ?? Date.now(),
      ...event
    };

    events.push(normalized);
    if (normalized.type === "artifact_created" && normalized.path) {
      artifacts.push({
        path: normalized.path,
        mime_type: normalized.mime ?? "application/octet-stream"
      });
    }
    onEvent(normalized);
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const parsedEvents = parseJsonLinesChunk(chunk, parserState);
    for (const event of parsedEvents) {
      publish(event);
    }
  });

  const timeoutHandle = setTimeout(() => {
    aborted = true;
    child.kill("SIGTERM");
  }, maxRuntimeSeconds * 1000);

  const abortListener = () => {
    aborted = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 250);
  };

  abortSignal?.addEventListener("abort", abortListener, { once: true });

  child.stdin.write(Buffer.from(`${JSON.stringify(taskPackage)}\n`, "utf8"));
  child.stdin.end();

  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    clearTimeout(timeoutHandle);
    clearTimeout(forceKillTimer);
    abortSignal?.removeEventListener("abort", abortListener);
    stderrStream.end();
  });

  for (const event of finalizeJsonLines(parserState)) {
    publish(event);
  }

  return {
    status: aborted || exit.signal ? "cancelled" : exit.code === 0 ? "success" : "failed",
    exitCode: exit.code,
    exitSignal: exit.signal,
    events,
    artifacts,
    stderrPath
  };
}

function extractAssistantText(message) {
  return extractCliAssistantText(message).trim();
}

function extractContentText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractContentText).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.output_text === "string") return content.output_text;
    if (typeof content.message === "string") return content.message;
    if (typeof content.content === "string") return content.content;
    if (content.type === "text" || content.type === "output_text") {
      return extractContentText(content.content ?? content.text ?? content.output_text);
    }
  }
  return "";
}

function extractCliAssistantText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.role === "assistant") {
    return extractContentText(event.content ?? event.message ?? event.text);
  }
  if (event.item?.role === "assistant") {
    return extractContentText(event.item.content ?? event.item.message ?? event.item.text);
  }
  if (event.message?.role === "assistant") {
    return extractContentText(event.message.content ?? event.message.text);
  }
  if (event.type === "agent_message" || event.type === "assistant_message") {
    return extractContentText(event.message ?? event.text ?? event.content);
  }
  if (event.type === "item.completed" || event.type === "response.output_item.done") {
    return extractCliAssistantText(event.item ?? event.output ?? event.message);
  }
  return "";
}

function isCodexCommand(command = "") {
  return /codex(\.exe)?$/i.test(`${command ?? ""}`);
}

function isKimiCommand(command = "") {
  return /kimi(\.exe)?$/i.test(`${command ?? ""}`);
}

function isClaudeCommand(command = "") {
  return /claude(\.exe)?$/i.test(`${command ?? ""}`);
}

function hasAnyFlag(args, ...flags) {
  return args.some((arg) => flags.includes(arg));
}

function hasCodexSubcommand(args) {
  const firstPositional = args.find((arg) => !String(arg).startsWith("-"));
  return ["exec", "resume", "review", "help"].includes(`${firstPositional ?? ""}`);
}

function normalizeCodexReasoningEffort(value = "") {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "extra_high" || normalized === "extra-high") return "xhigh";
  if (["low", "medium", "high", "xhigh"].includes(normalized)) return normalized;
  return "";
}

function pushFlagValue(args, flag, value) {
  if (!value || args.includes(flag)) return;
  args.push(flag, value);
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
  if (!args.includes("--output-format")) args.push("--output-format", "stream-json");
  if (!args.includes("--input-format")) args.push("--input-format", "text");
}

function buildPrintInvocationArgs({
  command,
  args = [],
  model = null,
  reasoningEffort = "",
  configFile = null,
  mcpConfigFiles = [],
  workDir,
  addDirs = []
} = {}) {
  const invocationArgs = [...args];

  if (isCodexCommand(command)) {
    if (!hasCodexSubcommand(invocationArgs)) {
      invocationArgs.unshift("exec");
    }
    if (!hasAnyFlag(invocationArgs, "--json")) invocationArgs.push("--json");
    if (!hasAnyFlag(invocationArgs, "-C", "--cd") && workDir) {
      invocationArgs.push("-C", workDir);
    }
    if (!hasAnyFlag(invocationArgs, "--skip-git-repo-check")) {
      invocationArgs.push("--skip-git-repo-check");
    }
    if (!hasAnyFlag(invocationArgs, "--model", "-m")) pushFlagValue(invocationArgs, "--model", model);
    pushCodexConfig(invocationArgs, "model_reasoning_effort", normalizeCodexReasoningEffort(reasoningEffort));
    for (const extraDir of addDirs) {
      invocationArgs.push("--add-dir", extraDir);
    }
    return invocationArgs;
  }

  pushPrintFlags(invocationArgs);

  if (isKimiCommand(command) && !hasAnyFlag(invocationArgs, "-w", "--work-dir") && workDir) {
    invocationArgs.push("-w", workDir);
  }

  if (model && !hasAnyFlag(invocationArgs, "--model", "-m")) {
    invocationArgs.push("--model", model);
  }
  if (configFile && isKimiCommand(command)) {
    invocationArgs.push("--config-file", configFile);
  } else if (configFile && isClaudeCommand(command)) {
    invocationArgs.push("--settings", configFile);
  }
  for (const extraDir of addDirs) {
    invocationArgs.push("--add-dir", extraDir);
  }
  for (const mcpConfigFile of mcpConfigFiles) {
    if (isKimiCommand(command)) {
      invocationArgs.push("--mcp-config-file", mcpConfigFile);
    } else if (isClaudeCommand(command)) {
      invocationArgs.push("--mcp-config", mcpConfigFile);
    }
  }

  return invocationArgs;
}

async function executeKimiPrintModeTask({
  command,
  args = [],
  env = process.env,
  taskPackage,
  model = null,
  reasoningEffort = "",
  configFile = null,
  mcpConfigFiles = [],
  maxRuntimeSeconds = 600,
  onEvent = () => {},
  abortSignal
}) {
  await mkdir(taskPackage.output_requirements.output_dir, { recursive: true });

  const { workDir, addDirs } = deriveKimiWorkspace(taskPackage);
  const prompt = buildKimiPrintPrompt({ taskPackage });
  const stderrPath = path.join(taskPackage.output_requirements.output_dir, "kimi.stderr.log");
  const stdoutPath = path.join(taskPackage.output_requirements.output_dir, "kimi.stdout.log");
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const invocationArgs = buildPrintInvocationArgs({
    command,
    args,
    model,
    reasoningEffort,
    configFile,
    mcpConfigFiles,
    workDir,
    addDirs
  });

  const child = spawn(command, invocationArgs, {
    env: {
      ...env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    },
    stdio: ["pipe", "pipe", "pipe"],
    cwd: workDir || process.cwd(),
    windowsHide: true
  });

  child.stdin.setDefaultEncoding?.("utf8");

  let aborted = abortSignal?.aborted ?? false;
  let forceKillTimer = null;
  let remainder = "";
  const transcript = [];
  const events = [];
  const artifacts = [];

  const publish = (event) => {
    const normalized = {
      type: event.type,
      ts: event.ts ?? Date.now(),
      ...event
    };
    events.push(normalized);
    if (normalized.type === "artifact_created" && normalized.path) {
      artifacts.push({
        path: normalized.path,
        mime_type: normalized.mime ?? "application/octet-stream"
      });
    }
    onEvent(normalized);
  };

  publish({ type: "accepted" });
  publish({ type: "started" });
  publish({ type: "step_started", step: "run_kimi_cli", progress: 0.1 });

  child.stderr.pipe(stderrStream);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutStream.write(chunk);
    remainder += chunk;
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      try {
        transcript.push(JSON.parse(line));
      } catch {
        transcript.push({
          role: "system",
          content: [{ type: "text", text: line }]
        });
      }
    }
  });

  const timeoutHandle = setTimeout(() => {
    aborted = true;
    child.kill("SIGTERM");
  }, maxRuntimeSeconds * 1000);

  const abortListener = () => {
    aborted = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 250);
  };

  abortSignal?.addEventListener("abort", abortListener, { once: true });
  child.stdin.write(Buffer.from(prompt, "utf8"));
  child.stdin.end();

  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    clearTimeout(timeoutHandle);
    clearTimeout(forceKillTimer);
    abortSignal?.removeEventListener("abort", abortListener);
    stderrStream.end();
    stdoutStream.end();
  });

  if (remainder.trim()) {
    try {
      transcript.push(JSON.parse(remainder.trim()));
    } catch {
      transcript.push({
        role: "system",
        content: [{ type: "text", text: remainder.trim() }]
      });
    }
  }

  if (aborted || exit.signal) {
    return {
      status: "cancelled",
      exitCode: exit.code,
      exitSignal: exit.signal,
      events,
      artifacts,
      stderrPath
    };
  }

  if (exit.code !== 0) {
    return {
      status: "failed",
      exitCode: exit.code,
      exitSignal: exit.signal,
      events,
      artifacts,
      stderrPath
    };
  }

  const finalAssistantText = [...transcript]
    .reverse()
    .map(extractAssistantText)
    .find((entry) => entry.length > 0) ?? "";

  const requestedFormat = detectRequestedOutputFormat(taskPackage.user_command);

  if (requestedFormat.id === "conversational") {
    publish({ type: "step_finished", step: "run_kimi_cli", progress: 0.95 });
    publish({
      type: "inline_result",
      text: finalAssistantText || "No response from AI."
    });
    publish({ type: "success", summary: finalAssistantText.slice(0, 200) });

    return {
      status: "success",
      exitCode: exit.code,
      exitSignal: exit.signal,
      events,
      artifacts,
      inlineText: finalAssistantText,
      stderrPath,
      stdoutPath
    };
  }

  const outputArtifacts = await writeRequestedArtifacts({
    assistantText: finalAssistantText,
    outputDir: taskPackage.output_requirements.output_dir,
    requestedFormat
  });

  publish({ type: "step_finished", step: "run_kimi_cli", progress: 0.95 });
  for (const artifact of outputArtifacts) {
    publish({ type: "artifact_created", path: artifact.path, mime: artifact.mime_type });
  }
  publish({ type: "success", summary: "Kimi CLI print-mode execution completed." });

  return {
    status: "success",
    exitCode: exit.code,
    exitSignal: exit.signal,
    events,
    artifacts,
    stderrPath,
    stdoutPath
  };
}

export const __testBuildPrintInvocationArgs = buildPrintInvocationArgs;
