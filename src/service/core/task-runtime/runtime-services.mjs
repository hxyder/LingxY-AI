import { createActionToolRegistry } from "../../capabilities/registry/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../action_tools/tools/index.mjs";
import { createMetricsRegistry } from "../../metrics/registry.mjs";
import { createSecurityBroker } from "../../security/broker.mjs";
import { createPendingApprovalService } from "../../scheduler/pending-approvals.mjs";
import { resumeAgentToolApprovalInOriginalTask } from "../../scheduler/approval-graph-resume.mjs";
import { createRuntimeGraphCheckpointService } from "../graph/runtime-graph-checkpoints.mjs";
import { createRuntimeGraphReplayService } from "../graph/runtime-graph-replay.mjs";
import { createRuntimeGraphScheduler } from "../graph/runtime-graph-scheduler.mjs";
import { createArtifactExtractService } from "../artifact-extracts/artifact-extract-service.mjs";
import { createArtifactExtractBackgroundLane } from "../artifact-extracts/artifact-extract-background-lane.mjs";
import { createArtifactLineageService } from "../artifact-lineage/artifact-lineage-service.mjs";
import { createArtifactTransformService } from "../artifact-transforms/artifact-transform-service.mjs";
import { createSessionCompactionService } from "../session/session-compaction-service.mjs";
import { createConversationSessionService } from "../session/conversation-session-service.mjs";
import { createSubAgentRuntimeService } from "../subagents/sub-agent-runtime-contract.mjs";
import { createProjectWorkspaceService } from "../projects/project-workspace-service.mjs";
import { createNetworkOtelExporter } from "../../observability/network-otel-exporter.mjs";

function hasConversationSessionStore(store) {
  return Boolean(
    store
    && typeof store.upsertConversationSession === "function"
    && typeof store.getConversationSession === "function"
    && typeof store.getLatestConversationSession === "function"
    && typeof store.appendSessionItem === "function"
    && typeof store.listSessionItems === "function"
  );
}

function hasSessionCompactionStore(store) {
  return Boolean(
    store
    && typeof store.getConversationSession === "function"
    && typeof store.listSessionItems === "function"
    && typeof store.appendSessionCompaction === "function"
    && typeof store.listSessionCompactions === "function"
    && typeof store.getLatestSessionCompaction === "function"
  );
}

function hasRuntimeGraphCheckpointStore(store) {
  return Boolean(
    store
    && typeof store.appendEvent === "function"
    && typeof store.getTask === "function"
  );
}

function hasRuntimeGraphReplayStore(store) {
  return Boolean(
    store
    && typeof store.getTask === "function"
    && typeof store.getTaskEvents === "function"
  );
}

function hasArtifactExtractStore(store) {
  return Boolean(
    store
    && typeof store.appendArtifactExtract === "function"
    && typeof store.listArtifactExtractsForArtifact === "function"
    && typeof store.listArtifactExtractsForTask === "function"
  );
}

function hasArtifactLineageStore(store) {
  return Boolean(
    store
    && typeof store.getArtifact === "function"
    && typeof store.appendArtifactLineage === "function"
    && typeof store.listArtifactLineageForArtifact === "function"
    && typeof store.listArtifactLineageForTask === "function"
  );
}

function hasArtifactTransformStore(store) {
  return Boolean(
    store
    && typeof store.getTask === "function"
    && typeof store.getArtifact === "function"
    && typeof store.appendArtifact === "function"
    && typeof store.listArtifactExtractsForArtifact === "function"
  );
}

export function ensureRuntimeServices(runtime) {
  runtime.activeExecutions ??= new Map();
  // UCA-077 P4-04.5: registry must be a singleton on the runtime so that
  // tool_using / agentic / fast all see the same set of tools (including
  // any registered MCP / plugin tools) AND share the per-task rate-limit
  // counters bound to runtime.perTaskToolCallCounts. Service-bootstrap
  // populates this in production; this fallback covers test harnesses
  // and other narrow runtimes that bypass full bootstrap.
  runtime.actionToolRegistry ??= createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  runtime.metrics ??= createMetricsRegistry({
    store: runtime.store,
    queue: runtime.queue
  });
  runtime.networkOtelExporter ??= createNetworkOtelExporter({
    runtime,
    configStore: runtime.configStore ?? null,
    store: runtime.store ?? null
  });
  runtime.projectWorkspaces ??= createProjectWorkspaceService({
    store: runtime.store,
    configStore: runtime.configStore ?? null
  });
  if (!runtime.conversationSessions && hasConversationSessionStore(runtime.store)) {
    runtime.conversationSessions = createConversationSessionService({
      store: runtime.store,
      metrics: runtime.metrics
    });
  }
  if (!runtime.sessionCompactions && hasSessionCompactionStore(runtime.store)) {
    runtime.sessionCompactions = createSessionCompactionService({
      store: runtime.store,
      metrics: runtime.metrics
    });
  }
  if (!runtime.runtimeGraph && hasRuntimeGraphCheckpointStore(runtime.store)) {
    runtime.runtimeGraph = createRuntimeGraphCheckpointService({
      store: runtime.store,
      eventBus: runtime.eventBus,
      metrics: runtime.metrics
    });
  }
  if (!runtime.runtimeGraphReplay && hasRuntimeGraphReplayStore(runtime.store)) {
    runtime.runtimeGraphReplay = createRuntimeGraphReplayService({
      store: runtime.store
    });
  }
  runtime.runtimeGraphScheduler ??= createRuntimeGraphScheduler({
    metrics: runtime.metrics
  });
  runtime.subAgentRuntime ??= createSubAgentRuntimeService({ runtime });
  if (!runtime.artifactExtracts && hasArtifactExtractStore(runtime.store)) {
    runtime.artifactExtracts = createArtifactExtractService({
      store: runtime.store,
      metrics: runtime.metrics
    });
  }
  if (!runtime.artifactExtractBackgroundLane && runtime.artifactExtracts) {
    runtime.artifactExtractBackgroundLane = createArtifactExtractBackgroundLane({
      artifactExtracts: runtime.artifactExtracts,
      metrics: runtime.metrics
    });
  }
  if (!runtime.artifactLineage && hasArtifactLineageStore(runtime.store)) {
    runtime.artifactLineage = createArtifactLineageService({
      store: runtime.store,
      metrics: runtime.metrics
    });
  }
  if (!runtime.artifactTransforms
    && hasArtifactTransformStore(runtime.store)
    && runtime.actionToolRegistry
    && runtime.artifactLineage) {
    runtime.artifactTransforms = createArtifactTransformService({
      store: runtime.store,
      actionToolRegistry: runtime.actionToolRegistry,
      artifactLineage: runtime.artifactLineage,
      conversationSessions: runtime.conversationSessions ?? null,
      metrics: runtime.metrics
    });
  }
  runtime.securityBroker ??= createSecurityBroker({ runtime });
  // UCA-182 Phase 20: wire executeApprovedAction so approving a
  // source_type="agent_tool_call" record actually runs the tool the
  // agent had proposed. Previously the hook was unset, so users
  // could approve an "account_send_email" card all day and nothing
  // happened. Keeps other source_types (schedule / manual) as they
  // were — only agent_tool_call is newly handled here.
  runtime.pendingApprovals ??= createPendingApprovalService({
    runtime,
    executeApprovedAction: async (approval, { overrides = null, actor = null, decidedAt = null } = {}) => {
      if (approval.source_type !== "agent_tool_call") return null;
      return resumeAgentToolApprovalInOriginalTask({
        runtime,
        approval,
        overrides,
        actor,
        decidedAt
      });
    }
  });
  return runtime;
}
