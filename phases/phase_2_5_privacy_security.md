# Phase 2.5 — 隐私与权限（新增 Phase）

> 周期估计：W20–W22（3 周） · 角色：1 后端 + 0.5 桌面 + 1 安全顾问
> 上一阶段：[Phase 2](phase_2_status_completeness.md) · 下一阶段：[Phase 4](phase_4_office_integration.md)

## 1. 目标

让 UCA 成为一个**用户能信任**的程序。具体落地：

- 用户随时能知道"我的什么数据被发到哪里"
- 敏感字段在出本地之前自动脱敏
- 可以禁用任何窗口、任何应用、任何站点
- 可以一键全局禁用
- 所有 LLM 调用本地可审计
- 提供完全离线模式

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | Security Broker | 上下文进出 service 的统一过滤层 |
| 2 | 应用白/黑名单 | 进程名级别 + 窗口标题正则 |
| 3 | 敏感字段脱敏 | 邮箱/手机/身份证/银行卡/IP/JWT 正则脱敏 |
| 4 | 脱敏对应表 | 本地保留映射表，回填结果时还原 |
| 5 | Kill Switch | 托盘一键禁用 + 全局快捷键 |
| 6 | 首次启动权限引导 | 5 步引导：剪贴板/文件/浏览器/Office/Kimi |
| 7 | 审计日志 | 每次 LLM 调用记录：何时/何对象/谁触发/发送字节/响应字节 |
| 8 | 完全离线模式 | 切到本地 Ollama / 禁用一切外联 |
| 9 | 数据保留期 | 剪贴板缓存 5min、截图 24h、产物 30d 自动清理 |
| 10 | 屏幕共享/演示模式防护 | 最佳努力检测 + 手动 Presenter Mode → 自动隐藏浮窗 |
| 11 | 敏感动作授权 | 写文件/发邮件/调外部程序 单独二次确认 |
| 12 | 数据导出 | 用户能一键导出"过去 30 天我的所有任务" |
| 13 | 数据删除 | 用户能一键清空所有本地数据 |

### 2.2 不做

- SSO / 企业目录集成（Phase 6+）
- 加密文件系统（依赖 OS）
- 渗透/合规第三方审计（产品上线前才做）

## 3. 架构

### 3.1 Security Broker 在数据流中的位置

```
[Capture Source]
     │
     ▼
[Context Normalizer]
     │
     ▼
┌──────────────────────────────┐
│  Security Broker             │  ← 新增层
│  ┌────────────────────────┐  │
│  │ 1. 黑/白名单 gate        │  │
│  │ 2. Kill switch 检查      │  │
│  │ 3. 屏幕共享检测           │  │
│  │ 4. 字段脱敏              │  │
│  │ 5. 大小预算检查           │  │
│  │ 6. 写审计日志            │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
     │ filtered ContextPacket
     ▼
[Overlay UI / Intent Router]
     │
     ▼
[Executor]   ← 在执行外联前再次走 Security Broker
     │
     ▼
[LLM / 网络]
     │
     ▼  result
[Security Broker.unredact]   ← 用映射表还原
     │
     ▼
[UI]
```

Security Broker **不是中间件**，是**强制单例**，所有上下文必须穿过它。

### 3.2 脱敏规则示例

```typescript
const PII_RULES: PIIRule[] = [
  { id: 'email',     regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '[EMAIL_$N]' },
  { id: 'phone_cn',  regex: /1[3-9]\d{9}/g, replacement: '[PHONE_$N]' },
  { id: 'idcard_cn', regex: /\d{17}[\dxX]/g, replacement: '[IDCARD_$N]' },
  { id: 'bankcard',  regex: /\d{15,19}/g, replacement: '[BANKCARD_$N]' },
  { id: 'jwt',       regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[JWT_$N]' },
  { id: 'ipv4',      regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_$N]' },
];

interface RedactionResult {
  redacted_text: string;
  map: Record<string, string>;   // [EMAIL_1] → der@example.com
}
```

**重要**：map 仅存在 service 进程内存（**不写盘**），任务结束后立即销毁。这样既能在 LLM 返回结果中还原 `[EMAIL_1]` → 真实邮箱，又不会有持久化泄漏风险。

恢复语义按 **fail-closed** 执行，并固化为正式规则：

