/**
 * Screen Capture Manager
 *
 * Manages screenshot and recording operations.
 * Note: This is a mock implementation. Real implementation would use
 * native modules or external tools like ffmpeg, scrot, etc.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as path from 'path';
import type {
  ScreenshotOptions,
  ScreenshotResult,
  RecordingOptions,
  RecordingResult,
  RecordingStatus,
  RecordingState,
  DisplayInfo,
  WindowInfo,
  CaptureRegion,
  ScreenCaptureConfig,
} from './types.js';
import {
  DEFAULT_SCREENSHOT_OPTIONS,
  DEFAULT_RECORDING_OPTIONS,
  DEFAULT_SCREEN_CAPTURE_CONFIG,
} from './types.js';

// ============================================================================
// Capture Manager
// ============================================================================

export class CaptureManager extends EventEmitter {
  private config: ScreenCaptureConfig;
  private recording: RecordingContext | null = null;
  private displays: DisplayInfo[] = [];
  private windows: WindowInfo[] = [];

  constructor(config: Partial<ScreenCaptureConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SCREEN_CAPTURE_CONFIG, ...config };
    this.initializeMockData();
  }

  private initializeMockData(): void {
    // Mock displays
    this.displays = [
      {
        id: 'display-1',
        name: 'Primary Display',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        isPrimary: true,
        scaleFactor: 1,
        refreshRate: 60,
      },
      {
        id: 'display-2',
        name: 'Secondary Display',
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        isPrimary: false,
        scaleFactor: 1,
        refreshRate: 60,
      },
    ];

    // Mock windows
    this.windows = [
      {
        id: 'window-1',
        title: 'Terminal',
        processName: 'terminal',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        isMinimized: false,
        isVisible: true,
        pid: 1234,
      },
      {
        id: 'window-2',
        title: 'Browser',
        processName: 'browser',
        bounds: { x: 200, y: 150, width: 1200, height: 800 },
        isMinimized: false,
        isVisible: true,
        pid: 5678,
      },
    ];
  }

  // ============================================================================
  // Display & Window Discovery
  // ============================================================================

  /**
   * Get all available displays
   */
  async getDisplays(): Promise<DisplayInfo[]> {
    return [...this.displays];
  }

  /**
   * Get primary display
   */
  async getPrimaryDisplay(): Promise<DisplayInfo | undefined> {
    return this.displays.find(d => d.isPrimary);
  }

  /**
   * Get display by ID
   */
  async getDisplay(id: string): Promise<DisplayInfo | undefined> {
    return this.displays.find(d => d.id === id);
  }

  /**
   * Get all windows
   */
  async getWindows(): Promise<WindowInfo[]> {
    return [...this.windows].filter(w => w.isVisible && !w.isMinimized);
  }

  /**
   * Get window by ID
   */
  async getWindow(id: string): Promise<WindowInfo | undefined> {
    return this.windows.find(w => w.id === id);
  }

  /**
   * Find windows by title pattern
   */
  async findWindows(titlePattern: string | RegExp): Promise<WindowInfo[]> {
    const pattern = typeof titlePattern === 'string'
      ? new RegExp(titlePattern, 'i')
      : titlePattern;

    return this.windows.filter(w => pattern.test(w.title));
  }

  // ============================================================================
  // Screenshot
  // ============================================================================

  /**
   * Take a screenshot
   */
  async takeScreenshot(options: Partial<ScreenshotOptions> = {}): Promise<ScreenshotResult> {
    const fullOptions: ScreenshotOptions = {
      ...DEFAULT_SCREENSHOT_OPTIONS,
      ...this.config.screenshotDefaults,
      ...options,
    };

    this.emit('screenshot-start', fullOptions);

    try {
      // Delay if specified
      if (fullOptions.delayMs && fullOptions.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, fullOptions.delayMs));
      }

      // Determine capture region
      const region = await this.resolveRegion(fullOptions);

      // Generate mock image data
      const imageData = this.generateMockImage(region, fullOptions);

      // Generate file path if not specified
      const filePath = fullOptions.path || this.generateFilePath('screenshot', fullOptions.format || 'png');

      const result: ScreenshotResult = {
        data: imageData,
        format: fullOptions.format || 'png',
        width: region.width,
        height: region.height,
        path: filePath,
        timestamp: new Date(),
        source: {
          type: fullOptions.source || 'screen',
          displayId: fullOptions.displayId,
          windowId: fullOptions.windowId,
          region: fullOptions.region,
        },
        size: imageData.length,
      };

      this.emit('screenshot-complete', result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('screenshot-error', err);
      throw err;
    }
  }

  /**
   * Take multiple screenshots
   */
  async takeScreenshots(
    count: number,
    intervalMs: number,
    options: Partial<ScreenshotOptions> = {}
  ): Promise<ScreenshotResult[]> {
    const results: ScreenshotResult[] = [];

    for (let i = 0; i < count; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }

      const result = await this.takeScreenshot({
        ...options,
        path: options.path
          ? options.path.replace(/(\.[^.]+)$/, `_${i}$1`)
          : undefined,
      });

      results.push(result);
    }

    return results;
  }

  // ============================================================================
  // Recording
  // ============================================================================

  /**
   * Start recording
   */
  async startRecording(options: RecordingOptions): Promise<void> {
    if (this.recording) {
      throw new Error('Recording already in progress');
    }

    const fullOptions: RecordingOptions = {
      ...DEFAULT_RECORDING_OPTIONS,
      ...this.config.recordingDefaults,
      ...options,
    };

    this.emit('recording-start', fullOptions);

    const region = await this.resolveRegion(fullOptions);

    this.recording = {
      options: fullOptions,
      state: 'recording',
      startedAt: new Date(),
      pausedAt: undefined,
      frameCount: 0,
      droppedFrames: 0,
      pausedDuration: 0,
      region,
      interval: null,
    };

    // Simulate frame capture
    const fps = fullOptions.fps || 30;
    const frameInterval = Math.floor(1000 / fps);

    this.recording.interval = setInterval(() => {
      if (this.recording?.state === 'recording') {
        this.recording.frameCount++;

        // Randomly drop some frames for realism
        if (Math.random() < 0.01) {
          this.recording.droppedFrames++;
        }

        this.emit('recording-progress', this.getRecordingStatus());

        // Check limits
        if (fullOptions.maxDurationMs) {
          const duration = this.calculateRecordingDuration();
          if (duration >= fullOptions.maxDurationMs) {
            this.stopRecording();
          }
        }
      }
    }, frameInterval);
  }

  /**
   * Pause recording
   */
  pauseRecording(): void {
    if (!this.recording || this.recording.state !== 'recording') {
      throw new Error('No recording in progress');
    }

    this.recording.state = 'paused';
    this.recording.pausedAt = new Date();
    this.emit('recording-pause');
    this.emit('recording-progress', this.getRecordingStatus());
  }

  /**
   * Resume recording
   */
  resumeRecording(): void {
    if (!this.recording || this.recording.state !== 'paused') {
      throw new Error('Recording not paused');
    }

    if (this.recording.pausedAt) {
      this.recording.pausedDuration += Date.now() - this.recording.pausedAt.getTime();
    }

    this.recording.state = 'recording';
    this.recording.pausedAt = undefined;
    this.emit('recording-resume');
    this.emit('recording-progress', this.getRecordingStatus());
  }

  /**
   * Stop recording
   */
  async stopRecording(): Promise<RecordingResult> {
    if (!this.recording) {
      throw new Error('No recording in progress');
    }

    const recording = this.recording;
    recording.state = 'stopping';

    this.emit('recording-stop');

    // Clear interval
    if (recording.interval) {
      clearInterval(recording.interval);
      recording.interval = null;
    }

    // Calculate results
    const endedAt = new Date();
    const durationMs = this.calculateRecordingDuration();
    const fps = recording.options.fps || 30;

    const result: RecordingResult = {
      path: recording.options.path,
      format: recording.options.format || 'mp4',
      durationMs,
      frameCount: recording.frameCount,
      avgFps: durationMs > 0 ? (recording.frameCount / durationMs) * 1000 : 0,
      size: Math.floor(recording.frameCount * 10000), // Mock file size
      startedAt: recording.startedAt,
      endedAt,
      source: {
        type: recording.options.source || 'screen',
        displayId: recording.options.displayId,
        windowId: recording.options.windowId,
        region: recording.options.region,
      },
      resolution: {
        width: recording.region.width,
        height: recording.region.height,
      },
    };

    this.recording = null;
    this.emit('recording-complete', result);

    return result;
  }

  /**
   * Cancel recording (discard)
   */
  cancelRecording(): void {
    if (!this.recording) return;

    if (this.recording.interval) {
      clearInterval(this.recording.interval);
    }

    this.recording = null;
    this.emit('recording-error', new Error('Recording cancelled'));
  }

  /**
   * Get recording status
   */
  getRecordingStatus(): RecordingStatus {
    if (!this.recording) {
      return {
        state: 'idle',
        durationMs: 0,
        frameCount: 0,
        currentFps: 0,
        currentSize: 0,
        droppedFrames: 0,
      };
    }

    const durationMs = this.calculateRecordingDuration();
    const fps = this.recording.options.fps || 30;

    return {
      state: this.recording.state,
      options: this.recording.options,
      durationMs,
      frameCount: this.recording.frameCount,
      currentFps: durationMs > 0 ? (this.recording.frameCount / durationMs) * 1000 : fps,
      currentSize: Math.floor(this.recording.frameCount * 10000),
      droppedFrames: this.recording.droppedFrames,
      startedAt: this.recording.startedAt,
      pausedAt: this.recording.pausedAt,
    };
  }

  /**
   * Check if recording
   */
  isRecording(): boolean {
    return this.recording?.state === 'recording';
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.recording?.state === 'paused';
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async resolveRegion(options: Partial<ScreenshotOptions | RecordingOptions>): Promise<CaptureRegion> {
    if (options.region) {
      return options.region;
    }

    if (options.windowId) {
      const window = await this.getWindow(options.windowId);
      if (window) {
        return window.bounds;
      }
    }

    if (options.displayId) {
      const display = await this.getDisplay(options.displayId);
      if (display) {
        return display.bounds;
      }
    }

    // Default to primary display
    const primary = await this.getPrimaryDisplay();
    return primary?.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
  }

  private generateMockImage(region: CaptureRegion, options: ScreenshotOptions): Buffer {
    // Generate a minimal PNG/JPEG header + mock data
    const width = Math.floor(region.width * (options.scale || 1));
    const height = Math.floor(region.height * (options.scale || 1));

    // Just return some bytes representing the image size
    // In a real implementation, this would be actual image data
    const size = Math.floor(width * height * 3 * ((options.quality || 90) / 100));
    const buffer = Buffer.alloc(Math.min(size, 1024 * 1024)); // Cap at 1MB for mock

    // Fill with random data to simulate image
    crypto.randomFillSync(buffer);

    return buffer;
  }

  private generateFilePath(type: string, format: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = this.config.namingPattern
      .replace('{type}', type)
      .replace('{timestamp}', timestamp);

    return path.join(this.config.outputDir, `${filename}.${format}`);
  }

  private calculateRecordingDuration(): number {
    if (!this.recording) return 0;

    const now = Date.now();
    const elapsed = now - this.recording.startedAt.getTime();
    const paused = this.recording.pausedDuration;

    // If currently paused, add current pause duration
    const currentPause = this.recording.pausedAt
      ? now - this.recording.pausedAt.getTime()
      : 0;

    return elapsed - paused - currentPause;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get configuration
   */
  getConfig(): ScreenCaptureConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ScreenCaptureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get stats
   */
  getStats(): {
    displays: number;
    windows: number;
    isRecording: boolean;
    recordingDuration: number;
  } {
    return {
      displays: this.displays.length,
      windows: this.windows.length,
      isRecording: this.isRecording(),
      recordingDuration: this.recording ? this.calculateRecordingDuration() : 0,
    };
  }
}

// ============================================================================
// Recording Context
// ============================================================================

interface RecordingContext {
  options: RecordingOptions;
  state: RecordingState;
  startedAt: Date;
  pausedAt?: Date;
  frameCount: number;
  droppedFrames: number;
  pausedDuration: number;
  region: CaptureRegion;
  interval: NodeJS.Timeout | null;
}

// ============================================================================
// Singleton
// ============================================================================

let captureManagerInstance: CaptureManager | null = null;

export function getCaptureManager(config?: Partial<ScreenCaptureConfig>): CaptureManager {
  if (!captureManagerInstance) {
    captureManagerInstance = new CaptureManager(config);
  }
  return captureManagerInstance;
}

export function resetCaptureManager(): void {
  if (captureManagerInstance) {
    if (captureManagerInstance.isRecording()) {
      captureManagerInstance.cancelRecording();
    }
    captureManagerInstance = null;
  }
}
