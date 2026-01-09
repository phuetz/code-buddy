import { 
  ThinkingKeywordsManager, 
  getThinkingKeywordsManager, 
  resetThinkingKeywordsManager,
  hasThinkingKeyword,
  extractThinkingLevel
} from '../../src/agent/thinking-keywords';

describe('ThinkingKeywords System', () => {
  beforeEach(() => {
    resetThinkingKeywordsManager();
  });

  describe('ThinkingKeywordsManager', () => {
    it('should detect standard thinking', () => {
      const manager = new ThinkingKeywordsManager();
      const result = manager.detectThinkingLevel('think about the problem');
      
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
      expect(result.keyword).toBe('think about');
      expect(result.cleanedInput).toBe('the problem');
      expect(result.tokenBudget).toBe(4000);
    });

    it('should detect deep thinking (megathink)', () => {
      const manager = new ThinkingKeywordsManager();
      const result = manager.detectThinkingLevel('megathink: how to build a rocket');
      
      expect(result.detected).toBe(true);
      expect(result.level).toBe('deep');
      expect(result.keyword).toBe('megathink');
      expect(result.cleanedInput).toBe('how to build a rocket');
      expect(result.tokenBudget).toBe(10000);
    });

    it('should detect exhaustive thinking (ultrathink)', () => {
      const manager = new ThinkingKeywordsManager();
      const result = manager.detectThinkingLevel('ultrathink through the security architecture');
      
      expect(result.detected).toBe(true);
      expect(result.level).toBe('exhaustive');
      expect(result.keyword).toBe('ultrathink');
      expect(result.cleanedInput).toBe('through the security architecture');
      expect(result.tokenBudget).toBe(32000);
    });

    it('should handle "think" without specific suffix', () => {
      const manager = new ThinkingKeywordsManager();
      const result = manager.detectThinkingLevel('think of a solution');
      
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
      expect(result.keyword).toBe('think');
      expect(result.cleanedInput).toBe('of a solution');
    });

    it('should use default level when no keyword is detected', () => {
      const manager = new ThinkingKeywordsManager({ defaultLevel: 'standard' });
      const result = manager.detectThinkingLevel('normal question');
      
      expect(result.detected).toBe(true);
      expect(result.level).toBe('standard');
      expect(result.keyword).toBeNull();
      expect(result.cleanedInput).toBe('normal question');
    });

    it('should return none when disabled', () => {
      const manager = new ThinkingKeywordsManager({ enabled: false });
      const result = manager.detectThinkingLevel('think hard');
      
      expect(result.detected).toBe(false);
      expect(result.level).toBe('none');
    });

    it('should emit event when thinking is detected', () => {
      const manager = new ThinkingKeywordsManager();
      const handler = jest.fn();
      manager.on('thinking:detected', handler);
      
      manager.detectThinkingLevel('think harder');
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        level: 'deep',
        keyword: 'think harder'
      }));
    });

    it('should format levels correctly', () => {
      const manager = new ThinkingKeywordsManager();
      expect(manager.formatLevel('standard')).toContain('🧠');
      expect(manager.formatLevel('exhaustive')).toContain('🧠🧠🧠');
    });

    it('should provide help text', () => {
      const manager = new ThinkingKeywordsManager();
      const help = manager.getHelpText();
      expect(help).toContain('Extended Thinking Keywords');
      expect(help).toContain('megathink');
    });
  });

  describe('Utility Functions', () => {
    it('hasThinkingKeyword should return true if keyword exists', () => {
      expect(hasThinkingKeyword('please think about this')).toBe(true);
      expect(hasThinkingKeyword('just a question')).toBe(false);
    });

    it('extractThinkingLevel should return correct level', () => {
      expect(extractThinkingLevel('ultrathink')).toBe('exhaustive');
      expect(extractThinkingLevel('think')).toBe('standard');
      expect(extractThinkingLevel('nothing')).toBe('none');
    });
  });

  describe('Singleton', () => {
    it('should return the same instance', () => {
      const m1 = getThinkingKeywordsManager();
      const m2 = getThinkingKeywordsManager();
      expect(m1).toBe(m2);
    });
  });
});
