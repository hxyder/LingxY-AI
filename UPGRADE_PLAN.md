# LingxY 上线 + 减肥 联审计划（2026-05-07 起）

> 这份文档是 Claude 与 codex 共同遵守的工作合同。每一条任务都要走「Claude 写 → codex 审 → 反驳/接受 → 修 → codex 终验」闭环。
>
> **互审分两档**（codex 建议）：
> - **R-CODE**（强制 codex review）：进安装包 / 影响运行时行为 / 安全边界 / 打包配置（A* / B1 / B2）
> - **R-DOC**（轻量互审）：README / .github / 文档 — codex 只做"泄密扫描 + 事实一致性 + 用户路径可跑通"三项，通过即 DONE

---

## 0. 当前真实状态盘点（2026-05-07）

### 已 ship（codex 全收）
- mutation guard sweep（22 刀）/ verifier 系统 / behavior test 覆盖
- Echo wake enrollment（6 round 收敛）+ 30s 续问窗
- whisper transcribe daemon 化
- Echo TTS（语音回复 + 一键静音）
- UX-2 Skill GitHub 一键安装
- 跨源统一搜索 MVP（FTS5 + CJK 友好）
- side-effect gate（SR LLM hallucination 不再卡死任务）
- in-app browser 偏好 + 8s show fallback
- cancelled / partial_success 续问窗
- rewake 反馈 HUD
- planner action_only 决定性 fallback

### 109 corpus 第一轮结果（已完成）

**94/109 = 86.2% pass**。报告：`scripts/real-llm-test/report-2026-05-07-02-16-47.md`

按 category 分布：100% pass 的：B / C / E / G / H / I / J / L / O 9 类。失败集中：
- **D（多步复合）40% pass**：6 个 D 类失败都是 `missing_artifact` — 框架性 bug：generate_document 不被调
- **K（边界 case）67% pass**：K.url_only "https://example.com" 误触发 open_url；K.tab_only harness 没处理纯 whitespace
- **N（schedule）67% pass**：2 个误报（schedule 实际通过 SR 快路径走了，没经过 create_scheduled_task 工具调用 — 我 expectation 过严，B2-b）
- **M（链接消歧）75% pass**：M.give_me_link_zh / M.send_me_url_en 仍误触发 open_url — 之前的 fix 没盖到 LLM 路径，只盖了 deterministic planner

**failure shape**：
- 8 × forbidden_tool_called（最严重）
- 6 × missing_artifact（D 类全部）
- 3 × terminal_unexpected
- 2 × preferred_tools_not_used（误报）
- 1 × harness_error / 1 × no_response_within_timeout（test bug）

**B2-a 硬阻塞（必修，3 类真 bug）**：
1. **open_url 误触发 LLM 路径**：M.give_me_link_zh "给我 X 链接"、M.send_me_url_en "send me the link for X"、K.url_only 裸 URL — deterministic planner 修过但 LLM planner 仍会选。需要在 tool surface 或 prompt 层加约束。
2. **artifact 不生成**：D 类 6 个 case — LLM 输出了 markdown 表格内容，但没调 generate_document 工具产出文件。SR 判 artifact_required 但 planner 没强制 generate_document 调用。
3. **SR 误判稳定 QA 为 search-class**：A.dependency_inversion / A.indexing / F.par_b — deepseek-flash 把 "什么是 X" 判成需要外部数据。

**B2-b 非阻塞**：
- N.schedule_4 / 5 "in N minutes remind me to ..." — 实际 SR 直接 schedule，task 报告 final_text 已"已安排..."，工具不调没问题。test 期望放宽。
- K.tab_only harness bug — 接受 missing_user_command 为预期。

### 已知真 bug（笔记，未修）
1. schedule 字段不一致（task_f62f95d0：title 2 邮箱、实际发 1）
2. VAD 与 KWS 失败信号不可分（dock.js 提示混淆）
3. preview 大 XLSX/PPTX 冷渲染 500ms-2s（无 streaming）
4. 代码文件预览无 syntax highlight
5. whisper 转写 echo 路径未 stream

### 体积根因（codex 复审已校正）

**安装包 win-unpacked 241 MB**：
- `UCA.exe` (Electron base): 190 MB（不可避免）
- `locales/`: 42 MB（**42 个语言**，可裁到 1-2 MB）
- `LICENSES.chromium.html`: 12 MB（**法律告知载体，先冻结，不轻动**）
- `resources/app.asar`: 47 MB（**真正可减的部分**）
- `icudtl.dat`: 10 MB（必需）
- DLLs（ffmpeg / swiftshader / d3dcompiler / GLES）: ~22 MB

