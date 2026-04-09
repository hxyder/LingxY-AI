# Task UCA-017 — 真实 AI Provider、Kimi 与多模态运行时

## 1. 任务目标

把当前 provider / code CLI / OCR / vision 占位实现替换成真实运行时，并补齐配置检测与成本回写。

## 2. 前置依赖

- 上一个任务：UCA-015、UCA-016
- 必须已有的产物：真实运行时、真实输入源、预算与 executor registry 基线
- 不能同时修改的区域：发布打包与最终 E2E 矩阵

## 3. 实施范围

- 负责模块：Kimi 安装检测、OpenAI / Claude / Ollama adapter、真实模型调用、PaddleOCR runtime、PDF 正式解析、vision path
- 允许改动文件/目录：`src/service/ai/`, `src/service/executors/`, `src/service/extractors/`, `external/paddle_ocr_runtime/`, `docs/runtime/`, `docs/pdf/`
- 明确不做：团队协作、插件市场

## 4. 交付产物

- 真实 provider 配置检测
- 真实 Kimi / OpenAI / Claude / Ollama 运行时
- 真实 OCR 与 PDF 解析
- 成本回写与 provider 健康检查

## 5. 验证方式

- `npm run check`
- 每类执行器至少 1 条真实 happy path
- OCR / PDF 语料回归
- 成本与 budget 回写验证

## 6. Git 执行方式

- 分支名：`task/uca-017-real-ai`
- Commit 格式：`UCA-017: wire real ai and multimodal runtimes`
- 合并条件：至少 2 个云端执行器 + 1 个本地执行器 + OCR 路径均可真实运行

## 7. 完成后必须更新本文件

- 写明 provider 配置项与检测规则
- 写明 OCR / PDF runtime 版本
- 记录真实成本回写字段

## 8. 对下一个任务的交接

- 下一个任务：UCA-018、UCA-019、UCA-020
- 本任务新增了什么：真实模型与多模态运行时
- 下一个任务直接可复用什么：provider health、真实 token / cost 数据、OCR / vision 产物
- 还没解决的问题：UI 完整接线、模板持久化、最终发布验证

## 9. 执行记录

- 状态：todo
- 执行分支：`task/uca-017-real-ai`
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
