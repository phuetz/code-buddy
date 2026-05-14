/**
 * Tests for Enterprise parity Features
 *
 * Covers:
 * - Feature 1: Extended Thinking Mode (toggle, config, token budget, env var, singleton)
 * - Feature 2: Prompt Suggestions (generate, cache, clear, enabled/disabled)
 * - Feature 3: Context Visualization (grid rendering, percentages, colors, edge cases)
 */

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ============================================================================
// Feature 1: Extended Thinking Mode
// ============================================================================

describe('ExtendedThinkingManager', () => {
  let ExtendedThinkingManager: typeof import('../../src/agent/extended-thinking').ExtendedThinkingManager;
  let getExtendedThinking: typeof import('../../src/agent/extended-thinking').getExtendedThinking;
  let resetExtendedThinking: typeof import('../../src/agent/extended-thinking').resetExtendedThinking;

  beforeEach(async () => {
    // Clean env before each test
    delete process.env.MAX_THINKING_TOKENS;

    // Re-import to get fresh module
    jest.resetModules();
    const mod = await import('../../src/agent/extended-thinking');
    ExtendedThinkingManager = mod.ExtendedThinkingManager;
    getExtendedThinking = mod.getExtendedThinking;
    resetExtendedThinking = mod.resetExtendedThinking;
    resetExtendedThinking();
  });

  it('should default to disabled', () => {
    const manager = new ExtendedThinkingManager();
    expect(manager.isEnabled()).toBe(false);
  });

  it('should default token budget to 31999', () => {
    const manager = new ExtendedThinkingManager();
    expect(manager.getTokenBudget()).toBe(31999);
  });

  it('should toggle on and off', () => {
    const manager = new ExtendedThinkingManager();
    const result1 = manager.toggle();
    expect(result1).toBe(true);
    expect(manager.isEnabled()).toBe(true);

    const result2 = manager.toggle();
    expect(result2).toBe(false);
    expect(manager.isEnabled()).toBe(false);
  });

  it('should return thinking config when enabled', () => {
    const manager = new ExtendedThinkingManager();
    manager.toggle(); // enable

    const config = manager.getThinkingConfig();
    expect(config).toEqual({
      thinking: {
        type: 'enabled',
        budget_tokens: 31999,
      },
    });
  });

  it('should return empty config when disabled', () => {
    const manager = new ExtendedThinkingManager();
    const config = manager.getThinkingConfig();
    expect(config).toEqual({});
  });

  it('should respect MAX_THINKING_TOKENS env var', async () => {
    process.env.MAX_THINKING_TOKENS = '50000';
    jest.resetModules();
    const mod = await import('../../src/agent/extended-thinking');
    const manager = new mod.ExtendedThinkingManager();
    expect(manager.getTokenBudget()).toBe(50000);
  });

  it('should fall back to default on invalid env var', async () => {
    process.env.MAX_THINKING_TOKENS = 'not-a-number';
    jest.resetModules();
    const mod = await import('../../src/agent/extended-thinking');
    const manager = new mod.ExtendedThinkingManager();
    expect(manager.getTokenBudget()).toBe(31999);
  });

  it('should allow setting token budget', () => {
    const manager = new ExtendedThinkingManager();
    manager.setTokenBudget(10000);
    expect(manager.getTokenBudget()).toBe(10000);

    manager.toggle();
    const config = manager.getThinkingConfig();
    expect(config.thinking?.budget_tokens).toBe(10000);
  });

  it('should ignore non-positive budget', () => {
    const manager = new ExtendedThinkingManager();
    manager.setTokenBudget(0);
    expect(manager.getTokenBudget()).toBe(31999);
    manager.setTokenBudget(-100);
    expect(manager.getTokenBudget()).toBe(31999);
  });

  it('should be enabled when alwaysEnabled is set', () => {
    const manager = new ExtendedThinkingManager();
    expect(manager.isEnabled()).toBe(false);

    manager.setAlwaysEnabled(true);
    expect(manager.isEnabled()).toBe(true);

    // Should remain enabled even without toggle
    const config = manager.getThinkingConfig();
    expect(config.thinking).toBeDefined();
  });

  it('should provide singleton via getExtendedThinking', () => {
    const a = getExtendedThinking();
    const b = getExtendedThinking();
    expect(a).toBe(b);
  });

  it('should reset singleton via resetExtendedThinking', () => {
    const a = getExtendedThinking();
    a.toggle(); // enable
    expect(a.isEnabled()).toBe(true);

    resetExtendedThinking();
    const b = getExtendedThinking();
    expect(b).not.toBe(a);
    expect(b.isEnabled()).toBe(false);
  });
});

