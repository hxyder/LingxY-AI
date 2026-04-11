export interface MCPResourceDescriptor {
  server: string;
  uri: string;
  title?: string;
  mimeType?: string;
}

export interface MCPServerAdapter {
  id: string;
  displayName: string;
  transport: "stdio" | "http" | "ws";
  isAvailable(): Promise<boolean>;
  listResources(): Promise<MCPResourceDescriptor[]>;
}

export interface MCPServerConfig {
  id: string;
  displayName?: string;
  transport: "stdio" | "http" | "ws";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string | undefined>;
  enabled?: boolean;
}

export interface MCPServerStatus extends MCPServerConfig {
  available: boolean;
  configured: boolean;
  source?: string;
  detail?: string;
}
