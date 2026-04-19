# Task UCA-080 — Write Tools, Confirmation & Provider Adapters

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-079  
**Branch**: `task/uca-080-connector-write-tools`

## 1. 任务目标

补齐统一账户写操作：发邮件、上传文件、创建日历事件，并接入现有 confirmation / pending approval 风险模型。

## 2. 前置依赖

- 上一个任务：UCA-079
- 必须已有的产物：account router、read provider adapters、Action Tool Registry、risk matrix、pending approval
- 不能同时修改的区域：补授权恢复执行、Email Monitoring 迁移

## 3. 实施范围

- 负责模块：write Action Tools、provider adapter 写方法、风险元数据、预览内容
- 允许改动文件/目录：`src/service/connectors/`、`src/service/action_tools/`、`src/desktop/console/tool-call-confirm/`、`scripts/verify-unified-connectors.mjs`
- 明确不做：自动补授权恢复、批量文件上传、富文本邮件编辑器

## 4. 交付产物

- **Write tools**：
  - `account_send_email`
  - `account_upload_file`
  - `account_create_event`
- **风险策略**：
  - `account_send_email`：high/write_sensitive，永远 requires_confirmation
  - `account_upload_file`：medium/write_safe，默认不强制确认，但仍受 unattended mode 限制
  - `account_create_event`：medium/write_safe，默认不强制确认
- **确认预览**：
  - send email 显示账户 email、provider、to/cc/bcc、subject、body preview
  - create event 显示账户、title、start/end、attendees、location
  - upload file 显示账户、localPath、folderId/newFileName
- **Provider adapter 写方法**：
  - Gmail/Graph 发信
  - Drive/OneDrive 上传
  - Google Calendar / Microsoft Calendar 创建事件
- **Tool wrapper**：
  - 写工具先 resolveAccount，再判断 capability，再执行 confirmation 机制
  - observation 不包含 token/raw provider response

## 5. 验证方式

- `node scripts/verify-unified-connectors.mjs`
  - `account_send_email` 风险为 high 且 requires_confirmation=true
  - interactive 模式确认后 mock provider 被调用
  - approval_required 模式生成 pending approval
  - unattended_safe 下 high 风险发信被拦截
  - create_event/upload_file mock 成功返回 normalized metadata
- `node scripts/verify-action-tools.mjs`

## 6. Git 执行方式

- 分支名：`task/uca-080-connector-write-tools`
- Commit 格式：`UCA-080: add connector write tools with confirmation`
- 合并条件：三类写工具 schema、risk、mock adapter 验证通过

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写 provider 写方法覆盖范围
- 填写风险矩阵结果
- 填写验证结果
- 更新下一任务交接内容

## 8. 对下一个任务的交接

- 下一个任务：UCA-081
- 本任务新增了什么：连接器写工具和确认预览
- 下一个任务直接可复用什么：写工具 metadata、provider adapter 错误码
- 还没解决的问题：补授权请求落库、恢复执行、审计细化

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
