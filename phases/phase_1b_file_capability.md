# Phase 1b — 文件能力

> 周期估计：W9–W12（4 周） · 角色：1 桌面 + 1 后端
> 上一阶段：[Phase 1a](phase_1a_minimal_loop.md) · 下一阶段：[Phase 1c](phase_1c_browser_extension.md)

## 1. 目标

让用户从"只能处理剪贴板"扩展到"能处理本地文件和文件组"，并跑通真正的 Kimi CLI 深度任务（不再 stub）。

> 用户右键一个 PDF / Word / Markdown / TXT 文件 → 选 "用 UCA 分析" → 选"生成报告" → 后台运行 → 完成后任务中心可打开 Markdown 报告产物。

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | Windows Shell Extension | 文件右键菜单注册项："用 UCA 分析" |
| 2 | 拖拽到固定浮窗 | 把文件拖到浮窗即生成 ContextPacket(file) |
| 3 | **全局快捷键读取 Explorer 选区** | `Ctrl+Shift+E` 触发，读取前台 Explorer 当前选中文件 |
| 4 | 文件类型识别 | 通过扩展名 + magic bytes 判断 mime_type |
| 5 | FileExtractor 集合 | PDF→文本(pdf-parse)、DOCX→文本(mammoth)、TXT/MD 直读 |
| 6 | ContextPacket 完整化 | 加 source_type=file/file_group, file_paths, size, mime |
| 7 | Kimi CLI Bridge (真实) | spawn 真实 Kimi CLI，stdin JSON 任务包，stdout JSON Lines |
| 8 | 真任务包协议 | 完整 task_package + 输出目录 + 规则字段 |
| 9 | 任务中心增强 | 按状态/类型/时间筛选；按文件路径搜索 |
| 10 | 产物管理 | `%APPDATA%/UCA/outputs/{date}/{task_id}/` 目录约定 |
| 11 | 多文件组 | 选 N 个文件 → file_group → Kimi 跨文件分析 |

#### 2.1.1 关于 "Explorer 选区抓取" 的实现细节

**目标**：用户在资源管理器选中一个或多个文件后，按 `Ctrl+Shift+E`，浮窗立即显示这些文件可用的快捷动作。这是除"右键菜单"和"拖拽"之外的**第三条路径**，对应"已经选好了，懒得右键"的场景。

**实现路径**：通过 COM 接口 `IShellWindows` 枚举所有 Explorer 窗口，找到前台窗口，调用 `IShellBrowser::QueryActiveShellView()` → `IFolderView::GetSelectionMarkedItem()` 取选中项。这套 API 在 Windows 7+ 完全稳定，不依赖 UIAutomation。

实现位置：`uca-helper`（C# WPF Console）通过 SHDocVw + Shell32 互操作完成，结果通过 Named Pipe 推给 service。

**为什么不做"鼠标悬停文件即触发"**：
1. Explorer 不暴露 hover 事件，必须全局鼠标 Hook + 反复 UIAutomation 查询
2. 性能损耗大、电池续航差
3. 用户没有明确意图，违反 §2.1 低打扰原则
4. ROI 极低——按 `Ctrl+Shift+E` 一个键和点右键代价相同

### 2.2 不做

- 浏览器扩展（Phase 1c）
- 流式步骤可视化（Phase 2）
- 失败分类与重试（Phase 2）
- 隐私脱敏（Phase 2.5）
- Office 选区（Phase 4，本 Phase 只能处理 .docx 整文件）

### 2.3 范围红线
- 不支持 Office 内选区抓取
- 不支持 PDF 内选区抓取（只能整文件）
- 不做 OCR
- 不做"分析后自动写邮件"组合动作

## 3. 架构

### 3.1 新增组件

