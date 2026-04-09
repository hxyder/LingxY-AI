export const BUILTIN_MCP_SERVERS = Object.freeze([
  {
    id: "local-fs",
    displayName: "Local Filesystem MCP",
    transport: "stdio",
    async isAvailable() {
      return true;
    },
    async listResources() {
      return [];
    }
  },
  {
    id: "figma",
    displayName: "Figma MCP",
    transport: "http",
    async isAvailable() {
      return true;
    },
    async listResources() {
      return [];
    }
  }
]);
