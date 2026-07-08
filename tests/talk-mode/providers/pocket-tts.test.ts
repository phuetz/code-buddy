/**
 * Pocket TTS Provider Tests
 *
 * Pure helpers (language mapping, argv, WAV duration, clone detection) need no
 * mocks. Launcher detection + fail-open are covered by mocking child_process,
 * mirroring the edge-tts provider tests.
 */

import {
  PocketTTSProvider,
  resolvePocketLanguage,
  isVoiceSamplePath,
  buildGenerateArgs,
  wavDurationMs,
  pocketLauncherCandidates,
} from '../../../src/talk-mode/providers/pocket-tts.js';
import { spawn } from 'child_process';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createSpawnResult(options: {
  closeCode?: number;
  error?: Error;
}): ReturnType<typeof spawn> {
  return {
    on: jest.fn((event: string, cb: (arg?: unknown) => void) => {
      if (event === 'error' && options.error) cb(options.error);
      if (event === 'close' && options.closeCode !== undefined) cb(options.closeCode);
    }),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
  } as unknown as ReturnType<typeof spawn>;
}

describe('resolvePocketLanguage', () => {
  it('defaults to english when empty', () => {
    expect(resolvePocketLanguage()).toBe('english');
    expect(resolvePocketLanguage('')).toBe('english');
  });

  it('maps BCP-47 and ISO codes to Pocket language tokens', () => {
    expect(resolvePocketLanguage('en-US')).toBe('english');
    expect(resolvePocketLanguage('de')).toBe('german');
    expect(resolvePocketLanguage('es-ES')).toBe('spanish');
    expect(resolvePocketLanguage('pt-BR')).toBe('portuguese');
    expect(resolvePocketLanguage('it')).toBe('italian');
  });

  it('ALWAYS forces French to the 24-layer variant (plain french is rejected by the CLI)', () => {
    expect(resolvePocketLanguage('fr')).toBe('french_24l');
    expect(resolvePocketLanguage('fr-FR')).toBe('french_24l');
    expect(resolvePocketLanguage('french')).toBe('french_24l');
    expect(resolvePocketLanguage('french_24l')).toBe('french_24l');
  });

  it('never adds _24l to english', () => {
    expect(resolvePocketLanguage('english', true)).toBe('english');
    expect(resolvePocketLanguage('en', true)).toBe('english');
  });

  it('upgrades other languages to _24l when highQuality is set or requested', () => {
    expect(resolvePocketLanguage('german', true)).toBe('german_24l');
    expect(resolvePocketLanguage('italian_24l')).toBe('italian_24l');
    expect(resolvePocketLanguage('spanish', false)).toBe('spanish');
  });

  it('falls back to english for unknown languages', () => {
    expect(resolvePocketLanguage('klingon')).toBe('english');
  });
});

describe('isVoiceSamplePath', () => {
  it('detects audio sample paths (cloning)', () => {
    expect(isVoiceSamplePath('/home/me/lisa.wav')).toBe(true);
    expect(isVoiceSamplePath('sample.mp3')).toBe(true);
    expect(isVoiceSamplePath('voices/ref.flac')).toBe(true);
    expect(isVoiceSamplePath('C:\\voices\\ref.wav')).toBe(true);
  });

  it('treats bare names as presets, not paths', () => {
    expect(isVoiceSamplePath('alba')).toBe(false);
    expect(isVoiceSamplePath('giovanni')).toBe(false);
    expect(isVoiceSamplePath(undefined)).toBe(false);
  });
});

describe('buildGenerateArgs', () => {
  it('builds the minimal generate argv', () => {
    expect(buildGenerateArgs({ text: 'Bonjour', language: 'french_24l' })).toEqual([
      'generate',
      '--language',
      'french_24l',
      '--text',
      'Bonjour',
    ]);
  });

  it('adds voice and config when provided', () => {
    expect(
      buildGenerateArgs({
        text: 'Hi',
        language: 'english',
        voice: 'alba',
        configPath: '/tmp/custom.yaml',
      })
    ).toEqual([
      'generate',
      '--language',
      'english',
      '--text',
      'Hi',
      '--voice',
      'alba',
      '--config',
      '/tmp/custom.yaml',
    ]);
  });
});

