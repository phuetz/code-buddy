/**
 * Phase T4 — Tests for src/services/prompt-builder.ts.
 *
 * PromptBuilder constructs the agent's system prompt with three modes
 * (explicit promptId / 'auto' / legacy), injects optional context blocks
 * (intro hook, memory, bootstrap, persona, knowledge, docs, rules,
 * skills, identity, coding style, workflow rules), and finally
 * truncates against the model's context budget.
 *
 * The 17 dynamic imports inside buildSystemPrompt are EACH wrapped in
 * a try/catch (silent best-effort). For these tests we mock only the
 * required-path modules; the dynamic imports throw "Cannot find
 * module" and the catches swallow them — that's the behaviour by
 * design. Coverage of the optional injection paths is therefore
 * intentionally partial here; integration tests upstream exercise them.
 *
 * Test scope:
 * - 3 system-prompt paths: explicit promptId, 'auto', undefined (legacy).
 * - Memory gating: enabled+memory wired vs enabled+no memory vs disabled.
 * - Intro hook: when moltbotHooksManager returns content vs throws.
 * - Truncation: long prompt → sliced to budget with "..." suffix.
 * - Truncation: short prompt → untouched.
 * - Error fallback: when getSystemPromptForMode throws on the legacy
 *   path → catches and returns the legacy fallback (still calls
 *   getSystemPromptForMode in the catch arm with the same args).
 * - updateConfig merges partial config.
 * - cacheSystemPrompt is called with the final prompt.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---- mocks for required modules --------------------------------------

const promptMocks = vi.hoisted(() => ({
  getSystemPromptForModeMock: vi.fn(
    (_mode: string, _morph: boolean, _cwd: string, _custom?: string) => 'LEGACY_PROMPT_BODY',
  ),
  buildSystemPromptMock: vi.fn(async () => 'NEW_PROMPT_MANAGER_BODY'),
  autoSelectPromptIdMock: vi.fn((_model: string) => 'auto-selected-id'),
}));

vi.mock('../../src/prompts/index.js', () => ({
  getSystemPromptForMode: promptMocks.getSystemPromptForModeMock,
  getPromptManager: () => ({ buildSystemPrompt: promptMocks.buildSystemPromptMock }),
  autoSelectPromptId: promptMocks.autoSelectPromptIdMock,
  // Phase d.23: prompt-builder swaps to chat-only when supportsToolCalls=false.
  getChatOnlySystemPrompt: vi.fn((_cwd?: string, _custom?: string) => 'CHAT_ONLY_BODY'),
}));

const modelToolsMock = vi.hoisted(() => ({
  getModelToolConfigMock: vi.fn((_model: string) => ({
    contextWindow: 128_000,
    maxOutputTokens: 8_000,
  })),
}));

vi.mock('../../src/config/model-tools.js', () => ({
  getModelToolConfig: modelToolsMock.getModelToolConfigMock,
}));

const identityMock = vi.hoisted(() => ({
  loadMock: vi.fn(async (_cwd: string) => []),
  getPromptInjectionMock: vi.fn(() => ''),
}));

vi.mock('../../src/identity/identity-manager.js', () => ({
  getIdentityManager: () => ({
    load: identityMock.loadMock,
    getPromptInjection: identityMock.getPromptInjectionMock,
  }),
}));

const codingStyleMocks = vi.hoisted(() => ({
  analyzeDirectoryMock: vi.fn(async () => ({ language: 'typescript' })),
  buildPromptSnippetMock: vi.fn(() => '<coding_style>use single quotes</coding_style>'),
}));

vi.mock('../../src/memory/coding-style-analyzer.js', () => ({
  getCodingStyleAnalyzer: () => ({
    analyzeDirectory: codingStyleMocks.analyzeDirectoryMock,
    buildPromptSnippet: codingStyleMocks.buildPromptSnippetMock,
  }),
}));

// ---- imports under test (after mocks) --------------------------------

import {
  PromptBuilder,
  type PromptBuilderConfig,
} from '../../src/services/prompt-builder.js';
import { resetToolFilter, setToolFilter } from '../../src/utils/tool-filter.js';
import {
  _resetFleetRegistryForTests,
  getFleetRegistry,
  type ActiveListenerEntry,
} from '../../src/fleet/fleet-registry.js';

// ---- helpers ---------------------------------------------------------

function buildBuilder(opts: {
  config?: Partial<PromptBuilderConfig>;
  withMemory?: boolean;
  memoryThrows?: boolean;
  withIntroHook?: string | Error | null;
  withPersistentMemory?: string;
} = {}) {
  const cacheSystemPrompt = vi.fn();
  const promptCacheManager = {
    cacheSystemPrompt,
  } as unknown as ConstructorParameters<typeof PromptBuilder>[1];

  const memory = opts.withMemory
    ? ({
        buildContext: opts.memoryThrows
          ? vi.fn(async () => { throw new Error('memory boom'); })
          : vi.fn(async () => 'enhanced-memory-context'),
      } as unknown as ConstructorParameters<typeof PromptBuilder>[2])
    : undefined;

  const moltbotHooksManager = opts.withIntroHook !== undefined
    ? ({
        getIntroManager: () => ({
          loadIntro: async () => {
            if (opts.withIntroHook instanceof Error) throw opts.withIntroHook;
            if (opts.withIntroHook === null) return { content: '', sources: [] };
            return { content: opts.withIntroHook, sources: ['intro_hook.txt'] };
          },
        }),
      } as unknown as ConstructorParameters<typeof PromptBuilder>[3])
    : undefined;

  const persistentMemory = opts.withPersistentMemory !== undefined
    ? ({
        getContextForPrompt: () => opts.withPersistentMemory,
      } as unknown as ConstructorParameters<typeof PromptBuilder>[4])
    : undefined;

  const config: PromptBuilderConfig = {
    yoloMode: false,
    memoryEnabled: false,
    morphEditorEnabled: false,
    cwd: '/tmp/test',
    ...opts.config,
  };

  const builder = new PromptBuilder(
    config,
    promptCacheManager,
    memory,
    moltbotHooksManager,
    persistentMemory,
  );

  return { builder, cacheSystemPrompt };
}

function registerFleetPeer(): void {
  const listener: ActiveListenerEntry['listener'] = {
    disconnect: vi.fn(async () => undefined),
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: vi.fn(async () => ({})),
    getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 0 }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };

  getFleetRegistry().register({
    id: 'hermes-peer',
    url: 'http://127.0.0.1:3999',
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 0,
    listener,
  });
}

// ---- tests -----------------------------------------------------------

describe('PromptBuilder — Phase T4', () => {
  beforeEach(() => {
    resetToolFilter();
    _resetFleetRegistryForTests();
    promptMocks.getSystemPromptForModeMock
      .mockReset()
      .mockImplementation(() => 'LEGACY_PROMPT_BODY');
    promptMocks.buildSystemPromptMock
      .mockReset()
      .mockResolvedValue('NEW_PROMPT_MANAGER_BODY');
    promptMocks.autoSelectPromptIdMock.mockReset().mockReturnValue('auto-selected-id');
    modelToolsMock.getModelToolConfigMock
      .mockReset()
      .mockReturnValue({ contextWindow: 128_000, maxOutputTokens: 8_000 });
    identityMock.loadMock.mockReset().mockResolvedValue([]);
    identityMock.getPromptInjectionMock.mockReset().mockReturnValue('');
    codingStyleMocks.analyzeDirectoryMock
      .mockReset()
      .mockResolvedValue({ language: 'typescript' });
    codingStyleMocks.buildPromptSnippetMock
      .mockReset()
      .mockReturnValue('<coding_style>use single quotes</coding_style>');
  });

  afterEach(() => {
    resetToolFilter();
  });

  describe('construction + updateConfig', () => {
    it('constructs without optional dependencies', () => {
      const { builder } = buildBuilder();
      expect(builder).toBeInstanceOf(PromptBuilder);
    });

    it('updateConfig merges partial overrides into the existing config', async () => {
      const { builder } = buildBuilder({ config: { yoloMode: false } });
      builder.updateConfig({ yoloMode: true });
      // Behaviour assertion: legacy path uses 'yolo' when yoloMode=true.
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      expect(promptMocks.getSystemPromptForModeMock).toHaveBeenCalledOnce();
      expect(promptMocks.getSystemPromptForModeMock.mock.calls[0][0]).toBe('yolo');
    });
  });

  describe('legacy path (no promptId)', () => {
    it('uses getSystemPromptForMode with mode=default + morph + cwd + customInstructions', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { morphEditorEnabled: true, cwd: '/work' },
      });
      const prompt = await builder.buildSystemPrompt(undefined, 'grok-3', 'do X');
      expect(prompt).toContain('LEGACY_PROMPT_BODY');
      expect(promptMocks.getSystemPromptForModeMock).toHaveBeenCalledWith(
        'default',
        true,
        '/work',
        'do X',
      );
      // Cache always called with the FINAL prompt (after potential injections / truncation)
      expect(cacheSystemPrompt).toHaveBeenCalledOnce();
      expect(cacheSystemPrompt.mock.calls[0][0]).toContain('LEGACY_PROMPT_BODY');
    });

    it('passes mode=yolo when yoloMode is enabled', async () => {
      const { builder } = buildBuilder({ config: { yoloMode: true } });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      expect(promptMocks.getSystemPromptForModeMock.mock.calls[0][0]).toBe('yolo');
    });

    it('passes undefined for empty customInstructions (not an empty string)', async () => {
      const { builder } = buildBuilder();
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      expect(promptMocks.getSystemPromptForModeMock.mock.calls[0][3]).toBeUndefined();
    });
  });

  describe('explicit promptId path', () => {
    it('routes through getPromptManager().buildSystemPrompt with the given id', async () => {
      const { builder } = buildBuilder({ config: { cwd: '/work' } });
      await builder.buildSystemPrompt('claude-code', 'claude-3-5-sonnet', 'instructions');
      expect(promptMocks.buildSystemPromptMock).toHaveBeenCalledOnce();
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      expect(args.promptId).toBe('claude-code');
      expect(args.modelName).toBe('claude-3-5-sonnet');
      expect(args.userInstructions).toBe('instructions');
      expect(args.cwd).toBe('/work');
      expect(args.includeProjectContext).toBe(true);
      expect(args.includeMemory).toBe(false); // memory disabled
    });

    it('passes empty userInstructions as undefined when null is given', async () => {
      const { builder } = buildBuilder();
      await builder.buildSystemPrompt('myprompt', 'grok-3', null);
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      expect(args.userInstructions).toBeUndefined();
    });

    it('filters explicit prompt-manager tool prompts through the active tool filter', async () => {
      setToolFilter({
        enabledPatterns: ['view_file', 'search', 'reason'],
        disabledPatterns: ['bash'],
      });
      const { builder, cacheSystemPrompt } = buildBuilder();
      await builder.buildSystemPrompt('claude-code', 'grok-3', null, {
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
        includeWritingRules: false,
        includeCodingStyle: false,
        includeWorkflowRules: false,
        includeVariation: false,
      });

      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      expect(args.tools).toEqual(['view_file', 'search', 'reason']);

      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('<active_tool_filter>');
      expect(finalPrompt).toContain('Enabled patterns: view_file, search, reason');
      expect(finalPrompt).toContain('Disabled patterns: bash');
      expect(finalPrompt).toContain('Trust the schema over generic prompt text');
    });
  });

  describe('"auto" path', () => {
    it('calls autoSelectPromptId with the modelName and forwards to the prompt manager', async () => {
      const { builder } = buildBuilder();
      await builder.buildSystemPrompt('auto', 'gpt-4o', null);
      expect(promptMocks.autoSelectPromptIdMock).toHaveBeenCalledWith('gpt-4o');
      expect(promptMocks.buildSystemPromptMock).toHaveBeenCalledOnce();
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      expect(args.promptId).toBe('auto-selected-id');
      // 'auto' path does NOT set includeProjectContext (different from explicit path)
      expect(args.includeProjectContext).toBeUndefined();
    });
  });

  describe('memory injection', () => {
    it('builds enhanced memory context when memoryEnabled + memory wired', async () => {
      const { builder } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
      });
      await builder.buildSystemPrompt('explicit', 'grok-3', null);
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      expect(args.includeMemory).toBe(true);
      expect(args.memoryContext).toContain('enhanced-memory-context');
    });

    it('memoryEnabled but no memory wired: memoryContext stays undefined', async () => {
      const { builder } = buildBuilder({
        config: { memoryEnabled: true },
      });
      await builder.buildSystemPrompt('explicit', 'grok-3', null);
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      // Falsy joined string → memoryContext set to undefined → includeMemory false
      expect(args.includeMemory).toBe(false);
      expect(args.memoryContext).toBeUndefined();
    });

    it('memory.buildContext throwing is logged and does not propagate', async () => {
      const { builder } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        memoryThrows: true,
      });
      // Must not throw despite memory error
      await expect(builder.buildSystemPrompt('explicit', 'grok-3', null)).resolves.toBeTruthy();
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      // No enhanced context captured → falls to undefined (or persistent if any)
      expect(args.memoryContext).toBeUndefined();
    });

    it('combines enhanced + persistent memory contexts when both are wired', async () => {
      const { builder } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt('explicit', 'grok-3', null);
      const args = promptMocks.buildSystemPromptMock.mock.calls[0][0];
      expect(args.memoryContext).toContain('enhanced-memory-context');
      expect(args.memoryContext).toContain('persistent-bit');
    });

    it('memoryEnabled=false: memory.buildContext is NEVER called', async () => {
      const buildContextSpy = vi.fn();
      const memory = { buildContext: buildContextSpy };
      const builder = new PromptBuilder(
        // /tmp/test (not '/') so the optional coding-style-analyzer doesn't
        // scan the entire filesystem and time the test out.
        { yoloMode: false, memoryEnabled: false, morphEditorEnabled: false, cwd: '/tmp/test' },
        { cacheSystemPrompt: vi.fn() } as unknown as ConstructorParameters<typeof PromptBuilder>[1],
        memory as unknown as ConstructorParameters<typeof PromptBuilder>[2],
      );
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      expect(buildContextSpy).not.toHaveBeenCalled();
    });
  });

  describe('intro hook (Moltbot)', () => {
    it('prepends intro hook content with a separator when present', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        withIntroHook: 'YOU ARE LOBSTER',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('# Role & Instructions (from intro_hook.txt)');
      expect(finalPrompt).toContain('YOU ARE LOBSTER');
      // Intro must come BEFORE the legacy body
      expect(finalPrompt.indexOf('YOU ARE LOBSTER')).toBeLessThan(
        finalPrompt.indexOf('LEGACY_PROMPT_BODY'),
      );
    });

    it('intro hook with empty content is NOT prepended', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({ withIntroHook: null });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).not.toContain('Role & Instructions');
    });

    it('intro hook loader throwing is logged and does not break the flow', async () => {
      const { builder } = buildBuilder({
        withIntroHook: new Error('intro boom'),
      });
      await expect(builder.buildSystemPrompt(undefined, 'grok-3', null)).resolves.toBeTruthy();
    });
  });

  describe('identity injection', () => {
    it('loads identity files from PromptBuilder cwd, not process.cwd()', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { cwd: '/workspace/from-config' },
      });
      identityMock.getPromptInjectionMock.mockReturnValue('## SOUL.md\n\nProject Buddy identity');

      await builder.buildSystemPrompt(undefined, 'grok-3', null, {
        includeBootstrap: false,
        includePersona: false,
        includeKnowledge: false,
        includeProjectDocs: false,
        includeRules: false,
        includeSkills: false,
        includeIdentity: true,
        includeFleet: false,
        includeMemoryDirective: false,
        includeLessonsDirective: false,
        includeWritingRules: false,
        includeCodingStyle: false,
        includeWorkflowRules: false,
        includeVariation: false,
      });

      expect(identityMock.loadMock).toHaveBeenCalledWith('/workspace/from-config');
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('Project Buddy identity');
    });
  });

  describe('auto-memory directive', () => {
    it('injects <auto_memory_directive> when memoryEnabled=true and persistentMemory is wired', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('<auto_memory_directive>');
      expect(finalPrompt).toContain('</auto_memory_directive>');
      // Anchor phrases that prove the LLM gets actionable instruction:
      expect(finalPrompt).toContain('`remember`');
      expect(finalPrompt).toContain('CODEBUDDY_MEMORY.md');
      expect(finalPrompt).toMatch(/When to call.*remember/i);
      expect(finalPrompt).toMatch(/When NOT to call/i);
    });

    it('does NOT inject the directive when memoryEnabled=false (even with persistentMemory wired)', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: false },
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).not.toContain('<auto_memory_directive>');
    });

    it('does NOT inject the directive when persistentMemory is missing (even with memoryEnabled=true)', async () => {
      // memoryEnabled=true but no persistentMemory passed → no directive
      // (the directive is gated on the markdown backend being available, since
      // there's no point telling the LLM to call `remember` if the markdown
      // file won't be created/updated).
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true, // EnhancedMemory only — no PersistentMemory
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).not.toContain('<auto_memory_directive>');
    });

    it('does NOT inject memory or lessons directives when the active tool filter hides those tools', async () => {
      setToolFilter({
        enabledPatterns: ['view_file', 'search'],
        disabledPatterns: [],
      });
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null, {
        includeBootstrap: false,
        includePersona: false,
        includeKnowledge: false,
        includeProjectDocs: false,
        includeRules: false,
        includeSkills: false,
        includeIdentity: false,
        includeFleet: false,
        includeWritingRules: false,
        includeCodingStyle: false,
        includeWorkflowRules: false,
        includeVariation: false,
      });

      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).not.toContain('<auto_memory_directive>');
      expect(finalPrompt).not.toContain('<lessons_directive>');
      expect(finalPrompt).toContain('<active_tool_filter>');
    });
  });

  describe('tool-aware workflow guidance', () => {
    it('omits filtered tool names from workflow rules', async () => {
      setToolFilter({
        enabledPatterns: ['view_file', 'search'],
        disabledPatterns: [],
      });
      const { builder, cacheSystemPrompt } = buildBuilder();
      await builder.buildSystemPrompt(undefined, 'grok-3', null, {
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
        includeWritingRules: false,
        includeCodingStyle: false,
        includeWorkflowRules: true,
        includeVariation: false,
      });

      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('## Workflow Orchestration');
      expect(finalPrompt).not.toContain('`web_search`');
      expect(finalPrompt).not.toContain('`web_fetch`');
      expect(finalPrompt).not.toContain('`browser`');
      expect(finalPrompt).not.toContain('`task_verify`');
      expect(finalPrompt).toContain('do not claim live verification');
    });
  });

  describe('lessons directive (Manus AI-inspired)', () => {
    it('injects <lessons_directive> when memoryEnabled=true and persistentMemory is wired', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('<lessons_directive>');
      expect(finalPrompt).toContain('</lessons_directive>');
      // The 4 categories must all appear
      expect(finalPrompt).toContain('**RULE**');
      expect(finalPrompt).toContain('**PATTERN**');
      expect(finalPrompt).toContain('**CONTEXT**');
      expect(finalPrompt).toContain('**INSIGHT**');
      // Tool names + actionable triggers
      expect(finalPrompt).toContain('`lessons_add`');
      expect(finalPrompt).toContain('`lessons_search`');
      expect(finalPrompt).toContain('`lessons_graph`');
      expect(finalPrompt).toContain('Manus AI');
      expect(finalPrompt).toMatch(/After the user corrects your approach/i);
      expect(finalPrompt).toMatch(/mini-Obsidian|lesson graph/i);
      expect(finalPrompt).toContain('format: "markdown"');
      expect(finalPrompt).toContain('includeKeywords: false');
      // Phase d.25: lessons_add should also fire after a bug-finding /
      // audit / code-review task, so the LLM captures the underlying
      // pattern as an actionable rule for next time.
      expect(finalPrompt).toMatch(/bug-finding|audit|code-review/i);
    });

    it('injects BOTH directives (presence; order is intentionally shuffled by varySystemPrompt)', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      // Both directives must be present. Order is not asserted because
      // `varySystemPrompt` (Manus AI anti-repetition pattern) shuffles
      // reminder blocks daily — order checking would make tests flaky.
      expect(finalPrompt).toContain('<auto_memory_directive>');
      expect(finalPrompt).toContain('<lessons_directive>');
    });

    it('does NOT inject the lessons directive when memoryEnabled=false', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: false },
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).not.toContain('<lessons_directive>');
    });

    it('lessons directive explicitly differentiates from `remember` (no overlap confusion)', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      // Must explain that lessons complement remember (not duplicate)
      expect(finalPrompt).toMatch(/complement.*remember|differ from .*remember/i);
    });
  });

  describe('writing_rules directive (Manus AI structured-blocks pattern)', () => {
    it('injects <writing_rules> ALWAYS — no memoryEnabled gate', async () => {
      // memoryEnabled=false intentionally — writing rules are universal
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: false },
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('<writing_rules>');
      expect(finalPrompt).toContain('</writing_rules>');
    });

    it('contains the prohibitions: control tokens, meta-commentary, gratuitous emoji', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      // Control token examples
      expect(finalPrompt).toContain('<|im_start|>');
      expect(finalPrompt).toContain('<think>');
      expect(finalPrompt).toContain('GLM-5');
      // Meta-commentary prohibition
      expect(finalPrompt).toMatch(/As an AI/);
      expect(finalPrompt).toContain('No meta-commentary');
      // Emoji rule
      expect(finalPrompt).toMatch(/No emoji unless/);
      // Zero-width chars
      expect(finalPrompt).toContain('U+200B');
    });

    it('contains positive guidance: markdown structure, file:line, "I don\'t know"', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: false },
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toMatch(/Code fences with language/i);
      expect(finalPrompt).toMatch(/path\/to\/file\.ts:42/);
      expect(finalPrompt).toContain("I don't know");
      expect(finalPrompt).toMatch(/markdown hyperlinks/i);
    });

    it('all three directives present together when memory is wired (no order assertion — varySystemPrompt shuffles)', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder({
        config: { memoryEnabled: true },
        withMemory: true,
        withPersistentMemory: 'persistent-bit',
      });
      await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const finalPrompt = cacheSystemPrompt.mock.calls[0][0] as string;
      expect(finalPrompt).toContain('<auto_memory_directive>');
      expect(finalPrompt).toContain('<lessons_directive>');
      expect(finalPrompt).toContain('<writing_rules>');
    });
  });

  describe('fleet nudge', () => {
    it('injects the Hermes dispatch profile guide when peers are connected', async () => {
      registerFleetPeer();
      const { builder } = buildBuilder();

      const prompt = await builder.buildSystemPrompt(undefined, 'grok-3', null, {
        includeBootstrap: false,
        includePersona: false,
        includeKnowledge: false,
        includeProjectDocs: false,
        includeRules: false,
        includeSkills: false,
        includeIdentity: false,
        includeFleet: true,
        includeMemoryDirective: false,
        includeLessonsDirective: false,
        includeWritingRules: false,
        includeCodingStyle: false,
        includeWorkflowRules: false,
        includeVariation: false,
      });

      expect(prompt).toContain('<fleet>Connected fleet peers: 1.');
      expect(prompt).toContain('using this guide: balanced: general delegation');
      expect(prompt).toContain('review: read-first code review');
      expect(prompt).toContain('safe: high-risk');
      expect(prompt).toContain('reuse the dispatchProfile returned by route_peer');
    });
  });

  describe('budget truncation', () => {
    it('truncates a system prompt longer than the model budget and appends "..."', async () => {
      // Force a tiny budget so the LEGACY_PROMPT_BODY ALONE overshoots.
      // budget = floor((contextWindow - maxOutputTokens) * 0.5) tokens
      //        = chars / 4
      // contextWindow=100, maxOutputTokens=10 → tokens=45 → chars=180
      modelToolsMock.getModelToolConfigMock.mockReturnValueOnce({
        contextWindow: 100,
        maxOutputTokens: 10,
      });
      promptMocks.getSystemPromptForModeMock.mockReturnValueOnce('A'.repeat(500));

      const { builder, cacheSystemPrompt } = buildBuilder();
      const prompt = await builder.buildSystemPrompt(undefined, 'grok-3', null);

      expect(prompt.length).toBeLessThan(500);
      expect(prompt.endsWith('...')).toBe(true);
      // The cached prompt should be the truncated one, not the original
      expect(cacheSystemPrompt.mock.calls[0][0]).toBe(prompt);
    });

    it('does NOT truncate a system prompt within the budget', async () => {
      // Generous budget ensures untouched
      modelToolsMock.getModelToolConfigMock.mockReturnValueOnce({
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
      });
      promptMocks.getSystemPromptForModeMock.mockReturnValueOnce('SHORT_BODY');

      const { builder } = buildBuilder();
      const prompt = await builder.buildSystemPrompt(undefined, 'grok-3', null);

      expect(prompt.endsWith('...')).toBe(false);
      expect(prompt).toContain('SHORT_BODY');
    });

    it('falls back to default budget (8192/2048) when getModelToolConfig returns nullish caps', async () => {
      modelToolsMock.getModelToolConfigMock.mockReturnValueOnce({
        contextWindow: undefined as unknown as number,
        maxOutputTokens: undefined as unknown as number,
      });
      promptMocks.getSystemPromptForModeMock.mockReturnValueOnce('SHORT');
      const { builder } = buildBuilder();
      // Just assert no throw — default budget is large enough for SHORT
      await expect(builder.buildSystemPrompt(undefined, 'grok-3', null)).resolves.toContain('SHORT');
    });

    it('respects the 32K hard cap on the budget even when the model context is huge', async () => {
      // 1M context window × 0.5 = 500K tokens, but the hard cap is 32K → 128K chars.
      modelToolsMock.getModelToolConfigMock.mockReturnValueOnce({
        contextWindow: 1_000_000,
        maxOutputTokens: 8_000,
      });
      // 200K-char prompt → exceeds 128K cap → must be truncated
      promptMocks.getSystemPromptForModeMock.mockReturnValueOnce('B'.repeat(200_000));
      const { builder } = buildBuilder();
      const prompt = await builder.buildSystemPrompt(undefined, 'grok-3', null);
      expect(prompt.length).toBeLessThanOrEqual(32_000 * 4); // budget chars
      expect(prompt.endsWith('...')).toBe(true);
    });
  });

  describe('error fallback', () => {
    it('catches a fatal error in the main path and returns the legacy fallback', async () => {
      // Make the explicit-path getPromptManager().buildSystemPrompt throw
      // (the only sync error path that would reach the outer catch).
      promptMocks.buildSystemPromptMock.mockRejectedValueOnce(new Error('prompt manager boom'));
      // The catch arm calls getSystemPromptForMode again — keep it returning legacy.
      promptMocks.getSystemPromptForModeMock.mockReturnValue('FALLBACK_LEGACY_BODY');

      const { builder } = buildBuilder({ config: { yoloMode: true } });
      const prompt = await builder.buildSystemPrompt('explicit', 'grok-3', 'extra');
      expect(prompt).toBe('FALLBACK_LEGACY_BODY');
      // Catch arm should preserve the yolo mode + customInstructions
      const lastCall = promptMocks.getSystemPromptForModeMock.mock.calls.at(-1)!;
      expect(lastCall[0]).toBe('yolo');
      expect(lastCall[3]).toBe('extra');
    });
  });

  describe('coding style cache', () => {
    it('scans a cwd only once across successive prompt builds', async () => {
      const { builder } = buildBuilder({ config: { cwd: '/tmp/project-a' } });

      const first = await builder.buildSystemPrompt(undefined, 'grok-3', null);
      const second = await builder.buildSystemPrompt(undefined, 'grok-3', null);

      expect(first).toContain('<coding_style>use single quotes</coding_style>');
      expect(second).toContain('<coding_style>use single quotes</coding_style>');
      expect(codingStyleMocks.analyzeDirectoryMock).toHaveBeenCalledOnce();
      expect(codingStyleMocks.analyzeDirectoryMock).toHaveBeenCalledWith('/tmp/project-a');
      expect(codingStyleMocks.buildPromptSnippetMock).toHaveBeenCalledOnce();
    });
  });

  describe('cache integration', () => {
    it('always calls cacheSystemPrompt with the final prompt (post-truncation)', async () => {
      const { builder, cacheSystemPrompt } = buildBuilder();
      const prompt = await builder.buildSystemPrompt(undefined, 'grok-3', null);
      expect(cacheSystemPrompt).toHaveBeenCalledOnce();
      expect(cacheSystemPrompt.mock.calls[0][0]).toBe(prompt);
    });
  });
});