// ============================================================================
// Feature 2: Prompt Suggestions
// ============================================================================

describe('PromptSuggestionEngine', () => {
  let PromptSuggestionEngine: typeof import('../../src/agent/prompt-suggestions').PromptSuggestionEngine;
  let previousProvider: string | undefined;

  beforeEach(async () => {
    previousProvider = process.env.CODEBUDDY_PROVIDER;
    process.env.CODEBUDDY_PROVIDER = 'not-a-provider';
    jest.resetModules();
    const mod = await import('../../src/agent/prompt-suggestions');
    PromptSuggestionEngine = mod.PromptSuggestionEngine;
  });

  afterEach(() => {
    if (previousProvider === undefined) {
      delete process.env.CODEBUDDY_PROVIDER;
    } else {
      process.env.CODEBUDDY_PROVIDER = previousProvider;
    }
  });

  it('should default to enabled', () => {
    const engine = new PromptSuggestionEngine();
    expect(engine.isEnabled()).toBe(true);
  });

  it('should allow disabling via constructor', () => {
    const engine = new PromptSuggestionEngine(false);
    expect(engine.isEnabled()).toBe(false);
  });

  it('should generate suggestions when enabled', async () => {
    const engine = new PromptSuggestionEngine();
    const suggestions = await engine.generateSuggestions(
      'I have a bug in my test file',
      'I found the error in the test runner configuration'
    );

    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    suggestions.forEach(s => {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    });
  });

  it('should return empty array when disabled', async () => {
    const engine = new PromptSuggestionEngine(false);
    const suggestions = await engine.generateSuggestions('context', 'response');
    expect(suggestions).toEqual([]);
  });

  it('should return empty array for empty inputs', async () => {
    const engine = new PromptSuggestionEngine();
    const suggestions = await engine.generateSuggestions('', '');
    expect(suggestions).toEqual([]);
  });

  it('should cache suggestions after generation', async () => {
    const engine = new PromptSuggestionEngine();
    await engine.generateSuggestions('test context', 'test response with error');

    const cached = engine.getSuggestions();
    expect(cached.length).toBeGreaterThanOrEqual(2);
  });

  it('should clear cached suggestions', async () => {
    const engine = new PromptSuggestionEngine();
    await engine.generateSuggestions('test context', 'test response');

    engine.clearSuggestions();
    expect(engine.getSuggestions()).toEqual([]);
  });

  it('should clear cache when disabled at runtime', async () => {
    const engine = new PromptSuggestionEngine();
    await engine.generateSuggestions('test code file', 'here is the code');
    expect(engine.getSuggestions().length).toBeGreaterThan(0);

    engine.setEnabled(false);
    expect(engine.getSuggestions()).toEqual([]);
    expect(engine.isEnabled()).toBe(false);
  });

  it('should return defensive copy from getSuggestions', async () => {
    const engine = new PromptSuggestionEngine();
    await engine.generateSuggestions('refactor the code', 'I refactored it');

    const a = engine.getSuggestions();
    const b = engine.getSuggestions();
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different array references
  });

  it('should generate relevant suggestions for test-related context', async () => {
    const engine = new PromptSuggestionEngine();
    const suggestions = await engine.generateSuggestions(
      'run the test suite',
      'All tests passed'
    );
    expect(suggestions.some(s => s.toLowerCase().includes('test'))).toBe(true);
  });

  it('should generate relevant suggestions for error-related context', async () => {
    const engine = new PromptSuggestionEngine();
    const suggestions = await engine.generateSuggestions(
      'there is an error',
      'The error was in the parser'
    );
    expect(suggestions.some(s => s.toLowerCase().includes('error') || s.toLowerCase().includes('stack'))).toBe(true);
  });
});

