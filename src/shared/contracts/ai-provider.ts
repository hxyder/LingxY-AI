export type AIProviderKind = "cloud" | "local";

export interface AIProviderCapabilities {
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
}

export interface AIProviderRequest {
  providerId: string;
  model: string;
  systemPrompt?: string;
  input: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AIProviderAdapter {
  id: string;
  kind: AIProviderKind;
  displayName: string;
  capabilities: AIProviderCapabilities;
  isConfigured(): Promise<boolean>;
  validateConfig(): Promise<void>;
}
