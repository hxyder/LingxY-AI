const SURFACES = Object.freeze(["dock", "overlay", "console", "preview", "popup-card", "link-browser", "system"]);

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const text = `${value}`.trim();
  return text.length > 0 ? text : null;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : Date.now();
  return new Date(value).toISOString();
}

function ownerFromPayload(payload = {}) {
  return {
    taskId: cleanString(payload.taskId ?? payload.task_id ?? payload.task?.task_id),
    conversationId: cleanString(payload.conversationId ?? payload.conversation_id ?? payload.task?.conversation_id),
    artifactPath: cleanString(payload.artifactPath ?? payload.artifact_path ?? payload.path),
    approvalId: cleanString(payload.approvalId ?? payload.approval_id),
    source: cleanString(payload.source ?? payload.sourceApp ?? payload.source_app)
  };
}

function snapshotMap(map) {
  return [...map.values()].map((value) => ({ ...value }));
}

export function createWindowSessionState({ now = Date.now } = {}) {
  const windows = new Map();
  const taskOwners = new Map();
  const previewBindings = new Map();
  const popupOwners = new Map();
  const backgroundOwners = new Map();
  const rejectedEvents = [];

  function rememberTaskOwner(owner, surface) {
    if (!owner.taskId) return;
    const previous = taskOwners.get(owner.taskId) ?? {};
    taskOwners.set(owner.taskId, {
      taskId: owner.taskId,
      conversationId: owner.conversationId ?? previous.conversationId ?? null,
      surface: surface ?? previous.surface ?? "system",
      updatedAt: nowIso(now)
    });
  }

  function bindWindow(windowId, owner = {}) {
    const id = cleanString(windowId);
    if (!id) return null;
    const surface = SURFACES.includes(owner.surface) ? owner.surface : id;
    const record = {
      windowId: id,
      surface,
      conversationId: cleanString(owner.conversationId),
      taskId: cleanString(owner.taskId),
      ownerType: cleanString(owner.ownerType) ?? "interactive",
      updatedAt: nowIso(now)
    };
    windows.set(id, record);
    rememberTaskOwner(record, surface);
    return { ...record };
  }

  function bindTaskOwner(taskId, conversationId, options = {}) {
    const taskKey = cleanString(taskId);
    if (!taskKey) return null;
    const record = {
      taskId: taskKey,
      conversationId: cleanString(conversationId),
      surface: cleanString(options.surface) ?? "system",
      ownerType: cleanString(options.ownerType) ?? "interactive",
      updatedAt: nowIso(now)
    };
    taskOwners.set(taskKey, record);
    if (record.ownerType === "background" || record.ownerType === "system") {
      backgroundOwners.set(taskKey, record);
    }
    return { ...record };
  }

  function getTaskOwner(taskId) {
    const taskKey = cleanString(taskId);
    return taskKey ? taskOwners.get(taskKey) ?? null : null;
  }

  function canAcceptTaskEvent({ windowId = null, taskId = null, conversationId = null } = {}) {
    const taskKey = cleanString(taskId);
    const conversationKey = cleanString(conversationId);
    const windowKey = cleanString(windowId);
    if (!taskKey && !conversationKey) return { allowed: true, reason: "unscoped_event" };
    const windowOwner = windowKey ? windows.get(windowKey) : null;
    const taskOwner = taskKey ? taskOwners.get(taskKey) : null;

    if (windowOwner?.taskId && taskKey && windowOwner.taskId !== taskKey) {
      return { allowed: false, reason: "stale_task_for_window", expectedTaskId: windowOwner.taskId, actualTaskId: taskKey };
    }
    const expectedConversation = windowOwner?.conversationId ?? taskOwner?.conversationId ?? null;
    if (expectedConversation && conversationKey && expectedConversation !== conversationKey) {
      return {
        allowed: false,
        reason: "stale_conversation_for_window",
        expectedConversationId: expectedConversation,
        actualConversationId: conversationKey
      };
    }
    return { allowed: true, reason: "owner_match" };
  }

  function reject(kind, payload, decision) {
    const record = {
      kind,
      payload: {
        taskId: cleanString(payload?.taskId ?? payload?.task_id),
        conversationId: cleanString(payload?.conversationId ?? payload?.conversation_id)
      },
      decision,
      rejectedAt: nowIso(now)
    };
    rejectedEvents.push(record);
    if (rejectedEvents.length > 80) rejectedEvents.splice(0, rejectedEvents.length - 80);
    return record;
  }

  function bindPreview(payload = {}) {
    const owner = ownerFromPayload(payload);
    const record = {
      windowId: "preview",
      surface: "preview",
      taskId: owner.taskId,
      conversationId: owner.conversationId,
      artifactPath: owner.artifactPath,
      updatedAt: nowIso(now)
    };
    previewBindings.set("preview", record);
    bindWindow("preview", record);
    rememberTaskOwner(record, "preview");
    return { ...record };
  }

  function acceptPreviewPayload(payload = {}, { bind = false } = {}) {
    const owner = ownerFromPayload(payload);
    const current = previewBindings.get("preview") ?? null;
    if (bind || !current) {
      return { allowed: true, reason: "preview_bound", binding: bindPreview(payload) };
    }
    const decision = canAcceptTaskEvent({
      windowId: "preview",
      taskId: owner.taskId,
      conversationId: owner.conversationId
    });
    if (!decision.allowed) {
      reject("preview_payload", payload, decision);
    }
    return decision.allowed ? { ...decision, binding: { ...current } } : decision;
  }

  function registerPopup(cardId, payload = {}) {
    const id = cleanString(cardId);
    if (!id) return null;
    const owner = ownerFromPayload(payload);
    const record = {
      cardId: id,
      surface: "popup-card",
      kind: cleanString(payload.kind) ?? "info",
      taskId: owner.taskId,
      conversationId: owner.conversationId,
      approvalId: owner.approvalId,
      updatedAt: nowIso(now)
    };
    popupOwners.set(id, record);
    rememberTaskOwner(record, "popup-card");
    return { ...record };
  }

  function unregisterPopup(cardId) {
    const id = cleanString(cardId);
    if (!id) return false;
    return popupOwners.delete(id);
  }

  return {
    bindWindow,
    bindTaskOwner,
    getTaskOwner,
    canAcceptTaskEvent,
    bindPreview,
    acceptPreviewPayload,
    registerPopup,
    unregisterPopup,
    snapshot() {
      return {
        windows: snapshotMap(windows),
        taskOwners: snapshotMap(taskOwners),
        previewBindings: snapshotMap(previewBindings),
        popupOwners: snapshotMap(popupOwners),
        backgroundOwners: snapshotMap(backgroundOwners),
        rejectedEvents: rejectedEvents.map((entry) => ({ ...entry }))
      };
    }
  };
}

export function normalizeWindowSessionOwner(payload = {}) {
  return ownerFromPayload(payload);
}
