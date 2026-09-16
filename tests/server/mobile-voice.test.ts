import { afterEach, describe, expect, it } from 'vitest';
import { validateChatAttachments } from '../../src/server/websocket/handler.js';
import {
  sniffAudioMime,
  transcribeVoiceAttachment,
  synthesizeMobileVoiceReply,
  setMobileVoiceHooksForTests,
  assertVoiceNoteDuration,
  parseAudioDurationMs,
  WS_MAX_VOICE_BYTES,
  WS_MAX_VOICE_MS,
} from '../../src/server/mobile/voice-note.js';

function oggPage(opts: { granule: bigint; eos?: boolean; seq?: number; body?: Buffer }): Buffer {
  const body = opts.body ?? Buffer.alloc(0);
  const header = Buffer.alloc(27);
  header.write('OggS', 0, 4, 'ascii');
  header[4] = 0;
  header[5] = opts.eos ? 0x04 : 0x00;
  header.writeBigInt64LE(opts.granule, 6);
  header.writeUInt32LE(1, 14);
  header.writeUInt32LE(opts.seq ?? 0, 18);
  header.writeUInt32LE(0, 22);
  header[26] = 1;
  return Buffer.concat([header, Buffer.from([body.length]), body]);
}

function oggWithDurationMs(durationMs: number): Buffer {
  const granule = BigInt(Math.round((durationMs / 1000) * 48_000));
  return Buffer.concat([
    oggPage({ granule: 0n, seq: 0, body: Buffer.from('OpusHead') }),
    oggPage({ granule, eos: true, seq: 1, body: Buffer.from('x') }),
  ]);
}

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

  it('refuses a voice note whose container duration exceeds 120 s', async () => {
    expect(WS_MAX_VOICE_MS).toBe(120_000);
    const long = oggWithDurationMs(200_000);
    expect(parseAudioDurationMs(long)).toBeGreaterThan(120_000);
    const validated = validateChatAttachments([{ data: long.toString('base64') }]);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.error).toMatch(/120/i);
    const short = oggWithDurationMs(5_000);
    expect(parseAudioDurationMs(short)).toBeLessThan(10_000);
    const ok = validateChatAttachments([{ data: short.toString('base64') }]);
    expect(ok.ok).toBe(true);
    const declared = await assertVoiceNoteDuration(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]), 121_000, {
      probeDurationMs: async () => null,
    });
    expect(declared.ok).toBe(false);
    const hugeUnknown = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(1_200_000)]);
    const estimated = await assertVoiceNoteDuration(hugeUnknown, 10_000, {
      probeDurationMs: async () => null,
    });
    expect(estimated.ok).toBe(false);
    const probed = await assertVoiceNoteDuration(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]), 5_000, {
      probeDurationMs: async () => 200_000,
    });
    expect(probed.ok).toBe(false);
  });
});
