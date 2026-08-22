/**
 * WS3-T1 — session-end flush: handoff + review-gated lesson candidates.
 *
 * Covers: trivial-session gating, handoff content (goal/state/risks/files),
 * secret redaction, idempotence, feature-flag kill-switch, and the lesson
 * proposal hand-off to the auto-proposer.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { mockIsFeatureEnabled, mockProposeLessons } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn().mockReturnValue(true),
  mockProposeLessons: vi.fn().mockResolvedValue([]),
}));

const { mockProposeMemories } = vi.hoisted(() => ({
  mockProposeMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('../../src/agent/lesson-auto-proposer.js', () => ({
  proposeLessonsFromSession: mockProposeLessons,
}));

vi.mock('../../src/memory/memory-auto-proposer.js', () => ({
  proposeMemoryCandidatesFromSession: mockProposeMemories,
}));

import {
  extractOpenRisks,
  extractTouchedFiles,
  resetSessionEndFlushState,
  runSessionEndFlush,
  writeHandoffSync,
} from '../../src/agent/session-end-flush.js';
import type { ChatEntry } from '../../src/agent/types.js';

function entry(partial: Partial<ChatEntry> & { type: ChatEntry['type']; content: string }): ChatEntry {
  return { timestamp: new Date(), ...partial } as ChatEntry;
}

function richSession(): ChatEntry[] {
  return [
    entry({ type: 'user', content: 'Migre la base et corrige les tests rouges' }),
    entry({ type: 'assistant', content: 'Je commence par lire le schéma.' }),
    entry({
      type: 'tool_result',
      content: 'Error: migration 3 failed — table messages_fts missing',
      toolCall: { id: 't1', type: 'function', function: { name: 'bash', arguments: '{}' } },
    }),
    entry({
      type: 'tool_call',
      content: 'Editing file',
      toolCall: {
        id: 't2',
        type: 'function',
        function: { name: 'str_replace', arguments: JSON.stringify({ path: 'src/db/schema.ts' }) },
      },
    }),
    entry({ type: 'assistant', content: 'Migration réparée, les tests passent.' }),
  ];
}

describe('session-end-flush (WS3-T1)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'flush-'));
    resetSessionEndFlushState();
    mockIsFeatureEnabled.mockReturnValue(true);
    mockProposeLessons.mockResolvedValue([]);
    mockProposeMemories.mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  describe('extractOpenRisks', () => {
    it('collects error-ish tool results, deduped per tool (newest kept)', () => {
      const history = [
        ...richSession(),
        entry({
          type: 'tool_result',
          content: 'Error: second bash failure — port denied',
          toolCall: { id: 't3', type: 'function', function: { name: 'bash', arguments: '{}' } },
        }),
      ];
      const risks = extractOpenRisks(history);
      expect(risks).toHaveLength(1);
      expect(risks[0]).toContain('`bash`');
      expect(risks[0]).toContain('port denied');
    });

    it('ignores clean tool results', () => {
      expect(extractOpenRisks([
        entry({
          type: 'tool_result',
          content: 'All 12 tests passed',
          toolCall: { id: 't1', type: 'function', function: { name: 'bash', arguments: '{}' } },
        }),
      ])).toEqual([]);
    });
  });

  describe('extractTouchedFiles', () => {
    it('lists files from write-ish tool calls only', () => {
      const files = extractTouchedFiles(richSession());
      expect(files).toEqual(['src/db/schema.ts']);
    });
  });

  describe('writeHandoffSync', () => {
    it('writes a handoff with goal, state, touched files and open risks', () => {
      const target = writeHandoffSync(richSession(), workDir);
      expect(target).toBeDefined();
      const content = readFileSync(target!, 'utf8');
      expect(content).toContain('# Session Handoff');
      expect(content).toContain('Migre la base et corrige les tests rouges');
      expect(content).toContain('Migration réparée, les tests passent.');
      expect(content).toContain('`src/db/schema.ts`');
      expect(content).toContain('migration 3 failed');
      expect(content).toContain('buddy lessons');
    });

    it('skips trivial sessions entirely', () => {
      const target = writeHandoffSync(
        [entry({ type: 'user', content: 'Say OK' }), entry({ type: 'assistant', content: 'OK' })],
        workDir,
      );
      expect(target).toBeUndefined();
      expect(existsSync(join(workDir, '.codebuddy', 'HANDOFF.md'))).toBe(false);
    });

    it('skips small risk-free sessions (below transcript threshold)', () => {
      const history = [
        entry({ type: 'user', content: 'question courte' }),
        entry({ type: 'assistant', content: 'réponse 1' }),
        entry({ type: 'user', content: 'suite' }),
        entry({ type: 'assistant', content: 'réponse 2' }),
      ];
      expect(writeHandoffSync(history, workDir)).toBeUndefined();
    });

    it('is idempotent for the same history array', () => {
      const history = richSession();
      expect(writeHandoffSync(history, workDir)).toBeDefined();
      expect(writeHandoffSync(history, workDir)).toBeUndefined();
    });

    it('redacts secrets instead of persisting them', () => {
      const history = [
        entry({ type: 'user', content: 'déploie' }),
        entry({ type: 'assistant', content: 'je lis la config' }),
        entry({
          type: 'tool_result',
          content: 'Error: leaked -----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg\n-----END PRIVATE KEY----- in deploy',
          toolCall: { id: 't1', type: 'function', function: { name: 'view_file', arguments: '{}' } },
        }),
        entry({ type: 'assistant', content: 'fini' }),
      ];
      const target = writeHandoffSync(history, workDir);
      const content = readFileSync(target!, 'utf8');
      expect(content).not.toContain('BEGIN PRIVATE KEY');
      expect(content).toContain('[REDACTED:');
    });
  });

  describe('runSessionEndFlush', () => {
    it('no-ops when the feature flag is off', async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const result = await runSessionEndFlush({ chatHistory: richSession(), workDir });
      expect(result.skipped).toBe('disabled');
      expect(mockProposeLessons).not.toHaveBeenCalled();
      expect(mockProposeMemories).not.toHaveBeenCalled();
    });

    it('no-ops on trivial sessions without calling the LLM proposer', async () => {
      const result = await runSessionEndFlush({
        chatHistory: [entry({ type: 'user', content: 'hi' }), entry({ type: 'assistant', content: 'hello' })],
        workDir,
      });
      expect(result.skipped).toBe('trivial');
      expect(mockProposeLessons).not.toHaveBeenCalled();
      expect(mockProposeMemories).not.toHaveBeenCalled();
    });

    it('writes the handoff and reports proposed lesson and memory candidates', async () => {
      mockProposeLessons.mockResolvedValue([{ id: 'lc-1' }, { id: 'lc-2' }]);
      mockProposeMemories.mockResolvedValue([{ id: 'mc-1' }]);
      const history = richSession();

      const result = await runSessionEndFlush({ chatHistory: history, workDir, sessionId: 'sess-1' });

      expect(result.skipped).toBeUndefined();
      expect(result.proposedLessons).toBe(2);
      expect(result.proposedMemories).toBe(1);
      expect(result.openRisks).toHaveLength(1);
      expect(result.handoffPath).toBeDefined();
      expect(readFileSync(result.handoffPath!, 'utf8')).toContain('sess-1');
      expect(mockProposeLessons).toHaveBeenCalledWith(history, workDir, undefined);
      expect(mockProposeMemories).toHaveBeenCalledWith(history, workDir, undefined, 'sess-1');
    });

    it('survives a failing lesson proposer and still writes the handoff', async () => {
      mockProposeLessons.mockRejectedValue(new Error('no provider'));
      const result = await runSessionEndFlush({ chatHistory: richSession(), workDir });
      expect(result.proposedLessons).toBe(0);
      expect(result.proposedMemories).toBe(0);
      expect(result.handoffPath).toBeDefined();
    });
  });
});