**为什么 app.asar 47 MB**（codex 复盘后的更准确归因）：
1. **scripts/*.mjs 全量打包**（208 个 verify-* + harness + tools），dev-only 错误地进了用户安装包
2. **mermaid 不是 CDN，是本地 node_modules 分发**（`mermaid-assets.mjs:resolveMermaidScriptSrc()` 拼 `file://...node_modules/mermaid/dist/mermaid.min.js`）→ 改 CDN 才能减
3. **pdfjs-dist 全量打包**（37MB），且通过 `app.getAppPath()/node_modules/pdfjs-dist/...` 真实文件路径访问，**lazy import 无效**，必须 build-time 文件裁剪
4. **每个 artifact 库都大**：exceljs 22MB / mammoth 5MB / pptxgenjs 3MB / docx 6MB

**对比同类 Electron 应用**：
- Cursor / VS Code: 200-300 MB（同档）
- Claude Desktop: ~100 MB
- Granola: ~150 MB
- Tauri 应用（Linear / Pieces）: 15-50 MB（不用 Electron）

**目标口径**（codex round-3 校正 — 口径必须分开说）：
- **硬指标**：**win-unpacked ≤ 200 MB**（解包后目录大小，proxy 用户首次下载体感）
- **NSIS installer 实际下载体积**：单独记录在 dist/*.exe，作参考值
- **stretch**：win-unpacked ≤ 150 MB（A3-β + A3-γ 都做齐才能到，不强求）

**注意 — 体积口径区分**（用户问 Bash output 的大数字）：
- **node_modules: 925 MB** = 仅开发期；含 electron 327 / app-builder-bin 207（dev tools）/ mermaid 74 / pdfjs 37 等。GitHub 公开的 repo 不带 node_modules，用户 `npm install` 时各自下载。
- **dist/: 341 MB** = 我们本地构建产物，含两份：win-unpacked（解包目录） 241 MB + trial 100 MB。git 不传，仅本地。
- **win-unpacked: 241 MB** = **安装后目录 / 解包体积**（非 NSIS 安装包），实际 NSIS installer 通常更小（dist/*.exe 是真实下载文件）。
- **src/: 5.5 MB / tests/: 1.2 MB / scripts/: 2.8 MB** = 我们的源码，仅几 MB，不是体积主因。

---

## 1. 周末上线 GitHub 的"硬阻塞"清单

### 🔴 RC-1（codex 新增的真 P0）：开源前内容剥离

**现状**：仓库里有 `internal/root-docs/`、`models/`（KWS 模型样本）、`scripts/real-llm-test/` 真实 corpus、可能的账号配置示例。这些**比 secrets.json 更敏感**，不剥离上线 = 信息泄漏 / 法律风险。

行动（codex round-2 补强 — 4 类）：
1. **工作区扫**：
   - audit `internal/` `*-secrets*` `*-credentials*` `*.env*` 可疑路径
   - 决定 `internal/` 进 `.gitignore`（不开源）还是分仓
   - `models/user-keywords/` 的录音样本：用户隐私语音数据，**绝不能 push**
   - `scripts/real-llm-test/report-*.json` 已 gitignored ✓

2. **git 历史扫**（codex 新增）：
   - `git log --all -p` 全历史扫秘钥 / 凭证 / 录音 / PII
   - 用 `gitleaks detect --no-banner --redact` 或 `trufflehog filesystem` 一类（GitHub Actions 上线后也会跑）
   - **底线例外条款**：若发现历史里漏过敏感内容，允许做最小必要的 history purge（与原"不主动重写历史"约束的例外，需在 commit message 写清楚原因 + 同时 rotate 相关 key）

3. **凭证 / 密钥 / 配置模式**（比 password|token 更狠）：
   - 私钥头：`-----BEGIN .* PRIVATE KEY-----`
   - 云凭证：`AKIA[0-9A-Z]{16}` (AWS), `AIza[0-9A-Za-z_-]{35}` (Google), `ghp_[A-Za-z0-9]{36}` (GitHub PAT), `xox[bapsr]-` (Slack)
   - npm/git auth: `.npmrc` 里 `_authToken`、`.netrc`
   - 证书文件：`*.pfx *.p12 *.pem *.key`

4. **PII / 语料 / 发布物**：
   - 不只 KWS 录音；扫 `tests/`、`docs/`、截图录屏、导出对话日志/trace
   - 确认 `dist/`、`outputs/`、`artifacts/`、`.tmp/` 没被手动 add 进 git
   - `internal/root-docs/程序整理.md` 里有真实 task_id / email、一律本地保留不开源

估时：2h（含历史扫 + 例外条款评估）
风险：高 — 一旦泄漏不可逆
**Code review 等级**：R-CODE（强制 codex 二审 grep 结果 + 接受/拒绝任何 history purge 决定）

### 🔴 A1：裁 Chromium locales（高 ROI 低风险）

**当前**：`locales/` 42 MB，42 种语言
**目标**：`en-US.pak` + `zh-CN.pak`，共 ~1-2 MB
**节省**：~40 MB

实现（codex 推荐）：
- 主路径：`package.json#build` 加 `electronLanguages: ["en-US", "zh-CN"]`（electron-builder ^26 支持）
- 兜底：`afterPack` hook 删除 `dist/win-unpacked/locales/` 里除两个外的所有 `.pak`

估时：30 min
**Code review 等级**：R-CODE

### 🔴 A3-α：app.asar + extraResources 同时收紧（中 ROI 低风险）

**问题**（codex round-2 补强）：
- `build.files` 里 `scripts/*.mjs` 把 208 个 verify-* + real-llm-test 都打进 asar
- **同时**`build.extraResources` 也把整个 `scripts/` 目录再装一份 — 修一个不修另一个就白干

**修法**：
```json
"files": [
  "LICENSE", "THIRD_PARTY_LICENSES.md", "index.cjs",
  "src/**/*",
  "office_addin/shared/**/*",
  "browser_ext/**/*",
  "uca-native-host/**/*",
  "scripts/start-runtime.mjs",
  "scripts/start-desktop.mjs",
  "scripts/start-lingxy-mcp-server.mjs",
  "scripts/local-sherpa-kws.py",
  "scripts/local-whisper-transcribe.py",
  "!scripts/verify-*.mjs",
  "!scripts/real-llm-test/**",
  "!scripts/**/__pycache__/**"
],
"extraResources": [
  {
    "from": "scripts",
    "to": "scripts",
    "filter": [
      "start-runtime.mjs",
      "start-desktop.mjs",
      "start-lingxy-mcp-server.mjs",
      "local-sherpa-kws.py",
      "local-whisper-transcribe.py",
      "*.ps1"
    ]
  }
]
```

**注意**：`build-trial-package.mjs` / `run-electron-builder.mjs` / `inspect-routing.mjs` / `generate-third-party-licenses.mjs` 都是 dev/release tooling，不进 user 安装包（codex round-2 提醒）。

**节省**：估 5-15 MB（去掉两份 verify-* + real-llm-test）

估时：1h（含 pack → 启动 → 走最短用户路径 smoke gate）
**Code review 等级**：R-CODE — codex 必须看 `build.files` + `extraResources` 双份配置，且确认我跑过一次 `npm run pack` 后启动 + 单 task 提交 smoke OK

### 🟡 A3-β：mermaid CDN 化（中 ROI 中风险）

**当前**：`mermaid-assets.mjs:resolveMermaidScriptSrc()` 走 `file://` 本地分发。打包了完整 node_modules/mermaid（74 MB unpacked / minified ~3 MB）。

