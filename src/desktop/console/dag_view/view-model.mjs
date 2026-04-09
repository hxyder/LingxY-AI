export function buildDagConsoleViewModel(graph, execution = null) {
  return {
    title: "工作流 DAG",
    nodeCount: graph?.nodes?.length ?? 0,
    edgeCount: graph?.edges?.length ?? 0,
    legend: ["pending", "running", "success", "failed", "blocked"],
    nodes: (graph?.nodes ?? []).map((node) => ({
      id: node.id,
      label: node.label ?? node.id,
      executor: node.target ?? node.executor ?? null,
      status: execution?.statuses?.[node.id] ?? "pending"
    })),
    edges: graph?.edges ?? []
  };
}
