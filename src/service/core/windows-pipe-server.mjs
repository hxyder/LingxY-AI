import net from "node:net";
import { submitFileTask } from "./file-submission.mjs";

export const DEFAULT_EXPLORER_PIPE_NAME = "\\\\.\\pipe\\uca-helper-explorer-selection";

async function handleEnvelope(runtime, envelope) {
  const result = await submitFileTask({
    filePaths: envelope.file_paths ?? [],
    userCommand: envelope.user_command ?? "分析这些文件并生成详细报告",
    captureMode: envelope.capture_mode ?? envelope.source ?? "hotkey",
    sourceApp: "explorer.exe",
    executionMode: envelope.execution_mode,
    runtime
  });

  return {
    ok: true,
    taskId: result.task.task_id,
    status: result.task.status,
    fileCount: envelope.file_paths?.length ?? 0
  };
}

export function createExplorerSelectionPipeServer({
  runtime,
  pipeName = DEFAULT_EXPLORER_PIPE_NAME
}) {
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("data", async (chunk) => {
      buffer += chunk;
      let boundary = buffer.indexOf("\n");
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (line) {
          try {
            const envelope = JSON.parse(line);
            const response = await handleEnvelope(runtime, envelope);
            socket.write(`${JSON.stringify(response)}\n`);
          } catch (error) {
            socket.write(`${JSON.stringify({
              ok: false,
              error: error.message
            })}\n`);
          }
        }
        boundary = buffer.indexOf("\n");
      }
    });
  });

  return {
    pipeName,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(pipeName, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return {
        pipeName
      };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}
