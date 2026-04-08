# Phase 5 — PDF 与按需 OCR

> 周期估计：W27–W30（4 周） · 角色：1 后端 + 0.5 桌面
> 上一阶段：[Phase 4](phase_4_office_integration.md) · 下一阶段：[Phase 6](phase_6_advanced_orchestration.md)

## 1. 目标

把 PDF 与"看得到但抓不到"的内容补上：
- 复杂 PDF（含表格、双栏、扫描）能稳定解析
- 用户主动截图后 OCR 识别，作为新 ContextPacket
- 图片/截图剪贴板支持

> **范围降级说明**：原方案 Phase 5 包含"无法原生读取时的视觉 fallback"，建议**只做用户主动触发的截图 OCR，不做后台屏幕监控**。理由见主方案 §22.4。

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | PDF 高级解析器 | 双栏、表格、目录、章节 |
| 2 | 扫描版 PDF OCR | tesseract.js 或 PaddleOCR (本地) |
| 3 | 表格抽取 | camelot-py / pdfplumber 或服务化 |
| 4 | 截图工具 | 用户按 `Ctrl+Shift+S` 截屏 |
| 5 | 截图 OCR | 同 PDF OCR 引擎 |
| 6 | 剪贴板图片 | clipboard.readImage 直接进入 image 流 |
| 7 | 图像理解 | 调云端多模态 LLM (Claude / GPT-4V) |
| 8 | OCR 结果可编辑 | 用户可在 UI 校正后再发任务 |
| 9 | OCR 结果置信度 | 显示低置信度区域 |
| 10 | image source_type 完整化 | 先存到 artifact 目录，再喂给执行器 |

### 2.2 不做

- 后台屏幕监控（**永久放弃**）
- 实时屏幕选区识别
- 高级文档版式还原（保留样式 → markdown 即可）
- 公式 OCR（Phase 6 评估）
- 手写体识别（Phase 6 评估）

## 3. 架构

### 3.1 PDF 解析路径

```
PDF File
  │
  ▼
[Detector]
  ├─ 文本层存在 + 文字数量足够 → text_pdf path
  └─ 文本层缺失/极少 → scanned_pdf path

text_pdf path:
  → pdf-parse / pdfjs-dist 抽文本
  → pdfplumber-equivalent (TS or 子进程 Python) 抽表格
  → 元数据：页数、目录、章节
  → 输出 ContextPacket(file)

scanned_pdf path:
  → render each page to PNG
  → batch OCR (tesseract / paddle)
  → 拼接文本 + 置信度
  → 输出 ContextPacket(file, ocr_applied=true)
```

### 3.2 OCR 引擎选择

| 引擎 | 优点 | 缺点 | 选择 |
|---|---|---|---|
| tesseract.js (WASM) | 纯 JS、无依赖、跨平台 | 慢、中文一般 | 备选 |
| PaddleOCR (Python) | 中文好、快 | 需 Python 子进程 + 模型下载 | **首选** |
| 云端 OCR (Azure/Google) | 最准 | 隐私问题 + 成本 | 仅企业版可选 |

**MVP 首选 PaddleOCR**：通过 Python 子进程调用，service 启动时检测/引导安装。

### 3.3 截图工具

```
User → Ctrl+Shift+S
  → uca-helper (C# Native Helper) 调起截图 overlay
  → 用户拖框选区
  → 保存到 %TEMP%/UCA/screenshots/{ts}.png
  → 通知 service 创建 ContextPacket(image)
  → 浮窗显示 "已截图，可选动作"
```

注：Phase 5 是第一次启用 Native Helper 的截图功能，Phase 1a/1b 没用到。如果时间紧，可暂用 Electron 的 `desktopCapturer + canvas crop` 替代，但是体验稍差。

### 3.4 ContextPacket 新字段

```jsonc
{
  "source_type": "image",
  "image_paths": ["%TEMP%/UCA/screenshots/2026-04-29-1430.png"],
  "image_metadata": {
    "width": 1920,
    "height": 1080,
    "source": "screenshot|clipboard|file",
    "ocr_text": "...",                  // OCR 后填
    "ocr_confidence": 0.92,
    "ocr_low_confidence_regions": [...],
    "ocr_engine": "paddle-3.0"
  }
}
```