```
┌────────────────────────────────────┐
│  Explorer Context Menu Entry       │  ← 新增
│  - MVP：注册表命令 → uca-cli.exe     │
│  - 增强版：再评估 IExplorerCommand    │
│  - 负责把选中文件交给 uca-cli        │
└────────────┬───────────────────────┘
             │ launch with args
             ▼
┌────────────────────────────────────┐
│  uca-cli (Phase 1b 新增)           │
│  - "uca submit --files a.pdf b.md" │
│  - HTTP POST → uca-service         │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  uca-helper (C# WPF Console) ←新增  │
│  - 全局快捷键 Ctrl+Shift+E          │
│  - IShellWindows 枚举               │
│  - IFolderView::GetSelection 抓取   │
│  - Named Pipe → uca-service         │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  uca-service (扩展)                 │
│  + FileExtractor registry          │
│  + KimiCLIExecutor (真实)          │
│  + TaskPackageBuilder              │
│  + ArtifactStore (目录管理)         │
│  + Named Pipe Server (helper IPC)  │
└────────────────────────────────────┘
```

> Phase 1a 没有用到 Native Helper（仅靠 Electron 自带能力），Phase 1b 是 helper 第一次正式登场。

### 3.2 关键技术决策

| 项 | 选择 | 理由 |
|---|---|---|
| Explorer 菜单入口 | **MVP：注册表命令 + `uca-cli.exe`；增强版再评估 `IExplorerCommand`/COM** | 先保证稳定启动与易安装，避免把 in-proc Explorer 扩展变成 Phase 1b 阻塞项 |
| 命令行入口 | 独立 `uca-cli.exe`（Rust 或 .NET single-file） | 启动快、无需 Node 环境 |
| Shell ↔ Service | uca-cli 走 localhost HTTP 9412 → uca-service | 不引入 named pipe 复杂度 |
| PDF 解析 | `pdf-parse` (Node) | 简单文本可够用，复杂 PDF 留给 Kimi |
| DOCX 解析 | `mammoth` | 转 markdown 友好 |
| Kimi CLI 子进程 | 每任务起一个独立子进程 | 隔离崩溃 |
| Kimi 通信 | stdin/stdout JSON Lines + stderr 日志 | 符合 §9.4 注释 |
| 产物路径 | `%APPDATA%/UCA/outputs/YYYY-MM-DD/{task_id}/` | 易归档、易清理 |

### 3.2.1 Explorer 菜单入口的正式约束

Phase 1b 的 Explorer 集成分两层处理：

1. **默认交付**：注册表命令菜单 + `uca-cli.exe`
2. **后续优化**：Win11 现代菜单适配（`IExplorerCommand` / 顶层菜单体验）作为独立 ADR 或 stretch goal

这样做的目的，是先验证"文件如何稳定进入 service 并形成标准任务"，而不是把 in-proc Explorer 扩展变成 Phase 1b 的阻塞点。

实现时必须额外满足两个工程约束：

- **多选聚合**：注册表命令菜单对多选文件的行为是"Explorer 启动 N 次 `uca-cli.exe`，每次只传一个 `%1`"。因此 `uca-cli` 必须实现批量聚合模式：
  - 用 named mutex（例如 `Local\\UCA-Submit-{hash(parent_pid)}`）抢锁
  - 抢到锁的实例打开 200-500ms 收集窗口
  - 所有实例把各自文件路径 append 到同一个 `%TEMP%/UCA/submit-batch-{ts}.jsonl`
  - 收集窗口结束后，由主实例一次性提交给 `uca-service`，形成一个 `file_group`
- **Win11 入口折叠**：Win11 下注册表菜单默认会落入“显示更多选项 / Shift+F10”的二级菜单。Phase 1b 的 ship 标准接受这一现实，并把 `Ctrl+Shift+E` 作为 Win11 主入口宣传；现代菜单适配不占用本阶段主预算。

### 3.3 Kimi CLI Bridge 详细设计

**输入（写入子进程 stdin）**：

```json
{
  "task_id": "TASK-20260415-0001",
  "task_type": "report_generation",
  "user_command": "分析这个文件，生成详细报告",
  "context": {
    "source_type": "file",
    "file_paths": ["C:/docs/sample.pdf"],
    "metadata": { "mime_type": "application/pdf" }
  },
  "output_requirements": {
    "primary": "markdown_report",
    "save_required": true,
    "output_dir": "C:/Users/.../AppData/Roaming/UCA/outputs/2026-04-15/TASK-20260415-0001/"
  },
  "rules": {
    "must_read_source": true,
    "must_save_result": true,
    "must_return_artifact_paths": true,
    "must_emit_progress": true,
    "max_runtime_seconds": 600
  },
  "trace_id": "trace_xxx"
}
```

