export interface ShortcutDefinition {
  id: string;
  accelerator: string;
  description: string;
}

export interface DesktopWindowDescriptor {
  id: "overlay" | "console";
  title: string;
  route: string;
  singleton: boolean;
  startsHidden: boolean;
  width: number;
  height: number;
}

export interface DesktopShellManifest {
  appId: string;
  trayTooltip: string;
  windows: DesktopWindowDescriptor[];
  shortcuts: ShortcutDefinition[];
  ipcChannels: string[];
}
