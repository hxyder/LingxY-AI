import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MARKETPLACE_SIGNATURE_STATE = Object.freeze({
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
  UNSIGNED: "unsigned"
});

export const MARKETPLACE_ARCHIVE_STATE = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived"
});

function asString(value) {
  return `${value ?? ""}`.trim();
}

function normalizeSignatureMetadata(signature = null) {
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    return {
      state: MARKETPLACE_SIGNATURE_STATE.UNSIGNED,
      scheme: null,
      signer: null,
      digest: null
    };
  }
  const verified = signature.verified === true || signature.verification === MARKETPLACE_SIGNATURE_STATE.VERIFIED;
  return {
    state: verified ? MARKETPLACE_SIGNATURE_STATE.VERIFIED : MARKETPLACE_SIGNATURE_STATE.UNVERIFIED,
    scheme: asString(signature.scheme ?? signature.algorithm) || null,
    signer: asString(signature.signer ?? signature.keyId ?? signature.issuer) || null,
    digest: asString(signature.digest ?? signature.sha256 ?? signature.contentHash) || null
  };
}

export function normalizeMarketplaceDistribution(entry = {}, { kind = "capability" } = {}) {
  const signature = normalizeSignatureMetadata(entry.signature ?? null);
  const archived = entry.archived === true
    || entry.archiveState === MARKETPLACE_ARCHIVE_STATE.ARCHIVED
    || entry.status === MARKETPLACE_ARCHIVE_STATE.ARCHIVED
    || Boolean(entry.archivedAt);
  const shareable = entry.shareable === true
    || (entry.distribution?.shareable === true && signature.state === MARKETPLACE_SIGNATURE_STATE.VERIFIED);
  return {
    schemaVersion: 1,
    kind,
    signature,
    shareable: Boolean(shareable && !archived),
    archive: {
      state: archived ? MARKETPLACE_ARCHIVE_STATE.ARCHIVED : MARKETPLACE_ARCHIVE_STATE.ACTIVE,
      archived: Boolean(archived),
      archivedAt: entry.archivedAt ?? null,
      archivePath: entry.archivePath ?? null
    }
  };
}

export function isMarketplaceEntryRunnable(entry = {}) {
  const distribution = entry.distribution ?? normalizeMarketplaceDistribution(entry);
  return distribution.archive?.archived !== true
    && entry.deleted !== true
    && entry.status !== "deleted"
    && entry.enabled !== false;
}

export function archiveMarketplaceInstallDirectory({
  sourceDir,
  archiveRoot,
  id,
  now = () => new Date(),
  randomId = randomUUID
} = {}) {
  if (!sourceDir || !archiveRoot || !id) {
    throw new Error("archive_source_root_and_id_required");
  }
  mkdirSync(archiveRoot, { recursive: true });
  const archivedAt = now().toISOString();
  const stamp = archivedAt.replace(/[:.]/g, "-");
  const safeId = asString(id).replace(/[^A-Za-z0-9._-]+/g, "-") || "capability";
  const archivePath = path.join(archiveRoot, `${safeId}-${stamp}-${randomId().slice(0, 8)}`);
  renameSync(sourceDir, archivePath);
  return {
    archived: true,
    archiveState: MARKETPLACE_ARCHIVE_STATE.ARCHIVED,
    archivedAt,
    archivePath
  };
}
