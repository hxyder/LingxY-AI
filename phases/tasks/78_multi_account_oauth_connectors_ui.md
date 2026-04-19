# Task UCA-078 — Multi-Account OAuth & Connectors UI

**Status**: todo  
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

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
