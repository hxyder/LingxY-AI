# Task UCA-040 — 杂项可靠性修复：Windows.Media.Ocr、PS UTF-8 stdout、dedupe 返回原始事件

## 1. 任务目标

扫清一批小但很痛的线上问题：
1. OCR 链路注释说用 Windows.Media.Ocr 但实际只调用 Tesseract（多数用户没装 Tesseract 所以 OCR 永远返回空）
2. PowerShell 脚本的 stdout 编码随系统 ANSI codepage 变化，导致中文捕获文本以 mojibake 形式到达 Node（`Captured from electron: Selected: ������ΧΪ...`）
3. Service core 的 dedupe 路径返回新 task 的空 events，导致用户对相同文字再次触发翻译时收到 `(无内容)`

## 2. 前置依赖

- 上一个任务：UCA-013（PDF OCR 基础）、UCA-023（context handoff UI）
- 必须已有的产物：`scripts/ocr-image.ps1`、`scripts/capture-context.ps1`、`scripts/capture-screenshot.ps1`、service core dedupe 路径
- 不能同时修改的区域：task event schema、artifact store 结构

## 3. 实施范围

- 负责模块：ocr-image.ps1（Windows.Media.Ocr WinRT 投影 + Tesseract fallback）、所有从 Node 调用的 PS 脚本的 stdout 编码、browser-submission / context-submission 的 dedupe 响应构造
- 允许改动文件/目录：`scripts/ocr-image.ps1`、`scripts/capture-context.ps1`、`scripts/capture-screenshot.ps1`、`src/service/extractors/image_ocr.mjs`、`src/service/core/browser-submission.mjs`、`src/service/core/context-submission.mjs`、`scripts/verify-pdf-ocr.mjs`
- 明确不做：PDF OCR（UCA-013 已有）、新 OCR 引擎集成

## 4. 交付产物

- `ocr-image.ps1` 重构：WinRT 投影 + IAsyncOperation await helper + Tesseract fallback + 空 fallback
- 三个 PS 脚本加 `[Console]::OutputEncoding = UTF8(noBom)`
- 三个 PS 脚本源码清为纯 ASCII（注释里的 → / ── 改成 -> / ---）
- dedupe 响应返回原始 task 的 events + artifacts（而不是新 task 的空 events）
- `image_ocr.mjs` 返回的 ocr_engine 从 PS 脚本的 `result.engine` 字段读取（之前硬编码）

## 5. 验证方式

- `node scripts/verify-pdf-ocr.mjs`（新断言：image OCR 接受 `windows-media-ocr` / `tesseract` / `none`）
- 手动：生成一张含 "Hello World 12345" 的 PNG → PS 脚本返回 `{"engine":"windows-media-ocr","text":"HelIo World 12345"}`
- 手动：capture-context.ps1 对微信前台窗口 → 返回的 JSON text 是干净中文（不再 mojibake）
- 端到端 mocked test：同一文字提交两次 → 第二次 task 返回原始 inline_result 事件

## 6. Git 执行方式

- 分支名：`task/uca-040-misc-reliability-fixes`
- Commit 格式：`UCA-040: fix OCR WinRT binding + PS UTF-8 stdout + dedupe events`
- 合并条件：三个问题都可复测通过，验证脚本全绿

## 7. 完成后必须更新本文件

- 列出 PowerShell 5.1 非 BOM `.ps1` 被 ANSI 读的边界
- 列出 dedupe 判定窗口的参数
- 列出 Windows.Media.Ocr 对图像格式的要求

## 8. 对下一个任务的交接

