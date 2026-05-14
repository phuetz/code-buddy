import { VoiceInputManager } from '../../src/input/voice-input-enhanced.js';

describe('VoiceInputManager', () => {
  it('should fail system transcription without returning placeholder text', async () => {
    const manager = new VoiceInputManager({ provider: 'system' });
    const result = await (
      manager as unknown as {
        transcribeWithSystem(audioFile: string): Promise<{ success: boolean; text?: string; error?: string }>;
      }
    ).transcribeWithSystem('voice.wav');

    expect(result.success).toBe(false);
    expect(result.text).toBeUndefined();
    expect(result.error).toContain('not implemented');
  });
});
