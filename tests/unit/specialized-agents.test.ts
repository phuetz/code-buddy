/**
 * Unit tests for SpecializedAgentManager
 * Tests agent registration, selection, and management
 */

import SpecializedAgentManager, {
  getSpecializedAgentManager,
  SpecializedAgent,
  AgentCapability,
  Language,
  Framework,
} from '../../src/advanced/specialized-agents';

describe('SpecializedAgentManager', () => {
  let manager: SpecializedAgentManager;

  beforeEach(() => {
    manager = new SpecializedAgentManager();
  });

  describe('Constructor and Initialization', () => {
    it('should create manager with built-in agents', () => {
      expect(manager).toBeInstanceOf(SpecializedAgentManager);
      const agents = manager.getAgents();
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should have TypeScript expert agent', () => {
      const agent = manager.getAgent('typescript-expert');
      expect(agent).toBeDefined();
      expect(agent!.name).toContain('TypeScript');
    });

    it('should have Python expert agent', () => {
      const agent = manager.getAgent('python-expert');
      expect(agent).toBeDefined();
      expect(agent!.name).toContain('Python');
    });

    it('should have Rust expert agent', () => {
      const agent = manager.getAgent('rust-expert');
      expect(agent).toBeDefined();
      expect(agent!.name).toContain('Rust');
    });

    it('should have React expert agent', () => {
      const agent = manager.getAgent('react-expert');
      expect(agent).toBeDefined();
      expect(agent!.name).toContain('React');
    });
  });

  describe('getAgents()', () => {
    it('should return all registered agents', () => {
      const agents = manager.getAgents();
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThanOrEqual(4);
    });

    it('should return array of SpecializedAgent objects', () => {
      const agents = manager.getAgents();
      agents.forEach(agent => {
        expect(agent).toHaveProperty('id');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('description');
        expect(agent).toHaveProperty('capabilities');
        expect(agent).toHaveProperty('systemPrompt');
        expect(agent).toHaveProperty('examples');
      });
    });

    it('should return a copy of agents array', () => {
      const agents1 = manager.getAgents();
      const agents2 = manager.getAgents();
      expect(agents1).not.toBe(agents2);
      expect(agents1).toEqual(agents2);
    });
  });

  describe('getAgent()', () => {
    it('should return agent by ID', () => {
      const agent = manager.getAgent('typescript-expert');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('typescript-expert');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = manager.getAgent('non-existent-agent');
      expect(agent).toBeUndefined();
    });

    it('should return correct agent properties', () => {
      const agent = manager.getAgent('typescript-expert');
      expect(agent!.capabilities.languages).toContain('typescript');
      expect(agent!.capabilities.languages).toContain('javascript');
      expect(agent!.systemPrompt).toContain('TypeScript');
    });
  });

  describe('selectAgentForLanguage()', () => {
    it('should find agent for TypeScript', () => {
      const agent = manager.selectAgentForLanguage('typescript');
      expect(agent).toBeDefined();
      expect(agent!.capabilities.languages).toContain('typescript');
    });

    it('should find agent for JavaScript', () => {
      const agent = manager.selectAgentForLanguage('javascript');
      expect(agent).toBeDefined();
      expect(agent!.capabilities.languages).toContain('javascript');
    });

    it('should find agent for Python', () => {
      const agent = manager.selectAgentForLanguage('python');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('python-expert');
    });

    it('should find agent for Rust', () => {
      const agent = manager.selectAgentForLanguage('rust');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('rust-expert');
    });

    it('should find agent for Go', () => {
      const agent = manager.selectAgentForLanguage('go');
      expect(agent).toBeUndefined(); // No Go expert in default agents
    });

    it('should find agent for Java', () => {
      const agent = manager.selectAgentForLanguage('java');
      expect(agent).toBeUndefined(); // No Java expert in default agents
    });

    it('should find agent for C#', () => {
      const agent = manager.selectAgentForLanguage('csharp');
      expect(agent).toBeUndefined(); // No C# expert in default agents
    });

    it('should return first matching agent', () => {
      // TypeScript is supported by multiple agents
      const agent = manager.selectAgentForLanguage('typescript');
      expect(agent).toBeDefined();
    });
  });

  describe('selectAgentForFramework()', () => {
    it('should find agent for React', () => {
      const agent = manager.selectAgentForFramework('react');
      expect(agent).toBeDefined();
      expect(agent!.capabilities.frameworks).toContain('react');
    });

    it('should find agent for Next.js', () => {
      const agent = manager.selectAgentForFramework('nextjs');
      expect(agent).toBeDefined();
      expect(agent!.capabilities.frameworks).toContain('nextjs');
    });

    it('should find agent for Express', () => {
      const agent = manager.selectAgentForFramework('express');
      expect(agent).toBeDefined();
      expect(agent!.capabilities.frameworks).toContain('express');
    });

    it('should find agent for FastAPI', () => {
      const agent = manager.selectAgentForFramework('fastapi');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('python-expert');
    });

    it('should find agent for Django', () => {
      const agent = manager.selectAgentForFramework('django');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('python-expert');
    });

    it('should return undefined for Vue', () => {
      const agent = manager.selectAgentForFramework('vue');
      expect(agent).toBeUndefined(); // No Vue expert in default agents
    });

    it('should return undefined for Angular', () => {
      const agent = manager.selectAgentForFramework('angular');
      expect(agent).toBeUndefined(); // No Angular expert in default agents
    });
  });

  describe('autoSelectAgent()', () => {
    it('should prioritize framework over language', () => {
      const agent = manager.autoSelectAgent({
        language: 'python',
        framework: 'react',
      });
      // React should be selected because framework is prioritized
      expect(agent).toBeDefined();
      expect(agent!.capabilities.frameworks).toContain('react');
    });

    it('should select by language when no framework', () => {
      const agent = manager.autoSelectAgent({
        language: 'python',
      });
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('python-expert');
    });

    it('should select by framework when no language', () => {
      const agent = manager.autoSelectAgent({
        framework: 'fastapi',
      });
      expect(agent).toBeDefined();
      expect(agent!.capabilities.frameworks).toContain('fastapi');
    });

    it('should fall back to language if framework not found', () => {
      const agent = manager.autoSelectAgent({
        language: 'rust',
        framework: 'vue', // Vue not supported
      });
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('rust-expert');
    });

    it('should return undefined if nothing matches', () => {
      const agent = manager.autoSelectAgent({
        language: 'go',
        framework: 'angular',
      });
      expect(agent).toBeUndefined();
    });

    it('should return undefined for empty context', () => {
      const agent = manager.autoSelectAgent({});
      expect(agent).toBeUndefined();
    });
  });

  describe('setCurrentAgent()', () => {
    it('should set current agent and return true', () => {
      const result = manager.setCurrentAgent('typescript-expert');
      expect(result).toBe(true);
    });

    it('should return false for non-existent agent', () => {
      const result = manager.setCurrentAgent('non-existent');
      expect(result).toBe(false);
    });

    it('should emit "agent-selected" event', () => {
      const handler = jest.fn();
      manager.on('agent-selected', handler);

      manager.setCurrentAgent('typescript-expert');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'typescript-expert',
        })
      );
    });

    it('should not emit event for non-existent agent', () => {
      const handler = jest.fn();
      manager.on('agent-selected', handler);

      manager.setCurrentAgent('non-existent');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should allow changing current agent', () => {
      manager.setCurrentAgent('typescript-expert');
      expect(manager.getCurrentAgent()!.id).toBe('typescript-expert');

      manager.setCurrentAgent('python-expert');
      expect(manager.getCurrentAgent()!.id).toBe('python-expert');
    });
  });

  describe('getCurrentAgent()', () => {
    it('should return null initially', () => {
      expect(manager.getCurrentAgent()).toBeNull();
    });

    it('should return current agent after setting', () => {
      manager.setCurrentAgent('rust-expert');
      const current = manager.getCurrentAgent();

      expect(current).not.toBeNull();
      expect(current!.id).toBe('rust-expert');
    });
  });

  describe('registerAgent()', () => {
    it('should register a new agent', () => {
      const newAgent: SpecializedAgent = {
        id: 'custom-agent',
        name: 'Custom Agent',
        description: 'A custom specialized agent',
        capabilities: {
          languages: ['go'],
          frameworks: [],
          specialties: ['concurrency', 'channels'],
        },
        systemPrompt: 'You are a Go expert.',
        examples: [],
      };

      manager.registerAgent(newAgent);

      const agent = manager.getAgent('custom-agent');
      expect(agent).toBeDefined();
      expect(agent!.name).toBe('Custom Agent');
    });

    it('should emit "agent-registered" event', () => {
      const handler = jest.fn();
      manager.on('agent-registered', handler);

      const newAgent: SpecializedAgent = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Test',
        capabilities: { languages: [], frameworks: [], specialties: [] },
        systemPrompt: 'Test',
        examples: [],
      };

      manager.registerAgent(newAgent);

      expect(handler).toHaveBeenCalledWith(newAgent);
    });

    it('should allow new agent to be selected', () => {
      const goAgent: SpecializedAgent = {
        id: 'go-expert',
        name: 'Go Expert',
        description: 'Specialized in Go',
        capabilities: {
          languages: ['go'],
          frameworks: [],
          specialties: ['goroutines'],
        },
        systemPrompt: 'You are a Go expert.',
        examples: [],
      };

      manager.registerAgent(goAgent);

      const agent = manager.selectAgentForLanguage('go');
      expect(agent).toBeDefined();
      expect(agent!.id).toBe('go-expert');
    });

    it('should overwrite existing agent with same ID', () => {
      const updatedAgent: SpecializedAgent = {
        id: 'typescript-expert',
        name: 'Updated TypeScript Expert',
        description: 'Updated description',
        capabilities: {
          languages: ['typescript'],
          frameworks: [],
          specialties: ['updated'],
        },
        systemPrompt: 'Updated prompt',
        examples: [],
      };

      manager.registerAgent(updatedAgent);

      const agent = manager.getAgent('typescript-expert');
      expect(agent!.name).toBe('Updated TypeScript Expert');
    });

    it('should allow registering agent with examples', () => {
      const agentWithExamples: SpecializedAgent = {
        id: 'example-agent',
        name: 'Example Agent',
        description: 'Agent with examples',
        capabilities: { languages: [], frameworks: [], specialties: [] },
        systemPrompt: 'Test',
        examples: [
          { input: 'How to do X?', output: 'Do it like this...' },
          { input: 'Explain Y', output: 'Y is...' },
        ],
      };

      manager.registerAgent(agentWithExamples);

      const agent = manager.getAgent('example-agent');
      expect(agent!.examples).toHaveLength(2);
    });
  });

  describe('Agent Properties', () => {
    describe('TypeScript Expert', () => {
      it('should have correct capabilities', () => {
        const agent = manager.getAgent('typescript-expert')!;
        expect(agent.capabilities.languages).toContain('typescript');
        expect(agent.capabilities.languages).toContain('javascript');
        expect(agent.capabilities.frameworks).toContain('react');
        expect(agent.capabilities.frameworks).toContain('nextjs');
        expect(agent.capabilities.frameworks).toContain('express');
      });

      it('should have specialties', () => {
        const agent = manager.getAgent('typescript-expert')!;
        expect(agent.capabilities.specialties).toContain('type inference');
        expect(agent.capabilities.specialties).toContain('generics');
      });

      it('should have system prompt', () => {
        const agent = manager.getAgent('typescript-expert')!;
        expect(agent.systemPrompt).toContain('TypeScript');
        expect(agent.systemPrompt).toContain('type');
      });
    });

    describe('Python Expert', () => {
      it('should have correct capabilities', () => {
        const agent = manager.getAgent('python-expert')!;
        expect(agent.capabilities.languages).toContain('python');
        expect(agent.capabilities.frameworks).toContain('fastapi');
        expect(agent.capabilities.frameworks).toContain('django');
      });

      it('should have specialties', () => {
        const agent = manager.getAgent('python-expert')!;
        expect(agent.capabilities.specialties).toContain('async/await');
        expect(agent.capabilities.specialties).toContain('type hints');
      });
    });

    describe('Rust Expert', () => {
      it('should have correct capabilities', () => {
        const agent = manager.getAgent('rust-expert')!;
        expect(agent.capabilities.languages).toContain('rust');
        expect(agent.capabilities.frameworks).toEqual([]);
      });

      it('should have specialties', () => {
        const agent = manager.getAgent('rust-expert')!;
        expect(agent.capabilities.specialties).toContain('ownership');
        expect(agent.capabilities.specialties).toContain('lifetimes');
        expect(agent.capabilities.specialties).toContain('concurrency');
      });
    });

    describe('React Expert', () => {
      it('should have correct capabilities', () => {
        const agent = manager.getAgent('react-expert')!;
        expect(agent.capabilities.languages).toContain('typescript');
        expect(agent.capabilities.languages).toContain('javascript');
        expect(agent.capabilities.frameworks).toContain('react');
        expect(agent.capabilities.frameworks).toContain('nextjs');
      });

      it('should have specialties', () => {
        const agent = manager.getAgent('react-expert')!;
        expect(agent.capabilities.specialties).toContain('hooks');
        expect(agent.capabilities.specialties).toContain('state management');
        expect(agent.capabilities.specialties).toContain('performance');
      });
    });
  });

  describe('Event Emission', () => {
    it('should support multiple listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      manager.on('agent-selected', handler1);
      manager.on('agent-selected', handler2);

      manager.setCurrentAgent('typescript-expert');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should emit events for registration and selection', () => {
      const registeredHandler = jest.fn();
      const selectedHandler = jest.fn();

      manager.on('agent-registered', registeredHandler);
      manager.on('agent-selected', selectedHandler);

      const newAgent: SpecializedAgent = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        capabilities: { languages: [], frameworks: [], specialties: [] },
        systemPrompt: 'Test',
        examples: [],
      };

      manager.registerAgent(newAgent);
      manager.setCurrentAgent('test');

      expect(registeredHandler).toHaveBeenCalled();
      expect(selectedHandler).toHaveBeenCalled();
    });
  });
});

