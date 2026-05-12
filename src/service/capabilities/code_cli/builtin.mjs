import { getKimiRuntimeStatus } from "./kimi/runtime.mjs";

export const BUILTIN_CODE_CLI_ADAPTERS = Object.freeze([
  {
    id: "kimi-code-cli",
    displayName: "Kimi Code CLI",
    executable: "kimi",
    supportsCheckpointResume: false,
    async isAvailable({ runtime, config } = {}) {
      const status = getKimiRuntimeStatus({
        explicitRuntime: runtime?.kimiRuntime ?? null,
        config: config?.ai?.codeCli?.kimi ?? {}
      });
      return status.available;
    },
    async getStatus({ runtime, config } = {}) {
      return getKimiRuntimeStatus({
        explicitRuntime: runtime?.kimiRuntime ?? null,
        config: config?.ai?.codeCli?.kimi ?? {}
      });
    }
  },
  {
    id: "codex-cli",
    displayName: "Codex CLI",
    executable: "codex",
    supportsCheckpointResume: true,
    async isAvailable() {
      return true;
    },
    async getStatus() {
      return {
        id: "codex-cli",
        displayName: "Codex CLI",
        executable: "codex",
        supportsCheckpointResume: true,
        available: true,
        configured: true
      };
    }
  }
]);
