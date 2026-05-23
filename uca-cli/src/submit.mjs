import { collectFileBatch } from "./batch-collector.mjs";
import { parseSubmitArgs } from "./args.mjs";

export function buildSubmitPayload(parsedArgs, filePaths) {
  return {
    source: {
      sourceApp: parsedArgs.sourceApp,
      captureMode: parsedArgs.captureMode
    },
    task: {
      intent: parsedArgs.intent,
      userCommand: parsedArgs.userCommand,
      filePaths
    }
  };
}

export async function submitCommand(argv, transport) {
  const parsedArgs = parseSubmitArgs(argv);
  const aggregated = await collectFileBatch({
    filePaths: parsedArgs.files,
    groupKey: parsedArgs.batchKey,
    flushWindowMs: parsedArgs.flushWindowMs
  });

  if (!aggregated.submitted) {
    return {
      accepted: true,
      mode: "batched_wait",
      filePaths: []
    };
  }

  const payload = buildSubmitPayload(parsedArgs, aggregated.filePaths);
  const response = await transport.submitContextAndTask(payload);

  return {
    accepted: true,
    mode: aggregated.filePaths.length > 1 ? "file_group" : "file",
    filePaths: aggregated.filePaths,
    response
  };
}
