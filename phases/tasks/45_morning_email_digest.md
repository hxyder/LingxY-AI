# Task UCA-045 — 早晨启动后 5 分钟内邮件汇总（多账户聚合）

## 1. 任务目标

用户每天早上第一次启动 UCA 时（或早上 8-10 点时段启动），在 **5 分钟以内** 推送一条汇总："你昨天一共收到 N 封邮件，其中 M 封需要回复..."。支持聚合多个邮箱账户。

## 2. 前置依赖

- 上一个任务：UCA-044（email monitoring 基础）、UCA-017（fast executor）、UCA-027（desktop notification）、UCA-049（provider 无关 agentic runtime）
- 必须已有的产物：多账户邮件轮询 + summarizer 能力、schedule engine、notification 链路
- 不能同时修改的区域：desktop shell 启动逻辑主干

## 3. 实施范围

- 负责模块：启动触发器、历史邮件聚合器、每日 digest 生成、"不重复推送" 状态追踪
- 允许改动文件/目录：`src/service/email/digest.mjs`（新建）、`src/service/core/http-server.mjs`（新增 digest check endpoint）、`src/desktop/tray/electron-main.mjs`（加启动信号）、`src/desktop/renderer/console.js`（settings UI 绑定）、`phases/tasks/`
- 明确不做：多天汇总、周报、月报（看将来需求）

## 4. 交付产物

- **启动触发器**：
  - electron-main 在 `app.whenReady()` 后触发 `POST /email/digest/check`
  - service 接到后判断：
    - 当前本地时间是否在 `[06:00, 12:00]` 范围内（可配置）
    - 今天是否已经推送过（`email-digest-state.json`）
    - 是否至少有一个 email 账户启用
  - 通过即触发 digest 生成
- **Digest 生成器** (`email/digest.mjs`)：
  - 拉取昨天 `[yesterday 00:00, today 00:00]` 的所有邮件（跨全部账户）
  - 按 "需要回复" / "提及我" / "通知" 分桶
  - 写入 `email-digest-YYYY-MM-DD.md`，生成通知文案并携带 handoff
- **通知 + 浮窗打开**：
  - 通知弹出 "早晨邮件汇总"
  - 点击 → overlay 打开并加载 digest 作为 context
- **配置项**：Console Settings → Email Accounts：
  - 启用每日汇总
  - 推送时间范围
  - 跳过周末

## 5. 验证方式

- `node scripts/verify-email-morning-digest.mjs`：mock 昨天邮件 + 端到端生成 digest artifact + notification handoff
- 手动：把时间改到早上 8 点左右启动 UCA → 5 分钟内收到通知

## 6. Git 执行方式

- 分支名：`task/uca-045-morning-digest`
- Commit 格式：`UCA-045: add morning email digest`
- 合并条件：早上启动 5 分钟内能看到汇总通知；点击能打开 overlay 继续追问；当天重复启动不会重复推送

## 7. 完成后必须更新本文件

- 触发时间窗口默认值：`06:00` - `12:00`
- 汇总分桶规则：需要回复 / 提及我 / 通知
- 今日推送状态文件：`%APPDATA%/UCA/email-digest-state.json`（runtime dataDir）

## 8. 对下一个任务的交接

- 下一个任务：周报 / 月报 / 项目进度汇总
- 本任务新增了什么：每日启动后 digest 能力
- 下一个任务直接可复用什么：`digest.mjs`、启动触发器
- 还没解决的问题：跨时区用户的 "早上" 定义、远程断网时的延迟推送

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：在 UCA-044 的 email 子系统上增加 digest coordinator，由 service 统一判断时间窗口、账户启用状态和今日推送状态；通知、artifact、overlay handoff 都走现有 runtime 通道。
- 当前代码对齐点：`src/desktop/tray/electron-main.mjs` 已是桌面启动入口，scheduler engine 有 internal tick 能力，artifact store 已能注册结果文件；本任务需要复用 UCA-049 的 `generate_document` 或 fast executor 生成 `digest.md`，并尊重 UCA-048 的 feature flag 与默认输出路径。
- 可能需要生成的文件：`src/service/email/digest.mjs`、`scripts/verify-email-morning-digest.mjs`、每日状态文件（例如 runtime data 目录下 `email-digest-state.json`），并扩展 Console Settings 的 digest toggle。

## 9. 执行记录

- 状态：done
- 执行分支：
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - `src/service/email/digest.mjs`：时间窗口判断、去重状态、digest 生成 + handoff
  - `src/service/core/http-server.mjs`：`/config/email/settings` + `/email/digest/check`
  - `src/desktop/tray/electron-main.mjs`：启动时触发 digest check
  - `src/desktop/renderer/console.js`：digest settings 表单读写
  - `scripts/verify-email-morning-digest.mjs`：验证脚本
- 验证结果：`node scripts/verify-email-morning-digest.mjs`
- 遗留问题（开工前已识别）：
  - 用户需求（2026-04-11）："第二天早上启动应用五分钟以内，总结昨天整体邮件的内容汇总。用户可以连接多个不同的账户，不同服务商的邮箱"
  - 多账户聚合需要按"每个账户单独总结 + 顶部总概览"还是"全账户合并后总结"？倾向前者（用户更清楚哪封来自哪个账户）
- 交接给下一个任务：保留 `email/digest.mjs` 入口即可扩展周报/月报
