# UCA-053 — File Discovery & Artifact Verification 工具集

**Status**: done  
**Priority**: P1  
**Depends on**: UCA-051  
**Branch**: `task/uca-053-file-discovery`

## 目标

AI 能主动 find/verify/register 文件，消除"AI 说完成但文件不存在"的假成功问题。

## 新增工具（8 个）

加入 `src/service/action_tools/tools/index.mjs` 和 `src/service/action_tools/schemas/index.mjs`：

### 1. `list_files`
```json
{
  "name": "list_files",
  "description": "列出目录中的文件，可按扩展名过滤",
  "parameters": {
    "dir": { "type": "string", "description": "目录路径" },
    "pattern": { "type": "string", "description": "可选，文件名 glob 模式（如 *.pptx）" },
    "limit": { "type": "number", "default": 20 }
  }
}
```

### 2. `glob_files`
```json
{
  "name": "glob_files",
  "description": "用 glob 模式搜索文件（递归）",
  "parameters": {
    "pattern": { "type": "string", "description": "glob 模式，如 ~/Documents/**/*.pptx" }
  }
}
```

### 3. `find_recent_files`
```json
{
  "name": "find_recent_files",
  "description": "查找最近修改的指定类型文件",
  "parameters": {
    "kind": { "type": "string", "enum": ["pptx","docx","xlsx","pdf","txt","md"] },
    "limit": { "type": "number", "default": 5 },
    "since_hours": { "type": "number", "default": 24 }
  }
}
```

### 4. `get_latest_artifact`
```json
{
  "name": "get_latest_artifact",
  "description": "从 artifact manifest 取最新的指定类型 artifact",
  "parameters": {
    "kind": { "type": "string" },
    "task_id": { "type": "string", "description": "可选，限定特定任务" }
  }
}
```

### 5. `stat_file`
```json
{
  "name": "stat_file",
  "description": "检查文件状态（存在、大小、修改时间）",
  "parameters": {
    "path": { "type": "string" }
  }
}
```

### 6. `verify_file_exists`
```json
{
  "name": "verify_file_exists",
  "description": "断言文件存在且大小 > 0，返回 {exists, size, path}",
  "parameters": {
    "path": { "type": "string" }
  }
}
```

### 7. `register_artifact`
```json
{
  "name": "register_artifact",
  "description": "将文件注册到 artifact manifest（MIME、hash、timestamp）",
  "parameters": {
    "path": { "type": "string" },
    "kind": { "type": "string" },
    "task_id": { "type": "string" }
  }
}
```

### 8. `resolve_output_path`
```json
{
  "name": "resolve_output_path",
  "description": "将文件名解析到 defaultOutputDir（来自 settings）",
  "parameters": {
    "filename": { "type": "string" }
  }
}
```

## Artifact Manifest 格式

`{defaultOutputDir}/.uca-manifest.json`：
```json
[
  {
    "path": "/Users/.../Documents/UCA/report.pptx",
    "kind": "pptx",
    "task_id": "task_abc123",
    "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "size": 45678,
    "sha256": "abc...",
    "created_at": "2026-04-11T10:00:00Z"
  }
]
```

## 关键修改文件

- `src/service/action_tools/tools/index.mjs`：添加 8 个新工具实现
- `src/service/action_tools/schemas/index.mjs`：添加对应 schema
- 新建 `src/service/artifact/manifest.mjs`：manifest 读写操作

## 验证

`verify-action-tools.mjs` 新增场景：
- `list_files` 列出 Documents/UCA 目录
- `find_recent_files(pptx)` 找到最近生成的 pptx
- `verify_file_exists` 对不存在文件返回 `{exists: false}`
- `register_artifact` 写入 manifest，`get_latest_artifact` 能读回
