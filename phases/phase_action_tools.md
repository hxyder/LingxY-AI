# Phase Action Tools — 系统动作工具层（新增 Phase）

> 周期估计：W18–W21（4 周，可与 Phase 2 并行启动） · 角色：1 后端 + 0.5 桌面
> 上一阶段：[Phase 2](phase_2_status_completeness.md) · 下一阶段：[Phase 2.5](phase_2_5_privacy_security.md)

## 1. 目标

让 LLM 不仅能"输出文本"，还能**直接调用本机和操作系统能力**：

- 唤起默认邮件客户端撰写邮件
- 直接通过 SMTP 发送邮件
- 在浏览器中搜索关键词
- 打开 URL / 文件 / 应用
- 在资源管理器中显示某个文件
- 复制内容到剪贴板
- 弹出 Windows Toast 通知
- 文件操作（重命名 / 移动 / 复制 / 创建文件夹）
- 截屏并附加到任务

> **示例**：用户对一个 PDF 说「分析一下，写封邮件给 advisor@example.com 发我的总结」。
> Phase 2 之前：UCA 只能输出邮件正文文本，让用户复制粘贴。
> Phase Action Tools 之后：UCA 直接调 `compose_email` 工具唤起 Outlook，标题/收件人/正文已经填好。

## 2. 范围

### 2.1 必做（核心工具集）

| # | 工具名 | 说明 | 风险等级 |
|---|---|---|---|
| 1 | `open_url` | 在默认浏览器打开 URL | 低 |
| 2 | `web_search` | 用默认搜索引擎搜索关键词 | 低 |
| 3 | `compose_email` | 用 mailto: 唤起邮件客户端，预填 to/cc/subject/body | 低 |
| 4 | `send_email_smtp` | 通过用户配置的 SMTP 直接发送（需配置） | **高** |
| 5 | `open_file` | 用默认应用打开文件 | 中 |
| 6 | `reveal_in_explorer` | 在资源管理器中定位并选中文件 | 低 |
| 7 | `launch_app` | 启动指定应用（白名单内） | 中 |
| 8 | `copy_to_clipboard` | 写入剪贴板（文本/图片） | 低 |
| 9 | `notify` | Windows Toast 通知 | 低 |
| 10 | `file_op` | 重命名/移动/复制/删除/创建文件夹 | **高** |
| 11 | `take_screenshot` | 截屏并保存为 artifact | 低 |
| 12 | `read_clipboard` | 读取当前剪贴板 | 中 |

### 2.2 不做

- 任意 PowerShell / Bash 执行（高风险，且会变成"任意命令执行"漏洞）
- 修改注册表 / 安装软件
- 网络请求到任意 URL（仅允许 web_search 与 open_url）
- 浏览器自动化（点击/填表）— 留给 Phase 6 评估
- 桌面 GUI 自动化 — 留给 Phase 6 评估

### 2.3 范围红线

任何工具的实现都必须：
1. 在白名单内（不允许 LLM 自定义任意 shell 命令）
2. 高风险动作必须经过 Confirmation 流（Phase 2 已建立）
3. 必须经过 Security Broker（Phase 2.5）
4. 必须写 audit_log

## 3. 架构

### 3.1 Action Tool Registry

```typescript
interface ActionTool {
  // 工具元信息
  id: string;                          // "compose_email"
  name: string;                        // 显示名
  description: string;                 // 给 LLM 的描述
  parameters: JSONSchema;              // 给 LLM 的参数 schema
  // 风险与权限
  risk_level: 'low' | 'medium' | 'high';
  requires_confirmation: boolean | ConditionalConfirmation;
  required_capabilities: Capability[]; // 'network' | 'file_write' | 'launch_app'
  // 执行
  execute(args: object, ctx: ActionContext): Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  observation: string;     // 给 LLM 的反馈
  artifact_paths?: string[];
  error?: string;
}

class ActionToolRegistry {
  register(tool: ActionTool): void;
  list(): ToolManifest[];                // 给 LLM 看的工具清单
  call(toolId: string, args: object, ctx: ActionContext): Promise<ActionResult>;
}
```

### 3.2 LLM Function Calling 集成

把工具清单注入到 LLM 的 system prompt（或用原生 function calling）：

```jsonc
// 给 LLM 的 tools 字段
[
  {
    "name": "compose_email",
    "description": "在用户的默认邮件客户端中打开新邮件，并预填收件人、抄送、标题和正文。这只是打开撰写窗口，不会自动发送。",
    "input_schema": {
      "type": "object",
      "required": ["to", "subject", "body"],
      "properties": {
        "to":      { "type": "array", "items": { "type": "string", "format": "email" } },
        "cc":      { "type": "array", "items": { "type": "string", "format": "email" } },
        "subject": { "type": "string" },
        "body":    { "type": "string" }
      }
    }
  },
  {
    "name": "web_search",
    "description": "用用户默认搜索引擎搜索关键词，会在默认浏览器打开搜索结果页",
    "input_schema": {
      "type": "object",
      "required": ["query"],
      "properties": {
        "query":  { "type": "string" },
        "engine": { "type": "string", "enum": ["default","google","bing","duckduckgo"] }
      }
    }
  }
  // ... 其它工具
]
```