**修法**：改 `resolveMermaidScriptSrc()` 直接返回 `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js`；从 `dependencies` 移除 mermaid。

**节省**：~3-5 MB asar（minified 部分）+ 让 node_modules 不再装 74 MB（dev 影响小，user 影响大）

风险：
- 离线环境无 mermaid 渲染（第一次预览时降级到 raw 代码块）
- jsdelivr 可用性（前几轮 codex 建议接受 CDN，与隐私边界一致）

估时：1h
**Code review 等级**：R-CODE（必须确认 fallback 逻辑）

### 🟡 A3-γ：pdfjs-dist 文件级裁剪（低 ROI 高风险）

**当前**：pdfjs-dist 37 MB 全量打包，用主进程拼 `file://` URL 给 renderer。

**修法**：保留 `legacy/build/pdf.min.mjs` + `pdf.worker.min.mjs` 必需 + 必要 cmaps，删 examples / type defs / 未用 build。

**节省**：估 15-25 MB（如果只留必需）

风险：高 — pdfjs 内部可能有 file-relative import，删错触发 runtime 失败。

估时：2h（含真实 PDF 预览回归）
**Code review 等级**：R-CODE
**周末态度**：先 stretch goal，A1 + A3-α 完成后再做。

### ⚫ A2：LICENSES.chromium.html — **冻结，本周末不动**

codex 反对：这是 Electron / Chromium 第三方许可告知载体，删除有合规风险，开源后会被审视。先做 license-notice 合规 audit 再说。

### 🔴 B1：schedule 字段一致性

**修法**（codex 重写，比我原方案更稳）：

1. 在 `createSchedule(input, ...)` 入口处 **冻结一次** `schedule.name` 写库后**不再 derive**
2. 决策优先级：
   1. `action.params.userCommand`（如果是完整自然语言、能描述实际 action）
   2. `args.name`（如果短、像标题、不含高风险漂移字段：收件人列表/数量）
   3. fallback：`action.target` + 关键参数摘要

3. 未被选中的另一个字段塞进 `schedule.metadata.naming_audit` 给后续 LLM-drift 排查用

估时：1.5h（含测试 + 一致性检查）
**Code review 等级**：R-CODE

### 🟡 B2：109 真实 LLM 测试结果分析（**二阶**处理）

**B2-a（硬阻塞）**：等 109 跑完后按 `failureKinds` 聚类：
- `forbidden_tool_called`：违反工具/策略边界 → 必修
- `text_contains_forbidden`：违反输出 contract → 必修
- `missing_external_web_read_call`（在 search 类）：SR 误判 → 必修
- `missing_artifact`（在 artifact_doc）：generate_document 失败 → 必修

**B2-b（非阻塞）**：其余失败（terminal mismatch / preferred_tool_not_used / text_missing_substring）记账进 C（hotfix 周期），不阻塞上线。

估时：2-3h（B2-a 修 + 复测）
**Code review 等级**：R-CODE

### 🔵 B3：README 公开化

四段式：是什么 / 怎么装（含 Node 22 + 依赖 + 构建步骤）/ 怎么用（首启 wizard 截图）/ 怎么贡献。

