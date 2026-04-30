import { getValidAccessToken } from "../core/token-manager.mjs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

function headers(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readGoogleApiError(response) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload?.error?.message ?? payload?.error_description ?? "";
  } catch {
    try { detail = await response.text(); } catch { /* ignore */ }
  }
  return detail;
}

// Gmail's message payload is a tree of MIME parts. We walk the tree
// looking for the best text body: prefer text/plain, fall back to
// text/html (stripped), bail with an empty string if neither is
// present (attachment-only mail).
function decodeGmailBase64(urlSafe = "") {
  // Gmail returns RFC 4648 §5 base64url without padding. Pad + swap
  // to regular base64 so the built-in Buffer decoder handles it.
  const padded = urlSafe.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(urlSafe.length / 4) * 4, "=");
  try { return Buffer.from(padded, "base64").toString("utf8"); } catch { return ""; }
}

function stripHtmlToText(html = "") {
  return String(html)
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
    .trim();
}

function extractGmailBody(payload) {
  if (!payload) return { bodyText: "", bodyHtml: "" };
  const pick = (part, mime) => {
    if (part.mimeType === mime && part.body?.data) return decodeGmailBase64(part.body.data);
    for (const child of part.parts ?? []) {
      const found = pick(child, mime);
      if (found) return found;
    }
    return "";
  };
  const plain = pick(payload, "text/plain");
  const html = pick(payload, "text/html");
  // Prefer plain text for bodyText (native paragraph breaks). Fall
  // back to stripped HTML. Always return the raw HTML separately so
  // the frontend can offer a rich-rendering toggle.
  const bodyText = plain || (html ? stripHtmlToText(html) : "");
  return { bodyText, bodyHtml: html };
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
    // Split "Name <email@example.com>" into name + address so the UI can
    // render a clean "Name — subject" line instead of the raw header.
    const fromRaw = msgHeaders.From ?? "";
    const nameMatch = fromRaw.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
    emails.push({
      id,
      subject: msgHeaders.Subject ?? "",
      from: nameMatch ? nameMatch[2] : fromRaw,
      fromName: nameMatch ? nameMatch[1].trim() : "",
      received: msgHeaders.Date ?? "",
      isRead: !(message.labelIds ?? []).includes("UNREAD"),
      preview: message.snippet ?? "",
      bodyText: message.snippet ?? ""
    });
  }
  return { status: "success", provider: "google", accountId: account.id, data: { emails } };
}

// Full-body fetch for a single Gmail message — used by the Inbox tab
// when the user expands a message. Separate from listGoogleEmails
// because the list call uses format=metadata for speed; a real body
// needs format=full and a MIME walk.
export async function getGoogleMessage(runtime, account, messageId, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id };
  const response = await fetchImpl(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    { headers: headers(accessToken) }
  );
  if (!response.ok) return { status: "error", errorCode: `gmail_get_error:${response.status}` };
  const message = await response.json();
  const msgHeaders = Object.fromEntries((message.payload?.headers ?? []).map((item) => [item.name, item.value]));
  const fromRaw = msgHeaders.From ?? "";
  const nameMatch = fromRaw.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  const { bodyText, bodyHtml } = extractGmailBody(message.payload);
  return {
    status: "success",
    provider: "google",
    accountId: account.id,
    data: {
      id: message.id,
      subject: msgHeaders.Subject ?? "",
      from: nameMatch ? nameMatch[2] : fromRaw,
      fromName: nameMatch ? nameMatch[1].trim() : "",
      received: msgHeaders.Date ?? "",
      isRead: !(message.labelIds ?? []).includes("UNREAD"),
      bodyText,
      bodyHtml
    }
  };
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
  if (!response.ok) {
    const detail = await readGoogleApiError(response);
    return {
      status: response.status === 401 ? "reauth_required" : "error",
      errorCode: `gcal_error:${response.status}`,
      message: detail ? `Google Calendar API 返回 ${response.status}：${detail}` : undefined,
      accountId: account.id,
      provider: account.provider
    };
  }
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

