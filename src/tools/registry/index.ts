/**
 * Tool Registry Module
 *
 * Exports the formal tool registry system:
 * - FormalToolRegistry: Centralized registry for all tools
 * - ITool: Interface for tool implementations
 * - BaseTool: Abstract base class for tools
 * - Types for schema, metadata, and execution
 * - Tool adapters for all tool operations
 */

// Registry
export { FormalToolRegistry, getFormalToolRegistry, createTestToolRegistry } from './tool-registry.js';

// Tool Adapters - Text Editor
export {
  ViewFileTool,
  CreateFileTool,
  StrReplaceEditorTool,
  createTextEditorTools,
  resetTextEditorInstance,
} from './text-editor-tools.js';

// Tool Adapters - Bash
export {
  BashExecuteTool,
  createBashTools,
  resetBashInstance,
} from './bash-tools.js';

// Tool Adapters - LS (dedicated directory listing)
export {
  ListDirectoryTool,
  createLsTools,
  resetLsInstance,
} from './ls-tools.js';

// Tool Adapters - Self-describe (robot self-model / components)
export {
  SelfDescribeTool,
  createSelfDescribeTools,
} from './self-describe-tools.js';

// Tool Adapters - Remind (dated reminders — the agent's proper path vs shelling `buddy remind add`)
export { RemindTool, createRemindTools } from './remind-tools.js';

// Safe runtime authoring for widgets, executable tools, and skills.
export {
  ExtensionForgeTool,
  createExtensionForgeTool,
  createExtensionForgeTools,
} from '../extension-forge-tool.js';

// Tool Adapters - Search
export {
  UnifiedSearchTool,
  FindSymbolsTool,
  FindReferencesTool,
  FindDefinitionTool,
  SearchMultipleTool,
  createSearchTools,
  resetSearchInstance,
} from './search-tools.js';

// Tool Adapters - Web
export {
  WebSearchExecuteTool,
  WebFetchTool,
  createWebTools,
  resetWebSearchInstance,
} from './web-tools.js';

// Tool Adapters - Research (Deep/Wide/STORM)
export { createResearchTools } from './research-tools.js';

// Tool Adapters - Todo
export {
  CreateTodoListTool,
  UpdateTodoListTool,
  GetTodoListTool,
  createTodoTools,
  resetTodoInstance,
} from './todo-tools.js';

// Tool Adapters - Hermes Kanban
export {
  createKanbanTools,
} from './kanban-tools.js';

// Tool Adapters - Messaging
export {
  SendMessageTool,
  createSendMessageTools,
} from './send-message-tools.js';

export {
  DiscordAdminTool,
  DiscordTool,
  createDiscordTools,
} from './discord-tools.js';

export {
  YuanbaoTool,
  createYuanbaoTools,
} from './yuanbao-tools.js';

export {
  HomeAssistantTool,
  createHomeAssistantTools,
} from './homeassistant-tools.js';

export {
  MixtureOfAgentsTool,
  createMixtureOfAgentsTools,
} from './moa-tools.js';

export {
  SpotifyTool,
  createSpotifyTools,
} from './spotify-tools.js';

export {
  XSearchTool,
  createXSearchTools,
} from './x-search-tools.js';

export {
  FeishuTool,
  createFeishuTools,
} from './feishu-tools.js';

// Tool Adapters - Secrets detector (scan_secrets)
export {
  ScanSecretsExecuteTool,
  createSecretsTools,
  resetSecretsInstances,
} from './secrets-tools.js';

// Tool Adapters - Cron jobs
export {
  CronjobExecuteTool,
  createCronjobTools,
} from './cronjob-tools.js';

// Tool Adapters - Docker
export {
  DockerOperationTool,
  createDockerTools,
  resetDockerInstance,
} from './docker-tools.js';

// Tool Adapters - Kubernetes
export {
  KubernetesOperationTool,
  createKubernetesTools,
  resetKubernetesInstance,
} from './kubernetes-tools.js';

// Tool Adapters - Git
export {
  GitOperationTool,
  createGitTools,
  resetGitInstance,
} from './git-tools.js';

