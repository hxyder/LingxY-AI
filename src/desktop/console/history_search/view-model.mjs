export function buildHistorySearchViewModel(query, matches = []) {
  return {
    title: "历史相似任务",
    query,
    resultCount: matches.length,
    columns: ["task_id", "score", "summary", "created_at"],
    matches: matches.map((match) => ({
      task_id: match.id,
      score: Number((match.score ?? 0).toFixed(4)),
      summary: match.metadata?.summary ?? match.text,
      created_at: match.metadata?.created_at ?? null
    }))
  };
}
