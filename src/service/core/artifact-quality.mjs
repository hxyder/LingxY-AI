import {
  evaluateSpreadsheetOutlineQuality,
  inspectSpreadsheetOutline
} from "./spreadsheet-outline.mjs";

const RESEARCH_PROFILES = new Set(["multi_source_research", "deep_research"]);
const FAKE_ARTIFACT_TEXT_RE = /sandbox:\/|\/mnt\/data\/|点击.{0,12}下载|下载链接|download (?:the )?(?:file|artifact|link)|cannot (?:directly )?(?:create|generate|save) (?:a )?(?:file|document|spreadsheet|presentation)|can't (?:directly )?(?:create|generate|save) (?:a )?(?:file|document|spreadsheet|presentation)|无法(?:直接)?(?:创建|生成|保存)(?:文件|文档|表格|演示文稿)|不能(?:直接)?(?:创建|生成|保存)(?:文件|文档|表格|演示文稿)|我(?:已经|已)为你生成.{0,40}(?:下载|链接)/iu;

function stringOf(value = "") {
  return String(value ?? "");
}

function visitOutline(value, visitor, depth = 0) {
  if (depth > 8) return;
  visitor(value);
  if (Array.isArray(value)) {
    for (const entry of value) visitOutline(entry, visitor, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const entry of Object.values(value)) visitOutline(entry, visitor, depth + 1);
}

export function inspectDocumentOutline(outline = {}) {
  const metrics = {
    title: "",
    sectionCount: 0,
    slideCount: 0,
    bodyChars: 0,
    bulletCount: 0,
    tableCount: 0,
    mermaidCount: 0,
    svgCount: 0,
    imageCount: 0,
    fakeArtifactTextCount: 0,
    longestTextFieldChars: 0,
    spreadsheet: null
  };

  if (outline && typeof outline === "object" && !Array.isArray(outline)) {
    metrics.title = stringOf(outline.title ?? "").trim();
    metrics.sectionCount = Array.isArray(outline.sections) ? outline.sections.length : 0;
    metrics.slideCount = Array.isArray(outline.slides) ? outline.slides.length : 0;
  }

  visitOutline(outline, (value) => {
    if (typeof value === "string") {
      const text = value.trim();
      metrics.bodyChars += text.length;
      metrics.longestTextFieldChars = Math.max(metrics.longestTextFieldChars, text.length);
      if (FAKE_ARTIFACT_TEXT_RE.test(text)) metrics.fakeArtifactTextCount += 1;
      const mermaidMatches = text.match(/```mermaid[\s\S]*?```/gi);
      if (mermaidMatches) metrics.mermaidCount += mermaidMatches.length;
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (value.table && typeof value.table === "object") metrics.tableCount += 1;
    if (value.diagram) metrics.mermaidCount += 1;
    if (Array.isArray(value.diagrams)) metrics.mermaidCount += value.diagrams.length;
    if (value.svg) metrics.svgCount += 1;
    if (Array.isArray(value.svgs)) metrics.svgCount += value.svgs.length;
    if (value.image || value.image_url || value.image_path) metrics.imageCount += 1;
    if (Array.isArray(value.images)) metrics.imageCount += value.images.length;
    if (Array.isArray(value.bullets)) metrics.bulletCount += value.bullets.length;
  });

  return metrics;
}

export function artifactQualityRequirements({ kind = "", task = null } = {}) {
  const researchProfile = task?.task_spec?.research_quality?.profile ?? null;
  const richResearch = RESEARCH_PROFILES.has(researchProfile);
  const artifactRequired = task?.task_spec?.artifact?.required === true
    || task?.task_spec?.success_contract?.artifact_created === true;

  return {
    enforce: artifactRequired && richResearch,
    richResearch,
    kind: stringOf(kind).toLowerCase()
  };
}

export function evaluateDocumentOutlineQuality({ kind = "", outline = {}, task = null } = {}) {
  const requirements = artifactQualityRequirements({ kind, task });
  const metrics = inspectDocumentOutline(outline);
  const issues = [];
  const normalizedKind = requirements.kind;
  const artifactRequired = task?.task_spec?.artifact?.required === true
    || task?.task_spec?.success_contract?.artifact_created === true;

  if (artifactRequired && metrics.fakeArtifactTextCount > 0) {
    issues.push("fake_artifact_text");
  }

  if (normalizedKind === "xlsx") {
    const spreadsheet = inspectSpreadsheetOutline(outline);
    metrics.spreadsheet = spreadsheet;
    const quality = evaluateSpreadsheetOutlineQuality({
      outline,
      requireTabular: requirements.richResearch
    });
    issues.push(...quality.issues);
    return {
      ok: issues.length === 0,
      enforce: true,
      metrics,
      issues
    };
  }

  if (!requirements.enforce) {
    if (artifactRequired && normalizedKind === "pptx") {
      if (metrics.slideCount <= 1 && metrics.longestTextFieldChars > 500 && metrics.bulletCount < 3) {
        issues.push("presentation_prose_dump");
      }
    }
    if (issues.length > 0) {
      return { ok: false, enforce: true, metrics, issues };
    }
    return { ok: true, enforce: false, metrics, issues };
  }

  if (!metrics.title) {
    issues.push("missing_title");
  }

  if (requirements.richResearch && (normalizedKind === "pdf" || normalizedKind === "docx" || normalizedKind === "html")) {
    if (metrics.sectionCount < 2) issues.push("too_few_sections");
    if (metrics.bodyChars < 500) issues.push("too_little_body_detail");
    if (metrics.tableCount === 0 && metrics.mermaidCount === 0 && metrics.svgCount === 0) issues.push("missing_structured_component");
  }

  if (requirements.richResearch && normalizedKind === "pptx") {
    if (metrics.slideCount < 3) issues.push("too_few_slides");
    if (metrics.tableCount === 0 && metrics.mermaidCount === 0 && metrics.svgCount === 0) issues.push("missing_structured_component");
    if (metrics.slideCount <= 1 && metrics.longestTextFieldChars > 500 && metrics.bulletCount < 3) {
      issues.push("presentation_prose_dump");
    }
  }

  return {
    ok: issues.length === 0,
    enforce: true,
    metrics,
    issues
  };
}

export function formatDocumentQualityError(result = {}, toolId = "generate_document") {
  const issues = Array.isArray(result.issues) ? result.issues : [];
  const labels = {
    missing_title: "add a title",
    too_few_sections: "include at least two substantive sections",
    too_little_body_detail: "add enough body detail for a real artifact",
    missing_structured_component: "include at least one structured component",
    too_few_slides: "include at least three slides",
    empty_spreadsheet: "provide non-empty spreadsheet headers or rows",
    generic_content_dump: "do not put the prose answer into a single generic Content column",
    markdown_or_sandbox_dump: "convert markdown/download prose into real spreadsheet cells",
    too_few_columns: "include at least two spreadsheet columns",
    too_few_rows: "include at least one spreadsheet data row",
    fake_artifact_text: "remove fake download/sandbox/inability text and create the real artifact content",
    presentation_prose_dump: "split long presentation prose into multiple slides with bullets or structured components"
  };
  return `${toolId}_outline_quality_failed: ${issues.map((issue) => labels[issue] ?? issue).join("; ")}`;
}
