import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embedTextLocal } from "./bge_local.mjs";
import { embedTextSemantic, cosineSimilarity } from "./semantic.mjs";

// ─── Embedding format discriminator ───────────────────────────────────────────
// Records on disk can be in one of three shapes:
//   - Legacy Map format  : [[term, count], ...]  (old TF-IDF)
//   - { type:"tfidf", data: [[term,count],...] } (new TF-IDF wrapper)
//   - { type:"vector", data: number[] }           (semantic)

function isLegacyMap(value) {
  return (
    value instanceof Map ||
    (Array.isArray(value) && (value.length === 0 || Array.isArray(value[0])))
  );
}

function normalizeEmbedding(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.type) {
    return raw; // already new format
  }
  // Legacy: array of [term, count] pairs, or a Map
  const entries = raw instanceof Map ? [...raw.entries()] : raw ?? [];
  return { type: "tfidf", data: entries };
}

// ─── Similarity dispatch ───────────────────────────────────────────────────────

function jaccardSimilarity(aEntries, bEntries) {
  const leftTerms = new Set(aEntries.map(([t]) => t));
  const rightTerms = new Set(bEntries.map(([t]) => t));
  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) intersection += 1;
  }
  const union = new Set([...leftTerms, ...rightTerms]).size || 1;
  return intersection / union;
}

function computeSimilarity(query, record) {
  const q = normalizeEmbedding(query);
  const r = normalizeEmbedding(record);

  if (q.type === "vector" && r.type === "vector") {
    return cosineSimilarity(q.data, r.data);
  }
  if (q.type === "tfidf" && r.type === "tfidf") {
    return jaccardSimilarity(q.data, r.data);
  }
  // Mixed: prefer partial TF-IDF match rather than returning 0
  const qEntries = q.type === "tfidf" ? q.data : [];
  const rEntries = r.type === "tfidf" ? r.data : [];
  if (qEntries.length > 0 || rEntries.length > 0) {
    return jaccardSimilarity(qEntries, rEntries);
  }
  return 0;
}

// ─── Serialisation ─────────────────────────────────────────────────────────────

function serializeEmbedding(emb) {
  if (!emb) return { type: "tfidf", data: [] };
  if (emb instanceof Map) return { type: "tfidf", data: [...emb.entries()] };
  if (Array.isArray(emb)) return { type: "tfidf", data: emb };
  return emb; // already { type, data }
}

function deserializeEmbedding(raw) {
  return normalizeEmbedding(raw);
}

// ─── Persistence helpers ────────────────────────────────────────────────────────

function loadRecords(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) return [];
  return JSON.parse(raw).map((record) => ({
    ...record,
    embedding: deserializeEmbedding(record.embedding)
  }));
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export function createEmbeddingStore({ filePath = null } = {}) {
  if (filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const records = loadRecords(filePath);

  function persist() {
    if (!filePath) return;
    writeFileSync(
      filePath,
      `${JSON.stringify(
        records.map((record) => ({
          ...record,
          embedding: serializeEmbedding(record.embedding)
        })),
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  function upsert(id, next) {
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) {
      records.push(next);
    } else {
      records[index] = next;
    }
  }

  return {
    /**
     * Add or update a record. Always persists TF-IDF so search has a
     * deterministic fallback; asynchronously upgrades to a semantic
     * vector on top (kept alongside the TF-IDF so mixed-type queries
     * never silently score zero). Call sites do NOT need to await —
     * fire-and-forget is safe.
     */
    add({ id, text, metadata = {} }) {
      const tfidfMap = embedTextLocal(text);
      const tfidf = [...tfidfMap.entries()];
      const record = {
        id,
        text,
        metadata,
        embedding: { type: "tfidf", data: tfidf },
        tfidf  // UCA-182 Phase 18: always retain TF-IDF even after vector upgrade
      };
      upsert(id, record);
      persist();

      // Background semantic upgrade — non-blocking. Preserves tfidf.
      embedTextSemantic(text)
        .then((vec) => {
          if (!vec) return;
          const target = records.find((r) => r.id === id);
          if (!target) return;
          target.embedding = { type: "vector", data: vec };
          // tfidf stays on the record so mixed queries can still match.
          persist();
        })
        .catch(() => {/* non-fatal */});

      return { id, text, metadata };
    },

    /**
     * Semantic search. Returns records sorted by similarity descending.
     * Uses the vector path when both query and record have vectors;
     * otherwise falls back to TF-IDF (which records always retain
     * post-Phase-18). Never returns an all-zero result set when the
     * records contain matching terms.
     */
    async search(text, limit = 5) {
      const tfidfQueryEntries = [...embedTextLocal(text).entries()];
      const vec = await embedTextSemantic(text);

      return records
        .map((record) => {
          let score = 0;
          if (vec && record.embedding?.type === "vector") {
            score = cosineSimilarity(vec, record.embedding.data);
          } else if (record.embedding?.type === "tfidf") {
            score = jaccardSimilarity(tfidfQueryEntries, record.embedding.data);
          } else if (record.tfidf) {
            // Vector-only record (pre-Phase-18 data) — still try the
            // retained tfidf side; zero otherwise.
            score = jaccardSimilarity(tfidfQueryEntries, record.tfidf);
          }
          return {
            id: record.id,
            text: record.text,
            metadata: record.metadata,
            embeddingType: record.embedding?.type ?? "tfidf",
            score
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    list() {
      return records.map((r) => ({
        id: r.id,
        text: r.text,
        metadata: r.metadata,
        embeddingType: r.embedding?.type ?? "tfidf"
      }));
    }
  };
}
