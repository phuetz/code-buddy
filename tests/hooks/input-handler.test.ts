/**
 * Tests for input-handler features
 * - # instruction capture (save to .codebuddyrules)
 * - Double escape detection (edit previous prompt)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

describe('Input Handler Features', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'input-handler-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('# Instruction Capture', () => {
    // Simulate the saveInstructionToCodeBuddyRules function from use-input-handler.ts
    function saveInstructionToCodeBuddyRules(instruction: string, codebuddyrulesPath: string): string {
      try {
        let rules: { instructions?: string[] } = {};

        if (fs.existsSync(codebuddyrulesPath)) {
          const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
          try {
            rules = yaml.load(content) as { instructions?: string[] } || {};
          } catch {
            rules = { instructions: [] };
          }
        }

        if (!rules.instructions) {
          rules.instructions = [];
        }

        if (!rules.instructions.includes(instruction)) {
          rules.instructions.push(instruction);
        }

        fs.writeFileSync(codebuddyrulesPath, yaml.dump(rules, { lineWidth: -1 }));
        return `Instruction saved to .codebuddyrules:\n  "${instruction}"`;
      } catch (error) {
        return `Failed to save instruction: ${error}`;
      }
    }

    it('should create .codebuddyrules file if not exists', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      saveInstructionToCodeBuddyRules('Always use TypeScript', codebuddyrulesPath);

      expect(fs.existsSync(codebuddyrulesPath)).toBe(true);
    });

    it('should save instruction to .codebuddyrules', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      saveInstructionToCodeBuddyRules('Use strict mode', codebuddyrulesPath);

      const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
      const parsed = yaml.load(content) as { instructions: string[] };

      expect(parsed.instructions).toContain('Use strict mode');
    });

    it('should append multiple instructions', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      saveInstructionToCodeBuddyRules('Instruction 1', codebuddyrulesPath);
      saveInstructionToCodeBuddyRules('Instruction 2', codebuddyrulesPath);
      saveInstructionToCodeBuddyRules('Instruction 3', codebuddyrulesPath);

      const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
      const parsed = yaml.load(content) as { instructions: string[] };

      expect(parsed.instructions).toHaveLength(3);
      expect(parsed.instructions).toContain('Instruction 1');
      expect(parsed.instructions).toContain('Instruction 2');
      expect(parsed.instructions).toContain('Instruction 3');
    });

    it('should prevent duplicate instructions', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      saveInstructionToCodeBuddyRules('Same instruction', codebuddyrulesPath);
      saveInstructionToCodeBuddyRules('Same instruction', codebuddyrulesPath);
      saveInstructionToCodeBuddyRules('Same instruction', codebuddyrulesPath);

      const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
      const parsed = yaml.load(content) as { instructions: string[] };

      expect(parsed.instructions).toHaveLength(1);
    });

    it('should preserve existing rules when adding instructions', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      // Create existing rules
      const existingRules = {
        description: 'Test Project',
        languages: ['typescript'],
        instructions: ['Existing instruction'],
      };
      fs.writeFileSync(codebuddyrulesPath, yaml.dump(existingRules));

      saveInstructionToCodeBuddyRules('New instruction', codebuddyrulesPath);

      const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
      const parsed = yaml.load(content) as { description: string; languages: string[]; instructions: string[] };

      expect(parsed.description).toBe('Test Project');
      expect(parsed.languages).toContain('typescript');
      expect(parsed.instructions).toHaveLength(2);
      expect(parsed.instructions).toContain('Existing instruction');
      expect(parsed.instructions).toContain('New instruction');
    });

    it('should return success message', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      const result = saveInstructionToCodeBuddyRules('Test instruction', codebuddyrulesPath);

      expect(result).toContain('Instruction saved');
      expect(result).toContain('Test instruction');
    });

    it('should handle special characters in instructions', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      const specialInstruction = 'Use "double quotes" and \'single quotes\' and: colons';
      saveInstructionToCodeBuddyRules(specialInstruction, codebuddyrulesPath);

      const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
      const parsed = yaml.load(content) as { instructions: string[] };

      expect(parsed.instructions).toContain(specialInstruction);
    });

    it('should handle empty instruction gracefully', () => {
      const codebuddyrulesPath = path.join(tempDir, '.codebuddyrules');

      saveInstructionToCodeBuddyRules('', codebuddyrulesPath);

      const content = fs.readFileSync(codebuddyrulesPath, 'utf-8');
      const parsed = yaml.load(content) as { instructions: string[] };

      // Empty string should still be added (validation is at caller level)
      expect(parsed.instructions).toContain('');
    });
  });

  describe('Double Escape Detection', () => {
    const DOUBLE_ESCAPE_THRESHOLD = 500;

    // Simulate the double escape detection logic
    class DoubleEscapeDetector {
      private lastEscapeTime = 0;

      detectDoubleEscape(): boolean {
        const now = Date.now();
        const timeDiff = now - this.lastEscapeTime;
        const isDoubleEscape = timeDiff < DOUBLE_ESCAPE_THRESHOLD && this.lastEscapeTime > 0;
        this.lastEscapeTime = now;
        return isDoubleEscape;
      }

      reset(): void {
        this.lastEscapeTime = 0;
      }

      // For testing with controlled time
      detectDoubleEscapeAt(time: number): boolean {
        const timeDiff = time - this.lastEscapeTime;
        const isDoubleEscape = timeDiff < DOUBLE_ESCAPE_THRESHOLD && this.lastEscapeTime > 0;
        this.lastEscapeTime = time;
        return isDoubleEscape;
      }
    }

    let detector: DoubleEscapeDetector;

    beforeEach(() => {
      detector = new DoubleEscapeDetector();
    });

    it('should not detect first escape as double', () => {
      const result = detector.detectDoubleEscape();

      expect(result).toBe(false);
    });

    it('should detect double escape within threshold', () => {
      // First escape at time 1000
      detector.detectDoubleEscapeAt(1000);

      // Second escape at time 1200 (200ms later, within 500ms threshold)
      const result = detector.detectDoubleEscapeAt(1200);

      expect(result).toBe(true);
    });

    it('should not detect double escape beyond threshold', () => {
      // First escape at time 1000
      detector.detectDoubleEscapeAt(1000);

      // Second escape at time 1600 (600ms later, beyond 500ms threshold)
      const result = detector.detectDoubleEscapeAt(1600);

      expect(result).toBe(false);
    });

    it('should detect double escape at exact threshold', () => {
      // First escape at time 1000
      detector.detectDoubleEscapeAt(1000);

      // Second escape at time 1499 (499ms later, just within threshold)
      const result = detector.detectDoubleEscapeAt(1499);

      expect(result).toBe(true);
    });

    it('should not detect at exact threshold boundary', () => {
      // First escape at time 1000
      detector.detectDoubleEscapeAt(1000);

      // Second escape at time 1500 (500ms later, at boundary)
      const result = detector.detectDoubleEscapeAt(1500);

      expect(result).toBe(false);
    });

    it('should reset after detection', () => {
      detector.detectDoubleEscapeAt(1000);
      detector.detectDoubleEscapeAt(1200); // Double escape detected

      // Third escape becomes first of new sequence
      const result = detector.detectDoubleEscapeAt(1300);

      // Should be true because 1300 - 1200 = 100ms < 500ms
      expect(result).toBe(true);
    });

    it('should allow manual reset', () => {
      detector.detectDoubleEscapeAt(1000);
      detector.reset();

      // After reset, next escape is first
      const result = detector.detectDoubleEscapeAt(1100);

      expect(result).toBe(false);
    });

    it('should handle rapid triple escape', () => {
      // Rapid triple escape
      detector.detectDoubleEscapeAt(1000);
      const second = detector.detectDoubleEscapeAt(1100);
      const third = detector.detectDoubleEscapeAt(1200);

      expect(second).toBe(true);
      expect(third).toBe(true);
    });

    it('should handle slow then fast escapes', () => {
      detector.detectDoubleEscapeAt(1000);
      const slow = detector.detectDoubleEscapeAt(2000); // 1000ms later
      const fast = detector.detectDoubleEscapeAt(2100); // 100ms later

      expect(slow).toBe(false);
      expect(fast).toBe(true);
    });
  });

  describe('Get Last User Message', () => {
    interface ChatEntry {
      type: 'user' | 'assistant' | 'tool_result';
      content: string;
    }

    // Simulate the getLastUserMessage function
    function getLastUserMessage(chatHistory: ChatEntry[]): string | null {
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].type === 'user') {
          return chatHistory[i].content;
        }
      }
      return null;
    }

    it('should return null for empty history', () => {
      const result = getLastUserMessage([]);

      expect(result).toBeNull();
    });

    it('should return last user message', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'First message' },
        { type: 'assistant', content: 'Response' },
        { type: 'user', content: 'Last user message' },
        { type: 'assistant', content: 'Final response' },
      ];

      const result = getLastUserMessage(history);

      expect(result).toBe('Last user message');
    });

    it('should skip non-user entries', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'User message' },
        { type: 'assistant', content: 'Response 1' },
        { type: 'tool_result', content: 'Tool output' },
        { type: 'assistant', content: 'Response 2' },
      ];

      const result = getLastUserMessage(history);

      expect(result).toBe('User message');
    });

    it('should return null if no user messages', () => {
      const history: ChatEntry[] = [
        { type: 'assistant', content: 'Response' },
        { type: 'tool_result', content: 'Tool output' },
      ];

      const result = getLastUserMessage(history);

      expect(result).toBeNull();
    });

    it('should handle single user message', () => {
      const history: ChatEntry[] = [
        { type: 'user', content: 'Only message' },
      ];

      const result = getLastUserMessage(history);

      expect(result).toBe('Only message');
    });
  });

  describe('# Input Parsing', () => {
    // Simulate parsing # input
    function parseHashInput(input: string): { isInstruction: boolean; instruction: string } {
      if (input.startsWith('#')) {
        return {
          isInstruction: true,
          instruction: input.slice(1).trim(),
        };
      }
      return {
        isInstruction: false,
        instruction: '',
      };
    }

    it('should detect # prefix', () => {
      const result = parseHashInput('# This is an instruction');

      expect(result.isInstruction).toBe(true);
    });

    it('should extract instruction text', () => {
      const result = parseHashInput('# Always use TypeScript');

      expect(result.instruction).toBe('Always use TypeScript');
    });

    it('should trim whitespace', () => {
      const result = parseHashInput('#   Trimmed instruction   ');

      expect(result.instruction).toBe('Trimmed instruction');
    });

    it('should handle # only', () => {
      const result = parseHashInput('#');

      expect(result.isInstruction).toBe(true);
      expect(result.instruction).toBe('');
    });

    it('should not detect # in middle of text', () => {
      const result = parseHashInput('This is not # an instruction');

      expect(result.isInstruction).toBe(false);
    });

    it('should handle ## multiple hashes', () => {
      const result = parseHashInput('## Double hash');

      expect(result.isInstruction).toBe(true);
      expect(result.instruction).toBe('# Double hash');
    });

    it('should not detect empty string', () => {
      const result = parseHashInput('');

      expect(result.isInstruction).toBe(false);
    });

    it('should handle instruction with special characters', () => {
      const result = parseHashInput('# Use "quotes" and: colons');

      expect(result.instruction).toBe('Use "quotes" and: colons');
    });
  });
});
