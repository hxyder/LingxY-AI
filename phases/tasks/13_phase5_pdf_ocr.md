# Task UCA-013 — Phase 5 PDF 高级解析与按需 OCR

## 1. 任务目标

补齐复杂 PDF、扫描件、截图和图片理解能力。

## 2. 前置依赖

- 上一个任务：UCA-009、UCA-005
- 必须已有的产物：文件入口、helper、Security Broker
- 不能同时修改的区域：Office spike

## 3. 实施范围

- 负责模块：PDF 文本解析、OCR、截图工具、剪贴板图片、多模态执行器
- 允许改动文件/目录：`src/service/extractors/`, `src/helper/Screenshot/`, `external/paddle_ocr_runtime/`
- 明确不做：后台屏幕监控

## 4. 交付产物

- 文本 PDF 抽取
- 扫描 PDF OCR
- 截图工具
- 图片理解任务

## 5. 验证方式

- PDF 语料测试集
- OCR 准确率与性能基线
- 手动验证截图 → OCR → 总结

## 6. Git 执行方式

- 分支名：`task/uca-013-phase5-pdf-ocr`
- Commit 格式：`UCA-013: add pdf parsing and on-demand ocr`
- 合并条件：文本 PDF、扫描 PDF、截图三条路径都通过

## 7. 完成后必须更新本文件

- 写明 OCR 引擎版本
- 写明 PDF 语料集结果
- 记录多模态成本控制策略

## 8. 对下一个任务的交接

- 下一个任务：UCA-014
- 本任务新增了什么：PDF/OCR 与 image source pipeline
- 下一个任务直接可复用什么：多模态 executor、OCR 产物格式
- 还没解决的问题：公式 OCR、手写体仍未覆盖

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
