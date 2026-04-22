import path from "node:path";

function sanitizeUtf16(text) {
  if (!text) {
    return "";
  }

  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        output += text[index] + text[index + 1];
        index += 1;
      } else {
        output += "?";
      }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) {
      output += "?";
      continue;
    }
    output += text[index];
  }
  return output.normalize("NFC");
}

function commonPath(paths) {
  if (paths.length === 0) {
    return null;
  }

  const resolved = paths.map((entry) => path.resolve(entry));
  const root = path.parse(resolved[0]).root;
  const roots = new Set(resolved.map((entry) => path.parse(entry).root.toLowerCase()));
  if (roots.size > 1) {
    return null;
  }

  const segments = resolved.map((entry) => entry.slice(root.length).split(path.sep).filter(Boolean));
  const shared = [];
  for (let segmentIndex = 0; ; segmentIndex += 1) {
    const reference = segments[0][segmentIndex];
    if (!reference) {
      break;
    }
    const matches = segments.every(
      (parts) => (parts[segmentIndex] ?? "").toLowerCase() === reference.toLowerCase()
    );
    if (!matches) {
      break;
    }
    shared.push(reference);
  }

  if (shared.length === 0) {
    return root;
  }

  return path.join(root, ...shared);
}

export function deriveKimiWorkspace(taskPackage) {
  const fileDirs = [...new Set(
    (taskPackage.context.file_paths ?? [])
      .map((entry) => path.dirname(path.resolve(entry)))
  )];
  const workDir = commonPath(fileDirs) ?? process.cwd();
  const addDirs = fileDirs.filter((entry) => {
    const normalizedEntry = path.resolve(entry).toLowerCase();
    const normalizedWorkDir = path.resolve(workDir).toLowerCase();
    return normalizedEntry !== normalizedWorkDir && !normalizedEntry.startsWith(`${normalizedWorkDir}${path.sep}`);
  });

  return {
    workDir,
    addDirs
  };
}

export function buildKimiPrintPrompt({ taskPackage }) {
  const fileList = (taskPackage.context.file_paths ?? []).length > 0
    ? taskPackage.context.file_paths.map((entry) => `- ${entry}`).join("\n")
    : "- No file paths were provided.";
  const imageList = (taskPackage.context.image_paths ?? []).length > 0
    ? taskPackage.context.image_paths.map((entry) => `- ${entry}`).join("\n")
    : "";
  const inlineContext = taskPackage.context.text?.trim()
    ? sanitizeUtf16(taskPackage.context.text).slice(0, 6_000)
    : "";
  const sourceUrl = taskPackage.context.url?.trim()
    ? sanitizeUtf16(taskPackage.context.url).slice(0, 1_000)
    : "";
  const selectionMetadata = taskPackage.context.metadata?.selection_metadata ?? {};
  const selectionMetadataLines = [
    selectionMetadata.page_title ? `- Page title: ${sanitizeUtf16(String(selectionMetadata.page_title)).slice(0, 500)}` : "",
    selectionMetadata.anchor_text ? `- Anchor text: ${sanitizeUtf16(String(selectionMetadata.anchor_text)).slice(0, 500)}` : "",
    selectionMetadata.image_url ? `- Image URL: ${sanitizeUtf16(String(selectionMetadata.image_url)).slice(0, 1_000)}` : ""
  ].filter(Boolean);

  const outputFormatId = taskPackage.output_requirements?.format_id ?? "markdown";
  const isConversational = outputFormatId === "conversational";
  const outputInstruction = (() => {
    if (isConversational) {
      return "- Reply concisely and directly in plain text. Do not use markdown headings, code fences, or lengthy formatting. Keep it brief and natural, like a chat reply.";
    }
    if (outputFormatId === "json") {
      return "- Return valid JSON only.";
    }
    if (outputFormatId === "csv") {
      return "- Return CSV content only.";
    }
    if (outputFormatId === "html") {
      return "- Return a complete HTML fragment or document only.";
    }
    if (outputFormatId === "txt") {
      return "- Return plain text only, without markdown syntax.";
    }
    if (outputFormatId === "pdf") {
      return "- Return a well-structured HTML document suitable for printing to PDF. Use clean headings, paragraphs, and tables.";
    }
    if (outputFormatId === "docx") {
      return "- Return clean structured plain text suitable for saving into a Word document.";
    }
    if (outputFormatId === "xlsx") {
      return "- Return clean structured plain text suitable for saving into an Excel spreadsheet. Use one line per row, separate columns with tabs.";
    }
    return "- Produce a complete markdown report as your final answer.";
  })();

  // Wall-clock context — prevents the CLI from answering with its
  // training-cutoff year when the user asks about "今天/明天/本周".
  // Matches the tool_using/agent-loop.mjs and agentic/prompt-builder.mjs
  // injections so every executor path has the same grounding.
  const nowLocal = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const timeBanner = `Current local date and time: ${nowLocal.toLocaleString("sv-SE", { hour12: false })} (${tz}). Interpret relative dates ("今天/明天/本周/yesterday/next week") against this moment; do not emit years from training memory.`;

  return sanitizeUtf16(
    [
      "You are running inside Universal Context Agent.",
      `Task ID: ${taskPackage.task_id}`,
      `Task Type: ${taskPackage.task_type}`,
      timeBanner,
      "",
      "Primary objective:",
      sanitizeUtf16(taskPackage.user_command),
      "",
      "Required behavior:",
      "- Read the provided source material before answering.",
      "- Do not modify any source files.",
      outputInstruction,
      "- Mention missing or unreadable files explicitly instead of guessing.",
      "- Keep the report factual and directly tied to the provided inputs.",
      "",
      "Source files:",
      fileList,
      imageList
        ? `\nSource images:\n${imageList}\n\nIf the CLI supports vision, inspect these image files directly. If vision is unavailable, say so explicitly and use any OCR text only as a fallback.`
        : "",
      sourceUrl
        ? `\nSource URL:\n${sourceUrl}`
        : "",
      selectionMetadataLines.length > 0
        ? `\nCaptured metadata:\n${selectionMetadataLines.join("\n")}`
        : "",
      inlineContext
        ? `\nInline captured text:\n${inlineContext}`
        : "",
      "",
      isConversational
        ? "Reply directly and concisely."
        : `Return only the final ${outputFormatId} body.`
    ].filter(Boolean).join("\n")
  );
}
