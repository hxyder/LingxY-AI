export function embedTextLocal(text) {
  const terms = String(text ?? "").toLowerCase().split(/\W+/).filter(Boolean);
  const weights = new Map();
  for (const term of terms) {
    weights.set(term, (weights.get(term) ?? 0) + 1);
  }
  return weights;
}