// ============================================================================
// Feature 3: Context Visualization
// ============================================================================

describe('Context Visualization', () => {
  let handleContextVisualization: typeof import('../../src/commands/handlers/context-handler').handleContextVisualization;
  let CONTEXT_COMMAND: typeof import('../../src/commands/handlers/context-handler').CONTEXT_COMMAND;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/commands/handlers/context-handler');
    handleContextVisualization = mod.handleContextVisualization;
    CONTEXT_COMMAND = mod.CONTEXT_COMMAND;
  });

  it('should render a non-empty string', () => {
    const result = handleContextVisualization({
      systemPrompt: 2000,
      messages: 5000,
      tools: 3000,
      available: 90000,
      total: 100000,
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should include header and legend', () => {
    const result = handleContextVisualization({
      systemPrompt: 2000,
      messages: 5000,
      tools: 3000,
      available: 90000,
      total: 100000,
    });

    expect(result).toContain('Context Window Usage');
    expect(result).toContain('System Prompt');
    expect(result).toContain('Messages');
    expect(result).toContain('Tools');
    expect(result).toContain('Available');
  });

  it('should include percentage values', () => {
    const result = handleContextVisualization({
      systemPrompt: 10000,
      messages: 20000,
      tools: 10000,
      available: 60000,
      total: 100000,
    });

    expect(result).toContain('10%');
    expect(result).toContain('20%');
    expect(result).toContain('60%');
  });

  it('should include ANSI color codes', () => {
    const result = handleContextVisualization({
      systemPrompt: 5000,
      messages: 5000,
      tools: 5000,
      available: 85000,
      total: 100000,
    });

    // Check for ANSI escape sequences
    expect(result).toContain('\x1b[');
  });

  it('should show total token count', () => {
    const result = handleContextVisualization({
      systemPrompt: 1000,
      messages: 2000,
      tools: 1000,
      available: 96000,
      total: 100000,
    });

    expect(result).toContain('100,000');
    expect(result).toContain('tokens');
  });

  it('should handle zero total gracefully', () => {
    const result = handleContextVisualization({
      systemPrompt: 0,
      messages: 0,
      tools: 0,
      available: 0,
      total: 0,
    });

    expect(result).toContain('Context Window Usage');
    expect(result).toContain('0%');
  });

  it('should handle nearly full context window', () => {
    const result = handleContextVisualization({
      systemPrompt: 30000,
      messages: 50000,
      tools: 15000,
      available: 5000,
      total: 100000,
    });

    expect(result).toContain('30%');
    expect(result).toContain('50%');
    expect(result).toContain('15%');
    expect(result).toContain('5%');
  });

  it('should handle completely full context window', () => {
    const result = handleContextVisualization({
      systemPrompt: 20000,
      messages: 60000,
      tools: 20000,
      available: 0,
      total: 100000,
    });

    expect(result).toContain('0%');
    // Available should be 0%
    expect(result).toMatch(/Available:.*0%/);
  });

  it('should export CONTEXT_COMMAND with correct structure', () => {
    expect(CONTEXT_COMMAND).toBeDefined();
    expect(CONTEXT_COMMAND.name).toBe('context-viz');
    expect(CONTEXT_COMMAND.description).toBeTruthy();
    expect(CONTEXT_COMMAND.isBuiltin).toBe(true);
    expect(CONTEXT_COMMAND.prompt).toBe('__CONTEXT_VIZ__');
  });

  it('should format large token numbers with separators', () => {
    const result = handleContextVisualization({
      systemPrompt: 128000,
      messages: 0,
      tools: 0,
      available: 0,
      total: 128000,
    });

    expect(result).toContain('128,000');
  });
});
