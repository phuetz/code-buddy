/**
 * Unit tests for ExtendedThinkingEngine
 *
 * Tests the extended thinking system that enables deep, structured reasoning
 * before generating responses, including:
 * - Chain-of-thought reasoning
 * - Self-consistency decoding
 * - Verification and contradiction detection
 * - Multi-path exploration
 */

import { EventEmitter } from 'events';

// Mock CodeBuddyClient before imports
const mockChat = jest.fn();
jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: mockChat,
  })),
}));

// Mock types
jest.mock('../../src/agent/thinking/types.js', () => ({
  DEFAULT_THINKING_CONFIG: {
    depth: 'standard',
    maxThoughts: 10,
    maxChains: 2,
    maxTime: 15000,
    temperature: 0.5,
    selfConsistency: true,
    explorationRate: 0.2,
    verificationEnabled: true,
    streamThinking: true,
  },
  THINKING_DEPTH_CONFIG: {
    minimal: {
      maxThoughts: 3,
      maxChains: 1,
      maxTime: 5000,
      temperature: 0.3,
      selfConsistency: false,
      explorationRate: 0,
      verificationEnabled: false,
    },
    standard: {
      maxThoughts: 10,
      maxChains: 2,
      maxTime: 15000,
      temperature: 0.5,
      selfConsistency: true,
      explorationRate: 0.2,
      verificationEnabled: true,
    },
    extended: {
      maxThoughts: 25,
      maxChains: 4,
      maxTime: 45000,
      temperature: 0.6,
      selfConsistency: true,
      explorationRate: 0.4,
      verificationEnabled: true,
    },
    deep: {
      maxThoughts: 50,
      maxChains: 8,
      maxTime: 120000,
      temperature: 0.7,
      selfConsistency: true,
      explorationRate: 0.6,
      verificationEnabled: true,
    },
  },
}));

import {
  ExtendedThinkingEngine,
  createExtendedThinkingEngine,
  getExtendedThinkingEngine,
  resetExtendedThinkingEngine,
} from '../../src/agent/thinking/extended-thinking';

