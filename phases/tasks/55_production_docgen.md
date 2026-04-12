# UCA-055 — 生产级文档生成（PptxGenJS / docx / ExcelJS）

**Status**: todo  
**Priority**: P2  
**Depends on**: UCA-053, UCA-054  
**Branch**: `task/uca-055-docgen`

## 目标

替换 `create-ooxml-fixture.ps1`，改用 Node.js 库直接生成真实、可用的文档（PPT/Word/Excel/PDF），而不是空壳 fixture。

## 技术选型

| 格式 | 库 | 理由 |
|---|---|---|
| PPTX | `pptxgenjs` | slide objects、charts、master layout、Buffer export |
| DOCX | `docx` | declarative API、Node/browser compatible |
| XLSX | `exceljs` | multi-sheet、styling、formula |
| PDF | `playwright` `page.pdf()` | HTML → PDF，支持自定义页面大小和样式 |

## 新建目录结构

```
src/service/docgen/
  renderers/
    pptxgenjs-renderer.mjs    ← 替换 create-ooxml-fixture.ps1 的 pptx 分支
    docx-renderer.mjs
    exceljs-renderer.mjs
    pdf-renderer.mjs
  validators/
    artifact-validator.mjs    ← 验证 ZIP magic bytes、MIME、最小文件大小
    manifest-writer.mjs       ← 生成后自动调用 register_artifact
  index.mjs                   ← 统一入口 generateDocument(spec, outputPath)
```

## Renderer 接口

```js
// 每个 renderer 实现相同接口
export async function render(spec, outputPath) {
  // spec: { title, slides/sections/sheets, content, language, ... }
  // outputPath: 解析后的完整路径
  // 返回: { success, path, size, error? }
}
```

## PptxGenJS Renderer 关键点

```js
import PptxGenJS from "pptxgenjs";

export async function render(spec, outputPath) {
  const pptx = new PptxGenJS();
  pptx.title = spec.title;

  for (const slide of spec.slides) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.5, w: "90%", fontSize: 28, bold: true });
    for (const bullet of slide.bullets) {
      s.addText(bullet, { x: 0.5, y: 1.5, w: "90%", fontSize: 18 });
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  return { success: true, path: outputPath };
}
```

## AI 输出中间表示（LLM → Renderer）

LLM 不直接写文件，而是输出结构化 JSON，renderer 负责渲染：

```json
{
  "kind": "pptx",
  "title": "AI 趋势报告",
  "slides": [
    {
      "title": "概述",
      "bullets": ["2026 年 AI 关键趋势", "多模态模型崛起", "Agent 框架成熟"]
    }
  ]
}
```

## 关键修改文件

- `src/service/action_tools/tools/index.mjs`：`generate_document` 工具调用新 `src/service/docgen/index.mjs`
- `src/service/core/persistent-runtime.mjs`：注册 docgen 模块
- `package.json`：添加 `pptxgenjs`、`docx`、`exceljs` 依赖（playwright 已有）

## 验证

`verify-action-tools.mjs` 中 pptx 测试：
- 调用 `generate_document({kind:"pptx", slides:[...]})` → 生成真实 .pptx
- 断言 ZIP magic bytes `PK` (0x50 0x4B)
- 断言文件大小 > 1000 bytes
- 断言包含至少 1 个 slide（解压验证 `ppt/slides/slide1.xml` 存在）
