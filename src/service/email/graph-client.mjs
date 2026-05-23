export function createGraphClient({ account }) {
  return {
    async listUnread() {
      throw new Error(`Graph client not configured for ${account.provider ?? "graph"}.`);
    },
    async markSeen() {
      return null;
    }
  };
}
