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

describe('EdgeTTSProvider', () => {
  let provider: EdgeTTSProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new EdgeTTSProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  describe('initialize', () => {
    it('should initialize even without edge-tts installed', async () => {
      // Mock edge-tts not available
      mockSpawn.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      } as any);

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });

      expect(await provider.isAvailable()).toBe(true);
    });

    it('should detect edge-tts when available', async () => {
      // Mock edge-tts available
      mockSpawn.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        }),
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('[]')); // Empty voice list
            }
          }),
        },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      } as any);

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });

      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('listVoices', () => {
    beforeEach(async () => {
      // Mock edge-tts not available to use default voices
      mockSpawn.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      } as any);

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
      mockSpawn.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      } as any);

      await provider.initialize({
        provider: 'edge',
        enabled: true,
        priority: 1,
      });
    });

    it('should throw when edge-tts not installed', async () => {
      // edge-tts is mocked as not available
      await expect(provider.synthesize('Hello')).rejects.toThrow();
    });
  });

  describe('voice extraction', () => {
    beforeEach(async () => {
      mockSpawn.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      } as any);

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
      mockSpawn.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Command not found'));
          }
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      } as any);

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