LLM 返回 `tool_calls` → service 校验 → 权限/风险检查 → 执行 → observation 回填给 LLM 继续。

### 3.3 执行器升级：Tool-Using Executor

```
原 FastExecutor (LLM 一次调用)
        ↓ 升级
ToolUsingExecutor (Agent loop)
  loop:
    LLM 生成 tool_call 或 final_text
    if final_text:
      finish
    if tool_call:
      validate(tool, args)
      if requires_confirmation:
        emit needs_input → wait
      result = ToolRegistry.call(...)
      append observation to messages
      next iteration
    if iterations > MAX_ITER (默认 10):
      stop with warning
```

### 3.4 风险与确认矩阵

| 工具 | 默认确认 | 何时强制确认 |
|---|---|---|
| open_url | 否 | URL 含可执行后缀 (`.exe` `.msi`) |
| web_search | 否 | 永不强制 |
| compose_email | 否 | 永不强制（仅打开撰写窗口） |
| **send_email_smtp** | **是** | 永远强制 + 预览 |
| open_file | 否 | 文件 mime 是可执行类 |
| reveal_in_explorer | 否 | 永不 |
| launch_app | 是 | 应用不在用户白名单内 |
| copy_to_clipboard | 否 | 永不 |
| notify | 否 | 永不 |
| **file_op (delete)** | **是** | 永远强制 |
| file_op (move/rename) | 是 | 跨盘符或目标已存在 |
| file_op (create) | 否 | 路径不在用户工作目录 |
| take_screenshot | 否 | 永不 |
| read_clipboard | 否 | 黑名单进程下不允许 |

确认 UI 复用 Phase 2 的 confirmation 框，加上 "工具调用预览" 区块：

```
LLM 想调用工具：compose_email
参数：
  to:      ["advisor@example.com"]
  subject: "本周科研进展汇报"
  body:    "Dr. Smith,\n\n本周完成..."

[ 确认调用 ] [ 编辑参数 ] [ 拒绝 ]
```

### 3.4.1 与 Pending Approval 队列联动

Tool-Using Agent loop 必须根据 `task.execution_mode` 分流，不能一律依赖交互式 confirmation：

```text
Agent loop 内拿到 tool_call:
  if task.execution_mode === 'interactive':
    → 走 Phase 2 Confirmation UI（即时确认，阻塞 agent loop）
  if task.execution_mode === 'unattended_safe':
    → 先做 risk_check；low/medium 允许执行，high 风险直接拒绝并返回 observation
  if task.execution_mode === 'approval_required':
    → 产出 pending_approvals entry
    → agent 收到 observation: "Tool call queued for user approval (approval_id=appr_xxx)"
    → 当前 task 可标记为 partial_success 或 waiting_external_decision
```

这条规则保证 Phase Action Tools 与 Phase Scheduler 在确认机制上保持一致。发布前必须完成一次联调，覆盖 `interactive`、`unattended_safe`、`approval_required` 三种模式。

### 3.5 Tool 实现示例

```typescript
// src/service/action_tools/compose_email.ts
export const composeEmail: ActionTool = {
  id: 'compose_email',
  name: '撰写邮件',
  description: '...',
  parameters: composeEmailSchema,
  risk_level: 'low',
  requires_confirmation: false,
  required_capabilities: ['launch_app'],

  async execute({ to, cc, subject, body }, ctx) {
    const url = `mailto:${to.join(',')}` +
      `?cc=${(cc ?? []).join(',')}` +
      `&subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
    // mailto URI 长度限制约 2000 字符；过长时降级为生成 .eml 文件
    if (url.length > 1900) {
      const emlPath = await writeEmlFile({ to, cc, subject, body });
      shell.openPath(emlPath);
      return { success: true, observation: `Email draft saved to ${emlPath} and opened.` };
    }
    shell.openExternal(url);
    return { success: true, observation: `Mail client launched with draft to ${to.join(', ')}.` };
  },
};
```

## 4. 流程设计

### 4.1 用户场景：分析 PDF 并发送邮件总结

```
1. 用户右键 paper.pdf → "用 UCA 分析"
2. 浮窗输入: "总结这篇论文，写邮件发给我导师 dr@school.edu，标题用论文标题"
3. IntentRouter → executor=ToolUsingExecutor
4. Agent loop:
   ① LLM: 读 PDF 内容 (调用 read_file 工具或上下文已含)
   ② LLM: 总结 → 内部生成正文
   ③ LLM: tool_call(compose_email, {to:["dr@school.edu"], subject:"...", body:"..."})
   ④ Confirmation UI: 显示参数预览 → 用户确认
   ⑤ 工具执行 → mailto: 唤起 Outlook
   ⑥ LLM: tool_call(notify, {title:"邮件草稿已准备", body:"请检查 Outlook 撰写窗口"})
   ⑦ LLM: final_text "已为您准备好邮件草稿，请在 Outlook 中检查后发送"
