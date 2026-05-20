import { getValidAccessToken } from "../core/token-manager.mjs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

function headers(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

function asList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  return [String(value)];
}

const EMAIL_LIKE_REGEX_MS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function asEmailList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const trimmed = String(item ?? "").trim();
      if (!trimmed) continue;
      const matches = trimmed.match(EMAIL_LIKE_REGEX_MS);
      if (matches?.length) out.push(...matches);
      else out.push(trimmed);
    }
    return [...new Set(out.map((v) => v.trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    const matches = value.match(EMAIL_LIKE_REGEX_MS);
    if (matches?.length) return [...new Set(matches.map((v) => v.trim()).filter(Boolean))];
    return value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [String(value)];
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
        // Graph's bodyPreview maxes out around 255 chars — good enough
        // for the Inbox inline-expand preview; full-body fetch would
        // need a per-message $select=body.content call.
        bodyText: message.bodyPreview,
        isRead: message.isRead
      }))
    }
  };
}

// Full-body fetch for a single Outlook message — symmetric to Gmail's
// getGoogleMessage. The list call uses $select=bodyPreview for speed
// (capped at ~255 chars); this pulls body.content (HTML or text) so
// the Inbox expand can show the real body.
export async function getMicrosoftMessage(runtime, account, messageId, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id };
  const response = await fetchImpl(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,receivedDateTime,body,isRead`,
    { headers: headers(accessToken) }
  );
  if (!response.ok) return { status: "error", errorCode: `graph_mail_get_error:${response.status}` };
  const message = await response.json();
  const body = message.body ?? {};
  const raw = body.content ?? "";
  const isHtml = (body.contentType ?? "").toLowerCase() === "html";
  // bodyText — readable plain text (stripped if HTML).
  // bodyHtml — raw HTML when available, else empty (frontend offers
  // rich rendering when this is non-empty).
  const bodyText = isHtml
    ? raw
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : raw;
  const bodyHtml = isHtml ? raw : "";
  return {
    status: "success",
    provider: "microsoft",
    accountId: account.id,
    data: {
      id: message.id,
      subject: message.subject ?? "",
      from: message.from?.emailAddress?.address ?? "",
      fromName: message.from?.emailAddress?.name ?? "",
      received: message.receivedDateTime ?? "",
      isRead: message.isRead,
      bodyText,
      bodyHtml
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

export async function sendMicrosoftEmail(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };

  const attachmentPaths = asList(input.attachmentPaths);
  const attachments = [];
  for (const filePath of attachmentPaths) {
    const content = await readFile(filePath);
    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: path.basename(filePath),
      contentBytes: content.toString("base64")
    });
  }

  const response = await fetchImpl("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      ...headers(accessToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject: input.subject ?? "",
        body: { contentType: "Text", content: input.body ?? "" },
        toRecipients: asEmailList(input.to).map((address) => ({ emailAddress: { address } })),
        ccRecipients: asEmailList(input.cc).map((address) => ({ emailAddress: { address } })),
        bccRecipients: asEmailList(input.bcc).map((address) => ({ emailAddress: { address } })),
        ...(attachments.length ? { attachments } : {})
      },
      saveToSentItems: true
    })
  });
  if (!response.ok) return { status: "error", errorCode: `graph_send_error:${response.status}` };
  return { status: "success", provider: "microsoft", accountId: account.id, data: { sent: true } };
}

function sanitiseFilename(name) {
  return String(name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function ensureWritableTarget(destPath, filename, overwrite) {
  if (!destPath) throw new Error("destPath is required");
  const resolved = path.resolve(destPath);
  let target = resolved;
  try {
    const st = await stat(resolved);
    if (st.isDirectory()) target = path.join(resolved, filename);
  } catch {
    const looksLikeDir = /[\\/]$/.test(destPath) || !path.extname(destPath);
    if (looksLikeDir) {
      await mkdir(resolved, { recursive: true });
      target = path.join(resolved, filename);
    } else {
      await mkdir(path.dirname(resolved), { recursive: true });
    }
  }
  if (!overwrite) {
    try { await stat(target); throw new Error(`target_exists: ${target}`); }
    catch (e) { if (e.code !== "ENOENT" && e.message?.startsWith("target_exists")) throw e; }
  }
  return target;
}

export async function downloadMicrosoftFile(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const fileId = input.fileId ?? input.id;
  if (!fileId) return { status: "error", errorCode: "FILE_ID_REQUIRED", message: "fileId is required" };
  const metaResponse = await fetchImpl(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,size,file`,
    { headers: headers(accessToken) }
  );
  if (!metaResponse.ok) return { status: "error", errorCode: `graph_meta_error:${metaResponse.status}` };
  const meta = await metaResponse.json();
  const target = await ensureWritableTarget(
    input.destPath ?? input.localPath ?? process.cwd(),
    sanitiseFilename(input.newFileName ?? meta.name ?? `file-${fileId}`),
    input.overwrite !== false
  );
  const response = await fetchImpl(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/content`,
    { headers: headers(accessToken), redirect: "follow" }
  );
  if (!response.ok) return { status: "error", errorCode: `graph_download_error:${response.status}` };
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(target, buffer);
  return {
    status: "success",
    provider: "microsoft",
    accountId: account.id,
    data: { file: { id: meta.id, name: meta.name, size: buffer.length, localPath: target } }
  };
}

export async function uploadMicrosoftFile(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const filePath = input.localPath;
  if (!filePath) return { status: "error", errorCode: "LOCAL_PATH_REQUIRED", message: "localPath is required" };
  const content = await readFile(filePath);
  const name = encodeURIComponent(input.newFileName ?? path.basename(filePath));
  const base = input.folderId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(input.folderId)}:/${name}:/content`
    : `https://graph.microsoft.com/v1.0/me/drive/root:/${name}:/content`;
  const response = await fetchImpl(base, {
    method: "PUT",
    headers: headers(accessToken),
    body: content
  });
  if (!response.ok) return { status: "error", errorCode: `graph_upload_error:${response.status}` };
  const payload = await response.json();
  return { status: "success", provider: "microsoft", accountId: account.id, data: { file: { id: payload.id, name: payload.name, url: payload.webUrl } } };
}

