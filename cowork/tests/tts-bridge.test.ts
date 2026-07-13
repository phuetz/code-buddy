/**
 * TTS bridge — unit tests for the parts that don't need spawning
 * Pocket or Piper. The real engine invocation is integration-tested manually
 * (the binary lives outside the repo at
 * `/home/patrice/DEV/ai-stack/voice/piper`).
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

import { __test, TTSBridge } from '../src/main/voice/tts-bridge';

const {
  buildPiperEnv,
  missingPiperMessage,
  readWavSampleRate,
  resolvePiperBinary,
  resolvePiperVoice,
  sanitizeForSpeech,
} = __test;

function makeWavHeader(sampleRate: number): Buffer {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // channels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(0, 40);
  return buf;
}

function makePcmWav(sampleRate: number, samples: number[]): Buffer {
  const header = makeWavHeader(sampleRate);
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  header.writeUInt32LE(36 + pcm.length, 4);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe('TTSBridge — text sanitisation', () => {
  it('removes triple-backtick code fences (replaced with placeholder)', () => {
    const input = 'Here is code:\n```js\nconst x = 1;\n```\nSee?';
    expect(sanitizeForSpeech(input)).toContain('bloc de code');
    expect(sanitizeForSpeech(input)).not.toContain('const x');
  });

  it('strips inline backticks while keeping the content', () => {
    expect(sanitizeForSpeech('use `npm test` to run')).toBe('use npm test to run');
  });

  it('removes markdown emphasis markers (* _ ~)', () => {
    expect(sanitizeForSpeech('this is *bold* and _italic_ and ~strike~')).toBe(
      'this is bold and italic and strike'
    );
  });

  it('rewrites markdown links to just the text label', () => {
    expect(sanitizeForSpeech('see [the docs](https://example.com)')).toBe('see the docs');
  });

  it('drops markdown image syntax entirely', () => {
    expect(sanitizeForSpeech('![alt text](pic.png) hello')).toBe('hello');
  });

  it('collapses internal whitespace runs into single spaces', () => {
    expect(sanitizeForSpeech('a    b\n\n\nc')).toBe('a b c');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeForSpeech('   \n\t  ')).toBe('');
  });
});

describe('TTSBridge — WAV header parsing', () => {
  it('reads 22050 Hz header correctly (Piper FR voice default)', () => {
    expect(readWavSampleRate(makeWavHeader(22050))).toBe(22050);
  });

  it('reads other valid sample rates', () => {
    expect(readWavSampleRate(makeWavHeader(44100))).toBe(44100);
    expect(readWavSampleRate(makeWavHeader(16000))).toBe(16000);
  });

  it('returns null for buffers shorter than 44 bytes', () => {
    expect(readWavSampleRate(Buffer.alloc(10))).toBeNull();
  });

  it('returns null when RIFF magic is wrong', () => {
    const buf = makeWavHeader(22050);
    buf.write('RIFX', 0, 'ascii');
    expect(readWavSampleRate(buf)).toBeNull();
  });

  it('returns null when WAVE marker is wrong', () => {
    const buf = makeWavHeader(22050);
    buf.write('AVI ', 8, 'ascii');
    expect(readWavSampleRate(buf)).toBeNull();
  });
});

describe('TTSBridge — portable runtime resolution', () => {
  it('honors explicit binary and voice overrides', () => {
    process.env.COWORK_PIPER_BIN = 'C:\\voice\\piper.exe';
    process.env.COWORK_PIPER_VOICE = 'C:\\voice\\voices\\fr.onnx';
    expect(resolvePiperBinary()).toBe('C:\\voice\\piper.exe');
    expect(resolvePiperVoice()).toBe('C:\\voice\\voices\\fr.onnx');
    delete process.env.COWORK_PIPER_BIN;
    delete process.env.COWORK_PIPER_VOICE;
  });

  it('reports the env var that fixes a missing Piper runtime', () => {
    expect(missingPiperMessage('binary', 'C:\\missing\\piper.exe')).toContain('COWORK_PIPER_BIN');
    expect(missingPiperMessage('voice', 'C:\\missing\\voice.onnx')).toContain('COWORK_PIPER_VOICE');
  });

  it('builds a filtered Piper env without provider secrets', () => {
    const previous = {
      openai: process.env.OPENAI_API_KEY,
      root: process.env.COWORK_VOICE_ROOT,
    };
    process.env.OPENAI_API_KEY = 'sk-test-secret-that-must-not-leak';
    process.env.COWORK_VOICE_ROOT = '/home/patrice/voice';
    try {
      const env = buildPiperEnv();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.COWORK_VOICE_ROOT).toBe('/home/patrice/voice');
    } finally {
      if (previous.openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous.openai;
      if (previous.root === undefined) delete process.env.COWORK_VOICE_ROOT;
      else process.env.COWORK_VOICE_ROOT = previous.root;
    }
  });
});

describe('TTSBridge — boot error handling', () => {
  it('reports bootError when binary path is missing', () => {
    const bridge = new TTSBridge({
      engine: 'piper',
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
    });
    expect(bridge.isReady()).toBe(false);
    expect(bridge.getBootError()).toContain('not found');
  });

  it('synthesize() rejects when bootError is set', async () => {
    const bridge = new TTSBridge({
      engine: 'piper',
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
    });
    await expect(bridge.synthesize('hello')).rejects.toThrow(/not found/);
  });

  it('synthesize() rejects on empty text without spawning piper', async () => {
    const bridge = new TTSBridge({
      engine: 'piper',
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
    });
    await expect(bridge.synthesize('')).rejects.toThrow(/empty/);
    await expect(bridge.synthesize('   ')).rejects.toThrow(/empty/);
  });

  it('synthesize() rejects when sanitization removes all speakable text', async () => {
    const bridge = new TTSBridge({
      engine: 'piper',
      binary: process.execPath,
      voice: process.execPath,
    });
    await expect(bridge.synthesize('![screenshot](image.png)')).rejects.toThrow(
      /empty after sanitization/
    );
  });
});

describe('TTSBridge — Pocket primary path', () => {
  it('uses Pocket by default without requiring the legacy Piper runtime', () => {
    const bridge = new TTSBridge({
      env: {},
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
    });

    expect(bridge.isReady()).toBe(true);
    expect(bridge.getProvider()).toBe('pocket');
    expect(bridge.getFallbackProvider()).toBe('piper');
  });

  it('returns Pocket audio and reports the actual provider', async () => {
    const pocketSynthesizer = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, makeWavHeader(24000));
      return true;
    });
    const bridge = new TTSBridge({
      env: {},
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
      pocketSynthesizer,
    });

    const result = await bridge.synthesize('Bonjour depuis Pocket');

    expect(pocketSynthesizer).toHaveBeenCalledOnce();
    expect(result.provider).toBe('pocket');
    expect(result.sampleRate).toBe(24000);
    expect(result.audio.byteLength).toBe(44);
  });

  it('reports the missing Piper runtime only if Pocket synthesis fails', async () => {
    const bridge = new TTSBridge({
      env: {},
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
      pocketSynthesizer: async () => false,
    });

    await expect(bridge.synthesize('Bonjour')).rejects.toThrow(/piper binary.*not found/i);
  });

  it('honors the persisted assistant volume without requiring a Cowork restart', async () => {
    const pocketSynthesizer = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, makePcmWav(24000, [10_000, -10_000]));
      return true;
    });
    const bridge = new TTSBridge({
      env: {},
      assistantConfigReader: () => ({ CODEBUDDY_TTS_VOLUME: '50' }),
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
      pocketSynthesizer,
    });

    const result = await bridge.synthesize('Volume explicite');
    const output = Buffer.from(result.audio);
    const peak = Math.max(Math.abs(output.readInt16LE(44)), Math.abs(output.readInt16LE(46)));

    expect(pocketSynthesizer).toHaveBeenCalledWith(
      'Volume explicite',
      expect.any(String),
      expect.objectContaining({ CODEBUDDY_TTS_VOLUME: '50' }),
      30000
    );
    expect(peak).toBeGreaterThan(13_500);
    expect(peak).toBeLessThan(15_000);
  });
});

describe('TTSBridge — Voicebox expressive path', () => {
  it('returns Voicebox audio and reports the renderer used', async () => {
    const voiceboxSynthesizer = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, makeWavHeader(24000));
      return true;
    });
    const pocketSynthesizer = vi.fn(async () => false);
    const bridge = new TTSBridge({
      engine: 'voicebox',
      env: { CODEBUDDY_VOICEBOX_PROFILE: 'Lisa' },
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
      voiceboxSynthesizer,
      pocketSynthesizer,
    });

    const result = await bridge.synthesize('Bonjour depuis Voicebox');

    expect(voiceboxSynthesizer).toHaveBeenCalledOnce();
    expect(pocketSynthesizer).not.toHaveBeenCalled();
    expect(result.provider).toBe('voicebox');
    expect(result.sampleRate).toBe(24000);
    expect(bridge.getFallbackProvider()).toBe('pocket');
  });

  it('falls back to Pocket without misreporting the resulting voice', async () => {
    const voiceboxSynthesizer = vi.fn(async () => false);
    const pocketSynthesizer = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, makeWavHeader(24000));
      return true;
    });
    const bridge = new TTSBridge({
      engine: 'voicebox',
      env: { CODEBUDDY_VOICEBOX_PROFILE: 'Lisa' },
      binary: '/nonexistent/piper',
      voice: '/nonexistent/voice.onnx',
      voiceboxSynthesizer,
      pocketSynthesizer,
    });

    const result = await bridge.synthesize('Darkstar est temporairement indisponible');

    expect(result.provider).toBe('pocket');
    expect(voiceboxSynthesizer).toHaveBeenCalledOnce();
    expect(pocketSynthesizer).toHaveBeenCalledOnce();
  });
});
