export type BrowserSourceType = "text_selection" | "link" | "image" | "webpage";

export interface BrowserCapturePayload {
  sourceType: BrowserSourceType;
  browser: string;
  url?: string;
  pageTitle?: string;
  text?: string;
  html?: string;
  imageUrl?: string;
  selectionText?: string;
  contextBefore?: string;
  contextAfter?: string;
  anchorText?: string;
  tabId?: number;
}

export interface NativeHostRequestEnvelope {
  protocolVersion: "1.0";
  requestId: string;
  action: "ping" | "submit_capture" | "get_recent_tasks";
  payload?: Record<string, unknown>;
}

export interface NativeHostResponseEnvelope {
  protocolVersion: "1.0";
  requestId: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}
