import { existsSync } from "node:fs";

const requiredPaths = [
  "README.md",
  "package.json",
  "phases/README.md",
  "phases/tasks/README.md",
  "phases/tasks/TASK_INDEX.md",
  "docs/prd_v1.0.md",
  "docs/architecture/README.md",
  "docs/architecture/layer_overview.md",
  "docs/architecture/data_flow.md",
  "docs/architecture/process_topology.md",
  "docs/architecture/open_spikes.md",
  "docs/architecture/state_machines.md",
  "docs/protocols/context_packet.schema.json",
  "docs/protocols/task.schema.json",
  "docs/protocols/task_event.schema.json",
  "docs/protocols/artifact.schema.json",
  "docs/protocols/kimi_bridge_protocol.md",
  "docs/risks/risk_register_v1.md",
  "docs/phase_1a_demo_script.md",
  "docs/planning/universal_context_agent_detailed_plan.md",
  "docs/planning/requirements_response.md",
  "src/shared/contracts/ai-provider.ts",
  "src/shared/contracts/code-cli.ts",
  "src/shared/contracts/mcp.ts",
  "src/shared/contracts/skill.ts",
  "src/shared/contracts/desktop-shell.ts",
  "src/desktop/shared/manifest.mjs",
  "src/desktop/tray/bootstrap.mjs",
  "src/desktop/overlay/view-model.mjs",
  "src/desktop/console/view-model.mjs",
  "scripts/verify-desktop-shell.mjs",
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