1. service 启动时扫描所有 `status in ('running','streaming')` 且 `redaction_applied=true` 的任务
2. 所有命中任务强制标记为 `failed`
3. 失败分类统一为 `redaction_state_lost`
4. `failure_user_message` 固定为：`由于程序异常退出，含敏感数据的任务无法恢复，请重新运行原命令`
5. 这类任务**不能自动重跑**；只有用户主动点击“重新运行”时，才允许从原 capture source 重新采集

redaction map 在本产品中定义为 **memory-only, ephemeral**。不引入“加密后短期落盘再恢复”的默认路径，以避免额外攻击面和复杂度。

### 3.3 黑/白名单数据结构

```jsonc
{
  "global_kill_switch": false,
  "blocklist": {
    "process_names": ["KeePass.exe", "1Password.exe", "BankClient.exe"],
    "window_title_patterns": ["(?i)password", "(?i)credit\\s*card", "(?i)login"],
    "url_domains": ["bank.example.com", "*.gov.cn"]
  },
  "allowlist": {
    "enable_only": false,        // true 时只允许白名单内
    "process_names": [],
    "url_domains": []
  },
  "field_redaction": {
    "enabled_rules": ["email", "phone_cn", "idcard_cn", "bankcard", "jwt"],
    "user_custom_rules": []
  },
  "data_retention": {
    "clipboard_cache_minutes": 5,
    "screenshot_hours": 24,
    "artifact_days": 30,
    "audit_log_days": 90
  },
  "offline_mode": false
}
```

### 3.4 审计日志

每次 LLM 调用写一条：

```jsonc
{
  "audit_id": "aud_xxx",
  "ts": 1681540001000,
  "trigger": { "type": "user_command", "user_command_excerpt": "..." },
  "context_summary": { "source_type": "file", "size_bytes": 12000, "redactions_applied": ["email:2", "phone_cn:1"] },
  "executor": "kimi_cli",
  "model": "kimi-k2",
  "request_bytes": 8500,
  "response_bytes": 4200,
  "latency_ms": 3450,
  "task_id": "TASK-..."
}
```

写到独立 SQLite 表 `audit_log`，可在主控制台"审计日志"页查看与导出。

### 3.5 离线模式

切到离线模式时：
- 禁用 Kimi CLI Bridge（外联）
- 禁用一切云 LLM 调用
- FastExecutor 切到本地 Ollama (`llama3.1:8b` 或 `qwen2.5:7b`)
- 禁用网页抓取
- UI 顶部红色横幅"离线模式"

## 4. 流程设计

### 4.1 首次启动权限引导

```
Step 1: 欢迎
  - 解释 UCA 是干什么的
  - 一句话隐私承诺

Step 2: 剪贴板权限
  - 解释 "我们会读剪贴板，但仅在你按快捷键时"
  - "设置黑名单" 链接

Step 3: 文件权限
  - 解释 Shell Extension 安装目的
  - 询问是否安装

Step 4: 浏览器扩展
  - 提供安装链接
  - 告知 Native Messaging 用途

Step 5: LLM 后端
  - 选择：云端(Claude/Kimi) / 离线(Ollama)
  - 输入 API Key（存到 keytar）
  - 显示成本提示
```

### 4.2 敏感动作授权流程

```
Task 触发 → 路由判断 high_risk?
  ├─ 写本地文件 → 已确认在 Phase 2，跳过
  ├─ 运行外部程序 → 必须明示二次确认
  ├─ 发送邮件 → 必须明示二次确认 + 收件人显示
  ├─ 调用第三方 API → 必须明示二次确认 + URL 显示
  └─ 写入用户文档（覆盖原文件）→ 必须明示二次确认 + diff 预览
```

### 4.3 屏幕共享 / 演示模式防护

```
service 启动时启动轻量防护监控：
  best-effort 检测已知屏幕共享/录屏场景
  + 用户可手动打开 Presenter Mode
  on protection_enabled:
    emit security_event "presentation_mode_active"
    UI: 浮窗暂时禁用
    新建任务前提示 "当前处于共享/演示保护模式，请确认敏感上下文"
  on protection_disabled:
    恢复
```

说明：
- 这里不要把某一个 Windows API 名称写成硬依赖，因为不同录屏/会议软件的可探测性不同
- 产品承诺应是 **best-effort protection + 明确的手动总开关**，而不是"100% 自动识别所有共享场景"

Presenter Mode 的正式产品要求如下：

