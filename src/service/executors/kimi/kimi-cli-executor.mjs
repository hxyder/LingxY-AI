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
  if (!message || message.role !== "assistant") {
    return "";
  }
  const parts = Array.isArray(message.content) ? message.content : [];
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function executeKimiPrintModeTask({
  command,
  args = [],
  env = process.env,
  taskPackage,
  model = null,
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
  const invocationArgs = [
    ...args,
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "-w",
    workDir
  ];

  if (model) {
    invocationArgs.push("--model", model);
  }
  if (configFile) {
    invocationArgs.push("--config-file", configFile);
  }
  for (const extraDir of addDirs) {
    invocationArgs.push("--add-dir", extraDir);
  }
  for (const mcpConfigFile of mcpConfigFiles) {
    invocationArgs.push("--mcp-config-file", mcpConfigFile);
  }

  const child = spawn(command, invocationArgs, {
    env: {
      ...env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
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
