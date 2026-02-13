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
  SUBAGENT_TOOL,
  DOCKER_TOOL,
  KUBERNETES_TOOL,
  PROCESS_TOOL,
  JS_REPL_TOOL,
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

// Computer Control tools (OpenClaw-inspired)
export {
  COMPUTER_CONTROL_TOOL,
  COMPUTER_CONTROL_TOOLS,
} from './computer-control-tools.js';

// Browser tools (OpenClaw-inspired CDP automation)
export {
  BROWSER_TOOL,
  BROWSER_TOOLS,
} from './browser-tools.js';

// Canvas/A2UI tools (OpenClaw-inspired visual workspaces)
export {
  A2UI_TOOL,
  VISUAL_CANVAS_TOOL,
  CANVAS_TOOLS,
} from './canvas-tools.js';

// Re-export CodeBuddyTool from client for convenience
export type { CodeBuddyTool as Tool } from './types.js';
