/**
 * Tests for PrecompactionFlusher — silent background memory extraction
 *
 * Uses real fs in tmpDir for saveFacts tests.
 * Mocks chatFn (no real LLM calls) and os.homedir for global fallback.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  PrecompactionFlusher,
  getPrecompactionFlusher,
  FlushMessage,
} from '../../src/context/precompaction-flush';

// Redirect HOME/USERPROFILE for global fallback tests
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

describe('PrecompactionFlusher', () => {
  let tmpDir: string;
  let flusher: PrecompactionFlusher;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flush-test-'));
    flusher = new PrecompactionFlusher();
    // Point HOME to tmpDir for global fallback
    process.env.HOME = path.join(tmpDir, 'fake-home');
    process.env.USERPROFILE = path.join(tmpDir, 'fake-home');
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tmpDir);
  });

  // Helper: build N messages
  function makeMessages(n: number): FlushMessage[] {
    const msgs: FlushMessage[] = [];
    for (let i = 0; i < n; i++) {
      msgs.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: ${'x'.repeat(50)}`,
      });
    }
    return msgs;
  }

  // --------------------------------------------------------------------------
  // flush()
  // --------------------------------------------------------------------------

  describe('flush()', () => {
    it('should skip when messages.length < 4', async () => {
      const chatFn = jest.fn();
      const result = await flusher.flush([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ], chatFn, tmpDir);

      expect(result.flushed).toBe(false);
      expect(result.suppressed).toBe(false);
      expect(chatFn).not.toHaveBeenCalled();
    });

    it('should call chatFn with system prompt and snapshot', async () => {
      const chatFn = jest.fn().mockResolvedValue('NO_REPLY');
      await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(chatFn).toHaveBeenCalledTimes(1);
      const args = chatFn.mock.calls[0][0];
      expect(args).toHaveLength(2);
      expect(args[0].role).toBe('system');
      expect(args[0].content).toContain('memory archivist');
      expect(args[1].role).toBe('user');
      expect(args[1].content).toContain('Conversation to analyse');
    });

    it('should return suppressed=true when LLM returns NO_REPLY', async () => {
      const chatFn = jest.fn().mockResolvedValue('NO_REPLY');
      const result = await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(result.flushed).toBe(false);
      expect(result.suppressed).toBe(true);
      expect(result.factsCount).toBe(0);
    });

    it('should return suppressed=true for NO_REPLY + short ack', async () => {
      const chatFn = jest.fn().mockResolvedValue('NO_REPLY — nothing noteworthy');
      const result = await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(result.flushed).toBe(false);
      expect(result.suppressed).toBe(true);
    });

    it('should extract facts when LLM returns bullet list', async () => {
      const facts = '- User prefers TypeScript strict mode\n- Project uses ESM imports\n- API key stored in .env';
      const chatFn = jest.fn().mockResolvedValue(facts);
      const result = await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(result.flushed).toBe(true);
      expect(result.factsCount).toBe(3);
      expect(result.writtenTo).toContain('MEMORY.md');
    });

    it('should strip NO_REPLY prefix when followed by long content', async () => {
      const longFacts = 'NO_REPLY\n' + Array(50).fill('- fact line').join('\n');
      const chatFn = jest.fn().mockResolvedValue(longFacts);
      const result = await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(result.flushed).toBe(true);
      expect(result.factsCount).toBe(50);
    });

    it('should return flushed=false when chatFn throws', async () => {
      const chatFn = jest.fn().mockRejectedValue(new Error('LLM error'));
      const result = await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(result.flushed).toBe(false);
      expect(result.suppressed).toBe(false);
      expect(result.writtenTo).toBeNull();
    });

    it('should count only lines starting with "-" for factsCount', async () => {
      const mixed = '## Header\n- Fact one\nSome text\n- Fact two\n\n- Fact three';
      const chatFn = jest.fn().mockResolvedValue(mixed);
      const result = await flusher.flush(makeMessages(5), chatFn, tmpDir);

      expect(result.factsCount).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // saveFacts()
  // --------------------------------------------------------------------------

  describe('saveFacts()', () => {
    // Access private method for direct testing
    const callSaveFacts = (f: PrecompactionFlusher, facts: string, workDir: string) =>
      (f as any).saveFacts(facts, workDir);

    it('should write to workDir/MEMORY.md', async () => {
      const result = await callSaveFacts(flusher, '- Fact 1', tmpDir);
      expect(result).toBe(path.join(tmpDir, 'MEMORY.md'));
      const content = fs.readFileSync(result!, 'utf-8');
      expect(content).toContain('- Fact 1');
    });

    it('should append (not overwrite) to existing MEMORY.md', async () => {
      fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), '# Existing\n');
      await callSaveFacts(flusher, '- New fact', tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
      expect(content).toContain('# Existing');
      expect(content).toContain('- New fact');
    });

    it('should include datestamp header', async () => {
      await callSaveFacts(flusher, '- Fact', tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
      expect(content).toMatch(/## Facts extracted \d{4}-\d{2}-\d{2}/);
    });

    it('should fallback to global when workDir write fails', async () => {
      const nonexistent = path.join(tmpDir, 'no', 'such', 'dir');
      const result = await callSaveFacts(flusher, '- Fallback fact', nonexistent);
      expect(result).toContain('.codebuddy');
      expect(result).toContain('MEMORY.md');
    });

    it('should return null when both local and global writes fail', async () => {
      // Point HOME to a read-only location
      process.env.HOME = '/dev/null/impossible';
      process.env.USERPROFILE = '/dev/null/impossible';
      const nonexistent = path.join(tmpDir, 'no', 'such', 'dir');
      const result = await callSaveFacts(flusher, '- Lost fact', nonexistent);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // buildSnapshot() (private, tested via flush behavior)
  // --------------------------------------------------------------------------

  describe('buildSnapshot (via flush)', () => {
    it('should filter out system messages', async () => {
      const msgs: FlushMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User msg 1' },
        { role: 'assistant', content: 'Assistant msg 1' },
        { role: 'user', content: 'User msg 2' },
        { role: 'assistant', content: 'Assistant msg 2' },
      ];
      const chatFn = jest.fn().mockResolvedValue('NO_REPLY');
      await flusher.flush(msgs, chatFn, tmpDir);

      const snapshot = chatFn.mock.calls[0][0][1].content;
      expect(snapshot).not.toContain('System prompt');
      expect(snapshot).toContain('User msg 1');
    });

    it('should truncate content at 800 chars', async () => {
      const msgs: FlushMessage[] = [
        { role: 'user', content: 'A'.repeat(1000) },
        { role: 'assistant', content: 'B'.repeat(100) },
        { role: 'user', content: 'C' },
        { role: 'assistant', content: 'D' },
      ];
      const chatFn = jest.fn().mockResolvedValue('NO_REPLY');
      await flusher.flush(msgs, chatFn, tmpDir);

      const snapshot = chatFn.mock.calls[0][0][1].content;
      // Should contain truncated A's (800 max)
      const aCount = (snapshot.match(/A/g) || []).length;
      expect(aCount).toBeLessThanOrEqual(810); // 800 from content + a few from prefix "**User:** "
    });

    it('should take at most 60 messages', async () => {
      const msgs = makeMessages(80);
      const chatFn = jest.fn().mockResolvedValue('NO_REPLY');
      await flusher.flush(msgs, chatFn, tmpDir);

      const snapshot: string = chatFn.mock.calls[0][0][1].content;
      // 80 messages, last 60, filter out system (none here) = 60 entries
      // Each entry has "**User:**" or "**Assistant:**" prefix
      const entries = snapshot.split('---').filter(s => s.trim());
      expect(entries.length).toBeLessThanOrEqual(60);
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('getPrecompactionFlusher (singleton)', () => {
    it('should return the same instance on repeated calls', () => {
      const a = getPrecompactionFlusher();
      const b = getPrecompactionFlusher();
      expect(a).toBe(b);
    });
  });
});
