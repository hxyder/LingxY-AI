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
  const inlineContext = taskPackage.context.text?.trim()
    ? sanitizeUtf16(taskPackage.context.text).slice(0, 6_000)
    : "";

  const outputFormatId = taskPackage.output_requirements?.format_id ?? "markdown";
  const outputInstruction = (() => {
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
    if (outputFormatId === "docx") {
      return "- Return clean structured plain text suitable for saving into a Word document.";
    }
    return "- Produce a complete markdown report as your final answer.";
  })();

  return sanitizeUtf16(
    [
      "You are running inside Universal Context Agent.",
      `Task ID: ${taskPackage.task_id}`,
      `Task Type: ${taskPackage.task_type}`,
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
      inlineContext
        ? `\nInline captured text:\n${inlineContext}`
        : "",
      "",
      `Return only the final ${outputFormatId} body.`
    ].filter(Boolean).join("\n")
  );
}
