/**
 * Semantic embedding via the configured LLM provider's `/v1/embeddings` endpoint.
 * Supports OpenAI and any OpenAI-compatible API that exposes embeddings.
 * Anthropic and code_cli providers have no embeddings endpoint — returns null so
 * the store transparently falls back to TF-IDF.
 */

const EMBEDDING_TIMEOUT_MS = 8_000;
const MAX_INPUT_CHARS = 8_192;

function inferEmbeddingModel(chatModel = "") {
  if (/^text-embedding-/i.test(chatModel)) {
    return chatModel;
  }
  // OpenAI model families → their embedding counterpart
  if (chatModel.includes("gpt-4") || chatModel.includes("gpt-3.5")) {
    return "text-embedding-3-small";
  }
  // Generic OpenAI-compat fallback (works for most local / hosted servers)
  return "text-embedding-3-small";
}

/**
 * Returns a float[] embedding vector, or null if unavailable.
 * Never throws — callers should treat null as "use TF-IDF".
 */
export async function embedTextSemantic(text) {
  try {
    const { resolveProviderForTask } = await import(
      "../executors/shared/provider-resolver.mjs"
    );
    const provider = resolveProviderForTask("embedding");

    // Only OpenAI-compatible providers expose /v1/embeddings
    if (
      !provider ||
      provider.kind === "anthropic" ||
      provider.kind === "code_cli"
    ) {
      return null;
    }

    const model =
      provider.embeddingModel ?? inferEmbeddingModel(provider.model ?? "");
    const input = String(text ?? "").slice(0, MAX_INPUT_CHARS);

    const resp = await fetch(`${provider.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return null;
    return vec; // float[]
  } catch {
    return null;
  }
}

/** Cosine similarity between two equal-length float vectors. Range [−1, 1]. */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
