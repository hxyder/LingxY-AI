export function createMCPRegistry(servers = []) {
  const registered = new Map(servers.map((server) => [server.id, server]));

  return {
    register(server) {
      registered.set(server.id, server);
      return server;
    },
    list() {
      return [...registered.values()];
    }
  };
}
