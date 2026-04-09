# Task UCA-009 — Phase 2.5 Security Broker、脱敏与 Presenter Mode

## 1. 任务目标

建立 UCA 的可信边界：黑白名单、脱敏、Kill Switch、Presenter Mode、离线模式与审计。

## 2. 前置依赖

- 上一个任务：UCA-007、UCA-008
- 必须已有的产物：任务状态、confirmation 流、tool 执行入口
- 不能同时修改的区域：Scheduler 正式实现

## 3. 实施范围

- 负责模块：Security Broker、PII 脱敏、Kill Switch、Presenter Mode、audit_log
- 允许改动文件/目录：`src/service/security/`, `src/console/privacy_settings/`, `src/console/first_run_wizard/`
- 明确不做：SSO、企业目录集成

## 4. 交付产物

- Security Broker
- PII 规则
- fail-closed 恢复规则
- Presenter Mode
- 审计查看页

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
- 故障注入：redaction_state_lost
- 手动验证：Kill Switch、Presenter Mode、离线模式

## 6. Git 执行方式

- 分支名：`task/uca-009-phase2-5-security`
- Commit 格式：`UCA-009: implement security broker and privacy controls`
- 合并条件：安全验收项全部过线

## 7. 完成后必须更新本文件

- 写明 redaction_state_lost 的处理路径
- 写明 Presenter Mode 入口与审计字段
- 记录离线模式限制

## 8. 对下一个任务的交接

- 下一个任务：UCA-010、UCA-011、UCA-012、UCA-013
- 本任务新增了什么：统一安全边界与可信运行模式
- 下一个任务直接可复用什么：Security Broker、audit_log、execution gating
- 还没解决的问题：Scheduler 和 Office 仍需对接这些规则

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-009-phase2-5-security`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 `src/service/security/`，完成 Security Broker、blocklist、PII redaction、kill switch、Presenter Mode、audit log helper
  - 将 file / browser / action-tool 三条入口接到 broker 上，统一执行 capture gating 与 redaction
  - 将 tool loop 接到 broker 的 offline / kill switch 授权逻辑
  - 新增隐私相关 console view model：privacy settings、first run wizard、audit log viewer
  - 新增隐私文档 `docs/privacy/` 和回归脚本 `scripts/verify-security-broker.mjs`
- redaction_state_lost 的处理路径：
  - `securityBroker.recoverRedactionStateLost()` 会扫描 `status in ('running','streaming') && redaction_applied=true` 的任务
  - 命中任务统一标记为 `failed`
  - `failure_category = redaction_state_lost`
  - `failure_user_message = 由于程序异常退出，含敏感数据的任务无法恢复，请重新运行原命令`
  - `retryable = false`
  - 同时写入审计事件 `redaction.state_lost`
- Presenter Mode 入口与审计字段：
  - 当前实现入口落在 security broker 的 `togglePresenterMode(actor)`
  - 审计字段包含 `actor`、`previous_state`、`new_state`、`active_screen_share_apps_at_time`
  - UI 入口骨架已预留在 privacy settings / console 视图模型中
- 离线模式限制：
  - `offline_mode=true` 时 broker 会拒绝带 `network` capability 的工具
  - 当前已覆盖 `web_search`、`open_url`、`send_email_smtp` 这类网络相关动作
- 验证结果：
  - `node scripts/verify-structure.mjs`
  - `node scripts/verify-desktop-shell.mjs`
  - `node scripts/verify-service-core.mjs`
  - `node scripts/verify-file-kimi.mjs`
  - `node scripts/verify-browser-extension.mjs`
  - `node scripts/verify-status-metrics.mjs`
  - `node scripts/verify-action-tools.mjs`
  - `node scripts/verify-security-broker.mjs`
- 遗留问题：
  - Security Broker 目前是本地内存态配置，还没有真实持久化配置文件读写
  - audit log 目前仍在 in-memory store，尚未切到独立 SQLite 表
  - Presenter Mode 的自动检测仍是 best-effort monitor 骨架，还没连真实系统探测
  - 数据导出 / 删除仍未实现真正的 zip / wipe 执行动作
- 交接给下一个任务：
  - `UCA-010` 可直接复用 pending approvals、audit log 和 execution gating 做调度审批链路
  - `UCA-011` 可直接复用 Presenter Mode / privacy settings 的状态作为浏览器浮标显示条件
  - `UCA-012`、`UCA-013` 在引入 Office / PDF 新 capture 来源时应默认走 `securityBroker.inspectContext()`
