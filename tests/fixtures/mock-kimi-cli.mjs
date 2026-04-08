import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", async () => {
  const taskPackage = JSON.parse(input.trim());
  const outputDir = taskPackage.output_requirements.output_dir;
  const reportPath = path.join(outputDir, "report.md");

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    reportPath,
    `# Mock Report\n\nTask: ${taskPackage.task_id}\n\nFiles: ${taskPackage.context.file_paths.join(", ")}\n`,
    "utf8"
  );

  const events = [
    { type: "accepted", ts: Date.now() },
    { type: "started", ts: Date.now() + 10 },
    { type: "step_started", ts: Date.now() + 20, step: "read_sources" },
    { type: "step_finished", ts: Date.now() + 40, step: "read_sources" },
    { type: "artifact_created", ts: Date.now() + 50, path: reportPath, mime: "text/markdown" },
    { type: "success", ts: Date.now() + 60, summary: "Mock Kimi task completed." }
  ];

  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
});
