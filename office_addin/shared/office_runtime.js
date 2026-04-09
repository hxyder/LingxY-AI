export function createOfficeTaskPaneViewModel(selection, transportPlan) {
  return {
    previewText: selection?.selectionText?.trim() || "当前未检测到选区。",
    transportStatus: transportPlan.selectedPath === "path_c_protocol_fallback"
      ? "当前基础版走协议回退路径 uca://office-submit，localhost HTTPS 仍为增强项。"
      : `当前传输路径：${transportPlan.baseUrl}`
  };
}
