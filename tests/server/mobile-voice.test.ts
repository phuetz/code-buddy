import { afterEach, describe, expect, it } from 'vitest';
import {
  sniffAudioMime,
  transcribeVoiceAttachment,
  synthesizeMobileVoiceReply,
  setMobileVoiceHooksForTests,
  WS_MAX_VOICE_BYTES,
} from '../../src/server/mobile/voice-note.js';

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]);

describe('mobile voice notes (lot 2)', () => {
  afterEach(() => {
    setMobileVoiceHooksForTests();
  });

  it('sniffs WebM, Ogg and WAV from magic bytes', () => {
    expect(sniffAudioMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1]))).toBe('audio/webm');
    expect(sniffAudioMime(OGG)).toBe('audio/ogg');
    const wav = Buffer.alloc(16);
    wav.write('RIFF', 0);
    wav.write('WAVE', 8);
    expect(sniffAudioMime(wav)).toBe('audio/wav');
    expect(sniffAudioMime(Buffer.from('hello'))).toBeNull();
  });

  it('uses the injected transcriber and never calls a real STT', async () => {
    setMobileVoiceHooksForTests({
      transcribe: async ({ mimeType, bytes }) => {
        expect(mimeType).toBe('audio/ogg');
        expect(bytes.subarray(0, 4).toString()).toBe('OggS');
        return '  bonjour  ';
      },
    });
    const text = await transcribeVoiceAttachment({
      mimeType: 'audio/ogg',
      data: OGG.toString('base64'),
    });
    expect(text).toBe('bonjour');
  });

  it('uses the injected synthesizer for Lisa’s spoken reply', async () => {
    setMobileVoiceHooksForTests({
      synthesize: async (text) => ({
        mimeType: 'audio/ogg',
        data: Buffer.from(`ogg:${text}`).toString('base64'),
        durationMs: 800,
      }),
    });
    const audio = await synthesizeMobileVoiceReply('coucou');
    expect(audio?.mimeType).toBe('audio/ogg');
    expect(audio?.durationMs).toBe(800);
    expect(Buffer.from(audio!.data, 'base64').toString()).toBe('ogg:coucou');
  });

  it('keeps the 2 MB ceiling as a number', () => {
    expect(WS_MAX_VOICE_BYTES).toBe(2 * 1024 * 1024);
  });
});
