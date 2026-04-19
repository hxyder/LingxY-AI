# Task UCA-082 — Email Monitoring/Digest Connector Migration

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-044, UCA-045, UCA-081  
**Branch**: `task/uca-082-email-connector-migration`

## 1. 任务目标

把 Gmail/Outlook 邮件监测和晨间摘要迁移到统一账户连接器，避免 OAuth connector 与 email accounts 两套账户模型并存。

## 2. 前置依赖

- 上一个任务：UCA-044、UCA-045、UCA-081
- 必须已有的产物：Email Monitoring、Morning Digest、统一 connected account registry、read email tool/provider adapter
- 不能同时修改的区域：IMAP polling 细节、scheduler engine 主干

## 3. 实施范围

- 负责模块：`src/service/email/` 账户来源、Graph/Gmail 客户端、digest 聚合、去重策略
- 允许改动文件/目录：`src/service/email/`、`src/service/connectors/`、`src/service/core/http-server.mjs`、`src/desktop/renderer/console.js`、`scripts/verify-email-monitoring.mjs`、`scripts/verify-email-morning-digest.mjs`
- 明确不做：完全移除 IMAP/app password 账户、邮件富文本渲染、附件深度处理

## 4. 交付产物

- **账户来源合并**：
  - Gmail/Outlook OAuth 账户从 `connected_accounts` 读取
  - IMAP/app password 账户作为 legacy provider 保留在 `email.accounts`
  - Email Settings UI 区分 “OAuth connected accounts” 与 “Legacy IMAP accounts”
- **Email monitor 迁移**：
  - Gmail/Outlook 使用 connector token manager 和 provider adapter
  - IMAP 账户继续使用现有 IMAP client
  - pollAllAccounts 按 accountId/provider 去重，避免同邮箱重复监测
- **Morning Digest 迁移**：
  - digest 聚合 OAuth connected accounts + legacy IMAP accounts
  - digest 中标注来源账户 email/provider
  - OAuth token refresh 失败时跳过该账户并写 audit，不阻断其他账户
- **线程追踪**：
  - thread tracker 存储 accountId
  - Outlook/Gmail provider-specific sent-thread 检测放在 adapter 层

## 5. 验证方式

- `node scripts/verify-email-monitoring.mjs`
  - legacy IMAP mock 仍通过
  - OAuth Gmail/Outlook mock 账户可参与 poll
  - 同 email 同 provider 不重复生成 schedule
- `node scripts/verify-email-morning-digest.mjs`
  - digest 包含 OAuth + legacy 多账户
  - 一个 OAuth 账户 refresh 失败不影响其他账户摘要
- `node scripts/verify-unified-connectors.mjs`

## 6. Git 执行方式

- 分支名：`task/uca-082-email-connector-migration`
- Commit 格式：`UCA-082: migrate email monitoring to unified connectors`
- 合并条件：Email Monitoring 和 Morning Digest 的既有验证仍通过，OAuth mock 路径新增覆盖

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写账户来源合并规则
- 填写 legacy IMAP 保留范围
- 填写 digest 去重策略
- 更新后续 provider 扩展交接

## 8. 对下一个任务的交接

- 下一个任务：未来 Dropbox/Notion/Slack provider 扩展
- 本任务新增了什么：email 子系统对统一 connector registry 的依赖
- 下一个任务直接可复用什么：多 provider accountId/capability/token 路由
- 还没解决的问题：非邮件 provider 的后台监测、附件 provider 统一索引

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