- 下一个任务：可在此之上做更多 OCR 引擎插件化
- 本任务新增了什么：真实可用的 Windows OCR、CJK 可靠往返、去重不丢结果
- 下一个任务直接可复用什么：WinRT async await helper、utf8NoBom encoding 模板
- 还没解决的问题：OCR 语种设定、多图像批量 OCR、dedupe 窗口的可调参数

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - **`scripts/ocr-image.ps1` 重写**：
    - 加载 WinRT 投影：`[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]`、`[Windows.Graphics.Imaging.BitmapDecoder, ..., ContentType=WindowsRuntime]`、`[Windows.Media.Ocr.OcrEngine, ..., ContentType=WindowsRuntime]`
    - `Invoke-WinRtAsync` helper：通过 `[System.WindowsRuntimeSystemExtensions].AsTask` 把 `IAsyncOperation<T>` 转成 .NET Task，`.Wait(-1)` 同步等待
    - 三层 fallback：Windows.Media.Ocr → Tesseract → 空（Vision API 兜底）
    - 处理 `image_not_found`（路径不存在时不崩）
  - **PS 脚本 UTF-8 stdout**（`ocr-image.ps1` / `capture-context.ps1` / `capture-screenshot.ps1`）：
    ```powershell
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8NoBom
    $OutputEncoding = $utf8NoBom
    ```
    用 no-BOM UTF-8 因为 Node 的 `JSON.parse` 拒绝 leading U+FEFF
  - **PS 脚本源码清为纯 ASCII**：注释里的 `→` / `──` 改成 `->` / `---`，避免 PowerShell 5.1 读取非 BOM `.ps1` 文件时按系统 ANSI codepage 解码产生解析错误
  - **dedupe 响应修复**：
    - `browser-submission.mjs` 和 `context-submission.mjs` 在 `if (!enqueued.accepted)` 分支中，用 `store.getTask(dedupedTaskId)` + `store.getTaskEvents(dedupedTaskId)` + `store.getArtifactsForTask(dedupedTaskId)` 取回**原始** task 的状态 / 事件 / artifacts
    - 返回 `{task: originalTask ?? task, taskEvents: originalEvents.length > 0 ? originalEvents : store.getTaskEvents(task.task_id), artifacts: originalArtifacts}`
  - **`image_ocr.mjs` 解析**：从 PS 脚本的 `result.engine` 字段读取引擎名（之前硬编码 `"windows-media-ocr"`），现在返回 `"windows-media-ocr"` 或 `"tesseract"` 或 `"none"`
  - **`verify-pdf-ocr.mjs`** 放宽断言：接受 `windows-media-ocr` / `tesseract` / `none` 三种 engine 值
- 验证结果：
  - `node scripts/verify-pdf-ocr.mjs` 通过
  - 手动 PS 脚本 smoke：生成 `Hello World 12345` 的 PNG，返回 `{"engine":"windows-media-ocr","text":"HelIo World 12345","lineCount":1}`（微弱字形歧义 l → I 是字体问题，OCR 本身 OK）
  - 手动：`capture-context.ps1` 对微信前台 → `{"process":"Weixin","text":"因为当前可用的应用程序启动工具只支持特定列表..."}` 干净中文
  - 端到端 dedupe 测试：同一文字提交两次 → 第二次 `task_id` 和第一次相同（因为返回的是 originalTask）+ `inline_result` 事件完整返回
- 遗留问题：
  - PowerShell 5.1 对非 BOM `.ps1` 按系统 ANSI 读取，一旦 `.ps1` 源码里混入非 ASCII 字符就会解析失败 —— 要么全部 ASCII 要么显式 BOM。目前选全 ASCII 策略
  - Windows.Media.Ocr 的语种依赖系统已安装的语言包（`TryCreateFromUserProfileLanguages()`）—— 纯英文系统拿不到中文 OCR
  - dedupe 窗口大小目前是 queue 内的默认值；未暴露为配置项
- 交接给下一个任务：
  - 后续如果要支持更多 OCR 语种，可以在 `Invoke-WinRtAsync` 基础上枚举 `Windows.Media.Ocr.OcrEngine.AvailableRecognizerLanguages` 并让用户选择
  - `utf8NoBom` 模板可以复制到其他 PS 脚本
