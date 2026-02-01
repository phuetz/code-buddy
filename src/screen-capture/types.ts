/**
 * Screen Capture Types
 *
 * Type definitions for screen capture and recording functionality.
 */

// ============================================================================
// Capture Types
// ============================================================================

export type CaptureType = 'screenshot' | 'recording';
export type CaptureSource = 'screen' | 'window' | 'region' | 'display';

export interface CaptureRegion {
  /** X coordinate */
  x: number;
  /** Y coordinate */
  y: number;
  /** Width */
  width: number;
  /** Height */
  height: number;
}

export interface DisplayInfo {
  /** Display ID */
  id: string;
  /** Display name */
  name: string;
  /** Display bounds */
  bounds: CaptureRegion;
  /** Is primary display */
  isPrimary: boolean;
  /** Scale factor */
  scaleFactor: number;
  /** Refresh rate */
  refreshRate?: number;
}

export interface WindowInfo {
  /** Window ID */
  id: string;
  /** Window title */
  title: string;
  /** Process name */
  processName?: string;
  /** Window bounds */
  bounds: CaptureRegion;
  /** Is minimized */
  isMinimized: boolean;
  /** Is visible */
  isVisible: boolean;
  /** Owner process ID */
  pid?: number;
}

// ============================================================================
// Screenshot Types
// ============================================================================

export interface ScreenshotOptions {
  /** Output file path */
  path?: string;
  /** Image format */
  format?: 'png' | 'jpeg' | 'webp' | 'bmp';
  /** JPEG/WebP quality (0-100) */
  quality?: number;
  /** Capture source */
  source?: CaptureSource;
  /** Display ID for display capture */
  displayId?: string;
  /** Window ID for window capture */
  windowId?: string;
  /** Region for region capture */
  region?: CaptureRegion;
  /** Include cursor */
  includeCursor?: boolean;
  /** Delay before capture (ms) */
  delayMs?: number;
  /** Include window shadow (macOS) */
  includeShadow?: boolean;
  /** Scale factor */
  scale?: number;
}

export interface ScreenshotResult {
  /** Image data */
  data: Buffer;
  /** Image format */
  format: 'png' | 'jpeg' | 'webp' | 'bmp';
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** File path if saved */
  path?: string;
  /** Capture timestamp */
  timestamp: Date;
  /** Source information */
  source: {
    type: CaptureSource;
    displayId?: string;
    windowId?: string;
    region?: CaptureRegion;
  };
  /** File size in bytes */
  size: number;
}

export const DEFAULT_SCREENSHOT_OPTIONS: ScreenshotOptions = {
  format: 'png',
  quality: 90,
  source: 'screen',
  includeCursor: false,
  delayMs: 0,
  includeShadow: true,
  scale: 1,
};

// ============================================================================
// Recording Types
// ============================================================================

export interface RecordingOptions {
  /** Output file path */
  path: string;
  /** Video format */
  format?: 'mp4' | 'webm' | 'gif' | 'avi';
  /** Video codec */
  codec?: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1';
  /** Frame rate */
  fps?: number;
  /** Video quality (0-100) */
  quality?: number;
  /** Video bitrate (kbps) */
  bitrate?: number;
  /** Capture source */
  source?: CaptureSource;
  /** Display ID for display capture */
  displayId?: string;
  /** Window ID for window capture */
  windowId?: string;
  /** Region for region capture */
  region?: CaptureRegion;
  /** Include cursor */
  includeCursor?: boolean;
  /** Include audio */
  includeAudio?: boolean;
  /** Audio device */
  audioDevice?: string;
  /** Maximum duration (ms) */
  maxDurationMs?: number;
  /** Maximum file size (bytes) */
  maxSizeBytes?: number;
}

export interface RecordingResult {
  /** File path */
  path: string;
  /** Video format */
  format: 'mp4' | 'webm' | 'gif' | 'avi';
  /** Duration in milliseconds */
  durationMs: number;
  /** Frame count */
  frameCount: number;
  /** Average FPS */
  avgFps: number;
  /** File size in bytes */
  size: number;
  /** Start timestamp */
  startedAt: Date;
  /** End timestamp */
  endedAt: Date;
  /** Source information */
  source: {
    type: CaptureSource;
    displayId?: string;
    windowId?: string;
    region?: CaptureRegion;
  };
  /** Video resolution */
  resolution: { width: number; height: number };
}

export const DEFAULT_RECORDING_OPTIONS: Partial<RecordingOptions> = {
  format: 'mp4',
  codec: 'h264',
  fps: 30,
  quality: 80,
  bitrate: 5000,
  source: 'screen',
  includeCursor: true,
  includeAudio: false,
};

export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'stopped';

export interface RecordingStatus {
  /** Current state */
  state: RecordingState;
  /** Recording options */
  options?: RecordingOptions;
  /** Duration so far (ms) */
  durationMs: number;
  /** Frames captured */
  frameCount: number;
  /** Current FPS */
  currentFps: number;
  /** Current file size */
  currentSize: number;
  /** Dropped frames */
  droppedFrames: number;
  /** Start time */
  startedAt?: Date;
  /** Pause time */
  pausedAt?: Date;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ScreenCaptureConfig {
  /** Default screenshot options */
  screenshotDefaults: Partial<ScreenshotOptions>;
  /** Default recording options */
  recordingDefaults: Partial<RecordingOptions>;
  /** Output directory */
  outputDir: string;
  /** File naming pattern */
  namingPattern: string;
  /** Max concurrent captures */
  maxConcurrent: number;
  /** Enable hardware acceleration */
  hardwareAcceleration: boolean;
}

export const DEFAULT_SCREEN_CAPTURE_CONFIG: ScreenCaptureConfig = {
  screenshotDefaults: DEFAULT_SCREENSHOT_OPTIONS,
  recordingDefaults: DEFAULT_RECORDING_OPTIONS,
  outputDir: './captures',
  namingPattern: '{type}_{timestamp}',
  maxConcurrent: 3,
  hardwareAcceleration: true,
};

// ============================================================================
// Events
// ============================================================================

export interface ScreenCaptureEvents {
  'screenshot-start': (options: ScreenshotOptions) => void;
  'screenshot-complete': (result: ScreenshotResult) => void;
  'screenshot-error': (error: Error) => void;
  'recording-start': (options: RecordingOptions) => void;
  'recording-progress': (status: RecordingStatus) => void;
  'recording-pause': () => void;
  'recording-resume': () => void;
  'recording-stop': () => void;
  'recording-complete': (result: RecordingResult) => void;
  'recording-error': (error: Error) => void;
}
