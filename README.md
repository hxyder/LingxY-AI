# UCA — Universal Context Agent

UCA 是一款运行在 Windows 桌面的 AI 助手。它通过悬浮 Overlay 随时响应你的指令，能感知当前活跃窗口的内容（网页 URL、文件路径、选中文本），并通过可扩展的工具体系完成各种自动化任务。

---

## 功能概览

### 核心能力

| 功能 | 说明 |
|---|---|
| **悬浮 Overlay** | 全局快捷键唤起，悬浮在任意窗口之上，不打断当前工作 |
| **活跃窗口感知** | 自动捕获 Chrome/Edge 当前 URL、资源管理器路径、选中文字，作为任务上下文 |
| **多 AI 提供商** | 支持 Anthropic Claude、OpenAI/兼容接口、Ollama 本地模型、DeepSeek、Kimi CLI |
| **工具调用（Agentic）** | AI 可主动调用 30+ 内置工具完成文件操作、网页搜索、代码执行、日程管理等 |
| **MCP 工具集成** | 通过 Model Context Protocol 接入文件系统、记忆存储、网页搜索、浏览器自动化 |
| **GUI 自动化** | 通过 Windows UIAutomation 查找 UI 元素、模拟点击和键盘输入 |
| **定时任务** | 支持 cron、间隔、文件监视触发器，可在后台自动执行任务 |
| **邮件监控** | 接入 IMAP / Microsoft Graph，自动生成晨间摘要，将重要邮件转为任务 |
| **技能系统** | 支持 SKILL.md 自定义技能，可自动识别重复操作并提议保存为可复用技能 |
| **历史语义搜索** | 本地历史任务支持语义向量搜索（配置向量 API 后生效），默认回退到 TF-IDF |

### 当前稳定能力与限制

稳定可用：

- `npm run pack` 可生成本地目录包到 `dist\win-unpacked`，并在打包后自动恢复 Node 侧 `better-sqlite3` ABI。
- `generate_document` 可生成 DOCX / XLSX / PPTX；PDF 会优先通过 Edge/Chrome headless 转换，失败时返回明确 HTML fallback。
- 浏览器图片/链接捕获会写入真实 artifact，不再生成文本占位文件。
- 图片 OCR 会优先使用 Windows OCR，随后尝试 Tesseract；失败时返回空 OCR 结果供 Vision 模型处理。

仍有限制：

- `npm run dist` 的 NSIS/release 打包在当前 Windows 会话会卡在 electron-builder `winCodeSign` 解压阶段；需要具备创建符号链接权限的环境。
- 扫描版 PDF 会在安装 `pdftoppm` 时尝试渲染页面并走图片 OCR；没有可用 raster OCR 路径时返回 `pdf_ocr_unavailable`，不会返回合成 OCR 文本。
- `local-fs` / `figma` MCP 条目是 legacy/external-plugin 状态；推荐使用 `mcp-filesystem`，Figma 需要外部 MCP 插件。
- Kimi real runtime 验证依赖账号额度；额度耗尽时验证会跳过真实调用。

### 内置工具（供 AI 调用）

**信息获取**
- `web_search_fetch` — DuckDuckGo 免费网页搜索 + 内容抓取
- `translate_text` — 免费翻译（无需 API Key）
- `take_screenshot` — 截图

**文件与文档**
- `write_file` / `read_file` — 文件读写
- `list_files` / `glob_files` / `find_recent_files` — 文件查找
- `generate_document` — 生成 pptx / docx / xlsx / pdf 文档
- `open_file` / `reveal_in_explorer` — 打开文件或在资源管理器中显示

**系统操作**
- `launch_app` — 启动应用（支持微信、钉钉、腾讯会议、Chrome 等）
- `open_url` — 打开网页
- `run_script` — 执行 PowerShell / Node.js / Python 脚本
- `copy_to_clipboard` / `read_clipboard` — 剪贴板读写
- `notify` — 系统通知

**日程管理**
- `create_scheduled_task` / `list_scheduled_tasks` / `delete_scheduled_task`

**GUI 自动化**（需用户逐步确认）
- `gui_find_element` — 通过 Windows UIAutomation 查找 UI 元素
- `gui_click` — 模拟鼠标点击
- `gui_type_text` — 向 UI 元素输入文字

**MCP 工具**（通过 client-bridge 自动发现）
- `mcp_filesystem__*` — 文件系统操作（内置，默认开启）
- `mcp_memory__*` — 跨会话 KV 记忆（内置，默认开启）
- `mcp_brave_search__*` — Brave 网页搜索（需配置 API Key 后启用）
- `mcp_puppeteer__*` — 浏览器自动化（需手动启用）

---

## 安装与运行

### 环境要求

- **操作系统**: Windows 10 / 11 (x64)
- **Node.js**: v18+（推荐 v22）
- **PowerShell**: 5.1+（系统自带）

### 开发模式运行

```bash
# 安装依赖
npm install

# 启动后台服务（HTTP / SSE 接口）
npm run start:runtime

# 启动 Electron 桌面应用（另开终端）
npm run start:desktop
```

`start:desktop` 会清理当前终端里可能残留的 `ELECTRON_RUN_AS_NODE`，避免 Electron 被当成普通 Node 进程启动，导致托盘图标和全局快捷键不生效。

