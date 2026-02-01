/**
 * Wake Word Detector
 *
 * Detects wake words in audio stream to activate voice commands.
 * Uses pattern matching and/or neural network-based detection.
 */

import { EventEmitter } from 'events';
import type {
  WakeWordConfig,
  WakeWordDetection,
  AudioChunk,
} from './types.js';
import { DEFAULT_WAKE_WORD_CONFIG } from './types.js';

/**
 * Wake word detector interface
 */
export interface IWakeWordDetector {
  /** Start detection */
  start(): Promise<void>;
  /** Stop detection */
  stop(): Promise<void>;
  /** Process audio frame */
  processFrame(frame: Buffer): WakeWordDetection | null;
  /** Check if running */
  isRunning(): boolean;
  /** Get configuration */
  getConfig(): WakeWordConfig;
  /** Update configuration */
  updateConfig(config: Partial<WakeWordConfig>): void;
}

/**
 * Simple pattern-based wake word detector
 *
 * This is a placeholder implementation. A production implementation would use:
 * - Porcupine (https://picovoice.ai/platform/porcupine/)
 * - Snowboy
 * - Or a custom neural network
 */
export class WakeWordDetector extends EventEmitter implements IWakeWordDetector {
  private config: WakeWordConfig;
  private running = false;
  private audioBuffer: Buffer[] = [];
  private lastDetection: Date | null = null;
  private cooldownMs = 1000; // Prevent double triggers

  constructor(config: Partial<WakeWordConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WAKE_WORD_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.audioBuffer = [];
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.audioBuffer = [];
    this.emit('stopped');
  }

  processFrame(frame: Buffer): WakeWordDetection | null {
    if (!this.running) return null;

    // Add frame to buffer
    this.audioBuffer.push(frame);

    // Keep only last 3 seconds of audio
    const maxFrames = Math.ceil(
      (3 * this.config.sampleRate) / this.config.frameSize
    );
    while (this.audioBuffer.length > maxFrames) {
      this.audioBuffer.shift();
    }

    // Check cooldown
    if (
      this.lastDetection &&
      Date.now() - this.lastDetection.getTime() < this.cooldownMs
    ) {
      return null;
    }

    // Simple energy-based detection as placeholder
    // Real implementation would use proper wake word model
    const energy = this.calculateEnergy(frame);

    // For testing: simulate random detection when high energy
    if (energy > 0.1 && Math.random() < 0.001) {
      const detection: WakeWordDetection = {
        wakeWord: this.config.wakeWords[0],
        confidence: 0.8 + Math.random() * 0.2,
        timestamp: new Date(),
      };

      if (detection.confidence >= this.config.minConfidence) {
        this.lastDetection = new Date();
        this.emit('detected', detection);
        return detection;
      }
    }

    return null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): WakeWordConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<WakeWordConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Calculate energy level of audio frame
   */
  private calculateEnergy(frame: Buffer): number {
    let sum = 0;
    const samples = frame.length / 2; // 16-bit samples

    for (let i = 0; i < samples; i++) {
      const sample = frame.readInt16LE(i * 2);
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / samples);
    return rms / 32768; // Normalize to 0-1
  }

  /**
   * Add a custom wake word
   */
  addWakeWord(wakeWord: string): void {
    if (!this.config.wakeWords.includes(wakeWord)) {
      this.config.wakeWords.push(wakeWord);
    }
  }

  /**
   * Remove a wake word
   */
  removeWakeWord(wakeWord: string): void {
    const index = this.config.wakeWords.indexOf(wakeWord);
    if (index >= 0) {
      this.config.wakeWords.splice(index, 1);
    }
  }

  /**
   * Get current wake words
   */
  getWakeWords(): string[] {
    return [...this.config.wakeWords];
  }

  /**
   * Set sensitivity
   */
  setSensitivity(sensitivity: number): void {
    this.config.sensitivity = Math.max(0, Math.min(1, sensitivity));
  }

  /**
   * Clear audio buffer
   */
  clearBuffer(): void {
    this.audioBuffer = [];
  }
}

/**
 * Factory function for creating wake word detector
 */
export function createWakeWordDetector(
  config?: Partial<WakeWordConfig>
): WakeWordDetector {
  return new WakeWordDetector(config);
}

export default WakeWordDetector;