const MICROSOFT_WEEKDAYS = Object.freeze({
  SU: "sunday",
  MO: "monday",
  TU: "tuesday",
  WE: "wednesday",
  TH: "thursday",
  FR: "friday",
  SA: "saturday"
});

function dateOnly(value) {
  if (!value) return null;
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(?:T.*)?$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function weekdayFromDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][parsed.getUTCDay()];
}

function parseRRuleParts(value) {
  const ruleText = String(value ?? "").trim().replace(/^RRULE:/i, "");
  if (!ruleText) return null;
  const parts = {};
  for (const chunk of ruleText.split(";")) {
    const [rawKey, ...rest] = chunk.split("=");
    const key = rawKey?.trim().toUpperCase();
    const rawValue = rest.join("=").trim();
    if (key && rawValue) parts[key] = rawValue;
  }
  return Object.keys(parts).length > 0 ? parts : null;
}

function rruleToMicrosoftRecurrence(rrule, { startTime, timeZone } = {}) {
  const parts = parseRRuleParts(rrule);
  if (!parts?.FREQ) {
    return { error: "Microsoft Calendar recurrence requires an RRULE with FREQ." };
  }
  const interval = Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1);
  const byDay = String(parts.BYDAY ?? "")
    .split(",")
    .map((day) => MICROSOFT_WEEKDAYS[day.trim().slice(-2).toUpperCase()])
    .filter(Boolean);
  const startDate = dateOnly(startTime) ?? dateOnly(new Date().toISOString());
  const endDate = dateOnly(parts.UNTIL);
  let pattern;

  if (parts.FREQ === "WEEKLY" || (parts.FREQ === "DAILY" && byDay.length > 0)) {
    const daysOfWeek = byDay.length > 0
      ? byDay
      : [weekdayFromDate(startTime)].filter(Boolean);
    if (daysOfWeek.length === 0) {
      return { error: "Microsoft Calendar weekly recurrence requires daysOfWeek or a parseable startTime." };
    }
    pattern = { type: "weekly", interval, daysOfWeek };
  } else if (parts.FREQ === "DAILY") {
    pattern = { type: "daily", interval };
  } else if (parts.FREQ === "MONTHLY" && parts.BYMONTHDAY) {
    pattern = {
      type: "absoluteMonthly",
      interval,
      dayOfMonth: Number.parseInt(parts.BYMONTHDAY, 10)
    };
  } else {
    return {
      error: `Microsoft Calendar recurrence does not support RRULE FREQ=${parts.FREQ} yet.`
    };
  }

  return {
    recurrence: {
      pattern,
      range: {
        type: endDate ? "endDate" : "noEnd",
        startDate,
        ...(endDate ? { endDate } : {}),
        ...(timeZone ? { recurrenceTimeZone: timeZone } : {})
      }
    }
  };
}

function normalizeMicrosoftRecurrence(value, { startTime, timeZone } = {}) {
  if (value === undefined || value === null || value === "") {
    return { recurrence: null };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { recurrence: value };
  }
  const rules = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [String(value ?? "").trim()].filter(Boolean);
  const rrules = rules.filter((item) => /^RRULE:/i.test(item) || /(^|;)FREQ=/i.test(item));
  if (rrules.length !== 1 || rrules.length !== rules.length) {
    return {
      error: "Microsoft Calendar recurrence supports one RRULE or a Microsoft Graph recurrence object."
    };
  }
  return rruleToMicrosoftRecurrence(rrules[0], { startTime, timeZone });
}

export async function createMicrosoftEvent(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };
  const timeZone = input.timeZone ?? "UTC";
  const recurrence = normalizeMicrosoftRecurrence(input.recurrence, {
    startTime: input.startTime,
    timeZone
  });
  if (recurrence.error) {
    return {
      status: "error",
      errorCode: "UNSUPPORTED_RECURRENCE",
      message: recurrence.error,
      accountId: account.id,
      provider: account.provider
    };
  }
  const body = {
    subject: input.title,
    body: { contentType: "Text", content: input.description ?? "" },
    start: { dateTime: input.startTime, timeZone },
    end: { dateTime: input.endTime, timeZone },
    location: { displayName: input.location ?? "" },
    attendees: asEmailList(input.attendees).map((address) => ({
      emailAddress: { address },
      type: "required"
    })),
    ...(recurrence.recurrence ? { recurrence: recurrence.recurrence } : {})
  };
  const response = await fetchImpl("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      ...headers(accessToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) return { status: "error", errorCode: `graph_create_event_error:${response.status}` };
  const payload = await response.json();
  const returnedRecurrence = payload.recurrence ?? body.recurrence;
  return {
    status: "success",
    provider: "microsoft",
    accountId: account.id,
    data: {
      event: {
        id: payload.id,
        title: payload.subject,
        url: payload.webLink,
        ...(returnedRecurrence ? { recurrence: returnedRecurrence } : {})
      }
    }
  };
}
