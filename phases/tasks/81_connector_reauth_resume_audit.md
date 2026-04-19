# Task UCA-081 — Reauth, Resume & Audit Hardening

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-080  
**Branch**: `task/uca-081-connector-reauth-audit`

## 1. 任务目标

让权限不足、token refresh 失败和 provider 403 都变成可恢复的补授权流程，并把连接器工具调用纳入现有审计体系。

## 2. 前置依赖

- 上一个任务：UCA-080
- 必须已有的产物：reauth_requests store、统一读写工具、Connectors UI、audit log
- 不能同时修改的区域：provider adapter 业务实现大改、Email Monitoring 迁移

## 3. 实施范围

- 负责模块：reauth manager、missing scope 推断、补授权入口、任务恢复、audit payload 清洗
- 允许改动文件/目录：`src/service/connectors/`、`src/service/core/http-server.mjs`、`src/desktop/renderer/console.js`、`src/service/security/`、`scripts/verify-unified-connectors.mjs`
- 明确不做：新的审计表、跨设备授权同步、批量 reauth 管理

## 4. 交付产物

- **Reauth manager**：
  - `buildReauthRequired(account, requiredCapability, originalToolCall?)`
  - `inferMissingScopes(provider, requiredCapability, currentScopes)`
  - `createReauthRequest(runtime, payload)`
  - `completeReauthRequest(runtime, requestId, accountId)`
- **补授权 API/UI**：
  - `POST /connectors/connected-accounts/:accountId/reauth/start`
  - UI 显示 missing capabilities/scopes 和重新授权按钮
  - OAuth state 带 reauthRequestId
- **恢复执行**：
  - `reauth_required` 可保存原始 toolId/args/taskId
  - 授权完成后返回可恢复状态
  - 恢复写操作仍重新走 confirmation，不自动越过风险策略
- **Audit hardening**：
  - 记录 connector tool call、accountId、provider、status、errorCode
  - token、Authorization header、raw refresh response 必须清洗
  - refresh 失败写 `connector.token_refresh_failed`

## 5. 验证方式

- `node scripts/verify-unified-connectors.mjs`
  - 缺写 scope 返回 missing scope
  - 创建 reauth request
  - OAuth callback 完成 request 并更新 capability
  - 恢复写工具仍 requires confirmation
  - audit payload 不包含 access_token/refresh_token/Authorization
- `node scripts/verify-security-broker.mjs`
- `node scripts/verify-action-tools.mjs`

## 6. Git 执行方式

- 分支名：`task/uca-081-connector-reauth-audit`
- Commit 格式：`UCA-081: add connector reauth resume and audit hardening`
- 合并条件：reauth_required 不再裸 403，audit redaction 验证通过

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写 missing scope 映射表
- 填写恢复执行语义
- 填写 audit 清洗验证
- 更新下一任务交接内容

## 8. 对下一个任务的交接

- 下一个任务：UCA-082
- 本任务新增了什么：稳定补授权和安全审计闭环
- 下一个任务直接可复用什么：OAuth Gmail/Outlook 账户可安全用于 email monitor/digest
- 还没解决的问题：Email 子系统 legacy IMAP 与 OAuth 账户合并

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
