/**
 * Edge TTS Provider Tests
 */

import { EdgeTTSProvider } from '../../../src/talk-mode/providers/edge-tts.js';
import { spawn } from 'child_process';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createSpawnResult(options: {
  closeCode?: number;
  error?: Error;
  stdoutData?: string;
}): ReturnType<typeof spawn> {
  return {
    on: jest.fn((event, callback) => {
      if (event === 'error' && options.error) {
        callback(options.error);
      }
      if (event === 'close' && options.closeCode !== undefined) {
        callback(options.closeCode);
      }
    }),
    stdout: {
      on: jest.fn((event, callback) => {
        if (event === 'data' && options.stdoutData !== undefined) {
          callback(Buffer.from(options.stdoutData));
        }
      }),
    },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
  } as unknown as ReturnType<typeof spawn>;
}

describe('EdgeTTSProvider', () => {
  let provider: EdgeTTSProvider;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    provider = new EdgeTTSProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
    warnSpy.mockRestore();
  });

  describe('initialize', () => {
    it('should initialize even without edge-tts installed', async () => {
      mockSpawn.mockReturnValue(createSpawnResult({
        error: new Error('Command not found'),
      }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });

      expect(await provider.isAvailable()).toBe(false);
    });

    it('should detect edge-tts when available', async () => {
      mockSpawn.mockReturnValue(createSpawnResult({
        closeCode: 0,
        stdoutData: '[]',
      }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });

      expect(await provider.isAvailable()).toBe(true);
    });

    it('should detect python module fallback when CLI wrapper is missing', async () => {
      mockSpawn
        .mockReturnValueOnce(createSpawnResult({ error: new Error('Command not found') }))
        .mockReturnValueOnce(createSpawnResult({ closeCode: 0 }))
        .mockReturnValueOnce(createSpawnResult({ closeCode: 0, stdoutData: '[]' }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });

      expect(await provider.isAvailable()).toBe(true);
      expect(mockSpawn.mock.calls[0][0]).toBe('edge-tts');
      expect(mockSpawn.mock.calls[1][0]).toBe('python');
      expect(mockSpawn.mock.calls[1][1]).toEqual(['-m', 'edge_tts', '--version']);
      expect(mockSpawn.mock.calls[2][1]).toEqual(['-m', 'edge_tts', '--list-voices', '--json']);
    });
  });

  describe('listVoices', () => {
    beforeEach(async () => {
      mockSpawn.mockReturnValue(createSpawnResult({
        error: new Error('Command not found'),
      }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });
    });

    it('should return default voices', async () => {
      const voices = await provider.listVoices();

      expect(voices.length).toBeGreaterThan(0);
      expect(voices.some((v) => v.providerId === 'en-US-JennyNeural')).toBe(true);
    });

    it('should include voices for multiple languages', async () => {
      const voices = await provider.listVoices();
      const languages = new Set(voices.map((v) => v.language));

      expect(languages.has('en-US')).toBe(true);
      expect(languages.has('en-GB')).toBe(true);
      expect(languages.has('fr-FR')).toBe(true);
      expect(languages.has('de-DE')).toBe(true);
    });

    it('should have default voice marked', async () => {
      const voices = await provider.listVoices();
      const defaultVoice = voices.find((v) => v.isDefault);

      expect(defaultVoice).toBeDefined();
      expect(defaultVoice?.providerId).toBe('en-US-JennyNeural');
    });

    it('should include voice metadata', async () => {
      const voices = await provider.listVoices();
      const voice = voices.find((v) => v.providerId === 'en-US-GuyNeural');

      expect(voice).toBeDefined();
      expect(voice?.gender).toBe('male');
      expect(voice?.provider).toBe('edge');
      expect(voice?.quality).toBe('high');
    });
  });

  describe('synthesize', () => {
    beforeEach(async () => {
      mockSpawn.mockReturnValue(createSpawnResult({
        error: new Error('Command not found'),
      }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });
    });

    it('should throw when edge-tts not installed', async () => {
      await expect(provider.synthesize('Hello')).rejects.toThrow('edge-tts executable not found');
    });
  });

  describe('voice extraction', () => {
    beforeEach(async () => {
      mockSpawn.mockReturnValue(createSpawnResult({
        error: new Error('Command not found'),
      }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });
    });

    it('should extract voice from prefixed ID', () => {
      const result = provider['extractVoice']('edge-en-US-JennyNeural');
      expect(result).toBe('en-US-JennyNeural');
    });

    it('should return undefined for invalid voice', () => {
      const result = provider['extractVoice']('invalid-voice');
      expect(result).toBeUndefined();
    });

    it('should find voice by name', () => {
      const result = provider['extractVoice']('Jenny');
      expect(result).toBe('en-US-JennyNeural');
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      mockSpawn.mockReturnValue(createSpawnResult({
        error: new Error('Command not found'),
      }));

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });

      await provider.shutdown();

      expect(await provider.isAvailable()).toBe(false);
    });
  });
});
