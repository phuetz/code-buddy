# Available Tools

> Auto-generated tool reference for CodeBuddy. Do not edit manually.
> Generated: 2026-06-26

## Table of Contents

- [File Reading](#file-reading) (3)
- [File Writing](#file-writing) (6)
- [File Search](#file-search) (6)
- [System Operations](#system-operations) (8)
- [Git Operations](#git-operations) (1)
- [Web Operations](#web-operations) (43)
- [Planning & Tasks](#planning-tasks) (19)
- [Codebase Analysis](#codebase-analysis) (7)
- [Media](#media) (12)
- [Documents](#documents) (3)
- [Utility](#utility) (42)

## File Reading

### read_file

Read file contents with optional line range

**Parameters:**
- `path` (string, required) - Path to file or directory to view
- `file_path` (string) - Alias for path
- `target_file` (string) - Alias for path
- `start_line` (number) - Starting line number for partial file view (optional)
- `end_line` (number) - Ending line number for partial file view (optional)

**Keywords:** read, view, show, display, content, file, hermes

---

### view_file

View file contents or directory listings

**Parameters:**
- `path` (string, required) - Path to file or directory to view
- `file_path` (string) - Alias for path
- `target_file` (string) - Alias for path
- `start_line` (number) - Starting line number for partial file view (optional)
- `end_line` (number) - Ending line number for partial file view (optional)

**Keywords:** view, read, show, display, content, file, open, look, see, check, list, directory, ls, cat

---

### list_directory

List files and directories with type, size, and modification time

**Parameters:**
- `path` (string) - Directory path to list (default: current directory)   Default: `.`

**Keywords:** list, directory, files, ls, folder, contents, dir, entries

---

## File Writing

### str_replace_editor

Replace text in existing files

**Parameters:**
- `path` (string, required) - Path to the file to edit
- `file_path` (string) - Alias for path
- `target_file` (string) - Alias for path
- `old_str` (string, required) - Text to replace (must match exactly, or will use fuzzy matching for multi-line strings)
- `old_text` (string) - Alias for old_str
- `old_content` (string) - Alias for old_str
- `find` (string) - Alias for old_str
- `old_string` (string) - Alias for old_str
- `new_str` (string, required) - Text to replace with
- `new_text` (string) - Alias for new_str
- `new_content` (string) - Alias for new_str
- `replace` (string) - Alias for new_str
- `new_string` (string) - Alias for new_str
- `replace_all` (boolean) - Replace all occurrences (default: false, only replaces first occurrence)

**Keywords:** edit, modify, change, update, replace, fix, refactor, alter, patch

---

### patch

Replace text in an existing file

**Parameters:**
- `path` (string, required) - Path to the file to edit
- `file_path` (string) - Alias for path
- `target_file` (string) - Alias for path
- `old_str` (string, required) - Text to replace (must match exactly, or will use fuzzy matching for multi-line strings)
- `old_text` (string) - Alias for old_str
- `old_content` (string) - Alias for old_str
- `find` (string) - Alias for old_str
- `old_string` (string) - Alias for old_str
- `new_str` (string, required) - Text to replace with
- `new_text` (string) - Alias for new_str
- `new_content` (string) - Alias for new_str
- `replace` (string) - Alias for new_str
- `new_string` (string) - Alias for new_str
- `replace_all` (boolean) - Replace all occurrences (default: false, only replaces first occurrence)

**Keywords:** patch, edit, replace, modify, file, text, hermes

---

### create_file

Create new files with content

**Parameters:**
- `path` (string, required) - Path where the file should be created
- `file_path` (string) - Alias for path
- `target_file` (string) - Alias for path
- `content` (string, required) - Content to write to the file

**Keywords:** create, new, write, generate, make, add, initialize, init, touch

---

### multi_edit

Apply multiple text replacements to a single file atomically

**Parameters:**
- `file_path` (string, required) - Path to the file to edit
- `edits` (array, required) - Array of edit operations to apply in order

**Keywords:** multi, edit, replace, batch, atomic, refactor, multiple, edits, rename

---

### write_file

Create a new file with content

**Parameters:**
- `path` (string, required) - Path where the file should be created
- `file_path` (string) - Alias for path
- `target_file` (string) - Alias for path
- `content` (string, required) - Content to write to the file

**Keywords:** write, create, new, file, content, hermes

---

### codebase_replace

Find and replace text across multiple files in the codebase

**Parameters:**
- `search_pattern` (string, required) - The text or regex pattern to search for
- `replacement` (string, required) - The replacement string. For regex, use $1, $2 for capture groups.
- `glob` (string) - File glob pattern to filter files (e.g., "**/*.ts", "src/**/*.js"). Default: "**/*"
- `is_regex` (boolean) - Treat search_pattern as a regular expression. Default: false
- `dry_run` (boolean) - Preview changes without modifying files. Default: false
- `max_files` (number) - Maximum number of files to modify (safety limit). Default: 50

**Keywords:** replace, find, rename, refactor, codebase, search, substitute, sed, bulk, mass, global

---

## File Search

### search

Search for text content or files

**Parameters:**
- `query` (string, required) - Text to search for or file name/path pattern
- `search_type` (string) - Type of search: 'text' for content search, 'files' for file names, 'both' for both (default: 'both')   Values: `text`, `files`, `both`
- `include_pattern` (string) - Glob pattern for files to include (e.g. '*.ts', '*.js')
- `exclude_pattern` (string) - Glob pattern for files to exclude (e.g. '*.log', 'node_modules')
- `case_sensitive` (boolean) - Whether search should be case sensitive (default: false)
- `whole_word` (boolean) - Whether to match whole words only (default: false)
- `regex` (boolean) - Whether query is a regex pattern (default: false)
- `max_results` (number) - Maximum number of results to return (default: 50)
- `file_types` (array) - File types to search (e.g. ['js', 'ts', 'py'])
- `include_hidden` (boolean) - Whether to include hidden files (default: false)

**Keywords:** search, find, locate, grep, look for, where, which, query, pattern, regex

---

### search_files

Search for text content or files

**Parameters:**
- `query` (string, required) - Text to search for or file name/path pattern
- `search_type` (string) - Type of search: 'text' for content search, 'files' for file names, 'both' for both (default: 'both')   Values: `text`, `files`, `both`
- `include_pattern` (string) - Glob pattern for files to include (e.g. '*.ts', '*.js')
- `exclude_pattern` (string) - Glob pattern for files to exclude (e.g. '*.log', 'node_modules')
- `case_sensitive` (boolean) - Whether search should be case sensitive (default: false)
- `whole_word` (boolean) - Whether to match whole words only (default: false)
- `regex` (boolean) - Whether query is a regex pattern (default: false)
- `max_results` (number) - Maximum number of results to return (default: 50)
- `file_types` (array) - File types to search (e.g. ['js', 'ts', 'py'])
- `include_hidden` (boolean) - Whether to include hidden files (default: false)

**Keywords:** search, files, grep, find, pattern, text, hermes

---

### find_definition

Find definition/declaration location of a symbol

**Parameters:**
- `symbol_name` (string, required) - The symbol name to find the definition for

**Keywords:** definition, go to definition, declaration, symbol

---

### find_references

Find references/usages of a symbol

**Parameters:**
- `symbol_name` (string, required) - The symbol name to find references for
- `context_lines` (number) - Number of context lines before/after each match (default: 2)

**Keywords:** references, usages, where used, callers, semantic

---

### find_symbols

Find symbols (functions, classes, variables) in the codebase

**Parameters:**
- `name` (string, required) - Symbol name or partial name to search for
- `types` (array) - Types of symbols to find (default: all types)
- `exported_only` (boolean) - Only find exported/public symbols (default: false)

**Keywords:** symbols, functions, classes, definitions, code, index, semantic

---

### search_multi

Run multiple searches in one call

**Parameters:**
- `patterns` (array, required) - Array of patterns to search for
- `operator` (string) - OR: find files with any pattern. AND: find files with all patterns (default: OR)   Values: `OR`, `AND`

**Keywords:** multi, search, batch, parallel, patterns, queries

---

## System Operations

### bash

Execute bash commands

**Parameters:**
- `command` (string, required) - The bash command to execute

**Keywords:** bash, terminal, command, run, execute, shell, npm, yarn, pip, install, build, test, compile

---

### terminal

Execute shell commands through the existing bash safety checks

**Parameters:**
- `command` (string, required) - The bash command to execute

**Keywords:** terminal, bash, shell, command, execute, run, hermes

---

### execute_code

Execute a bounded code snippet as a real subprocess and persist run artifacts

**Parameters:**
- `code` (string, required) - The source code to execute
- `language` (string) - Snippet language (default: javascript)   Values: `javascript`, `typescript`, `python`, `shell`
- `args` (array) - Optional command-line arguments passed to the snippet
- `env` (object) - Optional string environment variables. CODEBUDDY_EXECUTE_CODE_RUN_DIR and CODEBUDDY_WORKSPACE_ROOT are always provided.
- `timeout_ms` (number) - Execution timeout in milliseconds (default: 30000, max: 120000)

**Keywords:** execute_code, hermes, code, script, runtime, subprocess, artifact, run

---

### docker

Docker container management operations

**Parameters:**
- `operation` (string, required) - The Docker operation to perform   Values: `list_containers`, `list_images`, `run`, `stop`, `start`, `remove_container`, `remove_image`, `logs`, `exec`, `build`, `pull`, `push`, `inspect`, `compose_up`, `compose_down`, `system_info`, `prune`
- `args` (object) - Operation-specific arguments

**Keywords:** docker, container, image, build, run, stop, logs, exec, compose, pull, push, prune, volume, network, dockerfile

---

### kubernetes

Kubernetes cluster management operations

**Parameters:**
- `operation` (string, required) - The Kubernetes operation to perform   Values: `cluster_info`, `get_context`, `list_contexts`, `use_context`, `get`, `describe`, `apply`, `delete`, `logs`, `exec`, `scale`, `rollout_status`, `rollout_restart`, `port_forward`, `get_events`, `top`, `create_namespace`, `set_namespace`, `create_configmap`, `create_secret`
- `args` (object) - Operation-specific arguments

**Keywords:** kubernetes, k8s, kubectl, pod, deployment, service, namespace, cluster, node, scale, rollout, configmap, secret, ingress, helm

---

### computer_control

Control desktop applications with app profiles, Excel automation, mouse, keyboard, windows, dialogs, form fields, dropdowns, lists, buttons, links, radios, tabs, menus, tree items, sliders, checkboxes, and assertions

**Parameters:**
- `action` (string, required) - The action to perform   Values: `snapshot`, `snapshot_with_screenshot`, `get_element`, `find_elements`, `click_element_by_name`, `click_button`, `click_link`, `fill_text_field`, `clear_and_type`, `select_dropdown_option`, `select_radio`, `activate_tab`, `select_list_item`, `open_menu_item`, `toggle_checkbox`, `set_slider_value`, `select_tree_item`, `expand_tree_item`, `collapse_tree_item`, `assert_text_visible`, `assert_element_visible`, `inspect_dialog`, `click_dialog_button`, `handle_dialog`, `list_app_profiles`, `get_app_profile`, `open_app`, `focus_app`, `read_app_text`, `save_app_document`, `excel_open_workbook`, `excel_set_cell`, `excel_get_cell`, `excel_save_workbook`, `powerpoint_open_presentation`, `powerpoint_add_slide`, `powerpoint_set_text`, `powerpoint_save_presentation`, `word_open_document`, `word_type_text`, `word_save_document`, `use_app_workflow`, `macro`, `click_text`, `save_macro`, `play_macro`, `list_macros`, `delete_macro`, `wait_for_text`, `speak`, `click`, `left_click`, `middle_click`, `double_click`, `right_click`, `move_mouse`, `drag`, `scroll`, `cursor_position`, `wait`, `type`, `key`, `key_down`, `key_up`, `hotkey`, `get_windows`, `get_window`, `list_window_matches`, `wait_for_window`, `focus_window`, `close_window`, `get_active_window`, `minimize_window`, `maximize_window`, `restore_window`, `move_window`, `resize_window`, `set_window`, `act_on_best_window`, `get_audit_log`, `clear_audit_log`, `export_audit_log`, `set_pilot_mode`, `get_pilot_mode`, `get_volume`, `set_volume`, `get_brightness`, `set_brightness`, `notify`, `lock`, `sleep`, `start_recording`, `stop_recording`, `recording_status`, `system_info`, `battery_info`, `network_info`, `check_permission`
- `safetyProfile` (string) - Safety profile for action gating (strict blocks dangerous actions unless confirmed)   Values: `balanced`, `strict`
- `pilotMode` (string) - High-level piloting preset for default safety + matching behavior   Values: `cautious`, `normal`, `fast`
- `confirmDangerous` (boolean) - Required in strict profile for dangerous actions
- `simulateOnly` (boolean) - If true, do a dry-run for mutating actions without applying changes
- `auditLimit` (number) - Number of audit entries to return for get_audit_log (1-500)
- `exportAuditPath` (string) - Optional output path for export_audit_log JSON file
- `policyOverrides` (object) - Per-action safety overrides: { "close_window": "confirm|allow|block", ... }
- `ref` (number) - Element reference number from snapshot (e.g., 1, 2, 3)
- `appName` (string) - Application profile id/name, e.g. excel, notepad, calculator, browser, vscode
- `filePath` (string) - File/folder path for app launch or Office document path (Excel workbook, PowerPoint presentation, Word document)
- `saveAsPath` (string) - Save-as path for an Office document (Excel/PowerPoint/Word)
- `slideIndex` (number) - PowerPoint 1-based slide index for powerpoint_set_text
- `shapeIndex` (number) - PowerPoint 1-based shape index on the slide for powerpoint_set_text
- `layoutIndex` (number) - PowerPoint slide layout index for powerpoint_add_slide (e.g. 1=title, 2=text); defaults to 1
- `sheetName` (string) - Excel worksheet name
- `cell` (string) - Excel cell/range address, e.g. A1
- `value` (string) - Value for app-specific and range actions such as excel_set_cell or set_slider_value
- `x` (number) - X coordinate for mouse actions
- `y` (number) - Y coordinate for mouse actions
- `width` (number) - Window width (for resize_window)
- `height` (number) - Window height (for resize_window)
- `text` (string) - Text to type, click by OCR, or assert visible depending on action
- `key` (string) - Key to press (enter, tab, escape, backspace, delete, up, down, left, right, f1-f12, etc.)
- `clearFirst` (boolean) - Clear existing focused/target text before typing (fill_text_field and clear_and_type)
- `option` (string) - Option label for select_dropdown_option
- `checked` (boolean) - Desired checked state for toggle_checkbox
- `expanded` (boolean) - Desired expanded state for tree-item actions
- `exactName` (boolean) - Prefer exact accessible-name matching for semantic element actions
- `visualContext` (boolean) - For targeted keyboard/text actions, capture snapshot + screenshot OCR evidence after focus is verified
- `dialogIntent` (string) - Desired dialog decision for handle_dialog/click_dialog_button. Risky affirmative choices require confirmDangerous=true.   Values: `accept`, `cancel`, `save`, `dont_save`, `discard`, `retry`, `continue`, `close`, `yes`, `no`, `ok`, `custom`
- `dialogText` (string) - Expected text/title inside the dialog; used to verify the correct dialog before clicking
- `seconds` (number) - Wait duration in seconds (for wait action)
- `modifiers` (array) - Modifier keys (ctrl, alt, shift, meta/command)
- `button` (string) - Mouse button   Values: `left`, `right`, `middle`
- `deltaX` (number) - Horizontal scroll amount (negative = left)
- `deltaY` (number) - Vertical scroll amount (negative = down)
- `windowTitle` (string) - Window title to find/focus
- `windowTitleRegex` (string) - Case-insensitive regex pattern for window title matching
- `windowTitleMatch` (string) - Window title matching mode   Values: `contains`, `equals`
- `processName` (string) - Process name to find/focus (e.g. Discord, chrome, msedge)
- `processNameMatch` (string) - Process name matching mode   Values: `equals`, `contains`
- `windowHandle` (string) - Window handle to focus/close directly
- `windowMatchStrategy` (string) - When multiple windows match, choose first, focused, largest, or newest   Values: `first`, `focused`, `largest`, `newest`
- `requireUniqueWindowMatch` (boolean) - If true, fail when multiple windows match instead of auto-selecting one
- `focus` (boolean) - Whether to focus window (for set_window)
- `windowState` (string) - Target state for set_window   Values: `normal`, `minimized`, `maximized`
- `bestWindowAction` (string) - Action used by act_on_best_window   Values: `focus`, `close`, `minimize`, `maximize`, `restore`, `move`, `resize`, `set`
- `timeoutMs` (number) - Timeout in milliseconds for wait_for_window
- `pollIntervalMs` (number) - Polling interval in milliseconds for wait_for_window
- `level` (number) - Volume or brightness level (0-100)
- `muted` (boolean) - Mute state
- `title` (string) - Notification title
- `body` (string) - Notification body
- `role` (string) - Element role to find (button, link, text-field, checkbox, etc.)
- `name` (string) - Element name to search for
- `interactiveOnly` (boolean) - Only include interactive elements in snapshot
- `useOmniParser` (boolean) - For snapshot_with_screenshot: route the screenshot through a self-hosted OmniParser v2 server (set OMNIPARSER_API_URL) to overlay numbered bounding boxes and append parsed elements with clickable center coordinates. No-op (original snapshot) when the server is unavailable.
- `steps` (array) - Workflow/macro steps for macro or use_app_workflow
- `macroName` (string) - Saved macro name for save_macro/play_macro/delete_macro
- `macroDescription` (string) - Saved macro description for save_macro
- `format` (string) - Recording format   Values: `mp4`, `webm`, `gif`
- `fps` (number) - Recording frame rate
- `audio` (boolean) - Include audio in recording
- `permission` (string) - Permission to check (screen-recording, accessibility, camera, microphone)

**Keywords:** computer, control, desktop, mouse, keyboard, window, dialog, modal, prompt, click, type, automation, form, field, dropdown, listbox, checkbox, radio, tab, menu, tree, treeitem, slider, range, link, button, assert, application, profile, excel, spreadsheet, notepad, calculator

---

### process

Manage system processes (spawn, inspect, logs, terminate)

**Parameters:**
- `action` (string, required) - The process action to perform   Values: `list`, `poll`, `log`, `write`, `kill`, `clear`, `remove`
- `args` (object) - Action-specific arguments

**Keywords:** process, spawn, kill, list, logs, pid, monitor

---

### js_repl

Execute JavaScript snippets in a controlled runtime

**Parameters:**
- `action` (string, required) - Action: execute code (default), reset context, or list variables   Values: `execute`, `reset`, `variables`
- `code` (string) - JavaScript code to execute (required for execute action)

**Keywords:** javascript, repl, eval, node, snippet, runtime

---

## Git Operations

### git

Git version control operations

**Parameters:**
- `operation` (string, required) - The git operation to perform   Values: `status`, `diff`, `add`, `commit`, `push`, `pull`, `branch`, `checkout`, `stash`, `auto_commit`, `blame`, `cherry_pick`, `bisect_start`, `bisect_step`, `bisect_reset`
- `args` (object) - Operation-specific arguments

**Keywords:** git, commit, push, pull, branch, merge, diff, status, checkout, stash, version, control

---

## Web Operations

### internet_scout_run

Execute bounded evidence-first web surfing with search, fetch, Playwright browser observe/extract/assert, and blocker-aware stops

**Parameters:**
- `goal` (string, required) - What to learn, verify, or collect from public/user-authorized web sources.
- `query` (string) - Optional search query. Defaults to goal.
- `sourceUrl` (string) - Known starting URL. If omitted, the run starts with web_search.
- `intent` (string) - Navigation intent. Prospecting/profile intents add safe relationship_context handling.   Values: `research`, `prospecting`, `profile_enrichment`, `page_verification`, `lead_discovery`
- `requiresInteraction` (boolean) - Whether the page likely needs observation before extraction. The runner does not invent clicks.
- `expectedText` (string) - Text that must be proven with browser.assert_text for success.
- `persistWhenProven` (boolean) - Ask browser extract/assert to return persistence suggestions after proof.
- `executePersistence` (boolean) - Actually execute remember/lessons_add suggestions. Default false.
- `maxPages` (number) - Maximum public source candidates. Defaults to 5.
- `useBrowser` (boolean) - Use Playwright/browser for navigate, observe, extract, and assert. Default true.
- `headless` (boolean) - Run browser headless. Default true.
- `browserPageLimit` (number) - Maximum candidate pages to open in the browser. Defaults to 1.
- `scrollCount` (number) - Optional number of down-scrolls before browser.extract. Defaults to 0.
- `waitUntil` (string) - Navigation completion condition. Defaults to domcontentloaded.   Values: `load`, `domcontentloaded`, `networkidle`
- `allowLoginPages` (boolean) - Allow user-authorized login pages to open, without credential/captcha bypass.

**Keywords:** internet scout, run, surf, browse, playwright, browser, navigation, osint, prospecting, lead, profile enrichment, search, fetch, observe, extract, assert, stagehand, evidence, rate limit, captcha, proof

---

### browser_click

Click a browser element by numeric ref from browser_snapshot

**Parameters:**
- `ref` (number, required) - Element reference number from browser_snapshot.
- `button` (string) - Mouse button. Defaults to left.   Values: `left`, `right`, `middle`
- `clickCount` (number) - Number of clicks. Defaults to 1.

**Keywords:** browser, click, ref, element, playwright, hermes

---

### browser_navigate

Navigate the active browser page to a URL using the shared Playwright session

**Parameters:**
- `url` (string, required) - URL to navigate to. Supports data:, file:, http:, and https: with existing safety checks.
- `waitUntil` (string) - When to consider navigation complete. Defaults to domcontentloaded.   Values: `load`, `domcontentloaded`, `networkidle`
- `timeout` (number) - Navigation timeout in milliseconds.

**Keywords:** browser, navigate, goto, url, playwright, hermes

---

### browser_snapshot

Take an accessibility-oriented snapshot of the active browser page and return element refs

**Parameters:**
- `interactiveOnly` (boolean) - Only include interactive elements. Defaults to true.
- `maxElements` (number) - Maximum number of elements to include.
- `includeHidden` (boolean) - Include hidden elements when supported by the browser engine.

**Keywords:** browser, snapshot, accessibility, refs, observe, playwright, hermes

---

### browser_type

Type text into a browser element by numeric ref from browser_snapshot

**Parameters:**
- `ref` (number, required) - Element reference number from browser_snapshot.
- `text` (string, required) - Text to type.
- `clear` (boolean) - Clear the field before typing.

**Keywords:** browser, type, input, text, ref, playwright, hermes

---

### browser_vision

Capture and analyze the active browser page with local vision evidence

**Parameters:**
- `url` (string) - Optional URL to navigate before capture. Supports file:, data:, http:, and https: through the browser tool.
- `full_page` (boolean) - Capture the full page instead of the viewport. Default false.
- `include_snapshot` (boolean) - Include an accessibility snapshot alongside image evidence. Default true.
- `include_ocr` (boolean) - Attempt local OCR on the screenshot. Default false.
- `ocr_language` (string) - OCR language code when include_ocr is true. Default eng.
- `headless` (boolean) - Run the Playwright browser headless. Default true.
- `wait_until` (string) - Navigation completion condition when url is provided. Default domcontentloaded.   Values: `load`, `domcontentloaded`, `networkidle`
- `timeout_ms` (number) - Navigation timeout in milliseconds.
- `max_elements` (number) - Maximum elements to include in the optional snapshot.
- `interactive_only` (boolean) - Limit the optional snapshot to interactive elements only. Default false.

**Keywords:** browser, vision, screenshot, analyze, playwright, hermes

---

### discord

Read Discord channel messages, search members, and create threads via the Discord REST API

**Parameters:**
- `action` (string, required) - Discord action to run   Values: `fetch_messages`, `search_members`, `create_thread`
- `guild_id` (string) - Discord server (guild) ID; required for search_members
- `channel_id` (string) - Discord channel ID; required for fetch_messages and create_thread
- `query` (string) - Member name prefix to search for (search_members)
- `name` (string) - New thread name (create_thread)
- `message_id` (string) - Optional message ID to anchor create_thread to an existing message
- `limit` (integer) - Max results for fetch_messages or search_members; default 50
- `before` (string) - Snowflake ID for reverse pagination (fetch_messages)
- `after` (string) - Snowflake ID for forward pagination (fetch_messages)
- `auto_archive_duration` (integer) - Thread archive duration in minutes (create_thread); default 1440

**Keywords:** discord, server, guild, channel, messages, members, thread, hermes

---

### discord_admin

Inspect and manage Discord server metadata, pins, messages, and member roles through the Discord REST API

**Parameters:**
- `action` (string, required) - Discord admin action to run   Values: `list_guilds`, `server_info`, `list_channels`, `channel_info`, `list_roles`, `member_info`, `list_pins`, `pin_message`, `unpin_message`, `delete_message`, `add_role`, `remove_role`
- `guild_id` (string) - Discord server (guild) ID
- `channel_id` (string) - Discord channel ID
- `user_id` (string) - Discord user ID
- `role_id` (string) - Discord role ID
- `message_id` (string) - Discord message ID
- `approved_by` (string) - Required for mutating admin actions; records who approved the external Discord change

**Keywords:** discord, admin, server, guild, channels, roles, pins, moderation, hermes

---

### feishu_doc_read

Read Feishu/Lark document raw content through the Open API

**Parameters:**
- `doc_token` (string, required) - Document token from the Feishu/Lark document URL or comment context.

**Keywords:** feishu, lark, document, docx, read, raw content, hermes

---

### feishu_drive_add_comment

Add a whole-document Feishu/Lark drive comment through the Open API

**Parameters:**
- `file_token` (string, required) - Drive file token for the document or file.
- `content` (string, required) - Plain-text comment content.
- `file_type` (string) - Drive file type, default docx.   Default: `docx`

**Keywords:** feishu, lark, drive, comment, add, document, hermes

---

### feishu_drive_list_comment_replies

List Feishu/Lark drive comment replies through the Open API

**Parameters:**
- `file_token` (string, required) - Drive file token for the document or file.
- `comment_id` (string, required) - Comment thread ID.
- `file_type` (string) - Drive file type, default docx.   Default: `docx`
- `page_size` (number) - Number of replies to return, max 100.   Default: `100`
- `page_token` (string) - Pagination token for the next page.

**Keywords:** feishu, lark, drive, comments, replies, thread, hermes

---

### feishu_drive_list_comments

List Feishu/Lark drive file comments through the Open API

**Parameters:**
- `file_token` (string, required) - Drive file token for the document or file.
- `file_type` (string) - Drive file type, default docx.   Default: `docx`
- `is_whole` (boolean) - If true, list whole-document comments only.   Default: `false`
- `page_size` (number) - Number of comments to return, max 100.   Default: `100`
- `page_token` (string) - Pagination token for the next page.

**Keywords:** feishu, lark, drive, comments, list, document, hermes

---

### feishu_drive_reply_comment

Reply to a Feishu/Lark drive comment through the Open API

**Parameters:**
- `file_token` (string, required) - Drive file token for the document or file.
- `comment_id` (string, required) - Comment thread ID to reply to.
- `content` (string, required) - Plain-text reply content.
- `file_type` (string) - Drive file type, default docx.   Default: `docx`

**Keywords:** feishu, lark, drive, comment, reply, document, hermes

---

### ha_call_service

Call a Home Assistant service with blocked dangerous domains

**Parameters:**
- `domain` (string, required) - Service domain, such as 'light', 'switch', 'climate', or 'scene'.
- `service` (string, required) - Service name, such as 'turn_on', 'turn_off', 'set_temperature', or 'toggle'.
- `entity_id` (string) - Optional target entity ID; takes precedence over data.entity_id.
- `data` (object) - Optional service data object. A JSON string is also accepted at runtime.

**Keywords:** homeassistant, home assistant, hass, service, control, device, smart home, hermes

---

### ha_get_state

Get detailed state for one Home Assistant entity

**Parameters:**
- `entity_id` (string, required) - Entity ID to query, such as 'light.living_room' or 'sensor.temperature'.

**Keywords:** homeassistant, home assistant, hass, state, entity, smart home, hermes

---

### ha_list_entities

List Home Assistant entities through the REST API

**Parameters:**
- `domain` (string) - Entity domain to filter by, such as 'light', 'switch', 'climate', or 'sensor'.
- `area` (string) - Area or room name to filter by, such as 'living room' or 'kitchen'.

**Keywords:** homeassistant, home assistant, hass, entity, entities, smart home, hermes

---

### ha_list_services

List Home Assistant services and compact field metadata

**Parameters:**
- `domain` (string) - Optional service domain filter, such as 'light', 'climate', or 'switch'.

**Keywords:** homeassistant, home assistant, hass, services, actions, smart home, hermes

---

### internet_scout_plan

Plan safe evidence-first web surfing with search, fetch, browser observe/extract/assert, blockers, and optional persistence

**Parameters:**
- `goal` (string, required) - What to learn, verify, or collect from public/user-authorized web sources.
- `query` (string) - Optional search query. Defaults to goal.
- `sourceUrl` (string) - Known starting URL. If omitted, the plan starts with web_search.
- `intent` (string) - Navigation intent. Prospecting/profile intents add safe relationship_context handling.   Values: `research`, `prospecting`, `profile_enrichment`, `page_verification`, `lead_discovery`
- `requiresInteraction` (boolean) - Whether clicks, forms, tabs, or scrolling are likely needed before extraction.
- `expectedText` (string) - Text expected on the page; adds browser.assert_text to the plan.
- `persistWhenProven` (boolean) - Add remember/lessons_add only after durable evidence is proven.
- `maxPages` (number) - Maximum public pages to inspect. Defaults to 5.
- `allowLoginPages` (boolean) - Allow user-authorized login pages to be opened, without credential/captcha bypass.

**Keywords:** internet scout, surf, browse, navigation, osint, prospecting, lead, profile enrichment, search, fetch, observe, extract, assert, stagehand, evidence, rate limit, captcha, proof

---

### send_message

Prepare or deliver outbound channel messages with dry-run outbox logging by default

**Parameters:**
- `channel` (string, required) - Target channel type   Values: `telegram`, `discord`, `slack`, `whatsapp`, `signal`, `matrix`, `google-chat`, `teams`, `webchat`, `dingtalk`, `wecom`, `weixin`, `qq`, `line`, `nostr`, `zalo`, `mattermost`, `nextcloud-talk`, `twilio-voice`, `imessage`, `irc`, `feishu`, `synology-chat`, `ntfy`, `twitch`, `tlon`, `gmail`, `cli`, `web`, `api`
- `channel_id` (string, required) - Target channel, chat, room, conversation, or recipient id
- `content` (string, required) - Message body to send or preview
- `content_type` (string) - Message content type, default text   Values: `text`, `image`, `audio`, `video`, `file`, `location`, `contact`, `sticker`, `voice`, `command`
- `dry_run` (boolean) - Preview only and write to the local outbox; defaults to true
- `approved_by` (string) - Required when dry_run is false; records who approved external delivery
- `parse_mode` (string) - Optional formatting mode   Values: `markdown`, `html`, `plain`
- `thread_id` (string) - Optional thread/topic id
- `reply_to` (string) - Optional message id to reply to
- `disable_preview` (boolean) - Disable link previews where supported
- `silent` (boolean) - Send without notification where supported
- `peer_id` (string) - Optional peer id for send-policy evaluation
- `chat_type` (string) - Optional chat type for send-policy evaluation   Values: `dm`, `group`, `thread`

**Keywords:** send, message, channel, gateway, telegram, discord, slack, email, hermes

---

### spotify_albums

Fetch Spotify album metadata or album tracks

**Parameters:**
- `action` (string, required)   Values: `get`, `tracks`
- `album_id` (string)
- `id` (string)
- `market` (string)
- `limit` (integer)
- `offset` (integer)

**Keywords:** spotify, album, albums, tracks, music, hermes

---

### spotify_devices

List Spotify Connect devices or transfer playback

**Parameters:**
- `action` (string, required)   Values: `list`, `transfer`
- `device_id` (string)
- `play` (boolean)

**Keywords:** spotify, device, devices, connect, transfer playback, speaker, hermes

---

### spotify_library

List, save, or remove Spotify library tracks and albums

**Parameters:**
- `kind` (string, required) - Which library to operate on.   Values: `tracks`, `albums`
- `action` (string, required)   Values: `list`, `save`, `remove`
- `limit` (integer)
- `offset` (integer)
- `market` (string)
- `uris` (array)
- `ids` (array)
- `items` (array)

**Keywords:** spotify, library, saved tracks, saved albums, save music, remove saved, hermes

---

### spotify_playback

Control Spotify playback and inspect current or recently played tracks

**Parameters:**
- `action` (string, required)   Values: `get_state`, `get_currently_playing`, `play`, `pause`, `next`, `previous`, `seek`, `set_repeat`, `set_shuffle`, `set_volume`, `recently_played`
- `device_id` (string)
- `market` (string)
- `context_uri` (string)
- `uris` (array)
- `offset` (object)
- `position_ms` (integer)
- `state` (string) - For set_repeat use track/context/off. For set_shuffle use boolean-like true/false.
- `volume_percent` (integer)
- `limit` (integer) - For recently_played: number of tracks, max 50.
- `after` (integer) - For recently_played: Unix ms cursor after this timestamp.
- `before` (integer) - For recently_played: Unix ms cursor before this timestamp.

**Keywords:** spotify, music, playback, player, pause, skip, volume, recently played, hermes

---

### spotify_playlists

List, inspect, create, update, and modify Spotify playlists

**Parameters:**
- `action` (string, required)   Values: `list`, `get`, `create`, `add_items`, `remove_items`, `update_details`
- `playlist_id` (string)
- `market` (string)
- `limit` (integer)
- `offset` (integer)
- `name` (string)
- `description` (string)
- `public` (boolean)
- `collaborative` (boolean)
- `uris` (array)
- `position` (integer)
- `snapshot_id` (string)

**Keywords:** spotify, playlist, playlists, create playlist, add items, remove items, hermes

---

### spotify_queue

Inspect the Spotify queue or add an item to it

**Parameters:**
- `action` (string, required)   Values: `get`, `add`
- `uri` (string)
- `device_id` (string)

**Keywords:** spotify, queue, music, add to queue, play next, hermes

---

### spotify_search

Search the Spotify catalog

**Parameters:**
- `query` (string, required)
- `types` (array)
- `type` (string)
- `limit` (integer)
- `offset` (integer)
- `market` (string)
- `include_external` (string)

**Keywords:** spotify, search, music, track, album, artist, playlist, hermes

---

### web_search

Search the web for information including weather, news, documentation, and general queries

**Parameters:**
- `query` (string, required) - The search query to execute
- `max_results` (number) - Maximum number of results to return (default: 5)

**Keywords:** search, google, web, internet, online, latest, news, documentation, docs, how to, weather, météo, meteo, forecast, temperature, info, find, lookup

---

### x_search

Search X posts and threads through xAI's built-in x_search Responses API tool

**Parameters:**
- `query` (string, required) - What to look up on X.
- `allowed_x_handles` (array) - Optional list of X handles to include exclusively, max 10.
- `excluded_x_handles` (array) - Optional list of X handles to exclude, max 10.
- `from_date` (string) - Optional start date in YYYY-MM-DD format.
- `to_date` (string) - Optional end date in YYYY-MM-DD format.
- `enable_image_understanding` (boolean) - Whether xAI should analyze images attached to matching X posts.   Default: `false`
- `enable_video_understanding` (boolean) - Whether xAI should analyze videos attached to matching X posts.   Default: `false`

**Keywords:** x, twitter, xai, grok, posts, threads, citations, current discussion, hermes

---

### yb_query_group_info

Query Yuanbao group name, owner, and member count through a configured gateway adapter

**Parameters:**
- `group_code` (string, required) - Unique Yuanbao group identifier.

**Keywords:** yuanbao, yb, group, pai, owner, member count, hermes

---

### yb_query_group_members

Query Yuanbao group members for mention lookup, bot listing, or full member listing

**Parameters:**
- `group_code` (string, required) - Unique Yuanbao group identifier.
- `action` (string, required) - find searches by nickname, list_bots lists bots/Yuanbao AI, list_all lists everyone.   Values: `find`, `list_bots`, `list_all`
- `name` (string) - Partial display name to search when action is find.
- `mention` (boolean) - If true, include exact mention-format guidance in the response.

**Keywords:** yuanbao, yb, group, members, mention, bots, pai, hermes

---

### yb_search_sticker

Search Yuanbao stickers through a configured gateway adapter or local fallback catalog

**Parameters:**
- `query` (string) - Search keyword. Empty string returns the first candidates.
- `limit` (integer) - Maximum candidate count, default 10 and max 50.

**Keywords:** yuanbao, yb, sticker, search, tim face, emoji, hermes

---

### yb_send_dm

Send an approval-gated Yuanbao private message through a configured gateway adapter

**Parameters:**
- `group_code` (string) - Group where the target user belongs; required when user_id is not provided.
- `name` (string) - Target display name, partial match; required when user_id is not provided.
- `message` (string) - Text to send. Can be empty if media_files contains at least one file.
- `user_id` (string) - Target Yuanbao account ID; skips member lookup when provided.
- `media_files` (array) - Optional local media files to send after the text.
- `approved_by` (string) - Required for external Yuanbao delivery; records who approved the send.

**Keywords:** yuanbao, yb, dm, direct message, private message, media, hermes

---

### yb_send_sticker

Send an approval-gated Yuanbao sticker through a configured gateway adapter

**Parameters:**
- `sticker` (string) - Sticker name or numeric sticker_id. Empty lets the adapter choose a random sticker.
- `chat_id` (string) - Target chat_id; defaults to CODEBUDDY_YUANBAO_HOME_CHAT_ID or HERMES_SESSION_CHAT_ID.
- `reply_to` (string) - Optional message id to quote-reply to.
- `approved_by` (string) - Required for external Yuanbao delivery; records who approved the send.

**Keywords:** yuanbao, yb, sticker, send, chat, tim face, hermes

---

### browser_back

Navigate the active browser page back in history

**Keywords:** browser, back, history, navigation, playwright, hermes

---

### browser_console

List or clear browser console messages and page runtime errors captured from the active browser session

**Parameters:**
- `action` (string) - Console operation. Defaults to list.   Values: `list`, `clear`
- `type` (string) - Optional console type filter: log, warn, error, info, debug, pageerror.
- `limit` (number) - Maximum number of most recent entries to return.

**Keywords:** browser, console, logs, javascript, pageerror, debug, playwright, hermes

---

### browser_dialog

List, accept, or dismiss native browser dialogs blocking the active browser page

**Parameters:**
- `action` (string) - Dialog operation. Defaults to list.   Values: `list`, `accept`, `dismiss`
- `dialogId` (string) - Specific dialog id from browser_dialog list or browser snapshot. Defaults to the active tab dialog.
- `promptText` (string) - Text to enter when accepting a prompt dialog.

**Keywords:** browser, dialog, alert, confirm, prompt, beforeunload, modal, playwright, hermes

---

### browser_get_images

List image elements on the active browser page with resolved URLs, alt text, dimensions, and visibility

**Parameters:**
- `limit` (number) - Maximum number of images to return. Defaults to 50; capped at 200.
- `visibleOnly` (boolean) - Only return images with visible layout boxes.

**Keywords:** browser, image, images, img, media, alt, playwright, hermes

---

### browser_press

Press a keyboard key in the active browser page

**Parameters:**
- `key` (string, required) - Keyboard key to press, such as Enter, Tab, Escape, ArrowDown.
- `modifiers` (array) - Optional modifier keys: Control, Alt, Shift, Meta.

**Keywords:** browser, press, keyboard, key, playwright, hermes

---

### browser_scroll

Scroll the active browser page or scroll to an element ref

**Parameters:**
- `direction` (string) - Scroll direction. Defaults to down.   Values: `up`, `down`, `left`, `right`
- `amount` (number) - Scroll amount in pixels. Defaults to 300.
- `toElement` (number) - Optional element ref to scroll into view.

**Keywords:** browser, scroll, page, viewport, ref, playwright, hermes

---

### web_extract

Fetch and extract web page content

**Parameters:**
- `url` (string, required) - The URL of the web page to fetch

**Keywords:** extract, fetch, url, website, page, http, https, read, hermes

---

### web_fetch

Fetch web page content

**Parameters:**
- `url` (string, required) - The URL of the web page to fetch

**Keywords:** fetch, url, website, page, download, http, https, link, read

---

### browser

Automate web browser for navigation, interaction, extraction, observation, and testing

**Parameters:**
- `action` (string, required) - The browser action to perform   Values: `launch`, `connect`, `close`, `tabs`, `new_tab`, `focus_tab`, `close_tab`, `snapshot`, `observe`, `get_element`, `find_elements`, `navigate`, `go_back`, `go_forward`, `reload`, `click`, `double_click`, `right_click`, `type`, `fill`, `select`, `press`, `hover`, `scroll`, `screenshot`, `pdf`, `get_cookies`, `set_cookie`, `clear_cookies`, `set_headers`, `set_offline`, `emulate_device`, `set_geolocation`, `evaluate`, `get_content`, `extract`, `assert_text`, `get_url`, `get_title`, `drag`, `upload_files`, `wait_for_navigation`, `get_local_storage`, `set_local_storage`, `get_session_storage`, `set_session_storage`, `add_route_rule`, `remove_route_rule`, `clear_route_rules`, `set_timezone`, `set_locale`, `download`
- `cdpUrl` (string) - CDP WebSocket URL for connecting to existing browser
- `headless` (boolean) - Run browser in headless mode (default: true)
- `tabId` (string) - Tab ID for focus_tab/close_tab
- `url` (string) - URL to navigate to
- `waitUntil` (string) - When to consider navigation complete   Values: `load`, `domcontentloaded`, `networkidle`
- `interactiveOnly` (boolean) - Only include interactive elements in snapshot
- `maxElements` (number) - Maximum elements to include in snapshot
- `ref` (number) - Element reference number from snapshot
- `role` (string) - Element role to search for (button, link, textbox, etc.)
- `name` (string) - Element name/text to search for
- `query` (string) - Natural-language extraction focus or assertion query
- `expectedText` (string) - Text expected to appear on the page for assert_text
- `proofGoal` (string) - Optional proof-loop goal used when persistWhenProven returns memory/lesson suggestions
- `persistWhenProven` (boolean) - For extract/assert_text, return remember and lessons_add payload suggestions only after durable evidence is proven
- `text` (string) - Text to type
- `key` (string) - Key to press (Enter, Tab, Escape, etc.)
- `modifiers` (array) - Modifier keys (Control, Alt, Shift, Meta)
- `button` (string) - Mouse button   Values: `left`, `right`, `middle`
- `clear` (boolean) - Clear field before typing
- `fields` (object) - Fields to fill: { "refNumber": "value", ... }
- `submit` (boolean) - Press Enter after filling fields
- `value` (string) - Value to select in dropdown
- `label` (string) - Label to select in dropdown
- `index` (number) - Index to select in dropdown
- `direction` (string) - Scroll direction   Values: `up`, `down`, `left`, `right`
- `amount` (number) - Scroll amount in pixels
- `toElement` (number) - Element ref to scroll to
- `fullPage` (boolean) - Capture full page vs viewport only
- `element` (number) - Element ref to capture
- `format` (string) - Image format   Values: `png`, `jpeg`, `webp`
- `quality` (number) - Image quality (0-100)
- `cookieName` (string) - Cookie name
- `cookieValue` (string) - Cookie value
- `cookieDomain` (string) - Cookie domain
- `headers` (object) - HTTP headers to set
- `offline` (boolean) - Enable offline mode
- `device` (string) - Device name to emulate (iPhone 14, iPad Pro, Pixel 5, etc.)
- `viewport` (object) - Custom viewport size
- `latitude` (number) - Latitude for geolocation
- `longitude` (number) - Longitude for geolocation
- `expression` (string) - JavaScript code to evaluate in page
- `timeout` (number) - Timeout in milliseconds
- `sourceRef` (number) - Source element ref for drag operation
- `targetRef` (number) - Target element ref for drag operation
- `files` (array) - File paths to upload
- `storageData` (object) - Key-value pairs for localStorage/sessionStorage
- `ruleId` (string) - Route rule ID
- `rulePattern` (string) - URL pattern to match for route rule
- `ruleAction` (string) - Action for route rule   Values: `block`, `mock`, `redirect`
- `ruleResponse` (object) - Mock response for route rule (status, body, contentType)
- `ruleRedirectUrl` (string) - Redirect URL for route rule
- `timezone` (string) - Timezone ID (e.g., America/New_York)
- `locale` (string) - Locale string (e.g., en-US)

**Keywords:** browser, automate, click, fill, form, screenshot, scrape, navigate, headless, puppeteer, playwright, selenium, test, ui, automation, web, observe, extract, assert, assertion, stagehand, page.act, page.extract, page.observe

---

### browser_operator

Propose a consent-gated Browser Operator session (action log, consent scopes, stop control, proof export) for live web goals beyond web_search/web_fetch — without launching a browser

**Parameters:**
- `goal` (string, required) - What the browser session should accomplish, e.g. "log into the dashboard and export the monthly report".
- `query` (string) - Optional search query seed. Defaults to the goal.
- `sourceUrl` (string) - Optional known starting URL for the session.
- `intent` (string) - Plan intent. Defaults to research.   Values: `research`, `prospecting`, `profile_enrichment`, `page_verification`, `lead_discovery`
- `mode` (string) - Browser surface. "isolated" (default) uses a fresh public surface; "local" reuses the operator's logged-in browser and therefore requires consent.   Values: `isolated`, `local`
- `requiresInteraction` (boolean) - Set true when the goal needs clicking/typing (mutating interaction). Adds an interact stage and consent scope.
- `allowLoginPages` (boolean) - Set true when the session may pass authenticated/login pages. Requires consent.
- `expectedText` (string) - Optional text whose presence proves the goal was reached (verification evidence).
- `maxPages` (number) - Maximum pages the session may visit. Defaults to 5.

**Keywords:** browser operator, browser, web automation, live web, navigate, login, interaction, consent, stagehand, computer use, session, stop control, proof export, operator, propose

---

## Planning & Tasks

### lead_scout_enrichment_plan

Plan multi-hop public B2B enrichment with principles, evidence chain, generated script contract, and sandbox execution policy

**Parameters:**
- `goal` (string, required) - Enrichment objective, e.g. find architect phones by following official website links.
- `target` (string) - Lead category. Defaults to custom.   Values: `architectes`, `syndics`, `agences_immobilieres`, `maitres_oeuvre`, `promoteurs`, `bureaux_etudes`, `custom`
- `sourceUrlField` (string) - Field containing the seed profile/directory URL. Defaults to source_url.
- `websiteField` (string) - Field containing or receiving the official website URL. Defaults to site_web.
- `nameField` (string) - Field containing the business/person name. Defaults to nom.
- `missingFields` (array) - Fields to enrich. Defaults to email, telephone, and site_web.
- `maxHops` (number) - Maximum evidence hops from source profile to official site/contact pages. Defaults to 3.
- `pageBudget` (number) - Maximum public pages per lead for the generated script. Defaults to 8; validation accepts 1 to 30.
- `delayMs` (number) - Delay between requests in the generated script. Defaults to 1500ms.
- `allowedDomains` (array) - Optional domain allowlist. Empty means public web except ignored domains.
- `ignoredDomains` (array) - Additional domains to treat as generic portals or off-limits.
- `allowGeneratedScript` (boolean) - Include the generated Python script in the output. Defaults true.

**Keywords:** lead scout, enrichment, multi-hop, script generation, sandbox, manus, architectes, website, contact page, phone, telephone, email, evidence chain, public data

---

### lead_scout_run

Run local-first B2B lead discovery over JSON/CSV datasets with dedupe, scoring, drafts, and optional review export

**Parameters:**
- `goal` (string, required) - Prospecting objective, e.g. rank architects near a city for a renovation offer.
- `localDatasetPaths` (array, required) - JSON or CSV datasets to load. This runner is local-first and does not browse by itself.
- `target` (string) - Lead category. Use custom with customTarget for another B2B target.   Values: `architectes`, `syndics`, `agences_immobilieres`, `maitres_oeuvre`, `promoteurs`, `bureaux_etudes`, `custom`
- `customTarget` (string) - Custom B2B lead category label when target is custom.
- `zone` (string) - Geographic scope such as city, postal code, department, region, or radius text.
- `offer` (string) - Offer or service to qualify leads against.
- `maxProspects` (number) - Maximum lead budget for review. Defaults to 50; tool validation accepts 1 to 500.
- `minScore` (number) - Minimum score to keep in the review queue. Defaults to 0; tool validation accepts 0 to 100.
- `includeOutreachDrafts` (boolean) - Include draft-only outreach text. It never sends email. Defaults true.
- `outputFormat` (string) - Format to write when path is provided. Defaults from path extension.   Values: `csv`, `json`, `markdown`
- `path` (string) - Optional output file path (.json, .csv, or .md). Omit to return results without writing.
- `requireHumanApprovalBeforeContact` (boolean) - Whether a human must approve source evidence and outreach before contact. Defaults true.

**Keywords:** lead scout, run, prospecting, prospect, leads, b2b, architectes, syndics, agences immobilieres, dataset, json, csv, dedupe, scoring, review queue, email draft, human review

---

### lead_scout_lesson_candidates

Generate reviewed lesson candidates from Lead Scout runs and sandbox script observations without persisting automatically

**Parameters:**
- `goal` (string, required) - Lead Scout task or run goal that produced observations.
- `context` (string) - Optional lesson context label, e.g. "Lead Scout architect enrichment".
- `stats` (object) - Run stats such as processed, enriched, skipped, blocked, selectedLeads, needsPublicEnrichment, and contact coverage.
- `warnings` (array) - Warnings from a Lead Scout run.
- `blockers` (array) - Safety or access blockers observed, such as captcha, login, 403, 429.
- `successfulPatterns` (array) - Patterns that worked and may be reusable.
- `failedPatterns` (array) - Patterns that failed and should not be retried blindly.
- `contactPathsThatWorked` (array) - Same-domain contact paths that yielded public contact data.
- `domainsToIgnore` (array) - Generic or non-official domains to ignore in future enrichment.
- `scriptChanges` (array) - Potential generated-script improvements observed during the run.

**Keywords:** lead scout, lessons, learning, self improvement, script feedback, sandbox logs, patterns, enrichment, lessons_add

---

### lead_scout_plan

Plan safe B2B lead discovery with public sources, schema, scoring, script recipe, evidence, and human-review gates

**Parameters:**
- `goal` (string, required) - Prospecting objective, e.g. find architects near a city for a renovation offer.
- `target` (string) - Lead category. Use custom with customTarget for another B2B target.   Values: `architectes`, `syndics`, `agences_immobilieres`, `maitres_oeuvre`, `promoteurs`, `bureaux_etudes`, `custom`
- `customTarget` (string) - Custom B2B lead category label when target is custom.
- `zone` (string) - Geographic scope such as city, postal code, department, region, or radius text.
- `offer` (string) - Offer or service to qualify leads against.
- `maxProspects` (number) - Maximum lead budget for review. Defaults to 50; tool validation accepts 1 to 500.
- `sources` (array) - Optional source strategy. Defaults depend on target.
- `exportFormats` (array) - Desired review output formats. Defaults to csv and json.
- `localDatasetPaths` (array) - Existing CSV/JSON lead datasets to import before web discovery.
- `requireHumanApprovalBeforeContact` (boolean) - Whether a human must approve source evidence and outreach before contact. Defaults true.

**Keywords:** lead scout, prospecting, prospect, leads, b2b, architectes, syndics, agences immobilieres, maitres oeuvre, promoteurs, bureaux etudes, sirene, rnc, osint, public data, script recipe, scoring, human review

---

### cronjob

Create, list, pause, resume, run, and remove persisted scheduled jobs through CronScheduler

**Parameters:**
- `action` (string, required) - Cron job action to perform.   Values: `list`, `show`, `create`, `pause`, `resume`, `run`, `remove`
- `id` (string) - Job id or unique id prefix for show, pause, resume, run, or remove.
- `name` (string) - Job name when creating a job.
- `every` (number) - Create an interval job that runs every N milliseconds.
- `cron` (string) - Create a cron-expression job using a 5-field cron expression.
- `at` (string) - Create a one-shot job for an ISO 8601 timestamp.
- `message` (string) - Agent message task for create. Provide exactly one of message, watchdog, command, or skill.
- `watchdog` (object) - No-LLM watchdog task config for create, for example disk/http/repo/build checks.
- `command` (object) - No-agent script task for create: { executable, args?, cwd?, allowedExecutables?, timeoutMs? }. Runs an allowlisted command without an LLM.
- `skill` (string) - No-agent skill task for create: name of a registered skill to run without an LLM.
- `skillRequest` (string) - Optional request string passed to the skill executor when using skill.
- `then` (string) - Chain target: job id (or unique id prefix) to run on successful completion of this job.
- `preCheck` (object) - Optional file_changed or command pre-check gate for create.
- `deliver` (array) - Optional delivery targets such as telegram:123 or discord:channel.
- `format` (string) - Optional delivery body format for created jobs.   Values: `full`, `summary`

**Keywords:** cron, cronjob, schedule, scheduled, job, jobs, reminder, monitor, heartbeat, watchdog, hermes

---

### kanban_block

Mark a persistent Kanban card as blocked with a reason

**Parameters:**
- `id` (string, required) - Kanban card id
- `reason` (string, required) - Blocking reason
- `author` (string) - Human or agent reporting the block

**Keywords:** kanban, hermes, block, blocked, stuck, reason, task

---

### kanban_comment

Append a comment to a persistent Kanban card

**Parameters:**
- `id` (string, required) - Kanban card id
- `text` (string, required) - Comment body
- `author` (string) - Human or agent adding the comment

**Keywords:** kanban, hermes, comment, note, task, board, coordination

---

### kanban_complete

Mark a persistent Kanban card as done

**Parameters:**
- `id` (string, required) - Kanban card id
- `comment` (string) - Optional completion note
- `author` (string) - Human or agent adding the note

**Keywords:** kanban, hermes, complete, done, finish, task, board

---

### kanban_create

Create a persistent Hermes-compatible Kanban card

**Parameters:**
- `id` (string) - Optional stable card id. A unique kb-* id is generated when omitted.
- `title` (string, required) - Short card title
- `description` (string) - Detailed task description or acceptance criteria
- `status` (string) - Initial status, default todo   Values: `todo`, `in_progress`, `blocked`, `done`
- `priority` (string) - Priority, default medium   Values: `low`, `medium`, `high`, `urgent`
- `assignee` (string) - Human or agent responsible for the card
- `tags` (array) - Labels used to group cards

**Keywords:** kanban, hermes, create, card, task, board, coordination

---

### kanban_heartbeat

Record a progress heartbeat on a persistent Kanban card

**Parameters:**
- `id` (string, required) - Kanban card id
- `message` (string) - Optional progress note
- `author` (string) - Human or agent reporting progress

**Keywords:** kanban, hermes, heartbeat, progress, status, task, agent

---

### kanban_link

Attach an artifact, URL, commit, issue, or related reference to a Kanban card

**Parameters:**
- `id` (string, required) - Kanban card id
- `target` (string, required) - URL, file path, commit id, issue id, or related card id
- `label` (string) - Optional human-readable label for the link

**Keywords:** kanban, hermes, link, artifact, url, commit, issue, task

---

### kanban_list

List persistent Hermes-compatible Kanban cards

**Parameters:**
- `status` (string) - Optional status filter   Values: `todo`, `in_progress`, `blocked`, `done`
- `priority` (string) - Optional priority filter   Values: `low`, `medium`, `high`, `urgent`
- `assignee` (string) - Optional assignee filter
- `tag` (string) - Optional tag filter
- `include_done` (boolean) - Whether completed cards should be included; defaults to true

**Keywords:** kanban, hermes, list, cards, tasks, board, coordination

---

### kanban_show

Show a persistent Hermes-compatible Kanban card by id

**Parameters:**
- `id` (string, required) - Kanban card id

**Keywords:** kanban, hermes, show, card, task, board, coordination

---

### kanban_unblock

Clear a Kanban block and move the card back to in_progress

**Parameters:**
- `id` (string, required) - Kanban card id
- `comment` (string) - Optional unblock note
- `author` (string) - Human or agent clearing the block

**Keywords:** kanban, hermes, unblock, resume, progress, task, board

---

### todo_update

Manage persistent task list for tracking progress

**Parameters:**
- `action` (string, required) - Action to perform   Values: `add`, `complete`, `update`, `remove`, `clear_done`, `list`
- `text` (string) - Item text (required for add; optional for update)
- `id` (string) - Item ID (required for complete/update/remove)
- `status` (string) - New status (for update)   Values: `pending`, `in_progress`, `done`, `blocked`
- `priority` (string) - Priority (for add/update, default: medium)   Values: `high`, `medium`, `low`

**Keywords:** todo, task, plan, track, progress, attention, focus

---

### get_todo_list

View current todo list and task status

**Parameters:**
- `filter` (string) - Filter todos by status (default: all)   Values: `all`, `pending`, `in_progress`, `completed`

**Keywords:** todo, task, list, view, show, what, do, faire, tâches, taches, pending, status

---

### plan

Manage a persistent execution plan (PLAN.md) with step tracking

**Parameters:**
- `action` (string, required) - Action: init (create new plan), read (show current plan), update (change step status), append (add new steps)   Values: `init`, `read`, `update`, `append`
- `goal` (string) - High-level goal for the plan (required for init)
- `step` (string) - Step description (for append) or step identifier (for update)
- `status` (string) - New status for the step (for update)   Values: `pending`, `in_progress`, `completed`, `failed`

**Keywords:** plan, goal, steps, track, progress, todo, organize, breakdown, checklist, PLAN.md

---

### create_todo_list

Create todo list for task planning

**Parameters:**
- `todos` (array, required) - Array of todo items

**Keywords:** todo, plan, task, list, organize, steps, breakdown, project

---

### update_todo_list

Update todo list progress

**Parameters:**
- `updates` (array, required) - Array of todo updates

**Keywords:** todo, update, complete, done, progress, status, mark

---

## Codebase Analysis

### code_graph

Query code dependency graph: callers, callees, impact analysis, Mermaid flowcharts, class hierarchies

**Parameters:**
- `operation` (string, required) - who_calls: find all callers. what_calls: find all callees. impact: transitive impact analysis. flowchart: Mermaid call chain. class_tree: inheritance hierarchy. file_map: file functions with signatures. find_path: dependency path A→B. module_deps: import diagram. communities: architectural clusters. semantic_search: embedding similarity. dead_code: uncalled functions/unimported modules. coupling: inter-module coupling heatmap. refactor: refactoring suggestions. drift: architecture changes vs snapshot. snapshot: save baseline for drift. visualize: interactive D3.js HTML. impact_preview: PR impact from git diff. stats: graph statistics + PageRank.   Values: `who_calls`, `what_calls`, `impact`, `flowchart`, `class_tree`, `file_map`, `find_path`, `module_deps`, `communities`, `semantic_search`, `dead_code`, `coupling`, `refactor`, `drift`, `snapshot`, `visualize`, `impact_preview`, `stats`
- `query` (string) - Function, class, or module name (fuzzy matched)
- `target` (string) - Target entity for find_path operation
- `depth` (number) - Depth for flowchart/impact/module_deps (default 2, max 6)

**Keywords:** code graph, call graph, who calls, what calls, callers, callees, impact analysis, what breaks, affected, flowchart, mermaid, diagram, organigramme, class hierarchy, inheritance, extends, implements, file functions, methods, signatures, dependency path, module dependencies, communities, clusters, subsystems, semantic search, embedding, similarity, pagerank, dead code, unused, uncalled, orphan, coupling, heatmap, refactoring, god function, hub module, drift, snapshot, evolution, visualize, interactive, d3, impact preview, pr impact, diff impact

---

### lsp_rename

Rename a symbol across the codebase using LSP

**Parameters:**
- `file_path` (string, required) - Path to the file containing the symbol to rename
- `line` (number, required) - Line number of the symbol (1-based)
- `character` (number, required) - Column number of the symbol (1-based)
- `new_name` (string, required) - New name for the symbol

**Keywords:** rename, refactor, symbol, lsp, language server, cross-file, identifier

---

### codebase_map

Analyze codebase structure and query code graph

**Parameters:**
- `operation` (string, required) - The operation: build (create map), summary (show overview), search (find files), symbols (list exports), graph_query (pattern match on code graph triples), graph_neighbors (ego-graph k-hop around entity), graph_path (shortest dependency path between two entities), graph_stats (code graph statistics), graph_file_functions (list all functions/methods in a file with their call graph)   Values: `build`, `summary`, `search`, `symbols`, `graph_query`, `graph_neighbors`, `graph_path`, `graph_stats`, `graph_file_functions`
- `query` (string) - Search query for finding relevant context, or entity name for graph operations (e.g. 'agent-executor', 'CodeBuddyAgent')
- `target` (string) - Target entity for graph_path operation
- `depth` (number) - Depth for graph_neighbors (default 2, max 4)
- `predicate` (string) - Filter by predicate for graph_query (e.g. 'imports', 'usedBy', 'definedIn', 'contains', 'patternOf')
- `node_type` (string) - Filter by node type for graph_query (e.g. 'module', 'agent', 'tool', 'middleware')
- `deep` (boolean) - Perform deep analysis including symbols and dependencies (slower)

**Keywords:** codebase, structure, architecture, map, overview, symbols, dependencies, analyze, graph, imports, who imports, neighbors, path, layers, components, modules, relationships, calls, call graph, extends, inherits, methods, flowchart, organigramme

---

### lsp_code_action

Get available code actions (quick fixes, refactorings) from LSP

**Parameters:**
- `file_path` (string, required) - Path to the file
- `start_line` (number, required) - Start line of the range (1-based)
- `start_character` (number, required) - Start column of the range (1-based)
- `end_line` (number) - End line of the range (1-based, defaults to start_line)
- `end_character` (number) - End column of the range (1-based, defaults to start_character)

**Keywords:** code action, quickfix, refactor, lsp, language server, suggestion

---

### reason

Solve complex problems using Tree-of-Thought reasoning with MCTS

**Parameters:**
- `problem` (string, required) - The problem statement or question to reason about
- `context` (string) - Additional context, constraints, or background information
- `mode` (string) - Reasoning depth: shallow (~5 iterations), medium (~20), deep (~50), exhaustive (~100). Default: medium   Values: `shallow`, `medium`, `deep`, `exhaustive`
- `constraints` (array) - Constraints that the solution must satisfy

**Keywords:** reason, think, plan, analyze, architecture, design, debug, complex, trade-off, compare, evaluate, strategy, decision, mcts, tree-of-thought

---

### spawn_parallel_agents

Execute multiple subtasks concurrently with specialized sub-agents

**Parameters:**
- `tasks` (array, required) - List of tasks to execute in parallel

**Keywords:** parallel, agents, concurrent, subtasks, batch, delegate

---

### spawn_subagent

Spawn specialized subagent

**Parameters:**
- `type` (string, required) - Type of subagent to spawn   Values: `code-reviewer`, `debugger`, `test-runner`, `explorer`, `refactorer`, `documenter`
- `task` (string, required) - The task for the subagent to perform
- `context` (string) - Additional context for the task

**Keywords:** subagent, agent, review, debug, test, explore, document, refactor

---

## Media

### image_generate

Generate an image through the configured image backend and cache returned media when possible

**Parameters:**
- `prompt` (string, required) - Text prompt describing the desired image
- `aspect_ratio` (string) - Output aspect ratio: landscape (wide), square (1:1), or portrait (tall). Defaults to landscape.   Values: `landscape`, `square`, `portrait`   Default: `landscape`

**Keywords:** image, generate, picture, photo, openai, xai, hermes

---

### video_analyze

Analyze a local or remote video with a configured video-capable model

**Parameters:**
- `video_url` (string, required) - HTTP/HTTPS URL, file:// URL, or local file path to analyze
- `question` (string, required) - Specific question to answer about the video after describing the scene

**Keywords:** video, analyze, vision, movie, mp4, gemini, openai, hermes

---

### video_generate

Generate a video through the configured video backend and cache returned media when possible

**Parameters:**
- `prompt` (string, required) - Text instruction describing the desired video, motion, style, and camera movement
- `image_url` (string) - Optional public image URL. When provided, the backend routes to image-to-video.
- `reference_image_urls` (array) - Optional reference image URLs for supported backends
- `duration` (number) - Desired duration in seconds. Providers clamp to supported ranges.
- `aspect_ratio` (string) - Output aspect ratio. Defaults to 16:9.   Values: `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3`
- `resolution` (string) - Output resolution. Defaults to 720p.   Values: `360p`, `480p`, `540p`, `720p`, `1080p`, `4k`
- `negative_prompt` (string) - Optional negative prompt for providers that support it
- `audio` (boolean) - Optional native audio generation toggle for supported providers
- `seed` (number) - Optional seed for reproducible generations
- `model` (string) - Optional configured model/family override for the active backend

**Keywords:** video, generate, text-to-video, image-to-video, xai, fal, hermes

---

### vision_analyze

Analyze a local image with metadata, colors, labels, and optional OCR evidence

**Parameters:**
- `image_path` (string, required) - Absolute or workspace-relative path to the image file
- `include_ocr` (boolean) - Attempt local OCR and include text or OCR errors in the report (default: false)
- `ocr_language` (string) - OCR language code when include_ocr is true (default: eng)

**Keywords:** vision, image, analyze, metadata, ocr, hermes

---

### camera_analyze

Capture a local webcam frame and describe it with a local multimodal vision model

**Parameters:**
- `prompt` (string) - What to ask the vision model about the frame. Default "Describe what you see."
- `device` (string) - Optional ffmpeg camera device. Linux example: /dev/video0; Windows: video=Integrated Camera; macOS: 0.
- `model` (string) - Local multimodal model id served by Ollama. Default gemma4:12b.
- `include_ocr` (boolean) - Also attach local OCR text evidence from the captured frame (default: false).
- `ocr_language` (string) - OCR language code when include_ocr is true (default: eng).
- `output_path` (string) - Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace.
- `timeout_ms` (number) - Capture timeout in milliseconds (default: 10000).

**Keywords:** camera, webcam, see, vision, describe, look, photo, companion, eyes, analyze, what do you see

---

### text_to_speech

Convert text to a local speech audio file

**Parameters:**
- `text` (string, required) - Text to convert to speech audio
- `output_path` (string) - Optional absolute or workspace-relative output path. Defaults to .codebuddy/tts/tts-<id>.<format>
- `provider` (string) - TTS provider. auto detects a local provider; system uses Windows SAPI   Values: `auto`, `system`, `edge-tts`, `espeak`, `say`, `audioreader`
- `voice` (string) - Optional provider-specific voice name
- `language` (string) - Optional language code for providers such as espeak
- `format` (string) - Output audio format. Defaults by provider   Values: `wav`, `mp3`, `aiff`
- `rate` (number) - Optional provider-specific speech rate
- `volume` (number) - Optional provider-specific volume
- `timeout_ms` (number) - Provider timeout in milliseconds

**Keywords:** tts, speech, audio, voice, synthesize, hermes

---

### camera_snapshot

Capture one local webcam frame and record a vision percept

**Parameters:**
- `output_path` (string) - Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace.
- `device` (string) - Optional ffmpeg camera device. Windows example: video=Integrated Camera; macOS example: 0; Linux example: /dev/video0.
- `timeout_ms` (number) - Capture timeout in milliseconds (default: 10000).

**Keywords:** camera, webcam, snapshot, photo, vision, see, look, companion, eyes

---

### audio

Process audio files

**Parameters:**
- `operation` (string, required) - Operation: info (get audio metadata), transcribe (convert speech to text), list (list audio files), to_base64   Values: `info`, `transcribe`, `list`, `to_base64`
- `path` (string, required) - Path to audio file or directory
- `language` (string) - Language code for transcription (e.g., 'en', 'fr', 'es')
- `prompt` (string) - Optional prompt to guide transcription

**Keywords:** audio, sound, music, transcribe, speech, voice, mp3, wav

---

### ocr

Extract text from images

**Parameters:**
- `operation` (string, required) - OCR operation to perform   Values: `extract`, `extract_region`, `list_languages`, `batch`
- `path` (string) - Path to image file
- `paths` (array) - Array of image paths for batch OCR
- `language` (string) - OCR language code (e.g., 'eng', 'fra', 'deu')
- `region` (object) - Region to OCR (for extract_region)

**Keywords:** ocr, text, extract, image, recognize, read

---

### screenshot

Capture screenshots

**Parameters:**
- `fullscreen` (boolean) - Capture entire screen (default: true)
- `window` (string) - Window title or ID to capture
- `region` (object) - Screen region to capture
- `delay` (number) - Delay in seconds before capture
- `format` (string) - Image format (default: png)   Values: `png`, `jpg`
- `quality` (number) - JPEG quality 1-100 (only for jpg format)
- `outputPath` (string) - Custom output file path
- `forLLM` (boolean) - Normalize screenshot for LLM consumption (resize + compress)

**Keywords:** screenshot, capture, screen, image, snap, window

---

### video

Process video files

**Parameters:**
- `operation` (string, required) - Operation to perform on the video   Values: `info`, `extract_frames`, `thumbnail`, `extract_audio`, `list`
- `path` (string, required) - Path to video file or directory
- `interval` (number) - Seconds between frames for frame extraction
- `count` (number) - Number of frames to extract
- `timestamps` (array) - Specific timestamps (in seconds) to extract frames from
- `output_dir` (string) - Output directory for extracted content

**Keywords:** video, movie, frames, thumbnail, mp4, extract

---

### clipboard

Clipboard operations

**Parameters:**
- `operation` (string, required) - Clipboard operation to perform   Values: `read_text`, `write_text`, `read_image`, `write_image`, `read_html`, `copy_file_path`, `copy_file_content`, `get_type`, `clear`
- `text` (string) - Text to write to clipboard (for write_text)
- `path` (string) - File path (for image operations or copy_file_*)

**Keywords:** clipboard, copy, paste, cut

---

## Documents

### archive

Work with archives

**Parameters:**
- `operation` (string, required) - Archive operation to perform   Values: `list`, `extract`, `create`, `list_archives`
- `path` (string) - Path to archive file or directory
- `sources` (array) - Source paths for creating archive
- `output_dir` (string) - Output directory for extraction
- `output_path` (string) - Output path for created archive
- `format` (string) - Format for creating archive (default: zip)   Values: `zip`, `tar`, `tar.gz`, `tar.bz2`, `tar.xz`
- `files` (array) - Specific files to extract
- `password` (string) - Password for encrypted archives
- `overwrite` (boolean) - Overwrite existing files during extraction

**Keywords:** zip, tar, archive, compress, extract, unzip, rar, 7z

---

### document

Read Office documents and extract DOCX embedded images

**Parameters:**
- `operation` (string, required) - Operation: read (extract content), list (list documents in directory), extract_images (save embedded DOCX images to a directory and return Markdown image references)   Values: `read`, `list`, `extract_images`
- `path` (string, required) - Path to document or directory
- `output_dir` (string) - Directory where embedded DOCX images should be extracted when operation is extract_images; results include output paths and Markdown references for generate_document

**Keywords:** docx, xlsx, pptx, word, excel, powerpoint, office, spreadsheet, embedded images, screenshots

---

### pdf

Read PDF documents

**Parameters:**
- `operation` (string, required) - Operation: extract (get text content), info (get metadata), list (list PDFs in directory), to_base64 (convert to base64)   Values: `extract`, `info`, `list`, `to_base64`
- `path` (string, required) - Path to PDF file or directory
- `pages` (array) - Specific page numbers to extract (optional)
- `max_pages` (number) - Maximum number of pages to extract (optional)

**Keywords:** pdf, document, extract, read, pages

---

## Utility

### mixture_of_agents

Route a difficult problem through multiple frontier model references and an aggregator

**Parameters:**
- `user_prompt` (string, required) - The complex query or problem to solve using multiple model perspectives and a final aggregator.

**Keywords:** mixture of agents, moa, openrouter, frontier, aggregation, reasoning, hermes

---

### peer_chain

Route and execute an ordered Fleet collaboration chain with handoff context between specialist peers

**Parameters:**
- `prompt` (string, required) - The task that will be routed and executed through the ordered peer chain.
- `chainRoles` (array, required) - Ordered Fleet dispatch profiles to execute. Example: ["code","review","safe"].
- `privacyTag` (string) - Use sensitive to veto cloud-egress peers during routing; use public to allow cloud providers.   Values: `sensitive`, `public`
- `maxCostUsd` (number) - Optional per-task route cost cap in USD.
- `maxLatencyMs` (number) - Optional max expected peer/model latency in milliseconds.
- `estimatedTokens` (number) - Optional estimated input token count for context-window filtering.
- `describeTimeoutMs` (number) - Per-peer peer.describe timeout in milliseconds. Default 5000.
- `stageTimeoutMs` (number) - Per-stage peer.chat timeout in milliseconds. Default 60000.

**Keywords:** peer, chain, fleet, delegate, multi-agent, collaborate, orchestrate, hermes, handoff, roles, review, safe, code

---

### ask_user_question

Ask the user 1-4 structured multi-option questions mid-task

**Parameters:**
- `questions` (array, required) - 1–4 questions to ask the user. Each is independent.

**Keywords:** ask, question, user, clarify, choose, option, decide, multi-choice, prompt, interactive, pick

---

### exit_plan_mode

Request user approval to leave plan mode and start executing

**Parameters:**
- `allowedPrompts` (array) - Optional list of the next tool calls you intend to run after approval (informational only — surfaced to the user so they know what they are signing off on). Max 16 items.
- `planSummary` (string) - Optional inline plan text shown to the user when no plan markdown file has been registered. Keep ≤8000 chars.

**Keywords:** plan, exit, approve, approval, leave, execute, proceed, unlock, sign-off

---

### peer_delegate

Delegate a one-shot question to a connected fleet peer Code Buddy and get its answer plus Hermes-style dispatch policy metadata back inline

**Parameters:**
- `peer` (string, required) - The peer ID (from /fleet listen --name). Use list_peers to discover available peer IDs.
- `prompt` (string, required) - The question or task to ask the peer. Be specific and self-contained — the peer has no shared context.
- `systemPrompt` (string) - Optional system prompt override for the peer. Defaults to the peer's brief-answer mode.
- `model` (string) - Optional model hint for the peer (e.g. "grok-3", "claude-opus-4-5"). Peer may ignore.
- `dispatchProfile` (string) - Optional Fleet dispatch profile. When set, carries the operating posture through peer.chat and returns peer-side policy metadata when supported. Selection guide: balanced: general delegation, mixed tasks, or unclear posture; research: source-aware investigation, context gathering, and low-mutation analysis; code: implementation, refactoring, tests, and development edits; review: read-first code review, audit, regression, and missing-test analysis; safe: high-risk, secret-bearing, destructive, or read-only-by-default work.   Values: `balanced`, `research`, `code`, `review`, `safe`
- `timeoutMs` (number) - Request timeout in milliseconds. Default 60000.

**Keywords:** peer, delegate, fleet, consult, ask, collaborate, remote, claude, orchestrate, sub-agent, multi-ai, distributed, hermes, dispatch, dispatchProfile, profile, toolset, toolsets, policy

---

### restore_context

Restore compressed context content by identifier

**Parameters:**
- `identifier` (string, required) - File path (e.g. "src/agent/types.ts") or URL to restore

**Keywords:** restore, context, memory, compressed, retrieve, earlier

---

### route_peer

Choose the best connected fleet peer/model or ordered role chain for a prompt using peer.describe capabilities, Fleet TaskRouter, and optional Hermes-style dispatch profile

**Parameters:**
- `prompt` (string, required) - The task or question that will later be delegated. Used for classification and routing.
- `privacyTag` (string) - Use sensitive to veto cloud-egress peers; use public to allow cloud providers.   Values: `sensitive`, `public`
- `maxCostUsd` (number) - Optional per-task cost cap in USD.
- `maxLatencyMs` (number) - Optional max expected peer/model latency in milliseconds.
- `parallelism` (number) - Optional number of parallel lanes to recommend.
- `chainRoles` (array) - Optional ordered Hermes chain roles. Example: ["code","review","safe"] returns sequential peer_delegate calls. Mutually exclusive with parallelism.
- `estimatedTokens` (number) - Optional estimated input token count for context-window filtering.
- `dispatchProfile` (string) - Hermes-style operating posture for routing and later peer_delegate guidance. Selection guide: balanced: general delegation, mixed tasks, or unclear posture; research: source-aware investigation, context gathering, and low-mutation analysis; code: implementation, refactoring, tests, and development edits; review: read-first code review, audit, regression, and missing-test analysis; safe: high-risk, secret-bearing, destructive, or read-only-by-default work.   Values: `balanced`, `research`, `code`, `review`, `safe`
- `timeoutMs` (number) - Per-peer peer.describe timeout in milliseconds. Default 5000.

**Keywords:** peer, route, fleet, model, provider, capability, delegate, multi-ai, orchestrate, select, hermes, dispatch, chain, roles, dispatchProfile, profile, toolset, toolsets, policy, safe, review, research, code

---

### sessions_spawn

Spawn an isolated sandboxed sub-agent session for a delegated task (depth-3 + 10/workflow caps)

**Parameters:**
- `task` (string, required) - Task description for the sub-agent
- `label` (string) - Label for the session (used in session key)
- `agentId` (string) - Agent ID to use (defaults to current agent)
- `model` (string) - Model override for the sub-agent
- `runTimeoutSeconds` (number) - Maximum runtime in seconds (default: 300)
- `allowedTools` (array) - Tools the sub-agent can use (defaults to safe subset)
- `context` (object) - Initial context/data to pass to the sub-agent

**Keywords:** sessions, spawn, create, subagent, delegate, parallel, subtask, multi-agent

---

### task_verify

Run verification contract (tsc, test, lint)

**Parameters:**
- `steps` (array) - Which verification steps to run (default: all)
- `fix` (boolean) - Auto-fix lint issues (default: false)

**Keywords:** verify, test, typecheck, lint, check, validate, ci

---

### advisor

Consult a stronger reviewer model for a second opinion (full conversation forwarded)

**Keywords:** advisor, review, second opinion, consult, check, validate, expert, critique, feedback

---

### ask_human

Ask the user a clarifying question

**Parameters:**
- `question` (string, required) - The question to ask the user
- `options` (array) - Optional predefined choices for the user (legacy, prefer choices)
- `choices` (array) - Structured choices with labels, values, and optional descriptions. Max 6 choices.
- `multiSelect` (boolean) - If true, user can select multiple choices. Default: false
- `default` (string) - Default answer if user provides no input

**Keywords:** ask, human, clarify, question, input, pause, confirm

---

### code_explorer_ask

Consult CodeExplorer for a query or code understanding request (read-only)

**Parameters:**
- `query` (string, required) - The query or task description to ask CodeExplorer about.

**Keywords:** code-explorer, ask, query, understand, explain, search, related files, dependents, tests

---

### relationship_context

Build a safe relationship/world-memory context card with permissions and evidence

**Parameters:**
- `subject` (string, required) - Name or label of the entity being discussed.
- `subjectType` (string) - Relationship class. Defaults to unknown_person when omitted.   Values: `public_person`, `known_person`, `unknown_person`, `organization`, `place`, `concept`
- `mode` (string) - Use-case posture for the context card.   Values: `general`, `robot_conversation`, `prospecting`
- `confidence` (number) - Recognition confidence from 0 to 1.
- `publicFacts` (array) - Public or encyclopedic facts safe to use when permitted.
- `relationshipFacts` (array) - Private relationship memory, used only for confirmed known people.
- `sensitiveFacts` (array) - Sensitive facts withheld unless explicitly permitted.
- `visibleSignals` (array) - Visible, non-identifying context such as badge text or current setting.
- `evidence` (array) - Evidence attached to public facts or recognition.
- `permissions` (object) - Explicit permissions controlling what context may be used.

**Keywords:** relationship, identity, person, people, public figure, world memory, people memory, robot, recognition, permission, evidence, context

---

### session_search

Search saved local sessions by title or message content with real session-store snippets

**Parameters:**
- `query` (string, required) - Full-text query to search in saved session titles and messages
- `limit` (number) - Maximum sessions to return (default: 10, max: 50)

**Keywords:** session, sessions, search, history, saved, recall, fts, conversation, hermes

---

### sessions_send

Send a message to another session (fire-and-forget, or wait for response)

**Parameters:**
- `sessionKey` (string, required) - Target session key
- `message` (string, required) - Message to send
- `timeoutSeconds` (number) - Wait timeout (0=fire-and-forget, default: 0)

**Keywords:** sessions, send, message, communicate, notify, multi-agent, broadcast

---

### skill_manage

Hermes-style facade for installed skills, lifecycle actions, and review-gated SKILL.md candidates

**Parameters:**
- `action` (string, required) - Skill management action to run.   Values: `list`, `view`, `history`, `create`, `edit`, `discover`, `enable`, `disable`, `deprecate`, `delete`, `patch`, `write_file`, `remove_file`, `rollback`, `preview_update`, `reset`, `update`, `candidate_list`, `candidate_view`, `candidate_install`
- `name` (string) - Skill name. Required for view, history, and create.
- `description` (string) - One-sentence skill description. Required for create.
- `body` (string) - Full SKILL.md body. Required for create.
- `content` (string) - Official Hermes alias: full SKILL.md content for create or edit.
- `tags` (array) - Tags for create or discover.
- `requires` (array) - Required tools or capabilities for create.
- `env` (object) - Environment variables required by the created skill.
- `overwrite` (boolean) - Overwrite an existing workspace skill on create. Default: false.
- `force` (boolean) - Force update even when the target version is not newer. Default: false.
- `version` (string) - Optional target version for preview_update or update. If omitted, update uses hub or local cache metadata.
- `include_disabled` (boolean) - Include disabled installed skills on list. Default: false.
- `include_usage` (boolean) - Include local usage telemetry on list. Default: true.
- `include_content` (boolean) - Include SKILL.md file content on view/candidate_view. Default: true.
- `query` (string) - Search query. Required for discover.
- `auto_install` (boolean) - Automatically install the top discovered skill. Default: false.
- `limit` (number) - Maximum discovered skills to return. Default: 5.
- `candidate_path` (string) - Candidate SKILL.md path or candidate directory. Required for candidate_view and candidate_install.
- `skill_root` (string) - Candidate root to scan for candidate_list. Default: .codebuddy/skill-candidates.
- `eligible_only` (boolean) - Only show install-eligible candidates on candidate_list. Default: false.
- `approved_by` (string) - Human reviewer identity. Required for candidate_install and review-gated lifecycle mutations: enable, disable, deprecate, delete, patch, rollback, reset, update. Not required for preview_update.
- `approved_at` (string) - Optional approval timestamp for candidate_install.
- `reason` (string) - Optional human-readable reason for enable, disable, deprecate, delete, patch, rollback, reset, or update.
- `old_text` (string) - Literal text to replace inside an installed SKILL.md or supporting file. Required for patch unless old_string is provided.
- `new_text` (string) - Replacement text for patch. Can be an empty string for deletion. Required unless new_string is provided.
- `old_string` (string) - Official Hermes alias for old_text.
- `new_string` (string) - Official Hermes alias for new_text.
- `replace_all` (boolean) - Official Hermes patch flag: replace all occurrences instead of requiring a unique match. Default: false.
- `expected_replacements` (number) - Optional safety check for patch: fail unless exactly this many replacements would be made.
- `file_path` (string) - Official Hermes supporting file path for patch/write_file/remove_file. Must be SKILL.md or under references/, templates/, scripts/, or assets/.
- `file_content` (string) - Official Hermes supporting file content. Required for write_file.
- `absorbed_into` (string) - Official Hermes delete intent hint. Accepted for compatibility; Code Buddy records explicit reason/approval instead.
- `snapshot_id` (string) - Optional rollback snapshot id. If omitted, rollback restores the latest snapshot.
- `workspace_skill_root` (string) - Workspace skill root for candidate_install. Default: .codebuddy/skills.

**Keywords:** skill, skills, manage, list, view, history, create, discover, candidate, review, install, enable, disable, deprecate, delete, patch, rollback, update, lifecycle, hub, hermes

---

### skill_view

Read one installed SKILL.md package and its integrity metadata from the local SkillsHub

**Parameters:**
- `name` (string, required) - Installed skill name.
- `include_content` (boolean) - Include SKILL.md file content. Default: true.

**Keywords:** skill, skills, view, read, content, inspect, show, hub, hermes

---

### diagram

Generate diagrams

**Parameters:**
- `operation` (string, required) - Type of diagram to generate   Values: `mermaid`, `flowchart`, `sequence`, `class`, `pie`, `gantt`, `ascii_box`, `ascii_tree`, `list`
- `code` (string) - Mermaid code for mermaid operation
- `title` (string) - Title for the diagram
- `nodes` (array) - Nodes for flowchart or ASCII tree
- `connections` (array) - Connections between nodes
- `participants` (array) - Participants for sequence diagram
- `messages` (array) - Messages for sequence diagram
- `classes` (array) - Classes for class diagram
- `relationships` (array) - Relationships for class diagram
- `data` (array) - Data points for pie chart
- `sections` (array) - Sections for Gantt chart
- `format` (string) - Output format (default: ascii)   Values: `svg`, `png`, `ascii`, `utf8`

**Keywords:** diagram, flowchart, chart, mermaid, sequence, class, uml, graph, visualize

---

### knowledge_search

Search the agent knowledge base

**Parameters:**
- `query` (string, required) - Keywords or phrase to search for in knowledge bases
- `limit` (number) - Maximum results to return (default: 5)
- `scope` (string) - Filter by agent mode scope (e.g. "code", "review")

**Keywords:** knowledge, search, convention, docs, domain, procedure

---

### lessons_add

Capture a lesson learned

**Parameters:**
- `category` (string, required) - Lesson category   Values: `PATTERN`, `RULE`, `CONTEXT`, `INSIGHT`
- `content` (string, required) - The lesson content
- `context` (string) - Additional context or file path where this applies
- `source` (string) - How the lesson was discovered (default: manual)   Values: `user_correction`, `self_observed`, `manual`

**Keywords:** lesson, learn, correction, pattern, rule, mistake

---

### lessons_graph

Build a concept graph over lessons.md to find related lessons and nearby notions

**Parameters:**
- `query` (string) - Optional text filter before graphing lessons
- `concept` (string) - Only graph lessons linked to this concept slug, label, wiki link, or Markdown target
- `category` (string) - Filter by lesson category   Values: `PATTERN`, `RULE`, `CONTEXT`, `INSIGHT`
- `limit` (number) - Maximum lessons to graph (default: 50, max: 200)
- `includeKeywords` (boolean) - Whether to include fallback keyword concepts. Set false for a cleaner explicit-link/tag graph.
- `format` (string) - Return concise Markdown summary, full graph JSON, Obsidian-friendly Markdown index, or Mermaid diagram text   Values: `summary`, `json`, `markdown`, `mermaid`

**Keywords:** lesson, graph, obsidian, wiki, related, concepts, links, notions

---

### lessons_propose

Propose a lesson candidate for human review (no silent write)

**Parameters:**
- `category` (string, required) - Lesson category   Values: `PATTERN`, `RULE`, `CONTEXT`, `INSIGHT`
- `content` (string, required) - The proposed lesson content
- `context` (string) - Additional context or file path where this applies
- `note` (string) - Optional provenance note, e.g. why this pattern is worth keeping

**Keywords:** lesson, propose, candidate, review, learn, self improvement, pattern

---

### lessons_search

Search lessons learned

**Parameters:**
- `query` (string, required) - Search terms to match against lessons
- `category` (string) - Filter by lesson category   Values: `PATTERN`, `RULE`, `CONTEXT`, `INSIGHT`
- `limit` (number) - Maximum results (default: 10)

**Keywords:** lesson, search, pattern, rule, past, history, mistake

---

### list_peers

List connected fleet peers with status, last-seen, peer chat availability, and optional provider/model capabilities

**Parameters:**
- `includeCapabilities` (boolean) - When true, call peer.describe on each peer and include provider/model capability summaries. Requires peer:invoke.
- `timeoutMs` (number) - Per-peer peer.describe timeout in milliseconds when includeCapabilities is true. Default 5000.

**Keywords:** peers, fleet, connected, remote, claudes, list, discover, status, provider, model, capabilities, route, routing, hermes, dispatch

---

### recall

Retrieve persistent memory by key

**Parameters:**
- `key` (string, required) - Memory key to retrieve
- `scope` (string) - Optional scope filter   Values: `project`, `user`

**Keywords:** memory, recall, retrieve, lookup, context

---

### remember

Store persistent memory entries

**Parameters:**
- `key` (string, required) - Short unique key for this memory
- `value` (string, required) - The information to be remembered
- `scope` (string) - Scope for this memory (default: project)   Values: `project`, `user`
- `category` (string) - Type of information being stored   Values: `project`, `preferences`, `decisions`, `patterns`, `custom`

**Keywords:** memory, remember, persist, context, store, preference

---

### run_script

Execute scripts in a secure sandboxed Docker environment

**Parameters:**
- `script` (string, required) - The script source code to execute
- `language` (string) - Script language (default: python)   Values: `python`, `typescript`, `javascript`, `shell`
- `dependencies` (array) - Package dependencies to install before running (e.g., ['numpy', 'pandas'])
- `env` (object) - Environment variables to set for the script

**Keywords:** script, python, typescript, javascript, shell, execute, run, sandbox, docker, compute, data

---

### sessions_history

Get conversation history from another session by key or id

**Parameters:**
- `sessionKey` (string) - Session key (e.g., "main", "spawn:parent:label")
- `sessionId` (string) - Session UUID (alternative to sessionKey)
- `limit` (number) - Maximum messages to return (default: 50)
- `includeTools` (boolean) - Include tool call details (default: false)

**Keywords:** sessions, history, transcript, messages, review, context, multi-agent

---

### sessions_list

List active sessions in the multi-agent system (discover who you can communicate with)

**Parameters:**
- `kinds` (array) - Filter by session kinds
- `limit` (number) - Maximum sessions to return (default: 50)
- `activeMinutes` (number) - Only sessions active in last N minutes
- `messageLimit` (number) - Include last N messages per session in preview

**Keywords:** sessions, list, active, agents, discover, coordination, multi-agent

---

### skills_list

List installed SKILL.md packages from the local SkillsHub

**Parameters:**
- `include_disabled` (boolean) - Include disabled skills. Default: false.
- `include_usage` (boolean) - Include local usage telemetry when present. Default: true.

**Keywords:** skill, skills, list, installed, enabled, disabled, hub, hermes

---

### a2ui

Build dynamic UI surfaces and components with the A2UI protocol

**Parameters:**
- `action` (string, required) - The action to perform   Values: `create_surface`, `delete_surface`, `add_component`, `add_components`, `update_data`, `begin_rendering`, `render_terminal`, `render_html`, `get_surface`, `list_surfaces`, `start_server`, `stop_server`, `server_status`, `get_data`, `get_component_state`, `canvas_snapshot`
- `surfaceId` (string) - Unique identifier for the surface
- `component` (object) - Single component to add (for add_component action)
- `components` (array) - Array of components to add (for add_components action)
- `data` (object) - Data to set in the data model
- `dataPath` (string) - Dot-notation path for nested data updates (e.g., "user.profile")
- `root` (string) - ID of root component to render
- `styles` (object) - Global surface styles
- `port` (number) - Server port (default: 18790)
- `host` (string) - Server host (default: 127.0.0.1)
- `componentId` (string) - Component ID (for get_component_state action)

**Keywords:** a2ui, surface, component, ui, interface, canvas, render

---

### canvas

Create and manipulate visual workspaces with positioned elements

**Parameters:**
- `action` (string, required) - The action to perform   Values: `create`, `delete`, `list`, `add_element`, `update_element`, `delete_element`, `move`, `resize`, `select`, `deselect`, `clear_selection`, `bring_to_front`, `send_to_back`, `undo`, `redo`, `render`, `export`, `import`
- `canvasId` (string) - Canvas identifier
- `elementId` (string) - Element identifier
- `element` (object) - Element definition
- `position` (object)
- `size` (object)
- `format` (string) - Output format for render/export   Values: `terminal`, `html`, `json`, `svg`
- `config` (object) - Canvas configuration
- `json` (string) - Serialized canvas JSON to import (for import action)
- `data` (string) - Alias of json for import action

**Keywords:** canvas, visual, workspace, diagram, layout, element, render, export, import

---

### device_manage

Manage paired devices (SSH/ADB/local)

**Parameters:**
- `action` (string, required) - Device action to perform   Values: `list`, `pair`, `remove`, `snap`, `screenshot`, `record`, `location`, `run`
- `deviceId` (string) - Device identifier
- `name` (string) - Display name for pairing
- `transport` (string) - Transport type   Values: `ssh`, `adb`, `local`
- `address` (string) - Connection address (host/IP)
- `port` (number) - Connection port
- `username` (string) - SSH username
- `keyPath` (string) - Path to SSH key
- `command` (string) - Command to run (for run action)
- `duration` (number) - Recording duration in seconds (for record action)

**Keywords:** device, ssh, adb, android, remote, screenshot, camera, pair

---

### export

Export data to various formats

**Parameters:**
- `operation` (string, required) - Export operation   Values: `conversation`, `csv`, `code_snippets`, `list`
- `format` (string) - Export format for conversation   Values: `json`, `markdown`, `html`, `txt`, `pdf`
- `messages` (array) - Messages to export
- `data` (array) - Data array for CSV export
- `title` (string) - Title for the export
- `include_metadata` (boolean) - Include metadata in export
- `include_timestamps` (boolean) - Include timestamps in export
- `theme` (string) - Theme for HTML export   Values: `light`, `dark`
- `output_path` (string) - Output file path

**Keywords:** export, save, convert, format, json, markdown, html

---

### forget

Delete a persistent memory entry

**Parameters:**
- `key` (string, required) - Memory key to remove
- `scope` (string) - Scope to remove from (default: project)   Values: `project`, `user`

**Keywords:** memory, forget, remove, delete, cleanup

---

### knowledge_add

Add a new knowledge entry

**Parameters:**
- `title` (string, required) - Title for this knowledge entry (becomes the filename)
- `content` (string, required) - Markdown content of the knowledge entry
- `tags` (array) - Tags for discovery
- `scope` (array) - Agent modes this applies to (e.g. ["code", "review"])

**Keywords:** knowledge, add, save, persist, remember, convention

---

### lessons_list

List all lessons learned

**Parameters:**
- `category` (string) - Filter by lesson category   Values: `PATTERN`, `RULE`, `CONTEXT`, `INSIGHT`
- `limit` (number) - Maximum results (default: 20)

**Keywords:** lesson, list, all, show, history

---

### qr

QR code operations

**Parameters:**
- `operation` (string, required) - QR code operation   Values: `generate`, `generate_url`, `generate_wifi`, `generate_vcard`, `decode`, `list`
- `data` (string) - Data to encode in QR code
- `url` (string) - URL for generate_url
- `ssid` (string) - WiFi SSID for generate_wifi
- `password` (string) - WiFi password for generate_wifi
- `wifi_type` (string) - WiFi security type   Values: `WPA`, `WEP`, `nopass`
- `contact` (object) - Contact info for vCard (firstName, lastName, phone, email, etc.)
- `path` (string) - Path to QR code image for decode
- `format` (string) - Output format (default: utf8)   Values: `ascii`, `utf8`, `svg`, `png`

**Keywords:** qr, code, barcode, scan, generate

---

### user_model_observe

Propose an observation about the user for human review (no silent write)

**Parameters:**
- `kind` (string, required) - Observation kind   Values: `preference`, `trait`, `expertise`, `working-style`
- `content` (string, required) - The observation about the user (working preferences only)
- `confidence` (number) - Optional 0..1 confidence in the observation
- `note` (string) - Optional provenance note (what prompted the observation)

**Keywords:** user, model, preference, observe, profile, personalization, working style, trait

---

### user_model_recall

Recall accepted observations about the user

**Parameters:**
- `kind` (string) - Optional: filter to a specific observation kind   Values: `preference`, `trait`, `expertise`, `working-style`
- `query` (string) - Optional keyword to filter accepted observations

**Keywords:** user, model, preference, recall, profile, personalization, who

---

### create_skill

Create a new SKILL.md workflow

**Parameters:**
- `name` (string, required) - Skill name (becomes the filename)
- `description` (string, required) - Short description of what the skill does
- `body` (string, required) - Markdown body of the skill (instructions, steps, etc.)
- `tags` (array) - Tags for discovery
- `requires` (array) - Required tools or capabilities
- `overwrite` (boolean) - Overwrite if skill already exists (default: false)

**Keywords:** skill, create, workflow, reusable, procedure, automate

---

### skill_discover

Search Skills Hub for capabilities

**Parameters:**
- `query` (string, required) - Search query to find relevant skills
- `tags` (array) - Tags to filter by
- `auto_install` (boolean) - Automatically install the top matching skill (default: false)
- `limit` (number) - Maximum results to return (default: 5)

**Keywords:** skill, discover, search, hub, install, capability, plugin

---

## security

### scan_secrets

Scan source files for hardcoded secrets, credentials, and API keys

**Parameters:**
- `path` (string, required) - File or directory path to scan for secrets
- `recursive` (boolean) - Whether to scan directories recursively (default: true)
- `exclude` (array) - Directory names to exclude from scanning

**Keywords:** secrets, credentials, api key, token, password, leak, scan, security, hardcoded, detect, aws, github, stripe, jwt

---

_Total tools: 151_
<!-- hash:5ed6cc115f65bdf8 -->
