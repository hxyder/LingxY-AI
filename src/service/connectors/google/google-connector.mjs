import { getValidAccessToken } from "../core/token-manager.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function headers(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function listGoogleEmails(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const limit = Math.min(100, Number(input.limit ?? 10));
  const query = input.query ? `&q=${encodeURIComponent(input.query)}` : "";
  const unread = input.unreadOnly ? "&labelIds=UNREAD" : "";
  const response = await fetchImpl(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=INBOX${unread}${query}`,
    { headers: headers(accessToken) }
  );
  if (!response.ok) return { status: "error", errorCode: `gmail_list_error:${response.status}` };
  const payload = await response.json();
  const ids = (payload.messages ?? []).slice(0, limit).map((message) => message.id);
  const emails = [];
  for (const id of ids) {
    const detail = await fetchImpl(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: headers(accessToken) }
    );
    if (!detail.ok) continue;
    const message = await detail.json();
    const msgHeaders = Object.fromEntries((message.payload?.headers ?? []).map((item) => [item.name, item.value]));
    emails.push({
      id,
      subject: msgHeaders.Subject ?? "",
      from: msgHeaders.From ?? "",
      received: msgHeaders.Date ?? "",
      isRead: !(message.labelIds ?? []).includes("UNREAD")
    });
  }
  return { status: "success", provider: "google", accountId: account.id, data: { emails } };
}

export async function listGoogleFiles(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const params = new URLSearchParams({
    pageSize: String(Math.min(100, Number(input.limit ?? 20))),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,webViewLink,modifiedTime,size,mimeType)"
  });
  if (input.query) params.set("q", `fullText contains '${String(input.query).replace(/'/g, "\\'")}'`);
  const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: headers(accessToken)
  });
  if (!response.ok) return { status: "error", errorCode: `gdrive_files_error:${response.status}` };
  const payload = await response.json();
  return {
    status: "success",
    provider: "google",
    accountId: account.id,
    data: {
      files: (payload.files ?? []).map((file) => ({
        id: file.id,
        name: file.name,
        url: file.webViewLink,
        modified: file.modifiedTime,
        size: file.size,
        isFolder: file.mimeType === "application/vnd.google-apps.folder"
      }))
    }
  };
}

export async function listGoogleEvents(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const params = new URLSearchParams({
    maxResults: String(Math.min(100, Number(input.limit ?? 10))),
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: input.startTime ?? new Date().toISOString(),
    fields: "items(id,summary,start,end,organizer,location)"
  });
  if (input.endTime) params.set("timeMax", input.endTime);
  if (input.query) params.set("q", input.query);
  const response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: headers(accessToken)
  });
  if (!response.ok) return { status: "error", errorCode: `gcal_error:${response.status}` };
  const payload = await response.json();
  return {
    status: "success",
    provider: "google",
    accountId: account.id,
    data: {
      events: (payload.items ?? []).map((event) => ({
        id: event.id,
        title: event.summary,
        start: event.start?.dateTime ?? event.start?.date,
        end: event.end?.dateTime ?? event.end?.date,
        organizer: event.organizer?.displayName ?? event.organizer?.email,
        location: event.location
      }))
    }
  };
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildRfc822Email(input = {}) {
  const lines = [
    `To: ${(input.to ?? []).join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.join(", ")}` : null,
    input.bcc?.length ? `Bcc: ${input.bcc.join(", ")}` : null,
    `Subject: ${input.subject ?? ""}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body ?? ""
  ].filter((line) => line !== null);
  return lines.join("\r\n");
}

export async function sendGoogleEmail(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const response = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      ...headers(accessToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: base64Url(buildRfc822Email(input)) })
  });
  if (!response.ok) return { status: "error", errorCode: `gmail_send_error:${response.status}` };
  const payload = await response.json();
  return { status: "success", provider: "google", accountId: account.id, data: { messageId: payload.id ?? null } };
}

export async function uploadGoogleFile(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const filePath = input.localPath;
  if (!filePath) return { status: "error", errorCode: "LOCAL_PATH_REQUIRED", message: "localPath is required" };
  const content = await readFile(filePath);
  const metadata = {
    name: input.newFileName ?? path.basename(filePath),
    ...(input.folderId ? { parents: [input.folderId] } : {})
  };
  const boundary = `uca_${Date.now()}`;
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8"),
    content,
    Buffer.from(`\r\n--${boundary}--`, "utf8")
  ]);
  const response = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      ...headers(accessToken),
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body: multipart
  });
  if (!response.ok) return { status: "error", errorCode: `gdrive_upload_error:${response.status}` };
  const payload = await response.json();
  return { status: "success", provider: "google", accountId: account.id, data: { file: { id: payload.id, name: payload.name, url: payload.webViewLink } } };
}

export async function createGoogleEvent(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const body = {
    summary: input.title,
    description: input.description ?? "",
    location: input.location ?? "",
    start: { dateTime: input.startTime },
    end: { dateTime: input.endTime },
    attendees: (input.attendees ?? []).map((email) => ({ email }))
  };
  const response = await fetchImpl("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      ...headers(accessToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) return { status: "error", errorCode: `gcal_create_error:${response.status}` };
  const payload = await response.json();
  return { status: "success", provider: "google", accountId: account.id, data: { event: { id: payload.id, title: payload.summary, url: payload.htmlLink } } };
}
