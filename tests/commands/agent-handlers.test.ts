/**
 * Tests for Agent Command Handlers
 */

import {
  handleAgent,
  checkAgentTriggers,
  CommandHandlerResult,
} from '../../src/commands/handlers/agent-handlers.js';

// Mock the custom agent loader
jest.mock('../../src/agent/custom/custom-agent-loader.js', () => {
  const mockAgents = [
    {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent for testing',
      systemPrompt: 'You are a test agent.',
      triggers: ['test trigger', 'testing'],
      author: 'Test Author',
      version: '1.0.0',
      model: 'grok-3-latest',
      temperature: 0.7,
      maxTokens: 4000,
      tags: ['test', 'demo'],
      tools: ['read', 'write'],
      disabledTools: ['bash'],
    },
    {
      id: 'code-helper',
      name: 'Code Helper',
      description: 'Helps with code',
      systemPrompt: 'You are a code helper. Help with coding tasks.',
      triggers: ['help me code', 'coding help'],
    },
  ];

  return {
    getCustomAgentLoader: jest.fn(() => ({
      listAgents: jest.fn(() => mockAgents),
      getAgent: jest.fn((id: string) => mockAgents.find(a => a.id === id)),
      formatAgentList: jest.fn(() => `Available Agents:\n${mockAgents.map(a => `- ${a.id}: ${a.name}`).join('\n')}`),
      createAgent: jest.fn((name: string) => `/home/user/.codebuddy/agents/${name}.toml`),
      findByTrigger: jest.fn((input: string) => {
        const lower = input.toLowerCase();
        return mockAgents.filter(a =>
          a.triggers?.some(t => lower.includes(t.toLowerCase()))
        );
      }),
    })),
  };
});

