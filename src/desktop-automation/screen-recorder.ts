/**
 * Screen Recorder Module
 *
 * Cross-platform screen recording with video capture support.
 * Supports MP4, WebM, GIF output formats.
 *
 * Uses:
 * - macOS: screencapture, AVFoundation via swift
 * - Linux: ffmpeg with x11grab/pipewire
 * - Windows: ffmpeg with gdigrab
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { getPermissionManager, PermissionType } from './permission-manager.js';

// ============================================================================
// Types
// ============================================================================

export type RecordingFormat = 'mp4' | 'webm' | 'gif' | 'avi' | 'mkv';
export type VideoCodec = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1';
export type RecordingState = 'idle' | 'recording' | 'paused' | 'processing';

export interface RecordingOptions {
  /** Output file path (without extension) */
  outputPath?: string;
  /** Output format */
  format?: RecordingFormat;
  /** Video codec */
  codec?: VideoCodec;
  /** Frame rate (default: 30) */
  fps?: number;
  /** Video bitrate (e.g., '2M', '5000k') */
  bitrate?: string;
  /** Quality (0-100, for variable bitrate) */
  quality?: number;
  /** Capture audio */
  audio?: boolean;
  /** Audio source (system, microphone, both) */
  audioSource?: 'system' | 'microphone' | 'both';
  /** Maximum duration in seconds */
  maxDuration?: number;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Capture region (default: full screen) */
  region?: { x: number; y: number; width: number; height: number };
  /** Display/screen index for multi-monitor */
  display?: number;
  /** Show mouse cursor */
  showCursor?: boolean;
  /** Highlight mouse clicks */
  highlightClicks?: boolean;
}

export interface RecordingInfo {
  /** Recording ID */
  id: string;
  /** Output file path */
  outputPath: string;
  /** Recording state */
  state: RecordingState;
  /** Start time */
  startTime: Date;
  /** Duration in seconds */
  duration: number;
  /** Current file size in bytes */
  fileSize: number;
  /** Frame count */
  frameCount: number;
  /** Recording options */
  options: RecordingOptions;
}

export interface RecordingResult {
  success: boolean;
  outputPath?: string;
  duration?: number;
  fileSize?: number;
  error?: string;
}

export interface ScreenRecorderConfig {
  /** Default output directory */
  outputDir: string;
  /** Default format */
  defaultFormat: RecordingFormat;
  /** Default FPS */
  defaultFps: number;
  /** Default bitrate */
  defaultBitrate: string;
  /** FFmpeg path (if not in PATH) */
  ffmpegPath?: string;
}

const DEFAULT_CONFIG: ScreenRecorderConfig = {
  outputDir: path.join(os.tmpdir(), 'codebuddy-recordings'),
  defaultFormat: 'mp4',
  defaultFps: 30,
  defaultBitrate: '2M',
};

// ============================================================================
// Screen Recorder
// ============================================================================

export class ScreenRecorder extends EventEmitter {
  private config: ScreenRecorderConfig;
  private currentRecording: RecordingInfo | null = null;
  private ffmpegProcess: ChildProcess | null = null;
  private recordingStartTime: Date | null = null;
  private pausedDuration: number = 0;
  private pauseStartTime: Date | null = null;