## 4. 流程设计

### 4.1 截图 → OCR → 总结

```
1. 用户按 Ctrl+Shift+S
2. 截图 overlay 出现，用户拖框
3. helper 保存 png → 通知 service
4. service 创建 ContextPacket(image), 立即显示浮窗
5. 浮窗显示截图 + 进度 "OCR 识别中..."
6. PaddleOCR 子进程返回文本 + 置信度
7. 浮窗显示识别文本（可编辑）
8. 用户校正 → 点"总结"
9. service 把校正后的文本作为新 text_selection 喂给 FastExecutor
10. 流式结果
```

### 4.2 PDF 智能分支

```
service.handleFile(pdf):
  packet = await pdfDetector.analyze(pdf)
  if packet.has_text_layer:
    extractor = PdfPlumberExtractor
  else:
    extractor = OcrPdfExtractor   // render → ocr
  context = extractor.extract(pdf)
  → continue normal task flow
```

### 4.3 图像理解（多模态）

```
ContextPacket(image) + intent="describe_image"
  → MultiModalExecutor
  → call Claude Sonnet 4 (vision) 或 GPT-4V
  → 流式返回描述
```

需要把图片 base64 后塞进 LLM 请求。注意：
- 图片 > 1MB 自动压缩到 1024×1024
- 压缩前计算 sha256 缓存命中
- Security Broker 检查图片是否在敏感窗口

## 5. 验收标准

### 5.1 功能验收
- [ ] 文本 PDF (含表格) 抽取覆盖率 ≥ 90%
- [ ] 扫描 PDF (中文 200dpi) OCR 准确率 ≥ 92%
- [ ] 截图工具调起 ≤ 200ms
- [ ] 截图 OCR (1080p) ≤ 3s（PaddleOCR）
- [ ] OCR 文本可校正再发任务
- [ ] 剪贴板图片直接进入 image 流
- [ ] 图像理解任务能拿到合理描述
- [ ] 低置信度区域在 UI 高亮
- [ ] 缺失 PaddleOCR 时给清晰安装引导

### 5.2 性能验收
- [ ] PDF 文本抽取 (50 页) ≤ 3s
- [ ] 扫描 PDF (50 页) OCR ≤ 60s（用户能看到进度）
- [ ] 截图保存 ≤ 100ms

### 5.3 工程验收
- [ ] PaddleOCR 子进程健康检查 + 自动重启
- [ ] 测试集：≥ 30 个真实 PDF（含中英文/扫描/双栏/表格）
- [ ] 故障注入：OCR 子进程崩溃时任务正确降级到 failed
- [ ] 文档：OCR 引擎安装、PDF 测试集说明

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| PaddleOCR 模型 200MB+ | 安装包暴增 | 安装时按需下载，不打进主包 |
| Python 依赖管理混乱 | 用户装不上 | 用 portable Python embed (~30MB) |
| 扫描 PDF 性能差 | 用户等待长 | 分页流式处理，用户能看到进度 |
| 多模态 API 成本高 | Token 失控 | 默认压缩到 1024×1024；月预算限制 |
| 截图 overlay 在多显示器位置错乱 | 截不到 | 用 PerMonitorV2 DPI Aware |
| OCR 误识别 PII | 隐私泄漏 | OCR 后再过 Security Broker 脱敏 |

## 7. 交付物清单

```
src/service/
  ├─ extractors/
  │   ├─ pdf_text.ts
  │   ├─ pdf_table.ts
  │   ├─ pdf_ocr.ts
  │   └─ image_ocr.ts
  ├─ executors/
  │   └─ multi_modal/
src/helper/                   (C# .NET)
  ├─ Screenshot/
  │   ├─ OverlayWindow.cs
  │   └─ Capture.cs
external/
  └─ paddle_ocr_runtime/      (Python embed + model)
docs:
  ├─ pdf_test_corpus.md
  ├─ ocr_engine_setup.md
  └─ phase_5_demo.mp4
```

## 8. 与下一 Phase 的接口

Phase 6 是平台化阶段。Phase 5 的 PDF/OCR 执行器、多模态执行器都会被 Phase 6 注册到通用 Executor Registry，供用户在动作模板里组合使用。
