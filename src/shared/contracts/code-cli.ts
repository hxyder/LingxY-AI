export interface CodeCliTaskPackage {
  taskId: string;
  taskType: string;
  userCommand: string;
  workingDirectory?: string;
  outputDirectory?: string;
  payload: Record<string, unknown>;
}

export interface CodeCliEvent {
  type: string;
  ts: number;
  payload?: Record<string, unknown>;
}

export interface CodeCliRuntimeConfig {
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export interface CodeCliAdapter {
  id: string;
  displayName: string;
  executable: string;
  supportsCheckpointResume: boolean;
  isAvailable(): Promise<boolean>;
}

export interface CodeCliAdapterConfig {
  id: string;
  displayName?: string;
  command: string;
  args?: string[];
  transport?: "stream_json_print" | "jsonl_task_package";
  defaultModel?: string;
  configFile?: string;
  mcpConfigFiles?: string[];
  supportsCheckpointResume?: boolean;
}
