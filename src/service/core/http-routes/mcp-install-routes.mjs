import { detectMcpInstallCandidate } from "../../ai/mcp/install-detection.mjs";
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

export async function tryHandleMcpInstallRoute({ request, response, method, url }) {
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
