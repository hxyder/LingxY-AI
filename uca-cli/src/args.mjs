export function parseSubmitArgs(argv) {
  const args = [...argv];
  const command = args.shift();

  if (command !== "submit") {
    throw new Error(`Unsupported command: ${command ?? "<empty>"}`);
  }

  const result = {
    command,
    files: [],
    intent: "generate_report",
    userCommand: "分析这些文件并生成详细报告",
    captureMode: "shell_menu",
    sourceApp: "explorer.exe",
    batchKey: null,
    flushWindowMs: 300
  };

  while (args.length > 0) {
    const token = args.shift();

    switch (token) {
      case "--files":
        while (args.length > 0 && !args[0].startsWith("--")) {
          result.files.push(args.shift());
        }
        break;
      case "--intent":
        result.intent = args.shift() ?? result.intent;
        break;
      case "--command":
        result.userCommand = args.shift() ?? result.userCommand;
        break;
      case "--capture-mode":
        result.captureMode = args.shift() ?? result.captureMode;
        break;
      case "--source-app":
        result.sourceApp = args.shift() ?? result.sourceApp;
        break;
      case "--batch-key":
        result.batchKey = args.shift() ?? null;
        break;
      case "--flush-window-ms":
        result.flushWindowMs = Number.parseInt(args.shift() ?? "", 10) || result.flushWindowMs;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (result.files.length === 0) {
    throw new Error("No files were provided.");
  }

  return result;
}
