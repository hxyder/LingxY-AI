# 需求响应：四条具体能力的可行性与方案归位

> 本文档对应一次需求评审：用户在审阅《[universal_context_agent_detailed_plan.md](universal_context_agent_detailed_plan.md)》及 [phases/](../../phases/) 后提出 4 条具体能力问题，本文档逐条回答**能/不能/不值得**，并指向对应的 phase 文档。

---

## 需求 1 ｜ 鼠标放在文件上 / 选中文件夹或文件 → AI 直接执行操作

### 结论：✅ 部分支持 + ❌ 部分不建议做

| 子需求 | 结论 | 原因 |
|---|---|---|
| 选中文件 → 右键菜单 → AI 执行 | ✅ 支持 | [phase_1b §2.1](../../phases/phase_1b_file_capability.md) Shell 扩展 |
| 选中文件 → 拖拽到浮窗 | ✅ 支持 | [phase_1b §2.1](../../phases/phase_1b_file_capability.md) |
| 选中文件 → 全局快捷键触发 | ✅ 新增 | [phase_1b §2.1.1](../../phases/phase_1b_file_capability.md#211-关于-explorer-选区抓取-的实现细节) `Ctrl+Shift+E` |
| **鼠标悬停** 文件即触发 | ❌ 不建议 | 见下 |

### 为什么"悬停即触发"不建议做

1. **技术上不通用**：Windows Explorer 不暴露 hover 事件给第三方。要监听必须用全局鼠标 Hook + 持续 UIAutomation 查询光标下的 item，性能差且在不同 Explorer 状态下行为不一致。
2. **违反低打扰原则**：用户**没有点击意图**就触发动作，会被觉得"鬼祟"，是 §2.1 §2.6 直接禁止的反模式。
3. **ROI 极低**：用户最终都要点一下来下命令，按 `Ctrl+Shift+E` 一个键和点右键代价相同，悬停检测带来的微弱体验提升不值这些工程成本和电池/性能损耗。
4. **隐私雷区**：后台扫描"光标下是什么"等同于浅层屏幕监控，企业用户和教育机构会拒绝部署。

### 已经做了的更新

- [phase_1b_file_capability.md](../../phases/phase_1b_file_capability.md)：在「2.1 必做」加入第 3 项 **全局快捷键读 Explorer 选区**，并新增 §2.1.1 详细说明实现路径（`IShellWindows` + `IFolderView::GetSelectionMarkedItem`，C# 通过 SHDocVw + Shell32 互操作）。
- 验收清单加入 3 个新检查项：快捷键基本流程、多选 5 个文件、Explorer 不在前台时的 fallback。
- 架构图补充 `uca-helper` 组件（C# WPF Console，处理快捷键 + IShellWindows 枚举）。

---

## 需求 2 ｜ 选中图片 / 选中文字 → AI 直接执行操作

### 结论：✅ 完全支持

| 场景 | 入口 | Phase |
|---|---|---|
| 网页文字选区 | 浏览器扩展浮标 | [Phase 1c](../../phases/phase_1c_browser_extension.md) |
| 网页图片右键 | 浏览器扩展右键菜单 | [Phase 1c](../../phases/phase_1c_browser_extension.md) |
| Word/Excel/PPT 选区 | Office Add-in Task Pane | [Phase 4](../../phases/phase_4_office_integration.md) |
| PDF 文件（整文件） | 右键 / 拖拽 | [Phase 1b](../../phases/phase_1b_file_capability.md) |
| PDF 内选区 | 复制后按全局快捷键 | [Phase 1a](../../phases/phase_1a_minimal_loop.md) + [Phase 1c](../../phases/phase_1c_browser_extension.md) |
| 任意应用文字 | Ctrl+C → 全局快捷键 | [Phase 1a](../../phases/phase_1a_minimal_loop.md) |
| 剪贴板图片 | 全局快捷键 → 浮窗读取 | [Phase 5](../../phases/phase_5_pdf_visual_fallback.md) |
| 用户主动截图 | `Ctrl+Shift+S` | [Phase 5](../../phases/phase_5_pdf_visual_fallback.md) |
| 文件管理器中的图片文件 | 右键/拖拽/`Ctrl+Shift+E` | [Phase 1b](../../phases/phase_1b_file_capability.md) |

### 已存在的覆盖矩阵不需要再改文档

唯一要点：**非浏览器、非 Office 的应用内选区**（VSCode / Slack / Discord / 微信...）通过 "Ctrl+C → 全局快捷键" 兜底，这是有意识的设计选择（详见《[主方案 §22.4](universal_context_agent_detailed_plan.md#224-不建议做的事)》对"全局选区检测"的判断）。

---

## 需求 3 ｜ 设置定时任务 + AI 自主创建

### 结论：✅ 可以做（原方案没有，已新增 [Phase Scheduler](../../phases/phase_scheduler.md)）

### 能力清单

| 子需求 | 实现 |
|---|---|
| 定时（cron）触发 | node-cron + SQLite 持久化 |
| 间隔（interval）触发 | setInterval / cron 内部转换 |
| 文件/文件夹变化触发 | chokidar + stable-size 检测 |
| 自然语言转 cron | 正则匹配（"每天 9 点"）+ LLM 兜底 |
| **AI 自主创建** | Action Tool `create_scheduled_task`（依赖 [Phase Action Tools](../../phases/phase_action_tools.md)） |
| 服务重启恢复 | 启动时扫 enabled schedules → 重新注册 |
| 错过触发处理 | misfire 策略：skip / run_once / run_all |
| 失败保护 | 连续失败 3 次自动 disable |
| 手动管理 | 控制台「计划任务」页 |

### AI 自主创建流程示例

```
用户："以后每个工作日下午 5 点提醒我写日报"
  ↓
LLM (Tool-Using Executor):
  parse "每个工作日下午 5 点" → "0 17 * * 1-5"
  tool_call(create_scheduled_task, {
    name: "工作日日报提醒",
    trigger: { type: "cron", expression: "0 17 * * 1-5" },
    action: { type: "action_tool", target: "notify",
              params: { title: "该写日报了", body: "..." } }
  })
  ↓
Confirmation UI 显示：
  "创建定时任务：每周一到周五 17:00 弹出通知"
  [确认] [编辑] [取消]
  ↓
用户确认 → 写库 → cron 注册 → 立即生效
```

### 关键安全约束

- 定时任务的 action 必须是**已注册**的 task template 或 action tool（不能让 LLM 注入任意 shell）
- 触发后的执行**仍然走完整的 Security Broker + 确认链路**，不绕过
- LLM 自主创建定时任务被定义为 **high risk**，强制确认
- 同一用户最多 50 个 enabled schedule，防止 LLM 误创建大量任务
- agent 创建的 schedule 标记 `created_by="agent"`，防止"任务又创建任务"的死循环

详见 [phase_scheduler.md](../../phases/phase_scheduler.md) 全文。

---

## 需求 4 ｜ 直接唤起发邮件、搜索信息等

### 结论：✅ 可以做（原方案没有，已新增 [Phase Action Tools](../../phases/phase_action_tools.md)）

### 为什么原方案缺这一层

原方案的"执行器"只关心"包装 LLM 调用"——FastExecutor、KimiCLIExecutor 都是把上下文给 LLM、把结果拿回来。**没有任何机制让 LLM"对系统做事"**。

这一层的缺失使 UCA 永远停留在"会聊天的执行器"，无法升级为"真正能 Agent 化做事"的助手。补这一层是把产品定位（§1.3「不是聊天，是做事」）落到实处的关键。

### 已支持的工具集（12 项）

| 工具 | 说明 | 风险 |
|---|---|---|
| `open_url` | 打开 URL | 低 |
| `web_search` | 默认搜索引擎搜索 | 低 |
| `compose_email` | mailto: 唤起邮件客户端预填正文 | 低 |
| `send_email_smtp` | 通过用户配置 SMTP 直发 | **高** |
| `open_file` | 默认应用打开文件 | 中 |
| `reveal_in_explorer` | 在资源管理器中定位 | 低 |
| `launch_app` | 启动应用（白名单内） | 中 |
| `copy_to_clipboard` | 写剪贴板 | 低 |
| `notify` | Windows Toast 通知 | 低 |
| `file_op` | rename/move/copy/delete/mkdir | **高** |
| `take_screenshot` | 截屏入 artifact | 低 |
| `read_clipboard` | 读剪贴板 | 中 |

### 工作流程（示例：分析 PDF 后发邮件）

```
1. 用户右键 paper.pdf → 浮窗输入"总结后发给 dr@school.edu"
2. IntentRouter → ToolUsingExecutor
3. Agent loop：
   ① LLM: 读 PDF 上下文 → 生成总结
   ② LLM: tool_call(compose_email, {to:["dr@school.edu"], subject:"...", body:"..."})
   ③ Risk check: low → 直接执行
   ④ shell.openExternal(mailto:...) → Outlook 自动打开撰写窗口
   ⑤ LLM: tool_call(notify, {title:"邮件草稿已准备"})
   ⑥ LLM: final_text "已为您准备好邮件草稿"
4. 任务详情页显示完整 tool_call 链
```

### 关键安全约束

- 任意工具的参数必须经过 **JSON Schema 严格校验**
- **不允许任意 shell 命令** —— 严格白名单
- high 风险工具（send_email_smtp / file_op delete / launch_app 白名单外）**必须确认**
- Agent loop 上限 10 轮，超过强停（防止死循环）
- 所有工具调用写 audit_log
- 离线模式下网络相关工具被禁用
- 路径参数禁止 `..`（防穿越）

详见 [phase_action_tools.md](../../phases/phase_action_tools.md) 全文。

---

## 整体影响汇总

### 新增 / 修改的文件

| 文件 | 状态 | 内容 |
|---|---|---|
| [phases/phase_1b_file_capability.md](../../phases/phase_1b_file_capability.md) | 修改 | 加入全局快捷键读 Explorer 选区（§2.1 / §2.1.1 / §3.1 / §5.1） |
| [phases/phase_action_tools.md](../../phases/phase_action_tools.md) | **新增** | 系统动作工具层完整方案 |
| [phases/phase_scheduler.md](../../phases/phase_scheduler.md) | **新增** | 定时与触发任务方案，含 AI 自主创建 |
| [phases/README.md](../../phases/README.md) | 修改 | Phase 总览表加入两个新 Phase + 并行说明 |
| [phases/architecture_cross_cutting.md](../../phases/architecture_cross_cutting.md) | 修改 | 进程图、数据流图、ADR 索引、演进路径加入新组件 |

### 时间影响

原 MVP 路线：W1 → W31+。

新增的两个 Phase 通过**并行**安排不会延长关键路径：

```
原:    Phase 2 (W16-W19) → Phase 2.5 (W20-W22) → Phase 4 (W23-W26)
新:    Phase 2 (W16-W19) → Phase 2.5 (W20-W22) → Phase 4 (W23-W26)
              ↑
       Phase Action Tools (W18-W21, 与 Phase 2 后期并行)
                                      ↑
                              Phase Scheduler (W22-W24, 与 Phase 4 早期并行)
```

人力影响：建议在 Phase 2 后期增加 1 名后端，专门负责 Action Tools 和 Scheduler 两个 Phase（共约 7 周工作量，可以一个人完成）。

### 不变更的部分

- 原方案的七层架构、ContextPacket、Task FSM、状态显示等核心设计**完全保留**
- Phase 0 / 1a / 1c / 3 / 5 / 6 不需要修改
- Phase 1b 的核心范围不变，只是补一个快捷键路径
- Phase 2 / 2.5 / 4 不需要修改

### 风险

| 新增风险 | 缓解 |
|---|---|
| Action Tools 误用导致用户误删文件 | high 风险强制确认 + 严格白名单 + 审计 |
| Scheduler 让 LLM 创建大量定时任务 | 单用户上限 50 + 强制确认 + agent 不能再创建 |
| Tool-Using Agent loop 卡死 | MAX_ITER=10 + 时间上限 |
| send_email_smtp 凭据被偷 | DPAPI 加密 + 不出本地 + 永远确认 |
| 全局快捷键 Ctrl+Shift+E 与系统冲突 | 启动时检测 + 用户可改键 |

---

## 一句话总结

需求 1 和 2 你的方案**已经能做**（细节小改即可）；需求 3 和 4 你的方案**原本不能做**，但现在已经新增了两个并行 Phase 把这两条能力补全。整体上没有延长 MVP 关键路径，只需要在 Phase 2 后期多投入一名后端工程师即可。

最关键的设计决策是：**新增的两个 Phase 都不绕过 Security Broker / 确认 / 审计 / 配额**——它们是在原有安全骨架之上加能力，而不是在旁边开侧门。这是它们能够安全落地的前提。


