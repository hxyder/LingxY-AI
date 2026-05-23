// UCA-182 Phase 18: TF-IDF feature extraction that handles English +
// Chinese. The previous implementation used `/\W+/`, which on JS's
// default (ASCII-only \w) treats every CJK character as a separator —
// meaning Chinese inputs produced an empty weight map and RAG recall
// silently degraded to "no signal". We now extract:
//   - ASCII/digit words (as before, lowercased)
//   - individual CJK characters (unigram, weight 0.5)
//   - adjacent CJK bigrams (weight 1.0 — more semantic)
// Weights still combine additively so TF-IDF downstream keeps working
// without any schema change.
export function embedTextLocal(text) {
  const source = String(text ?? "").toLowerCase();
  const weights = new Map();

  // ASCII / digit tokens.
  const ascii = source.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  for (const term of ascii) {
    if (term.length === 0) continue;
    weights.set(term, (weights.get(term) ?? 0) + 1);
  }

  // CJK unigrams + bigrams.
  const cjk = source.match(/\p{Script=Han}/gu) ?? [];
  for (const ch of cjk) {
    weights.set(ch, (weights.get(ch) ?? 0) + 0.5);
  }
  for (let i = 0; i < cjk.length - 1; i += 1) {
    const bigram = cjk[i] + cjk[i + 1];
    weights.set(bigram, (weights.get(bigram) ?? 0) + 1);
  }

  return weights;
}
