export function buildFirstRunWizardViewModel() {
  return {
    steps: [
      { id: "welcome", title: "欢迎", optional: false },
      { id: "clipboard", title: "剪贴板权限", optional: true },
      { id: "file_access", title: "文件权限", optional: true },
      { id: "browser_extension", title: "浏览器扩展", optional: true },
      { id: "llm_backend", title: "LLM 后端", optional: false }
    ]
  };
}
