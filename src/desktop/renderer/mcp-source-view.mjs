const USER_WRITABLE_MCP_SOURCES = new Set([
  "runtime_config",
  "builtin",
  "builtin_mit",
  "lingxy_internal"
]);

export function isReadOnlyMcpServer(server = {}) {
  const source = server?.source;
  return Boolean(source && !USER_WRITABLE_MCP_SOURCES.has(source));
}

export function getMcpSourceView(server = {}) {
  if (isReadOnlyMcpServer(server)) {
    return {
      readOnly: true,
      canToggle: false,
      label: "Read-only",
      tooltip: server.sourcePath
        ? `Declared in ${server.sourcePath}`
        : "Declared in a JSON manifest, not user config",
      className: "muted"
    };
  }

  return {
    readOnly: false,
    canToggle: true,
    label: "",
    tooltip: "",
    className: ""
  };
}
