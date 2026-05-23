export function createEchoRuntimeClient({ httpClient, actor = null } = {}) {
  if (!httpClient || typeof httpClient.fetchJsonResponse !== "function") {
    throw new TypeError("createEchoRuntimeClient requires httpClient.fetchJsonResponse.");
  }

  function actorHeaders(extra = {}) {
    return actor ? { ...extra, "x-uca-actor": actor } : extra;
  }

  function speak(text) {
    return httpClient.fetchJsonResponse("/echo/speak", {
      method: "POST",
      headers: actorHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ text })
    });
  }

  function cancelSpeak() {
    return httpClient.fetchJsonResponse("/echo/speak/cancel", {
      method: "POST",
      headers: actorHeaders()
    });
  }

  function fetchKwsStatus({ signal } = {}) {
    return httpClient.fetchJsonResponse("/echo/kws/status", { signal });
  }

  return { cancelSpeak, fetchKwsStatus, speak };
}
