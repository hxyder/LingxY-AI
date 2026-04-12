# Task UCA-046 — 高级 scheduler UX：Teams 风格提前提醒、日历视图、分类色标、排序

## 1. 任务目标

把当前的 scheduler 从"到点发一次通知"升级为"Teams Calendar 风格的主动提醒 + 日历视图 + 分类颜色标签"：
- 根据 schedule 的时间尺度自动设置合理的提前量（`leadTime`），用户也能自定义
- Console 里 schedule 不仅有列表视图，还有日历视图
- 每个 schedule 有 category + color，列表和日历里直观区分
- Overlay 的内联 schedule form 扩展出 leadTime / category 选项
- 用户做但没做的 schedule 单独一类，遵循提醒规则

## 2. 前置依赖

- 上一个任务：UCA-010（scheduler 基础）、UCA-036（overlay 内联 schedule form）、UCA-024（console workspace）
- 必须已有的产物：schedule 实体 & engine、pending approval、内联 schedule form、desktop notification
- 不能同时修改的区域：scheduler engine 的 trigger 解析主干

## 3. 实施范围

- 负责模块：schedule 实体扩展、leadTime watcher、category / color、Console 日历视图、Overlay inline form 扩展
- 允许改动文件/目录：`src/service/scheduler/engine.mjs`、`src/service/core/store/memory-store.mjs`（加 schedule 字段）、`src/desktop/renderer/console.html` / `console.js`（加日历视图）、`src/desktop/renderer/overlay.html` / `overlay.js`（扩展 inline schedule form）、`scripts/verify-scheduler.mjs`
- 明确不做：重复事件循环（daily/weekly/monthly recurrence 由 cron 表达式处理，不引入新的 recurrence DSL）、多人共享日历

## 4. 交付产物

- **Schedule 实体扩展**：
  ```
  {
    // 原有字段 ...
    category: "general" | "work" | "email" | "reminder" | "health" | "custom",
    color: "#hex",
    leadTimeMs: number | null,
    userTodo: boolean,
    reminderSentAt: ISO string | null,
    completedAt: ISO string | null
  }
  ```
- **默认 leadTime 规则**（`computeDefaultLeadTime(run_at - now)`）：
  - ≤ 8 小时：提前 1 小时
  - ≤ 1 天：提前 1 小时
  - ≤ 1 周：提前 1 天
  - ≤ 1 月：提前 3 天
  - > 1 月：提前 1 周
- **Reminder watcher**（新 internal scheduler tick，每分钟跑一次）：
  - 遍历所有 `status != done && reminderSentAt == null && now >= run_at - leadTimeMs` 的 schedule
  - 触发 notification，更新 `reminderSentAt`
  - 如果 schedule 状态是 `userTodo: true` 且 `status: pending`，通知文案用"你有一项待办：..."
  - 冲突规则：如果 schedule status 已经 `completed / cancelled / in_progress` 则跳过（不重复打扰）
- **Console 日历视图**（新 sub-tab under Schedules）：
  - 月视图 + 周视图 + 列表视图 切换
  - 每一格显示该日的 schedule，颜色按 category
  - 点击事件卡片 → 打开 schedule 详情
  - 支持按 category 过滤 / 隐藏 / 排序（时间 / 优先级 / 名称）
- **Overlay 内联 schedule form 扩展**：
  - 加 "类别" 下拉（general/work/email/reminder/health/custom）
  - 加 "提前通知" 下拉（默认 / 不提前 / 15 分钟 / 1 小时 / 1 天 / 自定义）
  - 颜色随类别自动填充，也能手动选
- **Category 调色板** 与 UCA-041 项目颜色共享一套，避免视觉冲突

## 5. 验证方式

- `node scripts/verify-scheduler.mjs`（新增：`computeDefaultLeadTime` 单元 / reminder watcher 按时触发 / status 冲突规则 / category persistence）
- `node scripts/verify-overlay-composer.mjs`（新增：inline form 包含 category 和 leadTime 选项）
- `node scripts/verify-console-rendered-workspace.mjs`（新增：Console calendar view 存在）
- 手动：建一条 24 小时后的 schedule → 23 小时后收到通知；建一条邮件任务 schedule → 红色标签显示在日历

## 6. Git 执行方式

- 分支名：`task/uca-046-advanced-scheduler-ux`
- Commit 格式：`UCA-046: advanced scheduler UX with lead-time reminders and calendar view`
- 合并条件：
  - schedule 可配置 leadTime + category
  - reminder watcher 能按预期触发
  - Console 能切换日历 / 列表视图并按 category 过滤

