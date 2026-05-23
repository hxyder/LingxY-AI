export function buildDagViewModel(graph, execution = null) {
  const statuses = execution?.statuses ?? {};
  return {
    nodes: (graph.nodes ?? []).map((node) => ({
      id: node.id,
      label: node.name ?? node.id,
      target: node.target,
      status: statuses[node.id] ?? "pending"
    })),
    edges: graph.edges ?? [],
    status: execution?.status ?? "pending"
  };
}
