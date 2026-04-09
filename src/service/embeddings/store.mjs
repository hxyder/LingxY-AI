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

export function createEmbeddingStore() {
  const records = [];

  return {
    add({ id, text, metadata = {} }) {
      const embedding = embedTextLocal(text);
      records.push({
        id,
        text,
        metadata,
        embedding
      });
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
    }
  };
}