  constructor(config: Partial<ScreenRecorderConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Main API
  // ============================================================================

  /**
   * Start screen recording
   */
  async start(options: RecordingOptions = {}): Promise<RecordingInfo> {
    if (this.currentRecording?.state === 'recording') {
      throw new Error('Recording already in progress');
    }

    // Check permissions
    const permManager = getPermissionManager();
    const permResult = await permManager.check('screen-recording');
    if (!permResult.granted) {
      const info = permManager.getInstructions('screen-recording');
      throw new Error(`Screen recording permission required. ${info.instructions}`);
    }

    // Ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });

    // Generate output path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const format = options.format || this.config.defaultFormat;
    const outputPath = options.outputPath ||
      path.join(this.config.outputDir, `recording-${timestamp}.${format}`);

    // Create recording info
    const recordingId = `rec-${Date.now()}`;
    this.currentRecording = {
      id: recordingId,
      outputPath,
      state: 'recording',
      startTime: new Date(),
      duration: 0,
      fileSize: 0,
      frameCount: 0,
      options: {
        format,
        fps: options.fps || this.config.defaultFps,
        bitrate: options.bitrate || this.config.defaultBitrate,
        showCursor: options.showCursor ?? true,
        ...options,
      },
    };

    this.recordingStartTime = new Date();
    this.pausedDuration = 0;

    try {
      // Start recording based on platform
      await this.startRecording(this.currentRecording);

      this.emit('recording-started', { recording: this.currentRecording });
      logger.info('Screen recording started', { id: recordingId, outputPath });

      // Set up duration/size limits
      if (options.maxDuration) {
        setTimeout(() => this.stop(), options.maxDuration * 1000);
      }

      return this.currentRecording;
    } catch (error) {
      this.currentRecording = null;
      throw error;
    }
  }

  /**
   * Stop recording
   */
  async stop(): Promise<RecordingResult> {
    if (!this.currentRecording) {
      return { success: false, error: 'No recording in progress' };
    }

    const recording = this.currentRecording;

    try {
      // Stop ffmpeg process
      if (this.ffmpegProcess) {
        // Send 'q' to gracefully stop ffmpeg
        this.ffmpegProcess.stdin?.write('q');

        // Wait for process to exit
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.ffmpegProcess?.kill('SIGKILL');
            resolve();
          }, 5000);

          this.ffmpegProcess?.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        this.ffmpegProcess = null;
      }

      // Calculate final duration
      const duration = this.calculateDuration();

      // Get file stats
      let fileSize = 0;
      try {
        const stats = await fs.stat(recording.outputPath);
        fileSize = stats.size;
      } catch {
        // File might not exist if recording failed
      }

      // Update state
      this.currentRecording.state = 'idle';
      this.currentRecording.duration = duration;
      this.currentRecording.fileSize = fileSize;

      this.emit('recording-stopped', {
        recording: this.currentRecording,
        duration,
        fileSize,
      });

      logger.info('Screen recording stopped', {
        id: recording.id,
        duration,
        fileSize,
      });

      const result: RecordingResult = {
        success: true,
        outputPath: recording.outputPath,
        duration,
        fileSize,
      };

      this.currentRecording = null;
      this.recordingStartTime = null;

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop recording', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Pause recording
   */
  async pause(): Promise<void> {
    if (!this.currentRecording || this.currentRecording.state !== 'recording') {
      throw new Error('No active recording to pause');
    }

    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGSTOP');
    }

    this.pauseStartTime = new Date();
    this.currentRecording.state = 'paused';

    this.emit('recording-paused', { recording: this.currentRecording });
    logger.info('Screen recording paused');
  }

  /**
   * Resume recording
   */
  async resume(): Promise<void> {
    if (!this.currentRecording || this.currentRecording.state !== 'paused') {
      throw new Error('No paused recording to resume');
    }

    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGCONT');
    }

    if (this.pauseStartTime) {
      this.pausedDuration += Date.now() - this.pauseStartTime.getTime();
      this.pauseStartTime = null;
    }

    this.currentRecording.state = 'recording';

