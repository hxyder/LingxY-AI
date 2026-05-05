export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

export function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

export class HttpBodyTooLargeError extends Error {
  constructor({ maxBytes, actualBytes }) {
    super(`request body exceeds ${maxBytes} bytes`);
    this.name = "HttpBodyTooLargeError";
    this.code = "body_too_large";
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

function appendBodyChunk(chunks, chunk, { maxBytes, totalBytes }) {
  const next = Buffer.from(chunk);
  const nextTotal = totalBytes + next.length;
  if (Number.isFinite(maxBytes) && maxBytes > 0 && nextTotal > maxBytes) {
    throw new HttpBodyTooLargeError({ maxBytes, actualBytes: nextTotal });
  }
  chunks.push(next);
  return nextTotal;
}

export async function readJsonBody(request, options = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes = appendBodyChunk(chunks, chunk, {
      maxBytes: options.maxBytes,
      totalBytes
    });
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function readRawBody(request, options = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes = appendBodyChunk(chunks, chunk, {
      maxBytes: options.maxBytes,
      totalBytes
    });
  }
  return Buffer.concat(chunks);
}