估时：1h
**Code review 等级**：R-DOC

### 🔵 B4：.github/ 治理基线

`ISSUE_TEMPLATE/` `PULL_REQUEST_TEMPLATE.md` `SECURITY.md` `CODE_OF_CONDUCT.md`。

verify-github-readiness / verify-issue-templates / verify-pr-template / verify-security-policy / verify-code-of-conduct 都有 — 现成跑一遍把 advisory 全清。

估时：1h
**Code review 等级**：R-DOC

---

## 2. 后置 hotfix（不阻塞周末上线）

- **C1** preview 大 Office streaming
- **C2** 代码文件 syntax highlight
- **C3** whisper echo 路径 stream（first segment 1-2s 出）
- **C4** VAD/KWS 失败信号区分
- **C5** tool-call collapsible pills（modernization）
- **C6** UI 现代化（warm-gray 排版 / orb 状态语言）
- **C7** A3-γ pdfjs 文件裁剪（risky weight loss）
- **C8** 真实桌面 UI 流测试（Playwright + Electron）
- **C9** Multi-agent 共创工作台（**长期方向**，见 §11）

## 2.5 B5 图标统一（上线前最低成本，非阻塞）

**用户指令（2026-05-07）**：除了浮窗（dock orb），所有应用图标统一使用用户提供的新设计 — 黑色圆角方形 + 像素化白色箭头 + 线条艺术握持手势。

涉及替换：
- `src/desktop/assets/logo/lingxy-mark.svg`（应用品牌主标）
- Windows 任务栏图标（electron-builder `build.win.icon`，生成 `.ico`）
- NSIS installer icon（同上）
- Tray icon（`buildTrayIcon` in `electron-main.mjs:2129`）— 注意 tray 有动态 badge，需保留 badge 渲染层
- `office_addin/shared/icon-{16,32,80}.png`（Office add-in）

**dock orb 不动**：`src/desktop/renderer/dock.html` 内的 canvas 粒子动画保留 — 那是品牌核心动效。

行动：
1. 用户提供新图标 PNG / SVG / ICO 源文件（放到 `assets/brand-source/` 或我直接 commit base64 时的描述）
2. 用 sharp / electron-icon-builder 生成各尺寸（16 / 32 / 64 / 128 / 256 / 512）
3. 替换上述路径
4. 跑 `verify-icons / verify-brand-assets / verify-public-branding` 三个 verifier 通过
5. 重新 pack 后看 dock 仍是粒子球、其它处用新图标

估时：1.5h（含图标资源生成 + verifier 复跑）
**Code review 等级**：R-CODE（codex 看资源 + verifier 通过证据；不看像素细节）
**前置依赖**：用户提供新图标文件路径，否则只能 placeholder（推迟到上线后补）

---

## 3. 联审工作流

每个 R-CODE 任务循环：
1. Claude 在本表把状态改 `DOING`
2. Claude 写代码 → 跑现有测试 → commit
3. **必须**调 `mcp__codex__codex` review，附 commit hash + 关键 diff
4. codex 给 反驳 / 部分接受 / 全接受
5. 反驳 → Claude 修 → 再调 codex → 直到 "全部接受"
6. 状态改 `DONE`

每个 R-DOC 任务（codex 简化）：
1. Claude 写
2. 调 codex 一次："请扫泄密 + 事实一致性 + 用户路径可跑通"
3. 通过即 DONE，不要求多轮 review

---

## 4. 任务表（实时更新）

| ID | 任务 | 状态 | 等级 | ETA |
|----|------|------|------|-----|
| 109-RUN | 109-prompt corpus 跑完 + 失败聚类 | DONE（94/109） | - | ✓ |
| RC-1 | 开源前内容剥离 audit | TODO | R-CODE | 2h |
| A1 | 裁 Chromium locales | TODO | R-CODE | 30m |
| A3-α | app.asar files + extraResources 双收紧 | TODO | R-CODE | 1h |
| A3-β | mermaid CDN 化 | TODO | R-CODE | 1h |
| B1 | schedule 字段一致性（冻结 display_name） | TODO | R-CODE | 1.5h |
| B2-a | 109 失败硬阻塞修（open_url + artifact + SR override） | TODO | R-CODE | 3-4h |
| B3 | README 公开化 | TODO | R-DOC | 1h |
| B4 | .github 治理基线 | TODO | R-DOC | 1h |
| B5 | 图标统一（除 dock orb） | TODO（依赖用户提供图标文件）| R-CODE | 1.5h |
| A3-γ | pdfjs 文件裁剪（stretch） | BACKLOG | R-CODE | 2h |
| C9 | Multi-agent 共创工作台（design.md 方向） | BACKLOG（**post-launch**） | - | 数周 |
| C* | 其它 hotfix | BACKLOG | - | 上线后 |

**周末预算**：
- 必清 RC-1 + A1 + A3-α + B1 + B2-a + B3 + B4 ≈ 9h（含 codex review 多轮）
- 可分两到三个晚上

