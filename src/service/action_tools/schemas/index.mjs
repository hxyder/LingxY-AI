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
      message: { type: "string" },
      handoff: {},
      navigate: {},
      notificationDir: { type: "string" }
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
  fetch_url_content: {
    type: "object",
    required: [],
    properties: {
      url: { type: "string" },        // full URL to fetch (https://...)
      max_chars: { type: "number" }   // max characters of extracted text to return (default 3000)
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
  },

  // UCA-053: File Discovery & Artifact Verification tools
  list_files: {
    type: "object",
    required: [],
    properties: {
      dir: { type: "string" },        // directory path to list
      pattern: { type: "string" },    // optional glob pattern, e.g. "*.pptx"
      limit: { type: "number" }       // max results (default 20)
    }
  },
  glob_files: {
    type: "object",
    required: [],
    properties: {
      pattern: { type: "string" }     // glob pattern, e.g. "~/Documents/**/*.pptx"
    }
  },
  find_recent_files: {
    type: "object",
    required: [],
    properties: {
      kind: { type: "string" },       // pptx | docx | xlsx | pdf | txt | md
      limit: { type: "number" },      // max results (default 5)
      since_hours: { type: "number" } // how far back to look (default 24)
    }
  },
  get_latest_artifact: {
    type: "object",
    required: [],
    properties: {
      kind: { type: "string" },       // pptx | docx | xlsx | pdf | any
      task_id: { type: "string" }     // optional, limit to specific task
    }
  },
  stat_file: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" }
    }
  },
  verify_file_exists: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" }
    }
  },
  register_artifact: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" },
      kind: { type: "string" },
      task_id: { type: "string" }
    }
  },
  resolve_output_path: {
    type: "object",
    required: [],
    properties: {
      filename: { type: "string" }    // filename to join with defaultOutputDir
    }
  },
  // UCA-076: GUI automation via Windows UIAutomation
  gui_find_element: {
    type: "object",
    required: [],
    properties: {
      window_title:    { type: "string" },  // partial title of target window
      automation_id:   { type: "string" },  // AutomationId of the UI element
      element_name:    { type: "string" },  // Name / accessible label of the element
      control_type:    { type: "string" }   // Button, Edit, Text, CheckBox, etc.
    }
  },
  gui_click: {
    type: "object",
    required: [],
    properties: {
      window_title:  { type: "string" },
      automation_id: { type: "string" },
      element_name:  { type: "string" },
      control_type:  { type: "string" },
      x:             { type: "number" },  // absolute screen x (skip element search)
      y:             { type: "number" }   // absolute screen y
    }
  },
  gui_type_text: {
    type: "object",
    required: [],
    properties: {
      text:          { type: "string" },  // text to type / set
      window_title:  { type: "string" },
      automation_id: { type: "string" },
      element_name:  { type: "string" },
      press_enter:   { type: "boolean" }  // send Enter after typing
    }
  }
});
