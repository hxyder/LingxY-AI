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

// Normalise the model's formula output: strip fenced code blocks, trim
// whitespace, ensure it starts with "=" so Excel evaluates it.
export function normalizeFormula(text) {
  if (typeof text !== "string") return "";
  let value = text.trim();
  // Strip ```excel / ``` code fences if present.
  value = value.replace(/^```(?:[a-zA-Z]+)?\s*/, "").replace(/```$/, "").trim();
  // Grab the first line that looks like a formula.
  const line = value.split("\n").map((l) => l.trim()).find((l) => l.startsWith("=")) ?? value.split("\n")[0];
  if (!line) return "";
  return line.startsWith("=") ? line : `=${line.replace(/^=+/, "")}`;
}

// Write a formula into Excel's currently selected range (first cell only).
// Returns the address written to so the UI can confirm "已写入 B1".
export async function insertExcelFormula(formula) {
  if (!globalThis.Excel?.run) {
    return { ok: false, error: "Excel API 不可用（当前不是 Excel 或 API 未加载）。" };
  }
  const normalised = normalizeFormula(formula);
  if (!normalised) {
    return { ok: false, error: "返回的内容不像 Excel 公式。" };
  }
  try {
    const address = await globalThis.Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      // Single cell: write directly. Multi-cell: target the first cell so the
      // formula array-fills rather than pasting the literal into every cell.
      const target = range.getCell(0, 0);
      target.formulas = [[normalised]];
      target.load("address");
      await context.sync();
      return target.address;
    });
    return { ok: true, address, formula: normalised };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

// Replace each paragraph of the Word selection with a tracked-change-style
// review comment rather than overwriting it. When Word's comments API is
// available we attach real review comments; otherwise we fall back to
// inserting the review text as a parenthetical marker after the selection.
export async function insertWordReviewComment(commentText) {
  if (!globalThis.Word?.run) {
    return { ok: false, error: "Word API 不可用。" };
  }
  const body = `${commentText ?? ""}`.trim();
  if (!body) return { ok: false, error: "没有可插入的内容。" };
  try {
    return await globalThis.Word.run(async (context) => {
      const selection = context.document.getSelection();
      // Word ≥ 16 exposes insertComment; older builds don't — probe defensively.
      if (typeof selection.insertComment === "function") {
        selection.insertComment(body);
        await context.sync();
        return { ok: true, mode: "comment" };
      }
      // Fallback: append a highlighted review block right after the selection.
      selection.insertText(`\n[UCA 建议] ${body}`, "After");
      await context.sync();
      return { ok: true, mode: "inline_marker" };
    });
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

// Generate slides from an outline. Each line starting with "#" becomes a new
// slide title; non-# lines become bullet lines for the current slide. A blank
// line starts a new slide without a title.
export async function insertPowerPointOutline(outline) {
  if (!globalThis.PowerPoint?.run) {
    return { ok: false, error: "PowerPoint API 不可用。" };
  }
  const raw = `${outline ?? ""}`.trim();
  if (!raw) return { ok: false, error: "没有可插入的大纲。" };

  // Split outline into slide blocks.
  const slides = [];
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") { if (current) { slides.push(current); current = null; } continue; }
    if (trimmed.startsWith("#")) {
      if (current) slides.push(current);
      current = { title: trimmed.replace(/^#+\s*/, ""), bullets: [] };
    } else {
      if (!current) current = { title: "", bullets: [] };
      current.bullets.push(trimmed.replace(/^[-*•]\s*/, ""));
    }
  }
  if (current) slides.push(current);
  if (slides.length === 0) return { ok: false, error: "大纲解析为空。" };

  try {
    return await globalThis.PowerPoint.run(async (context) => {
      for (const slide of slides) {
        const bulletsText = slide.bullets.join("\n");
        // PowerPoint API has insertSlidesFromBase64 / addSlide — use the
        // simpler insertSlidesFromBase64 fallback if addSlide isn't available.
        if (typeof context.presentation.slides.add === "function") {
          context.presentation.slides.add();
        }
      }
      await context.sync();
      // The SlideCollection.add above creates blank slides; fill them by
      // re-iterating and setting title + body text via their TextFrame.
      const presentation = context.presentation;
      presentation.slides.load("items");
      await context.sync();

      const allSlides = presentation.slides.items;
      const offset = allSlides.length - slides.length;
      for (let i = 0; i < slides.length; i += 1) {
        const slide = allSlides[offset + i];
        if (!slide) continue;
        slide.shapes.load("items");
        await context.sync();

        const bulletsText = slides[i].bullets.join("\n");
        const combined = slides[i].title
          ? `${slides[i].title}\n\n${bulletsText}`
          : bulletsText;

        // Create a single textbox covering the slide body. Native layout
        // placeholders aren't programmatically fillable without a layout
        // template in scope, so a single textbox is the pragmatic path.
        const box = slide.shapes.addTextBox(combined);
        box.left = 40;
        box.top = 40;
        box.width = 640;
        box.height = 400;
        await context.sync();
      }
      return { ok: true, count: slides.length };
    });
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
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
    },
    async insertFormula(formula) {
      return insertExcelFormula(formula);
    },
    async insertReviewComment(text) {
      return insertWordReviewComment(text);
    },
    async insertOutline(outline) {
      return insertPowerPointOutline(outline);
    }
  };
}
