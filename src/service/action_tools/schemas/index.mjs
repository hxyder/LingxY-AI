// All action tool schemas use loose validation:
// - `required` is empty so the LLM never gets a hard schema_validation_failed for missing fields
// - properties are still typed so obvious type errors are caught
// - the actual tool implementation is responsible for checking required fields and returning a useful error
//
// Rationale: AI planners often paraphrase ("body" vs "content", "to" as string vs array). We let the
// tool layer accept those variations and only fail at execute() time with a descriptive observation
// the LLM can act on.

export const ACTION_TOOL_SCHEMAS = Object.freeze({
  open_url: {
    type: "object",
    required: [],
    properties: {
      url: { type: "string" }
    }
  },
  web_search: {
    type: "object",
    required: [],
    properties: {
      query: { type: "string" },
      engine: {}, // accept any string the LLM picks; tool maps to default
      recency: {} // optional: day/week/month/year or d/w/m/y
    }
  },
  compose_email: {
    type: "object",
    required: [],
    properties: {
      to: {},
      cc: {},
      subject: { type: "string" },
      body: { type: "string" }
    }
  },
  send_email_smtp: {
    type: "object",
    required: [],
    properties: {
      to: {},
      subject: { type: "string" },
      body: { type: "string" }
    }
  },
  open_file: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" }
    }
  },
  reveal_in_explorer: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" }
    }
  },
  launch_app: {
    type: "object",
    required: [],
    properties: {
      app: {}, // accept string or any synonym
      args: {}
    }
  },
  copy_to_clipboard: {
    type: "object",
    required: [],
    properties: {
      content: {}, // accept string or other types — tool will coerce
      text: {}
    }
  },
  notify: {
    type: "object",
    required: [],
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      message: { type: "string" }
    }
  },
  file_op: {
    type: "object",
    required: [],
    properties: {
      operation: {}, // accept any verb; tool validates against allowed list
      path: { type: "string" },
      targetPath: { type: "string" }
    }
  },
  take_screenshot: {
    type: "object",
    required: [],
    properties: {
      label: { type: "string" }
    }
  },
  read_clipboard: {
    type: "object",
    required: [],
    properties: {}
  },
  create_scheduled_task: {
    type: "object",
    required: [],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      trigger: {},
      action: {},
      execution_mode: {},
      catchup_policy: {}
    }
  },
  list_scheduled_tasks: {
    type: "object",
    required: [],
    properties: {
      includeDisabled: { type: "boolean" }
    }
  },
  delete_scheduled_task: {
    type: "object",
    required: [],
    properties: {
      schedule_id: { type: "string" }
    }
  },
  pause_scheduled_task: {
    type: "object",
    required: [],
    properties: {
      schedule_id: { type: "string" },
      enabled: { type: "boolean" }
    }
  },
  translate_text: {
    type: "object",
    required: [],
    properties: {
      text: {},                       // string to translate (also accepts `content`)
      content: {},
      source: { type: "string" },     // optional ISO code or "auto"
      target: { type: "string" }      // optional ISO code; defaults to zh-CN/en heuristic
    }
  },
  web_search_fetch: {
    type: "object",
    required: [],
    properties: {
      query: { type: "string" },
      limit: { type: "number" },      // number of results to return (default 5)
      recency: {}                     // optional: day/week/month/year or d/w/m/y
    }
  },
  write_file: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" },       // relative to task output_dir; "." / ".." / symlinks rejected
      filename: { type: "string" },   // alt name the LLM may use
      content: { type: "string" },    // utf-8 text content
      text: { type: "string" },       // alt name some planners use
      overwrite: { type: "boolean" }, // default false; existing file → error unless true
      encoding: { type: "string" }    // default "utf8"; accepts "utf8"|"utf-8"|"base64"
    }
  },
  run_script: {
    type: "object",
    required: [],
    properties: {
      language: { type: "string" },   // powershell | node | python (strict whitelist)
      script: { type: "string" },     // source code to execute
      code: { type: "string" },       // alt name some planners use
      timeout: { type: "number" }     // seconds; clamped to [1, 20]
    }
  },
  generate_document: {
    type: "object",
    required: [],
    properties: {
      kind: { type: "string" },       // pptx | docx | xlsx | pdf
      outline: {},                    // structured outline object; shape depends on kind
      filename: { type: "string" }    // optional; defaults to result.<ext>
    }
  }
});