describe('getSpecializedAgentManager singleton', () => {
  it('should return a SpecializedAgentManager instance', () => {
    const manager = getSpecializedAgentManager();
    expect(manager).toBeInstanceOf(SpecializedAgentManager);
  });

  it('should return same instance on multiple calls', () => {
    const manager1 = getSpecializedAgentManager();
    const manager2 = getSpecializedAgentManager();
    expect(manager1).toBe(manager2);
  });
});

describe('Edge Cases', () => {
  let manager: SpecializedAgentManager;

  beforeEach(() => {
    manager = new SpecializedAgentManager();
  });

  it('should handle agent with empty capabilities', () => {
    const emptyAgent: SpecializedAgent = {
      id: 'empty-agent',
      name: 'Empty Agent',
      description: 'Agent with empty capabilities',
      capabilities: {
        languages: [],
        frameworks: [],
        specialties: [],
      },
      systemPrompt: 'Empty',
      examples: [],
    };

    manager.registerAgent(emptyAgent);

    const agent = manager.getAgent('empty-agent');
    expect(agent).toBeDefined();
    expect(agent!.capabilities.languages).toHaveLength(0);
  });

  it('should handle agent with many languages', () => {
    const polyglotAgent: SpecializedAgent = {
      id: 'polyglot',
      name: 'Polyglot',
      description: 'Knows many languages',
      capabilities: {
        languages: ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'csharp'],
        frameworks: [],
        specialties: [],
      },
      systemPrompt: 'I know many languages',
      examples: [],
    };

    manager.registerAgent(polyglotAgent);

    // Should be findable for any language
    expect(manager.selectAgentForLanguage('go')).toBeDefined();
    expect(manager.selectAgentForLanguage('java')).toBeDefined();
    expect(manager.selectAgentForLanguage('csharp')).toBeDefined();
  });

  it('should handle rapid agent selection changes', () => {
    for (let i = 0; i < 100; i++) {
      const agents = ['typescript-expert', 'python-expert', 'rust-expert', 'react-expert'];
      const randomAgent = agents[i % agents.length];
      manager.setCurrentAgent(randomAgent);
    }

    const current = manager.getCurrentAgent();
    expect(current).toBeDefined();
  });

  it('should handle registering many custom agents', () => {
    for (let i = 0; i < 50; i++) {
      const agent: SpecializedAgent = {
        id: `agent-${i}`,
        name: `Agent ${i}`,
        description: `Description ${i}`,
        capabilities: { languages: [], frameworks: [], specialties: [] },
        systemPrompt: `Prompt ${i}`,
        examples: [],
      };
      manager.registerAgent(agent);
    }

    const agents = manager.getAgents();
    expect(agents.length).toBeGreaterThanOrEqual(54); // 4 built-in + 50 custom
  });

  it('should handle unicode in agent properties', () => {
    const unicodeAgent: SpecializedAgent = {
      id: 'unicode-agent',
      name: '\u4e2d\u6587\u4ee3\u7406',
      description: 'Agent with \ud83d\ude80 unicode',
      capabilities: { languages: [], frameworks: [], specialties: ['\u7279\u957f'] },
      systemPrompt: '\u4f60\u597d\uff01',
      examples: [
        { input: '\u4f60\u597d', output: '\u4f60\u597d\u5417' },
      ],
    };

    manager.registerAgent(unicodeAgent);

    const agent = manager.getAgent('unicode-agent');
    expect(agent!.name).toBe('\u4e2d\u6587\u4ee3\u7406');
  });

  it('should handle agent with very long system prompt', () => {
    const longPromptAgent: SpecializedAgent = {
      id: 'long-prompt',
      name: 'Long Prompt Agent',
      description: 'Has a very long prompt',
      capabilities: { languages: [], frameworks: [], specialties: [] },
      systemPrompt: 'You are an expert. '.repeat(1000),
      examples: [],
    };

    manager.registerAgent(longPromptAgent);

    const agent = manager.getAgent('long-prompt');
    expect(agent!.systemPrompt.length).toBeGreaterThan(10000);
  });

  it('should handle agent with many examples', () => {
    const examples = [];
    for (let i = 0; i < 100; i++) {
      examples.push({
        input: `Question ${i}`,
        output: `Answer ${i}`,
      });
    }

    const manyExamplesAgent: SpecializedAgent = {
      id: 'many-examples',
      name: 'Many Examples Agent',
      description: 'Has many examples',
      capabilities: { languages: [], frameworks: [], specialties: [] },
      systemPrompt: 'Learn from examples',
      examples,
    };

    manager.registerAgent(manyExamplesAgent);

    const agent = manager.getAgent('many-examples');
    expect(agent!.examples).toHaveLength(100);
  });
});