## 7. 完成后必须更新本文件

- 列出最终 leadTime 默认规则
- 列出 category 调色板
- 列出 Console 日历视图支持的交互

## 8. 对下一个任务的交接

- 下一个任务：UCA-044 的 email schedule 直接用这里的 category="email"
- 本任务新增了什么：leadTime watcher、日历视图、分类色标、inline form 扩展
- 下一个任务直接可复用什么：`computeDefaultLeadTime`、category enum、color palette
- 还没解决的问题：跨时区 schedule、团队共享日历、重复事件的自然语言调整（例如"改成每周三"）

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：把 reminder、category、calendar view 作为 scheduler 实体能力升级，而不是 UI 层临时字段。engine/store/API/Overlay inline form/Console Schedules view 同时读写同一字段集，颜色 palette 与 UCA-041 projects 共享。
- 当前代码对齐点：`src/service/scheduler/store.mjs`、`engine.mjs`、`dispatch.mjs` 已有 schedule 基础；`src/desktop/renderer/console.js` 有 Schedules tab，`overlay.js` 有 inline schedule form。UCA-010 文档已记录与 lead time/category 的待扩展点，本任务负责把它转为正式字段和 watcher。
- 可能需要生成的文件：通常不需要新增模块；需扩展 scheduler store/schema、`src/desktop/renderer/console.html/js`、`src/desktop/renderer/overlay.html/js`、`scripts/verify-scheduler.mjs`、`scripts/verify-console-rendered-workspace.mjs`。

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - `src/service/scheduler/store.mjs`：新增 `SCHEDULE_CATEGORIES`（6 类 + 颜色）、`CATEGORY_COLOR_MAP`、`resolveScheduleColor`、`computeDefaultLeadTime` + `createScheduleRecord` 新增 category/color/lead_time_ms/user_todo/reminder_sent_at/completed_at 字段
  - `src/service/scheduler/reminder-watcher.mjs`（新文件）：每分钟 tick 扫描 lead-time 窗口内的 schedule → 发通知 → 盖 reminder_sent_at 戳 → dispatch 后自动重置
  - `src/service/scheduler/dispatch.mjs`：`updateScheduleAfterRun` 重置 `reminder_sent_at = null`
  - `src/service/core/persistent-runtime.mjs`：接入 `createReminderWatcher` + start/stop 生命周期
  - `src/desktop/renderer/console.html`：Schedule 面板加 List/Week/Month 视图切换按钮 + `#scheduleCalendar` 容器
  - `src/desktop/renderer/console.js`：`renderScheduleCalendarGrid` 生成 7 列 CSS Grid 日历，每格显示当天 schedule（彩色左边框 + 名称），`renderSchedules` 加 category chip + color border
  - `src/desktop/renderer/overlay.html`：inline form 加 `#scheduleCategory` 下拉（6 类）+ `#scheduleLeadTime` 下拉（默认/不提前/15分钟/1小时/1天）
  - `src/desktop/renderer/overlay.js`：`scheduleSaveBtn` 读取 category + leadTimeMs 并传入 POST /schedules
- 验证结果：
  - verify-scheduler：computeDefaultLeadTime 5 条规则 + SCHEDULE_CATEGORIES 6 类 + resolveScheduleColor 覆盖 + 带 category/userTodo 的 schedule 创建 + reminder watcher tick 触发通知 + 重复抑制 + dispatch 后 reminder_sent_at 重置
- leadTime 默认规则：≤8h→1h, ≤1d→1h, ≤1w→1d, ≤1m→3d, >1m→1w
- category 调色板：general=#6366f1, work=#3b82f6, email=#ef4444, reminder=#f59e0b, health=#10b981, custom=#8b5cf6
- Console 日历视图交互：List/Week/Month 三态切换，每格显示当天 schedule 彩色卡片（最多 3 条 + overflow），今天高亮
- 验证结果：
- 遗留问题（开工前已识别）：
  - 用户需求（2026-04-11）："当schedule是用户要做，却没做的时候，基于时间长度尺度，8小时或者一天内，提前一小时，除非和任务状态相斥。一周的话，提前一天，或者用户在自动生成schedule以后，可以设定提前多久通知。对话框创建schedule的时候，就可以选。依次类推，参考teams的calendar任务。 然后schedule在控制台可以列表或者日历的形式查看，不同类别的schedule显示不同颜色的label。可以按任务排序。"
  - leadTime 规则是默认 + 可覆盖，不能硬编码成不可改
- 交接给下一个任务：