**目标交付**（codex round-3 拆条）：
- **win-unpacked ≤ 200 MB**（locales -40 + asar 收紧 -10 ≈ -50 MB → 191 MB）— 硬指标
- **`forbidden_tool_called = 0`** — 硬闸（违反工具/策略边界 = 上线前必修）
- **109 corpus pass rate ≥ 80%** — 质量闸
- README + .github 公开就绪
- internal/ 私有，scripts/real-llm-test/ 含 corpus 但不含 reports
- secrets.json 不在 git
- LICENSE / THIRD_PARTY_LICENSES / SECURITY 完整

---

## 5.5 Test Harness × Multi-Agent 现状评估（用户问）

### 我们当前 harness 能力（v2，已实现）
- 109 prompt corpus，15 categories，stable id 失败追踪
- 6 个环境 shape：window / clipboard / browser / scheduled_fire（preauthorized）/ follow_up chain / parallel batch
- 期望：terminal / toolMustInclude / toolMustNotInclude / toolGroup / artifactKind / textMustInclude
- 失败聚类 by category + by failure kind
- POST-then-poll 解决 events race
- run_in_background 长跑 + JSON+MD 报告

### 业界常见 harness 对照（来自社区 + agent benchmark）

| 能力 | LangSmith / OpenAI Evals / AgentBench / SWE-bench | LingxY 现状 |
|------|---|---|
| LLM-as-judge 语义打分 | ✅ | ❌ 只有 substring |
| 跨 run 回归 diff | ✅ | ❌ |
| 每题 N 次取多数 | ✅ | ❌ single-shot |
| 状态隔离 / clean DB | ✅ | ❌ 共用 runtime DB |
| Token / latency 追踪 | ✅ | ❌（只 elapsedMs） |
| 真实 UI 流测试 | varies（Playwright + Electron）| ❌ 只 HTTP 层 |
| 多 agent 协作场景 | AutoGen / Devin / Claude Computer Use 都有 | ❌ |
| 红队 / 提示注入 | ✅ | ❌ |
| 路径覆盖率 | ✅ | ❌ |
| Property-based 生成 | ✅ | ❌ |
| Replay / 时间旅行 | ✅ | ❌（jsonl event log 有，但无 replay 工具） |
| 沙箱化 | ✅（容器/快照） | ❌ |

### 多 agent 协作部分我们怎么样？
- **当前 LingxY 是单-agent 框架**：planner LLM + executors（fast / agentic / tool_using / multi_modal / kimi / translate），但都是"单条任务流" — 没有 agent A 给 agent B 派活的 protocol。
- **业界做的**：AutoGen / CrewAI / LangGraph 的 multi-agent — 一个 manager agent + 多 worker，互相传消息，每个 agent 自带 system prompt + tool subset。
- **我们最像 multi-agent 的地方**：planner + verifier（mutation guard sweep）+ post-tool composer，但是 sequential 流水线，不是并行 agent。
- **harness 上多 agent 测试我们没做**。

### 用户问"和别人比缺什么" — 排序后真正缺的

| 排名 | 缺口 | 上线前必须？ | 工作量 |
|---|---|---|---|
| 1 | 跨 run 回归 diff | 否（但每次改后必备）| 0.5d |
| 2 | LLM-as-judge | 否 | 1-2d |
| 3 | 状态隔离 / clean DB per test | 否 | 1d |
| 4 | Token tracking（替代 cost — 用户更正）| 否 | 0.5d（events 里加 token 字段读出即可）|
| 5 | 真实桌面 UI 流（Playwright + Electron） | 否 | 3-5d |
| 6 | 每题 N 次取多数 | 否 | 1d + 3-5x cost |
| 7 | 红队 / 提示注入 corpus | 否 | 1d |
| 8 | 多 agent 协作场景 corpus | 否（我们当前是单-agent，不需要） | - |

**周末做不了任何一个**（plan 里这些都进 C/post-launch）。

**用户额外 ask**：把 cost 改 token —— 已记，待 #4 实现时按 token 走。

### 性能优化 / 第三方库引入新约束（codex 视角 + license check）

用户：**新性能优化 OK，但要谨慎 + 看 license + 决定直接用还是 rebuild**。

落地为本仓库规则：
- 任何引入新 npm 依赖前：检查 license（必须 MIT / Apache-2.0 / ISC / BSD），不接受 GPL / AGPL / LGPL（v2 中等谨慎，v3 拒绝）
- 加依赖必须更新 `THIRD_PARTY_LICENSES.md`（已有 generate-third-party-licenses.mjs）
- 大型依赖（unminified > 5MB）单独评估：能否 cherry-pick 子模块；能否走 CDN；能否自己写 100 行替代
- 任何引入会增加 asar / extraResources 体积的依赖，必须先估算 packed size 写到 PR 描述里
- codex review 在 R-CODE 任务里会被 prompt 检查上面这些（自动列入 review 清单）

---

## 5.7 Tool / Skill / MCP 利用率诊断（用户问）