**输出（读取子进程 stdout，每行一个 JSON 事件）**：

```jsonl
{"type":"accepted","ts":1681540001000}
{"type":"started","ts":1681540001500}
{"type":"step_started","ts":1681540002000,"step":"read_pdf"}
{"type":"log","ts":1681540003000,"msg":"reading 24 pages"}
{"type":"step_finished","ts":1681540006000,"step":"read_pdf"}
{"type":"step_started","ts":1681540006500,"step":"summarize"}
{"type":"log","ts":1681540008000,"msg":"chunk 1/3 done"}
{"type":"artifact_created","ts":1681540030000,"path":".../report.md","mime":"text/markdown"}
{"type":"success","ts":1681540030500,"summary":"Report generated, 8 sections"}
```

**进程管理规则**：
- 心跳：每 30s 主进程发 `{"type":"ping"}` 到 stdin，30s 内必须收到 `pong`
- 超时：max_runtime_seconds 到时强制 kill
- 资源限制：Windows Job Object 限制内存 2GB、CPU 50%
- 失败兜底：进程异常退出 → 任务标 failed → 自动降级到 FastExecutor 给一个简版结果

### 3.4 ContextPacket 演进

Phase 1b 引入：

```jsonc
{
  "schema_version": "1.0",
  "context_id": "ctx_xxx",
  "trace_id": "trace_xxx",
  "source_type": "file_group",
  "source_app": "explorer.exe",
  "capture_mode": "shell_menu",
  "file_paths": ["C:/a.pdf", "C:/b.docx"],
  "file_metadata": [
    { "path": "C:/a.pdf", "size": 102400, "mime": "application/pdf", "page_count": 24 },
    { "path": "C:/b.docx", "size": 51200, "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
  ],
  "captured_at": "2026-04-15T10:00:00+08:00"
}
```

## 4. 流程设计

### 4.1 文件右键菜单流程

```
User                Explorer        Shell Ext         uca-cli         uca-service
 │  右键 a.pdf        │                │                │                │
 ├──────────────────►│                │                │                │
 │                   │ load IExplCmd  │                │                │
 │                   ├───────────────►│                │                │
 │                   │ 显示 "用 UCA"   │                │                │
 │  点击该项          │                │                │                │
 ├──────────────────►│                │                │                │
 │                   │                │ exec uca-cli    │                │
 │                   │                │  submit --files │                │
 │                   │                ├───────────────►│                │
 │                   │                │                │ HTTP /context  │
 │                   │                │                ├───────────────►│
 │                   │                │                │  ctx_id        │
 │                   │                │                │◄───────────────┤
 │                   │                │                │ HTTP /task     │
 │                   │                │                ├───────────────►│
 │                   │                │                │  task_id       │
 │                   │                │                │◄───────────────┤
 │                   │                │                │ exit 0         │
 │                   │                │                │                │
 │ 见浮窗弹出 "正在处理 a.pdf"          │                │                │
 │◄────────────────────────────────────────────────────────────────────│
 │                                                                       │
 │  几分钟后浮窗 "已完成，点击查看报告"                                       │
 │◄────────────────────────────────────────────────────────────────────│
```

### 4.2 文件→Kimi 深任务流程

```
service.createTask(file_context, intent=generate_report)
  → IntentRouter 命中 generate_report
  → 选择 Executor: KimiCLIExecutor (capability 匹配)
  → confirmation? requires_confirmation=true → 浮窗弹出确认
  → confirmed
  → TaskQueue 入队 (max concurrent kimi tasks = 2)
  → 调度执行
    → KimiCLIExecutor.execute(task)
      → 创建 output_dir
      → 构造 task_package
      → spawn kimi.exe
      → write stdin
      → for await chunk of stdout
        → parse JSON Line
        → emit TaskEvent → EventBus → UI
      → on close
        → if exit_code === 0 → status=success
        → else → status=failed
      → write all events to SQLite
```

### 4.3 文件组并发处理

