const TRANSPORTS = new Set(["stdio", "http", "ws"]);

function normalizeTransport(transport) {
  return TRANSPORTS.has(transport) ? transport : "stdio";
}

function normalizeEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return null;
  }
  return env;
}

export function validateMcpServerDescriptor(input = {}, { requireId = true } = {}) {
  const errors = [];
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (requireId && !id) {
    errors.push("id required");
  }

  const transport = normalizeTransport(input.transport);
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const args = Array.isArray(input.args) ? input.args : [];

  if (transport === "stdio" && !command) {
    errors.push("command required for stdio transport");
  }
  if (transport !== "stdio" && !url) {
    errors.push("url required for http/ws transport");
  }

  const server = {
    id,
    displayName: input.displayName ?? input.name ?? id,
    transport,
    command: transport === "stdio" ? command : null,
    args: transport === "stdio" ? args : [],
    url: transport !== "stdio" ? url : null,
    env: normalizeEnv(input.env),
    enabled: input.enabled !== false
  };

  return {
    ok: errors.length === 0,
    errors,
    server
  };
}
