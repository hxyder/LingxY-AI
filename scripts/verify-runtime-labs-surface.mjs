#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  applyRuntimeLabsPatch,
  buildRuntimeLabsSurface
} from "../src/shared/runtime-labs-surface.mjs";

const surfaceSource = readFileSync("src/shared/runtime-labs-surface.mjs", "utf8");
const configRoutes = readFileSync("src/service/core/http-routes/config-provider-routes.mjs", "utf8");
const manifest = readFileSync("src/desktop/shared/manifest.mjs", "utf8");
const runtimeConfigIpc = readFileSync("src/desktop/main/ipc/register-runtime-config-ipc.mjs", "utf8");
const preload = readFileSync("src/desktop/renderer/preload.cjs", "utf8");
const consoleHtml = readFileSync("src/desktop/renderer/console.html", "utf8");
const consoleJs = readFileSync("src/desktop/renderer/console.js", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const behavior = readFileSync("tests/behavior/runtime-labs-surface.test.mjs", "utf8");

assert.match(surfaceSource, /buildRuntimeLabsSurface/u, "shared surface builder must exist");
assert.match(surfaceSource, /applyRuntimeLabsPatch/u, "shared patch helper must exist");
assert.match(surfaceSource, /network_otel_export/u, "network OTEL must be visible as a blocked capability");
assert.match(surfaceSource, /multi_candidate_voting/u, "multi-candidate voting must be visible as a gated capability");
assert.match(surfaceSource, /automatic_sub_agent_delegation/u, "sub-agent delegation must be visible as a gated capability");
assert.doesNotMatch(surfaceSource, /fetch\(|XMLHttpRequest|EventSource/u, "runtime labs surface must not perform network export");

assert.match(configRoutes, /"\/config\/runtime-labs"/u, "service must expose guarded runtime labs config route");
assert.match(configRoutes, /applyRuntimeLabsPatch/u, "service route must use typed runtime labs patch helper");
assert.match(configRoutes, /buildRuntimeLabsSurface/u, "integrations payload must include runtime labs surface");
assert.match(manifest, /runtimeLabsConfigUpdate/u, "manifest must declare runtime labs IPC channel");
assert.match(runtimeConfigIpc, /IPC_CHANNELS\.runtimeLabsConfigUpdate/u, "main IPC must register runtime labs update handler");
assert.match(runtimeConfigIpc, /\/config\/runtime-labs/u, "runtime labs IPC must route to service-owned config endpoint");
assert.match(preload, /updateRuntimeLabsConfig/u, "preload must expose a safe runtime labs bridge");
assert.match(consoleHtml, /runtimeLabsPanel/u, "Console settings must mount Runtime Labs panel");
assert.match(consoleJs, /renderRuntimeLabsPanel/u, "Console must render Runtime Labs panel");
assert.match(consoleJs, /updateRuntimeLabsConfigViaShell/u, "Console must save Runtime Labs through preload bridge");
assert.doesNotMatch(consoleJs, /price:/u, "Console Runtime Labs and model role UI must not display price labels");
assert.match(roadmap, /Runtime Labs/u, "roadmap must track Runtime Labs as the user-facing entry");
assert.match(behavior, /blocked capabilities/u, "behavior tests must cover blocked capabilities");

const surface = buildRuntimeLabsSurface({ config: { ai: { modelRoles: { enabled: true } } } });
assert.equal(surface.capabilities.some((entry) => entry.id === "model_role_routing" && entry.enabled), true);
assert.equal(surface.capabilities.some((entry) => entry.id === "network_otel_export" && entry.userToggle === false), true);

const patch = applyRuntimeLabsPatch({}, {
  modelRoleRouting: { enabled: true },
  finalAnswerReviewer: { enabled: true }
});
assert.equal(patch.ok, true);
assert.equal(patch.patch.ai.modelRoles.enabled, true);
assert.equal(patch.patch.ai.reviewerLoop.enabled, true);

const blocked = applyRuntimeLabsPatch({}, { multi_candidate_voting: { enabled: true } });
assert.equal(blocked.ok, false);

const command = "node scripts/verify-runtime-labs-surface.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include runtime labs verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include runtime labs verifier");

console.log("[verify-runtime-labs-surface] Runtime Labs surface contract OK");
