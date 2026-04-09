export type OfficeApp = "Word" | "Excel" | "PowerPoint";

export interface OfficeSelectionMetadata {
  office_app: OfficeApp;
  document_name?: string;
  document_path?: string;
  paragraph_count?: number;
  word_count?: number;
  style?: string;
  sheet_name?: string;
  range?: string;
  row_count?: number;
  col_count?: number;
  has_headers?: boolean;
  data_preview?: Array<Record<string, unknown>>;
  slide_index?: number;
  slide_count?: number;
  shape_type?: string;
  selected_text?: string;
}

export interface OfficeSelectionCapturePayload {
  officeApp: OfficeApp;
  hostProcess: "WINWORD.EXE" | "EXCEL.EXE" | "POWERPNT.EXE";
  selectionText?: string;
  html?: string;
  documentName?: string;
  documentPath?: string;
  selectionMetadata: OfficeSelectionMetadata;
}