### 工具其实够丰富（30+）
| 类别 | 工具 |
|------|------|
| 信息检索 | web_search_fetch / fetch_url_content / web_search |
| 文件 / Artifact | generate_document / write_file / edit_file / render_diagram / render_svg |
| 系统命令 | **run_script (powershell / node / python, 20s timeout)** ← 用户问的 "能跑命令吗" — **早已存在** |
| 桌面操作 | open_url / open_file / launch_app / reveal_in_explorer / take_screenshot / GUI_* |
| 邮件 / 日历 / 网盘 | account_send_email / send_email_smtp / google.gmail.* / microsoft.outlook.* / connector_workflow_run |
| 文件搜索 | list_files / glob_files / find_recent_files / search_file_content / index_file_content / read_file_text |
| Schedule | create_scheduled_task / list_scheduled_tasks / delete / pause |
| 内存 / 上下文 | MEMORY_TOOLS（get_task_detail / list_recent_tasks 等） |
| Skill / MCP | draft_capability / save_capability_draft + 已装的 MCP servers |
| 其他 | translate_text / copy_to_clipboard / read_clipboard / notify / vision_analyze / verify_file_exists |

### 109 corpus 实际 tool 调用分布（残酷现实）
跨 109 task 跑完，tool_call_completed 统计：

| 工具 | 调用次数 | 占比 |
|------|---------|------|
| web_search_fetch | 75 | 47% |
| fetch_url_content | 60 | 38% |
| open_url | 8 | 5% |
| get_task_detail | 3 | 2% |
| list_recent_tasks | 3 | 2% |
| **generate_document** | **1** | **0.6%** |
| **run_script** | **1** | **0.6%** |
| account_send_email / google.gmail / etc | 1-2 each | <1% |
| 其他 20+ 工具 | 0-1 次 | ≈ 0% |

**结论**：
- **不是工具不够丰富**（30+ 已经超过 Cursor / ChatGPT desktop 的工具数）
- **是 LLM 极度偏好搜索类工具，主动忽略其它 85% 的工具**
- D 类 6 个 missing_artifact 直接证据：LLM 输出了 markdown 表格内容，但**就是不调 generate_document**
- run_script 只用 1 次：用户问"能跑 python/powershell 吗"——能，但 LLM 自己想不到去用

### 这是框架问题不是 LLM 问题（更准确：LLM 不可控 → 框架要兜底）
- system prompt 太长，工具列表埋在中下段，LLM 注意力衰减
- `formatToolForPlanner` 渲染只有 id + description + JSON schema，没传达"使用场景示例"
- 没有 phase-gate 强制：当 task_spec.artifact.required=true → 必须调 generate_document（类似 email_send 的 obligation handoff）
- run_script 没有"LLM 应该主动选用"的 prompt 触发器（描述 too generic）

### B2-a 修法走向（codex round-3 拍板）

**(a) open_url 误触发 LLM 路径**：从 tool surface 默认隐藏，validator 加 deny rule
- **职责边界澄清**（codex round-4）：`open_url` 是"交互式浏览 / 导航"，不是"抓取内容"。抓取走 `fetch_url_content` / `web_search_fetch`。在 system prompt 里写明这条，避免 LLM 误把 open_url 当默认抓取器。
- `tool-surface.mjs` 把 open_url 默认从 visibleTools 删除，只在以下条件暴露：
  - **强解锁（最硬，优先级最高 — codex round-4）**：用户文本含具体 URL/域名 **AND** 含明确打开动词（打开 / 访问 / 进入 / 跳转 / 浏览 / open / visit / navigate / load）。直接绕过 SR，不需要更高级别条件
  - 显式打开动词 + URL（同上但作为弱版本）
  - `success_contract.required_tool_names` 含 open_url
  - `goal === "browser_control"`
- `tool-call-validator` 在 LLM 提议 open_url 但条件不满足时 deny，提示"输出链接文本 / 解释下一步 / 用 fetch_url_content 抓取内容"

**(b) D 类 missing_artifact**：把 artifact_required 升级为 phase-gate required_obligation + framework recovery（**+ codex round-4 关键 invariant**）
- `task_spec.artifact.required=true` 时进入 `success_contract.required_policy_groups` 加 `artifact_generation`
- 像 email_send 一样在 phase-gate 检测 `artifact_required_not_created` violation
- 最后一轮如果仍无 artifact，**走 deterministic recovery**：framework 强制调 generate_document 用 LLM 已生成的最终文本作 body

**关键 invariant（codex round-4 必加）**：
- artifact 场景的 deterministic recovery **只能走无副作用、可本地闭环的路径**（generate_document / write_file / render_diagram / render_svg），**绝不可** fallback 到 email_send / open_url / connector_workflow_run 这类对外副作用通道
- 当前 policy/环境下若**不存在任何可用的 artifact 生成路径**（artifact_generation 组工具都被禁），**直接 hard-fail 为 MissingArtifact (deterministic, single reason)**，不要试图补救
- 这条 invariant 区分 artifact 与 email_send 两类 fallback：email_send 是 preauthorized 副作用通道，artifact 是 implicit-authorized 本地闭环路径，**不能复用同一个 fallback 路径骨架**

