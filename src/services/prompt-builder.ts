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
  getChatOnlySystemPrompt,
} from "../prompts/index.js";
import { EnhancedMemory, PersistentMemoryManager } from "../memory/index.js";
import { PromptCacheManager } from "../optimization/prompt-cache.js";
import { MoltbotHooksManager } from "../hooks/moltbot-hooks.js";
import { getModelToolConfig } from "../config/model-tools.js";
import { resolveProjectContext, createContextRegistry, setActiveContextRegistry, type ContextRegistry } from "../context/project-context.js";
import { classifyQuery, type QueryComplexity } from "../agent/execution/query-classifier.js";
import {
  filterToolNames,
  getToolFilter,
  isToolNameAllowed,
  type ToolFilterConfig,
} from "../utils/tool-filter.js";

export interface PromptBuilderConfig {
  yoloMode: boolean;
  memoryEnabled: boolean;
  morphEditorEnabled: boolean;
  cwd: string;
}

/**
 * Per-block gating options for `buildSystemPrompt()`. All flags default
 * to `true` (preserves V1.0 behavior). `buildForQuery()` derives a custom
 * set from query complexity + model `promptProfile`.
 */
export interface BuildOptions {
  includeBootstrap?: boolean;
  includePersona?: boolean;
  includeKnowledge?: boolean;
  includeProjectDocs?: boolean;
  includeRules?: boolean;
  includeSkills?: boolean;
  includeIdentity?: boolean;
  includeFleet?: boolean;
  includeMemoryDirective?: boolean;
  includeLessonsDirective?: boolean;
  includeUserModelDirective?: boolean;
  includeWritingRules?: boolean;
  includeCodingStyle?: boolean;
  includeWorkflowRules?: boolean;
  includeExecutionDiscipline?: boolean;
  includeVariation?: boolean;
}

const ALL_BLOCKS: Required<BuildOptions> = {
  includeBootstrap: true,
  includePersona: true,
  includeKnowledge: true,
  includeProjectDocs: true,
  includeRules: true,
  includeSkills: true,
  includeIdentity: true,
  includeFleet: true,
  includeMemoryDirective: true,
  includeLessonsDirective: true,
  includeUserModelDirective: true,
  includeWritingRules: true,
  includeCodingStyle: true,
  includeWorkflowRules: true,
  includeExecutionDiscipline: true,
  includeVariation: true,
};

const EXTERNAL_PROMPT_MANAGER_TOOLS = [
  'view_file',
  'str_replace_editor',
  'create_file',
  'search',
  'bash',
  'todo',
  'reason',
] as const;

function hasActiveToolFilter(config: ToolFilterConfig): boolean {
  return config.enabledPatterns.length > 0 || config.disabledPatterns.length > 0;
}

function buildActiveToolFilterDirective(config: ToolFilterConfig): string | null {
  if (!hasActiveToolFilter(config)) {
    return null;
  }

  const enabled = config.enabledPatterns.length > 0 ? config.enabledPatterns.join(', ') : 'all';
  const disabled = config.disabledPatterns.length > 0 ? config.disabledPatterns.join(', ') : 'none';

  return `<active_tool_filter>
The actual model-facing tool schema for this turn has an active filter.
- Enabled patterns: ${enabled}
- Disabled patterns: ${disabled}
- Trust the schema over generic prompt text. If a tool name appears elsewhere in this prompt but is absent from the schema, that instruction is inactive.
- Do not claim unavailable tools exist, suggest calling them, or emit calls for them.
</active_tool_filter>`;
}

export class PromptBuilder {
  /**
   * Dedup registry for project-instruction files, recreated fresh at the start
   * of each system-prompt build. The JIT context pass reads it (via
   * `getContextRegistry()`) so files already injected at startup are not
   * re-injected when a tool later touches a file in the same tree.
   */
  private contextRegistry: ContextRegistry | null = null;

  constructor(
    private config: PromptBuilderConfig,
    private promptCacheManager: PromptCacheManager,
    private memory?: EnhancedMemory,
    private moltbotHooksManager?: MoltbotHooksManager,
    private persistentMemory?: PersistentMemoryManager
  ) {}

  /** The registry from the most recent system-prompt build (for the JIT pass). */
  getContextRegistry(): ContextRegistry | null {
    return this.contextRegistry;
  }

