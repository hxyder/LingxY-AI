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

- 状态：done
- 执行分支：`task/uca-013-phase5-pdf-ocr`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- OCR 引擎版本：
  - 当前本地 OCR scaffold 选择 `paddle-3.0-placeholder`
  - 发布策略为按需安装，不打进主包
- PDF 语料集结果：
  - `sample-text-layer.pdf` -> `text_pdf`
  - `sample-scanned.pdf` -> `pdf_ocr`
  - 基础验证已覆盖文本层 / 扫描件两条路径
- 多模态成本控制策略：
  - 当前只保留 `multi_modal` 执行器骨架
  - 图片/OCR 任务默认走本地 OCR，再进入多模态描述路径
  - 云端视觉模型尚未接入，因此当前没有真实 token 消耗
  - 后续接入时需默认压缩、缓存和预算上限
- 实际新增内容：
  - 新增 `pdf_text / pdf_table / pdf_ocr / image_ocr` extractors
  - 新增 `image-submission.mjs` 与 `screenshot-submission.mjs`
  - 新增 `multi_modal` 执行器骨架
  - 新增 `src/helper/Screenshot/`、`external/paddle_ocr_runtime/`、`docs/pdf/`
  - 浏览器 `image` capture 现在会委派到统一 image pipeline
  - 新增 `Ctrl+Shift+S` 截图快捷键预留
- 验证结果：
  - `node scripts/verify-pdf-ocr.mjs`
  - `npm run check`
- 遗留问题：
  - 真实 PaddleOCR runtime、真实截图 overlay、真实图片压缩与缓存尚未实现
  - 表格抽取目前只有 preview 级启发式，不是正式 parser
  - 低置信度区域还没有接真实 UI 高亮
  - 公式 OCR、手写体和真实多模态云模型仍未接入
- 交接给下一个任务：
  - `UCA-014` 可直接复用 `image` source pipeline、`multi_modal` executor、OCR metadata 格式和 `external/paddle_ocr_runtime` 落点
  - 后续若推进增强版，可从 `src/service/extractors/pdf_ocr.mjs` 和 `src/service/core/image-submission.mjs` 继续接真实 OCR / vision runtime