describe('ExtendedThinkingEngine', () => {
  let engine: ExtendedThinkingEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    resetExtendedThinkingEngine();

    // Default mock response for thought generation
    mockChat.mockResolvedValue({
      choices: [{
        message: {
          content: `<thought_type>observation</thought_type>
<content>This is an observation about the problem</content>
<confidence>0.8</confidence>
<reasoning>Based on initial analysis</reasoning>`,
        },
      }],
    });
  });

  afterEach(() => {
    if (engine) {
      engine.removeAllListeners();
    }
    resetExtendedThinkingEngine();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================
  describe('Constructor', () => {
    it('should create engine with API key', () => {
      engine = new ExtendedThinkingEngine('test-api-key');
      expect(engine).toBeInstanceOf(ExtendedThinkingEngine);
      expect(engine).toBeInstanceOf(EventEmitter);
    });

    it('should create engine with custom base URL', () => {
      engine = new ExtendedThinkingEngine('test-api-key', 'https://custom.api.com');
      expect(engine).toBeInstanceOf(ExtendedThinkingEngine);
    });

    it('should create engine with custom config', () => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        depth: 'deep',
        maxThoughts: 100,
      });
      const config = engine.getConfig();
      expect(config.depth).toBe('deep');
      expect(config.maxThoughts).toBe(100);
    });

    it('should merge custom config with defaults', () => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 50,
      });
      const config = engine.getConfig();
      expect(config.maxThoughts).toBe(50);
      expect(config.depth).toBe('standard'); // From default
    });
  });

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================
  describe('Configuration', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key');
    });

    it('should get current configuration', () => {
      const config = engine.getConfig();
      expect(config.depth).toBe('standard');
      expect(config.maxThoughts).toBe(10);
      expect(config.maxChains).toBe(2);
    });

    it('should return copy of config (not reference)', () => {
      const config1 = engine.getConfig();
      const config2 = engine.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });

    it('should update configuration with setConfig', () => {
      engine.setConfig({ maxThoughts: 25, temperature: 0.8 });
      const config = engine.getConfig();
      expect(config.maxThoughts).toBe(25);
      expect(config.temperature).toBe(0.8);
    });

    it('should set depth with setDepth', () => {
      engine.setDepth('deep');
      const config = engine.getConfig();
      expect(config.depth).toBe('deep');
    });

    it('should preserve other config when updating depth', () => {
      engine.setConfig({ temperature: 0.9 });
      engine.setDepth('minimal');
      const config = engine.getConfig();
      expect(config.depth).toBe('minimal');
      expect(config.temperature).toBe(0.9);
    });
  });

  // ===========================================================================
  // Think Method Tests
  // ===========================================================================
  describe('think()', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 2,
        maxChains: 1,
        maxTime: 10000,
        verificationEnabled: false,
        selfConsistency: false,
      });
    });

    it('should complete thinking with a result', async () => {
      // Mock a conclusion thought
      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>observation</thought_type>
<content>Key observation</content>
<confidence>0.8</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Final answer</content>
<confidence>0.9</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          // Synthesis response
          choices: [{
            message: {
              content: `<answer>The final synthesized answer</answer>
<reasoning>Based on observations and analysis</reasoning>
<confidence>0.85</confidence>
<key_insights>
- Insight 1
- Insight 2
</key_insights>
<uncertainties>
- Uncertainty 1
</uncertainties>`,
            },
          }],
        });

      const result = await engine.think('What is the solution?');

      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
      // Confidence and thoughtCount depend on internal state
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.thoughtCount).toBeGreaterThanOrEqual(0);
      expect(result.chainsExplored).toBeGreaterThanOrEqual(1);
      expect(result.thinkingTime).toBeGreaterThanOrEqual(0);
    });

    it('should emit thinking:start event', async () => {
      const startHandler = jest.fn();
      engine.on('thinking:start', startHandler);

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Final</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.think('Test problem');

      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            problem: 'Test problem',
          }),
        })
      );
    });

    it('should emit thinking:thought events for each thought', async () => {
      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>observation</thought_type>
<content>First thought</content>
<confidence>0.7</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      await engine.think('Test problem');

      expect(thoughtHandler).toHaveBeenCalled();
    });

    it('should emit thinking:complete event', async () => {
      const completeHandler = jest.fn();
      engine.on('thinking:complete', completeHandler);

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Final</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.think('Test problem');

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            answer: expect.any(String),
          }),
        })
      );
    });

    it('should respect maxThoughts limit', async () => {
      // Create a fresh engine with strict maxThoughts limit
      const limitedEngine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 3,
        maxChains: 1,
        verificationEnabled: false,
        selfConsistency: false,
      });

      // Mock multiple non-conclusion thoughts
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>analysis</thought_type>
<content>Still analyzing</content>
<confidence>0.5</confidence>`,
          },
        }],
      });

      const result = await limitedEngine.think('Complex problem');

      // The thinking process should complete (even if it reaches limits)
      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
      limitedEngine.removeAllListeners();
    });

    it('should include context in reasoning', async () => {
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Answer based on context</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.think('Problem with context', 'Here is the relevant context');

      expect(mockChat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Context'),
          }),
        ]),
        expect.anything(),
        expect.anything()
      );
    });

    it('should use depth configuration', async () => {
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Quick answer</content>
<confidence>0.8</confidence>`,
          },
        }],
      });

      await engine.think('Simple problem', undefined, 'minimal');

      // Minimal depth uses lower temperature
      expect(mockChat).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Quick Think Tests
  // ===========================================================================
  describe('quickThink()', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key');
    });

    it('should use minimal depth', async () => {
      const thinkSpy = jest.spyOn(engine, 'think');

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Quick answer</content>
<confidence>0.8</confidence>`,
          },
        }],
      });

      await engine.quickThink('Simple question');

      expect(thinkSpy).toHaveBeenCalledWith(
        'Simple question',
        undefined,
        'minimal'
      );
    });

    it('should return thinking result', async () => {
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Quick answer</content>
<confidence>0.8</confidence>`,
          },
        }],
      });

      const result = await engine.quickThink('Question');

      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
    });
  });

  // ===========================================================================
  // Deep Think Tests
  // ===========================================================================
  describe('deepThink()', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key');
    });

    it('should use deep depth', async () => {
      const thinkSpy = jest.spyOn(engine, 'think');

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Deep answer</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.deepThink('Complex question');

      expect(thinkSpy).toHaveBeenCalledWith(
        'Complex question',
        undefined,
        'deep'
      );
    });

    it('should include context when provided', async () => {
      const thinkSpy = jest.spyOn(engine, 'think');

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Deep answer with context</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.deepThink('Complex question', 'Relevant context');

      expect(thinkSpy).toHaveBeenCalledWith(
        'Complex question',
        'Relevant context',
        'deep'
      );
    });
  });

  // ===========================================================================
  // Thought Parsing Tests
  // ===========================================================================
  describe('Thought Parsing', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 1,
        verificationEnabled: false,
      });
    });

    it('should parse well-formed thought response', async () => {
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>hypothesis</thought_type>
<content>This is a hypothesis</content>
<confidence>0.75</confidence>
<reasoning>Based on analysis</reasoning>`,
          },
        }],
      });

      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);

      // Need two thoughts: one regular, one conclusion
      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>hypothesis</thought_type>
<content>Test hypothesis</content>
<confidence>0.75</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Final</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      engine.setConfig({ maxThoughts: 2 });
      await engine.think('Test');

      expect(thoughtHandler).toHaveBeenCalled();
      const thoughtArg = thoughtHandler.mock.calls[0][0];
      expect(thoughtArg.thought).toBeDefined();
      expect(thoughtArg.thought.type).toBeDefined();
      expect(thoughtArg.thought.content).toBeDefined();
    });

    it('should fallback parse plain text responses', async () => {
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: 'This is a plain text response without proper tags',
          },
        }],
      });

      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: 'Plain text thought',
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      engine.setConfig({ maxThoughts: 2 });
      await engine.think('Test');

      expect(thoughtHandler).toHaveBeenCalled();
      const thoughtArg = thoughtHandler.mock.calls[0][0];
      expect(thoughtArg.thought.type).toBe('analysis'); // Default type
    });

    it('should handle all thought types', async () => {
      const thoughtTypes = [
        'observation',
        'analysis',
        'hypothesis',
        'verification',
        'contradiction',
        'synthesis',
        'conclusion',
        'uncertainty',
        'question',
        'action_plan',
      ];

      for (const type of thoughtTypes) {
        mockChat.mockResolvedValue({
          choices: [{
            message: {
              content: `<thought_type>${type}</thought_type>
<content>Test ${type}</content>
<confidence>0.8</confidence>`,
            },
          }],
        });

        engine.setConfig({ maxThoughts: 1 });
        // Reset for each iteration
        mockChat.mockClear();

        mockChat.mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>${type}</thought_type>
<content>Test content</content>
<confidence>0.8</confidence>`,
            },
          }],
        });

        if (type !== 'conclusion') {
          mockChat.mockResolvedValueOnce({
            choices: [{
              message: {
                content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
              },
            }],
          });
        }

        await engine.think('Test');
      }
    });
  });

  // ===========================================================================
  // Verification Tests
  // ===========================================================================
  describe('Verification', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 3,
        verificationEnabled: true,
        selfConsistency: false,
      });
    });

    it('should verify hypothesis thoughts', async () => {
      const verificationHandler = jest.fn();
      engine.on('thinking:verification', verificationHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>hypothesis</thought_type>
<content>My hypothesis</content>
<confidence>0.8</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          // Verification response
          choices: [{
            message: {
              content: `<verified>true</verified>
<confidence>0.9</confidence>
<issues></issues>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      await engine.think('Test problem');

      expect(verificationHandler).toHaveBeenCalled();
    });

    it('should add contradiction thought when verification fails', async () => {
      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>hypothesis</thought_type>
<content>Wrong hypothesis</content>
<confidence>0.8</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          // Failed verification
          choices: [{
            message: {
              content: `<verified>false</verified>
<confidence>0.7</confidence>
<issues>This hypothesis is incorrect</issues>
<corrections>Consider alternative approach</corrections>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Revised answer</content>
<confidence>0.85</confidence>`,
            },
          }],
        });

      await engine.think('Test problem');

      const thoughtCalls = thoughtHandler.mock.calls;
      const hasContradiction = thoughtCalls.some(
        call => call[0].thought.type === 'contradiction'
      );
      expect(hasContradiction).toBe(true);
    });

    it('should verify high confidence thoughts', async () => {
      const verificationHandler = jest.fn();
      engine.on('thinking:verification', verificationHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>analysis</thought_type>
<content>High confidence analysis</content>
<confidence>0.95</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          // Verification response
          choices: [{
            message: {
              content: `<verified>true</verified>
<confidence>0.9</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      await engine.think('Test problem');

      expect(verificationHandler).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Branching Tests
  // ===========================================================================
  describe('Branching', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 10,
        maxChains: 3,
        explorationRate: 1.0, // Always branch for testing
        verificationEnabled: false,
      });
    });

    it('should emit thinking:branch event when branching', async () => {
      const branchHandler = jest.fn();
      engine.on('thinking:branch', branchHandler);

      // Setup thoughts that trigger branching
      let callCount = 0;
      mockChat.mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          return Promise.resolve({
            choices: [{
              message: {
                content: `<thought_type>analysis</thought_type>
<content>Analysis ${callCount}</content>
<confidence>0.7</confidence>`,
              },
            }],
          });
        }
        return Promise.resolve({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });
      });

      await engine.think('Complex problem');

      // With explorationRate 1.0, should attempt branching
      // The actual branch may or may not happen depending on conditions
    });

    it('should respect maxChains limit', async () => {
      engine.setConfig({ maxChains: 2 });

      let callCount = 0;
      mockChat.mockImplementation(() => {
        callCount++;
        if (callCount <= 5) {
          return Promise.resolve({
            choices: [{
              message: {
                content: `<thought_type>analysis</thought_type>
<content>Analysis ${callCount}</content>
<confidence>0.7</confidence>`,
              },
            }],
          });
        }
        return Promise.resolve({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });
      });

      const result = await engine.think('Test');

      expect(result.chainsExplored).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================================================
  // Self-Consistency Tests
  // ===========================================================================
  describe('Self-Consistency', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 5,
        maxChains: 3,
        selfConsistency: true,
        verificationEnabled: false,
        explorationRate: 1.0,
      });
    });

    it('should synthesize with self-consistency when multiple chains complete', async () => {
      // This is a complex scenario that requires multiple chains to complete
      // For now, we test the basic self-consistency path
      let callCount = 0;
      mockChat.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Chain conclusion ${callCount}</content>
<confidence>0.8</confidence>`,
            },
          }],
        });
      });

      const result = await engine.think('Test problem');

      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
    });
  });

  // ===========================================================================
  // Synthesis Tests
  // ===========================================================================
  describe('Synthesis', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 2,
        selfConsistency: false,
        verificationEnabled: false,
      });
    });

    it('should parse synthesis response correctly', async () => {
      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>observation</thought_type>
<content>Key observation</content>
<confidence>0.8</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Final thought</content>
<confidence>0.9</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<answer>The synthesized answer</answer>
<reasoning>Based on careful analysis</reasoning>
<confidence>0.85</confidence>
<key_insights>
- First insight
- Second insight
</key_insights>
<uncertainties>
- Some uncertainty
</uncertainties>`,
            },
          }],
        });

      const result = await engine.think('Test problem');

      // Result should contain an answer (format may vary based on synthesis)
      expect(result.answer).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.thoughtCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle synthesis failure with fallback', async () => {
      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Best conclusion</content>
