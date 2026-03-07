/**
 * Wake Word Detector Tests
 */

// Mock @picovoice/porcupine-node before imports

import { DEFAULT_WAKE_WORD_CONFIG } from '../../src/voice/types.js';
import { Porcupine } from '@picovoice/porcupine-node';

const mockProcess = jest.fn().mockReturnValue(-1);
const mockRelease = jest.fn();

jest.mock('@picovoice/porcupine-node', () => ({
  Porcupine: jest.fn().mockImplementation(function() { return {
    process: mockProcess,
    release: mockRelease,
    frameLength: 512,
    sampleRate: 16000,
  }; }),
  BuiltinKeyword: {
    COMPUTER: 'computer',
    PICOVOICE: 'picovoice',
    ALEXA: 'alexa',
    JARVIS: 'jarvis',
  },
  getBuiltinKeywordPath: jest.fn().mockImplementation((keyword: string) => `/mock/path/${keyword}.ppn`),
}));

import {
  WakeWordDetector,
  createWakeWordDetector,
} from '../../src/voice/wake-word.js';

describe('WakeWordDetector', () => {
  let detector: WakeWordDetector;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PICOVOICE_ACCESS_KEY;
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

  describe('Porcupine engine', () => {
    it('should init Porcupine when access key is provided', async () => {
      const det = new WakeWordDetector({ accessKey: 'test-key' });
      await det.start();

      expect(det.getEngine()).toBe('porcupine');
      expect(det.frameLength).toBe(512);
      expect(det.sampleRate).toBe(16000);

      await det.stop();
    });

    it('should init Porcupine from env variable', async () => {
      process.env.PICOVOICE_ACCESS_KEY = 'env-key';
      const det = new WakeWordDetector();
      await det.start();

      expect(det.getEngine()).toBe('porcupine');

      await det.stop();
    });

    it('should call release() on stop', async () => {
      const det = new WakeWordDetector({ accessKey: 'test-key' });
      await det.start();
      await det.stop();

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should detect keyword when Porcupine returns >= 0', async () => {
      const det = new WakeWordDetector({ accessKey: 'test-key' });
      await det.start();

      const detectedSpy = jest.fn();
      det.on('detected', detectedSpy);

      mockProcess.mockReturnValueOnce(0);
      const frame = new Int16Array(512);
      const result = det.processFrame(frame);

      expect(result).not.toBeNull();
      expect(result!.wakeWord).toBeDefined();
      expect(result!.confidence).toBe(1.0);
      expect(detectedSpy).toHaveBeenCalledWith(result);

      await det.stop();
    });

    it('should return null when Porcupine returns -1', async () => {
      const det = new WakeWordDetector({ accessKey: 'test-key' });
      await det.start();

      mockProcess.mockReturnValueOnce(-1);
      const frame = new Int16Array(512);
      const result = det.processFrame(frame);

      expect(result).toBeNull();

      await det.stop();
    });

    it('should respect cooldown between detections', async () => {
      const det = new WakeWordDetector({ accessKey: 'test-key' });
      await det.start();

      mockProcess.mockReturnValueOnce(0);
      const frame = new Int16Array(512);
      det.processFrame(frame);

      // Second detection within cooldown should be suppressed
      mockProcess.mockReturnValueOnce(0);
      const result2 = det.processFrame(frame);
      expect(result2).toBeNull();

      await det.stop();
    });

    it('should accept Buffer and convert to Int16Array', async () => {
      const det = new WakeWordDetector({ accessKey: 'test-key' });
      await det.start();

      mockProcess.mockReturnValueOnce(-1);
      const frame = Buffer.alloc(1024); // 512 Int16 samples
      det.processFrame(frame);

      expect(mockProcess).toHaveBeenCalled();

      await det.stop();
    });

    it('should use custom keywordPaths when provided', async () => {
      const det = new WakeWordDetector({
        accessKey: 'test-key',
        keywordPaths: ['/path/to/keyword.ppn'],
        wakeWords: ['custom word'],
      });
      await det.start();

      expect(Porcupine).toHaveBeenCalledWith(
        'test-key',
        ['/path/to/keyword.ppn'],
        [0.5],
      );

      await det.stop();
    });
  });

  describe('text-match fallback', () => {
    it('should fallback to text-match without access key', async () => {
      await detector.start();
      expect(detector.getEngine()).toBe('text-match');
    });

    it('should use text-match when explicitly configured', async () => {
      const det = new WakeWordDetector({
        accessKey: 'test-key',
        engine: 'text-match',
      });
      await det.start();

      expect(det.getEngine()).toBe('text-match');

      await det.stop();
    });

    it('should detect wake word in text', async () => {
      await detector.start();

      const detectedSpy = jest.fn();
      detector.on('detected', detectedSpy);

      const result = detector.detectWakeWordText('hey buddy, how are you?');
      expect(result).not.toBeNull();
      expect(result!.wakeWord).toBe('hey buddy');
      expect(result!.confidence).toBe(0.85);
      expect(detectedSpy).toHaveBeenCalled();
    });

    it('should return null for non-matching text', async () => {
      await detector.start();

      const result = detector.detectWakeWordText('random sentence');
      expect(result).toBeNull();
    });

    it('should return null for audio frames in text-match mode', async () => {
      await detector.start();

      const frame = Buffer.alloc(1024);
      const result = detector.processFrame(frame);
      expect(result).toBeNull();
    });

    it('should respect cooldown in text-match mode', async () => {
      await detector.start();

      detector.detectWakeWordText('hey buddy');
      const result2 = detector.detectWakeWordText('hey buddy again');
      expect(result2).toBeNull();
    });

    it('should not detect when not running', () => {
      const result = detector.detectWakeWordText('hey buddy');
      expect(result).toBeNull();
    });
  });

  describe('processFrame', () => {
    it('should return null when not running', () => {
      const frame = Buffer.alloc(1024);
      const result = detector.processFrame(frame);

      expect(result).toBeNull();
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
