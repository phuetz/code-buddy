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

// Tool Adapters - Todo
export {
  CreateTodoListTool,
  UpdateTodoListTool,
  createTodoTools,
  resetTodoInstance,
} from './todo-tools.js';

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
  ReasoningExecuteTool,
  createMiscTools,
  resetMiscInstances,
} from './misc-tools.js';

// Tool Adapters - Process
export {
  ProcessOperationTool,
  createProcessTools,
  resetProcessInstance,
} from './process-tools.js';

// Tool Adapters - Script
export {
  createScriptTools,
} from './script-tools.js';

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

// Tool Adapters - Attention (Todo + RestoreContext)
export {
  TodoAttentionTool,
  RestoreContextTool,
  createAttentionTools,
} from './attention-tools.js';

// Tool Adapters - Lessons (self-improvement loop + verification contract)
export {
  LessonsAddTool,
  LessonsSearchTool,
  LessonsListTool,
  TaskVerifyTool,
  createLessonsTools,
} from './lessons-tools.js';

// Tool Adapters - Multimodal (audio, video, PDF, OCR, QR, clipboard, diagram, document, export, archive)
export {
  AudioExecuteTool,
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

// Tool Adapters - Advanced (JS REPL, Multi-Edit)
export {
  JSReplExecuteTool,
  MultiEditExecuteTool,
  createAdvancedTools,
  resetAdvancedInstances,
} from './advanced-tools.js';

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
  const { createTodoTools } = await import('./todo-tools.js');
  const { createDockerTools } = await import('./docker-tools.js');
  const { createKubernetesTools } = await import('./kubernetes-tools.js');
  const { createGitTools } = await import('./git-tools.js');
  const { createMiscTools } = await import('./misc-tools.js');
  const { createProcessTools } = await import('./process-tools.js');
  const { createKnowledgeTools } = await import('./knowledge-tools.js');
  const { createScriptTools } = await import('./script-tools.js');
  const { createPlanTools } = await import('./plan-tools.js');
  const { createAttentionTools } = await import('./attention-tools.js');
  const { createAliasTools } = await import('./tool-aliases.js');
  const { createLessonsTools } = await import('./lessons-tools.js');
  const { createMultimodalTools } = await import('./multimodal-tools.js');
  const { createAdvancedTools } = await import('./advanced-tools.js');

  const primaryTools: ITool[] = [
    ...createTextEditorTools(),
    ...createBashTools(),
    ...createSearchTools(),
    ...createWebTools(),
    ...createTodoTools(),
    ...createDockerTools(),
    ...createKubernetesTools(),
    ...createGitTools(),
    ...createMiscTools(),
    ...createProcessTools(),
    ...createKnowledgeTools(),
    ...createScriptTools(),
    ...createPlanTools(),
    ...createAttentionTools(),
    ...createLessonsTools(),
    ...createMultimodalTools(),
    ...createAdvancedTools(),
  ];

  // Register backward-compat canonical-prefix aliases (shell_exec, file_read, etc.)
  const aliasTools = createAliasTools(primaryTools);

  return [...primaryTools, ...aliasTools];
}

// Import ITool type for return type
import type { ITool } from './types.js';
