/**
 * Prompt Builder Service
 *
 * Handles the construction of system prompts for the agent,
 * supporting various modes (standard, YOLO, custom) and
 * integrating external Markdown prompts.
 */

import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../types/errors.js";
import {
  getSystemPromptForMode,
  getPromptManager,
  autoSelectPromptId,
} from "../prompts/index.js";
import { EnhancedMemory } from "../memory/index.js";
import { PromptCacheManager } from "../optimization/prompt-cache.js";

export interface PromptBuilderConfig {
  yoloMode: boolean;
  memoryEnabled: boolean;
  morphEditorEnabled: boolean;
  cwd: string;
}

export class PromptBuilder {
  constructor(
    private config: PromptBuilderConfig,
    private promptCacheManager: PromptCacheManager,
    private memory?: EnhancedMemory
  ) {}

  /**
   * Build the system prompt for the agent
   */
  async buildSystemPrompt(
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null
  ): Promise<string> {
    try {
      let systemPrompt: string;

      // Get memory context if enabled
      let memoryContext: string | undefined;
      if (this.config.memoryEnabled && this.memory) {
        try {
          memoryContext = await this.memory.buildContext({
            includeProject: true,
            includePreferences: true,
            includeRecentSummaries: true
          });
        } catch (err) {
          logger.warn("Failed to build memory context", { error: getErrorMessage(err) });
        }
      }

      if (systemPromptId && systemPromptId !== 'auto') {
        // Use external prompt system (new)
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: systemPromptId,
          includeModelInfo: true,
          includeOsInfo: true,
          includeProjectContext: false, // Don't include by default (expensive)
          includeToolPrompts: true,
          userInstructions: customInstructions || undefined,
          cwd: this.config.cwd,
          modelName,
          tools: ['view_file', 'str_replace_editor', 'create_file', 'search', 'bash', 'todo', 'reason'],
          includeMemory: !!memoryContext,
          memoryContext,
        });
        logger.debug(`Using system prompt: ${systemPromptId}`);
      } else if (systemPromptId === 'auto') {
        // Auto-select based on model alignment
        const autoId = autoSelectPromptId(modelName);
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: autoId,
          includeModelInfo: true,
          includeOsInfo: true,
          userInstructions: customInstructions || undefined,
          cwd: this.config.cwd,
          modelName,
          includeMemory: !!memoryContext,
          memoryContext,
        });
        logger.debug(`Auto-selected prompt: ${autoId} (based on ${modelName})`);
      } else {
        // Use legacy system (current behavior)
        const promptMode = this.config.yoloMode ? "yolo" : "default";
        systemPrompt = getSystemPromptForMode(
          promptMode,
          this.config.morphEditorEnabled,
          this.config.cwd,
          customInstructions || undefined
        );
      }

      // Cache system prompt for optimization
      this.promptCacheManager.cacheSystemPrompt(systemPrompt);

      return systemPrompt;
    } catch (error) {
      // Fallback to legacy prompt on error
      logger.warn("Failed to load custom prompt, using default", { error: getErrorMessage(error) });
      const promptMode = this.config.yoloMode ? "yolo" : "default";
      return getSystemPromptForMode(
        promptMode,
        this.config.morphEditorEnabled,
        this.config.cwd,
        customInstructions || undefined
      );
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PromptBuilderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
