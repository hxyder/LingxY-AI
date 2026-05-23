import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { validateMcpServerDescriptor } from "./descriptor-validation.mjs";

export function resolveMcpDraftsDir(runtime = {}) {
  const paths = runtime?.paths ?? runtime ?? {};
  const explicit = paths.mcpDraftsDir;
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  const baseDir = paths.baseDir;
  if (typeof baseDir === "string" && baseDir.trim()) {
    return path.join(baseDir, "data", "mcp-drafts");
  }
  return null;
}

function assertInsideDraftsDir(draftsDir, candidate) {
  const root = path.resolve(draftsDir);
  const target = path.resolve(path.isAbsolute(candidate) ? candidate : path.join(root, candidate));
  if (target !== root && target.startsWith(`${root}${path.sep}`)) return target;
  throw new Error("mcp_draft_path_not_allowed");
}

function summarizeDescriptor(descriptor = {}) {
  return {
    id: descriptor.id ?? "",
    displayName: descriptor.displayName ?? descriptor.name ?? descriptor.id ?? "",
    transport: descriptor.transport ?? "stdio",
    command: descriptor.command ?? null,
    args: Array.isArray(descriptor.args) ? descriptor.args : [],
    url: descriptor.url ?? null,
    enabled: descriptor.enabled === true
  };
}

function normalizeDraftPayload(payload = {}, { file } = {}) {
  if (payload?.kind !== "mcp" || payload?.status !== "draft") return null;
  const descriptor = { ...(payload.descriptor ?? {}), enabled: false };
  const validation = validateMcpServerDescriptor(descriptor);
  return {
    file,
    id: payload.id ?? descriptor.id ?? "",
    name: payload.name ?? descriptor.displayName ?? descriptor.id ?? "",
    purpose: payload.purpose ?? "",
    saved_at: payload.saved_at ?? null,
    descriptor: summarizeDescriptor(descriptor),
    validation: {
      ok: validation.ok,
      errors: validation.errors ?? []
    }
  };
}

export async function listMcpDrafts(runtime = {}) {
  const draftsDir = resolveMcpDraftsDir(runtime);
  if (!draftsDir) return [];
  let files = [];
  try {
    files = await readdir(draftsDir);
  } catch {
    return [];
  }
  const drafts = [];
  for (const file of files.filter((entry) => entry.toLowerCase().endsWith(".json"))) {
    const filePath = assertInsideDraftsDir(draftsDir, file);
    try {
      const payload = JSON.parse(await readFile(filePath, "utf8"));
      const draft = normalizeDraftPayload(payload, { file, filePath });
      if (draft) drafts.push(draft);
    } catch {
      // Broken draft files stay on disk for manual recovery but do not break
      // the Connectors page.
    }
  }
  return drafts.sort((a, b) => String(b.saved_at ?? "").localeCompare(String(a.saved_at ?? "")));
}

export async function readMcpDraft(runtime = {}, fileOrPath = "") {
  const draftsDir = resolveMcpDraftsDir(runtime);
  if (!draftsDir) throw new Error("mcp_drafts_dir_not_configured");
  const filePath = assertInsideDraftsDir(draftsDir, `${fileOrPath ?? ""}`);
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const draft = normalizeDraftPayload(payload, {
    file: path.basename(filePath),
    filePath
  });
  if (!draft) throw new Error("mcp_draft_invalid");
  return {
    ...draft,
    descriptor: { ...(payload.descriptor ?? {}), enabled: false }
  };
}
