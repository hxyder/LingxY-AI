export function encodeNativeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function decodeNativeMessage(buffer) {
  const byteLength = buffer.readUInt32LE(0);
  const body = buffer.subarray(4, 4 + byteLength).toString("utf8");
  return JSON.parse(body);
}
