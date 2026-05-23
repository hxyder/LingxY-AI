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
  /**
   * Logical runtime namespace for the desktop shell. NOT the Windows
   * AppUserModelID — that lives in `package.json` build.appId
   * ("com.uca.desktop") and is mirrored in `BRAND_AUMID` in
   * src/desktop/tray/brand-icons.mjs. This field is the in-process
   * identifier used by manifest validation / shell wiring.
   */
  runtimeNamespace: string;
  trayTooltip: string;
  windows: DesktopWindowDescriptor[];
  shortcuts: ShortcutDefinition[];
  ipcChannels: string[];
}