// Tool Adapters - Misc (Browser, Reasoning)
export {
  BrowserExecuteTool,
  BrowserSnapshotExecuteTool,
  BrowserConsoleExecuteTool,
  BrowserGetImagesExecuteTool,
  BrowserDialogExecuteTool,
  ReasoningExecuteTool,
  createMiscTools,
  resetMiscInstances,
} from './misc-tools.js';

// Tool Adapters - Playwright Browser (browser_launch, browser_navigate, browser_action)
export {
  BrowserLaunchTool,
  BrowserNavigateTool,
  BrowserClickTool,
  BrowserTypeTool,
  BrowserScrollTool,
  BrowserBackTool,
  BrowserPressTool,
  BrowserActionTool,
  createBrowserTools,
  resetBrowserInstance,
} from './browser-tools.js';
export { WebTestTool } from './web-test-tool.js';

// Tool Adapters - Process
export {
  ProcessOperationTool,
  AppServerExecuteTool,
  createProcessTools,
  resetProcessInstance,
} from './process-tools.js';

// Tool Adapters - Vision (ocr_extract, image_analyze)
export {
  VisionAnalyzeTool,
  BrowserVisionTool,
  OcrExtractTool,
  ImageAnalyzeTool,
  ObjectDetectTool,
  CameraSnapshotTool,
  createVisionTools,
} from './vision-tools.js';

// Tool Adapters - Script
export {
  createScriptTools,
} from './script-tools.js';

// Tool Adapter - bounded JavaScript orchestration / Responses Lite Code Mode
export {
  CodeExecTool,
  createCodeExecTools,
  attachCodeExecRuntime,
  createCodeExecToolCallId,
  CODE_EXEC_LIMITS,
} from '../code-exec-tool.js';
export type { CodeExecRuntime } from '../code-exec-tool.js';

// Tool Adapters - Hermes execute_code
export {
  ExecuteCodeTool,
  createExecuteCodeTools,
} from './execute-code-tools.js';

// Tool Adapters - Plan
export {
  createPlanTools,
} from './plan-tools.js';

// Tool Adapters - Knowledge, AskHuman, CreateSkill
export {
  KnowledgeSearchTool,
  KnowledgeAddTool,
  AskHumanExecuteTool,
  CreateSkillExecuteTool,
  createKnowledgeTools,
} from './knowledge-tools.js';

// Tool Adapters - Relationship Intelligence
export {
  RelationshipContextTool,
  createRelationshipIntelligenceTools,
} from './relationship-intelligence-tools.js';

// Tool Adapters - Internet Scout
export {
  InternetScoutPlanTool,
  InternetScoutRunTool,
  createInternetScoutTools,
} from './internet-scout-tools.js';

// Tool Adapters - Lead Scout
export {
  LeadScoutEnrichmentPlanTool,
  LeadScoutLessonCandidatesTool,
  LeadScoutPlanTool,
  LeadScoutRunTool,
  createLeadScoutTools,
} from './lead-scout-tools.js';

// Tool Adapters - Browser Operator (live-web session proposal)
export { BrowserOperatorTool, createBrowserOperatorTools } from './browser-operator-tools.js';

// Tool Adapters - Persistent Memory (remember, recall, forget)
export {
  RememberTool,
  ReplaceMemoryTool,
  MemoryProposeTool,
  RecallTool,
  ForgetTool,
  createMemoryTools,
} from './memory-tools.js';

// Tool Adapters - Attention (Todo + RestoreContext)
export {
  TodoAttentionTool,
  RestoreContextTool,
  createAttentionTools,
} from './attention-tools.js';

// Tool Adapters - Lessons (self-improvement loop + verification contract)
export {
  LessonsAddTool,
  LessonsGraphTool,
  LessonsSearchTool,
  LessonsListTool,
  TaskVerifyTool,
  createLessonsTools,
} from './lessons-tools.js';

// Tool Adapters - User Model (Hermes "deepening model of who you are")
export {
  UserModelObserveTool,
  UserModelRecallTool,
  createUserModelTools,
} from './user-model-tools.js';

// Tool Adapters - Skills inspection (Hermes skills_list / skill_view)
export {
  SkillManageExecuteTool,
  createSkillsInspectionTools,
} from './skills-inspection-tools.js';