// Defense-in-depth — write-tools.mjs::asEmailArray normalises args at
// the action-tool boundary, but a direct sendGoogleEmail call (e.g.
// from a connector workflow that bypasses the action-tool layer)
// would otherwise re-introduce the "和-not-split" bug. Same email-
// extraction strategy as write-tools so a recipient list joined by
// Chinese conjunctions still becomes two addresses.
// Conservative local-part charset — same reasoning as
// write-tools.mjs::EMAIL_LIKE_REGEX. Permissive RFC-5322 form would
// merge "a@x.com/b@y.com" into one token.
const EMAIL_LIKE_REGEX_GC = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function asGenericList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  return [String(value)];
}

function asEmailList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const trimmed = String(item ?? "").trim();
      if (!trimmed) continue;
      const matches = trimmed.match(EMAIL_LIKE_REGEX_GC);
      if (matches?.length) out.push(...matches);
      else out.push(trimmed);
    }
    return [...new Set(out.map((v) => v.trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    const matches = value.match(EMAIL_LIKE_REGEX_GC);
    if (matches?.length) return [...new Set(matches.map((v) => v.trim()).filter(Boolean))];
    return value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [String(value)];
}

function encodeHeaderRfc2047(value) {
  const text = String(value ?? "");
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) {
    return text;
  }
  // Base64-encode each ≤45-byte UTF-8 chunk as RFC 2047 encoded-word. Chunks
  // must split on character boundaries, not byte boundaries, to avoid
  // corrupting multi-byte sequences.
  const chunks = [];
  let currentBytes = 0;
  let currentChars = "";
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (currentBytes + charBytes > 45 && currentChars.length > 0) {
      chunks.push(currentChars);
      currentChars = char;
      currentBytes = charBytes;
    } else {
      currentChars += char;
      currentBytes += charBytes;
    }
  }
  if (currentChars) chunks.push(currentChars);
  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join(" ");
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip"
  };
  return map[ext] ?? "application/octet-stream";
}

function base64WrapBuffer(buffer, width = 76) {
  const str = buffer.toString("base64");
  const lines = [];
  for (let i = 0; i < str.length; i += width) lines.push(str.slice(i, i + width));
  return lines.join("\r\n");
}

async function buildRfc822EmailAsync(input = {}) {
  const to = asEmailList(input.to);
  const cc = asEmailList(input.cc);
  const bcc = asEmailList(input.bcc);
  const attachmentPaths = asGenericList(input.attachmentPaths);
  const headers = [
    `To: ${to.join(", ")}`,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    bcc.length ? `Bcc: ${bcc.join(", ")}` : null,
    `Subject: ${encodeHeaderRfc2047(input.subject ?? "")}`,
    "MIME-Version: 1.0"
  ].filter((line) => line !== null);

  if (attachmentPaths.length === 0) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body ?? ""
    ].join("\r\n");
  }

  const boundary = `lingxy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const parts = [
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    input.body ?? ""
  ];
  const bodyPart = `--${boundary}\r\n${parts.join("\r\n")}\r\n`;
  const attachmentParts = [];
  for (const filePath of attachmentPaths) {
    const content = await readFile(filePath);
    const filename = path.basename(filePath);
    const encodedName = encodeHeaderRfc2047(filename);
    attachmentParts.push([
      `--${boundary}`,
      `Content-Type: ${mimeTypeFor(filePath)}; name="${encodedName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${encodedName}"`,
      "",
      base64WrapBuffer(content)
    ].join("\r\n"));
  }
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    bodyPart,
    attachmentParts.join("\r\n"),
    `--${boundary}--`
  ].join("\r\n");
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
    body: JSON.stringify({ raw: base64Url(await buildRfc822EmailAsync(input)) })
  });
  if (!response.ok) return { status: "error", errorCode: `gmail_send_error:${response.status}` };
  const payload = await response.json();
  return { status: "success", provider: "google", accountId: account.id, data: { messageId: payload.id ?? null } };
}

// Google Docs / Sheets / Slides export formats when the user wants the raw
// content of a Workspace document instead of a Drive file download. Any
// mimeType not listed here goes through /files/:id?alt=media which works for
// uploaded binaries (pdf/docx/jpg/etc).
const WORKSPACE_EXPORT_MIME_MAP = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ".docx"
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: ".xlsx"
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: ".pptx"
  },
  "application/vnd.google-apps.drawing": { mimeType: "image/png", ext: ".png" },
  "application/vnd.google-apps.script": { mimeType: "application/vnd.google-apps.script+json", ext: ".json" }
};

function sanitiseFilename(name) {
  return String(name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function ensureWritableTarget(destPath, filename, overwrite) {
  if (!destPath) throw new Error("destPath is required");
  const resolved = path.resolve(destPath);
  let target = resolved;
  try {
    const st = await stat(resolved);
    if (st.isDirectory()) {
      target = path.join(resolved, filename);
    }
  } catch {
    // path doesn't exist. If the path ends with a separator or has no extension
    // treat it as a directory (create + write into it); otherwise treat as file.
    const looksLikeDir = /[\\/]$/.test(destPath) || !path.extname(destPath);
    if (looksLikeDir) {
      await mkdir(resolved, { recursive: true });
      target = path.join(resolved, filename);
    } else {
      await mkdir(path.dirname(resolved), { recursive: true });
    }
  }
  if (!overwrite) {
    try {
      await stat(target);
      throw new Error(`target_exists: ${target}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (error.message?.startsWith("target_exists")) throw error;
      }
    }
  }
  return target;
}

