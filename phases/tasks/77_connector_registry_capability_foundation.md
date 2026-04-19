# Task UCA-077 — Connector Registry & Capability Foundation

**Status**: todo  
**Priority**: P0  
**Depends on**: UCA-048, UCA-049  
**Branch**: `task/uca-077-connector-foundation`

## 1. 任务目标

为统一账户连接器建立底座：账户注册表、token manager、capability mapper、reauth request 存储，以及 legacy token 迁移策略。

## 2. 前置依赖

- 上一个任务：UCA-048 Settings v2、UCA-049 provider-agnostic agentic runtime
- 必须已有的产物：现有 `src/service/connectors/account-connectors.mjs`、sqlite/memory store、credential-store/keytar fallback、audit log
- 不能同时修改的区域：Action Tool Registry 工具调用主循环、现有 email monitoring 业务逻辑

## 3. 实施范围

- 负责模块：connector core、sqlite/memory store、token 存储与刷新、scope capability 映射
- 允许改动文件/目录：`src/service/connectors/`、`src/service/core/store/`、`scripts/verify-unified-connectors.mjs`、`phases/tasks/`
- 明确不做：UI 重做、统一 Action Tools、provider 写操作、Email Monitoring 迁移

## 4. 交付产物

- **核心类型**：`Provider`、`CapabilityMap`、`ConnectedAccount`、`TokenStatus`、`ReauthRequest`
- **Capability mapper**：
  - `googleScopesToCapabilities(scopes)`
  - `microsoftScopesToCapabilities(scopes)`
  - capability 包含 `emailRead/emailWrite/fileRead/fileWrite/calendarRead/calendarWrite`
- **Account registry**：
  - `listConnectedAccounts(runtime, userId?)`
  - `getConnectedAccount(runtime, accountId)`
  - `upsertConnectedAccount(runtime, account)`
  - `markAccountTokenStatus(runtime, accountId, status)`
  - `setDefaultAccount(runtime, purpose, accountId)`
- **Token manager**：
  - `getValidAccessToken(runtime, accountId)`
  - `refreshTokenIfNeeded(runtime, accountId)`
  - refresh 失败时标记账户 `reauth_required`
- **Store 扩展**：
  - sqlite/memory store 增加 `connected_accounts`、`oauth_tokens`、`reauth_requests`
  - token payload 不写 audit log；若落 sqlite，必须以 credential/encrypted blob 方式处理
- **Legacy 迁移**：
  - 识别旧 `google:tokens` / `microsoft:tokens`
  - 若能拿到 userinfo，自动创建一个 `ConnectedAccount`
  - 若不能刷新，创建 tokenStatus=`reauth_required` 的账户占位或在 UI 提示重连

## 5. 验证方式

- `node scripts/verify-unified-connectors.mjs`
  - mapper 覆盖 Google/Microsoft 读写 scope
  - memory/sqlite account registry CRUD
  - token refresh 成功更新 token，失败标记 `reauth_required`
  - legacy token 迁移不会把 token 写入 audit payload
- `node scripts/verify-runtime-wiring.mjs`

## 6. Git 执行方式

- 分支名：`task/uca-077-connector-foundation`
- Commit 格式：`UCA-077: add connector registry and capability foundation`
- 合并条件：verify 通过，旧 `/connectors/accounts` 状态查询不回归

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写实际新增的 store API 与迁移策略
- 填写验证结果
- 填写遗留问题
- 更新下一任务交接内容

## 8. 对下一个任务的交接

- 下一个任务：UCA-078
- 本任务新增了什么：统一账户注册表、capability mapper、token manager
- 下一个任务直接可复用什么：OAuth callback 可直接调用 `upsertConnectedAccount`
- 还没解决的问题：Connectors UI、canonical account API、Action Tools

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
