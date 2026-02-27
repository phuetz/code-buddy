/**
 * Multimodal Input Support
 *
 * Enables image and screenshot input for AI analysis:
 * - Screenshot capture
 * - Image file analysis
 * - Clipboard image paste
 * - OCR extraction
 * - Visual debugging
 *
 * Inspired by Gemini CLI's multimodal capabilities.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { TIMEOUT_CONFIG, LIMIT_CONFIG } from '../config/constants.js';

// ============================================================================
// Types
// ============================================================================

export interface ImageInput {
  /** Image ID */
  id: string;
  /** Source type */
  source: 'file' | 'screenshot' | 'clipboard' | 'url';
  /** Original path or URL */
  path?: string;
  /** Local file path (after download/capture) */
  localPath: string;
  /** MIME type */
  mimeType: string;
  /** Base64 encoded data */
  base64?: string;
  /** Image dimensions */
  dimensions?: {
    width: number;
    height: number;
  };
  /** File size in bytes */
  size: number;
  /** Created timestamp */
  createdAt: number;
  /** Optional description */
  description?: string;
}

export interface ScreenshotOptions {
  /** Capture full screen or selection */
  mode: 'fullscreen' | 'selection' | 'window';
  /** Delay before capture (ms) */
  delay?: number;
  /** Output format */
  format?: 'png' | 'jpg';
  /** Include cursor */
  includeCursor?: boolean;
  /** Specific display/monitor */
  display?: number;
}

export interface OCRResult {
  text: string;
  confidence?: number;
  regions?: Array<{
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
}

export interface MultimodalConfig {
  /** Temporary storage directory */
  tempDir: string;
  /** Maximum image size (bytes) */
  maxImageSize: number;
  /** Supported formats */
  supportedFormats: string[];
  /** Enable OCR */
  ocrEnabled: boolean;
  /** OCR language */
  ocrLanguage: string;
  /** Auto-resize large images */
  autoResize: boolean;
  /** Max dimension for auto-resize */
  maxDimension: number;
}

export interface MultimodalCapabilities {
  /** Screenshot available */
  screenshotAvailable: boolean;
  /** Clipboard available */
  clipboardAvailable: boolean;
  /** OCR available */
  ocrAvailable: boolean;
  /** Image processing available */
  imageProcessingAvailable: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MultimodalConfig = {
  tempDir: path.join(os.tmpdir(), 'grok-multimodal'),
  maxImageSize: LIMIT_CONFIG.DEFAULT_MAX_IMAGE_SIZE,
  supportedFormats: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'],
  ocrEnabled: true,
  ocrLanguage: 'eng',
  autoResize: true,
  maxDimension: LIMIT_CONFIG.DEFAULT_MAX_IMAGE_DIMENSION,
};

// ============================================================================
// Multimodal Input Manager
// ============================================================================

export class MultimodalInputManager extends EventEmitter {
  private config: MultimodalConfig;
  private images: Map<string, ImageInput> = new Map();
  private capabilities: MultimodalCapabilities | null = null;

  constructor(config: Partial<MultimodalConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure temp directory exists
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
  }

  /**
   * Initialize and detect capabilities
   */
  async initialize(): Promise<MultimodalCapabilities> {
    if (this.capabilities) {
      return this.capabilities;
    }

    const capabilities: MultimodalCapabilities = {
      screenshotAvailable: false,
      clipboardAvailable: false,
      ocrAvailable: false,
      imageProcessingAvailable: false,
    };

    const platform = os.platform();

    // Check screenshot capabilities
    if (platform === 'darwin') {
      capabilities.screenshotAvailable = await this.checkCommand('screencapture', ['-h']);
    } else if (platform === 'linux') {
      const hasScrot = await this.checkCommand('scrot', ['--version']);
      const hasGnomeScreenshot = await this.checkCommand('gnome-screenshot', ['--version']);
      const hasImport = await this.checkCommand('import', ['-version']);
      capabilities.screenshotAvailable = hasScrot || hasGnomeScreenshot || hasImport;
    } else if (platform === 'win32') {
      // Windows has built-in screenshot with Snipper
      capabilities.screenshotAvailable = true;
    }

    // Check clipboard capabilities
    if (platform === 'darwin') {
      capabilities.clipboardAvailable = await this.checkCommand('pbpaste', ['--help']);
    } else if (platform === 'linux') {
      const hasXclip = await this.checkCommand('xclip', ['-version']);
      const hasWlPaste = await this.checkCommand('wl-paste', ['--version']);
      capabilities.clipboardAvailable = hasXclip || hasWlPaste;
    } else if (platform === 'win32') {
      capabilities.clipboardAvailable = true;
    }

    // Check OCR capabilities
    const hasTesseract = await this.checkCommand('tesseract', ['--version']);
    capabilities.ocrAvailable = hasTesseract;

    // Check image processing
    const hasImageMagick = await this.checkCommand('convert', ['--version']);
    const hasSharp = true; // Assume sharp npm package might be available
    capabilities.imageProcessingAvailable = hasImageMagick || hasSharp;

    this.capabilities = capabilities;
    this.emit('initialized', capabilities);
    return capabilities;
  }

