/**
 * Interactive dispatch surface — the single list of ITool adapters that
 * ToolHandler registers into the FormalToolRegistry for interactive chat.
 *
 * Extracted from ToolHandler.initializeRegistry() so the list is testable:
 * tests/tools/tool-surface.test.ts asserts the invariant
 * `interactive dispatch ⊇ LLM exposition` against this exact list, plus a
 * committed baseline of the exposed surface (jarvis-OS-style snapshot gate).
 * The 2026-07-04 interconnection audit found whole tool groups exposed to the
 * LLM but resolving to "Unknown tool" in interactive chat — every entry here
 * exists to keep that class of drift impossible to reintroduce silently.
 *
 * Notes carried over from the ToolHandler wiring history:
 * - tool_search is FIRST-CLASS: the progressive-disclosure escape hatch must
 *   be dispatchable, or alwaysInclude('tool_search') silently adds nothing.
 * - Integration/messaging/security adapters (kanban/discord/spotify/…) once
 *   lived only in the headless registry; interactive calls resolved to
 *   "Unknown tool". All factories are inert at mount (constructors only store
 *   options; no I/O without credentials).
 * - AUTHORED_EXTRA_TOOLS and register_tool (self-improvement, opt-in) must
 *   stay in lockstep with their exposition in src/codebuddy/tools.ts.
 */

import {
  createTextEditorTools,
  createBashTools,
  createLsTools,
  createSelfDescribeTools,
  createRemindTools,
  createSearchTools,
  createWebTools,
  createResearchTools,
  createMeetingTools,
  createComfyRecipeTools,
  createTodoTools,
  createCronjobTools,
  createDockerTools,
  createKubernetesTools,
  createGitTools,
  createMiscTools,
  createBrowserTools,
  createProcessTools,
  createVisionTools,
  createScriptTools,
  createCodeExecTools,
  createPlanTools,
  createKnowledgeTools,
  createRelationshipIntelligenceTools,
  createInternetScoutTools,
  createLeadScoutTools,
  createBrowserOperatorTools,
  createWindowsTools,
  createMemoryTools,
  createParallelTools,
  createAttentionTools,
  createSkillsInspectionTools,
  createLessonsTools,
  createUserModelTools,
  createAliasTools,
  createMultimodalTools,
  createAdvancedTools,
  createCanvasTools,
  createLspTools,
  createMergeConflictTools,
  createVulnScannerTools,
  createCodebaseReplaceTools,
  createAdvisorTools,
  createVerifyTools,
  createFleetTools,
  createAskUserQuestionTools,
  createExitPlanModeTools,
  createGuiTools,
  createSessionTools,
  createCodeExplorerTools,
  createScreenpipeTools,
  createKanbanTools,
  createSendMessageTools,
  createDiscordTools,
  createHomeAssistantTools,
  createFeishuTools,
  createYuanbaoTools,
  createMixtureOfAgentsTools,
  createSpotifyTools,
  createXSearchTools,
  createSecretsTools,
  createFirecrawlTools,
  createBugFinderTools,
  createDocumentGeneratorTools,
  createDelegateAgentTools,
} from './index.js';
import type { ITool } from './types.js';
import { createAuthoredExtraTools } from './authored-extra-tools.js';
import { createExtensionForgeTools } from '../extension-forge-tool.js';
import { createRegisterToolTool } from '../register-tool-handler.js';
import { ToolSearchTool } from '../tool-search.js';

export interface InteractiveAdapterOptions {
  /** Include the Windows-only tools. Default: `process.platform === 'win32'`. */
  includeWindowsTools?: boolean;
  /** Include register_tool (self-improvement). Default: `CODEBUDDY_SELF_IMPROVE === 'true'`. */
  includeSelfImproveTools?: boolean;
}

/**
 * Build the complete interactive dispatch list (base adapters + canonical
 * aliases), exactly as ToolHandler registers it. Pure construction — no
 * registry mutation, no I/O.
 */
export function createInteractiveToolAdapters(options: InteractiveAdapterOptions = {}): ITool[] {
  const includeWindows = options.includeWindowsTools ?? process.platform === 'win32';
  const includeSelfImprove =
    options.includeSelfImproveTools ?? process.env.CODEBUDDY_SELF_IMPROVE === 'true';

  const allTools: ITool[] = [
    new ToolSearchTool(),
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
    ...(includeWindows ? createWindowsTools() : []),
    ...createMemoryTools(),
    ...createParallelTools(),
    ...createAttentionTools(),
    ...createSkillsInspectionTools(),
    ...createLessonsTools(),
    ...createUserModelTools(),
    ...createMultimodalTools(),
    ...createAdvancedTools(),
    ...createCanvasTools(),
    ...createLspTools(),
    ...createMergeConflictTools(),
    ...createVulnScannerTools(),
    ...createCodebaseReplaceTools(),
    ...createAdvisorTools(),
    ...createVerifyTools(),
    ...createFleetTools(),
    ...createAskUserQuestionTools(),
    ...createExitPlanModeTools(),
    ...createGuiTools(),
    ...createSessionTools(),
    ...createCodeExplorerTools(),
    ...createScreenpipeTools(),
    ...createKanbanTools(),
    ...createSendMessageTools(),
    ...createDiscordTools(),
    ...createHomeAssistantTools(),
    ...createFeishuTools(),
    ...createYuanbaoTools(),
    ...createMixtureOfAgentsTools(),
    ...createSpotifyTools(),
    ...createXSearchTools(),
    ...createSecretsTools(),
    ...createFirecrawlTools(),
    ...createBugFinderTools(),
    ...createDocumentGeneratorTools(),
    ...createDelegateAgentTools(),
    ...createExtensionForgeTools(),
    ...createAuthoredExtraTools(),
    ...(includeSelfImprove ? [createRegisterToolTool()] : []),
  ];

  // Canonical-prefix alias tools (shell_exec→bash, file_read→view_file, …).
  allTools.push(...createAliasTools(allTools));

  return allTools;
}