export async function downloadGoogleFile(runtime, account, input = {}, { fetchImpl = fetch } = {}) {
  const accessToken = await getValidAccessToken(runtime, account.id, { fetchImpl });
  if (!accessToken) return { status: "reauth_required", accountId: account.id, provider: account.provider };

  const fileId = input.fileId ?? input.id;
  if (!fileId) return { status: "error", errorCode: "FILE_ID_REQUIRED", message: "fileId is required" };

  // Look up metadata to decide export vs. media download and to pick a filename.
  const metaResponse = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    { headers: headers(accessToken) }
  );
  if (!metaResponse.ok) {
    return { status: "error", errorCode: `gdrive_meta_error:${metaResponse.status}` };
  }
  const meta = await metaResponse.json();

  let downloadUrl;
  let suggestedName = sanitiseFilename(input.newFileName ?? meta.name ?? `file-${fileId}`);
  const workspaceExport = WORKSPACE_EXPORT_MIME_MAP[meta.mimeType];
  if (workspaceExport) {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(workspaceExport.mimeType)}`;
    if (!path.extname(suggestedName)) suggestedName += workspaceExport.ext;
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  }

  const target = await ensureWritableTarget(input.destPath ?? input.localPath ?? process.cwd(), suggestedName, input.overwrite !== false);

  const response = await fetchImpl(downloadUrl, { headers: headers(accessToken) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { status: "error", errorCode: `gdrive_download_error:${response.status}`, message: text.slice(0, 300) };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(target, buffer);
  return {
    status: "success",
    provider: "google",
    accountId: account.id,
    data: {
      file: {
        id: meta.id,
        name: meta.name,
        mimeType: meta.mimeType,
        size: buffer.length,
        localPath: target
      }
    }
  };
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
  if (!response.ok) {
    const detail = await readGoogleApiError(response);
    return {
      status: response.status === 401 ? "reauth_required" : "error",
      errorCode: `gcal_create_error:${response.status}`,
      message: detail ? `Google Calendar API 返回 ${response.status}：${detail}` : undefined,
      accountId: account.id,
      provider: account.provider
    };
  }
  const payload = await response.json();
  return { status: "success", provider: "google", accountId: account.id, data: { event: { id: payload.id, title: payload.summary, url: payload.htmlLink } } };
}
