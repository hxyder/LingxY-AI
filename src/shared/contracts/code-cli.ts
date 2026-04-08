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

export interface CodeCliAdapter {
  id: string;
  displayName: string;
  executable: string;
  supportsCheckpointResume: boolean;
  isAvailable(): Promise<boolean>;
}
