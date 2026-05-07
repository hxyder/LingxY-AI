// C18 #2b (UPGRADE_PLAN.md, 2026-05-08): in-memory registry mapping
// `state_token` → `stagingInfo`. Used by the two-step skill-install
// action tools:
//
//   1. preview_skill_from_github(url) → stages + put → returns token
//   2. install_skill_from_github(token) → consume + finalize
//
// D's pre-design ACCEPT (option-c) requires that the user approves
// EXACTLY THE staged content they previewed; the token + bound
// stagingInfo (with contentHash) is how we enforce that contract
// across the agent-loop's confirmation gate.
//
// Constitution (CADRE C):
//   - 不打补丁: registry is a plain Map with TTL, no per-token
//     branching. Adding a future tool that wants the same staging
//     pattern reuses createInstallStateRegistry() unchanged.
//   - 不针对特定提问: tokens are opaque random IDs; eviction policy
//     is deterministic (TTL + LRU-on-overflow); cleanup runs on
//     every operation so callers never need to manually GC.
//
// Implementation notes:
//   - TTL default: 10 minutes. Long enough for the user to read
//     SKILL.md and confirm; short enough that staged dirs don't
//     pile up if the user walks away.
//   - Max-entries cap: 5 concurrent staged installs per runtime.
//     Prevents an LLM in a runaway loop from filling the disk with
//     unconfirmed clones. When the cap is hit, the OLDEST entry is
//     evicted (its staging dir cleaned up) before the new one is
//     accepted.
//   - On evict / expire / consume, the runtime calls discardStaged-
//     Install to rm the staging dir. Caller must NOT manually
//     remove staging dirs without going through the registry.

import { randomUUID } from "node:crypto";
import { discardStagedInstall } from "./github-install.mjs";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5;

/**
 * Build a fresh skill-install state registry. Wired into the runtime
 * once at boot (src/service/core/service-bootstrap.mjs), then handed
 * to the action tools via ctx.runtime.skillInstallState.
 *
 * @param {{
 *   ttlMs?: number,
 *   maxEntries?: number,
 *   now?: () => number,
 *   discardImpl?: (stagingInfo: any) => Promise<void>
 * }} [opts]
 */
export function createInstallStateRegistry({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = () => Date.now(),
  discardImpl = discardStagedInstall
} = {}) {
  // codex round-1: defensive constructor checks. put() has a
  // `while (entries.size >= maxEntries) evictOldest()` loop; with
  // maxEntries <= 0 and an empty map this would spin forever.
  // Reject malformed config up front rather than tripwire later.
  if (!Number.isFinite(maxEntries) || maxEntries < 1) {
    throw new Error(`createInstallStateRegistry: maxEntries must be ≥ 1 (got ${maxEntries})`);
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new Error(`createInstallStateRegistry: ttlMs must be ≥ 1 (got ${ttlMs})`);
  }
  /** @type {Map<string, { stagingInfo: any, expiresAt: number, createdAt: number }>} */
  const entries = new Map();

  function evict(token) {
    const entry = entries.get(token);
    if (!entry) return false;
    entries.delete(token);
    // discardImpl is fire-and-forget; we don't block put/consume on
    // a slow rm. If the rm fails the staging dir leaks until OS
    // temp cleanup, which is acceptable for an unconfirmed clone.
    void Promise.resolve(discardImpl(entry.stagingInfo)).catch(() => {});
    return true;
  }

  function cleanupExpired() {
    const t = now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= t) evict(token);
    }
  }

  function evictOldest() {
    // Map iteration order is insertion order — first key is oldest.
    const iterator = entries.keys();
    const next = iterator.next();
    if (next.done) return;
    evict(next.value);
  }

  return {
    /**
     * Register a stagingInfo and return its opaque token.
     * Cleans up expired entries first; if at capacity, evicts the
     * oldest entry (which discards its staging dir).
     */
    put(stagingInfo) {
      if (!stagingInfo || typeof stagingInfo !== "object") {
        throw new Error("stagingInfo is required");
      }
      cleanupExpired();
      while (entries.size >= maxEntries) {
        evictOldest();
      }
      const token = randomUUID();
      const t = now();
      entries.set(token, {
        stagingInfo,
        createdAt: t,
        expiresAt: t + ttlMs
      });
      return token;
    },

    /**
     * Look up stagingInfo by token without removing it. Returns null
     * if the token is unknown or expired. Cleans up expired entries
     * as a side effect.
     */
    get(token) {
      cleanupExpired();
      const entry = entries.get(token);
      return entry ? entry.stagingInfo : null;
    },

    /**
     * Remove the entry from the registry and return its stagingInfo.
     * The caller is now responsible for the staging dir lifecycle —
     * either finalize promotes it (renames out from under the temp
     * path) or the caller calls discardStagedInstall manually.
     * Returns null if token is unknown or expired.
     */
    consume(token) {
      cleanupExpired();
      const entry = entries.get(token);
      if (!entry) return null;
      entries.delete(token);
      return entry.stagingInfo;
    },

    /**
     * Forcibly discard a token + its staging dir. Idempotent.
     */
    evict,

    /**
     * Number of unconfirmed staged installs currently held.
     */
    size() {
      cleanupExpired();
      return entries.size;
    },

    /**
     * Inspect a token without consuming it. Runs the same expiry
     * cleanup as get/consume so an expired token is reported as
     * gone (codex round-1: this previously skipped cleanup, which
     * matters for #2c when the approval gate uses inspect to build
     * the preview_text — must not show stale expired entries).
     */
    inspect(token) {
      cleanupExpired();
      const entry = entries.get(token);
      if (!entry) return null;
      return {
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        owner: entry.stagingInfo.owner,
        repo: entry.stagingInfo.repo,
        branch: entry.stagingInfo.branch,
        subPath: entry.stagingInfo.subPath,
        targetIdentifier: entry.stagingInfo.targetIdentifier,
        descriptor: entry.stagingInfo.descriptor,
        previewMarkdown: entry.stagingInfo.preview?.markdown,
        previewSizeBytes: entry.stagingInfo.preview?.sizeBytes,
        contentHash: entry.stagingInfo.preview?.contentHash
      };
    }
  };
}
