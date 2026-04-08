import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { finalizeJsonLines, parseJsonLinesChunk } from "./jsonl-parser.mjs";

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
  maxRuntimeSeconds = 600,
  onEvent = () => {},
  abortSignal
}) {
  const child = spawn(command, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

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

  child.stdin.write(`${JSON.stringify(taskPackage)}\n`);
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
