import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embedTextLocal } from "./bge_local.mjs";

function similarity(left, right) {
  const leftTerms = new Set(left.keys());
  const rightTerms = new Set(right.keys());
  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftTerms, ...rightTerms]).size || 1;
  return intersection / union;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeEmbedding(embedding) {
  return [...embedding.entries()];
}

function deserializeEmbedding(embedding) {
  if (embedding instanceof Map) {
    return embedding;
  }
  if (Array.isArray(embedding)) {
    return new Map(embedding);
  }
  return new Map(Object.entries(embedding ?? {}));
}

function loadRecords(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return [];
  }
  return JSON.parse(raw).map((record) => ({
    ...record,
    embedding: deserializeEmbedding(record.embedding)
  }));
}

export function createEmbeddingStore({
  filePath = null
} = {}) {
  if (filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const records = loadRecords(filePath);

  function persist() {
    if (!filePath) {
      return;
    }
    writeFileSync(filePath, `${JSON.stringify(records.map((record) => ({
      ...record,
      embedding: serializeEmbedding(record.embedding)
    })), null, 2)}\n`, "utf8");
  }

  return {
    add({ id, text, metadata = {} }) {
      const embedding = embedTextLocal(text);
      const nextRecord = {
        id,
        text,
        metadata,
        embedding
      };
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) {
        records.push(nextRecord);
      } else {
        records[index] = nextRecord;
      }
      persist();
      return clone(nextRecord);
    },
    search(text, limit = 5) {
      const target = embedTextLocal(text);
      return records
        .map((record) => ({
          ...record,
          score: similarity(target, record.embedding)
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
    },
    list() {
      return records.map((record) => ({
        ...clone(record),
        embedding: serializeEmbedding(record.embedding)
      }));
    }
  };
}