describe('pocketLauncherCandidates', () => {
  const home = '/home/u';
  it('prefers PATH-relative pocket-tts then uvx by default', () => {
    const cs = pocketLauncherCandidates(undefined, {}, home, () => false);
    expect(cs.map((c) => c.command)).toEqual(['pocket-tts', 'uvx']);
    expect(cs.find((c) => c.command === 'uvx')?.argsPrefix).toEqual(['pocket-tts']);
  });

  it('honors CODEBUDDY_POCKET_BIN first', () => {
    const cs = pocketLauncherCandidates(
      undefined,
      { CODEBUDDY_POCKET_BIN: '/opt/uvx' },
      home,
      () => false
    );
    expect(cs[0]).toEqual({ command: '/opt/uvx', argsPrefix: ['pocket-tts'] });
  });

  it('adds absolute ~/.local/bin/uvx fallback when PATH is minimal (the daemon case)', () => {
    const exists = (p: string) => p === '/home/u/.local/bin/uvx';
    const cs = pocketLauncherCandidates(undefined, {}, home, exists);
    const uvxAbs = cs.find((c) => c.command === '/home/u/.local/bin/uvx');
    expect(uvxAbs).toBeDefined();
    expect(uvxAbs?.argsPrefix).toEqual(['pocket-tts']);
  });

  it('config binaryPath wins over everything', () => {
    const cs = pocketLauncherCandidates('/custom/pocket-tts', {}, home, () => false);
    expect(cs[0]).toEqual({ command: '/custom/pocket-tts', argsPrefix: [] });
  });
});

describe('wavDurationMs', () => {
  it('returns 0 for headers-only / empty buffers', () => {
    expect(wavDurationMs(Buffer.alloc(0))).toBe(0);
    expect(wavDurationMs(Buffer.alloc(44))).toBe(0);
  });

  it('computes ms from PCM data length at 24 kHz mono 16-bit', () => {
    // 1 second = 24000 samples * 2 bytes + 44-byte header.
    const oneSecond = Buffer.alloc(44 + 24000 * 2);
    expect(wavDurationMs(oneSecond)).toBe(1000);
  });
});

describe('PocketTTSProvider (fail-open)', () => {
  let provider: PocketTTSProvider;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    provider = new PocketTTSProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
    warnSpy.mockRestore();
  });

  it('initializes and reports unavailable when no launcher exists', async () => {
    mockSpawn.mockReturnValue(createSpawnResult({ error: new Error('not found') }));
    await provider.initialize({ provider: 'pocket', enabled: true, priority: 1 });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('detects a launcher when pocket-tts --help succeeds', async () => {
    mockSpawn.mockReturnValue(createSpawnResult({ closeCode: 0 }));
    await provider.initialize({ provider: 'pocket', enabled: true, priority: 1 });
    expect(await provider.isAvailable()).toBe(true);
    expect(mockSpawn.mock.calls[0][0]).toBe('pocket-tts');
  });

  it('throws a clear install hint when synthesizing without a launcher', async () => {
    mockSpawn.mockReturnValue(createSpawnResult({ error: new Error('not found') }));
    await provider.initialize({ provider: 'pocket', enabled: true, priority: 1 });
    await expect(provider.synthesize('Bonjour')).rejects.toThrow(/pocket-tts launcher not found/);
  });

  it('exposes preset voices with pocket provider tag', async () => {
    mockSpawn.mockReturnValue(createSpawnResult({ error: new Error('not found') }));
    await provider.initialize({ provider: 'pocket', enabled: true, priority: 1 });
    const voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.every((v) => v.provider === 'pocket')).toBe(true);
    expect(voices.some((v) => v.providerId === 'alba')).toBe(true);
  });
});
