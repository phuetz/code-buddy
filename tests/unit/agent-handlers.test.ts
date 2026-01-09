/**
 * Unit Tests for Agent Handlers
 *
 * Tests cover:
 * - handleAgent function with various subcommands
 * - Agent listing (no args)
 * - Agent creation
 * - Agent info display
 * - Agent activation
 * - Agent reload
 * - checkAgentTriggers function
 * - Error handling for missing agents
 */

import {
  handleAgent,
  checkAgentTriggers,
  CommandHandlerResult,
} from '../../src/commands/handlers/agent-handlers';
import {
  getCustomAgentLoader,
  resetCustomAgentLoader,
  CustomAgentLoader,
  CustomAgentConfig,
} from '../../src/agent/custom/custom-agent-loader';

// Mock the custom-agent-loader module
jest.mock('../../src/agent/custom/custom-agent-loader', () => {
  const mockLoader = {
    formatAgentList: jest.fn(),
    listAgents: jest.fn(),
    getAgent: jest.fn(),
    createAgent: jest.fn(),
    findByTrigger: jest.fn(),
  };

  return {
    getCustomAgentLoader: jest.fn(() => mockLoader),
    resetCustomAgentLoader: jest.fn(),
    CustomAgentLoader: jest.fn(),
  };
});

describe('Agent Handlers', () => {
  let mockLoader: {
    formatAgentList: jest.Mock;
    listAgents: jest.Mock;
    getAgent: jest.Mock;
    createAgent: jest.Mock;
    findByTrigger: jest.Mock;
  };

  const sampleAgent: CustomAgentConfig = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for unit testing',
    systemPrompt: 'You are a test agent. Help users with testing.',
    model: 'grok-4-latest',
    temperature: 0.7,
    maxTokens: 4000,
    tags: ['test', 'unit-test'],
    triggers: ['test this', 'run test'],
    author: 'Test Author',
    version: '1.0.0',
  };

  const sampleAgent2: CustomAgentConfig = {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code for best practices',
    systemPrompt: 'You are a code reviewer.',
    tags: ['code', 'review'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoader = (getCustomAgentLoader as jest.Mock)();
    mockLoader.formatAgentList.mockReturnValue('No custom agents found.');
    mockLoader.listAgents.mockReturnValue([]);
    mockLoader.getAgent.mockReturnValue(null);
    mockLoader.createAgent.mockReturnValue('/home/user/.codebuddy/agents/test.toml');
    mockLoader.findByTrigger.mockReturnValue([]);
  });

  // ============================================
  // handleAgent - No Arguments (List Agents)
  // ============================================
  describe('handleAgent - List Agents', () => {
    test('should list agents when no arguments provided', () => {
      const formattedList = `Custom Agents:
${'─'.repeat(50)}
  test-agent: Test Agent [test, unit-test]
    A test agent for unit testing`;

      mockLoader.formatAgentList.mockReturnValue(formattedList);

      const result = handleAgent([]);

      expect(result.handled).toBe(true);
      expect(result.output).toBe(formattedList);
      expect(mockLoader.formatAgentList).toHaveBeenCalled();
    });

    test('should show empty message when no agents exist', () => {
      const emptyMessage = `No custom agents found.

Create agents in: /home/user/.codebuddy/agents
Example file: /home/user/.codebuddy/agents/_example.toml

Use /agent create <name> to create a new agent interactively.`;

      mockLoader.formatAgentList.mockReturnValue(emptyMessage);

      const result = handleAgent([]);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('No custom agents found');
    });
  });

  // ============================================
  // handleAgent - Create Subcommand
  // ============================================
  describe('handleAgent - Create Subcommand', () => {
    test('should show usage when create has no name', () => {
      const result = handleAgent(['create']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Usage: /agent create <name>');
      expect(result.output).toContain('Example:');
      expect(result.output).toContain('/agent create code-reviewer');
    });

    test('should create agent with single word name', () => {
      mockLoader.createAgent.mockReturnValue('/home/user/.codebuddy/agents/reviewer.toml');

      const result = handleAgent(['create', 'reviewer']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Created agent "reviewer"');
      expect(result.output).toContain('/home/user/.codebuddy/agents/reviewer.toml');
      expect(mockLoader.createAgent).toHaveBeenCalledWith(
        'reviewer',
        'Custom agent: reviewer',
        'You are reviewer. Help the user with their tasks.'
      );
    });

    test('should create agent with multi-word name', () => {
      mockLoader.createAgent.mockReturnValue('/home/user/.codebuddy/agents/security-analyst.toml');

      const result = handleAgent(['create', 'Security', 'Analyst']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Created agent "Security Analyst"');
      expect(mockLoader.createAgent).toHaveBeenCalledWith(
        'Security Analyst',
        'Custom agent: Security Analyst',
        'You are Security Analyst. Help the user with their tasks.'
      );
    });

    test('should show activation command after creation', () => {
      mockLoader.createAgent.mockReturnValue('/home/user/.codebuddy/agents/code-helper.toml');

      const result = handleAgent(['create', 'Code', 'Helper']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('/agent code-helper');
    });

    test('should handle creation error', () => {
      mockLoader.createAgent.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = handleAgent(['create', 'test']);

      expect(result.handled).toBe(true);
      expect(result.error).toContain('Failed to create agent');
      expect(result.error).toContain('Permission denied');
    });
  });

  // ============================================
  // handleAgent - Info Subcommand
  // ============================================
  describe('handleAgent - Info Subcommand', () => {
    test('should show usage when info has no agent id', () => {
      const result = handleAgent(['info']);

      expect(result.handled).toBe(true);
      expect(result.output).toBe('Usage: /agent info <agent-id>');
    });

    test('should show agent details', () => {
      mockLoader.getAgent.mockReturnValue(sampleAgent);

      const result = handleAgent(['info', 'test-agent']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Agent: Test Agent');
      expect(result.output).toContain('ID: test-agent');
      expect(result.output).toContain('Description: A test agent for unit testing');
      expect(result.output).toContain('Author: Test Author');
      expect(result.output).toContain('Version: 1.0.0');
      expect(result.output).toContain('Model: grok-4-latest');
      expect(result.output).toContain('Temperature: 0.7');
      expect(result.output).toContain('Max Tokens: 4000');
      expect(result.output).toContain('Tags: test, unit-test');
      expect(result.output).toContain('Triggers: test this, run test');
      expect(result.output).toContain('System Prompt:');
      expect(result.output).toContain('You are a test agent');
    });

    test('should show agent with minimal fields', () => {
      const minimalAgent: CustomAgentConfig = {
        id: 'minimal',
        name: 'Minimal Agent',
        description: '',
        systemPrompt: 'Minimal prompt',
      };
      mockLoader.getAgent.mockReturnValue(minimalAgent);

      const result = handleAgent(['info', 'minimal']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Agent: Minimal Agent');
      expect(result.output).toContain('ID: minimal');
      expect(result.output).toContain('Description: (none)');
    });

    test('should show agent with tools configuration', () => {
      const toolAgent: CustomAgentConfig = {
        id: 'tool-agent',
        name: 'Tool Agent',
        description: 'Agent with tool configuration',
        systemPrompt: 'Use tools wisely',
        tools: ['read_file', 'write_file', 'bash'],
        disabledTools: ['delete_file'],
      };
      mockLoader.getAgent.mockReturnValue(toolAgent);

      const result = handleAgent(['info', 'tool-agent']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Allowed Tools: read_file, write_file, bash');
      expect(result.output).toContain('Disabled Tools: delete_file');
    });

    test('should truncate long system prompts', () => {
      const longPromptAgent: CustomAgentConfig = {
        id: 'long-prompt',
        name: 'Long Prompt Agent',
        description: 'Agent with long prompt',
        systemPrompt: 'A'.repeat(600),
      };
      mockLoader.getAgent.mockReturnValue(longPromptAgent);

      const result = handleAgent(['info', 'long-prompt']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('A'.repeat(500));
      expect(result.output).toContain('...');
    });

    test('should show error for non-existent agent', () => {
      mockLoader.getAgent.mockReturnValue(null);
      mockLoader.listAgents.mockReturnValue([sampleAgent, sampleAgent2]);

      const result = handleAgent(['info', 'nonexistent']);

      expect(result.handled).toBe(true);
      expect(result.error).toContain('Agent "nonexistent" not found');
    });

    test('should suggest similar agents when not found', () => {
      mockLoader.getAgent.mockReturnValue(null);
      mockLoader.listAgents.mockReturnValue([sampleAgent, sampleAgent2]);

      const result = handleAgent(['info', 'test']);

      expect(result.handled).toBe(true);
      expect(result.error).toContain('Did you mean: test-agent');
    });
  });

  // ============================================
  // handleAgent - Reload Subcommand
  // ============================================
  describe('handleAgent - Reload Subcommand', () => {
    test('should reload agents and show count', () => {
      mockLoader.listAgents.mockReturnValue([sampleAgent, sampleAgent2]);

      const result = handleAgent(['reload']);

      expect(result.handled).toBe(true);
      expect(result.output).toBe('Reloaded 2 custom agent(s).');
    });

    test('should show zero when no agents exist', () => {
      mockLoader.listAgents.mockReturnValue([]);

      const result = handleAgent(['reload']);

      expect(result.handled).toBe(true);
      expect(result.output).toBe('Reloaded 0 custom agent(s).');
    });
  });

  // ============================================
  // handleAgent - Activate Agent
  // ============================================
  describe('handleAgent - Activate Agent', () => {
    test('should activate agent by id', () => {
      mockLoader.getAgent.mockReturnValue(sampleAgent);

      const result = handleAgent(['test-agent']);

      expect(result.handled).toBe(true);
      expect(result.output).toBe('Activated agent: Test Agent');
      expect(result.passToAI).toBe(true);
      expect(result.systemPrompt).toBe(sampleAgent.systemPrompt);
      expect(result.prompt).toContain('You are now activated as "Test Agent"');
    });

    test('should use custom prompt when additional args provided', () => {
      mockLoader.getAgent.mockReturnValue(sampleAgent);

      const result = handleAgent(['test-agent', 'Review', 'this', 'code']);

      expect(result.handled).toBe(true);
      expect(result.passToAI).toBe(true);
      expect(result.prompt).toBe('Review this code');
    });

    test('should show error for non-existent agent', () => {
      mockLoader.getAgent.mockReturnValue(null);
      mockLoader.listAgents.mockReturnValue([sampleAgent]);

      const result = handleAgent(['invalid-agent']);

      expect(result.handled).toBe(true);
      expect(result.error).toContain('Agent "invalid-agent" not found');
      expect(result.error).toContain('Use /agent to list available agents');
    });

    test('should suggest similar agents when activation fails', () => {
      mockLoader.getAgent.mockReturnValue(null);
      mockLoader.listAgents.mockReturnValue([sampleAgent, sampleAgent2]);

      const result = handleAgent(['reviewer']);

      expect(result.handled).toBe(true);
      expect(result.error).toContain('Did you mean: code-reviewer');
    });
  });

  // ============================================
  // handleAgent - Case Insensitive Subcommands
  // ============================================
  describe('handleAgent - Case Insensitivity', () => {
    test('should handle CREATE in uppercase', () => {
      const result = handleAgent(['CREATE']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Usage: /agent create <name>');
    });

    test('should handle Info in mixed case', () => {
      const result = handleAgent(['Info']);

      expect(result.handled).toBe(true);
      expect(result.output).toBe('Usage: /agent info <agent-id>');
    });

    test('should handle RELOAD in uppercase', () => {
      mockLoader.listAgents.mockReturnValue([]);

      const result = handleAgent(['RELOAD']);

      expect(result.handled).toBe(true);
      expect(result.output).toContain('Reloaded');
    });
  });

  // ============================================
  // checkAgentTriggers
  // ============================================
  describe('checkAgentTriggers', () => {
    test('should return null when no triggers match', () => {
      mockLoader.findByTrigger.mockReturnValue([]);

      const result = checkAgentTriggers('hello world');

      expect(result).toBeNull();
    });

    test('should return result when trigger matches', () => {
      mockLoader.findByTrigger.mockReturnValue([sampleAgent]);

      const result = checkAgentTriggers('test this code please');

      expect(result).not.toBeNull();
      expect(result?.handled).toBe(false);
      expect(result?.passToAI).toBe(true);
      expect(result?.systemPrompt).toBe(sampleAgent.systemPrompt);
    });

    test('should use first matching agent when multiple match', () => {
      mockLoader.findByTrigger.mockReturnValue([sampleAgent, sampleAgent2]);

      const result = checkAgentTriggers('test this');

      expect(result).not.toBeNull();
      expect(result?.systemPrompt).toBe(sampleAgent.systemPrompt);
    });

    test('should call findByTrigger with input', () => {
      const input = 'run test on my code';
      mockLoader.findByTrigger.mockReturnValue([]);

      checkAgentTriggers(input);

      expect(mockLoader.findByTrigger).toHaveBeenCalledWith(input);
    });
  });

  // ============================================
  // CommandHandlerResult Interface
  // ============================================
  describe('CommandHandlerResult Interface', () => {
    test('should have correct structure for list result', () => {
      mockLoader.formatAgentList.mockReturnValue('Agent list');

      const result = handleAgent([]);

      expect(typeof result.handled).toBe('boolean');
      expect(typeof result.output).toBe('string');
      expect(result.error).toBeUndefined();
      expect(result.passToAI).toBeUndefined();
    });

    test('should have correct structure for activate result', () => {
      mockLoader.getAgent.mockReturnValue(sampleAgent);

      const result = handleAgent(['test-agent']);

      expect(typeof result.handled).toBe('boolean');
      expect(typeof result.output).toBe('string');
      expect(typeof result.passToAI).toBe('boolean');
      expect(typeof result.systemPrompt).toBe('string');
      expect(typeof result.prompt).toBe('string');
    });

    test('should have correct structure for error result', () => {
      mockLoader.getAgent.mockReturnValue(null);
      mockLoader.listAgents.mockReturnValue([]);

      const result = handleAgent(['info', 'missing']);

      expect(typeof result.handled).toBe('boolean');
      expect(typeof result.error).toBe('string');
    });
  });
});
