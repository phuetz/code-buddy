/**
 * Tests for ImportanceScorer — content type detection, scoring formula,
 * recency boost, length penalty, role bonuses, and compression prioritization.
 */

import {
  ImportanceScorer,
  createImportanceScorer,
  DEFAULT_IMPORTANCE_WEIGHTS,
  DEFAULT_SCORING_CONFIG,
} from '../../src/context/importance-scorer';
import type { CodeBuddyMessage } from '../../src/codebuddy/client';

describe('ImportanceScorer', () => {
  let scorer: ImportanceScorer;

  beforeEach(() => {
    scorer = new ImportanceScorer();
  });

  // --------------------------------------------------------------------------
  // Default scoring weights
  // --------------------------------------------------------------------------

  describe('DEFAULT_IMPORTANCE_WEIGHTS', () => {
    it('should have system as highest weight (1.0)', () => {
      expect(DEFAULT_IMPORTANCE_WEIGHTS.system).toBe(1.0);
    });

    it('should have error weight higher than conversation', () => {
      expect(DEFAULT_IMPORTANCE_WEIGHTS.error).toBeGreaterThan(
        DEFAULT_IMPORTANCE_WEIGHTS.conversation
      );
    });

    it('should have decision weight higher than code', () => {
      expect(DEFAULT_IMPORTANCE_WEIGHTS.decision).toBeGreaterThan(
        DEFAULT_IMPORTANCE_WEIGHTS.code
      );
    });

    it('should have conversation as lowest weight', () => {
      const weights = Object.values(DEFAULT_IMPORTANCE_WEIGHTS);
      const minWeight = Math.min(...weights);
      expect(DEFAULT_IMPORTANCE_WEIGHTS.conversation).toBe(minWeight);
    });
  });

  // --------------------------------------------------------------------------
  // Content type detection
  // --------------------------------------------------------------------------

  describe('content type detection', () => {
    it('should detect system messages', () => {
      const msg: CodeBuddyMessage = { role: 'system', content: 'You are a helpful assistant' };
      expect(scorer.detectContentType(msg)).toBe('system');
    });

    it('should detect code blocks', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'Here is some code:\n```typescript\nconst x = 1;\n```',
      };
      expect(scorer.detectContentType(msg)).toBe('code');
    });

    it('should detect code via function/class keywords', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'function doSomething() {\n  return true;\n}',
      };
      expect(scorer.detectContentType(msg)).toBe('code');
    });

    it('should detect error messages', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'Error: Cannot find module "foo"',
      };
      expect(scorer.detectContentType(msg)).toBe('error');
    });

    it('should detect exception content', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'An unhandled exception occurred in the process',
      };
      expect(scorer.detectContentType(msg)).toBe('error');
    });

    it('should detect decision content', () => {
      const msg: CodeBuddyMessage = {
        role: 'user',
        content: 'I decided to use TypeScript for the project',
      };
      expect(scorer.detectContentType(msg)).toBe('decision');
    });

    it('should detect "will use" as decision', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'We will use React for the frontend',
      };
      expect(scorer.detectContentType(msg)).toBe('decision');
    });

    it('should detect file content via diff markers', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: '+++ b/src/index.ts\n@@ -1,5 +1,6 @@\n some content',
      };
      expect(scorer.detectContentType(msg)).toBe('file_content');
    });

    it('should detect command content', () => {
      const msg: CodeBuddyMessage = {
        role: 'user',
        content: '$ npm install express',
      };
      expect(scorer.detectContentType(msg)).toBe('command');
    });

    it('should detect git commands', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'Run git commit -m "initial commit"',
      };
      expect(scorer.detectContentType(msg)).toBe('command');
    });

    it('should detect tool results', () => {
      const msg: CodeBuddyMessage = {
        role: 'tool',
        content: '{"success": true, "output": "file created"}',
        tool_call_id: 'call_123',
      };
      expect(scorer.detectContentType(msg)).toBe('tool_result');
    });

    it('should detect failed tool results as error', () => {
      const msg: CodeBuddyMessage = {
        role: 'tool',
        content: '{"success": false, "error": "permission denied"}',
        tool_call_id: 'call_123',
      };
      expect(scorer.detectContentType(msg)).toBe('error');
    });

    it('should default to conversation for unmatched content', () => {
      const msg: CodeBuddyMessage = {
        role: 'user',
        content: 'Hello, how are you today?',
      };
      expect(scorer.detectContentType(msg)).toBe('conversation');
    });
  });

  // --------------------------------------------------------------------------
  // Recency boost
  // --------------------------------------------------------------------------

  describe('recency boost', () => {
    it('should give higher scores to more recent messages', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi back' },
        { role: 'user', content: 'Another hello' },
        { role: 'assistant', content: 'Another hi' },
      ];

      const scores = scorer.scoreMessages(messages);
      // Messages at later indices should have higher recency contribution
      // Comparing same roles to isolate recency effect
      expect(scores[2].score).toBeGreaterThan(scores[0].score);
      expect(scores[3].score).toBeGreaterThan(scores[1].score);
    });

    it('should apply full recency boost to the last message', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: 'first' },
        { role: 'assistant', content: 'last' },
      ];

      const scores = scorer.scoreMessages(messages);
      // Last message gets full recencyBoost (0.3), first gets 0
      expect(scores[1].score - scores[0].score).toBeCloseTo(0.3, 1);
    });

    it('should handle single message gracefully', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: 'only message' },
      ];

      const scores = scorer.scoreMessages(messages);
      expect(scores).toHaveLength(1);
      // Single message gets full recency boost
      expect(scores[0].score).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Length penalty
  // --------------------------------------------------------------------------

  describe('length penalty', () => {
    it('should penalize messages longer than threshold', () => {
      const shortMsg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'Short message',
      };
      const longMsg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'x'.repeat(6000),
      };

      const shortScore = scorer.scoreMessage(shortMsg, 0, 2);
      const longScore = scorer.scoreMessage(longMsg, 0, 2);

      expect(longScore.score).toBeLessThan(shortScore.score);
    });

    it('should not penalize messages under threshold', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'x'.repeat(4999),
      };

      const score = scorer.scoreMessage(msg, 0, 1);
      // Should not have a length factor in the factors list (only base, recency)
      const hasLengthFactor = score.factors.some(f => f.startsWith('length('));
      expect(hasLengthFactor).toBe(false);
    });

    it('should include length in factors when penalty applies', () => {
      const msg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'x'.repeat(6000),
      };

      const score = scorer.scoreMessage(msg, 0, 1);
      const hasLengthFactor = score.factors.some(f => f.startsWith('length('));
      expect(hasLengthFactor).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // prioritizeForCompression
  // --------------------------------------------------------------------------

  describe('prioritizeForCompression', () => {
    it('should return indices sorted by ascending score', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'System prompt' },         // highest (system)
        { role: 'user', content: 'Hello there' },             // conversation + user bonus
        { role: 'assistant', content: 'Error: something broke' }, // error type
        { role: 'assistant', content: 'Just chatting' },      // conversation, no bonus
      ];

      const indices = scorer.prioritizeForCompression(messages);
      expect(indices).toHaveLength(4);

      // The first index should be the least important message
      // Verify ordering: get scores to check
      const scores = scorer.scoreMessages(messages);
      for (let i = 1; i < indices.length; i++) {
        expect(scores[indices[i]].score).toBeGreaterThanOrEqual(
          scores[indices[i - 1]].score
        );
      }
    });

    it('should put conversation messages first for compression', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: 'Just a chat message' },
        { role: 'system', content: 'You are helpful' },
        { role: 'assistant', content: 'Error: file not found' },
      ];

      const indices = scorer.prioritizeForCompression(messages);
      // Conversation (index 0) should be first to compress (lowest score)
      expect(indices[0]).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // System messages get highest scores
  // --------------------------------------------------------------------------

  describe('system message scoring', () => {
    it('should give system messages the highest base score', () => {
      const systemMsg: CodeBuddyMessage = { role: 'system', content: 'You are an AI' };
      const userMsg: CodeBuddyMessage = { role: 'user', content: 'Hello' };
      const assistantMsg: CodeBuddyMessage = { role: 'assistant', content: 'Hi' };

      // Score all at same position to isolate type/role effects
      const sysScore = scorer.scoreMessage(systemMsg, 0, 3);
      const usrScore = scorer.scoreMessage(userMsg, 0, 3);
      const asstScore = scorer.scoreMessage(assistantMsg, 0, 3);

      expect(sysScore.score).toBeGreaterThan(usrScore.score);
      expect(sysScore.score).toBeGreaterThan(asstScore.score);
    });

    it('should detect system role regardless of content', () => {
      const msg: CodeBuddyMessage = { role: 'system', content: 'Hello world' };
      expect(scorer.detectContentType(msg)).toBe('system');
    });
  });

  // --------------------------------------------------------------------------
  // Error messages score higher than conversation
  // --------------------------------------------------------------------------

  describe('error vs conversation scoring', () => {
    it('should score error messages higher than plain conversation', () => {
      const errorMsg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'Error: connection refused to database',
      };
      const chatMsg: CodeBuddyMessage = {
        role: 'assistant',
        content: 'That sounds interesting, tell me more',
      };

      const errorScore = scorer.scoreMessage(errorMsg, 0, 2);
      const chatScore = scorer.scoreMessage(chatMsg, 0, 2);

      expect(errorScore.score).toBeGreaterThan(chatScore.score);
    });
  });

  // --------------------------------------------------------------------------
  // User messages get role bonus
  // --------------------------------------------------------------------------

  describe('role bonuses', () => {
    it('should give user messages a +0.1 bonus', () => {
      const userMsg: CodeBuddyMessage = { role: 'user', content: 'Just chatting' };
      const assistantMsg: CodeBuddyMessage = { role: 'assistant', content: 'Just chatting' };

      // Same position, same content type (conversation)
      const userScore = scorer.scoreMessage(userMsg, 5, 10);
      const asstScore = scorer.scoreMessage(assistantMsg, 5, 10);

      expect(userScore.score - asstScore.score).toBeCloseTo(0.1, 2);
    });

    it('should give system messages a +0.2 bonus on top of base weight', () => {
      const score = scorer.scoreMessage(
        { role: 'system', content: 'prompt' },
        0,
        1
      );
      // system base weight (1.0) + recency (0.3 for single msg) + role bonus (0.2) = 1.5 clamped to 1.0
      expect(score.score).toBe(1.0);
    });

    it('should include role factor in the factors list', () => {
      const userScore = scorer.scoreMessage(
        { role: 'user', content: 'Hello' },
        0,
        1
      );
      expect(userScore.factors).toContain('role(user): +0.1');
    });
  });

  // --------------------------------------------------------------------------
  // scoreMessages returns correct structure
  // --------------------------------------------------------------------------

  describe('scoreMessages', () => {
    it('should return one score per message', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Bye' },
      ];

      const scores = scorer.scoreMessages(messages);
      expect(scores).toHaveLength(3);
      expect(scores[0].messageIndex).toBe(0);
      expect(scores[1].messageIndex).toBe(1);
      expect(scores[2].messageIndex).toBe(2);
    });

    it('should include contentType in each score', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'function test() {}' },
      ];

      const scores = scorer.scoreMessages(messages);
      expect(scores[0].contentType).toBe('system');
      expect(scores[1].contentType).toBe('code');
    });

    it('should clamp scores between 0 and 1', () => {
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'Prompt' },  // Could exceed 1.0 without clamping
        { role: 'assistant', content: 'x'.repeat(10000) }, // Could go below 0 without clamping
      ];

      const scores = scorer.scoreMessages(messages);
      for (const score of scores) {
        expect(score.score).toBeGreaterThanOrEqual(0);
        expect(score.score).toBeLessThanOrEqual(1);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Custom configuration
  // --------------------------------------------------------------------------

  describe('custom configuration', () => {
    it('should allow overriding weights', () => {
      const custom = new ImportanceScorer({
        weights: { conversation: 0.99 },
      });

      const msg: CodeBuddyMessage = { role: 'assistant', content: 'Just chatting' };
      const score = custom.scoreMessage(msg, 0, 1);
      // conversation weight is now 0.99 instead of 0.25
      expect(score.score).toBeGreaterThan(0.9);
    });

    it('should allow overriding recencyBoost', () => {
      const noRecency = new ImportanceScorer({ recencyBoost: 0 });

      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: 'first' },
        { role: 'assistant', content: 'last' },
      ];

      const scores = noRecency.scoreMessages(messages);
      // Without recency boost, same-type messages at different positions have equal scores
      expect(scores[0].score).toBeCloseTo(scores[1].score, 5);
    });

    it('should allow overriding length penalty threshold', () => {
      const strictLength = new ImportanceScorer({
        lengthPenalty: 100,
        lengthPenaltyAmount: 0.5,
      });

      const msg: CodeBuddyMessage = { role: 'assistant', content: 'x'.repeat(200) };
      const score = strictLength.scoreMessage(msg, 0, 1);
      const hasLengthFactor = score.factors.some(f => f.startsWith('length('));
      expect(hasLengthFactor).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Factory function
  // --------------------------------------------------------------------------

  describe('createImportanceScorer', () => {
    it('should create a scorer with default config', () => {
      const s = createImportanceScorer();
      expect(s).toBeInstanceOf(ImportanceScorer);
      expect(s.getConfig().recencyBoost).toBe(DEFAULT_SCORING_CONFIG.recencyBoost);
    });

    it('should create a scorer with custom config', () => {
      const s = createImportanceScorer({ recencyBoost: 0.1 });
      expect(s.getConfig().recencyBoost).toBe(0.1);
    });
  });

  // --------------------------------------------------------------------------
  // getConfig
  // --------------------------------------------------------------------------

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config = scorer.getConfig();
      // Mutating the returned config should not affect the scorer
      config.recencyBoost = 999;
      expect(scorer.getConfig().recencyBoost).toBe(DEFAULT_SCORING_CONFIG.recencyBoost);
    });

    it('should return a copy of weights', () => {
      const config = scorer.getConfig();
      (config.weights as Record<string, number>).system = 0;
      expect(scorer.getConfig().weights.system).toBe(1.0);
    });
  });
});
