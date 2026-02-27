/**
 * Prompt Builder Service
 *
 * Handles the construction of system prompts for the agent,
 * supporting various modes (standard, YOLO, custom) and
 * integrating external Markdown prompts.
 *
 * Moltbot Integration:
 * - Loads intro_hook.txt content and prepends to system prompt
 * - Supports project-level and global intro hooks
 */

import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../errors/index.js";
import {
  getSystemPromptForMode,
  getPromptManager,
  autoSelectPromptId,
} from "../prompts/index.js";
import { EnhancedMemory } from "../memory/index.js";
import { PromptCacheManager } from "../optimization/prompt-cache.js";
import { MoltbotHooksManager } from "../hooks/moltbot-hooks.js";
import { getModelToolConfig } from "../config/model-tools.js";

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
    private memory?: EnhancedMemory,
    private moltbotHooksManager?: MoltbotHooksManager
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

      // Load Moltbot intro hook content (role/personality instructions)
      let introHookContent: string | undefined;
      if (this.moltbotHooksManager) {
        try {
          const introManager = this.moltbotHooksManager.getIntroManager();
          const introResult = await introManager.loadIntro();
          if (introResult.content) {
            introHookContent = introResult.content;
            logger.debug(`Loaded intro hook from sources: ${introResult.sources.join(', ')}`);
          }
        } catch (err) {
          logger.warn("Failed to load intro hook", { error: getErrorMessage(err) });
        }
      }

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

      // Prepend intro hook content if available (Moltbot-style role injection)
      if (introHookContent) {
        systemPrompt = `# Role & Instructions (from intro_hook.txt)\n\n${introHookContent}\n\n---\n\n${systemPrompt}`;
        logger.debug("Prepended intro hook content to system prompt");
      }

      // Inject bootstrap context files (BOOTSTRAP.md, AGENTS.md, SOUL.md, etc.)
      try {
        const { BootstrapLoader } = await import('../context/bootstrap-loader.js');
        const bootstrap = await new BootstrapLoader().load(this.config.cwd);
        if (bootstrap.content) {
          systemPrompt += '\n\n# Workspace Context\n\n' + bootstrap.content;
          logger.debug(`Loaded bootstrap context from ${bootstrap.sources.length} file(s)`, {
            sources: bootstrap.sources,
            chars: bootstrap.tokenCount,
            truncated: bootstrap.truncated,
          });
        }
      } catch (err) {
        logger.warn("Failed to load bootstrap context", { error: getErrorMessage(err) });
      }

      // Inject active persona instructions
      try {
        const { getPersonaManager } = await import('../personas/persona-manager.js');
        const personaBlock = getPersonaManager().buildSystemPrompt();
        if (personaBlock) {
          systemPrompt += `\n\n<persona>\n${personaBlock}\n</persona>`;
          logger.debug('Injected active persona into system prompt');
        }
      } catch { /* personas module optional */ }

      // Inject knowledge base context
      try {
        const { getKnowledgeManager } = await import('../knowledge/knowledge-manager.js');
        const km = getKnowledgeManager();
        if (!km.isLoaded) {
          await km.load();
        }
        const knowledgeBlock = km.buildContextBlock();
        if (knowledgeBlock) {
          systemPrompt += `\n\n<knowledge>\n${knowledgeBlock}\n</knowledge>`;
          logger.debug('Injected knowledge base into system prompt');
        }
      } catch { /* knowledge module optional */ }

      // Inject modular rules (.codebuddy/rules/)
      try {
        const { getRulesLoader } = await import('../rules/rules-loader.js');
        const rulesLoader = getRulesLoader();
        if (!rulesLoader.isLoaded) {
          await rulesLoader.load();
        }
        const rulesBlock = rulesLoader.buildContextBlock();
        if (rulesBlock) {
          systemPrompt += `\n\n<rules>\n${rulesBlock}\n</rules>`;
          logger.debug('Injected modular rules into system prompt');
        }
      } catch { /* rules module optional */ }

      // Inject active skill prompt enhancement
      try {
        const { getSkillManager } = await import('../skills/index.js');
        const skillManager = getSkillManager();
        const skillBlock = skillManager.getSkillPromptEnhancement();
        if (skillBlock) {
          systemPrompt += `\n\n${skillBlock}`;
          logger.debug('Injected active skill enhancement into system prompt');
        }
      } catch { /* skills module optional */ }

      // Inject identity (SOUL.md, USER.md, AGENTS.md)
      try {
        const { getIdentityManager } = await import('../identity/identity-manager.js');
        const identityMgr = getIdentityManager();
        await identityMgr.load(process.cwd());
        const identityBlock = identityMgr.getPromptInjection();
        if (identityBlock) {
          systemPrompt += `\n\n<identity>\n${identityBlock}\n</identity>`;
          logger.debug('Injected identity into system prompt');
        }
      } catch { /* identity module optional */ }

      // Inject auto-detected coding style conventions
      try {
        const { getCodingStyleAnalyzer } = await import('../memory/coding-style-analyzer.js');
        const analyzer = getCodingStyleAnalyzer();
        const profile = await analyzer.analyzeDirectory(this.config.cwd);
        if (profile) {
          const styleBlock = analyzer.buildPromptSnippet(profile);
          if (styleBlock) {
            systemPrompt += `\n\n${styleBlock}`;
            logger.debug('Injected coding style conventions into system prompt');
          }
        }
      } catch { /* coding-style module optional */ }

      // Inject workflow orchestration rules (concrete plan triggers, verification contract, etc.)
      try {
        const { getWorkflowRulesBlock } = await import('../prompts/workflow-rules.js');
        systemPrompt += '\n\n' + getWorkflowRulesBlock();
        logger.debug('Injected workflow orchestration rules into system prompt');
      } catch (err) {
        logger.warn('Failed to inject workflow rules', { error: getErrorMessage(err) });
      }

      // Manus AI structured variation — shuffle reminder blocks to prevent
      // the model from falling into brittle repetition patterns.
      // Only the footer guideline section is varied; the preamble/tools are left
      // untouched so prompt caching remains effective on the stable prefix.
      try {
        const { varySystemPrompt } = await import('../prompts/variation-injector.js');
        // Use a daily seed so the variation is stable within a single day
        // (same day → same order → consistent cache), but rotates across days.
        const daySeed = Math.floor(Date.now() / 86_400_000);
        systemPrompt = varySystemPrompt(systemPrompt, {
          seed: daySeed,
          shuffleOrder: true,
          alternativePhrasing: true,
          variationRate: 0.3,
        });
      } catch {
        // non-critical — proceed with original prompt
      }

      // Truncate system prompt if it exceeds the model's context budget.
      // Reserve 50% of (contextWindow - maxOutputTokens) for the system prompt;
      // the rest goes to conversation history. Simple head-truncation keeps the
      // most critical instructions (always at the top) intact.
      const toolConfig = getModelToolConfig(modelName);
      const contextWindow = toolConfig.contextWindow ?? 8192;
      const maxOutputTokens = toolConfig.maxOutputTokens ?? 2048;
      const budgetTokens = Math.floor((contextWindow - maxOutputTokens) * 0.5);
      const budgetChars = budgetTokens * 4; // ~4 chars per token
      if (systemPrompt.length > budgetChars) {
        logger.warn(`System prompt truncated for ${modelName}: ${systemPrompt.length} chars → ${budgetChars} (budget: ${budgetTokens} tokens)`);
        systemPrompt = systemPrompt.slice(0, budgetChars - 3) + '...';
      }

      // Cache system prompt for optimization
      this.promptCacheManager.cacheSystemPrompt(systemPrompt);

      // Store stable/dynamic split for cache-breakpoint injection (Manus AI #11/#20)
      try {
        const { buildStableDynamicSplit } = await import('../optimization/cache-breakpoints.js');
        const split = buildStableDynamicSplit(systemPrompt);
        // The split is used by the client to inject cache_control breakpoints.
        // Attach it to the PromptCacheManager for inspection if needed.
        (this.promptCacheManager as unknown as Record<string, unknown>)._stableDynamicSplit = split;
      } catch { /* non-critical */ }

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