// Tool Adapters - Multimodal (audio, video, PDF, OCR, QR, clipboard, diagram, document, export, archive)
export {
  AudioExecuteTool,
  TextToSpeechTool,
  ImageGenerateTool,
  ImageEditTool,
  VideoAnalyzeTool,
  VideoGenerateTool,
  VideoExecuteTool,
  PDFExecuteTool,
  OCRExecuteTool,
  QRExecuteTool,
  ClipboardExecuteTool,
  DiagramExecuteTool,
  DocumentExecuteTool,
  ExportExecuteTool,
  ArchiveExecuteTool,
  createMultimodalTools,
  resetMultimodalInstances,
} from './multimodal-tools.js';

// Tool Adapters - Advanced (JS REPL, Multi-Edit, CodebaseMap, SpawnSubagent)
export {
  JSReplExecuteTool,
  MultiEditExecuteTool,
  CodebaseMapExecuteTool,
  SpawnSubagentExecuteTool,
  createAdvancedTools,
  resetAdvancedInstances,
} from './advanced-tools.js';

// Tool Adapters - Canvas (A2UI, Visual Canvas)
export {
  A2UIExecuteTool,
  CanvasExecuteTool,
  createCanvasTools,
  resetCanvasInstances,
} from './canvas-tools.js';

// Tool Adapters - Parallel (spawn_parallel_agents)
export {
  ParallelAgentTool,
  createParallelTools,
} from './parallel-tools.js';

// Tool Adapters - Control (terminate)
export {
  TerminateExecuteTool,
  createControlTools,
  resetControlInstances,
} from './control-tools.js';

// Tool Adapters - Firecrawl (firecrawl_search, firecrawl_scrape)
export {
  FirecrawlSearchExecuteTool,
  FirecrawlScrapeExecuteTool,
  createFirecrawlTools,
  resetFirecrawlInstances,
} from './firecrawl-tools.js';

// Tool Adapters - LSP (lsp_rename, lsp_code_action)
export {
  LspRenameExecuteTool,
  LspCodeActionExecuteTool,
  createLspTools,
  resetLspInstances,
} from './lsp-tools.js';

// Tool Adapters - Bug Finder (find_bugs)
export {
  BugFinderExecuteTool,
  createBugFinderTools,
  resetBugFinderInstances,
} from './bug-finder-tools.js';

// Tool Adapters - Document Generator (generate_document)
export {
  GenerateDocumentExecuteTool,
  createDocumentGeneratorTools,
  resetDocumentGeneratorInstances,
} from './document-generator-tools.js';

// Tool Adapters - Meeting Notes
export { createMeetingTools } from './meeting-tools.js';

// Tool Adapters - Registered local ComfyUI recipes
export { createComfyRecipeTools } from './comfy-recipe-tools.js';

// Tool Adapters - Merge Conflict (resolve_conflicts)
export {
  ResolveConflictsExecuteTool,
  createMergeConflictTools,
  resetMergeConflictInstances,
} from './merge-conflict-tools.js';

// Tool Adapters - Vulnerability Scanner (scan_vulnerabilities)
export {
  VulnScannerExecuteTool,
  createVulnScannerTools,
  resetVulnScannerInstances,
} from './vuln-scanner-tools.js';

// Tool Adapters - Advisor (advisor)
export {
  AdvisorExecuteTool,
  createAdvisorTools,
  resetAdvisorInstances,
  setAdvisorConfigProvider,
  resetAdvisorConfigProvider,
} from './advisor-tools.js';

// Tool Adapters - Verify (explicit delegation to the independent Verifier agent)
export {
  VerifyTool,
  createVerifyTools,
  resetVerifyInstances,
  setVerifyToolProvider,
  resetVerifyToolProvider,
} from './verify-tools.js';
export type {
  VerifyToolProvider,
  VerifyLlmCall,
  VerifyExecuteTool,
} from './verify-tools.js';

// Tool Adapters - Delegate Agent (reaches the built-in specialized agents)
export {
  DelegateAgentTool,
  createDelegateAgentTools,
  resetDelegateAgentInstances,
  setDelegateAgentProvider,
  resetDelegateAgentProvider,
} from './delegate-agent-tools.js';
export type {
  DelegateAgentProvider,
  DelegateLlmCall,
  DelegateExecuteTool,
} from './delegate-agent-tools.js';

