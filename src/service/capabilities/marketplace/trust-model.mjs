import { normalizeMarketplaceDistribution } from "./distribution-policy.mjs";

export const MARKETPLACE_TRUST_SCHEMA_VERSION = 1;

export const MARKETPLACE_TRUST_FLAGS = Object.freeze({
  TRUSTED: "trusted",
  LOCAL_ONLY: "local_only",
  THIRD_PARTY: "third_party",
  UNSIGNED: "unsigned",
  DISABLED: "disabled",
  DELETED: "deleted"
});

const THIRD_PARTY_SOURCES = new Set([
  "github_install",
  "installed",
  "marketplace",
  "third_party"
]);

function asString(value) {
  return `${value ?? ""}`.trim();
}

function sourceFrom(entry = {}) {
  return asString(
    entry.source
    ?? entry.registrySource
    ?? entry.installSource
    ?? entry.origin
    ?? "runtime_config"
  ) || "runtime_config";
}

function sourceKind(source = "") {
  const value = asString(source);
  if (value === "builtin" || value === "built-in") return "builtin";
  if (value.startsWith("plugin:")) return "plugin";
  if (THIRD_PARTY_SOURCES.has(value)) return value;
  if (value.includes("github")) return "github_install";
  return value || "runtime_config";
}

function hasVerifiedSignature(entry = {}) {
  const distribution = entry.distribution ?? normalizeMarketplaceDistribution(entry);
  return distribution.signature?.state === "verified"
    || entry.signatureVerified === true;
}

function isDeleted(entry = {}) {
  return entry.deleted === true
    || entry.deletedAt != null
    || entry.status === "deleted"
    || entry.inactiveReason === "deleted";
}

function isDisabled(entry = {}) {
  return entry.enabled === false
    || entry.active === false
    || entry.status === "disabled"
    || entry.inactiveReason === "disabled_by_user";
}

export function classifyMarketplaceTrust(entry = {}, { kind = "capability" } = {}) {
  const distribution = entry.distribution ?? normalizeMarketplaceDistribution(entry, { kind });
  const source = sourceFrom(entry);
  const normalizedSource = sourceKind(source);
  const flags = new Set();
  const thirdParty = entry.thirdParty === true
    || normalizedSource === "github_install"
    || normalizedSource === "installed"
    || normalizedSource === "marketplace"
    || normalizedSource === "third_party"
    || normalizedSource === "plugin";
  const trusted = normalizedSource === "builtin" && !thirdParty;
  const localOnly = entry.localOnly === true
    || normalizedSource === "runtime_config"
    || normalizedSource === "data_integration"
    || normalizedSource === "editable"
    || normalizedSource === "local";

  if (trusted) flags.add(MARKETPLACE_TRUST_FLAGS.TRUSTED);
  if (localOnly) flags.add(MARKETPLACE_TRUST_FLAGS.LOCAL_ONLY);
  if (thirdParty) flags.add(MARKETPLACE_TRUST_FLAGS.THIRD_PARTY);
  if (thirdParty && !hasVerifiedSignature({ ...entry, distribution })) flags.add(MARKETPLACE_TRUST_FLAGS.UNSIGNED);
  if (isDisabled(entry)) flags.add(MARKETPLACE_TRUST_FLAGS.DISABLED);
  if (isDeleted(entry)) flags.add(MARKETPLACE_TRUST_FLAGS.DELETED);

  const trustFlags = [...flags];
  return {
    schemaVersion: MARKETPLACE_TRUST_SCHEMA_VERSION,
    kind,
    id: asString(entry.id ?? entry.skillStateKey ?? entry.displayName) || null,
    source,
    origin: trusted ? "builtin" : thirdParty ? "third_party" : "local",
    trusted,
    localOnly: flags.has(MARKETPLACE_TRUST_FLAGS.LOCAL_ONLY),
    thirdParty: flags.has(MARKETPLACE_TRUST_FLAGS.THIRD_PARTY),
    signed: hasVerifiedSignature({ ...entry, distribution }),
    signatureState: distribution.signature?.state ?? "unsigned",
    distribution,
    enabled: !flags.has(MARKETPLACE_TRUST_FLAGS.DISABLED),
    deleted: flags.has(MARKETPLACE_TRUST_FLAGS.DELETED),
    trustFlags,
    trustState: trustFlags.join("+") || "unknown",
    userActionRequired: trustFlags.some((flag) =>
      flag === MARKETPLACE_TRUST_FLAGS.THIRD_PARTY
      || flag === MARKETPLACE_TRUST_FLAGS.UNSIGNED
      || flag === MARKETPLACE_TRUST_FLAGS.DISABLED
      || flag === MARKETPLACE_TRUST_FLAGS.DELETED
    ),
    warnings: trustWarnings(trustFlags, kind)
  };
}

function trustWarnings(flags = [], kind = "capability") {
  const out = [];
  if (flags.includes(MARKETPLACE_TRUST_FLAGS.THIRD_PARTY)) {
    out.push(`${kind}_third_party`);
  }
  if (flags.includes(MARKETPLACE_TRUST_FLAGS.UNSIGNED)) {
    out.push(`${kind}_unsigned`);
  }
  if (flags.includes(MARKETPLACE_TRUST_FLAGS.DISABLED)) {
    out.push(`${kind}_disabled`);
  }
  if (flags.includes(MARKETPLACE_TRUST_FLAGS.DELETED)) {
    out.push(`${kind}_deleted`);
  }
  return out;
}

export function buildMarketplaceTrustPreview(entry = {}, options = {}) {
  const trust = classifyMarketplaceTrust(entry, options);
  return {
    trust,
    distribution: trust.distribution,
    title: asString(entry.displayName ?? entry.name ?? entry.id) || trust.id,
    description: asString(entry.description),
    source: trust.source,
    origin: trust.origin,
    warnings: trust.warnings,
    requiredUserReview: trust.userActionRequired
  };
}
