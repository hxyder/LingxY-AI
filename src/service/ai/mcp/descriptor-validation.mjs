const TRANSPORTS = new Set(["stdio", "http", "ws"]);

function validationError(field, message) {
  return { field, message };
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
    errors.push(validationError("id", "Server id is required, for example \"my-mcp\"."));
  }

  const rawTransport = typeof input.transport === "string" && input.transport.trim()
    ? input.transport.trim()
    : "stdio";
  const transport = TRANSPORTS.has(rawTransport) ? rawTransport : "stdio";
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const args = Array.isArray(input.args) ? input.args : [];

  if (!TRANSPORTS.has(rawTransport)) {
    errors.push(validationError("transport", "Transport must be \"stdio\", \"http\", or \"ws\"."));
  }
  if (transport === "stdio" && !command) {
    errors.push(validationError("command", "Stdio transport requires a command, for example npx, node, or an absolute executable path."));
  }
  if (transport !== "stdio" && !url) {
    errors.push(validationError("url", "HTTP or WebSocket transport requires a URL, for example https://mcp.example.com/sse."));
  }
  if (input.env && (typeof input.env !== "object" || Array.isArray(input.env))) {
    errors.push(validationError("env", "env must be an object mapping environment variable names to values."));
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