describe('Agent Handlers', () => {
  describe('handleAgent', () => {
    it('should list agents when no args', () => {
      const result = handleAgent([]);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Available Agents');
      expect(result.output).toContain('test-agent');
    });

    describe('agent info', () => {
      it('should show agent info', () => {
        const result = handleAgent(['info', 'test-agent']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('Test Agent');
        expect(result.output).toContain('A test agent for testing');
      });

      it('should show detailed agent information', () => {
        const result = handleAgent(['info', 'test-agent']);

        expect(result.output).toContain('ID: test-agent');
        expect(result.output).toContain('Author: Test Author');
        expect(result.output).toContain('Version: 1.0.0');
        expect(result.output).toContain('Model: grok-3-latest');
        expect(result.output).toContain('Temperature: 0.7');
        expect(result.output).toContain('Max Tokens: 4000');
      });

      it('should show tags and triggers', () => {
        const result = handleAgent(['info', 'test-agent']);

        expect(result.output).toContain('Tags: test, demo');
        expect(result.output).toContain('Triggers: test trigger, testing');
      });

      it('should show tools configuration', () => {
        const result = handleAgent(['info', 'test-agent']);

        expect(result.output).toContain('Allowed Tools: read, write');
        expect(result.output).toContain('Disabled Tools: bash');
      });

      it('should show system prompt (truncated)', () => {
        const result = handleAgent(['info', 'test-agent']);

        expect(result.output).toContain('System Prompt:');
        expect(result.output).toContain('You are a test agent');
      });

      it('should show usage when no agent id provided', () => {
        const result = handleAgent(['info']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('Usage:');
        expect(result.output).toContain('/agent info');
      });

      it('should handle unknown agent with suggestions', () => {
        const result = handleAgent(['info', 'test']);

        expect(result.handled).toBe(true);
        expect(result.error).toContain('not found');
        // Should suggest similar agents
        expect(result.error).toContain('test-agent');
      });
    });

    describe('agent create', () => {
      it('should create new agent', () => {
        const result = handleAgent(['create', 'my-agent']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('Created agent');
        expect(result.output).toContain('my-agent');
        expect(result.output).toContain('.toml');
      });

      it('should show usage when no name provided', () => {
        const result = handleAgent(['create']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('Usage:');
        expect(result.output).toContain('/agent create');
      });

      it('should handle agent name with spaces', () => {
        const result = handleAgent(['create', 'My', 'Custom', 'Agent']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('My Custom Agent');
      });

      it('should show customization hints', () => {
        const result = handleAgent(['create', 'new-agent']);

        expect(result.output).toContain('systemPrompt');
        expect(result.output).toContain('triggers');
        expect(result.output).toContain('tools');
        expect(result.output).toContain('temperature');
      });
    });

    describe('agent reload', () => {
      it('should reload agents', () => {
        const result = handleAgent(['reload']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('Reloaded');
        expect(result.output).toContain('custom agent');
      });
    });

    describe('agent activation', () => {
      it('should activate agent by id', () => {
        const result = handleAgent(['test-agent']);

        expect(result.handled).toBe(true);
        expect(result.output).toContain('Activated agent');
        expect(result.output).toContain('Test Agent');
        expect(result.passToAI).toBe(true);
        expect(result.systemPrompt).toBe('You are a test agent.');
      });

      it('should pass additional args as prompt', () => {
        const result = handleAgent(['test-agent', 'help', 'me', 'with', 'this']);

        expect(result.prompt).toBe('help me with this');
      });

      it('should use default prompt when no additional args', () => {
        const result = handleAgent(['test-agent']);

        expect(result.prompt).toContain('How can I help you');
      });

      it('should handle unknown agent with suggestions', () => {
        const result = handleAgent(['unknown-agent']);

        expect(result.handled).toBe(true);
        expect(result.error).toContain('not found');
        expect(result.error).toContain('/agent');
      });

      it('should suggest similar agents', () => {
        const result = handleAgent(['test']);

        expect(result.error).toContain('Did you mean');
        expect(result.error).toContain('test-agent');
      });
    });
  });

  describe('checkAgentTriggers', () => {
    it('should return null for non-triggering input', () => {
      const result = checkAgentTriggers('hello world');

      expect(result).toBeNull();
    });

    it('should match agent by trigger phrase', () => {
      const result = checkAgentTriggers('I need test trigger help');

      expect(result).not.toBeNull();
      expect(result?.passToAI).toBe(true);
      expect(result?.systemPrompt).toBe('You are a test agent.');
    });

    it('should match case-insensitively', () => {
      const result = checkAgentTriggers('TEST TRIGGER please');

      expect(result).not.toBeNull();
      expect(result?.systemPrompt).toBeDefined();
    });

    it('should return first matching agent', () => {
      const result = checkAgentTriggers('testing this feature');

      expect(result).not.toBeNull();
      expect(result?.handled).toBe(false); // Don't fully handle
    });

    it('should match code helper triggers', () => {
      const result = checkAgentTriggers('help me code a function');

      expect(result).not.toBeNull();
      expect(result?.systemPrompt).toContain('code helper');
    });
  });
});

describe('CommandHandlerResult Interface', () => {
  it('should support output field', () => {
    const result: CommandHandlerResult = {
      handled: true,
      output: 'Command output',
    };

    expect(result.output).toBe('Command output');
  });

  it('should support error field', () => {
    const result: CommandHandlerResult = {
      handled: true,
      error: 'An error occurred',
    };

    expect(result.error).toBe('An error occurred');
  });

  it('should support systemPrompt for agent activation', () => {
    const result: CommandHandlerResult = {
      handled: true,
      passToAI: true,
      systemPrompt: 'Custom system prompt',
      prompt: 'User prompt',
    };

    expect(result.systemPrompt).toBe('Custom system prompt');
    expect(result.prompt).toBe('User prompt');
  });

  it('should support partial handling', () => {
    const result: CommandHandlerResult = {
      handled: false,
      passToAI: true,
      systemPrompt: 'Modified context',
    };

    expect(result.handled).toBe(false);
    expect(result.passToAI).toBe(true);
  });
});