**(c) SR 把稳定 QA 误判 search-class**：在 SR 后加 deterministic override（**codex round-4 扩词**）
- `task-spec.mjs` 在 SR 输出后加规则层。匹配以下条件时强制 `source_mode=no_external` / `web_policy=forbidden`：
  1. **学习 / 解释类动词命中**（codex round-4 扩充）：
     `什么是 / 解释 / 定义 / 原理 / 区别 / 如何 / 怎么 / 为什么 / 介绍 / 概述 / 入门 / 教程 / 最佳实践 / 优缺点 / 对比 / 举例 / 总结 / 梳理 / 科普`
  2. **无任何 freshness 信号**（任一不命中即放过给 SR）：
     - 时间词：`最新 / 今天 / 现在 / 当前 / 近期 / 本周 / 本月 / 昨天 / 刚刚 / 目前 / 截至`，时间指代如 "最近三天 / 这一周 / 今年"
     - freshness 主题词（codex round-4 关键扩充）：`政策 / 法规 / 报税 / 签证 / 申请流程 / 费用 / 价格 / 折扣 / 活动 / 上市 / 版本 / 发布 / 漏洞 / 停服 / 限购 / 新闻 / 动态 / 更新 / 变更 / 版本号`
  3. SR 仍可输出原判断，但 deterministic override 优先级更高（与现有 hard-fact-skip 模式对齐）
- A.dependency_inversion / A.indexing / F.par_b 等 case 即可正确路由
- **边界 / 机械判定规则（codex round-4 final）**：
  1. **优先级**：freshness 时间词 / freshness 主题词 / 显式 explicit_search 信号 — **任一命中** → 走 search，无论学习词是否命中
  2. **学习动词 OR 主题学习词命中 + 上述全不命中** → forbidden / no_external
  3. 反例：
     - "如何报税" → "报税" 命中 freshness 主题 → search ✓
     - "什么是 RAG" → 学习动词 + 无 freshness → forbidden ✓
     - "解释一下 NVDA 今日股价" → "今日" + "股价" 双命中 freshness → search ✓
     - "TypeScript 5.5 怎么用 inferred predicate" → "怎么" 学习动词 + 无 freshness → forbidden ✓
     - "Bun 当前版本号" → "当前" 时间词 + "版本号" 主题词 → search ✓

### 回归测试 / 判例表（codex round-4 final 必加）

每个 B2-a 修法必须配 behavior test：

**(a) open_url tool surface tests**：
- `M.give_me_link_zh "给我 X 链接"` → open_url 不在 visibleTools，LLM 提议被 deny ✓
- `K.url_only "https://example.com"` → 同上 ✓
- `打开 https://github.com` → 强解锁路径，open_url 在 visibleTools，LLM 选用 ✓
- `success_contract.required_tool_names: ["open_url"]` → 暴露 ✓
- `goal === "browser_control"` → 暴露 ✓

**(b) artifact required_obligation tests**：
- D.compare_frameworks_doc 等 6 个 case → success 时 artifact 存在；planner 多轮不调时框架 deterministic recovery 调 generate_document ✓
- 假场景：artifact_generation 工具组全被禁 → hard-fail MissingArtifact (single reason) ✓
- 假场景：planner 试图调 email_send 当 artifact fallback → 被 invariant 拒绝 ✓

**(c) SR override tests**：
- A.dependency_inversion / A.indexing / F.par_b → forbidden ✓
- "如何报税" → search ✓
- "解释一下 NVDA 今日股价" → search ✓
- "什么是 RAG" → forbidden ✓
- "Bun 当前版本号" → search ✓

### Skill / MCP 现状
- **Skill**：UX-2 GitHub 一键安装已 ship，但 corpus 没测 skill 调用（109 没盖到）。MCP 支持但当前默认无装 server。
- **配置 MCP**：通过 Console → Settings → MCP Servers UI；已有 `@modelcontextprotocol/server-filesystem` / `server-memory` 在 dependencies
- **未做**：自动化测试 LLM 是否会在 task 中调用 skill 或 MCP 工具。Post-launch C 类工作。

---

## 5.6 周末预算复算（codex round-2）

**预算**：9h → **11-13h**（codex 警告：RC-1 含历史扫和 109 复测可能漂）。**保留 2h buffer**。

**节奏**：
- **晚 1（今晚 ~3h）**：RC-1 audit + A1 locales（低风险高收益做完先）
- **晚 2（明晚 ~4h）**：A3-α + B1 + B3
- **晚 3（后晚 ~3-4h）**：B2-a 真 bug 修 + B4 + 整体烟雾测试
- **buffer**：A3-β（mermaid CDN）+ A3-γ（pdfjs）放 stretch，做不完不阻塞上线

**每个 R-CODE 任务的 smoke gate**（codex 新增）：
任何动到打包/runtime 的 commit 前必须：
1. `npm run pack` 成功
2. 启动 win-unpacked/UCA.exe，dock 可见
3. 单 task 提交（用 console 或 curl POST /task）→ success
4. 把烟雾结果贴进 codex review prompt

---

## 11. Multi-Agent / 共创工作台方向（**post-launch reservation**）

**用户原话**：「多 agent 按这个文件的方向走 — `internal/root-docs/linxi_co_creation_workspace_design.md`。先预留空间和方向，当前不需要解决，上线以后，更新的时候才做。」

