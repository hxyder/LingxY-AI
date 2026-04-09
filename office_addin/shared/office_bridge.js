const DEFAULT_OFFICE_SELECTION = Object.freeze({
  officeApp: "Word",
  hostProcess: "WINWORD.EXE",
  selectionText: "Office selection placeholder",
  documentName: "Draft.docx",
  documentPath: "C:/Documents/Draft.docx",
  selectionMetadata: {
    office_app: "Word",
    paragraph_count: 1,
    word_count: 3,
    style: "Normal"
  }
});

const DEFAULT_TRANSPORT_PLAN = Object.freeze({
  selectedPath: "path_c_protocol_fallback",
  baseUrl: "https://localhost:9413",
  fallbackProtocolUrl: "uca://office-submit"
});

export function createOfficeBridge() {
  return {
    async captureSelection() {
      return window.__ucaOfficeSelection ?? DEFAULT_OFFICE_SELECTION;
    },
    getTransportPlan() {
      return window.__ucaOfficeTransportPlan ?? DEFAULT_TRANSPORT_PLAN;
    },
    async submitSelection(userCommand, selection) {
      window.__ucaOfficeLastSubmit = {
        userCommand,
        selection,
        ts: Date.now(),
        transport: this.getTransportPlan().selectedPath
      };
      return {
        ok: true
      };
    }
  };
}