  /**
   * Build the system prompt for the agent. The optional `options`
   * parameter gates per-block injection. All gates default to `true`
   * so existing callers see V1.0 behavior unchanged.
   */
  async buildSystemPrompt(
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null,
    options?: BuildOptions
  ): Promise<string> {
    const gates: Required<BuildOptions> = { ...ALL_BLOCKS, ...options };
    // When the model can't actually call tools (Ollama small/medium without
    // OpenAI tool_calls support), the auto-memory + lessons directives just
    // confuse the LLM into hallucinating JSON tool calls. Force-off here.
    const toolCfg = getModelToolConfig(modelName);
    const activeToolFilter = getToolFilter();
    const forceTools = process.env.GROK_FORCE_TOOLS === 'true';
    if (toolCfg.supportsToolCalls === false && !forceTools) {
      gates.includeMemoryDirective = false;
      gates.includeLessonsDirective = false;
      gates.includeUserModelDirective = false;
      gates.includeWorkflowRules = false;
      gates.includeExecutionDiscipline = false;
    }
    const rememberToolAllowed = isToolNameAllowed('remember', activeToolFilter);
    const memoryProposeToolAllowed = isToolNameAllowed('memory_propose', activeToolFilter);
    if (!rememberToolAllowed && !memoryProposeToolAllowed) {
      gates.includeMemoryDirective = false;
    }
    if (!['lessons_add', 'lessons_search', 'lessons_graph'].every(toolName =>
      isToolNameAllowed(toolName, activeToolFilter)
    )) {
      gates.includeLessonsDirective = false;
    }
    if (!isToolNameAllowed('user_model_observe', activeToolFilter)) {
      gates.includeUserModelDirective = false;
    }
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
      if (this.config.memoryEnabled) {
        let enhancedMemoryContext = "";
        if (this.memory) {
          try {
            enhancedMemoryContext = await this.memory.buildContext({
              includeProject: true,
              includePreferences: true,
              includeRecentSummaries: true
            });
          } catch (err) {
            logger.warn("Failed to build enhanced memory context", { error: getErrorMessage(err) });
          }
        }

        let persistentMemoryContext = "";
        if (this.persistentMemory) {
          try {
            // CodeBuddyAgent fires `initializeMemory()` without awaiting,
            // so the in-memory Maps may still be empty when this builder
            // runs on the user's first message after launch. Force-await
            // initialize() (idempotent — the manager has its own initPromise
            // gate) so the user-scoped persistent memory is actually loaded
            // from ~/.codebuddy/memory.md before we read it.
            const pmAny = this.persistentMemory as unknown as { initialize?: () => Promise<void> };
            if (typeof pmAny.initialize === 'function') {
              await pmAny.initialize();
            }
            persistentMemoryContext = this.persistentMemory.getContextForPrompt();
          } catch (err) {
            logger.warn("Failed to build persistent memory context", { error: getErrorMessage(err) });
          }
        }

        memoryContext = (enhancedMemoryContext + "\n" + persistentMemoryContext).trim();
        if (!memoryContext) memoryContext = undefined;
      }

      if (systemPromptId && systemPromptId !== 'auto') {
        // Use external prompt system (new)
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: systemPromptId,
          includeModelInfo: true,
          includeOsInfo: true,
          includeProjectContext: true, // Codex CLI pattern: git state in system prompt
          includeToolPrompts: true,
          userInstructions: customInstructions || undefined,
          cwd: this.config.cwd,
          modelName,
          tools: filterToolNames(EXTERNAL_PROMPT_MANAGER_TOOLS, activeToolFilter),
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
      } else if (toolCfg.supportsToolCalls === false && !forceTools) {
        // Chat-only base prompt for models that can't dispatch tool calls.
        // The default body lists `bash`, `view_file`, `str_replace_editor`,
        // etc. by name — small Ollama models read those mentions and try to
        // emit JSON tool calls that we can't dispatch. Swap to the
        // tool-less FR-default chat prompt instead.
        systemPrompt = getChatOnlySystemPrompt(
          this.config.cwd,
          customInstructions || undefined,
        );
        logger.debug(
          `[prompt-builder] Using chat-only base prompt for ${modelName} (supportsToolCalls=false)`,
        );
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

      // Inject persistent memory context for paths that don't already
      // pass it to a PromptManager (legacy + chat-only). Without this,
      // the user's `remember`-stored facts (~/.codebuddy/memory.md)
      // never reach the LLM on session restart, so e.g. the saved
      // first name appears written to disk but the next session asks
      // "what's your name?" anyway. The `if (systemPromptId ...)` and
      // `else if (systemPromptId === 'auto')` branches above already
      // forward `memoryContext` via `promptManager.buildSystemPrompt({
      // memoryContext })`, so we skip injection there.
      const wentThroughPromptManager =
        (systemPromptId && systemPromptId !== 'auto') || systemPromptId === 'auto';
      if (memoryContext && !wentThroughPromptManager) {
        systemPrompt += `\n\n<persistent_memory>\n${memoryContext}\n</persistent_memory>`;
        logger.debug('Injected persistent memory context into system prompt', {
          chars: memoryContext.length,
        });
      }

      // Prepend intro hook content if available (Moltbot-style role injection)
      if (introHookContent) {
        systemPrompt = `# Role & Instructions (from intro_hook.txt)\n\n${introHookContent}\n\n---\n\n${systemPrompt}`;
        logger.debug("Prepended intro hook content to system prompt");
      }

      // Inject execution-discipline guidance (tool-use enforcement, anti-stub
      // completion, mandatory-tool, pre-finalize self-check). Borrowed from the
      // Hermes Agent prompt audit — its highest-leverage agentic-reliability
      // block. Placed HERE in the STABLE PREFIX (not near the footer) on
      // purpose: the footer reminder section is shuffled by the variation
      // injector (varySystemPrompt → extractBlocks splits on bullet lines), so
      // a late placement fragmented this block — foreign bullets got interleaved
      // between its lines. Up here it stays contiguous, cache-stable, and
      // survives head-truncation. Gated off for trivial/lite + tool-callless
      // models (see gating above).
      if (gates.includeExecutionDiscipline) {
        try {
          const { getExecutionDisciplineBlock } = await import('../prompts/execution-discipline.js');
          systemPrompt += '\n\n' + getExecutionDisciplineBlock();
          logger.debug('Injected execution-discipline guidance into system prompt');
        } catch (err) {
          logger.warn('Failed to inject execution-discipline block', { error: getErrorMessage(err) });
        }
      }

      // Inject project-instruction context (AGENTS.md / CODEBUDDY.md / CLAUDE.md
      // / GEMINI.md / CONTEXT.md / INSTRUCTIONS.md) via the unified hierarchical
      // loader, then soul/bootstrap files. A fresh dedup registry is created per
      // build and reused by the JIT pass (`getContextRegistry`).
      if (gates.includeBootstrap) {
        this.contextRegistry = createContextRegistry();
        // Publish for the JIT pass so it skips files injected here at startup.
        setActiveContextRegistry(this.contextRegistry);
        try {
          const ctx = resolveProjectContext({ cwd: this.config.cwd, registry: this.contextRegistry });
          if (ctx.text) {
            systemPrompt += '\n\n# Workspace Context\n\n' + ctx.text;
            logger.debug(`Loaded project context from ${ctx.sources.length} file(s)`, {
              sources: ctx.sources.map((s) => s.relPath),
              chars: ctx.bytes,
              truncated: ctx.truncated,
            });
          }
        } catch (err) {
          logger.warn("Failed to load project context", { error: getErrorMessage(err) });
        }

        // Soul/identity bootstrap files (SOUL.md, USER.md, …) + PROJECT_KNOWLEDGE.md.
        // Instruction files are handled above by the unified loader, not here.
        try {
          const { BootstrapLoader } = await import('../context/bootstrap-loader.js');
          const bootstrap = await new BootstrapLoader().load(this.config.cwd);
          if (bootstrap.content) {
            systemPrompt += '\n\n' + bootstrap.content;
            logger.debug(`Loaded bootstrap/soul context from ${bootstrap.sources.length} file(s)`);
          }
        } catch (err) {
          logger.warn("Failed to load bootstrap context", { error: getErrorMessage(err) });
        }
      }

      // Inject active persona instructions
      if (gates.includePersona) {
        try {
          const { getPersonaManager } = await import('../personas/persona-manager.js');
          const personaBlock = getPersonaManager().buildSystemPrompt();
          if (personaBlock) {
            systemPrompt += `\n\n<persona>\n${personaBlock}\n</persona>`;
            logger.debug('Injected active persona into system prompt');
          }
        } catch { /* personas module optional */ }
      }

      // Inject knowledge base context
      if (gates.includeKnowledge) {
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
      }

      // Inject generated documentation architecture summary
      if (gates.includeProjectDocs) {
        try {
          const { getDocsContextProvider } = await import('../docs/docs-context-provider.js');
          const docsProvider = getDocsContextProvider();
          if (!docsProvider.isLoaded) {
            await docsProvider.loadDocsIndex();
          }
          const architectureSummary = docsProvider.getArchitectureSummary();
          if (architectureSummary) {
            systemPrompt += `\n\n<project_docs>\n${architectureSummary}\n</project_docs>`;
          }
        } catch { /* docs context module optional */ }
      }

      // Inject modular rules (.codebuddy/rules/)
      if (gates.includeRules) {
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
      }

      // Steer toward Code Explorer (code-explorer) when it is connected. Conditional:
      // when Code Explorer is absent this injects nothing, so the built-in
      // code_graph/codebase_map behaviour is unchanged. Presence is session-
      // stable, so this stays in the cache-stable prefix.
      try {
        const { codeExplorerToolPrefix } = await import('../codebuddy/tools.js');
        const p = codeExplorerToolPrefix(); // 'mcp__code-explorer__' | 'mcp__gitnexus__' | null
        if (p) {
          // Best-effort staleness check: warn the agent when the index lags HEAD
          // so it doesn't silently reason over an out-of-date graph.
          let staleNote = '';
          try {
            const { getCodeExplorerManager } = await import('../plugins/code-explorer/CodeExplorerManager.js');
            const fresh = getCodeExplorerManager(this.config.cwd).getFreshness();
            if (fresh.stale) {
              const behind =
                fresh.commitsBehind !== undefined ? `${fresh.commitsBehind} commit(s)` : 'some commits';
              staleNote =
                `\n⚠️ The Code Explorer index is STALE — built at commit ${fresh.lastCommit?.slice(0, 8) ?? '?'}, ` +
                `now ${behind} behind HEAD. Its answers may miss recent code; treat relationship results as ` +
                `approximate and suggest re-running \`code-explorer analyze --incremental\` if they look wrong.`;
            }
          } catch { /* freshness best-effort */ }
          systemPrompt +=
            `\n\n<code_explorer_priority>\n` +
            `Code Explorer is connected. For ANY question about code relationships — ` +
            `callers/callees, blast radius / impact ("what breaks if I change X"), dead code, cycles, ` +
            `coupling, complexity — PREFER its MCP tools (\`${p}impact\`, ` +
            `\`${p}context\`, \`${p}query\`, \`${p}find_cycles\`, …) ` +
            `over the built-in \`code_graph\` / \`codebase_map\`: the Code Explorer graph is broader and more ` +
            `complete (whole-repo, 14 languages).\n` +
            `Usage: first call \`${p}list_repos\` once to get the repo \`path\`/\`id\`, then call ` +
            `\`${p}impact\` with the REQUIRED \`target\` = the symbol name (e.g. \`target: "executePlan"\`, ` +
            `optionally \`direction: "both"\`) and \`repo\` = that path; or \`${p}context\` with \`name\` = ` +
            `the symbol. Always include \`target\`/\`name\` — never call these tools with empty arguments. ` +
            `Use the built-in \`code_graph\`/\`codebase_map\` only as a fallback if it errors.` +
            staleNote +
            `\n</code_explorer_priority>`;
          logger.debug('Injected Code Explorer priority directive');
        }
      } catch { /* tools module optional */ }

      // Inject active skill prompt enhancement
      if (gates.includeSkills) {
        try {
          const { getSkillManager } = await import('../skills/index.js');
          const skillManager = getSkillManager();
          const skillBlock = skillManager.getSkillPromptEnhancement();
          if (skillBlock) {
            systemPrompt += `\n\n${skillBlock}`;
            logger.debug('Injected active skill enhancement into system prompt');
          }
        } catch { /* skills module optional */ }
      }

      // Inject identity (SOUL.md, USER.md, …) — skip if already present to avoid duplication.
      // AGENTS.md/INSTRUCTIONS.md are owned by the unified loader, not identity.
      if (gates.includeIdentity) {
        try {
          if (!systemPrompt.includes('## SOUL.md')) {
            const { getIdentityManager } = await import('../identity/identity-manager.js');
            const identityMgr = getIdentityManager();
            await identityMgr.load(this.config.cwd);
            const identityBlock = identityMgr.getPromptInjection();
            if (identityBlock) {
              systemPrompt += `\n\n<identity>\n${identityBlock}\n</identity>`;
              logger.debug('Injected identity into system prompt');
            }
          }
        } catch { /* identity module optional */ }
      }

      // Fleet peer nudge (Phase (d).17) — one line when peers are connected,
      // so the LLM knows it can autonomously delegate via list_peers + peer_delegate.
      // Zero token cost when no peers (block omitted entirely).
      if (gates.includeFleet) {
        try {
          const { getFleetRegistry } = await import('../fleet/fleet-registry.js');
          const peerCount = getFleetRegistry().size();
          if (peerCount > 0) {
            const {
              FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT,
            } = await import('../fleet/dispatch-profile.js');
            systemPrompt +=
              `\n\n<fleet>Connected fleet peers: ${peerCount}. ` +
              `Use route_peer to choose the best peer/model for a task, ` +
              `pass dispatchProfile when the task has a clear posture ` +
              `(research, code, review, safe, or balanced), ` +
              `using this guide: ${FLEET_DISPATCH_PROFILE_GUIDANCE_TEXT}. ` +
              `list_peers({includeCapabilities:true}) when you need raw ` +
              `provider status, or list_peers() for a quick status. Then ` +
              `peer_delegate can ask the chosen peer a question; reuse the ` +
              `dispatchProfile returned by route_peer so the peer receives ` +
              `matching guidance. For ordered specialist collaboration, pass ` +
              `chainRoles such as ["code","review","safe"] to route_peer and ` +
              `then run the returned nextCalls in order, or call peer_chain ` +
              `to route and execute the chain with stage handoffs. The peer answers ` +
              `independently with its own model and the response is fed back ` +
              `into your context. Useful for delegating heavy compute, asking a ` +
              `peer with different domain knowledge, or coordinating across ` +
              `hosts.</fleet>`;
            logger.debug(`Injected fleet nudge into system prompt (${peerCount} peer(s))`);
          }
        } catch { /* fleet registry optional — module not loaded yet */ }
      }

      // Inject auto-memory directive — tells the LLM WHEN to call `remember`
      // or the review-gated `memory_propose` tool for non-obvious facts from
      // .codebuddy/CODEBUDDY_MEMORY.md (project) or ~/.codebuddy/memory.md
      // (user). Without this directive, the tool is registered but the LLM
      // has no instruction on when to use it, so the file stays empty.
      // Paired with `alwaysInclude: ['remember', 'memory_propose']` in
      // tool-selection-strategy.
      if (this.config.memoryEnabled && this.persistentMemory && gates.includeMemoryDirective) {
        const memoryWriteInstruction = memoryProposeToolAllowed
          ? 'Use `remember` only for explicit, high-confidence durable facts. Use `memory_propose` for inferred, ambiguous, or model-derived facts so the user can review them before they become prompt-injected memory.'
          : 'Use `remember` only for explicit, high-confidence durable facts. Do not store inferred or ambiguous facts silently.';
        const inferredFactInstruction = memoryProposeToolAllowed
          ? 'When to call `memory_propose`:'
          : 'When to consider durable memory, but skip if it is only inferred or ambiguous:';
        const closingMemoryInstruction = memoryProposeToolAllowed
          ? 'Prefer `memory_propose` over `remember` when the fact came from your interpretation rather than an explicit user instruction.'
          : 'Only call `remember` when the fact came from an explicit user instruction or correction.';
        systemPrompt += `\n\n<auto_memory_directive>
You have a persistent memory system at .codebuddy/CODEBUDDY_MEMORY.md (project-scoped) and ~/.codebuddy/memory.md (user-scoped, all projects).
${memoryWriteInstruction}

When to call \`remember\`:
- The user explicitly says to remember/store a fact or preference
- The user directly corrects an existing stable fact

${inferredFactInstruction}
- User preferences ("user prefers single quotes", "always use Vitest, not Jest")
- Architectural decisions ("API uses JWT in HttpOnly cookies, not localStorage")
- Non-obvious gotchas ("vi.hoisted() needed for mock factories in this repo")
- Project-specific conventions or constraints the user just revealed

When NOT to call \`remember\`:
- Things derivable from reading the code, git log, or package.json
- Ephemeral task details (current bug being fixed, in-progress edits)
- Information already covered by an existing memory entry

Format:
- \`key\`: short kebab-case identifier (e.g. \`test-framework\`, \`indent-style\`, \`jwt-storage\`)
- \`value\`: 1-3 sentences, factual, written for future-you in a fresh session
- \`scope\`: \`project\` (default — fact is specific to THIS repo) or \`user\` (preference across all projects)
- \`category\`: \`preferences\`, \`decisions\`, \`patterns\`, \`project\`, or \`custom\`

${closingMemoryInstruction}
</auto_memory_directive>`;
        logger.debug('Injected auto-memory directive into system prompt');
      }

      // Lessons directive — Manus AI-inspired self-improvement loop
      // (`src/agent/lessons-tracker.ts`). The LessonsTracker, lessons_add /
      // lessons_search / lessons_graph tools, and per-turn `<lessons_context>` injection
      // were all shipped — but the LLM never proactively called the tools
      // because no system directive told it WHEN. This block fixes that
      // (mirror of the auto-memory directive above).
      if (this.config.memoryEnabled && this.persistentMemory && gates.includeLessonsDirective) {
        systemPrompt += `\n\n<lessons_directive>
Code Buddy maintains a self-improvement loop via the \`lessons_add\`, \`lessons_search\`, and \`lessons_graph\` tools (Manus AI-inspired pattern). Lessons persist to .codebuddy/lessons.md (project-scoped) and ~/.codebuddy/lessons.md (global, all projects). They differ from \`remember\` by capturing actionable patterns rather than facts.

Four categories — pick the right one:
- **RULE**: invariants to follow ("Never commit .env files", "Use vi.hoisted() for mock factories in this repo")
- **PATTERN**: error corrections you observed ("If type X errors with Y, add Z annotation")
- **CONTEXT**: project-specific facts ("The auth module uses JWT in HttpOnly cookies, not localStorage")
- **INSIGHT**: non-obvious observations ("Tests are flaky on Windows due to CRLF line endings; use git config core.autocrlf=input")

When to call \`lessons_add\`:
- After the user corrects your approach — extract the rule/pattern that would have prevented the mistake
- **After completing a bug-finding / audit / code-review task** — capture the underlying pattern as a RULE or INSIGHT so the same class of bug is detectable next time (e.g. "After mutating a request body field, prefer body.* as source of truth over the original local variable")
- When you discover a project convention or gotcha not derivable from code or git log
- When you find a successful pattern you would re-apply on similar tasks
- After resolving a non-trivial debugging session — extract what was non-obvious about the root cause

When to call \`lessons_search\` (BEFORE acting on a related task):
- Before implementing a feature similar to one the user previously corrected
- Before running tests if a previous lesson noted flakiness in the area
- When the task domain matches a category — e.g. before any auth work, search "auth"

When to call \`lessons_graph\`:
- When a task touches a recurring concept and nearby lessons may be connected by wiki links, Markdown links, tags, or related metadata
- When the user asks for "linked", "nearby", "related", "mini-Obsidian", or "lesson graph" memory
- Prefer \`format: "summary"\` for normal chat, \`format: "json"\` for UI/workflow consumption, \`format: "markdown"\` for Obsidian-style index artifacts, and \`format: "mermaid"\` for visual graph artifacts
- Use \`includeKeywords: false\` when you need a cleaner graph based only on explicit links, tags, context, and related metadata

What NOT to add:
- Things derivable from code, git log, or package.json
- Ephemeral details (current bug being fixed, in-progress edit)
- Information already covered by an existing lesson — search first, dedupe via the \`id\` field

Lessons complement \`remember\`: \`remember\` stores facts (preferences, decisions); \`lessons_add\` stores actionable patterns and rules. Use whichever fits — both persist across sessions.
</lessons_directive>`;
        logger.debug('Injected lessons directive into system prompt');
      }

      // The safe extension forge is a default capability, so tool-capable
      // full-context turns get a compact description of it.
      if (gates.includeIdentity && gates.includeExecutionDiscipline) {
        try {
          const { buildSelfKnowledgeBlock } = await import('../agent/self-improvement/self-knowledge.js');
          systemPrompt += `\n\n<self_knowledge>\n${buildSelfKnowledgeBlock()}\n</self_knowledge>`;
          logger.debug('Injected self-knowledge block into system prompt');
        } catch { /* extension module optional */ }
      }

      if (this.config.memoryEnabled && gates.includeUserModelDirective) {
        systemPrompt += `\n\n<user_model_directive>
You have a persistent user model that builds a deepening profile of who you are, your traits, preferences, expertise, and working style.

When you learn something about the user that is stable across sessions (such as preferred libraries, styling choices, expertise level, or working style), you MUST use the \`user_model_observe\` tool to propose a structured observation.

Guidelines for calling \`user_model_observe\`:
- **preference**: User's choices or settings (e.g. "User prefers single quotes", "User prefers Vitest for testing").
- **trait**: General behavior or characteristics (e.g. "User values extreme code safety").
- **expertise**: User's knowledge areas (e.g. "User is highly experienced in React but new to Electron").
- **working-style**: How the user prefers to collaborate (e.g. "User prefers direct code modifications over lengthy explanations").

Important Constraints:
1. ONLY propose observations directly related to professional software development, coding preferences, and working style.
2. NEVER propose sensitive personal data (health, finance, relationship status, passwords, credentials). Any such data will be blocked by the privacy screen.
3. Observations you propose are NOT automatically added to the active model. They enter a review queue and must be accepted by the user.

Use the \`user_model_observe\` tool proactively when you learn a stable coding preference or trait.
</user_model_directive>`;
        logger.debug('Injected user model directive into system prompt');
      }

      // Inject `<writing_rules>` directive — proactive output discipline.
      if (gates.includeWritingRules) {
      // Inspired by Manus AI's structured prompt blocks pattern (gist
      // renschni/4fbc70b... May 2026 reverse-engineering). Pairs with
      // `src/utils/output-sanitizer.ts` (post-hoc strip): the sanitizer
      // is a safety net; this directive instructs the LLM BEFORE
      // generation so wasted tokens are minimized and tone/structure
      // remain consistent.
      //
      // Always-on (no `memoryEnabled` gate) — output discipline is
      // universally useful, even for sessions with no persistent memory.
      systemPrompt += `\n\n<writing_rules>
Output formatting discipline:

- Never emit model control tokens in your output: no \`<|im_start|>\`, \`<|im_end|>\`, \`<think>\`, \`<reasoning>\`, \`[INST]\`, \`<<SYS>>\`, GLM-5 full-width brackets, or any \`<|…|>\` variant. The runtime strips these as a safety net but the cost is wasted tokens.
- No zero-width characters (U+200B, U+200C, U+200D, U+FEFF) or invisible Unicode for "stylistic" effect.
- Use markdown for structure when output is rendered:
  - Code fences with language hint: \`\`\`ts not bare \`\`\`
  - Inline code with backticks for identifiers, paths, commands
  - Tables for tabular comparisons (≥3 rows make a table worth it)
  - Bold/italic sparingly — only when emphasis is load-bearing
- No emoji unless the user explicitly requested them or they convey load-bearing information (e.g. ✅/❌ status markers in a table).
- No meta-commentary about being an AI: skip "As an AI...", "I'll help you with...", "Let me explain...". Just answer.
- Tone: direct, natural, and calm. Match the user's language and register (formal ↔ casual) without caricaturing slang or adding canned enthusiasm.
- Write like an experienced teammate in an ongoing conversation: use ordinary phrasing, refer naturally to prior context, and acknowledge corrections or uncertainty briefly when relevant.
- For work that needs several tool rounds, give a short, concrete orientation before or between meaningful phases when it helps the user understand the wait. Do not narrate every obvious action.
- Avoid robotic templates and repetitive headings. Let the response structure follow the task; a simple exchange should read like a simple exchange.
- Links: markdown hyperlinks \`[label](url)\`, not raw URLs in flowing text.
- File references: use \`path/to/file.ts:42\` format so the user can navigate by click.
- When uncertain about facts, say "I don't know" rather than fabricating. When uncertain about correctness of code, mark it as untested.
</writing_rules>`;
        logger.debug('Injected writing_rules directive into system prompt');
      }

      // Inject auto-detected coding style conventions
      if (gates.includeCodingStyle) {
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
      }

      // Inject workflow orchestration rules (concrete plan triggers, verification contract, etc.)
      if (gates.includeWorkflowRules) {
        try {
          const { getWorkflowRulesBlock } = await import('../prompts/workflow-rules.js');
          systemPrompt += '\n\n' + getWorkflowRulesBlock({
            isToolAvailable: toolName => isToolNameAllowed(toolName, activeToolFilter),
          });
          logger.debug('Injected workflow orchestration rules into system prompt');
        } catch (err) {
          logger.warn('Failed to inject workflow rules', { error: getErrorMessage(err) });
        }
      }

      // Manus AI structured variation — shuffle reminder blocks to prevent
      // the model from falling into brittle repetition patterns.
      // Only the footer guideline section is varied; the preamble/tools are left
      // untouched so prompt caching remains effective on the stable prefix.
      if (gates.includeVariation) {
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
      }

      const activeToolFilterDirective = buildActiveToolFilterDirective(activeToolFilter);
      if (activeToolFilterDirective) {
        systemPrompt += '\n\n' + activeToolFilterDirective;
        logger.debug('Injected active tool filter directive into system prompt', {
          enabledPatterns: activeToolFilter.enabledPatterns,
          disabledPatterns: activeToolFilter.disabledPatterns,
        });
      }

      // Truncate system prompt if it exceeds the model's context budget.
      // Reserve 50% of (contextWindow - maxOutputTokens) for the system prompt;
      // the rest goes to conversation history. Simple head-truncation keeps the
      // most critical instructions (always at the top) intact.
      // Reuse `toolCfg` from the top of the function so test mocks that
      // use `mockReturnValueOnce` aren't consumed twice.
      const contextWindow = toolCfg.contextWindow ?? 8192;
      const maxOutputTokens = toolCfg.maxOutputTokens ?? 2048;
      // Guard the degenerate case where maxOutputTokens >= contextWindow (some
      // custom/reasoning model configs): (cw - maxOut) can be <= 0, making
      // budgetChars 0 or negative. Without Math.max, slice(0, 0-3) === slice(0,
      // -3) returns the WHOLE prompt minus 3 chars — the opposite of truncating.
      const budgetTokens = Math.max(0, Math.min(Math.floor((contextWindow - maxOutputTokens) * 0.5), 32_000)); // 32K hard cap
      const budgetChars = budgetTokens * 4; // ~4 chars per token
      if (systemPrompt.length > budgetChars) {
        logger.warn(`System prompt truncated for ${modelName}: ${systemPrompt.length} chars → ${budgetChars} (budget: ${budgetTokens} tokens, 32K hard cap)`);
        systemPrompt = systemPrompt.slice(0, Math.max(0, budgetChars - 3)) + '...';
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
   * Build a system prompt **gated by the user's query and the active
   * model's profile**. Use this once per turn (instead of caching a
   * static SP) so trivial queries on lite models get a minimal prompt
   * (~9 KB) while complex queries on rich models still see the full
   * directive set (~73 KB).
   *
   * Gating logic:
   *   - `promptProfile: 'lite'` → forced trivial gates regardless of
   *     query complexity (Ollama qwen / llama / deepseek small models).
   *   - `promptProfile: 'rich'` → all blocks always (Claude Opus,
   *     Grok-3/4 / Sonnet 4.5).
   *   - `promptProfile: 'standard'` (default) → gates derived from
   *     `classifyQuery(message).complexity`.
   *
   * `supportsToolCalls === false` is honored inside `buildSystemPrompt`
   * itself — it suppresses the memory/lessons/workflow directives that
   * would otherwise tempt the LLM to hallucinate JSON tool calls.
   */
  async buildForQuery(
    message: string,
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null
  ): Promise<string> {
    const toolCfg = getModelToolConfig(modelName);
    const profile = toolCfg.promptProfile ?? 'standard';
    const complexity: QueryComplexity =
      profile === 'lite' ? 'trivial'
      : profile === 'rich' ? 'complex'
      : classifyQuery(message).complexity;

    const gates = gatesForComplexity(complexity);
    logger.debug('buildForQuery gating', {
      modelName,
      profile,
      complexity,
      messageLen: message.length,
      gatesOff: Object.entries(gates).filter(([, v]) => !v).map(([k]) => k),
    });
    return this.buildSystemPrompt(systemPromptId, modelName, customInstructions, gates);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PromptBuilderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Map query complexity to per-block gates. The `lite` model profile maps
 * to `trivial` (minimal prompt); `rich` maps to `complex` (everything).
 */
export function gatesForComplexity(complexity: QueryComplexity): Required<BuildOptions> {
  // NOTE: the return type is Required<BuildOptions> on purpose — the result is
  // merged over ALL_BLOCKS (all-true) by the caller, so ANY omitted key would
  // silently default to `true` and leak that block into a cheap tier (defeating
  // the classifier's token savings). Keep these objects exhaustive.
  switch (complexity) {
    case 'trivial':
      // Greetings, "thanks", yes/no — only base SP + writing rules.
      return {
        includeBootstrap: false,
        includePersona: false,
        includeKnowledge: false,
        includeProjectDocs: false,
        includeRules: false,
        includeSkills: false,
        includeIdentity: false,
        includeFleet: false,
        includeMemoryDirective: false,
        includeLessonsDirective: false,
        includeUserModelDirective: false,
        includeWritingRules: true,
        includeCodingStyle: false,
        includeWorkflowRules: false,
        includeExecutionDiscipline: false,
        includeVariation: false,
      };
    case 'simple':
      // Short questions, no code signals — base + identity + memory
      // directives + rules + writing rules. Skip heavy bootstrap/docs/knowledge
      // AND the execution-discipline / user-model blocks (the tier is meant to
      // be cheap; it already drops workflow rules for the same reason).
      return {
        includeBootstrap: false,
        includePersona: true,
        includeKnowledge: false,
        includeProjectDocs: false,
        includeRules: true,
        includeSkills: true,
        includeIdentity: true,
        includeFleet: true,
        includeMemoryDirective: true,
        includeLessonsDirective: true,
        includeUserModelDirective: false,
        includeWritingRules: true,
        includeCodingStyle: false,
        includeWorkflowRules: false,
        includeExecutionDiscipline: false,
        includeVariation: true,
      };
    case 'complex':
    default:
      // Code work, multi-step instructions — all blocks injected.
      return { ...ALL_BLOCKS };
  }
}
