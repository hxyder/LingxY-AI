function topoSort(nodes, edges) {
  const inbound = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges ?? []) {
    inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const queue = [...nodes.filter((node) => (inbound.get(node.id) ?? 0) === 0).map((node) => node.id)];
  const ordered = [];

  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);
    for (const next of outgoing.get(current) ?? []) {
      inbound.set(next, (inbound.get(next) ?? 1) - 1);
      if ((inbound.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error("dag_cycle_detected");
  }

  return ordered;
}

export function validateDagDefinition(graph) {
  const nodeIds = new Set((graph.nodes ?? []).map((node) => node.id));
  const errors = [];

  for (const edge of graph.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push(`dangling edge: ${edge.from} -> ${edge.to}`);
    }
  }

  try {
    topoSort(graph.nodes ?? [], graph.edges ?? []);
  } catch (error) {
    errors.push(error.message);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export async function runDagGraph({
  graph,
  executeNode,
  onNodeEvent = () => {}
}) {
  const validation = validateDagDefinition(graph);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const order = topoSort(graph.nodes, graph.edges);
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const results = {};
  const statuses = {};

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    statuses[nodeId] = "running";
    onNodeEvent({
      nodeId,
      status: "running"
    });

    try {
      const result = await executeNode(node, {
        results,
        statuses
      });
      results[nodeId] = result;
      statuses[nodeId] = "success";
      onNodeEvent({
        nodeId,
        status: "success",
        result
      });
    } catch (error) {
      statuses[nodeId] = "failed";
      onNodeEvent({
        nodeId,
        status: "failed",
        error: error.message
      });
      for (const blockedNodeId of order.slice(order.indexOf(nodeId) + 1)) {
        if (!statuses[blockedNodeId]) {
          statuses[blockedNodeId] = "blocked";
          onNodeEvent({
            nodeId: blockedNodeId,
            status: "blocked"
          });
        }
      }
      return {
        status: "failed",
        results,
        statuses,
        failedNodeId: nodeId
      };
    }
  }

  return {
    status: "success",
    results,
    statuses
  };
}