- 单文件：直接处理
- 多文件 (≤5)：发一个任务包，里面包含 file_paths 数组，让 Kimi 自己规划
- 多文件 (>5)：UI 警告 "文件较多，建议拆分"，但仍允许提交
- 文件总大小 > 100MB：拒绝，提示用户

## 5. 验收标准

### 5.1 功能验收
- [ ] Win10/Win11 上右键 PDF/DOCX/MD/TXT 能看到 "用 UCA 分析" 菜单
- [ ] 点击菜单后 ≤ 1s 内浮窗显示 "已识别 1 个文件"
- [ ] 拖拽文件到浮窗能产生同样效果
- [ ] **`Ctrl+Shift+E` 快捷键能读取前台 Explorer 的当前选中文件并触发浮窗**
- [ ] **多选 5 个文件 + 快捷键 → file_group 正常处理**
- [ ] **没有 Explorer 在前台时，快捷键 fallback 为浮窗"请选择文件"提示**
- [ ] 多选 3 个文件右键，能进入 file_group 流程
- [ ] "生成报告" 动作能调用真实 Kimi CLI 并产出 .md 文件
- [ ] 任务中心可按文件路径搜索、按状态/类型筛选
- [ ] 产物文件能通过任务详情页一键打开 / 打开目录
- [ ] Kimi 执行中按"取消"能 kill 子进程并标 cancelled
- [ ] Kimi 子进程崩溃时任务标 failed 且日志可见

### 5.2 性能验收
- [ ] Shell 菜单点击到浮窗显示 ≤ 1s（P95）
- [ ] 文件 mime 识别 ≤ 50ms
- [ ] PDF 文本提取 ≤ 5s（10MB 内）
- [ ] Kimi 子进程启动 ≤ 3s

### 5.3 工程验收
- [ ] Shell Extension 能用 inno setup 安装/卸载且不留垃圾注册表
- [ ] uca-cli 体积 ≤ 10MB
- [ ] 单测：FileExtractor 全部 mime、TaskPackageBuilder、Kimi event parser
- [ ] 集成测试：模拟 Kimi CLI（一个 mock 脚本）跑完整 happy path 和 failure path
- [ ] 文档：Shell Ext 安装/卸载步骤、Kimi CLI 配置步骤

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Shell Extension 与杀软冲突 | 用户菜单看不到 | 只签名后的 dll 才注册；提供日志和故障排查文档 |
| Win11 现代菜单 vs Win10 经典菜单适配 | 行为不一致 | 同时实现 IExplorerCommand 和老版 IShellExtInit/IContextMenu |
| 大 PDF 解析 OOM | service 崩溃 | 文件 > 100MB 拒绝；解析放在子进程而非 service 内 |
| Kimi CLI 用户没装 | 深任务全部失败 | 启动时检测，引导安装；UI 显示"Kimi 不可用，仅轻动作可用" |
| 用户路径含中文/空格 | 命令行解析失败 | 全部走绝对路径 + 引号包裹 + UTF-8 编码 |
| 同一文件被多次提交 | 重复任务 | content_hash 去重，命中时提示"5 分钟前已处理过，复用？" |
| 产物目录爆盘 | 用户磁盘满 | 默认 30 天自动清理，可在设置中关闭 |

## 7. 交付物清单

```
new components:
  shell_ext/                C# COM Shell Extension 项目
  uca-cli/                  独立命令行（Rust 或 .NET single-file）
  src/service/extractors/   PDF/DOCX/MD/TXT
  src/service/executors/kimi/   真实 Kimi CLI Bridge
  src/service/store/artifacts.ts
docs:
  shell_ext_install.md
  kimi_cli_setup.md
  phase_1b_demo.mp4
```

## 8. 与下一 Phase 的接口

[Phase 1c](phase_1c_browser_extension.md) 引入浏览器扩展时：
- ContextPacket 已经准备好接收 `source_type=text_selection|link|webpage`
- Native Messaging Host 进程会向 uca-service 走同样的 HTTP 9412 端口
- IntentRouter 会增加 `extract_url_content` `summarize_webpage` 等意图
- Phase 1b 完成时不要把 `source_type` 限定为只能 file，要保持开放
