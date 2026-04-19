# Phase Unified Account Connectors — 统一账户连接器

> 周期估计：3-4 周 · 角色：1 后端 + 0.5 前端
> 依赖：UCA-048 Settings v2、UCA-049 Provider-agnostic Agentic Runtime、现有 Connectors Tab、UCA-044/045 Email 子系统

## 1. 目标

把当前 Google/Microsoft OAuth demo 升级为面向 AI Agent 的统一账户连接器层。

当前系统已经能按 provider 类型连接 Google 或 Microsoft，并通过 `src/service/connectors/account-connectors.mjs` 读取文件、邮件、日历预览。但它仍是 provider 级单连接模式：没有 `accountId`、没有统一 capability、没有多账户路由、没有补授权闭环，也没有把云账户能力作为统一 Action Tools 暴露给 planner。

本阶段完成后，AI 只需要调用统一动作，例如 `account_list_emails`、`account_upload_file`、`account_create_event`；系统负责选择账户、校验权限、刷新 token、路由 provider、处理确认与补授权。

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | 账户注册表 | 持久化 `connected_accounts`、`oauth_tokens`、`reauth_requests` |
| 2 | 能力映射 | Google/Microsoft scope 映射为 `emailRead`、`emailWrite`、`fileRead`、`fileWrite`、`calendarRead`、`calendarWrite` |
| 3 | 多账户 OAuth | OAuth callback 落库为 `ConnectedAccount`，支持同 provider 多账户 |
| 4 | Token manager | access token 过期刷新，失败时标记 `reauth_required` |
| 5 | Account router | 根据 accountId、provider、用户语义、默认用途、lastUsed 选择账户 |
| 6 | Provider adapter | Google/Microsoft 统一读写接口 |
| 7 | Action Tools | `account_list_*` 和 `account_*` 写工具注册到现有 Action Tool Registry |
| 8 | 确认与补授权 | 写邮件强制确认；缺 capability 返回结构化 `reauth_required` |
| 9 | Audit | 复用现有 `audit_logs` 记录连接器工具调用，不记录 token |
| 10 | Connectors UI | 账户列表、capability 标签、默认用途、重新授权、断开连接 |
| 11 | Email 迁移 | Gmail/Outlook 监测与晨间摘要接入统一账户注册表 |

### 2.2 不做

- 不引入 Postgres；沿用当前 sqlite/memory store。
- 不新增独立 `tool_execution_logs` 表；审计先映射到现有 `audit_logs`。
- 不移除现有 `/connectors/accounts/:type/...` 预览接口；先新增 canonical API，再逐步迁移 UI。
- 不在本阶段接 Dropbox、Notion、Slack、Box；只保留 provider 扩展边界。
- 不让 planner 直接看到 raw provider token 或原始 provider API。

### 2.3 范围红线

- token 只能由 token manager/provider adapter 使用，不得进入 Action Tool observation、task event、audit payload。
- 所有写操作必须经过现有风险矩阵、confirmation 或 pending approval 机制。
- 权限不足不能裸抛 403，必须返回可恢复的 `reauth_required`。
- 云端文件工具不能占用现有本地 `list_files` 名称，统一使用 `account_list_files`。

## 3. 架构

### 3.1 组件位置

```
src/service/
  connectors/
    core/
      types.mjs
      capability-mapper.mjs
      account-registry.mjs
      token-manager.mjs
      account-router.mjs
      reauth-manager.mjs
      risk-policy.mjs
    google/
      google-connector.mjs
    microsoft/
      microsoft-connector.mjs
    tools/
      account-list-emails.mjs
      account-send-email.mjs
      account-list-files.mjs
      account-upload-file.mjs
      account-list-events.mjs
      account-create-event.mjs
```

现有 `account-connectors.mjs` 先作为兼容门面保留：旧 HTTP provider preview endpoint 继续调用它；新 canonical API 和 Action Tools 走 `connectors/core` 与 provider adapters。等 UI 和 email 子系统迁移完成后，再拆除旧门面。

### 3.2 数据模型

新增 sqlite/memory store 能力，字段以当前代码风格使用 snake_case JSON 结构：

- `connected_accounts`：账户元信息、provider、provider_account_id、email、scopes_json、capabilities_json、token_status、默认用途、last_used_at。
- `oauth_tokens`：按 `account_id` 存 token blob，优先 keytar/credential store，sqlite 只保存必要引用或加密载荷。
- `reauth_requests`：缺 scope/capability 时记录待补授权请求和原工具调用恢复上下文。

审计继续写现有 `audit_logs`，event subtype 使用 `connector.tool_call`、`connector.reauth_required`、`connector.token_refresh_failed` 等。

### 3.3 统一工具命名

现有本地文件发现工具已注册 `list_files`，因此云账户工具使用账户前缀：

| 工具 | capability | 风险 |
|---|---|---|
| `account_list_emails` | `emailRead` | low/read |
| `account_send_email` | `emailWrite` | high/write_sensitive |
| `account_list_files` | `fileRead` | low/read |
| `account_upload_file` | `fileWrite` | medium/write_safe |
| `account_list_events` | `calendarRead` | low/read |
| `account_create_event` | `calendarWrite` | medium/write_safe |

Action Tool 对外仍返回现有 `ActionResult`：

```js
{
  success: true,
  observation: "...",
  metadata: {
    connector_status: "success",
    provider: "google",
    accountId: "acct_xxx"
  }
}
```

`reauth_required`、`account_selection_required`、`confirmation_required` 等结构化状态放入 `metadata.connector_status`，避免破坏既有 tool loop。

## 4. 流程设计

### 4.1 OAuth 连接账户

