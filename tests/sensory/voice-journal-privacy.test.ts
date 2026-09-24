import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/memory/persistent-memory.js', () => ({
  getMemoryManager: () => {
    throw new Error('user memory store is unreadable or unavailable');
  },
}));

import { resetForgettingWarningsForTests, runForgettingPass } from '../../src/sensory/dreaming.js';
import { describeHeardForLog } from '../../src/sensory/speech-reaction.js';
import { logger } from '../../src/utils/logger.js';

// Audit 2026-09-24. D1: the open microphone wrote every conversation in the
// room to journald verbatim (3 161 phrases in 36 h). D4: an unchanged
// forgetting-pass failure was warned twice a minute (4 937 times in 36 h).
describe('voice journal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_SPEECH_LOG_TRANSCRIPTS;
    resetForgettingWarningsForTests();
  });

  it('keeps only the length of a heard utterance by default', () => {
    const line = describeHeardForLog('on parle de la visite chez le médecin demain');
    expect(line).toBe('9 mots, texte masqué');
    expect(line).not.toContain('médecin');
  });

  it('logs the transcript again when explicitly asked', () => {
    process.env.CODEBUDDY_SPEECH_LOG_TRANSCRIPTS = 'true';
    expect(describeHeardForLog('bonjour Lisa')).toBe('bonjour Lisa');
  });

  it('warns about an unchanged forgetting failure once, not on every pass', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    for (let pass = 0; pass < 5; pass++) await runForgettingPass();
    const forgettingWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('forgetting pass failed'),
    );
    expect(forgettingWarnings).toHaveLength(1);
  });
});
