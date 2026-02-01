/**
 * Speech Recognition Tests
 */

import {
  SpeechRecognizer,
  createSpeechRecognizer,
} from '../../src/voice/speech-recognition.js';
import { DEFAULT_SPEECH_RECOGNITION_CONFIG } from '../../src/voice/types.js';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('SpeechRecognizer', () => {
  let recognizer: SpeechRecognizer;

  beforeEach(() => {
    jest.clearAllMocks();
    recognizer = new SpeechRecognizer();
  });

  afterEach(async () => {
    await recognizer.stopListening();
  });

  describe('constructor', () => {
    it('should create recognizer with default config', () => {
      expect(recognizer.getConfig()).toEqual(DEFAULT_SPEECH_RECOGNITION_CONFIG);
    });

    it('should create recognizer with custom config', () => {
      const custom = createSpeechRecognizer({
        provider: 'google',
        language: 'fr-FR',
        continuous: true,
      });

      const config = custom.getConfig();
      expect(config.provider).toBe('google');
      expect(config.language).toBe('fr-FR');
      expect(config.continuous).toBe(true);
    });
  });

  describe('listening', () => {
    it('should start listening', async () => {
      const startedSpy = jest.fn();
      recognizer.on('listening-started', startedSpy);

      await recognizer.startListening();

      expect(recognizer.isListening()).toBe(true);
      expect(startedSpy).toHaveBeenCalled();
    });

    it('should stop listening', async () => {
      const stoppedSpy = jest.fn();
      recognizer.on('listening-stopped', stoppedSpy);

      await recognizer.startListening();
      await recognizer.stopListening();

      expect(recognizer.isListening()).toBe(false);
      expect(stoppedSpy).toHaveBeenCalled();
    });

    it('should not start twice', async () => {
      await recognizer.startListening();
      await recognizer.startListening();

      expect(recognizer.isListening()).toBe(true);
    });
  });

  describe('processAudio', () => {
    it('should not process when not listening', async () => {
      // Should not throw
      await recognizer.processAudio(Buffer.alloc(1024));
    });

    it('should process audio when listening', async () => {
      // Add error listener and set API key to prevent errors during transcription
      recognizer.on('error', () => {});
      recognizer.setApiKey('test-key');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });

      await recognizer.startListening();
      await recognizer.processAudio(Buffer.alloc(1024));
      await recognizer.stopListening();

      // No error means success
    });
  });

  describe('transcribe', () => {
    describe('whisper provider', () => {
      beforeEach(() => {
        recognizer.updateConfig({ provider: 'whisper' });
        recognizer.setApiKey('sk-test-key');
      });

      it('should transcribe with whisper', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ text: 'Hello world' }),
        });

        const result = await recognizer.transcribe(Buffer.alloc(1024));

        expect(result.text).toBe('Hello world');
        expect(result.isFinal).toBe(true);
      });

      it('should handle API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

        await expect(recognizer.transcribe(Buffer.alloc(1024))).rejects.toThrow(
          'Whisper API error'
        );
      });

      it('should throw without API key', async () => {
        recognizer.setApiKey('');
        recognizer.updateConfig({ apiKey: undefined });

        await expect(recognizer.transcribe(Buffer.alloc(1024))).rejects.toThrow(
          'OpenAI API key required'
        );
      });
    });

    describe('google provider', () => {
      beforeEach(() => {
        recognizer.updateConfig({ provider: 'google' });
        recognizer.setApiKey('test-google-key');
      });

      it('should transcribe with google', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  alternatives: [
                    {
                      transcript: 'Hello world',
                      confidence: 0.95,
                    },
                  ],
                },
              ],
            }),
        });

        const result = await recognizer.transcribe(Buffer.alloc(1024));

        expect(result.text).toBe('Hello world');
        expect(result.confidence).toBe(0.95);
      });

      it('should return empty result when no speech detected', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        });

        const result = await recognizer.transcribe(Buffer.alloc(1024));

        expect(result.text).toBe('');
        expect(result.confidence).toBe(0);
      });

      it('should include word timings', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  alternatives: [
                    {
                      transcript: 'Hello world',
                      confidence: 0.95,
                      words: [
                        { word: 'Hello', startTime: '0s', endTime: '0.5s' },
                        { word: 'world', startTime: '0.5s', endTime: '1s' },
                      ],
                    },
                  ],
                },
              ],
            }),
        });

        const result = await recognizer.transcribe(Buffer.alloc(1024));

        expect(result.words).toHaveLength(2);
        expect(result.words?.[0].word).toBe('Hello');
        expect(result.words?.[0].startTime).toBe(0);
        expect(result.words?.[0].endTime).toBe(0.5);
      });
    });

    describe('deepgram provider', () => {
      beforeEach(() => {
        recognizer.updateConfig({ provider: 'deepgram' });
        recognizer.setApiKey('test-deepgram-key');
      });

      it('should transcribe with deepgram', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              results: {
                channels: [
                  {
                    alternatives: [
                      {
                        transcript: 'Hello deepgram',
                        confidence: 0.98,
                      },
                    ],
                  },
                ],
              },
            }),
        });

        const result = await recognizer.transcribe(Buffer.alloc(1024));

        expect(result.text).toBe('Hello deepgram');
        expect(result.confidence).toBe(0.98);
      });
    });

    describe('local provider', () => {
      beforeEach(() => {
        recognizer.updateConfig({ provider: 'local' });
      });

      it('should return empty result for local provider', async () => {
        const result = await recognizer.transcribe(Buffer.alloc(1024));

        expect(result.text).toBe('');
        expect(result.isFinal).toBe(true);
      });
    });
  });

  describe('vocabulary', () => {
    it('should add vocabulary words', () => {
      recognizer.addVocabulary(['hello', 'world']);

      const config = recognizer.getConfig();
      expect(config.vocabulary).toContain('hello');
      expect(config.vocabulary).toContain('world');
    });

    it('should clear vocabulary', () => {
      recognizer.addVocabulary(['hello', 'world']);
      recognizer.clearVocabulary();

      const config = recognizer.getConfig();
      expect(config.vocabulary).toHaveLength(0);
    });
  });

  describe('config updates', () => {
    it('should update config', () => {
      recognizer.updateConfig({
        continuous: true,
        maxAlternatives: 3,
      });

      const config = recognizer.getConfig();
      expect(config.continuous).toBe(true);
      expect(config.maxAlternatives).toBe(3);
    });

    it('should set language', () => {
      recognizer.setLanguage('de-DE');

      expect(recognizer.getConfig().language).toBe('de-DE');
    });
  });
});
