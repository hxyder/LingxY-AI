function createBuiltinProvider({
  id,
  kind,
  displayName,
  capabilities
}) {
  return {
    id,
    kind,
    displayName,
    capabilities,
    async isConfigured() {
      return true;
    },
    async validateConfig() {
      return true;
    }
  };
}

export const BUILTIN_AI_PROVIDERS = Object.freeze([
  createBuiltinProvider({
    id: "anthropic.claude-sonnet",
    kind: "cloud",
    displayName: "Claude Sonnet",
    capabilities: {
      supportsStreaming: true,
      supportsToolUse: true,
      supportsVision: true,
      supportsEmbeddings: false
    }
  }),
  createBuiltinProvider({
    id: "openai.gpt-5.4-mini",
    kind: "cloud",
    displayName: "OpenAI GPT-5.4 Mini",
    capabilities: {
      supportsStreaming: true,
      supportsToolUse: true,
      supportsVision: true,
      supportsEmbeddings: true
    }
  }),
  createBuiltinProvider({
    id: "kimi.k2",
    kind: "cloud",
    displayName: "Kimi K2",
    capabilities: {
      supportsStreaming: true,
      supportsToolUse: false,
      supportsVision: false,
      supportsEmbeddings: false
    }
  }),
  createBuiltinProvider({
    id: "ollama.local",
    kind: "local",
    displayName: "Ollama Local",
    capabilities: {
      supportsStreaming: true,
      supportsToolUse: false,
      supportsVision: false,
      supportsEmbeddings: true
    }
  })
]);
