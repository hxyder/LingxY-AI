export function createConsoleNotesRuntimeClient({ notesHttpClient, chatHttpClient = notesHttpClient } = {}) {
  if (!notesHttpClient || typeof notesHttpClient.fetchJsonResponse !== "function") {
    throw new TypeError("createConsoleNotesRuntimeClient requires notesHttpClient.fetchJsonResponse.");
  }
  if (!chatHttpClient || typeof chatHttpClient.fetchJsonResponse !== "function") {
    throw new TypeError("createConsoleNotesRuntimeClient requires chatHttpClient.fetchJsonResponse.");
  }

  async function fetchNotes() {
    const response = await notesHttpClient.fetchJsonResponse("/notes");
    if (!response.ok) return null;
    return Array.isArray(response.payload?.notes) ? response.payload.notes : null;
  }

  async function completeChat(prompt) {
    const response = await chatHttpClient.fetchJsonResponse("/chat/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = response.payload;
    return data.text ?? data.message ?? data.content ?? JSON.stringify(data).slice(0, 400);
  }

  return { completeChat, fetchNotes };
}
