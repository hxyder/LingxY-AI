import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveScheduleTitle,
  isPromptLikeTitle,
  normalizeScheduleRecordTitle
} from "../../src/service/core/policy/scheduled-work-policy.mjs";
import { applySideEffectContractToDecisionArgs } from "../../src/service/executors/tool_using/side-effect-gate.mjs";

const emailContract = {
  version: 1,
  kind: "side_effect_contract",
  groups: {
    email_send: {
      slots: {
        to: {
          entity: "email_address",
          values: ["hanxy308@163.com", "sophieliang1998@gmail.com"],
          mode: "preserve"
        }
      }
    }
  }
};

test("schedule title policy derives a normal title instead of copying a weather prompt", () => {
  const result = deriveScheduleTitle({
    name: "",
    trigger: { type: "cron", expression: "0 9 * * *" },
    action: {
      type: "task",
      target: "发送Raleigh天气邮件",
      params: {
        userCommand: "现在获取Raleigh,NC的当天天气预报，然后通过Google账号发送邮件，主题为'Raleigh, NC 今日天气简报'，请使用 fetch_url_content 从 https://wttr.in/Raleigh,NC?format=j1 获取天气数据。"
      }
    },
    metadata: { side_effect_contract: emailContract }
  });

  assert.equal(result.title, "每日天气邮件");
  assert.equal(result.audit.selected_source, "derived.weather_email");
  assert.equal(isPromptLikeTitle(result.title), false);
});

test("legacy prompt-like schedule names are normalized when records are read", () => {
  const schedule = {
    schedule_id: "sched_market",
    name: "Scheduled:整理今天新闻后发送邮件到 hanxy308@163.com和sophieliang1998@gmail.com",
    description: "原始指令：5 分钟后给我发美股汇总到 hanxy308@163.com",
    category: "email",
    trigger_type: "cron",
    trigger_config: { expression: "0 9 * * *" },
    action_type: "task",
    action_target: "收集美股市场最新汇总信息并发送邮件",
    action_params: {
      userCommand: "收集美股市场最新汇总信息（包括主要股指表现、涨跌板块、重要新闻等），整理后发送邮件到 hanxy308@163.com和sophieliang1998@gmail.com"
    },
    metadata: { side_effect_contract: emailContract }
  };

  const normalized = normalizeScheduleRecordTitle(schedule);
  assert.equal(normalized.changed, true);
  assert.equal(normalized.schedule.name, "每日美股简报邮件");
  assert.equal(normalized.schedule.metadata.naming_audit.previous_name, schedule.name);
});

test("scheduled email args normalize recipients and prompt-like subject before approval/send", () => {
  const task = {
    user_command: "收集美股市场最新汇总信息（包括主要股指表现、涨跌板块、重要新闻等），整理后发送邮件到 hanxy308@163.com和sophieliang1998@gmail.com",
    context_packet: {
      selection_metadata: {
        scheduled_task_fire: true,
        schedule_name: "每日美股简报邮件",
        schedule_action_target: "收集美股市场最新汇总信息并发送邮件",
        side_effect_contract: emailContract
      }
    }
  };
  const args = applySideEffectContractToDecisionArgs({
    decision: {
      type: "tool_call",
      tool: "account_send_email",
      args: {
        to: "hanxy308@163.com和sophieliang1998@gmail.com",
        subject: "收集美股市场最新汇总信息（包括主要股指表现、涨跌板块、重要新闻等），整理后发送邮件到 hanxy308@163.com和sophieliang1998@gmail.com",
        body: [
          "**Subject:** 美股市场简报",
          "",
          "**收件人:** hanxy308@163.com",
          "",
          "### 一、主要股指表现",
          "- **道琼斯：** 上涨0.6%",
          "",
          "[您的助手]"
        ].join("\n")
      }
    },
    tool: { id: "account_send_email" },
    task,
    runtime: null
  });

  assert.deepEqual(args.to, ["hanxy308@163.com", "sophieliang1998@gmail.com"]);
  assert.equal(args.subject, "美股市场简报");
  assert.doesNotMatch(args.body, /Subject|收件人|\*\*|###|\[您的助手\]/u);
  assert.match(args.body, /一、主要股指表现/u);
  assert.match(args.body, /道琼斯： 上涨0\.6%/u);
  assert.match(args.body, /LingxY/u);
});

test("connector workflow email input uses the same scheduled shape contract", () => {
  const task = {
    user_command: "发送天气邮件",
    context_packet: {
      selection_metadata: {
        scheduled_task_fire: true,
        schedule_name: "每日天气邮件",
        schedule_action_target: "发送Raleigh天气邮件",
        side_effect_contract: emailContract
      }
    }
  };
  const args = applySideEffectContractToDecisionArgs({
    decision: {
      type: "tool_call",
      tool: "connector_workflow_run",
      args: {
        workflowId: "google.gmail.draft_confirm_send",
        input: {
          to: ["hanxy308@163.com和sophieliang1998@gmail.com"],
          subject: "请使用 fetch_url_content 获取天气并发送邮件到 hanxy308@163.com",
          body: "天气简报正文"
        }
      }
    },
    tool: { id: "connector_workflow_run" },
    task,
    runtime: null
  });

  assert.deepEqual(args.input.to, ["hanxy308@163.com", "sophieliang1998@gmail.com"]);
  assert.equal(args.input.subject, "今日天气简报");
});
