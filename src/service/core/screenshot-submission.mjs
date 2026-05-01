import { submitImageTask } from "./image-submission.mjs";

export async function submitScreenshotTask({
  screenshotPath,
  userCommand = "请总结这张截图",
  runtime,
  executionMode = "interactive"
}) {
  return submitImageTask({
    imagePaths: [screenshotPath],
    userCommand,
    source: "screenshot",
    sourceApp: "uca.helper.screenshot",
    captureMode: "hotkey",
    runtime,
    executionMode,
    submissionKind: "screenshot"
  });
}
