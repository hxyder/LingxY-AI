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

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
