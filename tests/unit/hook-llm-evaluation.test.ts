/**
 * Tests for hook LLM evaluation in SmartHookRunner and AdvancedHookRunner.
 *
 * Covers prompt hooks, agent hooks, and template rendering where the hook
 * system invokes the LLM via CodeBuddyClient.
 */

import { SmartHookRunner, SmartHookConfig } from '../../src/hooks/smart-hooks.js';

import {
  AdvancedHookRunner,
  AdvancedHook,
  HookEvent,
  HookContext,
} from '../../src/hooks/advanced-hooks.js';

// ---------------------------------------------------------------------------
// Mock CodeBuddyClient
// ---------------------------------------------------------------------------

const mockChat = jest.fn();

jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(function() { return {
    chat: mockChat,
  }; }),
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChatResponse(content: string, tool_calls?: any[]) {
  return {
    choices: [
      {
        message: {
          content,
          tool_calls: tool_calls ?? [],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Environment save / restore
// ---------------------------------------------------------------------------

let savedApiKey: string | undefined;

beforeEach(() => {
  savedApiKey = process.env.GROK_API_KEY;
  mockChat.mockReset();
});

afterEach(() => {
  if (savedApiKey !== undefined) {
    process.env.GROK_API_KEY = savedApiKey;
  } else {
    delete process.env.GROK_API_KEY;
  }
});

// ===========================================================================
// SmartHookRunner
// ===========================================================================

describe('SmartHookRunner', () => {
  let runner: SmartHookRunner;

  beforeEach(() => {
    runner = new SmartHookRunner();
  });

  // -------------------------------------------------------------------------
  // renderTemplate
  // -------------------------------------------------------------------------

  describe('renderTemplate', () => {
    it('should substitute known placeholders', () => {
      const result = runner.renderTemplate(
        'Hello {{name}}, file is {{path}}',
        { name: 'Alice', path: '/tmp/foo.txt' }
      );
      expect(result).toBe('Hello Alice, file is /tmp/foo.txt');
    });

    it('should leave unknown placeholders intact', () => {
      const result = runner.renderTemplate('Value: {{missing}}', {});
      expect(result).toBe('Value: {{missing}}');
    });

    it('should JSON-stringify non-string values', () => {
      const result = runner.renderTemplate('Data: {{obj}}', { obj: { a: 1 } });
      expect(result).toBe('Data: {"a":1}');
    });
  });

  // -------------------------------------------------------------------------
  // runPromptHook
  // -------------------------------------------------------------------------

  describe('runPromptHook (via runHook)', () => {
    const baseHook: SmartHookConfig = {
      type: 'prompt',
      event: 'PreToolUse',
      prompt: 'Evaluate {{command}}',
    };

    it('should return error when no prompt is specified', async () => {
      const hook: SmartHookConfig = { type: 'prompt', event: 'PreToolUse' };
      const result = await runner.runHook(hook, {});
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/no prompt/i);
    });

    it('should return rendered prompt when GROK_API_KEY is missing', async () => {
      delete process.env.GROK_API_KEY;
      const result = await runner.runHook(baseHook, { command: 'rm -rf /' });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('Evaluate rm -rf /');
    });

    it('should return ok: true when LLM response does not contain DENY', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('This looks fine. ALLOW it.'));

      const result = await runner.runHook(baseHook, { command: 'ls' });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('This looks fine. ALLOW it.');
    });

    it('should return ok: false when LLM response contains DENY', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('DENY - this is dangerous'));

      const result = await runner.runHook(baseHook, { command: 'rm -rf /' });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('DENY');
    });

    it('should fail-open (ok: true) when LLM call throws', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockRejectedValueOnce(new Error('API timeout'));

      const result = await runner.runHook(baseHook, { command: 'echo hi' });
      expect(result.ok).toBe(true);
      // Fail-open returns the rendered prompt as output
      expect(result.output).toBe('Evaluate echo hi');
    });
  });

  // -------------------------------------------------------------------------
  // runAgentHook
  // -------------------------------------------------------------------------

  describe('runAgentHook (via runHook)', () => {
    const baseHook: SmartHookConfig = {
      type: 'agent',
      event: 'PreToolUse',
      agentPrompt: 'You are a security guard for {{tool}}.',
      maxTurns: 3,
    };

    it('should return error when no agentPrompt is specified', async () => {
      const hook: SmartHookConfig = { type: 'agent', event: 'PreToolUse' };
      const result = await runner.runHook(hook, {});
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/no agent prompt/i);
    });

    it('should return rendered prompt when GROK_API_KEY is missing', async () => {
      delete process.env.GROK_API_KEY;
      const result = await runner.runHook(baseHook, { tool: 'bash' });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('You are a security guard for bash.');
    });

    it('should return ok: false when LLM responds with DENY', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('DENY - not allowed'));

      const result = await runner.runHook(baseHook, { tool: 'bash' });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('DENY');
    });

    it('should return ok: true when LLM responds with ALLOW', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('ALLOW - looks safe'));

      const result = await runner.runHook(baseHook, { tool: 'read_file' });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('ALLOW - looks safe');
    });

    it('should handle multi-turn when tool_calls are present then final response', async () => {
      process.env.GROK_API_KEY = 'test-key';

      // First call: has tool_calls, triggers continue
      mockChat.mockResolvedValueOnce(
        makeChatResponse('Thinking...', [{ id: 'tc1', function: { name: 'analyze' } }])
      );
      // Second call: no tool_calls, final answer
      mockChat.mockResolvedValueOnce(makeChatResponse('ALLOW - after analysis'));

      const result = await runner.runHook(baseHook, { tool: 'bash' });
      expect(result.ok).toBe(true);
      expect(result.output).toBe('ALLOW - after analysis');
      expect(mockChat).toHaveBeenCalledTimes(2);
    });

    it('should fail-open when LLM call throws', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockRejectedValueOnce(new Error('Network error'));

      const result = await runner.runHook(baseHook, { tool: 'bash' });
      expect(result.ok).toBe(true);
    });
  });
});

