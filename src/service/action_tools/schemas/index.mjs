export const ACTION_TOOL_SCHEMAS = Object.freeze({
  open_url: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string" }
    }
  },
  web_search: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      engine: { type: "string", enum: ["default", "google", "bing", "duckduckgo"] }
    }
  },
  compose_email: {
    type: "object",
    required: ["to", "subject", "body"],
    properties: {
      to: { type: "array", items: { type: "string" } },
      cc: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" }
    }
  },
  send_email_smtp: {
    type: "object",
    required: ["to", "subject", "body"],
    properties: {
      to: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" }
    }
  },
  open_file: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" }
    }
  },
  reveal_in_explorer: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" }
    }
  },
  launch_app: {
    type: "object",
    required: ["app"],
    properties: {
      app: { type: "string" },
      args: { type: "array", items: { type: "string" } }
    }
  },
  copy_to_clipboard: {
    type: "object",
    required: ["content"],
    properties: {
      content: { type: "string" }
    }
  },
  notify: {
    type: "object",
    required: ["title", "body"],
    properties: {
      title: { type: "string" },
      body: { type: "string" }
    }
  },
  file_op: {
    type: "object",
    required: ["operation", "path"],
    properties: {
      operation: { type: "string", enum: ["rename", "move", "copy", "delete", "create_folder"] },
      path: { type: "string" },
      targetPath: { type: "string" }
    }
  },
  take_screenshot: {
    type: "object",
    required: ["label"],
    properties: {
      label: { type: "string" }
    }
  },
  read_clipboard: {
    type: "object",
    required: [],
    properties: {}
  }
});
