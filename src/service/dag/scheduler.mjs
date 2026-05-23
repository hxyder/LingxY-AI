import crypto from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function createExecutionId() {
  return `dag_${crypto.randomUUID()}`;
}

function buildExecutionSnapshot({
  executionId,
  graph,
  status,
  results,
  statuses,
  failedNodeId = null
}) {
  return {
    execution_id: executionId,
    graph: clone(graph),
    status,
    results: clone(results),
    statuses: clone(statuses),
    failedNodeId,
    updated_at: new Date().toISOString()
  };
}

export function createDagCheckpointStore({
  runsDir = null
} = {}) {
  if (runsDir) {
    mkdirSync(runsDir, { recursive: true });
  }

  function getRunPath(executionId) {
    if (!runsDir) {
      return null;
    }
    return path.join(runsDir, `${executionId}.json`);
  }

  const memory = new Map();

  return {
    save(snapshot) {
      const stored = clone(snapshot);
      memory.set(stored.execution_id, stored);
      const filePath = getRunPath(stored.execution_id);
      if (filePath) {
        writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
      }
      return clone(stored);
    },
    get(executionId) {
      if (memory.has(executionId)) {
        return clone(memory.get(executionId));
      }
      const filePath = getRunPath(executionId);
      if (!filePath || !existsSync(filePath)) {
        return null;
      }
      const snapshot = JSON.parse(readFileSync(filePath, "utf8"));
      memory.set(executionId, snapshot);
      return clone(snapshot);
    },
    list() {
      if (!runsDir) {
        return [...memory.values()].map((entry) => clone(entry));
      }

      const snapshots = [];
      for (const entry of readdirSync(runsDir)) {
        if (!entry.endsWith(".json")) {
          continue;
        }
        const snapshot = JSON.parse(readFileSync(path.join(runsDir, entry), "utf8"));
        memory.set(snapshot.execution_id, snapshot);
        snapshots.push(snapshot);
      }
      return snapshots
        .map((entry) => clone(entry))
        .sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""));
    }
  };
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
  onNodeEvent = () => {},
  checkpointStore = null,
  executionId = createExecutionId(),
  resumeExecution = null
}) {
  const validation = validateDagDefinition(graph);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const order = topoSort(graph.nodes, graph.edges);
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const results = clone(resumeExecution?.results ?? {});
  const statuses = clone(resumeExecution?.statuses ?? {});

  function persist(status, failedNodeId = null) {
    if (!checkpointStore) {
      return null;
    }
    return checkpointStore.save(buildExecutionSnapshot({
      executionId,
      graph,
      status,
      results,
      statuses,
      failedNodeId
    }));
  }

  persist("running");

  for (const nodeId of order) {
    if (statuses[nodeId] === "success") {
      continue;
    }

    const node = nodeMap.get(nodeId);
    statuses[nodeId] = "running";
    persist("running");
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
      persist("running");
      onNodeEvent({
        nodeId,
        status: "success",
        result
      });
    } catch (error) {
      statuses[nodeId] = "failed";
      persist("failed", nodeId);
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
      return buildExecutionSnapshot({
        executionId,
        graph,
        status: "failed",
        results,
        statuses,
        failedNodeId: nodeId
      });
    }
  }

  const snapshot = buildExecutionSnapshot({
    executionId,
    graph,
    status: "success",
    results,
    statuses
  });
  checkpointStore?.save(snapshot);
  return snapshot;
}

export async function resumeDagGraph({
  checkpointStore,
  executionId,
  executeNode,
  onNodeEvent = () => {}
}) {
  const snapshot = checkpointStore?.get(executionId);
  if (!snapshot) {
    throw new Error("dag_execution_not_found");
  }

  return runDagGraph({
    graph: snapshot.graph,
    executeNode,
    onNodeEvent,
    checkpointStore,
    executionId,
    resumeExecution: snapshot
  });
}
