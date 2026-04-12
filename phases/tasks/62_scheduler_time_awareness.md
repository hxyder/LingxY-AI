# UCA-062 — Scheduler 时间感知修复

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-046, UCA-010  
**Branch**: `task/uca-062-scheduler-time-awareness`

## 目标

1. 解析相对时间（"下午三点"、"明天早上"）时结合系统当前时间和时区计算绝对时间戳
2. 创建 schedule 后在对话框里显示确认消息（时间、内容、距现在多久）
3. Console 的 scheduler 视图在创建后自动刷新

## 问题根因

实测："帮我提醒一下，今天下午三点开会" → 显示"生成了 schedule"，但控制台没看到，且没有告知当前时间。

- 时间解析没有 anchor 到 `Date.now()`，"下午三点"在不同时区可能计算错误
- Schedule 创建成功后没有向对话流 emit 确认消息
- Console scheduler 视图没有订阅 `schedule_created` 事件，不自动刷新

## 关键修改

### `src/service/scheduler/reminder-watcher.mjs` 或对应调度解析模块

```js
import { parseRelativeTime } from "../utils/time-parser.mjs";

// parseRelativeTime 接受用户文本 + 当前时间戳，返回绝对 ISO 时间
// "下午三点" + now=2026-04-11T09:15:00+08:00 → 2026-04-11T15:00:00+08:00
// "明天早上九点" → 2026-04-12T09:00:00+08:00
```

### 新建 `src/service/utils/time-parser.mjs`

```js
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone; // 系统时区

export function parseRelativeTime(text, now = new Date()) {
  // 时段词 → 小时
  const PERIOD_MAP = { 早上: 8, 上午: 9, 中午: 12, 下午: 14, 晚上: 19, 凌晨: 1 };
  // "下午三点" → 15:00
  const hourMatch = text.match(/(早上|上午|中午|下午|晚上|凌晨)?(\d{1,2})点(半)?/);
  if (hourMatch) {
    let hour = parseInt(hourMatch[2]);
    const period = hourMatch[1];
    const half = !!hourMatch[3];
    if (period && PERIOD_MAP[period]) {
      hour = (PERIOD_MAP[period] < 12 && hour < 12) ? PERIOD_MAP[period] + (hour - 8) : hour + 12;
      if (hour > 23) hour = 23;
    } else if (hour < 12 && /下午|晚上/.test(text)) {
      hour += 12;
    }
    const date = new Date(now);
    if (/明天|tomorrow/i.test(text)) date.setDate(date.getDate() + 1);
    date.setHours(hour, half ? 30 : 0, 0, 0);
    return { ts: date.toISOString(), display: formatRelativeDuration(date, now) };
  }
  return null;
}

function formatRelativeDuration(target, now) {
  const diffMs = target - now;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} 分钟后`;
  const diffH = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return remMin > 0 ? `${diffH} 小时 ${remMin} 分钟后` : `${diffH} 小时后`;
}
```

### 创建 schedule 后 emit 确认消息

```js
// 在 schedule 创建成功后：
runtime.eventBus.publish({
  event_type: "conversation_reply",
  task_id: taskId,
  text: `已设置提醒 ✓\n📅 ${scheduledTimeDisplay}（${relativeDisplay}）\n📝 ${reminderContent}`,
  reply_type: "schedule_confirmed"
});
```

### `src/desktop/renderer/overlay.js`

- 订阅 `schedule_confirmed` 事件，在对话框里显示确认气泡
- 气泡包含：时间、内容、距现在多久、"在 Console 查看全部提醒"链接

### `src/desktop/renderer/console.js`

- Scheduler tab 订阅 `schedule_created` / `schedule_updated` 事件，自动刷新列表，不需要用户手动刷页

## 用户体验效果

```
用户：帮我提醒一下，今天下午三点开会

AI：已设置提醒 ✓
    📅 今天 15:00（5 小时 45 分钟后）
    📝 开会
    [在 Console 查看全部提醒 →]
```

## 验证

- "今天下午三点开会" → 解析为当日 15:00:00，时区正确
- "明天早上九点叫我起床" → 解析为次日 09:00:00
- 创建后对话框显示确认消息，包含绝对时间和相对时长
- Console scheduler 列表自动更新（无需刷新）
- 时间已过时（"帮我提醒昨天下午三点"）→ 返回错误提示，不创建
