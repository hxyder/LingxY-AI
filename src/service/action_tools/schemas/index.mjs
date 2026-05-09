// Most action tool schemas use loose validation:
// - routine tools keep `required` empty so the LLM can repair paraphrased args
// - artifact creation tools use a small required contract for fields that are
//   impossible to infer safely (for example document kind/outline or SVG markup)
// - properties are still typed so obvious type errors are caught
// - the tool layer remains responsible for useful execution-time errors
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
      forcePopup: {},
      allowLongBody: {},
      autoHideMs: {},
      dedupeKey: {},
      skipBatch: {},
      notificationDir: { type: "string" }
    }
  },
  preview_skill_from_github: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string" }
    }
  },
  install_skill_from_github: {
    type: "object",
    required: ["state_token"],
    properties: {
      state_token: { type: "string" }
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
    // The trigger + action shapes below match scheduler/store.mjs. `kind` is
    // accepted as an alias for `type` on the trigger, and `tool`/`args` are
    // accepted as aliases for `target`/`params` on the action — but the
    // canonical names (`type` / `target` / `params`) described here are
    // preferred so the agent sees one unambiguous schema.
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      trigger: {
        type: "object",
        description: "Schedule trigger. Pick ONE form:\n- type=\"at\" + run_at=ISO8601 for a ONE-SHOT fire at a specific moment (for '5 分钟后' / '明天早上 9 点' / 'in 10 minutes'). After it fires, it is complete and will not run again.\n- type=\"cron\" + expression for recurring work (e.g. '0 9 * * *' daily 9am). Use this when the user says 每天/每周/every day/every week/recurring.\n- type=\"interval\" + seconds for recurring every-N-seconds, unless metadata.one_shot is explicitly set by the caller.\n- type=\"file_watch\" + path for filesystem triggers.\nOr pass {natural_language: '5 分钟后' / 'tomorrow 9am' / 'every day at 9am'} and the backend parses it into one of the above.",
        properties: {
          type: { type: "string", enum: ["cron", "interval", "at", "file_watch"] },
          expression: { type: "string", description: "Cron expression, required when type=cron." },
          seconds: { type: "number" },
          minutes: { type: "number" },
          hours: { type: "number" },
          run_at: { type: "string", description: "ISO8601 timestamp for a one-shot 'at' trigger. Example: 2026-04-20T14:45:00-04:00" },
          path: { type: "string", description: "Watched path, required when type=file_watch." },
          natural_language: { type: "string", description: "Plain-language trigger, parsed server-side. Examples: '5 分钟后', '明天上午9点', 'in 2 hours', 'every weekday at 9am'." },
          timezone: { type: "string" }
        }
      },
      action: {
        type: "object",
        description: "What to run when the trigger fires. For a tool: {type:\"action_tool\", target:\"<tool_id>\", params:{...}}. For a template: {type:\"template\", target:\"<template_id>\", params:{...}}. For an AI task: {type:\"task\", target:\"<label>\", params:{userCommand:\"...\"}}.",
        properties: {
          type: { type: "string", enum: ["action_tool", "template", "task"] },
          target: { type: "string" },
          params: { type: "object" }
        }
      },
      execution_mode: { type: "string", description: "unattended_safe | confirm | dry_run" },
      catchup_policy: { type: "string", description: "skip | run_once | run_all" },
      user_todo: { type: "boolean", description: "Set true only when the schedule itself is a user-visible reminder/todo and should receive a pre-run reminder card." },
      lead_time_ms: { type: "number", description: "Optional explicit pre-run reminder lead time in milliseconds. Omit for normal scheduled actions to avoid extra reminders." },
      category: { type: "string", description: "Optional schedule category such as reminder, work, email, health, or general." },
      color: { type: "string", description: "Optional display color for the schedule." }
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
      limit: { type: "number" },      // number of results to return; tool clamps to [1, 30]
      recency: {}                     // optional: day/week/month/year or d/w/m/y
    }
  },
  fetch_url_content: {
    type: "object",
    required: [],
    properties: {
      url: { type: "string" },        // full URL to fetch (https://...)
      max_chars: { type: "number" }   // max characters of extracted text to return (default 6000, max 12000)
    }
  },
  vision_analyze: {
    type: "object",
    required: [],
    properties: {
      image_paths: {},                // array of absolute image paths (preferred); a single string is also accepted
      imagePaths: {},                 // alias the planner sometimes emits
      paths: {},                      // generous alias
      path: {},                       // single-image shorthand
      image_path: {},                 // single-image shorthand
      prompt: { type: "string" },     // what to extract (e.g. "describe", "OCR the text", "compare")
      question: { type: "string" },   // alias
      instruction: { type: "string" } // alias
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
    required: ["kind", "outline"],
    properties: {
      kind: { type: "string" },       // pptx | docx | xlsx | pdf | html
      outline: {},                    // structured outline; shape depends on kind (see tool description)
      filename: { type: "string" },   // optional; defaults to result.<ext>
      path: { type: "string" }        // optional absolute/relative path to overwrite in place
    }
  },
  edit_file: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" },       // absolute path to the existing file to update
      kind: { type: "string" },       // optional override: pptx | docx | xlsx | pdf | md | txt | html | csv | json
      outline: {},                    // full updated structured outline for office/pdf files
      content: { type: "string" },    // full updated text content for text-like files
      text: { type: "string" },       // alias for content
      encoding: { type: "string" }    // utf8 | utf-8 | base64 for text-like files
    }
  },

  account_list_emails: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      query: { type: "string" },
      unreadOnly: { type: "boolean" },
      limit: { type: "number" }
    }
  },
  account_list_connected_accounts: {
    type: "object",
    required: [],
    properties: {
      provider: { type: "string", enum: ["google", "microsoft"] },
      userId: { type: "string" }
    }
  },
  account_list_files: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      query: { type: "string" },
      folderId: { type: "string" },
      limit: { type: "number" }
    }
  },
  account_list_events: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      startTime: { type: "string" },
      endTime: { type: "string" },
      query: { type: "string" },
      limit: { type: "number" }
    }
  },
  connector_catalog_search: {
    type: "object",
    required: [],
    properties: {
      query: { type: "string" },
      provider: { type: "string" },
      service: { type: "string" },
      capability: { type: "string" },
      intent: { type: "string" }
    }
  },
  connector_catalog_get: {
    type: "object",
    required: [],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["tool", "workflow"] }
    }
  },
  connector_workflow_run: {
    type: "object",
    required: [],
    properties: {
      workflowId: { type: "string" },
      id: { type: "string" },
      input: { type: "object" },
      state: { type: "object" }
    }
  },
  connector_plugin_manage: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["list", "enable", "disable", "reload"] },
      pluginId: { type: "string" }
    }
  },
  account_download_file: {
    type: "object",
    required: ["fileId"],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      fileId: { type: "string" },
      destPath: { type: "string" },
      newFileName: { type: "string" },
      overwrite: { type: "boolean" }
    }
  },
  account_send_email: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      to: {},
      cc: {},
      bcc: {},
      subject: { type: "string" },
      body: { type: "string" },
      attachmentPaths: {}
    }
  },
  account_upload_file: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      localPath: { type: "string" },
      folderId: { type: "string" },
      newFileName: { type: "string" }
    }
  },
  account_create_event: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      title: { type: "string" },
      startTime: { type: "string" },
      endTime: { type: "string" },
      attendees: {},
      description: { type: "string" },
      location: { type: "string" },
      timeZone: { type: "string" }
    }
  },

  render_diagram: {
    type: "object",
    required: ["code"],
    properties: {
      code: { type: "string" },       // Mermaid diagram source (graph LR, pie, sequenceDiagram, etc.)
      filename: { type: "string" }    // optional; defaults to diagram.html
    }
  },
  render_svg: {
    type: "object",
    required: ["svg"],
    properties: {
      svg: { type: "string" },        // complete <svg>...</svg> markup
      markup: { type: "string" },     // alias accepted by arg repair/tool
      source: { type: "string" },     // alias accepted by arg repair/tool
      filename: { type: "string" }    // optional; defaults to graphic.svg
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
  read_file_text: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" },
      pattern: { type: "string" },
      max_depth: { type: "number" },
      max_files: { type: "number" },
      max_chars: { type: "number" },
      max_chars_per_file: { type: "number" },
      max_total_chars: { type: "number" }
    }
  },
  read_folder_text: {
    type: "object",
    required: [],
    properties: {
      path: { type: "string" },
      pattern: { type: "string" },
      max_depth: { type: "number" },
      max_files: { type: "number" },
      max_chars_per_file: { type: "number" },
      max_total_chars: { type: "number" }
    }
  },
  search_file_content: {
    type: "object",
    required: [],
    properties: {
      query: { type: "string" },
      limit: { type: "number" }
    }
  },
  index_file_content: {
    type: "object",
    required: [],
    properties: {
      max_records: { type: "number" }
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
  },
  // UCA-182 Phase 21: memory introspection tools. Registered so the
  // planner's adapter sees them under the same schema-count contract
  // the action-tools verifier locks in.
  recall_memory: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      limit: { type: "number" }
    }
  },
  list_recent_tasks: {
    type: "object",
    required: [],
    properties: {
      minutes: { type: "number" },
      limit: { type: "number" },
      include_failed: { type: "boolean" }
    }
  },
  get_task_detail: {
    type: "object",
    required: ["task_id"],
    properties: {
      task_id: { type: "string" }
    }
  },
  list_conversation_artifacts: {
    type: "object",
    required: [],
    properties: {
      conversation_id: { type: "string" },
      limit: { type: "number" }
    }
  },
  // UCA-077: Capability creator (skill / MCP) draft-only action tool. The
  // tool wraps the pure functions in src/service/core/capability-creator
  // and never writes files, mutates runtime config, or stores secrets; it
  // produces a draft + validation result for the planner / UI to act on.
  // The shape stays loose so the planner can pass either an interview
  // answer (state + answer) or a one-shot intake (kind/name/purpose/...).
  draft_capability: {
    type: "object",
    required: [],
    properties: {
      kind: { type: "string" },          // "skill" | "mcp"
      name: { type: "string" },          // human-friendly capability name
      state: {},                          // optional prior interview state from a previous call
      answer: {},                         // optional { field, value } answer to apply against state
      discard: { type: "boolean" },       // discard a prior interview state without writing anything
      purpose: { type: "string" },       // user-facing goal, one or two sentences
      permissions: {},                    // { network, filesystem, secrets[] }
      config: {},                         // skill: { instructions[] }; mcp: { transport, command/args/url }
      confirmation: { type: "boolean" }  // explicit confirmation toggle for one-shot intake
    }
  },
  // UCA-077: Persist a capability draft. High-risk + confirmation-required.
  // Skill drafts are written via createEditableSkill under the runtime
  // skills root; MCP drafts are written as a JSON file under a runtime-local
  // drafts directory. The tool never installs an MCP server, never mutates
  // runtime config, and never persists literal secret values.
  save_capability_draft: {
    type: "object",
    required: [],
    properties: {
      draft: {},   // draft object returned by draft_capability metadata.draft
      state: {}    // alternative: completed interview state; draft is rebuilt internally
    }
  }
});
