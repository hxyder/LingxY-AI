const DEFAULT_HISTORY_MAX_TURNS = 20;
const DEFAULT_HISTORY_TURN_CHAR_CAP = 1200;
const DEFAULT_HISTORY_TEXT_CAP = 6000;
const HISTORY_KEEP_HEAD = 2;
const HISTORY_KEEP_TAIL = 8;

export const MEMORY_RECALL_TIMEOUT_MS = 500;
const MEMORY_RECALL_K = 4;
const MEMORY_RECALL_MIN_SCORE = 0.05;
const PARENT_ANSWER_CAP = 1200;
const GENERATED_ARTIFACT_STATUS_RE = /(?:PDF|PPT|Word|Excel|Markdown|md|文档|文件|报告|简报|摘要).{0,24}(?:已生成|生成成功|已保存|保存到|输出到)|(?:已生成|生成成功|已保存|生成一份|生成完整|完整的).{0,32}(?:PDF|PPT|Word|Excel|Markdown|md|文档|文件|报告|简报|摘要)|(?:让我|现在|即将).{0,16}生成.{0,24}(?:PDF|PPT|Word|Excel|Markdown|md|文档|文件)|(?:[A-Za-z]:\\|\/)[^\s，。；;,]+/giu;

function trimText(value = "", maxChars = DEFAULT_HISTORY_TURN_CHAR_CAP) {
  const text = String(value ?? "").replace(/\s+\n/g, "\n").trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

function sanitizeSemanticRecallText(value = "", maxChars = 260) {
  const text = String(value ?? "");
  if (!text.trim()) return "";
  const sanitized = text
    .replace(GENERATED_ARTIFACT_STATUS_RE, "[历史产物信息已省略]")
    .replace(/\s*\[历史产物信息已省略\](?:\s*[，。；;,])?/g, " [历史产物信息已省略] ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return trimText(sanitized, maxChars);
}

function turnLabel(role = "") {
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  return "系统";
}

export function normalizeConversationTurns(turns = [], options = {}) {
  const maxTurns = Math.max(1, Math.min(50, Number(options.maxTurns ?? DEFAULT_HISTORY_MAX_TURNS) || DEFAULT_HISTORY_MAX_TURNS));
  const maxCharsPerTurn = Math.max(80, Math.min(4000, Number(options.maxCharsPerTurn ?? DEFAULT_HISTORY_TURN_CHAR_CAP) || DEFAULT_HISTORY_TURN_CHAR_CAP));
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((turn) => turn?.role === "user" || turn?.role === "assistant" || turn?.role === "system")
    .map((turn) => ({
      role: turn.role,
      content: trimText(turn.content, maxCharsPerTurn)
    }))
    .filter((turn) => turn.content)
    .slice(-maxTurns);
}

export function buildConversationHistoryDigest(turns = [], options = {}) {
  const normalized = normalizeConversationTurns(turns, options);
  if (normalized.length === 0) return "";

  let visibleTurns = normalized;
  if (normalized.length > HISTORY_KEEP_HEAD + HISTORY_KEEP_TAIL) {
    const head = normalized.slice(0, HISTORY_KEEP_HEAD);
    const tail = normalized.slice(-HISTORY_KEEP_TAIL);
    visibleTurns = [
      ...head,
      {
        role: "system",
        content: `…中间省略 ${normalized.length - head.length - tail.length} 轮更早对话（保存在会话历史中）…`
      },
      ...tail
    ];
  }

  const lines = visibleTurns.map((turn) => `${turnLabel(turn.role)}：${turn.content}`);
  const maxChars = Math.max(800, Math.min(12000, Number(options.maxChars ?? DEFAULT_HISTORY_TEXT_CAP) || DEFAULT_HISTORY_TEXT_CAP));
  return trimText(lines.join("\n\n"), maxChars);
}

function extractArtifactPaths(task) {
  const direct = Array.isArray(task?.artifacts) ? task.artifacts : [];
  const paths = direct
    .map((artifact) => String(artifact?.path ?? ""))
    .filter(Boolean);
  if (paths.length > 0) return [...new Set(paths)].slice(0, 6);
  return [];
}

export function seedParentTaskContext({ runtime, parentTaskId, contextPacket }) {
  if (!parentTaskId || !runtime?.store?.getTask) return contextPacket;
  let parentTask;
  let events = [];
  try {
    parentTask = runtime.store.getTask(parentTaskId);
    events = runtime.store.getTaskEvents?.(parentTaskId) ?? [];
  } catch {
    return contextPacket;
  }
  if (!parentTask) return contextPacket;

  const finalEvent = [...events].reverse().find((event) =>
    event.event_type === "success" || event.event_type === "inline_result"
  );
  const answerText = trimText(finalEvent?.payload?.text ?? "", PARENT_ANSWER_CAP);
  const artifactPaths = [
    ...new Set([
      ...events
        .filter((event) => event.event_type === "artifact_created")
        .map((event) => String(event.payload?.path ?? "")),
      ...extractArtifactPaths(parentTask)
    ].filter((value) => value && !value.endsWith("-preview.html") && !value.endsWith("-preview.txt")))
  ].slice(0, 6);

  const parts = [
    `[上一轮任务摘要 · parent=${String(parentTaskId).slice(0, 12)}]`,
    parentTask.user_command ? `用户上一条指令：${trimText(parentTask.user_command, 400)}` : "",
    answerText ? `助手上一条回复（节选）：\n${answerText}` : "",
    artifactPaths.length ? `上一轮生成的文件：\n${artifactPaths.map((filePath) => `- ${filePath}`).join("\n")}` : ""
  ].filter(Boolean);

  if (parts.length === 0) return contextPacket;

  const digest = parts.join("\n\n");
  const mergedText = [digest, contextPacket?.text ?? ""].filter(Boolean).join("\n\n---\n\n").trim();
  return {
    ...contextPacket,
    text: mergedText,
    file_paths: [...new Set([...(contextPacket?.file_paths ?? []), ...artifactPaths])],
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      parent_task_id: parentTaskId,
      parent_artifact_paths: artifactPaths
    }
  };
}

function seedStructuredConversationHistory(contextPacket = {}) {
  const selectionMetadata = contextPacket?.selection_metadata ?? {};
  const turns = normalizeConversationTurns(selectionMetadata.conversation_turns ?? []);
  if (turns.length === 0) return contextPacket;

  const currentText = String(contextPacket?.text ?? "").trim();
  const alreadyInjected = /\[(?:当前对话上下文|对话历史)\]|(?:^|\n)对话历史[:：]/.test(currentText);
  if (alreadyInjected) {
    return {
      ...contextPacket,
      selection_metadata: {
        ...selectionMetadata,
        conversation_turn_count: turns.length
      }
    };
  }

  const historyDigest = buildConversationHistoryDigest(turns, {
    maxTurns: DEFAULT_HISTORY_MAX_TURNS,
    maxCharsPerTurn: DEFAULT_HISTORY_TURN_CHAR_CAP,
    maxChars: DEFAULT_HISTORY_TEXT_CAP
  });
  if (!historyDigest) return contextPacket;

  const mergedText = [
    "[当前对话上下文]",
    historyDigest,
    currentText ? `当前输入/附加上下文：\n${currentText}` : ""
  ].filter(Boolean).join("\n\n---\n\n").trim();

  return {
    ...contextPacket,
    text: mergedText,
    selection_metadata: {
      ...selectionMetadata,
      conversation_turn_count: turns.length,
      conversation_history_injected: true
    }
  };
}

function buildSemanticRecallQuery({ userCommand = "", contextPacket = {} }) {
  const selectionMetadata = contextPacket?.selection_metadata ?? {};
  const turns = normalizeConversationTurns(selectionMetadata.conversation_turns ?? [], {
    maxTurns: 6,
    maxCharsPerTurn: 300
  });
  const parts = [
    trimText(userCommand, 500),
    trimText(contextPacket?.text ?? "", 1000),
    trimText(contextPacket?.url ?? "", 200),
    ...turns.slice(-4).map((turn) => `${turnLabel(turn.role)} ${trimText(turn.content, 240)}`)
  ].filter(Boolean);
  return trimText(parts.join("\n"), 2200);
}

export async function seedSemanticMemories({ runtime, userCommand, parentTaskId, contextPacket, currentTaskId = null }) {
  const store = runtime?.platform?.embeddingStore;
  if (!store?.search) return contextPacket;

  const query = buildSemanticRecallQuery({ userCommand, contextPacket });
  if (!query) return contextPacket;

  let results = [];
  try {
    results = await Promise.race([
      store.search(query, MEMORY_RECALL_K + 4),
      new Promise((resolve) => setTimeout(() => resolve([]), MEMORY_RECALL_TIMEOUT_MS))
    ]);
  } catch {
    return contextPacket;
  }
  if (!Array.isArray(results) || results.length === 0) return contextPacket;

  const excludedIds = new Set([parentTaskId, currentTaskId].filter(Boolean));
  const hits = results
    .filter((result) => result?.id && !excludedIds.has(result.id))
    .filter((result) => (result.score ?? 0) > MEMORY_RECALL_MIN_SCORE)
    .slice(0, MEMORY_RECALL_K);
  if (hits.length === 0) return contextPacket;

  const lines = [
    "[跨任务语义记忆（RAG）]",
    "注意：以下只用于理解主题和用户偏好，不代表本次任务已生成文件；不要复用历史文件路径、历史完成状态或历史 artifact。"
  ];
  for (const hit of hits) {
    const metadata = hit.metadata ?? {};
    const summary = sanitizeSemanticRecallText(metadata.summary ?? hit.text ?? "", 140);
    lines.push(`- ${summary}  (task=${String(hit.id).slice(0, 12)} · score=${(hit.score ?? 0).toFixed(2)})`);
    if (metadata.answer_excerpt) {
      const excerpt = sanitizeSemanticRecallText(metadata.answer_excerpt, 260);
      if (excerpt) lines.push(`  ${excerpt}`);
    }
  }

  const digest = lines.join("\n");
  const mergedText = [digest, contextPacket?.text ?? ""].filter(Boolean).join("\n\n---\n\n").trim();
  return {
    ...contextPacket,
    text: mergedText,
    selection_metadata: {
      ...(contextPacket?.selection_metadata ?? {}),
      semantic_recall_ids: hits.map((hit) => hit.id),
      semantic_recall_scores: hits.map((hit) => Number((hit.score ?? 0).toFixed(3))),
      semantic_recall_query: trimText(query, 320)
    }
  };
}

export async function seedConversationMemoryContext({
  runtime,
  userCommand,
  parentTaskId,
  currentTaskId = null,
  contextPacket
}) {
  const withParentTask = seedParentTaskContext({
    runtime,
    parentTaskId,
    contextPacket
  });
  const withConversationHistory = seedStructuredConversationHistory(withParentTask);
  return seedSemanticMemories({
    runtime,
    userCommand,
    parentTaskId,
    currentTaskId,
    contextPacket: withConversationHistory
  });
}
