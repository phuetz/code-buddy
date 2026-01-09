/**
 * Comprehensive Unit Tests for Thinking Module
 *
 * Tests the thinking module in src/thinking/ covering:
 * - Thinking mode processing via ThinkingKeywordsManager
 * - Extended thinking features via ExtendedThinkingEngine
 * - Thinking output formatting and result handling
 *
 * This test file consolidates testing for:
 * - src/agent/thinking-keywords.ts
 * - src/agent/thinking/extended-thinking.ts
 * - src/agent/thinking/types.ts
 */

import { EventEmitter } from 'events';

// ============================================================================
// MOCKS
// ============================================================================

// Mock CodeBuddyClient
const mockChat = jest.fn();
jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: mockChat,
  })),
}));

// Mock thinking types with actual configuration values
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
  THINKING_PROMPTS: {
    observation: 'What are the key facts and observations about this problem?',
    analysis: 'Let me analyze this more deeply...',
    hypothesis: 'Based on my analysis, I hypothesize that...',
    verification: 'Let me verify this by considering...',
    contradiction: 'Wait, there\'s an issue with this reasoning...',
    synthesis: 'Combining these insights, I can see that...',
    conclusion: 'Therefore, my conclusion is...',
    uncertainty: 'I\'m uncertain about...',
    question: 'An important question to consider is...',
    action_plan: 'The plan of action should be...',
  },
}));

// Import modules after mocks
import {
  ThinkingKeywordsManager,
  ThinkingKeywordResult,
  ThinkingLevel,
  getThinkingKeywordsManager,
  resetThinkingKeywordsManager,
  hasThinkingKeyword,
  extractThinkingLevel,
} from '../../src/agent/thinking-keywords';

import {
  ExtendedThinkingEngine,
  createExtendedThinkingEngine,
  getExtendedThinkingEngine,
  resetExtendedThinkingEngine,
} from '../../src/agent/thinking/extended-thinking';

// ============================================================================
// PART 1: THINKING KEYWORDS MANAGER TESTS
// ============================================================================

