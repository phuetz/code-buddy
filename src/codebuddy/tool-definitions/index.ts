/**
 * Tool Definitions Index
 *
 * Re-exports all tool definitions from modular files.
 * This provides a single import point for all tool definitions.
 */

// Types
export type { CodeBuddyTool, JsonSchemaProperty } from './types.js';

// Core tools
export {
  VIEW_FILE_TOOL,
  CREATE_FILE_TOOL,
  STR_REPLACE_EDITOR_TOOL,
  LIST_DIRECTORY_TOOL,
  BASH_TOOL,
  MORPH_EDIT_TOOL,
  CORE_TOOLS,
  isMorphEnabled,
} from './core-tools.js';

// Search tools
export {
  SEARCH_TOOL,
  FIND_SYMBOLS_TOOL,
  FIND_REFERENCES_TOOL,
  FIND_DEFINITION_TOOL,
  SEARCH_MULTI_TOOL,
  SEARCH_TOOLS,
} from './search-tools.js';

// Todo tools
export {
  CREATE_TODO_LIST_TOOL,
  GET_TODO_LIST_TOOL,
  UPDATE_TODO_LIST_TOOL,
  TODO_TOOLS,
} from './todo-tools.js';

// Web tools
export {
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  WEB_TOOLS,
} from './web-tools.js';

// Advanced tools
export {
  MULTI_EDIT_TOOL,
  GIT_TOOL,
  CODEBASE_MAP_TOOL,
  CODE_GRAPH_TOOL,
  SUBAGENT_TOOL,
  DOCKER_TOOL,
  KUBERNETES_TOOL,
  PROCESS_TOOL,
  JS_REPL_TOOL,
  REASON_TOOL,
  PLAN_TOOL,
  RUN_SCRIPT_TOOL,
  ADVANCED_TOOLS,
} from './advanced-tools.js';

// Multimodal tools
export {
  PDF_TOOL,
  AUDIO_TOOL,
  VIDEO_TOOL,
  SCREENSHOT_TOOL,
  CLIPBOARD_TOOL,
  DOCUMENT_TOOL,
  OCR_TOOL,
  DIAGRAM_TOOL,
  EXPORT_TOOL,
  QR_TOOL,
  ARCHIVE_TOOL,
  MULTIMODAL_TOOLS,
} from './multimodal-tools.js';

// Computer Control tools (Enterprise-grade)
export {
  COMPUTER_CONTROL_TOOL,
  COMPUTER_CONTROL_TOOLS,
} from './computer-control-tools.js';

// Browser tools (Enterprise-grade CDP automation)
export {
  BROWSER_TOOL,
  BROWSER_TOOLS,
} from './browser-tools.js';

// Canvas/A2UI tools (Enterprise-grade visual workspaces)
export {
  A2UI_TOOL,
  VISUAL_CANVAS_TOOL,
  CANVAS_TOOLS,
} from './canvas-tools.js';

// Agent tools (attention, knowledge, lessons, discovery, device, verification)
export {
  TODO_UPDATE_TOOL,
  RESTORE_CONTEXT_TOOL,
  KNOWLEDGE_SEARCH_TOOL,
  KNOWLEDGE_ADD_TOOL,
  ASK_HUMAN_TOOL,
  CREATE_SKILL_TOOL,
  SKILL_DISCOVER_TOOL,
  DEVICE_MANAGE_TOOL,
  SPAWN_PARALLEL_AGENTS_TOOL,
  REMEMBER_TOOL,
  RECALL_TOOL,
  FORGET_TOOL,
  LESSONS_ADD_TOOL,
  LESSONS_SEARCH_TOOL,
  LESSONS_LIST_TOOL,
  TASK_VERIFY_TOOL,
  AGENT_TOOLS,
} from './agent-tools.js';

// Firecrawl tools (Native Engine v2026.3.14 — web search & scrape)
export {
  FIRECRAWL_SEARCH_TOOL,
  FIRECRAWL_SCRAPE_TOOL,
  FIRECRAWL_TOOLS,
} from './firecrawl-tools.js';

// LSP tools (Enterprise-grade)
export {
  LSP_CHECK_TOOL,
  LSP_GOTO_DEF_TOOL,
  LSP_FIND_REFS_TOOL,
} from '../../lsp/lsp-client.js';

// LSP rename/refactor tools
export {
  LSP_RENAME_TOOL,
  LSP_CODE_ACTION_TOOL,
  LSP_TOOLS,
} from './lsp-tools.js';

// Bug finder tools (static analysis)
export {
  FIND_BUGS_TOOL,
  BUG_FINDER_TOOLS,
} from './bug-finder-tools.js';

// Merge conflict tools
export {
  RESOLVE_CONFLICTS_TOOL,
  MERGE_CONFLICT_TOOLS,
} from './merge-conflict-tools.js';

// Vulnerability scanner tools
export {
  SCAN_VULNERABILITIES_TOOL,
  VULN_SCANNER_TOOLS,
} from './vuln-scanner-tools.js';

// Secrets detector tools (scan for hardcoded credentials)
export {
  SCAN_SECRETS_TOOL,
  SECRETS_TOOLS,
} from './secrets-tools.js';

// Codebase replace tools (find & replace across files)
export {
  CODEBASE_REPLACE_TOOL,
  CODEBASE_REPLACE_TOOLS,
} from './codebase-replace-tools.js';

// Document generator tools (PPTX, DOCX, XLSX, PDF)
export {
  GENERATE_DOCUMENT_TOOL,
  DOCUMENT_GENERATOR_TOOLS,
} from './document-tools.js';

// Re-export CodeBuddyTool from client for convenience
export type { CodeBuddyTool as Tool } from './types.js';
