/**
 * Voice Activity Detection (VAD)
 *
 * Detects speech in audio stream to enable automatic speech recognition
 * start/stop and improve transcription accuracy.
 */

import { EventEmitter } from 'events';
import type { VADConfig, VADEvent } from './types.js';
import { DEFAULT_VAD_CONFIG } from './types.js';

/**
 * VAD detector interface
 */
export interface IVADDetector {
  /** Process audio frame */
  processFrame(frame: Buffer): VADEvent | null;
  /** Reset state */
  reset(): void;
  /** Check if speech is active */
  isSpeechActive(): boolean;
  /** Get configuration */
  getConfig(): VADConfig;
  /** Update configuration */
  updateConfig(config: Partial<VADConfig>): void;
}

/**
 * Voice Activity Detector
 *
 * Uses energy-based detection with adaptive thresholding.
 * A production implementation would use WebRTC VAD or Silero VAD.
 */
export class VoiceActivityDetector extends EventEmitter implements IVADDetector {
  private config: VADConfig;
  private speechActive = false;
  private speechStartTime: number | null = null;
  private silenceStartTime: number | null = null;
  private frameCount = 0;
  private energyHistory: number[] = [];
  private noiseFloor = 0.01;
  private speechThreshold = 0.1;

  constructor(config: Partial<VADConfig> = {}) {
    super();
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  processFrame(frame: Buffer): VADEvent | null {
    if (!this.config.enabled) return null;

    this.frameCount++;
    const timestamp = new Date();
    const positionMs =
      (this.frameCount * this.config.frameDuration);

    // Calculate energy
    const energy = this.calculateEnergy(frame);
    this.updateEnergyHistory(energy);

    // Calculate speech probability
    const probability = this.calculateSpeechProbability(energy);

    // Detect state transitions
    if (!this.speechActive) {
      // Check for speech start
      if (probability >= this.config.speechStartThreshold) {
        // Potential speech start - wait for confirmation
        if (!this.speechStartTime) {
          this.speechStartTime = positionMs;
        } else if (
          positionMs - this.speechStartTime >=
          this.config.minSpeechDuration
        ) {
          // Confirmed speech
          this.speechActive = true;
          this.silenceStartTime = null;

          const event: VADEvent = {
            type: 'speech-start',
            timestamp,
            positionMs: this.speechStartTime,
            probability,
          };

          this.emit('speech-start', event);
          return event;
        }
      } else {
        this.speechStartTime = null;
      }
    } else {
      // Check for speech end
      if (probability < this.config.speechEndThreshold) {
        // Potential silence
        if (!this.silenceStartTime) {
          this.silenceStartTime = positionMs;
        } else if (
          positionMs - this.silenceStartTime >=
          this.config.maxSilenceDuration
        ) {
          // Confirmed end of speech
          this.speechActive = false;
          this.speechStartTime = null;

          const event: VADEvent = {
            type: 'speech-end',
            timestamp,
            positionMs,
            probability,
          };

          this.emit('speech-end', event);
          return event;
        }
      } else {
        this.silenceStartTime = null;
      }
    }

    return null;
  }

  /**
   * Calculate energy of audio frame
   */
  private calculateEnergy(frame: Buffer): number {
    let sum = 0;
    const samples = frame.length / 2; // 16-bit samples

    for (let i = 0; i < samples; i++) {
      const sample = frame.readInt16LE(i * 2) / 32768;
      sum += sample * sample;
    }

    return Math.sqrt(sum / samples);
  }

  /**
   * Update energy history for adaptive thresholding
   */
  private updateEnergyHistory(energy: number): void {
    this.energyHistory.push(energy);

    // Keep last 100 frames (~3 seconds)
    const maxHistory = 100;
    while (this.energyHistory.length > maxHistory) {
      this.energyHistory.shift();
    }

    // Update noise floor (10th percentile of energy)
    if (this.energyHistory.length >= 10) {
      const sorted = [...this.energyHistory].sort((a, b) => a - b);
      this.noiseFloor = sorted[Math.floor(sorted.length * 0.1)] * 1.5;

      // Speech threshold is 3x noise floor
      this.speechThreshold = Math.max(0.05, this.noiseFloor * 3);
    }
  }

  /**
   * Calculate speech probability based on energy
   */
  private calculateSpeechProbability(energy: number): number {
    if (energy <= this.noiseFloor) {
      return 0;
    }

    // Sigmoid-like mapping
    const x = (energy - this.noiseFloor) / (this.speechThreshold - this.noiseFloor);
    const probability = 1 / (1 + Math.exp(-5 * (x - 0.5)));

    return Math.min(1, Math.max(0, probability));
  }

  reset(): void {
    this.speechActive = false;
    this.speechStartTime = null;
    this.silenceStartTime = null;
    this.frameCount = 0;
    this.energyHistory = [];
    this.noiseFloor = 0.01;
    this.speechThreshold = 0.1;
  }

  isSpeechActive(): boolean {
    return this.speechActive;
  }

  getConfig(): VADConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current noise floor
   */
  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  /**
   * Get current speech threshold
   */
  getSpeechThreshold(): number {
    return this.speechThreshold;
  }

  /**
   * Get current energy level
   */
  getCurrentEnergy(): number {
    return this.energyHistory.length > 0
      ? this.energyHistory[this.energyHistory.length - 1]
      : 0;
  }

  /**
   * Get speech duration
   */
  getSpeechDuration(): number {
    if (!this.speechActive || !this.speechStartTime) {
      return 0;
    }
    return this.frameCount * this.config.frameDuration - this.speechStartTime;
  }
}

/**
 * Factory function for creating VAD detector
 */
export function createVADDetector(config?: Partial<VADConfig>): VoiceActivityDetector {
  return new VoiceActivityDetector(config);
}

export default VoiceActivityDetector;
