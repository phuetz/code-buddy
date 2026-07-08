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
  READ_FILE_TOOL,
  CREATE_FILE_TOOL,
  WRITE_FILE_TOOL,
  STR_REPLACE_EDITOR_TOOL,
  PATCH_TOOL,
  LIST_DIRECTORY_TOOL,
  BASH_TOOL,
  TERMINAL_TOOL,
  MORPH_EDIT_TOOL,
  CORE_TOOLS,
  isMorphEnabled,
} from './core-tools.js';

// Search tools
export {
  SEARCH_TOOL,
  SEARCH_FILES_TOOL,
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

// Hermes Kanban tools
export {
  KANBAN_SHOW_TOOL,
  KANBAN_LIST_TOOL,
  KANBAN_COMPLETE_TOOL,
  KANBAN_BLOCK_TOOL,
  KANBAN_HEARTBEAT_TOOL,
  KANBAN_COMMENT_TOOL,
  KANBAN_CREATE_TOOL,
  KANBAN_LINK_TOOL,
  KANBAN_UNBLOCK_TOOL,
  KANBAN_TOOLS,
} from './kanban-tools.js';

// Messaging tools
export {
  SEND_MESSAGE_TOOL,
  DISCORD_TOOL,
  DISCORD_ADMIN_TOOL,
  MESSAGING_TOOLS,
} from './messaging-tools.js';

// Hermes Yuanbao platform tools
export {
  YB_QUERY_GROUP_INFO_TOOL,
  YB_QUERY_GROUP_MEMBERS_TOOL,
  YB_SEND_DM_TOOL,
  YB_SEARCH_STICKER_TOOL,
  YB_SEND_STICKER_TOOL,
  YUANBAO_TOOLS,
} from './yuanbao-tools.js';

// Home Assistant tools
export {
  HA_LIST_ENTITIES_TOOL,
  HA_GET_STATE_TOOL,
  HA_LIST_SERVICES_TOOL,
  HA_CALL_SERVICE_TOOL,
  HOMEASSISTANT_TOOLS,
} from './homeassistant-tools.js';

// Hermes Mixture-of-Agents tool
export {
  MIXTURE_OF_AGENTS_TOOL,
  MOA_TOOLS,
} from './moa-tools.js';

// Hermes Spotify tools
export {
  SPOTIFY_PLAYBACK_TOOL,
  SPOTIFY_DEVICES_TOOL,
  SPOTIFY_QUEUE_TOOL,
  SPOTIFY_SEARCH_TOOL,
  SPOTIFY_PLAYLISTS_TOOL,
  SPOTIFY_ALBUMS_TOOL,
  SPOTIFY_LIBRARY_TOOL,
  SPOTIFY_TOOLS,
} from './spotify-tools.js';

// Hermes xAI X Search tool
export {
  X_SEARCH_TOOL,
  X_SEARCH_TOOLS,
} from './x-search-tools.js';

// Hermes Feishu/Lark document and drive comment tools
export {
  FEISHU_DOC_READ_TOOL,
  FEISHU_DRIVE_LIST_COMMENTS_TOOL,
  FEISHU_DRIVE_LIST_COMMENT_REPLIES_TOOL,
  FEISHU_DRIVE_REPLY_COMMENT_TOOL,
  FEISHU_DRIVE_ADD_COMMENT_TOOL,
  FEISHU_TOOLS,
} from './feishu-tools.js';

// Cron/scheduler tools
export {
  CRONJOB_TOOL,
  CRON_TOOLS,
} from './cron-tools.js';

// Web tools
export {
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  WEB_EXTRACT_TOOL,
  WEB_TOOLS,
} from './web-tools.js';

// Research tools (Deep/Wide/STORM + Paper QA)
export {
  DEEP_RESEARCH_TOOL,
  PAPER_QA_TOOL,
  RESEARCH_TOOLS,
} from './research-tools.js';

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
  APP_SERVER_TOOL,
  JS_REPL_TOOL,
  REASON_TOOL,
  PLAN_TOOL,
  EXECUTE_CODE_TOOL,
  RUN_SCRIPT_TOOL,
  ADVANCED_TOOLS,
} from './advanced-tools.js';

// Multimodal tools
export {
  PDF_TOOL,
  AUDIO_TOOL,
  TEXT_TO_SPEECH_TOOL,
  IMAGE_GENERATE_TOOL,
  VIDEO_TOOL,
  VIDEO_ANALYZE_TOOL,
  VIDEO_GENERATE_TOOL,
  VIDEO_STITCH_TOOL,
  SCREENSHOT_TOOL,
  CAMERA_SNAPSHOT_TOOL,
  CAMERA_ANALYZE_TOOL,
  CLIPBOARD_TOOL,
  DOCUMENT_TOOL,
  OCR_TOOL,
  VISION_ANALYZE_TOOL,
  OBJECT_DETECT_TOOL,
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
  INTERNET_SCOUT_RUN_TOOL,
  INTERNET_SCOUT_PLAN_TOOL,
  BROWSER_NAVIGATE_TOOL,
  BROWSER_CLICK_TOOL,
  BROWSER_TYPE_TOOL,
  BROWSER_SCROLL_TOOL,
  BROWSER_BACK_TOOL,
  BROWSER_PRESS_TOOL,
  BROWSER_VISION_TOOL,
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
  SKILLS_LIST_TOOL,
  SKILL_VIEW_TOOL,
  DEVICE_MANAGE_TOOL,
  SPAWN_PARALLEL_AGENTS_TOOL,
  REMEMBER_TOOL,
  RECALL_TOOL,
  FORGET_TOOL,
  RELATIONSHIP_CONTEXT_TOOL,
  LEAD_SCOUT_PLAN_TOOL,
  LEAD_SCOUT_RUN_TOOL,
  LEAD_SCOUT_ENRICHMENT_PLAN_TOOL,
  LEAD_SCOUT_LESSON_CANDIDATES_TOOL,
  LESSONS_ADD_TOOL,
  LESSONS_SEARCH_TOOL,
  LESSONS_LIST_TOOL,
  LESSONS_GRAPH_TOOL,
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

// Advisor tool (second opinion from a stronger reviewer model)
export {
  ADVISOR_TOOL,
  ADVISOR_TOOLS,
} from './advisor-tools.js';

// Verify tool (explicit delegation to the independent Verifier agent)
export {
  VERIFY_TOOL,
  VERIFY_TOOLS,
} from './verify-tools.js';

// Delegate-agent tool (reaches the built-in specialized agents: pdf, excel,
// data_analysis, sql, archive, swe)
export {
  DELEGATE_AGENT_TOOL,
  DELEGATE_AGENT_TOOLS,
} from './delegate-agent-tools.js';

// AskUserQuestion tool (structured multi-option mid-task questions)
export {
  ASK_USER_QUESTION_TOOL,
  ASK_USER_QUESTION_TOOLS,
} from './ask-user-question-tools.js';

// ExitPlanMode tool (request approval to leave plan mode)
export {
  EXIT_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOLS,
} from './exit-plan-mode-tools.js';

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

// Session tools (multi-agent coordination — Phase E wake)
export { SESSION_TOOLS } from './session-tools.js';

// CodeExplorer tools
export {
  CODE_EXPLORER_ASK_TOOL,
  CODE_EXPLORER_TOOLS,
} from './code-explorer-tools.js';

// Re-export CodeBuddyTool from client for convenience
export type { CodeBuddyTool as Tool } from './types.js';
export * from "./windows-tools.js";
