export function createConsoleConnectorsClient({ httpClient } = {}) {
  if (!httpClient || typeof httpClient.fetchJsonResponse !== "function") {
    throw new TypeError("createConsoleConnectorsClient requires httpClient.fetchJsonResponse.");
  }

  const getJson = (pathname, options) => httpClient.fetchJsonResponse(pathname, options);

  async function loadConnectorsTabData() {
    const [
      accountsResp,
      mcpResp,
      mcpDraftsResp,
      settingsResp,
      accountConnectorsResp,
      connectedResp
    ] = await Promise.all([
      getJson("/config/email/accounts"),
      getJson("/ai/mcp"),
      getJson("/config/mcp/drafts"),
      getJson("/config/email/settings"),
      getJson("/connectors/accounts"),
      getJson("/connectors/connected-accounts")
    ]);
    return { accountsResp, mcpResp, mcpDraftsResp, settingsResp, accountConnectorsResp, connectedResp };
  }

  async function fetchAccountConnectorConfig(type) {
    return getJson(`/connectors/accounts/${type}/config`);
  }

  async function startConnectedAccountReauth(accountId) {
    return getJson(`/connectors/connected-accounts/${encodeURIComponent(accountId)}/reauth/start`, {
      method: "POST"
    });
  }

  async function startAccountAuth(type) {
    return getJson(`/connectors/accounts/${type}/auth/start`, { method: "POST" });
  }

  async function listAccountConnectors() {
    return getJson("/connectors/accounts");
  }

  async function searchMcpRegistry(query = "", limit = 24) {
    const params = new URLSearchParams();
    const q = `${query ?? ""}`.trim();
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    return getJson(`/config/mcp/registry/search?${params.toString()}`);
  }

  async function loadInboxAccounts() {
    const accounts = [];
    const [oauthResult, imapResult] = await Promise.allSettled([
      getJson("/connectors/connected-accounts"),
      getJson("/config/email/accounts")
    ]);

    if (oauthResult.status === "fulfilled" && oauthResult.value.ok) {
      for (const account of oauthResult.value.payload.accounts ?? []) {
        accounts.push({ ...account, _kind: "oauth" });
      }
    }
    if (imapResult.status === "fulfilled" && imapResult.value.ok) {
      for (const account of imapResult.value.payload.accounts ?? []) {
        accounts.push({
          id: `email:${account.id}`,
          provider: account.provider ?? "imap",
          email: account.email,
          displayName: account.displayName ?? account.email ?? account.id,
          tokenStatus: "active",
          imapHost: account.imapHost,
          _kind: "imap",
          _rawId: account.id
        });
      }
    }
    return accounts;
  }

  async function fetchOAuthMessageBody(provider, messageId) {
    return getJson(`/connectors/accounts/${provider}/messages/${encodeURIComponent(messageId)}`);
  }

  function inboxResourcePath({ account, activeTab, refresh = false }) {
    if (account?._kind === "imap") {
      const refreshQuery = refresh ? "&refresh=1" : "";
      return `/config/email/accounts/${encodeURIComponent(account._rawId)}/messages?limit=30${refreshQuery}`;
    }
    const provider = account?.provider;
    if (activeTab === "files") return `/connectors/accounts/${provider}/files?limit=30`;
    if (activeTab === "emails") return `/connectors/accounts/${provider}/emails?limit=30`;
    return `/connectors/accounts/${provider}/calendar?limit=30`;
  }

  function describeInboxResource({ account, activeTab, refresh = false } = {}) {
    const pathname = inboxResourcePath({ account, activeTab, refresh });
    return { pathname, cacheKey: `${account.id}:${activeTab}:${pathname}` };
  }

  async function fetchInboxResource(resource) {
    const descriptor = resource?.pathname ? resource : describeInboxResource(resource);
    const pathname = descriptor.pathname;
    const response = await getJson(pathname);
    return { ...response, cacheKey: descriptor.cacheKey };
  }

  return {
    fetchAccountConnectorConfig,
    describeInboxResource,
    fetchInboxResource,
    fetchOAuthMessageBody,
    listAccountConnectors,
    loadConnectorsTabData,
    loadInboxAccounts,
    searchMcpRegistry,
    startAccountAuth,
    startConnectedAccountReauth
  };
}
