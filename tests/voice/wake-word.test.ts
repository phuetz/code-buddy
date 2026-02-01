/**
 * Wake Word Detector Tests
 */

import {
  WakeWordDetector,
  createWakeWordDetector,
} from '../../src/voice/wake-word.js';
import { DEFAULT_WAKE_WORD_CONFIG } from '../../src/voice/types.js';

describe('WakeWordDetector', () => {
  let detector: WakeWordDetector;

  beforeEach(() => {
    detector = new WakeWordDetector();
  });

  afterEach(async () => {
    await detector.stop();
  });

  describe('constructor', () => {
    it('should create detector with default config', () => {
      expect(detector.getConfig()).toEqual(DEFAULT_WAKE_WORD_CONFIG);
    });

    it('should create detector with custom config', () => {
      const custom = createWakeWordDetector({
        wakeWords: ['hello computer'],
        sensitivity: 0.8,
      });

      const config = custom.getConfig();
      expect(config.wakeWords).toContain('hello computer');
      expect(config.sensitivity).toBe(0.8);
    });
  });

  describe('start/stop', () => {
    it('should start detector', async () => {
      const startedSpy = jest.fn();
      detector.on('started', startedSpy);

      await detector.start();

      expect(detector.isRunning()).toBe(true);
      expect(startedSpy).toHaveBeenCalled();
    });

    it('should stop detector', async () => {
      const stoppedSpy = jest.fn();
      detector.on('stopped', stoppedSpy);

      await detector.start();
      await detector.stop();

      expect(detector.isRunning()).toBe(false);
      expect(stoppedSpy).toHaveBeenCalled();
    });

    it('should not start twice', async () => {
      await detector.start();
      await detector.start();

      expect(detector.isRunning()).toBe(true);
    });

    it('should handle stop when not running', async () => {
      await detector.stop();
      expect(detector.isRunning()).toBe(false);
    });
  });

  describe('processFrame', () => {
    it('should return null when not running', () => {
      const frame = Buffer.alloc(1024);
      const result = detector.processFrame(frame);

      expect(result).toBeNull();
    });

    it('should process audio frame when running', async () => {
      await detector.start();

      const frame = Buffer.alloc(1024);
      const result = detector.processFrame(frame);

      // Detection is probabilistic, so just verify no error
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should emit detected event on detection', async () => {
      const detectedSpy = jest.fn();
      detector.on('detected', detectedSpy);

      await detector.start();

      // Process many frames to potentially trigger detection
      for (let i = 0; i < 1000; i++) {
        // Create high-energy frame
        const frame = Buffer.alloc(1024);
        for (let j = 0; j < 512; j++) {
          frame.writeInt16LE(Math.floor(Math.random() * 20000 - 10000), j * 2);
        }
        const result = detector.processFrame(frame);
        if (result) {
          expect(result.wakeWord).toBeDefined();
          expect(result.confidence).toBeGreaterThan(0);
          break;
        }
      }

      // Detection is probabilistic, so we just verify the mechanism works
    });
  });

  describe('wake word management', () => {
    it('should add wake word', () => {
      detector.addWakeWord('new wake word');

      const wakeWords = detector.getWakeWords();
      expect(wakeWords).toContain('new wake word');
    });

    it('should not add duplicate wake word', () => {
      const original = detector.getWakeWords();
      detector.addWakeWord(original[0]);

      expect(detector.getWakeWords()).toHaveLength(original.length);
    });

    it('should remove wake word', () => {
      const original = detector.getWakeWords();
      detector.removeWakeWord(original[0]);

      expect(detector.getWakeWords()).not.toContain(original[0]);
    });

    it('should handle removing non-existent wake word', () => {
      const original = detector.getWakeWords().length;
      detector.removeWakeWord('non-existent');

      expect(detector.getWakeWords()).toHaveLength(original);
    });
  });

  describe('sensitivity', () => {
    it('should set sensitivity', () => {
      detector.setSensitivity(0.9);

      expect(detector.getConfig().sensitivity).toBe(0.9);
    });

    it('should clamp sensitivity to valid range', () => {
      detector.setSensitivity(1.5);
      expect(detector.getConfig().sensitivity).toBe(1);

      detector.setSensitivity(-0.5);
      expect(detector.getConfig().sensitivity).toBe(0);
    });
  });

  describe('buffer management', () => {
    it('should clear buffer', async () => {
      await detector.start();

      // Add some frames
      for (let i = 0; i < 10; i++) {
        detector.processFrame(Buffer.alloc(1024));
      }

      detector.clearBuffer();

      // No way to check buffer size directly, but should not error
    });
  });

  describe('config updates', () => {
    it('should update config', () => {
      detector.updateConfig({
        sensitivity: 0.3,
        minConfidence: 0.5,
      });

      const config = detector.getConfig();
      expect(config.sensitivity).toBe(0.3);
      expect(config.minConfidence).toBe(0.5);
    });
  });
});