文件**已复制到 `internal/root-docs/`，gitignore 覆盖，不会上传到 GitHub**。

### 文件核心方向（摘要 — 给将来回看的 anchor）

3551 行 / 40 sections 的产品 UX 设计文档，把 LingxY 从"个人 AI 任务控制台"升级到"人类协作者 + 自带 LLM + 多 Agent 的项目共创工作台"。

**三层架构**：
- **Global Shell**：全局命令条 / Overlay / Notifications / Recent Projects / My AI Providers / 全局 Artifact Center
- **Project Workspace**：Project Home / Members & AI Collaborators / Tasks (DAG/Kanban) / Files & Artifacts / Conversations / Decisions / Budget / Permissions / Audit Log
- **Task Room**：Goal & Acceptance / Context Pack / Assigned Humans+Agents / Live Progress / Discussion / Outputs / Review&Approval / Cost & Logs

**任务分级（L0-L4）**：即时任务 / 轻 / 中 / 重项目 / 高风险任务，每级 UI 完全不同。

**协作模式**：Solo+Multi-LLM / Team+Shared AI / Team+BYO-LLM / Client / Community Co-creation。

**核心模块**：Context Pack（信息打包传递）/ Model Router / Task Graph / 权限审批 / 预算 / Provider Proxy。

**MVP 分期**（doc §26）：从今天单 agent → 多 agent 协作的渐进路径。

### 当前 LingxY 与目标差距

| 子系统 | 当前 | 目标 |
|--------|------|------|
| Agent 模型 | Single-agent sequential（planner → executor → verifier → composer） | Multi-agent 角色（Supervisor / Planner / Researcher / Coder / Reviewer / Writer / Operator / Memory）|
| Workspace | Console + Overlay 两窗口 | Global Shell + Project Workspace + Task Room 三层 |
| Task | 单 task / parent-child 链 | DAG + Kanban + 任务图 |
| 协作 | 单用户 | 多用户 + AI 成员卡片 + BYO-LLM |
| Artifact | task_artifacts 表 | 全局 Artifact Center + 版本管理 |
| Context | context_packet | 显式 Context Pack 对象，可传递可审查 |
| Permissions | desktop_actor gate | RBAC + 审批门 |
| Budget | budgetManager | 多模型 / 多用户费用归属 |

### 上线前如何"预留空间"（即不做，但不要写死代码挡路）

- 任务对象 schema 字段保留 `assignees: []`（人 + agent）字段，目前只用 `[null]`
- conversation 字段保留 `project_id`（已有 ✓）
- 现有 connectorCatalog / pluginRegistry / actionToolRegistry 都是 plug-in 架构（已为 multi-agent 做准备 ✓）
- BYO-LLM 已通过 `ai.customProviders` 支持多 provider（已为 multi-agent 做准备 ✓）
- Skill / MCP 三层 + draft 工作流（UX-2 已 ship）支持外部 agent 接入

### 上线后第一波 multi-agent 工作（C9 子任务）

按 design.md §26 MVP 分期的最小切入：
1. 把现有 `executors` 重命名为 "agent roles"（API 不动，命名改）
2. Project workspace MVP：先把 console 加一个 Project tab，挂目前的 conversation/notes/tasks/schedules
3. Task Room MVP：把现有 task detail page 升级成"Task Room"，加 Context Pack 显式 pin
4. AI Roster 面板：列已配置的 customProviders + 角色绑定
5. 多 agent dispatcher：基于现有 phase-gate，加 "delegate to role X" 决策

每一步都是 1-2 周的工作量，**周末完全不做**。

---

## 12. 走偏防护 / 跟踪机制

> 用户原话：「记得追踪和记录好，因为会话很长，容易走偏」

每完成一个 task：
1. 状态 TODO → DOING → REVIEW → DONE
2. commit message 必须引用 plan 里的 task ID（A1 / A3-α / B1 / RC-1 / B5 / 等）
3. codex round-N 每一轮的反馈写进对应 task 的"修订记录"小节
4. 如果实现中发现 plan 漏掉的需求，**先停下** → 在 plan 里加 task → codex 评审是否进入本周末范围 → 再写代码
5. 不允许"顺手做"未在 plan 里登记的工作（防 scope creep）

**当前会话节点（防走偏 anchor）**：
- 109 corpus 第一轮已跑完（94/109 = 86.2%）
- B2-a 三类真 bug 修法已写进 plan，待开工
- 减肥 A1+A3-α 待开工
- 内容剥离 RC-1 待开工
- 用户已确认 multi-agent 方向走 design.md，但**不在本周末范围**

---

## 6. 不能动的底线

- 不引入新性能 / 启动时间退化
- 不删 behavior tests / verifier
- 不主动重写 git 历史
- 不引入 telemetry / 第三方 analytics
- secret 仍在 secrets.json，不进 git
- mutations 走 actor gate / desktop_console（已建立的边界）

---

_2026-05-07 起草（Claude），codex round-1 已 review 并修订（A2 冻结、RC-1 加入、mermaid 真相、B1 改 frozen display_name、B2 二阶、两档 review）。任何后续修改都必须更新本表 + 互审。_
