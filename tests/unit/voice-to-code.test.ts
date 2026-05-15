/**
 * Unit tests for Voice-to-Code Pipeline
 */

import { describe, it, expect, vi } from 'vitest';
import { detectIntent, VoiceToCodePipeline } from '../../src/voice/voice-to-code';

describe('Voice-to-Code Pipeline', () => {
  describe('detectIntent', () => {
    it('should detect command intents', () => {
      expect(detectIntent('run tests')).toBe('command');
      expect(detectIntent('fix the error')).toBe('command');
      expect(detectIntent('search for function')).toBe('command');
      expect(detectIntent('commit changes')).toBe('command');
      expect(detectIntent('open file readme')).toBe('command');
      expect(detectIntent('undo')).toBe('command');
      expect(detectIntent('help')).toBe('command');
    });

    it('should detect dictation for non-command text', () => {
      expect(detectIntent('const x equals 5')).toBe('dictation');
      expect(detectIntent('hello world')).toBe('dictation');
      expect(detectIntent('a function that adds two numbers')).toBe('dictation');
    });
  });

  describe('VoiceToCodePipeline', () => {
    it('should initialize with default config', () => {
      const pipeline = new VoiceToCodePipeline();
      expect(pipeline.isActive()).toBe(false);

      const config = pipeline.getConfig();
      expect(config.sttProvider).toBe('whisper');
      expect(config.language).toBe('en-US');
      expect(config.autoExecute).toBe(false);
    });

    it('should accept custom config', () => {
      const pipeline = new VoiceToCodePipeline({
        sttProvider: 'picovoice',
        language: 'fr-FR',
        autoExecute: true,
      });

      const config = pipeline.getConfig();
      expect(config.sttProvider).toBe('picovoice');
      expect(config.language).toBe('fr-FR');
      expect(config.autoExecute).toBe(true);
    });

    it('should report inactive when not started', () => {
      const pipeline = new VoiceToCodePipeline();
      expect(pipeline.isActive()).toBe(false);
    });

    it('should stop gracefully when not active', async () => {
      const pipeline = new VoiceToCodePipeline();
      // Should not throw
      await pipeline.stop();
      expect(pipeline.isActive()).toBe(false);
    });

    it('should not report active without a live audio source', async () => {
      const pipeline = new VoiceToCodePipeline();

      await expect(pipeline.start()).rejects.toThrow('live microphone capture is not wired');

      expect(pipeline.isActive()).toBe(false);
    });

    it('should start and stop when a live audio source is provided', async () => {
      const audioSource = {
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      };
      const pipeline = new VoiceToCodePipeline({ audioSource });

      await pipeline.start();

      expect(pipeline.isActive()).toBe(true);
      expect(audioSource.start).toHaveBeenCalledOnce();

      await pipeline.stop();

      expect(audioSource.stop).toHaveBeenCalledOnce();
      expect(pipeline.isActive()).toBe(false);
    });
  });
});