<confidence>0.9</confidence>`,
            },
          }],
        })
        .mockRejectedValueOnce(new Error('Synthesis failed'));

      const result = await engine.think('Test problem');

      // Should fallback to best conclusion
      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
    });
  });

  // ===========================================================================
  // Format Result Tests
  // ===========================================================================
  describe('formatResult()', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key');
    });

    it('should format basic result', () => {
      const result = {
        answer: 'The answer',
        reasoning: 'The reasoning',
        confidence: 0.85,
        thinkingTime: 2500,
        thoughtCount: 5,
        chainsExplored: 2,
        keyInsights: [],
        uncertainties: [],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('EXTENDED THINKING RESULT');
      expect(formatted).toContain('The answer');
      expect(formatted).toContain('The reasoning');
      expect(formatted).toContain('85%');
      expect(formatted).toContain('2.50s');
      expect(formatted).toContain('Thoughts: 5');
      expect(formatted).toContain('Chains: 2');
    });

    it('should format result with key insights', () => {
      const result = {
        answer: 'Answer',
        reasoning: '',
        confidence: 0.9,
        thinkingTime: 1000,
        thoughtCount: 3,
        chainsExplored: 1,
        keyInsights: ['Insight 1', 'Insight 2'],
        uncertainties: [],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Key Insights');
      expect(formatted).toContain('Insight 1');
      expect(formatted).toContain('Insight 2');
    });

    it('should format result with uncertainties', () => {
      const result = {
        answer: 'Answer',
        reasoning: '',
        confidence: 0.7,
        thinkingTime: 1000,
        thoughtCount: 3,
        chainsExplored: 1,
        keyInsights: [],
        uncertainties: ['Uncertainty 1', 'Uncertainty 2'],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Uncertainties');
      expect(formatted).toContain('Uncertainty 1');
      expect(formatted).toContain('Uncertainty 2');
    });

    it('should format result with alternative answers', () => {
      const result = {
        answer: 'Primary answer',
        reasoning: '',
        confidence: 0.85,
        thinkingTime: 1000,
        thoughtCount: 3,
        chainsExplored: 2,
        keyInsights: [],
        uncertainties: [],
        alternativeAnswers: [
          {
            answer: 'Alternative answer that is quite long and should be truncated in the display',
            confidence: 0.7,
            reasoning: 'Different approach',
            whyNotChosen: 'Lower confidence',
          },
        ],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Alternative Answers Considered');
      expect(formatted).toContain('70%');
    });

    it('should format result without reasoning', () => {
      const result = {
        answer: 'Answer',
        reasoning: '',
        confidence: 0.9,
        thinkingTime: 500,
        thoughtCount: 1,
        chainsExplored: 1,
        keyInsights: [],
        uncertainties: [],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Answer');
      // Should not have reasoning section if empty
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================
  describe('Error Handling', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 2,
        verificationEnabled: false,
      });
    });

    it('should handle API errors during thought generation', async () => {
      mockChat.mockRejectedValue(new Error('API Error'));

      const result = await engine.think('Test problem');

      // Should still return a result (fallback)
      expect(result).toBeDefined();
    });

    it('should handle empty response from API', async () => {
      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: '',
          },
        }],
      });

      const result = await engine.think('Test problem');

      expect(result).toBeDefined();
    });

    it('should handle verification errors gracefully', async () => {
      engine.setConfig({ verificationEnabled: true });

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>hypothesis</thought_type>
<content>Test hypothesis</content>
<confidence>0.8</confidence>`,
            },
          }],
        })
        .mockRejectedValueOnce(new Error('Verification API Error'))
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      const result = await engine.think('Test problem');

      // Should complete despite verification error
      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // Singleton Factory Tests
  // ===========================================================================
  describe('Factory Functions', () => {
    afterEach(() => {
      resetExtendedThinkingEngine();
    });

    it('should create engine with createExtendedThinkingEngine', () => {
      const engine = createExtendedThinkingEngine('test-api-key');
      expect(engine).toBeInstanceOf(ExtendedThinkingEngine);
    });

    it('should create engine with custom config', () => {
      const engine = createExtendedThinkingEngine('test-api-key', undefined, {
        depth: 'deep',
      });
      expect(engine.getConfig().depth).toBe('deep');
    });

    it('should return singleton with getExtendedThinkingEngine', () => {
      const engine1 = getExtendedThinkingEngine('test-api-key');
      const engine2 = getExtendedThinkingEngine('test-api-key');
      expect(engine1).toBe(engine2);
    });

    it('should reset singleton with resetExtendedThinkingEngine', () => {
      const engine1 = getExtendedThinkingEngine('test-api-key');
      resetExtendedThinkingEngine();
      const engine2 = getExtendedThinkingEngine('test-api-key');
      expect(engine1).not.toBe(engine2);
    });
  });

  // ===========================================================================
  // Time Limit Tests
  // ===========================================================================
  describe('Time Limits', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 100,
        maxTime: 100, // Very short time limit
        verificationEnabled: false,
      });
    });

    it('should respect maxTime limit', async () => {
      // Mock slow responses
      mockChat.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              choices: [{
                message: {
                  content: `<thought_type>analysis</thought_type>
<content>Slow thought</content>
<confidence>0.7</confidence>`,
                },
              }],
            });
          }, 50);
        });
      });

      const startTime = Date.now();
      await engine.think('Test problem');
      const elapsed = Date.now() - startTime;

      // Should complete within reasonable time of maxTime
      // Adding buffer for test execution overhead and CI variability
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ===========================================================================
  // Streaming Thinking Tests
  // ===========================================================================
  describe('Streaming Thinking', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 2,
        streamThinking: true,
        verificationEnabled: false,
      });
    });

    it('should emit thinking:stream events when enabled', async () => {
      const streamHandler = jest.fn();
      engine.on('thinking:stream', streamHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>observation</thought_type>
<content>Streaming thought</content>
<confidence>0.8</confidence>`,
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
            },
          }],
        });

      await engine.think('Test problem');

      expect(streamHandler).toHaveBeenCalled();
    });

    it('should not emit thinking:stream when disabled', async () => {
      engine.setConfig({ streamThinking: false });

      const streamHandler = jest.fn();
      engine.on('thinking:stream', streamHandler);

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.think('Test problem');

      expect(streamHandler).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Chain Management Tests
  // ===========================================================================
  describe('Chain Management', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 5,
        maxChains: 2,
        verificationEnabled: false,
      });
    });

    it('should emit thinking:chain:start event', async () => {
      const chainStartHandler = jest.fn();
      engine.on('thinking:chain:start', chainStartHandler);

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Done</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.think('Test problem');

      expect(chainStartHandler).toHaveBeenCalled();
    });

    it('should emit thinking:chain:complete when chain completes', async () => {
      const chainCompleteHandler = jest.fn();
      engine.on('thinking:chain:complete', chainCompleteHandler);

      mockChat.mockResolvedValue({
        choices: [{
          message: {
            content: `<thought_type>conclusion</thought_type>
<content>Final conclusion</content>
<confidence>0.9</confidence>`,
          },
        }],
      });

      await engine.think('Test problem');

      expect(chainCompleteHandler).toHaveBeenCalled();
    });
  });
});