// Tool Adapters - Fleet (peer_delegate, list_peers, route_peer)
export {
  PeerDelegateTool,
  PeerChainTool,
  ListPeersTool,
  RoutePeerTool,
  createFleetTools,
  resetFleetToolInstances,
} from './fleet-tools.js';

// Tool Adapters - CodeExplorer
export {
  CodeExplorerAskTool,
  createCodeExplorerTools,
  resetCodeExplorerInstances,
} from './code-explorer-tools.js';

// Tool Adapters - Screenpipe (screen_memory)
export {
  ScreenMemoryTool,
  createScreenpipeTools,
  resetScreenpipeInstances,
} from './screenpipe-tools.js';

// Tool Adapters - AskUserQuestion (ask_user_question)
export {
  AskUserQuestionExecuteTool,
  createAskUserQuestionTools,
  resetAskUserQuestionInstances,
} from './ask-user-question-tools.js';

// Tool Adapters - ExitPlanMode (exit_plan_mode)
export {
  ExitPlanModeExecuteTool,
  createExitPlanModeTools,
  resetExitPlanModeInstances,
} from './exit-plan-mode-tools.js';

// Tool Adapters - Codebase Replace (codebase_replace)
export {
  CodebaseReplaceTool,
  createCodebaseReplaceTools,
  resetCodebaseReplaceInstances,
} from './codebase-replace-tools.js';

// Tool Adapters - GUI Control (gui_control)
export {
  GuiControlTool,
  createGuiTools,
  resetGuiToolInstance,
} from './gui-tools.js';

// Tool Adapters - Session coordination (sessions_list/history/send/spawn) — Phase E wake
export {
  createSessionTools,
} from './session-tools.js';

// Tool Adapters - PTY Interactive Shell
export { InteractiveShellTool } from '../interactive-shell-tool.js';

// Tool Prefix Naming Convention — Codex-inspired canonical aliases
export {
  createAliasTools,
  toCanonicalName,
  toLegacyName,
  TOOL_ALIASES,
  CANONICAL_NAME,
} from './tool-aliases.js';

// Types
export type {
  // JSON Schema
  JsonSchema,
  JsonSchemaProperty,
  // Tool
  ToolSchema,
  ToolCategoryType,
  ITool,
  IToolMetadata,
  IValidationResult,
  // Execution
  ToolExecutorFn,
  IToolExecutionContext,
  IToolExecutionResult,
  // Registry
  IToolRegistrationOptions,
  IRegisteredTool,
  IToolQueryOptions,
  IToolRegistry,
  IRegistryStats,
  // Events
  IToolRegistryEvents,
  ToolRegistryEventHandler,
} from './types.js';

/**
 * Create all tool instances for registration (async for lazy loading).
 * Also registers canonical-prefix alias tools (shell_*, file_*, browser_*, etc.)
 * for Codex-style tool naming convention.
 */