// ===========================================================================
// AdvancedHookRunner
// ===========================================================================

describe('AdvancedHookRunner', () => {
  let runner: AdvancedHookRunner;

  beforeEach(() => {
    runner = new AdvancedHookRunner('/tmp');
  });

  // -------------------------------------------------------------------------
  // matchesEvent
  // -------------------------------------------------------------------------

  describe('matchesEvent', () => {
    it('should match when event matches and no matcher is set', () => {
      const hook: AdvancedHook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command',
      };
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(true);
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash')).toBe(true);
    });

    it('should not match when event differs', () => {
      const hook: AdvancedHook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command',
      };
      expect(runner.matchesEvent(hook, HookEvent.PostToolUse)).toBe(false);
    });

    it('should match when matcher regex matches toolName', () => {
      const hook: AdvancedHook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command',
        matcher: /^bash$/,
      };
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'bash')).toBe(true);
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse, 'read_file')).toBe(false);
    });

    it('should not match when matcher is set but no toolName provided', () => {
      const hook: AdvancedHook = {
        name: 'test',
        event: HookEvent.PreToolUse,
        type: 'command',
        matcher: /^bash$/,
      };
      expect(runner.matchesEvent(hook, HookEvent.PreToolUse)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // runPromptHook
  // -------------------------------------------------------------------------

  describe('runPromptHook (via runHook)', () => {
    const context: HookContext = {
      event: HookEvent.PreToolUse,
      toolName: 'bash',
      input: { command: 'ls' },
    };

    it('should allow when no prompt is specified', async () => {
      const hook: AdvancedHook = {
        name: 'no-prompt',
        event: HookEvent.PreToolUse,
        type: 'prompt',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
      expect(decision.additionalContext).toBeUndefined();
    });

    it('should allow with additionalContext when GROK_API_KEY is missing', async () => {
      delete process.env.GROK_API_KEY;
      const hook: AdvancedHook = {
        name: 'check-safety',
        event: HookEvent.PreToolUse,
        type: 'prompt',
        prompt: 'Is this safe?',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
      expect(decision.additionalContext).toBe('Is this safe?');
    });

    it('should return deny when LLM response contains DENY', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('DENY. This is dangerous.'));

      const hook: AdvancedHook = {
        name: 'guard',
        event: HookEvent.PreToolUse,
        type: 'prompt',
        prompt: 'Evaluate safety',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('deny');
      expect(decision.additionalContext).toContain('DENY');
    });

    it('should return ask when LLM response contains ASK', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('ASK the user for confirmation.'));

      const hook: AdvancedHook = {
        name: 'guard',
        event: HookEvent.PreToolUse,
        type: 'prompt',
        prompt: 'Evaluate safety',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('ask');
      expect(decision.additionalContext).toContain('ASK');
    });

    it('should return allow when LLM response contains ALLOW', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('ALLOW. This is fine.'));

      const hook: AdvancedHook = {
        name: 'guard',
        event: HookEvent.PreToolUse,
        type: 'prompt',
        prompt: 'Evaluate safety',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
      expect(decision.additionalContext).toContain('ALLOW');
    });

    it('should allow with prompt as additionalContext when LLM call fails', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockRejectedValueOnce(new Error('Service unavailable'));

      const hook: AdvancedHook = {
        name: 'guard',
        event: HookEvent.PreToolUse,
        type: 'prompt',
        prompt: 'Check this operation',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
      expect(decision.additionalContext).toBe('Check this operation');
    });
  });

  // -------------------------------------------------------------------------
  // runAgentHook
  // -------------------------------------------------------------------------

  describe('runAgentHook (via runHook)', () => {
    const context: HookContext = {
      event: HookEvent.PreBash,
      toolName: 'bash',
      input: { command: 'npm install' },
    };

    it('should allow when GROK_API_KEY is missing', async () => {
      delete process.env.GROK_API_KEY;
      const hook: AdvancedHook = {
        name: 'agent-guard',
        event: HookEvent.PreBash,
        type: 'agent',
        prompt: 'Evaluate bash commands',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
    });

    it('should return the LLM decision', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('DENY - npm install could be risky'));

      const hook: AdvancedHook = {
        name: 'agent-guard',
        event: HookEvent.PreBash,
        type: 'agent',
        prompt: 'You are a security agent.',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('deny');
      expect(decision.additionalContext).toContain('DENY');
    });

    it('should return allow when LLM responds with ALLOW', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockResolvedValueOnce(makeChatResponse('ALLOW - safe command'));

      const hook: AdvancedHook = {
        name: 'agent-guard',
        event: HookEvent.PreBash,
        type: 'agent',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
      expect(decision.additionalContext).toContain('ALLOW');
    });

    it('should handle multi-turn agent evaluation', async () => {
      process.env.GROK_API_KEY = 'test-key';

      // First call has tool_calls
      mockChat.mockResolvedValueOnce(
        makeChatResponse('Analyzing...', [{ id: 'tc1', function: { name: 'check' } }])
      );
      // Second call is the final decision
      mockChat.mockResolvedValueOnce(makeChatResponse('ASK - need user confirmation'));

      const hook: AdvancedHook = {
        name: 'agent-guard',
        event: HookEvent.PreBash,
        type: 'agent',
        prompt: 'Security agent',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('ask');
      expect(mockChat).toHaveBeenCalledTimes(2);
    });

    it('should allow when LLM call fails', async () => {
      process.env.GROK_API_KEY = 'test-key';
      mockChat.mockRejectedValueOnce(new Error('Timeout'));

      const hook: AdvancedHook = {
        name: 'agent-guard',
        event: HookEvent.PreBash,
        type: 'agent',
      };
      const decision = await runner.runHook(hook, context);
      expect(decision.action).toBe('allow');
    });
  });
});
