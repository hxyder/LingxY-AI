const DEFAULT_OFFICE_SELECTION = Object.freeze({
  officeApp: "Word",
  hostProcess: "WINWORD.EXE",
  selectionText: "Office selection placeholder",
  documentName: "Draft.docx",
  documentPath: "C:/Documents/Draft.docx",
  captureScope: "selection",
  selectionMetadata: {
    office_app: "Word",
    capture_scope: "selection",
    paragraph_count: 1,
    word_count: 3,
    style: "Normal"
  }
});

const DEFAULT_TRANSPORT_PLAN = Object.freeze({
  selectedPath: "path_b_http_runtime",
  baseUrl: "http://127.0.0.1:4310",
  fallbackProtocolUrl: "uca://office-submit"
});

function normalizeHost(hostType) {
  const host = `${hostType ?? "Word"}`;
  if (/excel/i.test(host)) return "Excel";
  if (/powerpoint|presentation/i.test(host)) return "PowerPoint";
  return "Word";
}

function getOfficeHostLabel(hostType) {
  switch (normalizeHost(hostType)) {
    case "Excel":
      return "EXCEL.EXE";
    case "PowerPoint":
      return "POWERPNT.EXE";
    default:
      return "WINWORD.EXE";
  }
}

function getDocumentName(documentUrl, fallbackSelection) {
  if (!documentUrl) {
    return fallbackSelection.documentName;
  }
  return `${documentUrl}`.split(/[\\/]/).pop() || fallbackSelection.documentName;
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

function setSelectedDataAsync(officeApi, value, coercionType) {
  return new Promise((resolve) => {
    officeApi.context.document.setSelectedDataAsync(value, {
      coercionType
    }, (result) => {
      resolve({
        ok: result.status === officeApi.AsyncResultStatus.Succeeded,
        error: result.error?.message ?? null
      });
    });
  });
}

function fileSliceAsync(file, sliceIndex) {
  return new Promise((resolve, reject) => {
    file.getSliceAsync(sliceIndex, (result) => {
      if (result.status === "succeeded") {
        const data = result.value?.data;
        resolve(Array.isArray(data) ? data.join("") : `${data ?? ""}`);
      } else {
        reject(new Error(result.error?.message ?? `Unable to read Office file slice ${sliceIndex}`));
      }
    });
  });
}

function closeOfficeFile(file) {
  return new Promise((resolve) => {
    try {
      file.closeAsync(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function getOfficeFileText(officeApi) {
  if (!officeApi?.context?.document?.getFileAsync) {
    return "";
  }

  const file = await new Promise((resolve, reject) => {
    officeApi.context.document.getFileAsync(officeApi.FileType.Text, {
      sliceSize: 64 * 1024
    }, (result) => {
      if (result.status === officeApi.AsyncResultStatus.Succeeded) {
        resolve(result.value);
      } else {
        reject(new Error(result.error?.message ?? "Unable to read Office document text."));
      }
    });
  });

  try {
    const slices = [];
    for (let index = 0; index < file.sliceCount; index += 1) {
      slices.push(await fileSliceAsync(file, index));
    }
    return slices.join("");
  } finally {
    await closeOfficeFile(file);
  }
}

function matrixToText(matrix) {
  if (!Array.isArray(matrix)) {
    return typeof matrix === "string" ? matrix : "";
  }
  return matrix.map((row) =>
    (Array.isArray(row) ? row : [row])
      .map((cell) => `${cell ?? ""}`.trim())
      .join("\t")
  ).join("\n");
}

async function captureExcelUsedRange() {
  if (!globalThis.Excel?.run) {
    return null;
  }

  return globalThis.Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const range = sheet.getUsedRangeOrNullObject();
    sheet.load("name");
    range.load(["address", "values", "rowCount", "columnCount"]);
    await context.sync();

    if (range.isNullObject) {
      return {
        text: "",
        metadata: {
          sheet_name: sheet.name,
          range: "empty",
          row_count: 0,
          col_count: 0
        }
      };
    }

    return {
      text: matrixToText(range.values),
      metadata: {
        sheet_name: sheet.name,
        range: range.address,
        row_count: range.rowCount,
        col_count: range.columnCount,
        matrix_preview: range.values.slice(0, 20)
      }
    };
  });
}

async function captureWordBody() {
  if (!globalThis.Word?.run) {
    return null;
  }

  return globalThis.Word.run(async (context) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    return {
      text: body.text ?? "",
      metadata: {
        body_capture_api: "Word.run.document.body"
      }
    };
  });
}

async function capturePowerPointText(officeApi) {
  const fileText = await getOfficeFileText(officeApi).catch(() => "");
  if (fileText) {
    return {
      text: fileText,
      metadata: {
        body_capture_api: "Office.context.document.getFileAsync",
        scope_note: "PowerPoint full-text capture is best-effort."
      }
    };
  }
  return null;
}

async function captureSelectionData(officeApi, host) {
  const textSelection = await selectedDataAsync(officeApi, officeApi.CoercionType.Text);
  const matrixSelection = host === "Excel"
    ? await selectedDataAsync(officeApi, officeApi.CoercionType.Matrix)
    : null;
  const textValue = typeof textSelection === "string" ? textSelection : "";
  const matrixText = matrixToText(matrixSelection);

  return {
    text: textValue || matrixText,
    metadata: {
      selected_text: textValue,
      matrix_preview: Array.isArray(matrixSelection?.slice?.(0, 20)) ? matrixSelection.slice(0, 20) : matrixSelection,
      row_count: Array.isArray(matrixSelection) ? matrixSelection.length : undefined,
      col_count: Array.isArray(matrixSelection?.[0]) ? matrixSelection[0].length : undefined
    }
  };
}

export async function captureOfficeSelection(officeApi, fallbackSelection = DEFAULT_OFFICE_SELECTION, options = {}) {
  if (!officeApi?.context?.document?.getSelectedDataAsync) {
    return {
      ...fallbackSelection,
      captureScope: options.scope ?? fallbackSelection.captureScope ?? "selection"
    };
  }

  const host = normalizeHost(officeApi.context.host);
  const scope = options.scope ?? "selection";
  const documentUrl = officeApi.context.document.url ?? fallbackSelection.documentPath;
  let content = null;

  if (scope === "document") {
    if (host === "Excel") {
      content = await captureExcelUsedRange().catch(() => null);
    } else if (host === "Word") {
      content = await captureWordBody().catch(() => null)
        ?? { text: await getOfficeFileText(officeApi).catch(() => ""), metadata: { body_capture_api: "getFileAsync" } };
    } else if (host === "PowerPoint") {
      content = await capturePowerPointText(officeApi).catch(() => null);
    }
  }

  if (!content || !content.text) {
    content = await captureSelectionData(officeApi, host);
  }

  const selectionText = `${content.text ?? ""}`;
  return {
    officeApp: host,
    hostProcess: getOfficeHostLabel(host),
    selectionText: selectionText || fallbackSelection.selectionText,
    documentName: getDocumentName(documentUrl, fallbackSelection),
    documentPath: documentUrl,
    captureScope: scope,
    selectionMetadata: {
      office_app: host,
      capture_scope: scope,
      host_platform: officeApi.context.platform ?? "unknown",
      ...content.metadata
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

export async function submitOfficeSelection({
  transportPlan,
  userCommand,
  selection,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  locationImpl = globalThis.window?.location
}) {
  if (transportPlan.selectedPath === "path_b_http_runtime" && fetchImpl) {
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

export async function writeOfficeResult(officeApi, text, { mode = "replace_selection" } = {}) {
  if (!officeApi?.context?.document?.setSelectedDataAsync) {
    return {
      ok: false,
      error: "Office writeback API is not available."
    };
  }

  const value = mode === "insert_with_label"
    ? `\n\nUCA result:\n${text}`
    : text;
  return setSelectedDataAsync(officeApi, value, officeApi.CoercionType.Text);
}

export function createOfficeBridge({
  officeApi = globalThis.Office,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  locationImpl = globalThis.window?.location
} = {}) {
  return {
    async captureSelection(options = {}) {
      if (globalThis.window?.__ucaOfficeSelection) {
        return {
          ...globalThis.window.__ucaOfficeSelection,
          captureScope: options.scope ?? globalThis.window.__ucaOfficeSelection.captureScope ?? "selection"
        };
      }
      return captureOfficeSelection(officeApi, DEFAULT_OFFICE_SELECTION, options);
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
    },
    async writeResult(text, options = {}) {
      return writeOfficeResult(officeApi, text, options);
    }
  };
}