export async function createAllToolsAsync(): Promise<ITool[]> {
  const { createTextEditorTools } = await import('./text-editor-tools.js');
  const { createBashTools } = await import('./bash-tools.js');
  const { createSearchTools } = await import('./search-tools.js');
  const { createWebTools } = await import('./web-tools.js');
  const { createResearchTools } = await import('./research-tools.js');
  const { createMeetingTools } = await import('./meeting-tools.js');
  const { createComfyRecipeTools } = await import('./comfy-recipe-tools.js');
  const { createTodoTools } = await import('./todo-tools.js');
  const { createKanbanTools } = await import('./kanban-tools.js');
  const { createSendMessageTools } = await import('./send-message-tools.js');
  const { createDiscordTools } = await import('./discord-tools.js');
  const { createYuanbaoTools } = await import('./yuanbao-tools.js');
  const { createHomeAssistantTools } = await import('./homeassistant-tools.js');
  const { createMixtureOfAgentsTools } = await import('./moa-tools.js');
  const { createSpotifyTools } = await import('./spotify-tools.js');
  const { createXSearchTools } = await import('./x-search-tools.js');
  const { createFeishuTools } = await import('./feishu-tools.js');
  const { createSecretsTools } = await import('./secrets-tools.js');
  const { createCronjobTools } = await import('./cronjob-tools.js');
  const { createDockerTools } = await import('./docker-tools.js');
  const { createKubernetesTools } = await import('./kubernetes-tools.js');
  const { createGitTools } = await import('./git-tools.js');
  const { createMiscTools } = await import('./misc-tools.js');
  const { createBrowserTools } = await import('./browser-tools.js');
  const { createProcessTools } = await import('./process-tools.js');
  const { createVisionTools } = await import('./vision-tools.js');
  const { createKnowledgeTools } = await import('./knowledge-tools.js');
  const { createRelationshipIntelligenceTools } = await import('./relationship-intelligence-tools.js');
  const { createInternetScoutTools } = await import('./internet-scout-tools.js');
  const { createLeadScoutTools } = await import('./lead-scout-tools.js');
  const { createBrowserOperatorTools } = await import('./browser-operator-tools.js');
  const { createScriptTools } = await import('./script-tools.js');
  const { createCodeExecTools } = await import('../code-exec-tool.js');
  const { createPlanTools } = await import('./plan-tools.js');
  const { createAttentionTools } = await import('./attention-tools.js');
  const { createSkillsInspectionTools } = await import('./skills-inspection-tools.js');
  const { createAliasTools } = await import('./tool-aliases.js');
  const { createLessonsTools } = await import('./lessons-tools.js');
  const { createUserModelTools } = await import('./user-model-tools.js');
  const { createMultimodalTools } = await import('./multimodal-tools.js');
  const { createAdvancedTools } = await import('./advanced-tools.js');
  const { createCanvasTools } = await import('./canvas-tools.js');
  const { createMemoryTools } = await import('./memory-tools.js');
  const { createParallelTools } = await import('./parallel-tools.js');
  const { createControlTools } = await import('./control-tools.js');
  const { createFirecrawlTools } = await import('./firecrawl-tools.js');
  const { createLspTools } = await import('./lsp-tools.js');
  const { createBugFinderTools } = await import('./bug-finder-tools.js');
  const { createMergeConflictTools } = await import('./merge-conflict-tools.js');
  const { createVulnScannerTools } = await import('./vuln-scanner-tools.js');
  const { createAdvisorTools } = await import('./advisor-tools.js');
  const { createFleetTools } = await import('./fleet-tools.js');
  const { createAskUserQuestionTools } = await import('./ask-user-question-tools.js');
  const { createExitPlanModeTools } = await import('./exit-plan-mode-tools.js');
  const { createCodeExplorerTools } = await import('./code-explorer-tools.js');
  const { createExtensionForgeTools } = await import('../extension-forge-tool.js');
  const { createAuthoredExtraTools } = await import('./authored-extra-tools.js');

  // Await MCP Manager initialization before registering its tools
  const { getMcpManager } = await import('../mcp/mcp-manager.js');
  await getMcpManager().initialize();
  const { createMcpTools } = await import('./mcp-tools.js');

  const primaryTools: ITool[] = [
    ...createTextEditorTools(),
    ...createBashTools(),
    ...createSearchTools(),
    ...createWebTools(),
    ...createResearchTools(),
    ...createMeetingTools(),
    ...createComfyRecipeTools(),
    ...createTodoTools(),
    ...createKanbanTools(),
    ...createSendMessageTools(),
    ...createDiscordTools(),
    ...createYuanbaoTools(),
    ...createHomeAssistantTools(),
    ...createMixtureOfAgentsTools(),
    ...createSpotifyTools(),
    ...createXSearchTools(),
    ...createFeishuTools(),
    ...createSecretsTools(),
    ...createCronjobTools(),
    ...createDockerTools(),
    ...createKubernetesTools(),
    ...createGitTools(),
    ...createMiscTools(),
    ...createBrowserTools(),
    ...createProcessTools(),
    ...createVisionTools(),
    ...createKnowledgeTools(),
    ...createRelationshipIntelligenceTools(),
    ...createInternetScoutTools(),
    ...createLeadScoutTools(),
    ...createBrowserOperatorTools(),
    ...createMemoryTools(),
    ...createParallelTools(),
    ...createScriptTools(),
    ...createCodeExecTools(),
    ...createPlanTools(),
    ...createAttentionTools(),
    ...createSkillsInspectionTools(),
    ...createLessonsTools(),
    ...createUserModelTools(),
    ...createMultimodalTools(),
    ...createAdvancedTools(),
    ...createCanvasTools(),
    ...createControlTools(),
    ...createFirecrawlTools(),
    ...createLspTools(),
    ...createBugFinderTools(),
    ...createMergeConflictTools(),
    ...createVulnScannerTools(),
    ...createAdvisorTools(),
    ...createFleetTools(),
    ...createAskUserQuestionTools(),
    ...createExitPlanModeTools(),
    ...createCodeExplorerTools(),
    ...createExtensionForgeTools(),
    ...createAuthoredExtraTools(),
    ...createDesignTools(),
    ...createCsvTools(),
    ...createMcpTools(),
  ];

  // Register backward-compat canonical-prefix aliases (shell_exec, file_read, etc.)
  const aliasTools = createAliasTools(primaryTools);

  return [...primaryTools, ...aliasTools];
}