### 打包

```bash
# 本地目录包，输出到 dist/win-unpacked
npm run pack

# 生成 NSIS 安装程序到 dist/ 目录
# 当前机器需要具备创建符号链接权限，否则 winCodeSign 解压会失败
npm run dist
```

---

## 配置说明

### AI 提供商配置

打开 **Overlay → 右下角设置图标 → Console**，在 **Settings → Providers** 中添加提供商：

| 提供商类型 | 配置项 |
|---|---|
| Anthropic Claude | API Key |
| OpenAI / 兼容接口 | Base URL + API Key |
| Ollama | Base URL（默认 http://localhost:11434） |
| Code CLI（Claude Code / Kimi CLI） | 可执行文件路径 |

配置文件保存在 `%APPDATA%\UCA\config\runtime.json`，支持热重载（无需重启）。

### MCP 服务器管理

在 Console → **Connectors → MCP 服务器** 中可以：
- 查看内置 MCP 服务器状态（已安装 / 已启用 / 不可用）
- 开启 / 关闭各服务器
- 为 Brave Search 配置 API Key

所有已启用的 MCP 服务器工具会在下次任务运行时自动注入到 AI 的工具列表中，**Anthropic/OpenAI 等原生 API 提供商同样可以调用**。

### 邮件 Connector

在 Console → **Connectors → 邮件账户** 中：
- 添加 IMAP 账户（服务器、端口、用户名、密码）
- 或添加 Microsoft 365 账户（Graph API Token）
- 开启「自动创建 Schedule」、「晨间摘要」等选项

晨间摘要在每天 6:00–10:00 之间程序启动后 5 分钟内自动推送到 Overlay。

### 技能（Skills）

将自定义技能目录放到：
```
%APPDATA%\UCA\data\integrations\skills\<技能ID>\SKILL.md
```

`SKILL.md` 格式：
```markdown
---
id: my-skill
name: 我的技能
description: 技能的简要描述
---

## 使用场景
...

## 操作步骤
1. web_search_fetch
2. write_file
```

AI 在每次任务开始时会自动发现并读取所有技能。

当你重复执行相同的操作流程 **3 次以上**，UCA 会自动识别并提示是否保存为技能，点击「保存为技能」即可自动生成 SKILL.md。

---

## 使用方法

### 唤起 Overlay

- **快捷键**（默认）: `Alt + Space` 或系统托盘图标点击
- Overlay 浮在当前活跃窗口上方，输入框直接输入指令

### 基本用法示例

```
打开微信
搜索最新的 AI 新闻并总结
把这个网页的内容翻译成英文
帮我写一份今天的工作总结，保存为 docx
每天早上 9 点提醒我查看邮件
```

### 分析当前页面

在 Chrome/Edge 中浏览网页时，Overlay 顶部会显示当前 URL 预览卡片，点击「分析此页面」即可让 AI 抓取并分析当前网页内容。

### 定时任务

```
每周一早上 9 点生成本周工作计划
每天下午 6 点检查未完成的任务并发送提醒
```

任务会在后台静默执行，完成后通过 Overlay 气泡通知你。

### 任务历史

Console → **History** 可查看所有历史任务、搜索记录，支持语义搜索。

---

## 数据存储位置

所有运行时数据存储在：

```
%APPDATA%\UCA\
├── config\
│   └── runtime.json          AI 提供商、邮件账户等配置
├── data\
│   ├── uca.db                SQLite 数据库（任务、日程、指标）
│   ├── integrations\
│   │   ├── mcp\              自定义 MCP 服务器配置
│   │   └── skills\           技能文件
│   ├── history\
│   │   └── embeddings.json   历史任务语义索引
│   └── skill-patterns.json   重复操作识别记录
├── logs\                     运行日志
└── outputs\                  AI 生成的文件（默认输出目录）
```

---

## 验证与调试

```bash
# 运行所有验证脚本（约 30 秒）
npm run check

# 运行单个子系统验证
node scripts/verify-platform-foundation.mjs
node scripts/verify-action-tools.mjs
node scripts/verify-agentic-planner.mjs
```

---

## 开源许可

本项目使用的第三方开源软件及其许可证见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

---

## 目录结构

```
src/
  desktop/
    tray/               主进程（Electron main、系统托盘、活跃窗口检测）
    renderer/
      overlay.js        悬浮助手 UI 逻辑
      console.js        设置面板（提供商、Connectors、历史）
      dock.js           任务计数徽章 + 呼吸动效
  service/
    core/               HTTP/SSE 服务器、任务运行时、调度器
    executors/
      agentic/          通用 Agentic 执行器（任意提供商）
      fast/             轻量 LLM 调用执行器
      kimi/             Kimi CLI 执行器
    action_tools/       30+ 内置工具（定义 + 执行 + Schema）
    ai/
      mcp/              MCP 注册表 + 内置服务器 + 客户端 Bridge
      skills/           技能注册表
    email/              邮件监控 + 晨间摘要
    embeddings/         语义向量存储
    scheduler/          定时任务引擎
    security/           安全代理、审计日志、隐私保护
scripts/
  verify-*.mjs          子系统验证脚本（共 32 个）
```
