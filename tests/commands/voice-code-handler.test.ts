import { describe, expect, it } from 'vitest';
import { handleVoiceCode } from '../../src/commands/handlers/voice-code-handler.js';

describe('handleVoiceCode', () => {
  it('returns a clear failure instead of a fake started state without audio source', async () => {
    const result = await handleVoiceCode(['on']);

    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Failed to start voice-to-code');
    expect(result.entry?.content).toContain('live microphone capture is not wired');

    const status = await handleVoiceCode(['status']);
    expect(status.entry?.content).toContain('inactive');
  });
});
