import { getValidAccessToken } from "../core/token-manager.mjs";

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

