import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embedTextLocal } from "./bge_local.mjs";
import { embedTextSemantic, cosineSimilarity } from "./semantic.mjs";

export const EMBEDDING_NAMESPACES = Object.freeze({
  TASK_MEMORY: "task_memory",
  FILE_CONTENT: "file_content"
});

const KNOWN_NAMESPACES = new Set(Object.values(EMBEDDING_NAMESPACES));

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

function normalizeNamespace(value, fallback = EMBEDDING_NAMESPACES.TASK_MEMORY) {
  const namespace = String(value ?? "").trim();
  if (!namespace) return fallback;
  return KNOWN_NAMESPACES.has(namespace) ? namespace : namespace;
}

function namespaceOf(record) {
  return normalizeNamespace(record?.namespace ?? record?.metadata?.namespace);
}

function matchesNamespace(record, namespace) {
  if (namespace === null || namespace === "all") return true;
  return namespaceOf(record) === namespace;
}

function normalizeProjectFilter(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const projectId = String(value ?? "").trim();
  if (!projectId) return null;
  if (projectId === "all") return "all";
  return projectId;
}

function projectIdOf(record) {
  const value = record?.metadata?.project_id ?? record?.metadata?.projectId ?? record?.project_id ?? null;
  const projectId = String(value ?? "").trim();
  return projectId || null;
}

function matchesProject(record, projectFilter) {
  if (projectFilter === undefined || projectFilter === "all") return true;
  const recordProjectId = projectIdOf(record);
  if (projectFilter === null) return recordProjectId === null;
  return recordProjectId === projectFilter;
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

  function removeRecord(id, { namespace = EMBEDDING_NAMESPACES.TASK_MEMORY } = {}) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return null;
    const normalizedNamespace = normalizeNamespace(namespace, EMBEDDING_NAMESPACES.TASK_MEMORY);
    const index = records.findIndex((record) =>
      record.id === targetId
      && matchesNamespace(record, normalizedNamespace)
    );
    if (index === -1) return null;
    const [removed] = records.splice(index, 1);
    persist();
    return {
      id: removed.id,
      text: removed.text,
      metadata: removed.metadata,
      namespace: namespaceOf(removed),
      embeddingType: removed.embedding?.type ?? "tfidf"
    };
  }

  return {
    /**
     * Add or update a record. Always persists TF-IDF so search has a
     * deterministic fallback; asynchronously upgrades to a semantic
     * vector on top (kept alongside the TF-IDF so mixed-type queries
     * never silently score zero). Call sites do NOT need to await —
     * fire-and-forget is safe.
     */
    add({ id, text, metadata = {}, namespace = metadata?.namespace }) {
      const recordNamespace = normalizeNamespace(namespace);
      const tfidfMap = embedTextLocal(text);
      const tfidf = [...tfidfMap.entries()];
      const record = {
        id,
        text,
        namespace: recordNamespace,
        metadata: {
          ...metadata,
          namespace: recordNamespace
        },
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
    async search(text, limit = 5, options = {}) {
      const namespace = options?.namespace === undefined
        ? EMBEDDING_NAMESPACES.TASK_MEMORY
        : normalizeNamespace(options.namespace, null);
      const projectFilter = normalizeProjectFilter(options?.projectId);
      const tfidfQueryEntries = [...embedTextLocal(text).entries()];
      const vec = await embedTextSemantic(text);

      return records
        .filter((record) =>
          matchesNamespace(record, namespace)
          && matchesProject(record, projectFilter)
        )
        .map((record) => {
          const lexicalScore = record.embedding?.type === "tfidf"
            ? jaccardSimilarity(tfidfQueryEntries, record.embedding.data)
            : record.tfidf
              ? jaccardSimilarity(tfidfQueryEntries, record.tfidf)
              : 0;
          const semanticScore = vec && record.embedding?.type === "vector"
            ? cosineSimilarity(vec, record.embedding.data)
            : 0;
          // Hybrid retrieval: keep the stronger of semantic and lexical.
          // This prevents a newly-upgraded vector record from becoming
          // *harder* to find when cosine underperforms on short follow-up
          // queries ("上一个 PPT", "之前 AI 报告") that lexical overlap still
          // handles well.
          const score = Math.max(semanticScore, lexicalScore);
          return {
            id: record.id,
            text: record.text,
            metadata: record.metadata,
            embeddingType: record.embedding?.type ?? "tfidf",
            score,
            lexicalScore,
            semanticScore
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    list(options = {}) {
      const namespace = options?.namespace === undefined
        ? "all"
        : normalizeNamespace(options.namespace, null);
      const projectFilter = normalizeProjectFilter(options?.projectId);
      return records
        .filter((record) =>
          matchesNamespace(record, namespace)
          && matchesProject(record, projectFilter)
        )
        .map((r) => ({
        id: r.id,
        text: r.text,
        metadata: r.metadata,
        namespace: namespaceOf(r),
        embeddingType: r.embedding?.type ?? "tfidf"
      }));
    },

    /**
     * Remove a record from a namespace. Defaults to task_memory so a caller
     * that forgets to pass a namespace cannot delete across namespaces.
     */
    remove(id, options = {}) {
      return removeRecord(id, options);
    }
  };
}
