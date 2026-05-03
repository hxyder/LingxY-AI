import { detectMcpInstallCandidate } from "../../ai/mcp/install-detection.mjs";
import { createMcpInstallSandboxPlan } from "../../ai/mcp/install-sandbox.mjs";
import { validateMcpServerDescriptor } from "../../ai/mcp/descriptor-validation.mjs";
import { readJsonBody, sendJson } from "../http-helpers.mjs";

function buildPreviewPayload(result) {
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors ?? [],
      source: result.source ?? null
    };
  }

  const validation = validateMcpServerDescriptor(result.detected);
  if (!validation.ok) {
    return {
      ok: false,
      error: "mcp_install_candidate_invalid",
      errors: validation.errors,
      source: result.source,
      detected: result.detected
    };
  }

  return {
    ok: true,
    source: result.source,
    server: validation.server,
    detection: {
      manifestSource: result.detected.manifestSource ?? null,
      sourceOfArgs: result.detected.sourceOfArgs ?? null
    }
  };
}

export async function tryHandleMcpInstallRoute({ request, response, method, url, runtime }) {
  if (method === "POST" && url.pathname === "/config/mcp/install/plan") {
    const body = await readJsonBody(request);
    const result = createMcpInstallSandboxPlan({
      source: body.source,
      id: body.id,
      allowScripts: body.allowScripts === true,
      paths: {
        mcpInstallDir: runtime?.paths?.mcpInstallDir ?? runtime?.platform?.integrationPaths?.mcpInstallDir ?? null
      }
    });
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/config/mcp/install/preview") {
    const body = await readJsonBody(request);
    const result = await detectMcpInstallCandidate({
      packageDir: body.packageDir,
      packageName: body.packageName,
      id: body.id
    });
    sendJson(response, 200, buildPreviewPayload(result));
    return true;
  }

  return false;
}