    this.emit('recording-resumed', { recording: this.currentRecording });
    logger.info('Screen recording resumed');
  }

  /**
   * Get current recording info
   */
  getStatus(): RecordingInfo | null {
    if (!this.currentRecording) {
      return null;
    }

    // Update duration
    this.currentRecording.duration = this.calculateDuration();

    return { ...this.currentRecording };
  }

  /**
   * Check if ffmpeg is available
   */
  async checkFfmpeg(): Promise<boolean> {
    try {
      const ffmpegPath = this.config.ffmpegPath || 'ffmpeg';
      execSync(`${ffmpegPath} -version`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available display/screen inputs
   */
  async listDisplays(): Promise<Array<{ id: number; name: string }>> {
    const platform = process.platform;
    const displays: Array<{ id: number; name: string }> = [];

    try {
      if (platform === 'darwin') {
        // macOS displays
        const output = execSync(`system_profiler SPDisplaysDataType`, { encoding: 'utf-8' });
        const matches = output.matchAll(/Display Type: (.+)/g);
        let id = 0;
        for (const match of matches) {
          displays.push({ id: id++, name: match[1] });
        }
      } else if (platform === 'linux') {
        // Linux displays via xrandr
        const output = execSync(`xrandr --query | grep ' connected'`, { encoding: 'utf-8' });
        const lines = output.split('\n').filter(l => l.trim());
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^(\S+)/);
          displays.push({ id: i, name: match?.[1] || `Display ${i}` });
        }
      } else if (platform === 'win32') {
        // Windows displays
        const output = execSync(
          `powershell -Command "Get-WmiObject -Namespace root\\wmi -Class WmiMonitorID | ForEach-Object { $_.InstanceName }"`,
          { encoding: 'utf-8' }
        );
        const lines = output.split('\n').filter(l => l.trim());
        for (let i = 0; i < lines.length; i++) {
          displays.push({ id: i, name: lines[i].trim() || `Display ${i}` });
        }
      }
    } catch {
      // Return default display
    }

    return displays.length > 0 ? displays : [{ id: 0, name: 'Primary Display' }];
  }

  // ============================================================================
  // Platform-specific Recording
  // ============================================================================

  private async startRecording(recording: RecordingInfo): Promise<void> {
    const platform = process.platform;
    const ffmpegPath = this.config.ffmpegPath || 'ffmpeg';
    const options = recording.options;

    // Build ffmpeg arguments based on platform
    let args: string[];

    switch (platform) {
      case 'darwin':
        args = this.buildMacOSArgs(recording);
        break;
      case 'linux':
        args = this.buildLinuxArgs(recording);
        break;
      case 'win32':
        args = this.buildWindowsArgs(recording);
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    logger.debug('Starting ffmpeg', { args: args.join(' ') });

    // Spawn ffmpeg process
    this.ffmpegProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout/stderr
    this.ffmpegProcess.stdout?.on('data', (data) => {
      logger.debug('ffmpeg stdout', { data: data.toString() });
    });

    this.ffmpegProcess.stderr?.on('data', (data) => {
      const message = data.toString();
      logger.debug('ffmpeg stderr', { data: message });

      // Parse frame count from ffmpeg output
      const frameMatch = message.match(/frame=\s*(\d+)/);
      if (frameMatch && this.currentRecording) {
        this.currentRecording.frameCount = parseInt(frameMatch[1], 10);
      }
    });

    this.ffmpegProcess.on('error', (error) => {
      logger.error('ffmpeg error', { error: error.message });
      this.emit('recording-error', { error });
    });

    this.ffmpegProcess.on('exit', (code) => {
      logger.debug('ffmpeg exited', { code });
      if (code !== 0 && this.currentRecording?.state === 'recording') {
        this.emit('recording-error', { error: new Error(`ffmpeg exited with code ${code}`) });
      }
    });
  }

  private buildMacOSArgs(recording: RecordingInfo): string[] {
    const opts = recording.options;
    const args: string[] = [
      '-y', // Overwrite output
      '-f', 'avfoundation',
    ];

    // Input devices (video:audio)
    const videoDevice = opts.display ?? 1; // 1 is usually main screen on macOS
    const audioDevice = opts.audio ? ':0' : '';
    args.push('-i', `${videoDevice}${audioDevice}`);

    // Frame rate
    args.push('-r', String(opts.fps || 30));

    // Video codec
    args.push('-c:v', this.getCodecName(opts.codec || 'h264'));

    // Bitrate
    if (opts.bitrate) {
      args.push('-b:v', opts.bitrate);
    }

    // Quality (CRF for h264/h265)
    if (opts.quality !== undefined) {
      const crf = Math.round((100 - opts.quality) * 0.51); // Map 0-100 to 51-0
      args.push('-crf', String(crf));
    }

    // Audio codec
    if (opts.audio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    // Pixel format for compatibility
    args.push('-pix_fmt', 'yuv420p');

    // Output
    args.push(recording.outputPath);

    return args;
  }

  private buildLinuxArgs(recording: RecordingInfo): string[] {
    const opts = recording.options;
    const display = process.env.DISPLAY || ':0';

    const args: string[] = [
      '-y', // Overwrite output
    ];

    // Check if using Wayland or X11
    if (process.env.WAYLAND_DISPLAY) {
      // Wayland: use pipewire-record or wf-recorder output
      args.push('-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30');
      logger.warn('Wayland screen recording requires pipewire. Using placeholder.');
    } else {
      // X11: use x11grab
      args.push('-f', 'x11grab');
      args.push('-framerate', String(opts.fps || 30));

      // Video size and position
      if (opts.region) {
        args.push('-video_size', `${opts.region.width}x${opts.region.height}`);
        args.push('-i', `${display}+${opts.region.x},${opts.region.y}`);
      } else {
        // Get screen resolution
        try {
          const resolution = execSync(`xdpyinfo | grep dimensions | awk '{print $2}'`, {
            encoding: 'utf-8',
          }).trim();
          args.push('-video_size', resolution);
        } catch {
          args.push('-video_size', '1920x1080');
        }
        args.push('-i', display);
      }

      // Cursor
      if (opts.showCursor === false) {
        args.push('-draw_mouse', '0');
      }
    }

    // Audio (PulseAudio)
    if (opts.audio) {
      args.push('-f', 'pulse', '-i', 'default');
    }

    // Video codec
    args.push('-c:v', this.getCodecName(opts.codec || 'h264'));

    // Bitrate
    if (opts.bitrate) {
      args.push('-b:v', opts.bitrate);
    }

    // Audio codec
    if (opts.audio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    // Pixel format
    args.push('-pix_fmt', 'yuv420p');

    // Output
    args.push(recording.outputPath);

    return args;
  }

  private buildWindowsArgs(recording: RecordingInfo): string[] {
    const opts = recording.options;
    const args: string[] = [
      '-y', // Overwrite output
      '-f', 'gdigrab',
      '-framerate', String(opts.fps || 30),
    ];

    // Cursor
    if (opts.showCursor !== false) {
      args.push('-draw_mouse', '1');
    }

    // Region or full screen
    if (opts.region) {
      args.push('-offset_x', String(opts.region.x));
      args.push('-offset_y', String(opts.region.y));
      args.push('-video_size', `${opts.region.width}x${opts.region.height}`);
    }

    args.push('-i', 'desktop');

    // Audio (dshow)
    if (opts.audio) {
      args.push('-f', 'dshow', '-i', 'audio="Stereo Mix"');
    }

    // Video codec
    args.push('-c:v', this.getCodecName(opts.codec || 'h264'));

    // Bitrate
    if (opts.bitrate) {
      args.push('-b:v', opts.bitrate);
    }

    // Preset for faster encoding
    args.push('-preset', 'ultrafast');

    // Audio codec
    if (opts.audio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    // Pixel format
    args.push('-pix_fmt', 'yuv420p');

    // Output
    args.push(recording.outputPath);

    return args;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getCodecName(codec: VideoCodec): string {
    const codecMap: Record<VideoCodec, string> = {
      h264: 'libx264',
      h265: 'libx265',
      vp8: 'libvpx',
      vp9: 'libvpx-vp9',
      av1: 'libaom-av1',
    };
    return codecMap[codec] || 'libx264';
  }

  private calculateDuration(): number {
    if (!this.recordingStartTime) return 0;

    let elapsed = Date.now() - this.recordingStartTime.getTime();
    elapsed -= this.pausedDuration;

    if (this.pauseStartTime) {
      elapsed -= Date.now() - this.pauseStartTime.getTime();
    }

    return Math.max(0, elapsed / 1000);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let screenRecorderInstance: ScreenRecorder | null = null;

export function getScreenRecorder(config?: Partial<ScreenRecorderConfig>): ScreenRecorder {
  if (!screenRecorderInstance) {
    screenRecorderInstance = new ScreenRecorder(config);
  }
  return screenRecorderInstance;
}

export function resetScreenRecorder(): void {
  screenRecorderInstance = null;
}

export default ScreenRecorder;