// Import ITool type for return type
import type { ITool } from './types.js';

/**
 * Register all built-in synchronous tools (text-editor, bash, search,
 * web, todo, docker, k8s, git, misc, browser, process, vision, script,
 * plan, knowledge, memory, parallel, attention, lessons, multimodal,
 * advanced, canvas, control, firecrawl, lsp, bug-finder, merge-conflict,
 * vuln-scanner, codebase-replace, advisor, fleet, ask-user-question,
 * exit-plan-mode, gui, session) plus their canonical-prefix aliases
 * (`shell_exec`, `file_read`, `browser_search`, …).
 *
 * Counterpart of `createAllToolsAsync()` that does NOT initialize MCP —
 * for callers (e.g. Cowork's WorkflowBridge) that want a usable registry
 * without paying the MCP boot cost.
 *
 * @returns the number of tools newly registered (skipped duplicates).
 */
export function registerBuiltinTools(registry: FormalToolRegistry): number {
  const allTools: ITool[] = [
    ...createTextEditorTools(),
    ...createBashTools(),
    ...createLsTools(),
    ...createSelfDescribeTools(),
    ...createRemindTools(),
    ...createSearchTools(),
    ...createWebTools(),
    ...createResearchTools(),
    ...createMeetingTools(),
    ...createComfyRecipeTools(),
    ...createTodoTools(),
    ...createKanbanTools(),
    ...createSendMessageTools(),
    ...createDiscordTools(),
    ...createYuanbaoTools(),
    ...createHomeAssistantTools(),
    ...createMixtureOfAgentsTools(),
    ...createSpotifyTools(),
    ...createXSearchTools(),
    ...createFeishuTools(),
    ...createSecretsTools(),
    ...createCronjobTools(),
    ...createDockerTools(),
    ...createKubernetesTools(),
    ...createGitTools(),
    ...createMiscTools(),
    ...createBrowserTools(),
    ...createProcessTools(),
    ...createVisionTools(),
    ...createScriptTools(),
    ...createCodeExecTools(),
    ...createPlanTools(),
    ...createKnowledgeTools(),
    ...createRelationshipIntelligenceTools(),
    ...createInternetScoutTools(),
    ...createLeadScoutTools(),
    ...createBrowserOperatorTools(),
    ...createMemoryTools(),
    ...createParallelTools(),
    ...createAttentionTools(),
    ...createSkillsInspectionTools(),
    ...createLessonsTools(),
    ...createUserModelTools(),
    ...createMultimodalTools(),
    ...createAdvancedTools(),
    ...createCanvasTools(),
    ...createControlTools(),
    ...createFirecrawlTools(),
    ...createLspTools(),
    ...createBugFinderTools(),
    ...createMergeConflictTools(),
    ...createVulnScannerTools(),
    ...createCodebaseReplaceTools(),
    ...createAdvisorTools(),
    ...createFleetTools(),
    ...createAskUserQuestionTools(),
    ...createExitPlanModeTools(),
    ...createGuiTools(),
    ...createSessionTools(),
    ...createCodeExplorerTools(),
    ...createExtensionForgeTools(),
    ...createAuthoredExtraTools(),
    ...createDesignTools(),
    ...createCsvTools(),
  ];
  // Append canonical-prefix aliases (shell_exec → bash_run, etc.).
  allTools.push(...createAliasTools(allTools));

  let registered = 0;
  for (const tool of allTools) {
    if (!registry.has(tool.name)) {
      registry.register(tool);
      registered++;
    }
  }
  return registered;
}

