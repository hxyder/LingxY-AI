import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function stripCodeFences(text) {
  return `${text}`
    .replace(/```[a-z0-9_-]*\r?\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function stripMarkdownSyntax(text) {
  return stripCodeFences(text)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function escapeHtml(text) {
  return `${text}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCsvCell(text) {
  return `"${`${text}`.replace(/"/g, "\"\"")}"`;
}

function detectRequestedOutputFormat(userCommand = "") {
  const normalized = `${userCommand}`.toLowerCase();

  if (/(?:\.docx|docx|word 文档|word文件|word\b|文档格式)/i.test(normalized)) {
    return {
      id: "docx",
      extension: ".docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      primaryRequirement: "word_document",
      promptInstruction: "Return clean structured plain text suitable for saving into a Word document."
    };
  }

  if (/(?:\.html|html|网页格式|网页文件)/i.test(normalized)) {
    return {
      id: "html",
      extension: ".html",
      mimeType: "text/html",
      primaryRequirement: "html_document",
      promptInstruction: "Return a complete HTML fragment or document only."
    };
  }

  if (/(?:\.json|json)/i.test(normalized)) {
    return {
      id: "json",
      extension: ".json",
      mimeType: "application/json",
      primaryRequirement: "json_file",
      promptInstruction: "Return valid JSON only."
    };
  }

  if (/(?:\.csv|csv|表格文件|逗号分隔)/i.test(normalized)) {
    return {
      id: "csv",
      extension: ".csv",
      mimeType: "text/csv",
      primaryRequirement: "csv_file",
      promptInstruction: "Return CSV content only."
    };
  }

  if (/(?:\.txt|txt|纯文本|文本文件)/i.test(normalized)) {
    return {
      id: "txt",
      extension: ".txt",
      mimeType: "text/plain",
      primaryRequirement: "plain_text_report",
      promptInstruction: "Return plain text only, without markdown syntax."
    };
  }

  return {
    id: "markdown",
    extension: ".md",
    mimeType: "text/markdown",
    primaryRequirement: "markdown_report",
    promptInstruction: "Return a complete markdown report."
  };
}

function coerceJson(text) {
  const candidate = stripCodeFences(text);
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return JSON.stringify({ response: stripMarkdownSyntax(text) }, null, 2);
  }
}

function coerceCsv(text) {
  const candidate = stripCodeFences(text);
  if (candidate.includes(",") && candidate.split(/\r?\n/).length > 1) {
    return candidate.trim();
  }
  return `response\n${escapeCsvCell(stripMarkdownSyntax(text))}\n`;
}

function coerceHtml(text) {
  const candidate = stripCodeFences(text).trim();
  if (/<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<article[\s>]/i.test(candidate)) {
    return candidate;
  }
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "  <head>",
    "    <meta charset=\"utf-8\">",
    "    <title>UCA Result</title>",
    "  </head>",
    "  <body>",
    "    <main>",
    `      <pre>${escapeHtml(stripMarkdownSyntax(text))}</pre>`,
    "    </main>",
    "  </body>",
    "</html>"
  ].join("\n");
}

async function writeDocxArtifact(targetPath, plainText) {
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(process.cwd(), "scripts", "create-ooxml-fixture.ps1"),
      "-TargetPath",
      targetPath,
      "-Kind",
      "docx",
      "-Text",
      plainText
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    }
  );
}

export function choosePreviewArtifactPath(artifacts = []) {
  const previewableExtensions = [".md", ".txt", ".json", ".csv", ".html", ".htm"];
  return artifacts.find((artifact) => previewableExtensions.includes(path.extname(artifact.path).toLowerCase()))?.path ?? null;
}

export async function writeRequestedArtifacts({
  assistantText,
  outputDir,
  requestedFormat
}) {
  const artifacts = [];
  const baseText = assistantText?.trim() || "UCA completed without returning content.";

  if (requestedFormat.id === "docx") {
    const docxPath = path.join(outputDir, "result.docx");
    const previewPath = path.join(outputDir, "result-preview.txt");
    const previewText = stripMarkdownSyntax(baseText) || "UCA completed without returning content.";
    await writeDocxArtifact(docxPath, previewText);
    await writeFile(previewPath, `${previewText}\n`, "utf8");
    artifacts.push(
      { path: docxPath, mime_type: requestedFormat.mimeType },
      { path: previewPath, mime_type: "text/plain" }
    );
    return artifacts;
  }

  const fileName = requestedFormat.id === "markdown" ? "report.md" : `result${requestedFormat.extension}`;
  const targetPath = path.join(outputDir, fileName);

  let renderedText = baseText;
  if (requestedFormat.id === "txt") {
    renderedText = stripMarkdownSyntax(baseText);
  } else if (requestedFormat.id === "json") {
    renderedText = coerceJson(baseText);
  } else if (requestedFormat.id === "csv") {
    renderedText = coerceCsv(baseText);
  } else if (requestedFormat.id === "html") {
    renderedText = coerceHtml(baseText);
  }

  await writeFile(targetPath, `${renderedText.trim()}\n`, "utf8");
  artifacts.push({
    path: targetPath,
    mime_type: requestedFormat.mimeType
  });

  return artifacts;
}

export { detectRequestedOutputFormat };