5. 任务详情页显示完整 tool_call 链路
```

### 4.2 用户场景：搜索 + 整理

```
1. 浮窗输入: "搜一下最新的 GPT-5 评测，整理成 3 行简报"
2. Agent loop:
   ① tool_call(web_search, {query:"GPT-5 review 2026"})
      → 浏览器打开搜索页（用户可以看）
      → observation: "Search opened in browser. Top results: ..."
   ② tool_call(open_url, {url:"https://..."})  ← LLM 选了第一个结果
   ③ ... 但 LLM 拿不到网页内容
```

> **Phase Action Tools 的边界**：本 Phase 不实现"自动抓取搜索结果内容"，因为那需要浏览器自动化或服务端 fetch。如果用户场景包含"搜+读+总结"，应使用 Phase 1c 已有的 `web_fetch`+`summarize` 流程，而不是 web_search。
>
> 简单的工程取舍：**`web_search` 只负责"打开搜索页"，让用户自己决定看哪个**。

### 4.3 Confirmation 流复用

```
[Tool Call Pending]
     │
     ▼
[Risk Check]
  ├─ low / no_confirm → 直接执行
  ├─ medium → 弹轻确认
  └─ high → 弹重确认 (含 diff/参数预览)
     │
     ▼
[User Decides]
  ├─ confirm  → execute → observation
  ├─ edit     → 改参数 → 再次 risk_check
  └─ deny     → observation = "User denied this tool call"
     │
     ▼
[Back to Agent Loop]
```

## 5. 验收标准

### 5.1 功能验收
- [ ] 12 个核心工具全部实现且单测通过
- [ ] LLM 能在正确场景下选择正确的工具
- [ ] high 风险工具 100% 弹确认
- [ ] 确认 UI 显示完整参数（不截断关键字段）
- [ ] 用户编辑参数后能正确再次执行
- [ ] 拒绝工具调用后，LLM 能优雅收尾
- [ ] Agent loop 上限 10 轮，超过自动停止
- [ ] 任务详情页显示完整工具调用链
- [ ] 所有工具调用写入 audit_log
- [ ] 离线模式（Phase 2.5）下网络相关工具被禁用

### 5.2 安全验收
- [ ] 任何工具的参数都经过 schema 校验
- [ ] file_op delete 永远要求确认且显示具体路径
- [ ] launch_app 白名单外的应用拒绝执行
- [ ] send_email_smtp 凭据存 keytar
- [ ] 路径参数不允许 `..` 跨目录跳出
- [ ] mailto URL 不超过 2000 字符 fallback 到 .eml

### 5.3 工程验收
- [ ] ActionTool 接口稳定，新工具新增成本 < 0.5 天
- [ ] 单测：每个工具 + Agent loop + 风险矩阵
- [ ] 集成测试：从 LLM 输出到工具执行的完整链路
- [ ] 文档：工具开发指南、风险评估模板

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| LLM 误调用高风险工具 | 误删除文件等 | 强制确认 + 风险矩阵 |
| LLM 在 Agent loop 死循环 | 卡任务 | MAX_ITER=10 + 时间上限 |
| 工具参数被注入恶意值 | 路径穿越/命令注入 | JSON Schema 严格校验 + 路径白名单 |
| send_email_smtp 凭据泄漏 | 邮件账号被盗 | DPAPI 加密 + 不出本地 |
| mailto URL 被截断 | 邮件正文不完整 | URL 长度检测 + .eml 降级 |
| 用户对工具调用感觉不可控 | 信任崩塌 | 任务详情页展示完整链路 + 默认风险高时确认 |
| 工具集膨胀 | 维护成本 | 严格审核新增；外部贡献必须 ADR |

## 7. 交付物清单

```
src/service/
  ├─ action_tools/
  │   ├─ registry.ts
  │   ├─ types.ts
  │   ├─ schemas/                 各工具 JSON Schema
  │   ├─ tools/
  │   │   ├─ open_url.ts
  │   │   ├─ web_search.ts
  │   │   ├─ compose_email.ts
  │   │   ├─ send_email_smtp.ts
  │   │   ├─ open_file.ts
  │   │   ├─ reveal_in_explorer.ts
  │   │   ├─ launch_app.ts
  │   │   ├─ copy_to_clipboard.ts
  │   │   ├─ notify.ts
  │   │   ├─ file_op.ts
  │   │   ├─ take_screenshot.ts
  │   │   └─ read_clipboard.ts
  │   └─ risk_matrix.ts
  └─ executors/
      └─ tool_using/
          ├─ agent_loop.ts
          └─ tool_call_validator.ts
src/console/
  └─ tool_call_confirm/
docs:
  ├─ tool_authoring_guide.md
  ├─ risk_assessment_template.md
  └─ phase_action_tools_demo.mp4
```

## 8. 与其他 Phase 的接口

- 依赖 Phase 2 的 Confirmation 流（重确认 UI）
- 依赖 Phase 2.5 的 Security Broker（动作前再过一遍）
- 被 Phase 6（动作模板）使用：自定义模板可以引用任意工具
- 被 Phase Scheduler 使用：定时任务的 action 可以是工具调用
