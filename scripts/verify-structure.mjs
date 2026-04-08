import { existsSync } from "node:fs";

const requiredPaths = [
  "README.md",
  "package.json",
  "phases/README.md",
  "phases/tasks/README.md",
  "phases/tasks/TASK_INDEX.md",
  "docs/planning/universal_context_agent_detailed_plan.md",
  "docs/planning/requirements_response.md",
  "src/shared/contracts/ai-provider.ts",
  "src/shared/contracts/code-cli.ts",
  "src/shared/contracts/mcp.ts",
  "src/shared/contracts/skill.ts",
  "src/service/ai/providers/README.md",
  "src/service/ai/code_cli/README.md",
  "src/service/ai/mcp/README.md",
  "src/service/ai/skills/README.md"
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error("Missing required paths:");
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log("Repository structure verification passed.");
