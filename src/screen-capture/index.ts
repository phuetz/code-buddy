/**
 * Screen Capture Module
 *
 * Screenshot and screen recording functionality.
 */

// Types
export type {
  CaptureType,
  CaptureSource,
  CaptureRegion,
  DisplayInfo,
  WindowInfo,
  ScreenshotOptions,
  ScreenshotResult,
  RecordingOptions,
  RecordingResult,
  RecordingState,
  RecordingStatus,
  ScreenCaptureConfig,
  ScreenCaptureEvents,
} from './types.js';

export {
  DEFAULT_SCREENSHOT_OPTIONS,
  DEFAULT_RECORDING_OPTIONS,
  DEFAULT_SCREEN_CAPTURE_CONFIG,
} from './types.js';

// Manager
export {
  CaptureManager,
  getCaptureManager,
  resetCaptureManager,
} from './capture-manager.js';