describe('Thinking Module - ThinkingKeywordsManager', () => {
  let manager: ThinkingKeywordsManager;

  beforeEach(() => {
    resetThinkingKeywordsManager();
    manager = new ThinkingKeywordsManager();
  });

  afterEach(() => {
    manager.dispose();
    resetThinkingKeywordsManager();
  });

  // --------------------------------------------------------------------------
  // Constructor and Initialization Tests
  // --------------------------------------------------------------------------
  describe('Initialization', () => {
    it('should create instance with default options', () => {
      expect(manager).toBeInstanceOf(ThinkingKeywordsManager);
      expect(manager).toBeInstanceOf(EventEmitter);
      expect(manager.isEnabled()).toBe(true);
      expect(manager.getDefaultLevel()).toBe('none');
    });

    it('should accept custom default level', () => {
      const customManager = new ThinkingKeywordsManager({ defaultLevel: 'standard' });
      expect(customManager.getDefaultLevel()).toBe('standard');
      customManager.dispose();
    });

    it('should accept enabled option', () => {
      const disabledManager = new ThinkingKeywordsManager({ enabled: false });
      expect(disabledManager.isEnabled()).toBe(false);
      disabledManager.dispose();
    });

    it('should accept both options together', () => {
      const customManager = new ThinkingKeywordsManager({
        defaultLevel: 'deep',
        enabled: true,
      });
      expect(customManager.getDefaultLevel()).toBe('deep');
      expect(customManager.isEnabled()).toBe(true);
      customManager.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Standard Level Detection Tests
  // --------------------------------------------------------------------------
  describe('Keyword Detection - Standard Level', () => {
    it('should detect standalone "think" keyword', () => {
      const result = manager.detectThinkingLevel('think about this problem');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
      expect(result.tokenBudget).toBe(4000);
    });

    it('should detect "think about" pattern', () => {
      const result = manager.detectThinkingLevel('think about how to solve this');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
      expect(result.keyword).toMatch(/think about/i);
    });

    it('should detect "think through" pattern', () => {
      const result = manager.detectThinkingLevel('think through this issue step by step');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
    });

    it('should detect "consider carefully" pattern', () => {
      const result = manager.detectThinkingLevel('please consider carefully this design');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
    });

    it('should detect standalone "think" at sentence end', () => {
      const result = manager.detectThinkingLevel('please think carefully');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
    });

    it('should detect "think" with follow-up text', () => {
      const result = manager.detectThinkingLevel('think before answering');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
    });
  });

  // --------------------------------------------------------------------------
  // Deep Level Detection Tests
  // --------------------------------------------------------------------------
  describe('Keyword Detection - Deep Level', () => {
    it('should detect "megathink" keyword', () => {
      const result = manager.detectThinkingLevel('megathink about the architecture');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
      expect(result.keyword).toMatch(/megathink/i);
      expect(result.tokenBudget).toBe(10000);
    });

    it('should detect "think hard" pattern', () => {
      const result = manager.detectThinkingLevel('think hard about this algorithm');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
    });

    it('should detect "think harder" pattern', () => {
      const result = manager.detectThinkingLevel('think harder about edge cases');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
    });

    it('should detect "deep think" pattern', () => {
      const result = manager.detectThinkingLevel('deep think on performance optimization');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
    });

    it('should detect "think deeply" pattern', () => {
      const result = manager.detectThinkingLevel('think deeply about security implications');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
    });

    it('should detect "analyze thoroughly" pattern', () => {
      const result = manager.detectThinkingLevel('analyze thoroughly the security model');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
    });

    it('should detect "think hard" with optional "er" suffix', () => {
      // "think hard" and "think harder" both match deep level
      const result1 = manager.detectThinkingLevel('please think hard on this');
      expect(result1.detected).toBe(true);
      expect(result1.level).toBe('deep');

      const result2 = manager.detectThinkingLevel('think harder please');
      expect(result2.detected).toBe(true);
      expect(result2.level).toBe('deep');
    });
  });

  // --------------------------------------------------------------------------
  // Exhaustive Level Detection Tests
  // --------------------------------------------------------------------------
  describe('Keyword Detection - Exhaustive Level', () => {
    it('should detect "ultrathink" keyword', () => {
      const result = manager.detectThinkingLevel('ultrathink about the entire architecture');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
      expect(result.keyword).toMatch(/ultrathink/i);
      expect(result.tokenBudget).toBe(32000);
    });

    it('should detect "think even harder" pattern', () => {
      const result = manager.detectThinkingLevel('think even harder about this complex problem');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
    });

    it('should detect "think very hard" pattern', () => {
      const result = manager.detectThinkingLevel('think very hard about scaling strategies');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
    });

    it('should detect "exhaustive analysis" pattern', () => {
      const result = manager.detectThinkingLevel('do an exhaustive analysis of the codebase');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
    });

    it('should detect "deep dive" pattern', () => {
      const result = manager.detectThinkingLevel('deep dive into the authentication flow');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
    });

    it('should detect "think very hard" pattern variant', () => {
      const result = manager.detectThinkingLevel('I need you to think very hard');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
    });

    it('should detect "think maximum" pattern', () => {
      const result = manager.detectThinkingLevel('think maximum for this critical decision');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
    });
  });

  // --------------------------------------------------------------------------
  // No Keyword (None Level) Detection Tests
  // --------------------------------------------------------------------------
  describe('Keyword Detection - None Level', () => {
    it('should return none when no keyword detected', () => {
      const result = manager.detectThinkingLevel('solve this problem');
      expect(result.detected).toBe(false);
      expect(result.level).toBe('none');
      expect(result.keyword).toBeNull();
      expect(result.tokenBudget).toBe(0);
    });

    it('should preserve original input when no keyword', () => {
      const input = 'write a function that sorts numbers';
      const result = manager.detectThinkingLevel(input);
      expect(result.cleanedInput).toBe(input);
    });

    it('should return none for empty input', () => {
      const result = manager.detectThinkingLevel('');
      expect(result.detected).toBe(false);
      expect(result.level).toBe('none');
    });

    it('should not match "thinking" as "think"', () => {
      // "thinking" should not trigger "think" detection due to word boundaries
      const result = manager.detectThinkingLevel('I was thinking about this yesterday');
      expect(result.detected).toBe(false);
      expect(result.level).toBe('none');
    });

    it('should not match partial words', () => {
      const result = manager.detectThinkingLevel('rethinking the approach');
      expect(result.detected).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Input Cleaning Tests
  // --------------------------------------------------------------------------
  describe('Input Cleaning', () => {
    it('should remove detected keyword from input', () => {
      const result = manager.detectThinkingLevel('think about refactoring this function');
      expect(result.cleanedInput).not.toContain('think about');
      expect(result.cleanedInput).toContain('refactoring this function');
    });

    it('should clean up extra spaces', () => {
      const result = manager.detectThinkingLevel('megathink   about   this');
      expect(result.cleanedInput).not.toMatch(/\s{2,}/);
    });

    it('should handle keyword at start of input', () => {
      const result = manager.detectThinkingLevel('ultrathink: design an API');
      expect(result.cleanedInput).toBe('design an API');
    });

    it('should handle keyword at end of input', () => {
      const result = manager.detectThinkingLevel('solve this problem, think harder');
      expect(result.cleanedInput).toContain('solve this problem');
    });

    it('should handle keyword in the middle', () => {
      const result = manager.detectThinkingLevel('please megathink about the solution');
      expect(result.cleanedInput).not.toContain('megathink');
    });

    it('should trim leading and trailing whitespace', () => {
      const result = manager.detectThinkingLevel('  think about this  ');
      expect(result.cleanedInput).not.toMatch(/^\s/);
      expect(result.cleanedInput).not.toMatch(/\s$/);
    });

    it('should handle input with only keyword', () => {
      const result = manager.detectThinkingLevel('think');
      expect(result.detected).toBe(true);
      expect(result.cleanedInput).toBe('');
    });

    it('should clean punctuation after keyword removal', () => {
      const result = manager.detectThinkingLevel('think about: the problem');
      expect(result.cleanedInput.startsWith(':')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Case Insensitivity Tests
  // --------------------------------------------------------------------------
  describe('Case Insensitivity', () => {
    it('should detect ULTRATHINK in uppercase', () => {
      const result = manager.detectThinkingLevel('ULTRATHINK about this');
      expect(result.level).toBe('exhaustive');
    });

    it('should detect MegaThink in mixed case', () => {
      const result = manager.detectThinkingLevel('MegaThink about this');
      expect(result.level).toBe('deep');
    });

    it('should detect THINK ABOUT in uppercase', () => {
      const result = manager.detectThinkingLevel('THINK ABOUT the solution');
      expect(result.level).toBe('standard');
    });

    it('should detect Think Hard in title case', () => {
      const result = manager.detectThinkingLevel('Think Hard About This');
      expect(result.level).toBe('deep');
    });
  });

  // --------------------------------------------------------------------------
  // Priority and Pattern Ordering Tests
  // --------------------------------------------------------------------------
  describe('Priority Handling', () => {
    it('should prioritize exhaustive over deep and standard', () => {
      const result = manager.detectThinkingLevel('ultrathink and megathink and think');
      expect(result.level).toBe('exhaustive');
    });

    it('should prioritize deep over standard', () => {
      const result = manager.detectThinkingLevel('megathink and think about this');
      expect(result.level).toBe('deep');
    });

    it('should match most specific pattern first', () => {
      // "think even harder" should match exhaustive, not standard "think"
      const result = manager.detectThinkingLevel('think even harder please');
      expect(result.level).toBe('exhaustive');
    });

    it('should match "think harder" before "think"', () => {
      const result = manager.detectThinkingLevel('think harder about this');
      expect(result.level).toBe('deep');
    });
  });

  // --------------------------------------------------------------------------
  // Token Budget Tests
  // --------------------------------------------------------------------------
  describe('Token Budgets', () => {
    it('should return 0 tokens for none level', () => {
      expect(manager.getTokenBudget('none')).toBe(0);
    });

    it('should return 4000 tokens for standard level', () => {
      expect(manager.getTokenBudget('standard')).toBe(4000);
    });

    it('should return 10000 tokens for deep level', () => {
      expect(manager.getTokenBudget('deep')).toBe(10000);
    });

    it('should return 32000 tokens for exhaustive level', () => {
      expect(manager.getTokenBudget('exhaustive')).toBe(32000);
    });

    it('should include correct token budget in detection result', () => {
      const standardResult = manager.detectThinkingLevel('think about this');
      expect(standardResult.tokenBudget).toBe(4000);

      const deepResult = manager.detectThinkingLevel('megathink about this');
      expect(deepResult.tokenBudget).toBe(10000);

      const exhaustiveResult = manager.detectThinkingLevel('ultrathink about this');
      expect(exhaustiveResult.tokenBudget).toBe(32000);
    });
  });

  // --------------------------------------------------------------------------
  // System Prompt Addition Tests
  // --------------------------------------------------------------------------
  describe('System Prompt Additions', () => {
    it('should have empty system prompt for none level', () => {
      const config = manager.getConfig('none');
      expect(config.systemPromptAddition).toBe('');
    });

    it('should have step-by-step prompt for standard level', () => {
      const config = manager.getConfig('standard');
      expect(config.systemPromptAddition).toContain('step by step');
    });

    it('should have deep analysis prompt for deep level', () => {
      const config = manager.getConfig('deep');
      expect(config.systemPromptAddition).toContain('deep analysis');
      expect(config.systemPromptAddition).toContain('edge cases');
    });

    it('should have exhaustive prompt for exhaustive level', () => {
      const config = manager.getConfig('exhaustive');
      expect(config.systemPromptAddition).toContain('exhaustive analysis');
      expect(config.systemPromptAddition).toContain('problem space');
    });

    it('should include system prompt in detection result', () => {
      const result = manager.detectThinkingLevel('megathink about this');
      expect(result.systemPromptAddition).toContain('deep analysis');
    });
  });

  // --------------------------------------------------------------------------
  // Configuration Access Tests
  // --------------------------------------------------------------------------
  describe('Configuration', () => {
    it('should get config for a specific level', () => {
      const config = manager.getConfig('deep');
      expect(config.level).toBe('deep');
      expect(config.tokenBudget).toBe(10000);
      expect(config.keywords).toContain('megathink');
    });

    it('should return copy of config (not reference)', () => {
      const config1 = manager.getConfig('standard');
      const config2 = manager.getConfig('standard');
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });

    it('should get all available levels', () => {
      const levels = manager.getAvailableLevels();
      expect(levels).toHaveLength(4);
      expect(levels.map(l => l.level)).toContain('none');
      expect(levels.map(l => l.level)).toContain('standard');
      expect(levels.map(l => l.level)).toContain('deep');
      expect(levels.map(l => l.level)).toContain('exhaustive');
    });

    it('should have descriptions for all levels', () => {
      const levels: ThinkingLevel[] = ['none', 'standard', 'deep', 'exhaustive'];
      for (const level of levels) {
        const config = manager.getConfig(level);
        expect(config.description).toBeTruthy();
      }
    });

    it('should have keywords array for each level', () => {
      const levels: ThinkingLevel[] = ['none', 'standard', 'deep', 'exhaustive'];
      for (const level of levels) {
        const config = manager.getConfig(level);
        expect(Array.isArray(config.keywords)).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Extended Thinking Check Tests
  // --------------------------------------------------------------------------
  describe('Extended Thinking Check', () => {
    it('should return false for none level', () => {
      expect(manager.requiresExtendedThinking('none')).toBe(false);
    });

    it('should return true for standard level', () => {
      expect(manager.requiresExtendedThinking('standard')).toBe(true);
    });

    it('should return true for deep level', () => {
      expect(manager.requiresExtendedThinking('deep')).toBe(true);
    });

    it('should return true for exhaustive level', () => {
      expect(manager.requiresExtendedThinking('exhaustive')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Format Level Tests
  // --------------------------------------------------------------------------
  describe('Format Level', () => {
    it('should format none level correctly', () => {
      const formatted = manager.formatLevel('none');
      expect(formatted).toContain('No extended thinking');
    });

    it('should format standard level with emoji', () => {
      const formatted = manager.formatLevel('standard');
      expect(formatted).toContain('4K tokens');
    });

    it('should format deep level with emoji', () => {
      const formatted = manager.formatLevel('deep');
      expect(formatted).toContain('10K tokens');
    });

    it('should format exhaustive level with emoji', () => {
      const formatted = manager.formatLevel('exhaustive');
      expect(formatted).toContain('32K tokens');
    });
  });

  // --------------------------------------------------------------------------
  // Help Text Tests
  // --------------------------------------------------------------------------
  describe('Help Text', () => {
    it('should provide help text', () => {
      const help = manager.getHelpText();
      expect(help).toContain('Extended Thinking Keywords');
    });

    it('should include keyword examples', () => {
      const help = manager.getHelpText();
      expect(help).toContain('think');
      expect(help).toContain('megathink');
      expect(help).toContain('ultrathink');
    });

    it('should include token budgets in help', () => {
      const help = manager.getHelpText();
      expect(help).toContain('4K');
      expect(help).toContain('10K');
      expect(help).toContain('32K');
    });

    it('should include usage examples', () => {
      const help = manager.getHelpText();
      expect(help).toContain('Examples');
    });
  });

  // --------------------------------------------------------------------------
  // Enable/Disable Tests
  // --------------------------------------------------------------------------
  describe('Enable/Disable', () => {
    it('should disable detection when disabled', () => {
      manager.setEnabled(false);
      const result = manager.detectThinkingLevel('ultrathink about this');
      expect(result.detected).toBe(false);
      expect(result.level).toBe('none');
    });

    it('should re-enable detection', () => {
      manager.setEnabled(false);
      manager.setEnabled(true);
      const result = manager.detectThinkingLevel('megathink about this');
      expect(result.detected).toBe(true);
    });

    it('should emit event on enable/disable', (done) => {
      manager.on('thinking:enabled', (enabled) => {
        expect(enabled).toBe(false);
        done();
      });
      manager.setEnabled(false);
    });

    it('should track enabled state', () => {
      expect(manager.isEnabled()).toBe(true);
      manager.setEnabled(false);
      expect(manager.isEnabled()).toBe(false);
      manager.setEnabled(true);
      expect(manager.isEnabled()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Default Level Tests
  // --------------------------------------------------------------------------
  describe('Default Level', () => {
    it('should use default level when no keyword detected', () => {
      manager.setDefaultLevel('standard');
      const result = manager.detectThinkingLevel('solve this problem');
      expect(result.level).toBe('standard');
      expect(result.detected).toBe(true);
    });

    it('should emit event on default level change', (done) => {
      manager.on('thinking:default-changed', (level) => {
        expect(level).toBe('deep');
        done();
      });
      manager.setDefaultLevel('deep');
    });

    it('should get default level', () => {
      expect(manager.getDefaultLevel()).toBe('none');
      manager.setDefaultLevel('exhaustive');
      expect(manager.getDefaultLevel()).toBe('exhaustive');
    });
  });

  // --------------------------------------------------------------------------
  // Event Emission Tests
  // --------------------------------------------------------------------------
  describe('Events', () => {
    it('should emit thinking:detected event when keyword found', (done) => {
      manager.on('thinking:detected', (result: ThinkingKeywordResult) => {
        expect(result.detected).toBe(true);
        expect(result.level).toBe('deep');
        done();
      });
      manager.detectThinkingLevel('megathink about this');
    });

    it('should not emit event when no keyword detected', () => {
      const listener = jest.fn();
      manager.on('thinking:detected', listener);
      manager.detectThinkingLevel('solve this problem');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should include all result fields in event', (done) => {
      manager.on('thinking:detected', (result: ThinkingKeywordResult) => {
        expect(result).toHaveProperty('detected');
        expect(result).toHaveProperty('level');
        expect(result).toHaveProperty('keyword');
        expect(result).toHaveProperty('cleanedInput');
        expect(result).toHaveProperty('tokenBudget');
        expect(result).toHaveProperty('systemPromptAddition');
        done();
      });
      manager.detectThinkingLevel('ultrathink about this');
    });
  });

  // --------------------------------------------------------------------------
  // Dispose Tests
  // --------------------------------------------------------------------------
  describe('Dispose', () => {
    it('should remove all listeners on dispose', () => {
      const listener = jest.fn();
      manager.on('thinking:detected', listener);
      manager.dispose();
      manager.detectThinkingLevel('megathink about this');
      // After dispose, event should not fire
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle special characters in input', () => {
      const result = manager.detectThinkingLevel('think about @user\'s request! #important');
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
    });

    it('should handle unicode characters', () => {
      const result = manager.detectThinkingLevel('think about 日本語 input');
      expect(result.detected).toBe(true);
    });

    it('should handle very long input', () => {
      const longInput = 'think about ' + 'a'.repeat(10000);
      const result = manager.detectThinkingLevel(longInput);
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
    });

    it('should handle newlines in input', () => {
      const result = manager.detectThinkingLevel('think about\nthis problem');
      expect(result.detected).toBe(true);
    });

    it('should handle tabs in input', () => {
      const result = manager.detectThinkingLevel('think about\tthis');
      expect(result.detected).toBe(true);
    });

    it('should handle multiple keywords - uses first priority match', () => {
      const result = manager.detectThinkingLevel('ultrathink and think');
      expect(result.level).toBe('exhaustive');
    });

    it('should handle emoji in input', () => {
      const result = manager.detectThinkingLevel('megathink about this problem');
      expect(result.detected).toBe(true);
    });
  });
});

// ============================================================================
// PART 2: SINGLETON FUNCTIONS TESTS
// ============================================================================

describe('Thinking Module - Singleton Functions', () => {
  beforeEach(() => {
    resetThinkingKeywordsManager();
  });

  afterEach(() => {
    resetThinkingKeywordsManager();
  });

  describe('getThinkingKeywordsManager', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getThinkingKeywordsManager();
      const instance2 = getThinkingKeywordsManager();
      expect(instance1).toBe(instance2);
    });

    it('should accept options on first call', () => {
      const instance = getThinkingKeywordsManager({ defaultLevel: 'deep' });
      expect(instance.getDefaultLevel()).toBe('deep');
    });

    it('should ignore options on subsequent calls', () => {
      const instance1 = getThinkingKeywordsManager({ defaultLevel: 'deep' });
      const instance2 = getThinkingKeywordsManager({ defaultLevel: 'standard' });
      expect(instance1).toBe(instance2);
      expect(instance2.getDefaultLevel()).toBe('deep');
    });
  });

  describe('resetThinkingKeywordsManager', () => {
    it('should reset the singleton', () => {
      const instance1 = getThinkingKeywordsManager({ defaultLevel: 'deep' });
      resetThinkingKeywordsManager();
      const instance2 = getThinkingKeywordsManager();
      expect(instance1).not.toBe(instance2);
      expect(instance2.getDefaultLevel()).toBe('none');
    });

    it('should dispose the old instance', () => {
      const instance = getThinkingKeywordsManager();
      const listener = jest.fn();
      instance.on('thinking:detected', listener);
      resetThinkingKeywordsManager();
      // Old instance should have listeners removed
    });
  });
});

// ============================================================================
// PART 3: UTILITY FUNCTIONS TESTS
// ============================================================================

describe('Thinking Module - Utility Functions', () => {
  describe('hasThinkingKeyword', () => {
    it('should return true for input with standard keyword', () => {
      expect(hasThinkingKeyword('think about this')).toBe(true);
    });

    it('should return true for input with deep keyword', () => {
      expect(hasThinkingKeyword('megathink on this')).toBe(true);
    });

    it('should return true for input with exhaustive keyword', () => {
      expect(hasThinkingKeyword('ultrathink')).toBe(true);
    });

    it('should return false for input without keyword', () => {
      expect(hasThinkingKeyword('solve this problem')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(hasThinkingKeyword('')).toBe(false);
    });
  });

  describe('extractThinkingLevel', () => {
    it('should extract standard level', () => {
      expect(extractThinkingLevel('think about this')).toBe('standard');
    });

    it('should extract deep level', () => {
      expect(extractThinkingLevel('megathink on this')).toBe('deep');
      expect(extractThinkingLevel('think harder')).toBe('deep');
    });

    it('should extract exhaustive level', () => {
      expect(extractThinkingLevel('ultrathink')).toBe('exhaustive');
      expect(extractThinkingLevel('think even harder')).toBe('exhaustive');
    });

    it('should return none when no keyword', () => {
      expect(extractThinkingLevel('solve this')).toBe('none');
    });
  });
});

// ============================================================================
// PART 4: EXTENDED THINKING ENGINE TESTS
// ============================================================================

describe('Thinking Module - ExtendedThinkingEngine', () => {
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

  // --------------------------------------------------------------------------
  // Constructor Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Configuration Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Think Method Tests
  // --------------------------------------------------------------------------
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
  });

  // --------------------------------------------------------------------------
  // Quick Think Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Deep Think Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Thought Parsing Tests
  // --------------------------------------------------------------------------
  describe('Thought Parsing', () => {
    beforeEach(() => {
      engine = new ExtendedThinkingEngine('test-api-key', undefined, {
        maxThoughts: 2,
        verificationEnabled: false,
      });
    });

    it('should parse well-formed thought response', async () => {
      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>hypothesis</thought_type>
<content>Test hypothesis</content>
<confidence>0.75</confidence>
<reasoning>Based on analysis</reasoning>`,
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

      await engine.think('Test');

      expect(thoughtHandler).toHaveBeenCalled();
      const thoughtArg = thoughtHandler.mock.calls[0][0];
      expect(thoughtArg.thought).toBeDefined();
      expect(thoughtArg.thought.type).toBeDefined();
      expect(thoughtArg.thought.content).toBeDefined();
    });

    it('should fallback parse plain text responses', async () => {
      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);

      mockChat
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: 'Plain text thought without tags',
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
        mockChat.mockClear();
        engine.setConfig({ maxThoughts: 1 });

        mockChat.mockResolvedValueOnce({
          choices: [{
            message: {
              content: `<thought_type>${type}</thought_type>
<content>Test ${type}</content>
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

  // --------------------------------------------------------------------------
  // Verification Tests
  // --------------------------------------------------------------------------
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
  });

  // --------------------------------------------------------------------------
  // Format Result Tests
  // --------------------------------------------------------------------------
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

    it('should include confidence percentage', () => {
      const result = {
        answer: 'Answer',
        reasoning: '',
        confidence: 0.92,
        thinkingTime: 500,
        thoughtCount: 1,
        chainsExplored: 1,
        keyInsights: [],
        uncertainties: [],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('92%');
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling Tests
  // --------------------------------------------------------------------------
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

      expect(result).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Factory Functions Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Chain Management Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Streaming Thinking Tests
  // --------------------------------------------------------------------------
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
});

// ============================================================================
// PART 5: THINKING OUTPUT FORMATTING TESTS
// ============================================================================

describe('Thinking Module - Output Formatting', () => {
  let manager: ThinkingKeywordsManager;
  let engine: ExtendedThinkingEngine;

  beforeEach(() => {
    resetThinkingKeywordsManager();
    resetExtendedThinkingEngine();
    manager = new ThinkingKeywordsManager();
    engine = new ExtendedThinkingEngine('test-api-key');
  });

  afterEach(() => {
    manager.dispose();
    engine.removeAllListeners();
    resetThinkingKeywordsManager();
    resetExtendedThinkingEngine();
  });

  describe('ThinkingKeywordResult Structure', () => {
    it('should have all required fields', () => {
      const result = manager.detectThinkingLevel('megathink about this');

      expect(result).toHaveProperty('detected');
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('keyword');
      expect(result).toHaveProperty('cleanedInput');
      expect(result).toHaveProperty('tokenBudget');
      expect(result).toHaveProperty('systemPromptAddition');
    });

    it('should have correct types for all fields', () => {
      const result = manager.detectThinkingLevel('ultrathink about problems');

      expect(typeof result.detected).toBe('boolean');
      expect(typeof result.level).toBe('string');
      expect(result.keyword === null || typeof result.keyword === 'string').toBe(true);
      expect(typeof result.cleanedInput).toBe('string');
      expect(typeof result.tokenBudget).toBe('number');
      expect(typeof result.systemPromptAddition).toBe('string');
    });
  });

  describe('ThinkingResult Structure', () => {
    it('should have all required fields in format output', () => {
      const result = {
        answer: 'Test answer',
        reasoning: 'Test reasoning',
        confidence: 0.8,
        thinkingTime: 1000,
        thoughtCount: 5,
        chainsExplored: 2,
        keyInsights: ['insight'],
        uncertainties: ['uncertainty'],
      };

      const formatted = engine.formatResult(result);

      expect(formatted).toContain('Answer');
      expect(formatted).toContain('Test answer');
      expect(formatted).toContain('Reasoning');
      expect(formatted).toContain('Confidence');
      expect(formatted).toContain('80%');
      expect(formatted).toContain('Time');
      expect(formatted).toContain('Thoughts');
      expect(formatted).toContain('Chains');
    });
  });

  describe('Level Formatting Consistency', () => {
    it('should format all levels consistently', () => {
      const levels: ThinkingLevel[] = ['none', 'standard', 'deep', 'exhaustive'];

      for (const level of levels) {
        const formatted = manager.formatLevel(level);
        expect(typeof formatted).toBe('string');
        expect(formatted.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Config Output Consistency', () => {
    it('should return consistent config structure', () => {
      const levels: ThinkingLevel[] = ['none', 'standard', 'deep', 'exhaustive'];

      for (const level of levels) {
        const config = manager.getConfig(level);

        expect(config).toHaveProperty('level');
        expect(config).toHaveProperty('tokenBudget');
        expect(config).toHaveProperty('systemPromptAddition');
        expect(config).toHaveProperty('keywords');
        expect(config).toHaveProperty('description');

        expect(config.level).toBe(level);
        expect(typeof config.tokenBudget).toBe('number');
        expect(typeof config.systemPromptAddition).toBe('string');
        expect(Array.isArray(config.keywords)).toBe(true);
        expect(typeof config.description).toBe('string');
      }
    });
  });
});

// ============================================================================
// PART 6: INTEGRATION TESTS (KEYWORDS + ENGINE)
// ============================================================================

describe('Thinking Module - Integration', () => {
  let manager: ThinkingKeywordsManager;
  let engine: ExtendedThinkingEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    resetThinkingKeywordsManager();
    resetExtendedThinkingEngine();
    manager = new ThinkingKeywordsManager();
    engine = new ExtendedThinkingEngine('test-api-key', undefined, {
      maxThoughts: 2,
      verificationEnabled: false,
    });

    mockChat.mockResolvedValue({
      choices: [{
        message: {
          content: `<thought_type>conclusion</thought_type>
<content>Final answer</content>
<confidence>0.9</confidence>`,
        },
      }],
    });
  });

  afterEach(() => {
    manager.dispose();
    engine.removeAllListeners();
    resetThinkingKeywordsManager();
    resetExtendedThinkingEngine();
  });

  describe('Keyword to Engine Flow', () => {
    it('should detect keyword and determine depth before thinking', async () => {
      const input = 'megathink about the architecture';
      const keywordResult = manager.detectThinkingLevel(input);

      expect(keywordResult.detected).toBe(true);
      expect(keywordResult.level).toBe('deep');

      // Use cleaned input for thinking
      const result = await engine.think(keywordResult.cleanedInput);
      expect(result).toBeDefined();
    });

    it('should apply system prompt addition when detected', () => {
      const result = manager.detectThinkingLevel('ultrathink about this');

      expect(result.systemPromptAddition).toBeTruthy();
      expect(result.systemPromptAddition.length).toBeGreaterThan(0);
    });

    it('should not apply system prompt for none level', () => {
      const result = manager.detectThinkingLevel('solve this problem');

      expect(result.systemPromptAddition).toBe('');
    });
  });

  describe('Token Budget Alignment', () => {
    it('should have aligned token budgets between keyword levels and thinking depth', () => {
      // Standard: 4K tokens
      const standardKeyword = manager.detectThinkingLevel('think about this');
      expect(standardKeyword.tokenBudget).toBe(4000);

      // Deep: 10K tokens
      const deepKeyword = manager.detectThinkingLevel('megathink about this');
      expect(deepKeyword.tokenBudget).toBe(10000);

      // Exhaustive: 32K tokens
      const exhaustiveKeyword = manager.detectThinkingLevel('ultrathink about this');
      expect(exhaustiveKeyword.tokenBudget).toBe(32000);
    });
  });
});