- **三处入口冗余**：
  - 托盘图标右键菜单首项
  - 主控制台顶部状态条按钮
  - 全局快捷键 `Ctrl+Alt+P`（可配置）
- **强视觉反馈**：
  - 托盘图标变红并带角标
  - 主控制台顶部显示红色横幅“Presenter Mode ON · 已暂停所有 capture”
  - 浮窗完全不渲染
  - 状态切换时发送 Windows toast
- **审计要求**：
  - 每次 ON/OFF 都写入 `audit_log`
  - `event_subtype = presenter_mode.toggle`
  - 至少记录 `actor`、`previous_state`、`new_state`、`active_screen_share_apps_at_time`
- **自动检测优先级**：
  - 高优先：已知会议软件前台进程检测
  - 中优先：系统级 screen capture 检测（如可用）
  - 低优先：系统 Presentation Mode / Notification State
  - 不做：对 OBS 等第三方录屏软件做全覆盖识别

自动检测任一层失败都不影响其它层运行；用户手动开关始终是最高优先级的真值来源。

## 5. 验收标准

### 5.1 功能验收
- [ ] Kill switch 启用后所有上下文捕获立即停止 ≤ 1s
- [ ] 黑名单内进程的窗口操作不会触发 capture
- [ ] 5 类 PII 在测试样本中 100% 命中
- [ ] PII 还原映射表在任务结束后从内存清空
- [ ] 屏幕共享时浮窗自动隐藏
- [ ] 离线模式下任何外联调用 = 0
- [ ] 审计日志每条都能在 UI 查看且包含必要字段
- [ ] 用户可一键导出过去 30 天数据为 zip
- [ ] 用户可一键清空所有本地数据（含 SQLite + 凭据 + 产物 + 日志）
- [ ] 首次启动 5 步引导可跳过但默认显示

### 5.2 安全验收（重要）
- [ ] 渗透测试：黑名单绕过尝试 0 成功
- [ ] 渗透测试：脱敏规则绕过尝试 0 成功
- [ ] 静态分析：无明文 API Key
- [ ] 动态分析：keytar 用 DPAPI 加密存储
- [ ] 内存扫描：完成任务后 PII map 不在堆中
- [ ] 数据导出包不含 keytar 凭据
- [ ] 数据删除验证：清空后再启动，状态为首次安装

### 5.3 工程验收
- [ ] Security Broker 单测覆盖率 ≥ 90%
- [ ] 故障注入：bypass Security Broker 直接调 LLM 的代码会被 lint 拒绝
- [ ] 文档：隐私政策、数据流向图、开源依赖审计

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 脱敏正则误伤业务字段 | 用户结果错乱 | 提供"原文/脱敏后预览"开关，让用户看到将发出的内容 |
| 黑名单没覆盖到的敏感场景 | 隐私泄漏 | 默认开启 PII 脱敏 + 屏幕共享检测兜底 |
| 离线模式下本地模型质量差 | 用户体验下降 | UI 明示并允许临时切回云端 |
| Kill switch 失效 | 信任崩塌 | 写专门 e2e 测试用例 |
| 审计日志膨胀 | 磁盘满 | 90 天滚动，每天 GZip |
| 权限引导太长用户跳过 | 默认配置不安全 | 默认配置就是安全配置；引导只是说明 |
| 误报屏幕共享 | 用户体验差 | 给"忽略本次"选项 |

## 7. 交付物清单

```
src/service/
  ├─ security/
  │   ├─ broker.ts
  │   ├─ rules/
  │   │   ├─ blocklist.ts
  │   │   ├─ pii_redaction.ts
  │   │   └─ defaults.json
  │   ├─ kill_switch.ts
  │   ├─ screen_share_monitor.ts
  │   └─ audit_log.ts
src/console/
  ├─ first_run_wizard/
  ├─ privacy_settings/
  ├─ audit_log_viewer/
  └─ data_export_delete/
docs:
  ├─ privacy_policy.md
  ├─ data_flow.md
  ├─ pii_rules_reference.md
  └─ phase_2_5_demo.mp4
```

## 8. 与下一 Phase 的接口

完成 Phase 2.5 后，UCA 已经具备"可信"基础。后续 Phase 4 (Office) 和 Phase 5 (PDF/视觉) 在引入新 capture 来源时，**必须**默认走 Security Broker，并在 PR review 中检查这一点。
