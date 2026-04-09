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
  baseUrl: "http://127.0.0.1:4310",
  fallbackProtocolUrl: "uca://office-submit"
});

function getOfficeHostLabel(hostType) {
  switch (hostType) {
    case "Excel":
      return "EXCEL.EXE";
    case "PowerPoint":
      return "POWERPNT.EXE";
    default:
      return "WINWORD.EXE";
  }
}

function selectedDataAsync(officeApi, coercionType) {
  return new Promise((resolve) => {
    officeApi.context.document.getSelectedDataAsync(coercionType, (result) => {
      if (result.status === officeApi.AsyncResultStatus.Succeeded) {
        resolve(result.value);
      } else {
        resolve(null);
      }
    });
  });
}

export async function captureOfficeSelection(officeApi, fallbackSelection = DEFAULT_OFFICE_SELECTION) {
  if (!officeApi?.context?.document?.getSelectedDataAsync) {
    return fallbackSelection;
  }

  const host = officeApi.context.host ?? "Word";
  const textSelection = await selectedDataAsync(officeApi, officeApi.CoercionType.Text);
  const matrixSelection = host === "Excel"
    ? await selectedDataAsync(officeApi, officeApi.CoercionType.Matrix)
    : null;
  const documentUrl = officeApi.context.document.url ?? fallbackSelection.documentPath;

  return {
    officeApp: host,
    hostProcess: getOfficeHostLabel(host),
    selectionText: typeof textSelection === "string" ? textSelection : fallbackSelection.selectionText,
    documentName: documentUrl ? documentUrl.split("/").pop() : fallbackSelection.documentName,
    documentPath: documentUrl,
    selectionMetadata: {
      office_app: host,
      selected_text: typeof textSelection === "string" ? textSelection : fallbackSelection.selectionText,
      matrix_preview: Array.isArray(matrixSelection?.slice?.(0, 5)) ? matrixSelection.slice(0, 5) : matrixSelection,
      host_platform: officeApi.context.platform ?? "unknown"
    }
  };
}

export function buildOfficeProtocolUrl({ fallbackProtocolUrl, selection, userCommand }) {
  const payload = encodeURIComponent(JSON.stringify({
    userCommand,
    officeCapture: selection
  }));
  return `${fallbackProtocolUrl}?payload=${payload}`;
}

export async function submitOfficeSelection({ transportPlan, userCommand, selection, fetchImpl = globalThis.fetch?.bind(globalThis), locationImpl = globalThis.window?.location }) {
  if (transportPlan.selectedPath === "path_b_http_runtime") {
    const response = await fetchImpl(`${transportPlan.baseUrl}/task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        officeCapture: selection,
        userCommand
      })
    });
    return response.json();
  }

  const protocolUrl = buildOfficeProtocolUrl({
    fallbackProtocolUrl: transportPlan.fallbackProtocolUrl,
    selection,
    userCommand
  });
  if (locationImpl) {
    locationImpl.href = protocolUrl;
  }
  return {
    ok: true,
    transport: "protocol",
    protocolUrl
  };
}

export function createOfficeBridge({
  officeApi = globalThis.Office,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  locationImpl = globalThis.window?.location
} = {}) {
  return {
    async captureSelection() {
      if (globalThis.window?.__ucaOfficeSelection) {
        return globalThis.window.__ucaOfficeSelection;
      }
      return captureOfficeSelection(officeApi, DEFAULT_OFFICE_SELECTION);
    },
    getTransportPlan() {
      return globalThis.window?.__ucaOfficeTransportPlan ?? DEFAULT_TRANSPORT_PLAN;
    },
    async submitSelection(userCommand, selection) {
      const result = await submitOfficeSelection({
        transportPlan: this.getTransportPlan(),
        userCommand,
        selection,
        fetchImpl,
        locationImpl
      });
      globalThis.window ??= {};
      globalThis.window.__ucaOfficeLastSubmit = {
        userCommand,
        selection,
        ts: Date.now(),
        transport: this.getTransportPlan().selectedPath,
        result
      };
      return result;
    }
  };
}
