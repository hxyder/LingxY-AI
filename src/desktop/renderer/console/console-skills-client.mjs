export function createConsoleSkillsClient({ httpClient } = {}) {
  if (!httpClient || typeof httpClient.fetchJsonResponse !== "function") {
    throw new TypeError("createConsoleSkillsClient requires httpClient.fetchJsonResponse.");
  }

  function installFromGitHub(url) {
    return httpClient.fetchJsonResponse("/skills/install/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url })
    });
  }

  return { installFromGitHub };
}
