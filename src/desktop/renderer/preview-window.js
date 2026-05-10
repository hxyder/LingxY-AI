// Preview window renderer (UCA-182 Phase 14).
//
// This script owns the dedicated preview BrowserWindow anchored to
// the right edge of the primary display. It listens for three IPC
// events:
//
//   uca:preview-window-init      { toolName, args }
//     — a previewable artifact tool has started and the window should
//       open in "streaming" mode.
//
//   uca:preview-window-delta     { toolName, partialJson }
//     — partial tool-args JSON; we pass it straight into the
//       renderer-side streaming helper (outline-only for binary
//       formats, content stream for text / markdown).
//
//   uca:preview-window-committed { toolName, success, artifactPath,
//                                  mime, observation }
//     — tool finished; render the final artefact via the
//       livePreviewClient registry.
//
// An "openForFile" shortcut (kind = "open-file") is accepted on
// preview-window-init so artifact buttons in overlay / console can
// open this window directly without going through a fake "tool" run.
//
// The window never paints its own top-level chrome via the OS — the
// title bar and close/pin buttons live inside the HTML. That keeps
// the window compact and consistent with the popup-card aesthetic.

(function initPreviewWindow() {
  const head = document.getElementById("pvHead");
  const title = document.getElementById("pvTitle");
  const sub = document.getElementById("pvSub");
  const status = document.getElementById("pvStatus");
  const body = document.getElementById("pvBody");
  const meta = document.getElementById("pvMeta");
  const closeBtn = document.getElementById("pvCloseBtn");
  const pinBtn = document.getElementById("pvPinBtn");

  const state = {
    taskId: null,
    toolName: "",
    toolPath: "",
    toolKind: "text",
    rawJson: "",
    pinned: false
  };

  const root = document.getElementById("pvRoot");
  function setStatus(s) {
    status.dataset.state = s;
    // Phase 17: top-of-body progress bar tracks the running state.
    if (root) root.dataset.streaming = (s === "running") ? "1" : "0";
  }
  function setTitle(t) { title.textContent = t || "预览"; }
  function setSub(s) { sub.textContent = s || ""; }
  function setMeta(m) { meta.textContent = m || ""; }

  function inferKind(filePath, toolName) {
    const ext = (filePath.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
    if (ext === "html" || ext === "htm") return "html";
    if (ext === "md" || ext === "markdown") return "markdown";
    if (ext === "json") return "json";
    if (["js","mjs","cjs","ts","tsx","py","go","rs","java","sh","ps1","sql","yaml","yml","toml","ini","xml","css"].includes(ext)) return "code";
    if (["txt","log"].includes(ext)) return "text";
    if (["png","jpg","jpeg","gif","webp"].includes(ext)) return "image";
    if (toolName === "generate_document") return "binary";
    return "text";
  }
  function basename(p) { return (p || "").split(/[\\/]/).pop() || p; }
  function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
  }

  // --- Init (tool start OR open-file shortcut) -----------------------
  function applyInit(payload = {}) {
    const { kind = "tool", toolName, args, filePath, mime, taskId = null } = payload;
    if (kind === "open-file") {
      state.taskId = null;
      state.toolName = "__open__";
      state.toolPath = filePath || "";
      state.toolKind = inferKind(filePath || "", "__open__");
      state.rawJson = "";
      setStatus("ok");
      setTitle(basename(filePath || "预览"));
      setSub("打开预览");
      setMeta("");
      body.innerHTML = `<div class="pv-loading">加载中…</div>`;
      renderFinal(filePath, mime);
      return;
    }
    // Tool start
    state.taskId = taskId ?? null;
    state.toolName = toolName || "";
    state.toolPath = (args && (args.path || args.filename)) || "";
    state.toolKind = inferKind(state.toolPath, state.toolName);
    state.rawJson = "";
    setStatus("running");
    setTitle(state.toolPath || `${toolName} 生成中…`);
    setSub(toolName || "");
    const initialJson = args && Object.keys(args).length > 0
      ? JSON.stringify(args)
      : "";
    state.rawJson = initialJson;
    setMeta(`${formatBytes(initialJson.length)} · streaming`);
    if (initialJson && window.livePreviewStreaming?.renderDelta) {
      window.livePreviewStreaming.renderDelta(body, {
        toolName: state.toolName,
        rawJson: initialJson,
        toolKind: state.toolKind,
        toolPath: state.toolPath
      });
    } else {
      body.innerHTML = `<div class="pv-loading">正在生成…</div>`;
    }
  }

  function applyDelta(payload = {}) {
    const { toolName, partialJson, taskId = null } = payload;
    if (!toolName) return;
    if (state.taskId && taskId && state.taskId !== taskId) return;
    if (!state.toolName) {
      state.taskId = taskId ?? null;
      state.toolName = toolName;
      state.toolPath = "";
      state.toolKind = inferKind("", toolName);
      setStatus("running");
      setTitle(`${toolName} 生成中…`);
      setSub(toolName);
      body.innerHTML = `<div class="pv-loading">正在生成…</div>`;
    }
    if (state.toolName !== toolName) return;
    state.rawJson = partialJson || "";

    if (!state.toolPath && window.livePreviewStreaming?.extractStringField) {
      const extract = window.livePreviewStreaming.extractStringField;
      const inferred = extract(state.rawJson, "path") || extract(state.rawJson, "filename");
      if (inferred) {
        state.toolPath = inferred;
        state.toolKind = inferKind(inferred, toolName);
        setTitle(inferred);
      }
    }
    setMeta(`${formatBytes(state.rawJson.length)} · streaming`);
    window.livePreviewStreaming?.renderDelta(body, {
      toolName,
      rawJson: state.rawJson,
      toolKind: state.toolKind,
      toolPath: state.toolPath
    });
  }

  function applyCommit(payload = {}) {
    const { toolName, taskId = null, success, artifactPath, mime, observation } = payload;
    const committedToolName = toolName || state.toolName || "__artifact__";
    if (state.taskId && taskId && state.taskId !== taskId) return;
    if (state.toolName && toolName && state.toolName !== toolName) return;
    if (!state.toolName) {
      state.taskId = taskId ?? null;
      state.toolName = committedToolName;
      state.toolPath = artifactPath || "";
      state.toolKind = inferKind(artifactPath || "", committedToolName);
      setTitle(artifactPath ? basename(artifactPath) : "预览");
      setSub(committedToolName === "__artifact__" ? "" : committedToolName);
    }
    setStatus(success === false ? "err" : "ok");
    if (success === false) {
      setMeta(observation ? `失败 · ${String(observation).slice(0, 80)}` : "失败");
      body.innerHTML = `<div class="lp-error">${escapeHtml(observation || "工具失败")}</div>`;
      return;
    }
    setMeta(artifactPath ? `已生成 · ${basename(artifactPath)}` : "已完成");
    if (artifactPath) {
      state.toolPath = artifactPath;
      setTitle(basename(artifactPath));
      renderFinal(artifactPath, mime);
      return;
    }
    body.innerHTML = `<div class="pv-empty">生成已完成，但没有收到可预览的文件路径。</div>`;
  }

  function waitForSmokeRender(ms = 220) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.__lingxyPreviewSmoke = {
    async runToolInputDeltaLoad({ chunks = 1000, chunkText = "x", taskId = "gui-smoke-preview-stream" } = {}) {
      const count = Math.max(1, Math.min(5000, Number(chunks) || 1000));
      const text = String(chunkText || "x");
      const started = performance.now();
      applyInit({
        toolName: "write_file",
        args: { path: "gui-smoke-preview.txt" },
        taskId
      });
      let content = "";
      for (let i = 0; i < count; i += 1) {
        content += text;
        applyDelta({
          toolName: "write_file",
          taskId,
          partialJson: JSON.stringify({
            path: "gui-smoke-preview.txt",
            content
          })
        });
      }
      await waitForSmokeRender();
      const renderedText = body?.textContent ?? "";
      const durationMs = Math.round(performance.now() - started);
      return {
        ok: renderedText.includes(content),
        chunks: count,
        rendered_chars: renderedText.length,
        expected_chars: content.length,
        duration_ms: durationMs,
        status: status?.dataset?.state ?? "",
        title: title?.textContent ?? ""
      };
    },
    async runGenerateDocumentInitialDraftPreview({ taskId = "gui-smoke-doc-draft" } = {}) {
      applyInit({
        toolName: "generate_document",
        taskId,
        args: {
          kind: "pptx",
          outline: {
            title: "Quarterly Plan",
            slides: [
              { heading: "Goals", bullets: ["Grow usage", "Improve reliability"] },
              { heading: "Risks", body: "Keep file generation visible while running." }
            ]
          }
        }
      });
      await waitForSmokeRender();
      const renderedText = body?.textContent ?? "";
      return {
        ok: renderedText.includes("PowerPoint 草稿预览")
          && renderedText.includes("Quarterly Plan")
          && renderedText.includes("Slide 1")
          && !renderedText.includes('"outline"'),
        status: status?.dataset?.state ?? "",
        title: title?.textContent ?? "",
        rendered_text: renderedText.slice(0, 500)
      };
    },
    async runGenerateDocumentDraftFamilyMatrix({ taskId = "gui-smoke-doc-family" } = {}) {
      const cases = [
        {
          kind: "docx",
          marker: "Word 草稿预览",
          body: "Word body marker",
          outline: {
            title: "Word Plan",
            sections: [{ heading: "Scope", body: "Word body marker", bullets: ["Readable", "Structured"] }]
          }
        },
        {
          kind: "pdf",
          marker: "PDF 草稿预览",
          body: "PDF body marker",
          outline: {
            title: "PDF Brief",
            sections: [{ heading: "Summary", body: "PDF body marker" }]
          }
        },
        {
          kind: "html",
          marker: "HTML 草稿预览",
          body: "HTML body marker",
          outline: {
            title: "HTML Report",
            sections: [{ heading: "Page", body: "HTML body marker" }]
          }
        },
        {
          kind: "xlsx",
          marker: "Excel 草稿预览",
          body: "Revenue",
          outline: {
            title: "Sheet Preview",
            rows: [
              ["Metric", "Value"],
              ["Revenue", "128"],
              ["Risk", "Low"]
            ]
          }
        },
        {
          kind: "pptx",
          marker: "PowerPoint 草稿预览",
          body: "Grow usage",
          outline: {
            title: "Quarterly Plan",
            slides: [
              { heading: "Goals", bullets: ["Grow usage", "Improve reliability"] },
              { heading: "Risks", body: "Keep file generation visible while running." }
            ]
          }
        }
      ];
      const results = [];
      for (const item of cases) {
        applyInit({
          toolName: "generate_document",
          taskId: `${taskId}-${item.kind}`,
          args: {
            kind: item.kind,
            outline: item.outline
          }
        });
        await waitForSmokeRender();
        const renderedText = body?.textContent ?? "";
        results.push({
          kind: item.kind,
          ok: renderedText.includes(item.marker)
            && renderedText.includes(item.body)
            && !renderedText.includes('"outline"')
            && !renderedText.includes("sandbox:/"),
          marker: renderedText.includes(item.marker),
          body: renderedText.includes(item.body),
          raw_json_hidden: !renderedText.includes('"outline"'),
          no_fake_path: !renderedText.includes("sandbox:/"),
          status: status?.dataset?.state ?? "",
          title: title?.textContent ?? ""
        });
      }
      return {
        ok: results.every((result) => result.ok),
        results
      };
    },
    async runTaskBindingIsolation({
      taskId = "gui-smoke-session-a",
      otherTaskId = "gui-smoke-session-b"
    } = {}) {
      const trustedText = "SESSION_A_VISIBLE_CONTENT";
      const foreignText = "CROSS_TASK_SHOULD_NOT_RENDER";
      applyInit({
        toolName: "write_file",
        taskId,
        args: { path: "gui-smoke-session-a.txt" }
      });
      applyDelta({
        toolName: "write_file",
        taskId: otherTaskId,
        partialJson: JSON.stringify({
          path: "gui-smoke-session-b.txt",
          content: foreignText
        })
      });
      await waitForSmokeRender(80);
      const afterForeignDelta = body?.textContent ?? "";
      applyDelta({
        toolName: "write_file",
        taskId,
        partialJson: JSON.stringify({
          path: "gui-smoke-session-a.txt",
          content: trustedText
        })
      });
      await waitForSmokeRender(80);
      const afterTrustedDelta = body?.textContent ?? "";
      applyCommit({
        toolName: "write_file",
        taskId: otherTaskId,
        success: false,
        observation: "CROSS_COMMIT_SHOULD_NOT_RENDER"
      });
      await waitForSmokeRender(80);
      const afterForeignCommit = body?.textContent ?? "";
      return {
        ok: !afterForeignDelta.includes(foreignText)
          && afterTrustedDelta.includes(trustedText)
          && !afterForeignCommit.includes("CROSS_COMMIT_SHOULD_NOT_RENDER")
          && state.taskId === taskId,
        taskId: state.taskId,
        foreign_delta_ignored: !afterForeignDelta.includes(foreignText),
        trusted_delta_rendered: afterTrustedDelta.includes(trustedText),
        foreign_commit_ignored: !afterForeignCommit.includes("CROSS_COMMIT_SHOULD_NOT_RENDER"),
        status: status?.dataset?.state ?? "",
        title: title?.textContent ?? ""
      };
    }
  };

  async function renderFinal(filePath, mime) {
    if (!filePath || !window.livePreviewClient?.render) {
      body.innerHTML = `<div class="pv-empty">预览模块未加载。</div>`;
      return;
    }
    try {
      await window.livePreviewClient.render(body, {
        filePath,
        mime: mime ?? null,
        runtimeBaseUrl: window.__lingxyRuntimeBaseUrl
      });
    } catch (error) {
      body.innerHTML = `<div class="lp-error">预览失败：${escapeHtml(error?.message ?? error)}</div>`;
    }
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // --- Button wiring --------------------------------------------------
  closeBtn.addEventListener("click", () => {
    window.previewShellClient?.closePreviewWindow?.();
  });
  pinBtn.addEventListener("click", () => {
    state.pinned = !state.pinned;
    pinBtn.style.background = state.pinned ? "var(--accent-soft, rgba(37,99,235,.14))" : "transparent";
    pinBtn.style.color = state.pinned ? "var(--accent-strong, #1d4ed8)" : "var(--muted)";
    window.previewShellClient?.setPreviewWindowAlwaysOnTop?.(state.pinned);
  });

  // --- IPC wiring -----------------------------------------------------
  window.previewShellClient?.onPreviewWindowInit?.(applyInit);
  window.previewShellClient?.onPreviewWindowDelta?.(applyDelta);
  window.previewShellClient?.onPreviewWindowCommitted?.(applyCommit);

  // Resolve the runtime base url for handlers that fetch /file/pdf etc.
  // The URL query string carries ?serviceBaseUrl=... when the window
  // is created; fall back to the default.
  try {
    const q = new URLSearchParams(window.location.search);
    const base = q.get("serviceBaseUrl");
    if (base) window.__lingxyRuntimeBaseUrl = base;
  } catch { /* ignore */ }
})();
