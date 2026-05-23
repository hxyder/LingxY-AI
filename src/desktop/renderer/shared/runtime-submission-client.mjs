export function runtimeJsonOptions(method, body = {}, {
  actor = null
} = {}) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (actor) headers["X-Lingxy-Desktop-Actor"] = actor;
  return {
    method,
    headers,
    body: JSON.stringify(body)
  };
}

export function runtimeMutationOptions(method, {
  actor = null
} = {}) {
  const headers = {};
  if (actor) headers["X-Lingxy-Desktop-Actor"] = actor;
  return { method, headers };
}

export function createRuntimeSubmissionClient({
  httpClient,
  actor = null
} = {}) {
  if (!httpClient || typeof httpClient.fetchJson !== "function") {
    throw new TypeError("createRuntimeSubmissionClient requires httpClient.fetchJson.");
  }

  function jsonOptions(method, body = {}) {
    return runtimeJsonOptions(method, body, { actor });
  }

  function mutationOptions(method) {
    return runtimeMutationOptions(method, { actor });
  }

  return {
    submitTask(body = {}) {
      return httpClient.fetchJson("/task", jsonOptions("POST", body));
    },
    clarifyTask(body = {}) {
      return httpClient.fetchJson("/task/clarify", jsonOptions("POST", body));
    },
    createConversation(body = {}) {
      return httpClient.fetchJson("/conversations", jsonOptions("POST", body));
    },
    updateConversationModel(conversationId, body = {}) {
      return httpClient.fetchJson(
        `/conversation/${encodeURIComponent(conversationId)}/model`,
        jsonOptions("PATCH", body)
      );
    },
    clearConversationModel(conversationId) {
      return httpClient.fetchJson(
        `/conversation/${encodeURIComponent(conversationId)}/model`,
        mutationOptions("DELETE")
      );
    }
  };
}
