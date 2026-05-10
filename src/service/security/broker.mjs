import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBlocklist } from "./rules/blocklist.mjs";
import { redactText, unredactText } from "./rules/pii_redaction.mjs";
import { createKillSwitchController } from "./kill-switch.mjs";
import { createScreenShareMonitor } from "./screen-share-monitor.mjs";
import { appendAuditLog } from "./audit-log.mjs";
import { evaluatePrivacySandboxToolPolicy } from "../../shared/privacy-sandbox-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cloneDefaults() {
  return JSON.parse(readFileSync(path.join(__dirname, "rules", "defaults.json"), "utf8"));
}

function deepMerge(base, patch) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function redactContextFields(contextPacket, securityConfig) {
  const combinedMap = {};
  const applied = [];
  const packet = {
    ...contextPacket,
    selection_metadata: contextPacket.selection_metadata ? { ...contextPacket.selection_metadata } : undefined
  };

  const applyTextRedaction = (value) => {
    const result = redactText(value, securityConfig.field_redaction?.enabled_rules);
    Object.assign(combinedMap, result.map);
    applied.push(...result.applied);
    return result.redactedText;
  };

  packet.text = applyTextRedaction(packet.text ?? "");
  if (packet.html) {
    packet.html = applyTextRedaction(packet.html);
  }
  if (packet.url) {
    packet.url = applyTextRedaction(packet.url);
  }

  if (packet.selection_metadata) {
    for (const [key, value] of Object.entries(packet.selection_metadata)) {
      if (typeof value === "string") {
        packet.selection_metadata[key] = applyTextRedaction(value);
      }
    }
  }

  packet.redaction_applied = applied.length > 0;

  return {
    contextPacket: packet,
    redactionMap: combinedMap,
    applied
  };
}

export function createSecurityBroker({ runtime, config = {} }) {
  const securityConfig = deepMerge(cloneDefaults(), config);
  const redactionMaps = new Map();
  const killSwitch = createKillSwitchController(securityConfig.global_kill_switch);
  const screenShareMonitor = createScreenShareMonitor({
    active: securityConfig.presenter_mode,
    sources: []
  });

  return {
    getConfig() {
      return {
        ...securityConfig,
        global_kill_switch: killSwitch.isEnabled(),
        presenter_mode: screenShareMonitor.snapshot().active
      };
    },
    setConfig(patch) {
      const merged = deepMerge(this.getConfig(), patch);
      Object.assign(securityConfig, merged);
      killSwitch.setEnabled(merged.global_kill_switch);
      if ("presenter_mode" in patch) {
        screenShareMonitor.setState({
          active: Boolean(merged.presenter_mode),
          sources: screenShareMonitor.snapshot().sources
        });
      }
      return this.getConfig();
    },
    inspectContext(contextPacket, { taskId = null, trigger = "capture" } = {}) {
      if (killSwitch.isEnabled()) {
        appendAuditLog(runtime, "kill_switch.toggle", {
          blocked: true,
          trigger
        }, taskId);
        return {
          allowed: false,
          reason: "kill_switch_enabled"
        };
      }

      if (screenShareMonitor.snapshot().active) {
        appendAuditLog(runtime, "presenter_mode.toggle", {
          blocked: true,
          trigger,
          active_screen_share_apps_at_time: screenShareMonitor.snapshot().sources
        }, taskId);
        return {
          allowed: false,
          reason: "presenter_mode_active"
        };
      }

      const blockDecision = evaluateBlocklist(contextPacket, securityConfig);
      if (blockDecision.blocked) {
        appendAuditLog(runtime, "llm.call", {
          blocked: true,
          reason: blockDecision.reason,
          source_type: contextPacket.source_type
        }, taskId);
        return {
          allowed: false,
          reason: blockDecision.reason
        };
      }

      const redacted = redactContextFields(contextPacket, securityConfig);
      appendAuditLog(runtime, redacted.applied.length > 0 ? "redaction.applied" : "llm.call", {
        source_type: contextPacket.source_type,
        redactions_applied: redacted.applied,
        size_bytes: JSON.stringify(redacted.contextPacket).length
      }, taskId);

      return {
        allowed: true,
        contextPacket: redacted.contextPacket,
        redactionMap: redacted.redactionMap,
        redactionsApplied: redacted.applied
      };
    },
    registerTaskRedactionMap(taskId, map) {
      if (map && Object.keys(map).length > 0) {
        redactionMaps.set(taskId, map);
      }
    },
    clearTaskRedactionMap(taskId) {
      redactionMaps.delete(taskId);
    },
    unredactTaskText(taskId, text) {
      return unredactText(text, redactionMaps.get(taskId) ?? {});
    },
    authorizeToolCall(tool, args) {
      if (killSwitch.isEnabled()) {
        return {
          allowed: false,
          reason: "kill_switch_enabled"
        };
      }

      const privacyDecision = evaluatePrivacySandboxToolPolicy({
        config: this.getConfig(),
        tool
      });
      if (!privacyDecision.allowed) {
        return privacyDecision;
      }

      return {
        allowed: true,
        reason: null
      };
    },
    togglePresenterMode(actor = "user") {
      const previous = screenShareMonitor.snapshot();
      const next = screenShareMonitor.setState({
        active: !previous.active,
        sources: previous.sources
      });
      appendAuditLog(runtime, "presenter_mode.toggle", {
        actor,
        previous_state: previous.active,
        new_state: next.active,
        active_screen_share_apps_at_time: next.sources
      });
      return next;
    },
    setScreenShareState(nextState) {
      return screenShareMonitor.setState(nextState);
    },
    recoverRedactionStateLost() {
      const affectedTasks = runtime.store.listTasks().filter((task) =>
        ["running", "streaming"].includes(task.status) && task.context_packet?.redaction_applied === true
      );

      for (const task of affectedTasks) {
        task.status = "failed";
        task.sub_status = "redaction_state_lost";
        task.failure_category = "redaction_state_lost";
        task.failure_user_message = "由于程序异常退出，含敏感数据的任务无法恢复，请重新运行原命令";
        task.retryable = false;
        runtime.store.updateTask(task.task_id, task);
        appendAuditLog(runtime, "redaction.state_lost", {
          task_id: task.task_id
        }, task.task_id);
      }

      return affectedTasks;
    }
  };
}
