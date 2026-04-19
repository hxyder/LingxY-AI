# Task UCA-078 — Multi-Account OAuth & Connectors UI

**Status**: done
**Priority**: P0  
**Depends on**: UCA-077  
**Branch**: `task/uca-078-multi-account-oauth-ui`

## 1. 任务目标

把现有 provider 级 OAuth 流升级为 accountId 级多账户连接，并让 Connectors Tab 展示真实账户、能力、默认用途和重授权入口。

## 2. 前置依赖

- 上一个任务：UCA-077
- 必须已有的产物：account registry、capability mapper、token manager、现有 Connectors Tab
- 不能同时修改的区域：Email Monitoring 账户管理、Action Tool 工具集

## 3. 实施范围

- 负责模块：OAuth callback 落库、canonical connected account API、Connectors UI
- 允许改动文件/目录：`src/service/connectors/`、`src/service/core/http-server.mjs`、`src/desktop/renderer/console.js`、`src/desktop/renderer/console.html`、`phases/tasks/`
- 明确不做：统一读写 Action Tools、补授权恢复执行、Email Monitoring 迁移

## 4. 交付产物

- **OAuth 多账户落库**：
  - `/auth/callback` 交换 token 后拉取 provider userinfo
  - 基于 provider + providerAccountId upsert `ConnectedAccount`
  - scopes 映射到 capabilities
  - token 按 accountId 保存
- **Canonical API**：
  - `GET /connectors/connected-accounts`
  - `PATCH /connectors/connected-accounts/:accountId/defaults`
  - `DELETE /connectors/connected-accounts/:accountId`
  - `POST /connectors/connected-accounts/:accountId/reauth/start` 预留给 UCA-081
- **兼容旧 API**：
  - 保留 `GET /connectors/accounts`
  - 保留 `/connectors/accounts/:type/files|emails|calendar` 预览接口一轮
  - 旧接口内部可读取 registry 中 provider 默认账户，避免打断当前 UI
- **Connectors Tab UI**：
  - 账户列表显示 provider、email、displayName、capability 标签、tokenStatus
  - email/files/calendar 默认用途设置
  - 重新授权按钮、断开按钮
  - 配置 Client ID/Secret 的 provider card 保留在“添加账户”区域

## 5. 验证方式

- `node scripts/verify-unified-connectors.mjs`
  - mock OAuth callback 可创建两个同 provider 账户
  - 默认用途只能在同 purpose 下唯一
  - 删除账户会删除 token
- `node scripts/verify-console-ui.mjs` 或相关 console 验证脚本
- 手动：在 Connectors Tab 中能看到 account-level list，而不是只有 Google/Microsoft 两张 provider card

## 6. Git 执行方式

- 分支名：`task/uca-078-multi-account-oauth-ui`
- Commit 格式：`UCA-078: support multi-account oauth connectors ui`
- 合并条件：连接/断开/默认用途设置可用，旧 provider preview 不回归

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写新增 API
- 填写 UI 验收结果
- 填写旧接口兼容情况
- 更新下一任务交接内容

## 8. 对下一个任务的交接

- 下一个任务：UCA-079
- 本任务新增了什么：多账户 registry 数据和可选默认用途
- 下一个任务直接可复用什么：`GET /connectors/connected-accounts` 与 accountId token 获取
- 还没解决的问题：统一工具层、账户路由、多账户冲突返回

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-077-connector-foundation`
- 开始日期：2026-04-19
- 完成日期：2026-04-19
- 实际新增内容：
  - OAuth callback 在保留旧 provider token preview 的同时，写入 `ConnectedAccount` 与 accountId token record
  - 新增 canonical API：`GET /connectors/connected-accounts`、`PATCH /connectors/connected-accounts/:accountId/defaults`、`DELETE /connectors/connected-accounts/:accountId`、`POST /connectors/connected-accounts/:accountId/reauth/start`
  - Connectors Tab 增加已连接账户列表、capability 标签、默认用途按钮、重授权和断开入口
  - 旧 `/connectors/accounts` 与 provider preview endpoint 保持兼容
- 验证结果：
  - `npm run verify:unified-connectors`
  - `node scripts/verify-runtime-wiring.mjs`
  - `node scripts/verify-console-ui.mjs`
  - `node scripts/verify-action-tools.mjs`
  - `node scripts/verify-service-core.mjs`
  - `node scripts/verify-structure.mjs`
- 遗留问题：
  - `reauth/start` 当前只启动同 provider OAuth 流；缺失 capability/scope 的 request 绑定和恢复执行留给 UCA-081
  - 旧 provider preview 仍使用 `account-connectors.mjs` 的 provider-level token 兼容路径，后续 UCA-079/UCA-082 逐步迁移到 account router
- 交接给下一个任务：UCA-079 可使用 canonical `ConnectedAccount` API 和 accountId token，为 `account_list_emails/files/events` 实现 router 与统一 read tools
