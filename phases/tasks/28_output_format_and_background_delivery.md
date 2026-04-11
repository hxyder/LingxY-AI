# Task UCA-028 — 输出格式协商与后台交付

## 1. 任务目标

把当前固定输出 `report.md` 的执行链升级为“按用户要求返回结果文件”，并把 Overlay 提交后的体验调整为后台执行优先，减少等待时的窗口干扰。

## 2. 前置依赖

- 上一个任务：UCA-027
- 必须已有的产物：Kimi Code CLI 主链、Overlay 气泡会话、结果摘要预览
- 不能同时修改的区域：已冻结协议 schema 与非 Kimi 执行器的核心行为

## 3. 实施范围

- 负责模块：输出格式识别、Kimi 结果落盘策略、后台执行提示、Overlay 返回格式选择
- 允许改动文件/目录：`src/service/executors/kimi/`, `src/desktop/renderer/`, `scripts/`, `phases/tasks/`
- 明确不做：云端 provider 的格式化返回、独立导出工作流、复杂模板驱动文档排版

## 4. 交付产物

- 输出格式识别模块
- Overlay 内的返回格式选择按钮
- Kimi 执行结果按用户要求保存为常见文件格式
- 提交后后台执行提示与完成通知
- 对应验证脚本更新

## 5. 验证方式

- `node scripts/verify-file-kimi.mjs`
- `node scripts/verify-overlay-composer.mjs`
- `npm run check`

## 6. Git 执行方式

- 分支名：`task/uca-028-output-format`
- Commit 格式：`UCA-028: support requested output formats`
- 合并条件：至少支持 `md / txt / html / json / docx` 其中一组稳定产出，并通过自动校验

## 7. 完成后必须更新本文件

- 写明当前支持的返回格式范围
- 写明后台执行时用户会看到的提示和通知
- 写明还没支持的复杂格式或排版限制

## 8. 对下一个任务的交接

- 下一个任务：统一网页 / 图片 / 文字选区的一致交互入口
- 本任务新增了什么：格式协商、后台交付提示、结果文件多样化
- 下一个任务直接可复用什么：Overlay 格式选择器、结果 artifact 策略、完成通知
- 还没解决的问题：复杂 Office 排版、富文本模板导出、跨 provider 的统一格式生成

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-09
- 完成日期：2026-04-11
- 实际新增内容：新增 `src/service/executors/kimi/output-format.mjs` 作为输出格式协商模块；扩展 `src/service/executors/kimi/task-package-builder.mjs` 与 `src/service/executors/kimi/print-mode-prompt.mjs`，把用户请求的格式要求透传给 Kimi 执行链；扩展 `src/service/executors/kimi/kimi-cli-executor.mjs`，使其能按请求落盘为 `md / txt / html / json / docx / csv` 这一档结果文件，并在 `docx` 场景同步生成可预览的 `txt` 摘要；扩展 `src/desktop/renderer/overlay.html` 与 `src/desktop/renderer/overlay.js`，加入“返回格式”选择按钮、后台处理中通知、预览优先选择可读 artifact；同步更新测试夹具与验证脚本，覆盖多格式产出；顺手收掉了 Dock 外圈边框与虚线视觉噪音。
- 验证结果：`node scripts/verify-file-kimi.mjs`、`node scripts/verify-overlay-composer.mjs`、`npm run check` 通过。
- 遗留问题：复杂 Office 排版仍未实现，当前 `docx` 更偏“文本落文档”；`xlsx / pptx` 仍是提取链可读，不是结果导出格式；云端 provider 还没有统一接入这套格式协商能力。
  - **[2026-04-11 新增]** 用户反馈：输入 "分析 AI 发展趋势，并生成一份 ppt" 时，系统退化为 `report.md` 加一句免责声明 —— 根因是 `detectRequestedOutputFormat` 完全没有 pptx 分支，`print-mode-prompt` 里的 `"Do not modify any source files"` 也劝退 LLM 写文件。**pptx 要并入 UCA-049 的 provider 无关 agentic 文档生成通道**（`detectRequestedOutputFormat`、`generate_document`、`create-ooxml-fixture.ps1 -Kind pptx`、provider-aware task event 一起落地），完成后本文件这一条同步划掉。
- 交接给下一个任务：可以直接基于 Overlay 里的“返回格式”选择器继续做网页 / 图片 / 文字入口统一，也可以在结果中心里复用新的 artifact 策略，不需要再改 Kimi 主链；pptx 的真正落地交给 UCA-049。
