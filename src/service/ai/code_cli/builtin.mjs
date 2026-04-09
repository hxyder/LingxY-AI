export const BUILTIN_CODE_CLI_ADAPTERS = Object.freeze([
  {
    id: "kimi-code-cli",
    displayName: "Kimi Code CLI",
    executable: "kimi.exe",
    supportsCheckpointResume: false,
    async isAvailable() {
      return true;
    }
  },
  {
    id: "codex-cli",
    displayName: "Codex CLI",
    executable: "codex",
    supportsCheckpointResume: true,
    async isAvailable() {
      return true;
    }
  }
]);
