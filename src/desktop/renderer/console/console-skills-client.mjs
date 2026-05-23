export function createConsoleSkillsClient({ httpClient } = {}) {
  if (!httpClient || typeof httpClient.fetchJsonResponse !== "function") {
    throw new TypeError("createConsoleSkillsClient requires httpClient.fetchJsonResponse.");
  }

  function previewInstallFromGitHub(url) {
    return httpClient.fetchJsonResponse("/skills/install/github/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url })
    });
  }

  function installFromGitHub(url, options = {}) {
    return httpClient.fetchJsonResponse("/skills/install/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, previewAccepted: options.previewAccepted === true })
    });
  }

  return { installFromGitHub, previewInstallFromGitHub };
}
