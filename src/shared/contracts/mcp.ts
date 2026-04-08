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
