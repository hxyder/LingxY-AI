export function buildTemplateEditorViewModel({
  templates = [],
  selectedTemplateId = null,
  validation = {
    ok: true,
    errors: []
  }
} = {}) {
  return {
    title: "模板编辑器",
    actions: ["new", "duplicate", "validate", "save_draft", "import_json", "export_json", "delete_user_template"],
    selectedTemplateId,
    templateCount: templates.length,
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      version: template.version,
      stepCount: template.steps?.length ?? 0,
      origin: template.template_origin ?? "builtin"
    })),
    validation,
    supportedStepKinds: ["executor", "action_tool", "template_ref"]
  };
}
