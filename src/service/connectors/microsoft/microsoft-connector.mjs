import { getValidAccessToken } from "../core/token-manager.mjs";

function headers(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function listMicrosoftEmails(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const limit = Math.min(100, Number(input.limit ?? 10));
  const filter = input.unreadOnly ? "&$filter=isRead eq false" : "";
  const search = input.query ? `&$search="${encodeURIComponent(input.query)}"` : "";
  const response = await fetchImpl(
    `https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead${filter}${search}`,
    { headers: headers(accessToken) }
  );
  if (!response.ok) return { status: "error", errorCode: `graph_mail_error:${response.status}` };
  const payload = await response.json();
  return {
    status: "success",
    provider: "microsoft",
    accountId: account.id,
    data: {
      emails: (payload.value ?? []).map((message) => ({
        id: message.id,
        subject: message.subject,
        from: message.from?.emailAddress?.address,
        fromName: message.from?.emailAddress?.name,
        received: message.receivedDateTime,
        preview: message.bodyPreview,
        isRead: message.isRead
      }))
    }
  };
}

export async function listMicrosoftFiles(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const limit = Math.min(100, Number(input.limit ?? 20));
  const resource = input.query
    ? `search(q='${encodeURIComponent(input.query)}')?$top=${limit}&$select=id,name,webUrl,lastModifiedDateTime,size,file`
    : `root/children?$top=${limit}&$orderby=lastModifiedDateTime desc&$select=id,name,webUrl,lastModifiedDateTime,size,file`;
  const response = await fetchImpl(`https://graph.microsoft.com/v1.0/me/drive/${resource}`, {
    headers: headers(accessToken)
  });
  if (!response.ok) return { status: "error", errorCode: `graph_files_error:${response.status}` };
  const payload = await response.json();
  return {
    status: "success",
    provider: "microsoft",
    accountId: account.id,
    data: {
      files: (payload.value ?? []).map((file) => ({
        id: file.id,
        name: file.name,
        url: file.webUrl,
        modified: file.lastModifiedDateTime,
        size: file.size,
        isFolder: !file.file
      }))
    }
  };
}

export async function listMicrosoftEvents(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const limit = Math.min(100, Number(input.limit ?? 10));
  const start = input.startTime ?? new Date().toISOString();
  const response = await fetchImpl(
    `https://graph.microsoft.com/v1.0/me/events?$top=${limit}&$filter=start/dateTime ge '${start}'&$orderby=start/dateTime&$select=id,subject,start,end,organizer,location`,
    { headers: headers(accessToken) }
  );
  if (!response.ok) return { status: "error", errorCode: `graph_calendar_error:${response.status}` };
  const payload = await response.json();
  return {
    status: "success",
    provider: "microsoft",
    accountId: account.id,
    data: {
      events: (payload.value ?? []).map((event) => ({
        id: event.id,
        title: event.subject,
        start: event.start?.dateTime,
        end: event.end?.dateTime,
        organizer: event.organizer?.emailAddress?.name,
        location: event.location?.displayName
      }))
    }
  };
}