  /**
   * Capture screenshot
   */
  async captureScreenshot(options: Partial<ScreenshotOptions> = {}): Promise<ImageInput> {
    const opts: ScreenshotOptions = {
      mode: 'fullscreen',
      format: 'png',
      includeCursor: false,
      delay: 0,
      ...options,
    };

    await this.initialize();

    if (!this.capabilities?.screenshotAvailable) {
      throw new Error('Screenshot capture is not available on this system');
    }

    const outputPath = path.join(
      this.config.tempDir,
      `screenshot-${Date.now()}.${opts.format}`
    );

    const platform = os.platform();

    try {
      if (platform === 'darwin') {
        await this.captureScreenshotMacOS(outputPath, opts);
      } else if (platform === 'linux') {
        await this.captureScreenshotLinux(outputPath, opts);
      } else if (platform === 'win32') {
        await this.captureScreenshotWindows(outputPath, opts);
      }

      return this.loadImageFile(outputPath, 'screenshot');
    } catch (error) {
      throw new Error(`Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load image from file
   */
  async loadImageFile(filePath: string, source: ImageInput['source'] = 'file'): Promise<ImageInput> {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.size > this.config.maxImageSize) {
      throw new Error(`Image too large: ${stats.size} bytes (max: ${this.config.maxImageSize})`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!this.config.supportedFormats.includes(ext)) {
      throw new Error(`Unsupported format: ${ext}`);
    }

    const mimeType = this.getMimeType(ext);
    const data = fs.readFileSync(resolvedPath);
    const base64 = data.toString('base64');
    const dimensions = await this.getImageDimensions(resolvedPath);

    const id = this.generateId();

    const image: ImageInput = {
      id,
      source,
      path: filePath,
      localPath: resolvedPath,
      mimeType,
      base64,
      dimensions,
      size: stats.size,
      createdAt: Date.now(),
    };

    this.images.set(id, image);
    this.emit('image:loaded', image);

    return image;
  }

  /**
   * Load image from URL
   */
  async loadImageFromURL(url: string): Promise<ImageInput> {
    const outputPath = path.join(
      this.config.tempDir,
      `download-${Date.now()}${this.getExtensionFromURL(url)}`
    );

    try {
      // Download using curl
      await this.execCommand('curl', ['-L', '-o', outputPath, url], TIMEOUT_CONFIG.DEFAULT_DOWNLOAD_TIMEOUT);

      const image = await this.loadImageFile(outputPath, 'url');
      image.path = url;

      return image;
    } catch (error) {
      throw new Error(`Failed to download image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load image from clipboard
   */
  async loadFromClipboard(): Promise<ImageInput> {
    await this.initialize();

    if (!this.capabilities?.clipboardAvailable) {
      throw new Error('Clipboard access is not available');
    }

    const outputPath = path.join(this.config.tempDir, `clipboard-${Date.now()}.png`);
    const platform = os.platform();

    try {
      if (platform === 'darwin') {
        await this.execCommand('osascript', [
          '-e',
          `tell application "System Events" to write (the clipboard as «class PNGf») to (open for access "${outputPath}" with write permission)`,
        ]);
      } else if (platform === 'linux') {
        const hasXclip = await this.checkCommand('xclip', ['-version']);
        if (hasXclip) {
          await this.execCommand('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o', '>', outputPath]);
        } else {
          await this.execCommand('wl-paste', ['--type', 'image/png', '>', outputPath]);
        }
      }

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('No image found in clipboard');
      }

      return this.loadImageFile(outputPath, 'clipboard');
    } catch (error) {
      throw new Error(`Failed to get clipboard image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Perform OCR on image
   */
  async performOCR(imageId: string): Promise<OCRResult> {
    const image = this.images.get(imageId);
    if (!image) {
      throw new Error(`Image not found: ${imageId}`);
    }

    await this.initialize();

    if (!this.capabilities?.ocrAvailable) {
      throw new Error('OCR is not available. Install Tesseract OCR.');
    }

    try {
      const result = await this.execCommand('tesseract', [
        image.localPath,
        'stdout',
        '-l', this.config.ocrLanguage,
      ], TIMEOUT_CONFIG.DEFAULT_DOWNLOAD_TIMEOUT);

      return {
        text: result.trim(),
        confidence: undefined,
      };
    } catch (error) {
      throw new Error(`OCR failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get image by ID
   */
  getImage(id: string): ImageInput | undefined {
    return this.images.get(id);
  }

  /**
   * Get all images
   */
  getAllImages(): ImageInput[] {
    return Array.from(this.images.values());
  }

  /**
   * Remove image
   */
  removeImage(id: string): boolean {
    const image = this.images.get(id);
    if (!image) return false;

    // Clean up temp file if it's ours
    if (image.localPath.startsWith(this.config.tempDir)) {
      try {
        fs.unlinkSync(image.localPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    this.images.delete(id);
    this.emit('image:removed', { id });
    return true;
  }

  /**
   * Clear all images
   */
  clearAll(): void {
    for (const id of this.images.keys()) {
      this.removeImage(id);
    }
  }

  /**
   * Prepare image for API (resize if needed, convert to base64)
   */
  async prepareForAPI(imageId: string): Promise<{
    base64: string;
    mimeType: string;
  }> {
    const image = this.images.get(imageId);
    if (!image) {
      throw new Error(`Image not found: ${imageId}`);
    }

    // Check if resize needed
    if (this.config.autoResize && image.dimensions) {
      const { width, height } = image.dimensions;
      if (width > this.config.maxDimension || height > this.config.maxDimension) {
        const resized = await this.resizeImage(image.localPath);
        const data = fs.readFileSync(resized);
        return {
          base64: data.toString('base64'),
          mimeType: image.mimeType,
        };
      }
    }

    return {
      base64: image.base64 || fs.readFileSync(image.localPath).toString('base64'),
      mimeType: image.mimeType,
    };
  }

  /**
   * Format images summary
   */
  formatSummary(): string {
    const images = this.getAllImages();
    const lines: string[] = [
      '🖼️ Multimodal Images',
      '═'.repeat(40),
      '',
    ];

    if (images.length === 0) {
      lines.push('No images loaded.');
      lines.push('');
      lines.push('Commands:');
      lines.push('  /image load <path>    - Load image file');
      lines.push('  /image screenshot     - Capture screenshot');
      lines.push('  /image clipboard      - Load from clipboard');
      lines.push('  /image url <url>      - Load from URL');
      lines.push('  /image ocr <id>       - Extract text (OCR)');
    } else {
      lines.push(`Loaded: ${images.length} image(s)`);
      lines.push('');

      for (const img of images) {
        const sizeKB = Math.round(img.size / 1024);
        const dims = img.dimensions
          ? `${img.dimensions.width}x${img.dimensions.height}`
          : 'unknown';
        lines.push(`📷 ${img.id.slice(0, 8)}`);
        lines.push(`   Source: ${img.source}`);
        lines.push(`   Size: ${sizeKB}KB, ${dims}`);
        if (img.description) {
          lines.push(`   Desc: ${img.description}`);
        }
        lines.push('');
      }
    }

    if (this.capabilities) {
      lines.push('Capabilities:');
      lines.push(`  Screenshot: ${this.capabilities.screenshotAvailable ? '✓' : '✗'}`);
      lines.push(`  Clipboard: ${this.capabilities.clipboardAvailable ? '✓' : '✗'}`);
      lines.push(`  OCR: ${this.capabilities.ocrAvailable ? '✓' : '✗'}`);
      lines.push(`  Processing: ${this.capabilities.imageProcessingAvailable ? '✓' : '✗'}`);
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async captureScreenshotMacOS(outputPath: string, opts: ScreenshotOptions): Promise<void> {
    const args: string[] = [];

    if (opts.mode === 'selection') {
      args.push('-i'); // Interactive selection
    } else if (opts.mode === 'window') {
      args.push('-w'); // Window selection
    }

    if (opts.includeCursor) {
      args.push('-C');
    }

    if (opts.delay && opts.delay > 0) {
      args.push('-T', String(Math.ceil(opts.delay / 1000)));
    }

    if (opts.format === 'jpg') {
      args.push('-t', 'jpg');
    }

    args.push(outputPath);

    await this.execCommand('screencapture', args, TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT);
  }

  private async captureScreenshotLinux(outputPath: string, opts: ScreenshotOptions): Promise<void> {
    // Try different screenshot tools
    const hasScrot = await this.checkCommand('scrot', ['--version']);

    if (hasScrot) {
      const args: string[] = [];

      if (opts.mode === 'selection') {
        args.push('-s');
      } else if (opts.mode === 'window') {
        args.push('-u');
      }

      if (opts.delay && opts.delay > 0) {
        args.push('-d', String(Math.ceil(opts.delay / 1000)));
      }

      args.push(outputPath);

      await this.execCommand('scrot', args, TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT);
      return;
    }

    const hasGnomeScreenshot = await this.checkCommand('gnome-screenshot', ['--version']);

    if (hasGnomeScreenshot) {
      const args: string[] = ['-f', outputPath];

      if (opts.mode === 'selection') {
        args.push('-a');
      } else if (opts.mode === 'window') {
        args.push('-w');
      }

      if (opts.delay && opts.delay > 0) {
        args.push('-d', String(Math.ceil(opts.delay / 1000)));
      }

      await this.execCommand('gnome-screenshot', args, TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT);
      return;
    }

    // Fallback to import (ImageMagick)
    const args = ['import'];

    if (opts.mode !== 'selection') {
      args.push('-window', 'root');
    }

    args.push(outputPath);

    await this.execCommand('import', args, TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT);
  }

  private async captureScreenshotWindows(outputPath: string, _opts: ScreenshotOptions): Promise<void> {
    // Use PowerShell to capture screenshot
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object {
        $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size)
        $bitmap.Save("${outputPath.replace(/\\/g, '\\\\')}")
      }
    `;

    await this.execCommand('powershell', ['-Command', script], TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT);
  }

  private async getImageDimensions(filePath: string): Promise<{ width: number; height: number } | undefined> {
    try {
      // Try using ImageMagick identify
      const result = await this.execCommand('identify', ['-format', '%wx%h', filePath], 5000);
      const [width, height] = result.trim().split('x').map(Number);
      if (width && height) {
        return { width, height };
      }
    } catch {
      // Fallback: try reading PNG header
      try {
        const buffer = fs.readFileSync(filePath);
        if (buffer[0] === 0x89 && buffer[1] === 0x50) {
          // PNG
          const width = buffer.readUInt32BE(16);
          const height = buffer.readUInt32BE(20);
          return { width, height };
        }
      } catch {
        // Ignore
      }
    }
    return undefined;
  }

  private async resizeImage(inputPath: string): Promise<string> {
    const outputPath = path.join(
      this.config.tempDir,
      `resized-${Date.now()}${path.extname(inputPath)}`
    );

    try {
      await this.execCommand('convert', [
        inputPath,
        '-resize', `${this.config.maxDimension}x${this.config.maxDimension}>`,
        outputPath,
      ], TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT);
      return outputPath;
    } catch {
      // Return original if resize fails
      return inputPath;
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }

  private getExtensionFromURL(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname).toLowerCase();
      if (this.config.supportedFormats.includes(ext)) {
        return ext;
      }
    } catch {
      // Ignore URL parse errors
    }
    return '.png'; // Default to PNG
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private async checkCommand(command: string, args: string[]): Promise<boolean> {
    try {
      await this.execCommand(command, args, 5000);
      return true;
    } catch {
      return false;
    }
  }

  private execCommand(command: string, args: string[], timeout: number = TIMEOUT_CONFIG.DEFAULT_COMMAND_TIMEOUT): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Command timed out'));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    this.clearAll();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: MultimodalInputManager | null = null;

export function getMultimodalInputManager(config?: Partial<MultimodalConfig>): MultimodalInputManager {
  if (!managerInstance) {
    managerInstance = new MultimodalInputManager(config);
  }
  return managerInstance;
}

export function resetMultimodalInputManager(): void {
  if (managerInstance) {
    managerInstance.dispose();
  }
  managerInstance = null;
}