// Re-import the factories used by registerBuiltinTools so the function above resolves.
import { FormalToolRegistry } from './tool-registry.js';
import { createAuthoredExtraTools } from './authored-extra-tools.js';
import { createDesignTools } from './design-tools.js';
import { createCsvTools } from './csv-tools.js';
import { createTextEditorTools } from './text-editor-tools.js';
import { createBashTools } from './bash-tools.js';
import { createLsTools } from './ls-tools.js';
import { createSelfDescribeTools } from './self-describe-tools.js';
import { createRemindTools } from './remind-tools.js';
import { createSearchTools } from './search-tools.js';
import { createWebTools } from './web-tools.js';
import { createResearchTools } from './research-tools.js';
import { createMeetingTools } from './meeting-tools.js';
import { createComfyRecipeTools } from './comfy-recipe-tools.js';
import { createTodoTools } from './todo-tools.js';
import { createKanbanTools } from './kanban-tools.js';
import { createSendMessageTools } from './send-message-tools.js';
import { createDiscordTools } from './discord-tools.js';
import { createYuanbaoTools } from './yuanbao-tools.js';
import { createHomeAssistantTools } from './homeassistant-tools.js';
import { createMixtureOfAgentsTools } from './moa-tools.js';
import { createSpotifyTools } from './spotify-tools.js';
import { createXSearchTools } from './x-search-tools.js';
import { createFeishuTools } from './feishu-tools.js';
import { createSecretsTools } from './secrets-tools.js';
import { createCronjobTools } from './cronjob-tools.js';
import { createDockerTools } from './docker-tools.js';
import { createKubernetesTools } from './kubernetes-tools.js';
import { createGitTools } from './git-tools.js';
import { createMiscTools } from './misc-tools.js';
import { createBrowserTools } from './browser-tools.js';
import { createProcessTools } from './process-tools.js';
import { createVisionTools } from './vision-tools.js';
import { createScriptTools } from './script-tools.js';
import { createCodeExecTools } from '../code-exec-tool.js';
import { createPlanTools } from './plan-tools.js';
import { createKnowledgeTools } from './knowledge-tools.js';
import { createRelationshipIntelligenceTools } from './relationship-intelligence-tools.js';
import { createInternetScoutTools } from './internet-scout-tools.js';
import { createLeadScoutTools } from './lead-scout-tools.js';
import { createBrowserOperatorTools } from './browser-operator-tools.js';
import { createMemoryTools } from './memory-tools.js';
import { createParallelTools } from './parallel-tools.js';
import { createAttentionTools } from './attention-tools.js';
import { createSkillsInspectionTools } from './skills-inspection-tools.js';
import { createLessonsTools } from './lessons-tools.js';
import { createUserModelTools } from './user-model-tools.js';
import { createMultimodalTools } from './multimodal-tools.js';
import { createAdvancedTools } from './advanced-tools.js';
import { createCanvasTools } from './canvas-tools.js';
import { createControlTools } from './control-tools.js';
import { createFirecrawlTools } from './firecrawl-tools.js';
import { createLspTools } from './lsp-tools.js';
import { createBugFinderTools } from './bug-finder-tools.js';
import { createMergeConflictTools } from './merge-conflict-tools.js';
import { createVulnScannerTools } from './vuln-scanner-tools.js';
import { createCodebaseReplaceTools } from './codebase-replace-tools.js';
import { createAdvisorTools } from './advisor-tools.js';
import { createFleetTools } from './fleet-tools.js';
import { createAskUserQuestionTools } from './ask-user-question-tools.js';
import { createExitPlanModeTools } from './exit-plan-mode-tools.js';
import { createGuiTools } from './gui-tools.js';
import { createSessionTools } from './session-tools.js';
import { createAliasTools } from './tool-aliases.js';
import { createCodeExplorerTools } from './code-explorer-tools.js';
import { createExtensionForgeTools } from '../extension-forge-tool.js';
export * from "./windows-tools.js";