```
1. UI 调 POST /connectors/accounts/:type/auth/start
2. backend 生成 PKCE state，state 内记录 provider 与 reauth 上下文
3. 用户浏览器完成 OAuth
4. /auth/callback 交换 token
5. 拉取 provider userinfo
6. scope -> capability 映射
7. upsert connected_accounts + oauth_tokens
8. UI 轮询 GET /connectors/connected-accounts 并刷新账户列表
```

### 4.2 统一读工具

```
1. planner 调 account_list_emails({ provider: "google", limit: 10 })
2. Action Tool 构造 ToolExecutionContext
3. account-router 按 provider/capability/default/lastUsed 选账户
4. token-manager 刷新 access token
5. provider adapter 调 Gmail 或 Graph
6. 返回统一 emails 数组，写 audit log
```

### 4.3 多账户冲突

```
1. 多个 active 账户都具备 emailRead
2. 没有显式 accountId/provider，也没有唯一默认账户
3. 返回 metadata.connector_status = "account_selection_required"
4. UI 展示候选账户
5. 用户选择 accountId 后重新执行原工具
```

### 4.4 补授权

```
1. 用户调用 account_send_email，但账户只有 emailRead
2. router 返回 reauth_required，包含 missingCapabilities/missingScopes
3. reauth-manager 创建 reauth_request 并保存原工具调用
4. UI 展示重新授权按钮
5. OAuth 使用增量 scope 完成后刷新 capability
6. 用户可恢复原工具调用，写操作仍需 confirmation
```

## 5. 验收标准

### 5.1 功能验收

- [ ] Google/Microsoft OAuth callback 能创建 `ConnectedAccount`。
- [ ] 同 provider 可连接多个账户，并能设置 email/files/calendar 默认用途。
- [ ] scope 能正确映射到六个基础 capability。
- [ ] token 过期时能自动 refresh；refresh 失败标记 `reauth_required`。
- [ ] `account_list_emails`、`account_list_files`、`account_list_events` 可通过 Action Tool Registry 调用。
- [ ] `account_send_email` 必须触发确认或 pending approval。
- [ ] 多账户冲突返回 `account_selection_required`。
- [ ] 缺写权限返回 `reauth_required`，包含缺失 capability 和 scope。
- [ ] Connectors Tab 显示账户、capability、token 状态、默认用途和重授权入口。
- [ ] Gmail/Outlook Email Monitoring 与 Morning Digest 能复用统一账户注册表。

### 5.2 安全验收

- [ ] access token 和 refresh token 不出现在 audit log、task event、tool observation。
- [ ] provider adapter 不把 raw token 暴露给 planner。
- [ ] 所有写操作均经过现有 risk matrix。
- [ ] 断开连接会删除 token 并停用账户。
- [ ] 补授权使用最小必要 scope，不一次性索取全量写权限。

### 5.3 工程验收

- [ ] 新增 `scripts/verify-unified-connectors.mjs`，覆盖 mapper/router/token/tool wrapper。
- [ ] `node scripts/verify-action-tools.mjs` 仍通过。
- [ ] `node scripts/verify-email-monitoring.mjs` 仍通过。
- [ ] `node scripts/verify-email-morning-digest.mjs` 仍通过。
- [ ] `node scripts/verify-runtime-wiring.mjs` 仍通过。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 旧 provider preview endpoint 与新 canonical API 并存造成混乱 | UI/测试重复路径 | `account-connectors.mjs` 作为兼容门面，新逻辑只在 core/adapters 增量建设，任务 UCA-082 统一迁移 |
| token 迁移破坏已连接用户 | 用户需重新授权 | UCA-077 做 legacy `google:tokens`/`microsoft:tokens` 迁移与 fallback；失败时显示重授权 |
| 工具名与本地文件工具冲突 | planner 调错工具 | 云工具统一 `account_` 前缀，schema/prompt 明确区分 local vs connected account |
| 补授权恢复执行误触发写操作 | 用户信任风险 | 恢复后仍重新走 confirmation；只恢复参数，不自动越过风险策略 |
| Gmail/Outlook 同时存在 IMAP legacy 账户 | 邮件重复监测 | UCA-082 迁移时按 provider/accountId 去重，IMAP 仅作为 legacy provider 保留 |
| 多账户路由误选账户 | 发错账户/读错数据 | 默认用途优先、冲突时要求选择、写操作 preview 显示账户 email |
| 增量授权 scope 差异 | Google/Microsoft 行为不一致 | provider-specific missing scope 推断放在 reauth-manager，不暴露给 planner |

## 7. 交付物清单

```
phases/
  phase_unified_account_connectors.md
  tasks/
    77_connector_registry_capability_foundation.md
    78_multi_account_oauth_connectors_ui.md
    79_account_router_unified_read_tools.md
    80_connector_write_tools_confirmation.md
    81_connector_reauth_resume_audit.md
    82_email_monitoring_connector_migration.md

src/service/connectors/
  core/
  google/
  microsoft/
  tools/

scripts/
  verify-unified-connectors.mjs
```

## 8. 与其他 Phase 的接口

- 依赖 UCA-049：统一 Action Tool Registry、tool loop、provider-agnostic planner。
- 依赖 UCA-048：Connectors/Settings UI 能展示 feature toggles 与账户配置。
- 复用 UCA-010/Action Tools 的 confirmation 和 pending approval 语义。
- 复用 UCA-044/045 的 email monitor/digest，但 Gmail/Outlook OAuth 账户迁移到统一注册表。
- 被未来 provider 扩展使用：新增 Dropbox/Notion/Slack 时只新增 capability mapper 与 provider adapter。
