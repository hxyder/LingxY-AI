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
  "docs/runtime/README.md",
  "docs/phase_1a_demo_script.md",
  "docs/planning/universal_context_agent_detailed_plan.md",
  "docs/planning/requirements_response.md",
  "src/shared/contracts/ai-provider.ts",
  "src/shared/contracts/code-cli.ts",
  "src/shared/contracts/mcp.ts",
  "src/shared/contracts/skill.ts",
  "src/shared/contracts/desktop-shell.ts",
  "src/shared/contracts/browser-context.ts",
  "src/shared/contracts/uca-models.ts",
  "src/desktop/shared/manifest.mjs",
  "src/desktop/tray/bootstrap.mjs",
  "src/desktop/overlay/view-model.mjs",
  "src/desktop/console/view-model.mjs",
  "src/service/core/service-bootstrap.mjs",
  "src/service/core/browser-submission.mjs",
  "src/service/core/store/sqlite-schema.mjs",
  "src/service/core/store/memory-store.mjs",
  "src/service/core/events/event-bus.mjs",
  "src/service/core/queue/task-queue.mjs",
  "src/service/core/router/intent-router.mjs",
  "src/service/core/file-submission.mjs",
  "src/service/store/artifact-store.mjs",
  "src/service/extractors/file-ingest.mjs",
  "src/service/executors/fast/fast-executor.mjs",
  "src/service/executors/kimi/kimi-cli-executor.mjs",
  "src/service/executors/kimi/task-package-builder.mjs",
  "uca-cli/src/submit.mjs",
  "src/helper/explorer_selection/selection-contract.mjs",
  "scripts/verify-desktop-shell.mjs",
  "scripts/verify-service-core.mjs",
  "scripts/verify-file-kimi.mjs",
  "scripts/verify-browser-extension.mjs",
  "src/service/ai/providers/README.md",
  "src/service/ai/code_cli/README.md",
  "src/service/ai/code_cli/kimi/README.md",
  "src/service/ai/mcp/README.md",
  "src/service/ai/skills/README.md",
  "docs/runtime/kimi_cli_setup.md",
  "docs/runtime/file_entry_setup.md",
  "docs/runtime/install_extension.md",
  "docs/runtime/native_messaging_protocol.md",
  "uca-native-host/README.md",
  "uca-native-host/index.mjs",
  "uca-native-host/protocol.mjs",
  "uca-native-host/registry-manifest.mjs",
  "browser_ext/manifest.json",
  "browser_ext/background/service-worker.js",
  "browser_ext/content_script/selection-cache.js",
  "browser_ext/popup/index.html",
  "browser_ext/popup/index.js",
  "browser_ext/popup/styles.css",
  "browser_ext/shadow_ui/floating-chip.js",
  "tests/fixtures/mock-kimi-cli.mjs"
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
