# LingxY AI Desktop

[English](README.md)

LingxY 是一个本地优先的 Windows 桌面 AI 工作区。它可以理解你正在使用的窗口，执行带工具调用的任务，生成文档，管理定时任务，并在高风险副作用执行前先让你确认。默认情况下数据保留在本机；模型和连接器请求从你的电脑直接发往你配置的服务商。

## 亮点

- 本地桌面入口：overlay、dock、console、popup card 和 artifact preview。
- 自带服务商配置：OpenAI-compatible API、DeepSeek、Anthropic、Kimi、Ollama，以及 Claude Code、Codex、Kimi CLI 等 CLI agent。
- 工具化工作流：网页搜索、文件操作、文档生成、截图、应用启动、定时任务、邮件/日历/网盘连接器、MCP、插件和 Skills。
- 副作用先审批：发送邮件、修改连接账号等高风险操作会先生成草稿或审批卡，由你确认后再执行。
- 本地运行时数据：任务、会话、产物、服务商设置和运行状态保存在本机运行时目录。

## 仓库结构

```text
src/                 应用、运行时、桌面 shell、工具和连接器
assets/              品牌与应用资源
browser_ext/         浏览器扩展集成
office_addin/        Office 加载项集成
scripts/             运行时、打包、安装和公开 smoke 脚本
tests/behavior/      少量公开行为测试
docs/                用户与运行时文档
```

内部 verifier 清单、release evidence、真实 API 报告、下载模型、运行时数据库和本地密钥不会包含在这个公开导出仓库里。

## 环境要求

- Windows 10 或更高版本
- Node.js 22.x
- npm

部分能力可能还需要模型服务商 API Key、连接器凭据、Python 辅助脚本或本地模型运行时。

## 开发

```powershell
npm ci
npm run check:public
npm run start:runtime
npm run start:desktop
```

常用命令：

```powershell
npm test
npm run smoke:runtime
npm run smoke:desktop
npm run pack
npm run dist
```

## 配置

启动应用后，在桌面 console 里配置模型服务商和连接器。不要提交 `.env`、本地运行时数据、API Key、OAuth secret、任务报告或生成产物。

## GitHub 上传

这个目录已经按公开源码仓库准备。创建一个空 GitHub 仓库后，把它添加为 `origin`，再推送 `main`。

## 许可证

MIT。见 [LICENSE](LICENSE)。
