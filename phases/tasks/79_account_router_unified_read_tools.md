# Task UCA-079 — Account Router & Unified Read Tools

**Status**: todo  
**Priority**: P0  
**Depends on**: UCA-077, UCA-078  
**Branch**: `task/uca-079-account-router-read-tools`

## 1. 任务目标

让 AI 能通过统一云账户读工具访问邮件、文件、日历，由系统自动选择账户并路由到 Google/Microsoft provider adapter。

## 2. 前置依赖

- 上一个任务：UCA-077、UCA-078
- 必须已有的产物：connected account registry、默认用途、token manager、Action Tool Registry
- 不能同时修改的区域：本地文件发现工具 `list_files`、写操作工具

## 3. 实施范围

- 负责模块：account router、read-only provider adapters、read Action Tools、schema 注册
- 允许改动文件/目录：`src/service/connectors/`、`src/service/action_tools/`、`scripts/verify-unified-connectors.mjs`、`scripts/verify-action-tools.mjs`
- 明确不做：send/upload/create 写操作、confirmation、reauth resume UI

## 4. 交付产物

- **Account router**：
  - `resolveAccount(ctx, input, requiredCapability)`
  - 优先级：显式 accountId → 显式 provider → utterance provider 推断 → 默认用途 → 最近使用 → 多候选要求选择
  - 缺 capability 返回 `reauth_required`
  - 多候选返回 `account_selection_required`
- **Provider 推断**：
  - Gmail/Google Drive/Google Calendar → google
  - Outlook/OneDrive/Microsoft/Teams → microsoft
- **Read tools**：
  - `account_list_emails`
  - `account_list_files`
  - `account_list_events`
- **Provider adapter read 方法**：
  - Google: Gmail list、Drive list、Calendar list
  - Microsoft: Graph messages、OneDrive list/search、Calendar events
- **ActionResult wrapper**：
  - 成功：`success: true` + normalized data in metadata
  - 结构化失败：`success: false` + `metadata.connector_status`

## 5. 验证方式

- `node scripts/verify-unified-connectors.mjs`
  - accountId 精确选择
  - provider 筛选
  - utterance 推断
  - 默认用途
  - 最近使用排序
  - 多候选 `account_selection_required`
  - 缺 capability `reauth_required`
  - 三个 read tools 返回统一结果
- `node scripts/verify-action-tools.mjs`

## 6. Git 执行方式

- 分支名：`task/uca-079-account-router-read-tools`
- Commit 格式：`UCA-079: add account router and unified read tools`
- 合并条件：read tools 能被 registry.list() 看到并能通过 mock provider 调用

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写 router 实际优先级
- 填写新增工具 schema
- 填写验证结果
- 更新下一任务交接内容

## 8. 对下一个任务的交接

- 下一个任务：UCA-080
- 本任务新增了什么：账户路由和只读工具闭环
- 下一个任务直接可复用什么：router、provider adapter 基类、ActionResult wrapper
- 还没解决的问题：写工具、confirmation、upload/send/create adapter

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
