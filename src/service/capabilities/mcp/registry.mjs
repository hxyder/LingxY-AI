import { buildMarketplaceTrustPreview } from "../marketplace/trust-model.mjs";
import { applyExternalMcpGovernanceToStatus } from "./governance.mjs";

export function createMCPRegistry(servers = []) {
  const registered = new Map(servers.map((server) => [server.id, server]));

  return {
    register(server) {
      registered.set(server.id, server);
      return server;
    },
    list() {
      return [...registered.values()];
    },
    get(serverId) {
      return registered.get(serverId) ?? null;
    },
    async listStatus(context = {}) {
      return Promise.all(
        [...registered.values()].map(async (server) => {
          if (typeof server.getStatus === "function") {
            const status = await server.getStatus(context);
            const governed = applyExternalMcpGovernanceToStatus(status, server);
            return {
              ...governed,
              trustPreview: governed?.trustPreview
                ?? buildMarketplaceTrustPreview({
                  ...governed,
                  source: governed?.source ?? server.source
                }, { kind: "mcp_server" })
            };
          }
          const status = {
            id: server.id,
            displayName: server.displayName,
            transport: server.transport,
            available: typeof server.isAvailable === "function"
              ? await server.isAvailable(context)
              : true
          };
          const governed = applyExternalMcpGovernanceToStatus(status, server);
          return {
            ...governed,
            trustPreview: buildMarketplaceTrustPreview(governed, { kind: "mcp_server" })
          };
        })
      );
    },
    async listResources(serverId = null, context = {}) {
      const serversToRead = serverId
        ? [registered.get(serverId)].filter(Boolean)
        : [...registered.values()];
      const resources = [];
      for (const server of serversToRead) {
        if (typeof server.listResources !== "function") {
          continue;
        }
        const nextResources = await server.listResources(context);
        for (const resource of nextResources ?? []) {
          resources.push({
            server: resource.server ?? server.id,
            ...resource
          });
        }
      }
      return resources;
    }
  };
}
