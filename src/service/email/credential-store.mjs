import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SERVICE_NAME = "UCA.Email";

async function loadKeytar() {
  try {
    const mod = await import("keytar");
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

function resolveFallbackPath(runtime) {
  const baseDir = runtime?.paths?.dataDir
    ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "UCA") : path.join(os.homedir(), ".uca-runtime"));
  return path.join(baseDir, "email-credentials.json");
}

async function readFallbackStore(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeFallbackStore(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function setCredential(runtime, accountId, credential) {
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, accountId, JSON.stringify(credential ?? {}));
    return { ok: true, backend: "keytar" };
  }

  const filePath = resolveFallbackPath(runtime);
  const store = await readFallbackStore(filePath);
  store[accountId] = credential ?? {};
  await writeFallbackStore(filePath, store);
  return { ok: true, backend: "file", path: filePath };
}

export async function getCredential(runtime, accountId) {
  const keytar = await loadKeytar();
  if (keytar) {
    const raw = await keytar.getPassword(SERVICE_NAME, accountId);
    return raw ? JSON.parse(raw) : null;
  }
  const filePath = resolveFallbackPath(runtime);
  const store = await readFallbackStore(filePath);
  return store[accountId] ?? null;
}

export async function deleteCredential(runtime, accountId) {
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, accountId);
    return { ok: true, backend: "keytar" };
  }
  const filePath = resolveFallbackPath(runtime);
  const store = await readFallbackStore(filePath);
  delete store[accountId];
  await writeFallbackStore(filePath, store);
  return { ok: true, backend: "file", path: filePath };
}
