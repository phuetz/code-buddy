import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import path from 'path';
import { spawn as defaultSpawn, execSync as defaultExecSync } from 'child_process';
import { ToolResult, getErrorMessage } from '../types/index.js';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

type TesseractJsLoader = () => Promise<{
  createWorker: (language?: string) => Promise<{
    recognize: (imagePath: string) => Promise<{
      data: { text?: string; confidence?: number; words?: unknown[] };
    }>;
    terminate: () => Promise<void>;
  }>;
}>;

export interface OCRResult {
  text: string;
  confidence?: number;
  language?: string;
  blocks?: OCRBlock[];
  processingTime?: number;
}

export interface OCRBlock {
  text: string;
  confidence?: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OCROptions {
  language?: string; // e.g., 'eng', 'fra', 'deu', 'jpn'
  psm?: number; // Page segmentation mode (0-13)
  oem?: number; // OCR Engine mode (0-3)
  dpi?: number; // Image DPI for processing
}

/**
 * OCR Tool for extracting text from images
 * Uses Tesseract OCR as the backend (must be installed on system)
 * Falls back to basic image analysis if Tesseract is not available
 */
export interface OCRToolOptions {
  /**
   * Host platform driving the engine cascade (default `process.platform`).
   * Injected so tests of the Tesseract CLI path can skip engine 1 — the
   * Windows-native PowerShell OCR shells out for real (dynamic
   * `import('child_process')` escapes the static mock) and would race them.
   */
  platform?: NodeJS.Platform;
  /**
   * Injected `spawn`. Tests pass a fake so the Tesseract CLI path never
   * depends on a host `tesseract` binary being present or absent.
   */
  spawn?: typeof defaultSpawn;
  /**
   * Injected `execSync`. Same reason: `tesseract --version` / `which convert`
   * must not silently consult PATH.
   */
  execSync?: typeof defaultExecSync;
  /**
   * Override the dynamic `import('tesseract.js')`. Tests supply a rejecting
   * stub so engine 2 fails on a microtask instead of loading WASM.
   */
  loadTesseractJs?: TesseractJsLoader;
}

export class OCRTool {
  private readonly supportedFormats = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
  private readonly maxFileSizeMB = 50;
  private tesseractAvailable: boolean | null = null;
  private vfs = UnifiedVfsRouter.Instance;
  private readonly platform: NodeJS.Platform;
  private readonly spawnImpl: typeof defaultSpawn;
  private readonly execSyncImpl: typeof defaultExecSync;
  private readonly loadTesseractJs: TesseractJsLoader;

  constructor(options: OCRToolOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnImpl = options.spawn ?? defaultSpawn;
    this.execSyncImpl = options.execSync ?? defaultExecSync;
    this.loadTesseractJs = options.loadTesseractJs
      ?? (async () => import('tesseract.js') as unknown as Awaited<ReturnType<TesseractJsLoader>>);
  }

  /**
   * Perform OCR on an image file
   */
  async extractText(filePath: string, options: OCROptions = {}): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(process.cwd(), filePath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Image file not found: ${filePath}`
        };
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      if (!this.supportedFormats.includes(ext)) {
        return {
          success: false,
          error: `Unsupported image format: ${ext}. Supported: ${this.supportedFormats.join(', ')}`
        };
      }

      const stats = await this.vfs.stat(resolvedPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > this.maxFileSizeMB) {
        return {
          success: false,
          error: `Image file too large: ${fileSizeMB.toFixed(2)}MB. Max: ${this.maxFileSizeMB}MB`
        };
      }

      // Cascade order:
      // 1. Try Windows Runtime OCR if on Windows
      if (this.platform === 'win32') {
        const winResult = await this.runWindowsNativeOCR(resolvedPath);
        if (winResult.success) {
          return winResult;
        }
        logger.debug('Windows-native OCR failed, trying Tesseract.js fallback', { error: winResult.error });
      }

      // 2. Try Tesseract.js (WASM) - local zero-dependency
      const wasmResult = await this.runTesseractJS(resolvedPath, options);
      if (wasmResult.success) {
        return wasmResult;
      }
      logger.debug('Tesseract.js OCR failed, trying Tesseract CLI fallback', { error: wasmResult.error });

      // 3. Try Tesseract CLI (legacy binaire)
      const hasTesseract = await this.checkTesseract();
      if (hasTesseract) {
        return await this.runTesseract(resolvedPath, options);
      }

      // 4. Try Cloud Vision API
      const { resolveActiveProviderApiKey } = await import('../config/env-schema.js');
      const apiKey = resolveActiveProviderApiKey();
      if (apiKey) {
        return await this.runVisionOCR(resolvedPath, apiKey);
      }

      return {
        success: false,
        error: 'All OCR engines failed or were unavailable (Windows OCR failed, Tesseract.js failed, Tesseract CLI not found, and no API keys configured).'
      };
    } catch (error) {
      return {
        success: false,
        error: `OCR failed: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Check if Tesseract is available
   */
  private async checkTesseract(): Promise<boolean> {
    if (this.tesseractAvailable !== null) {
      return this.tesseractAvailable;
    }

    try {
      this.execSyncImpl('tesseract --version', { stdio: 'ignore' });
      this.tesseractAvailable = true;
    } catch {
      this.tesseractAvailable = false;
    }

    return this.tesseractAvailable;
  }

  /**
   * Run Tesseract OCR
   */
  private async runTesseract(imagePath: string, options: OCROptions): Promise<ToolResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const args: string[] = [imagePath, 'stdout'];

      // Add language option
      if (options.language) {
        args.push('-l', options.language);
      }

      // Add page segmentation mode
      if (options.psm !== undefined) {
        args.push('--psm', options.psm.toString());
      }

      // Add OCR engine mode
      if (options.oem !== undefined) {
        args.push('--oem', options.oem.toString());
      }

      // Add DPI option
      if (options.dpi) {
        args.push('--dpi', options.dpi.toString());
      }

      // Request TSV output for confidence scores
      args.push('-c', 'tessedit_create_tsv=1');

      const tesseract = this.spawnImpl('tesseract', args);

      let stdout = '';
      let stderr = '';

      tesseract.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      tesseract.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      tesseract.on('close', (code) => {
        const processingTime = Date.now() - startTime;

        if (code !== 0) {
          resolve({
            success: false,
            error: `Tesseract exited with code ${code}: ${stderr}`
          });
          return;
        }

        // Parse TSV output for confidence scores
        const { text, blocks, avgConfidence } = this.parseTesseractTSV(stdout);

        const result: OCRResult = {
          text,
          confidence: avgConfidence,
          language: options.language || 'eng',
          blocks,
          processingTime
        };

        resolve({
          success: true,
          output: this.formatOutput(result, imagePath),
          data: result
        });
      });

      tesseract.on('error', (err) => {
        resolve({
          success: false,
          error: `Tesseract error: ${err.message}`
        });
      });
    });
  }

  /**
   * Parse Tesseract TSV output
   */
  private parseTesseractTSV(tsv: string): { text: string; blocks: OCRBlock[]; avgConfidence: number } {
    const lines = tsv.split('\n');
    const blocks: OCRBlock[] = [];
    const words: string[] = [];
    let totalConfidence = 0;
    let wordCount = 0;

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const parts = line.split('\t');
      if (parts.length >= 12) {
        // parts[0..11] are present because parts.length >= 12 was checked above
        const level = parseInt(parts[0] ?? ''); // safe: length >= 12 guarantees index 0
        const conf = parseFloat(parts[10] ?? ''); // safe: length >= 12 guarantees index 10
        const text = parts[11]?.trim();

        if (level === 5 && text) { // Word level
          words.push(text);
          if (conf > 0) {
            totalConfidence += conf;
            wordCount++;
          }

          blocks.push({
            text,
            confidence: conf,
            boundingBox: {
              // parts[6..9] are present because parts.length >= 12 was checked above
              x: parseInt(parts[6] ?? ''), // safe: length >= 12 guarantees index 6
              y: parseInt(parts[7] ?? ''), // safe: length >= 12 guarantees index 7
              width: parseInt(parts[8] ?? ''), // safe: length >= 12 guarantees index 8
              height: parseInt(parts[9] ?? '') // safe: length >= 12 guarantees index 9
            }
          });
        }
      }
    }

    return {
      text: words.join(' '),
      blocks,
      avgConfidence: wordCount > 0 ? Math.round(totalConfidence / wordCount) : 0
    };
  }

  /**
   * Run OCR using vision API (OpenAI or similar)
   */
  private async runVisionOCR(imagePath: string, apiKey: string): Promise<ToolResult> {
    const axios = (await import('axios')).default;

    // Read image and convert to base64
    const buffer = await this.vfs.readFileBuffer(imagePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

    try {
      const startTime = Date.now();

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Extract all text from this image. Return ONLY the extracted text, preserving the original layout and formatting as much as possible. Do not include any explanations or comments.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mediaType};base64,${base64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 4096
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      const text = response.data.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      const result: OCRResult = {
        text,
        processingTime
      };

      return {
        success: true,
        output: this.formatOutput(result, imagePath),
        data: result
      };
    } catch (error) {
      const errorMsg = (error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message || getErrorMessage(error);
      return {
        success: false,
        error: `Vision OCR failed: ${errorMsg}`
      };
    }
  }

  /**
   * List available Tesseract languages
   */
  async listLanguages(): Promise<ToolResult> {
    try {
      const hasTesseract = await this.checkTesseract();
      if (!hasTesseract) {
        return {
          success: false,
          error: 'Tesseract not installed'
        };
      }

      const output = this.execSyncImpl('tesseract --list-langs', { encoding: 'utf8' });
      const lines = output.split('\n').slice(1).filter(l => l.trim());

      return {
        success: true,
        output: `Available OCR languages:\n${lines.map(l => `  - ${l}`).join('\n')}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list languages: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Batch OCR multiple images
   */
  async batchOCR(filePaths: string[], options: OCROptions = {}): Promise<ToolResult> {
    // Process OCR in parallel for better performance
    const ocrResults = await Promise.allSettled(
      filePaths.map(async filePath => {
        const result = await this.extractText(filePath, options);
        return { filePath, result };
      })
    );

    const results: { file: string; text?: string; error?: string }[] = ocrResults.map((outcome, index) => {
      // index is always within bounds: ocrResults is mapped 1:1 from filePaths
      const filePath = filePaths[index] ?? '';
      if (outcome.status === 'fulfilled') {
        const { result } = outcome.value;
        if (result.success) {
          return { file: filePath, text: (result.data as { text?: string })?.text };
        } else {
          return { file: filePath, error: result.error };
        }
      } else {
        return { file: filePath, error: String(outcome.reason) };
      }
    });

    const successCount = results.filter(r => r.text).length;

    return {
      success: true,
      output: `Batch OCR completed: ${successCount}/${filePaths.length} successful\n\n` +
        results.map(r => `${r.file}: ${r.error || `${r.text?.slice(0, 100)}...`}`).join('\n'),
      data: results
    };
  }

  /**
   * OCR a specific region of an image
   */
  async extractRegion(
    filePath: string,
    region: { x: number; y: number; width: number; height: number },
    options: OCROptions = {}
  ): Promise<ToolResult> {
    // For region extraction, we need ImageMagick to crop first
    try {
      this.execSyncImpl('which convert', { stdio: 'ignore' });
    } catch {
      return {
        success: false,
        error: 'ImageMagick is required for region extraction. Install with: sudo apt install imagemagick'
      };
    }

    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!await this.vfs.exists(resolvedPath)) {
      return {
        success: false,
        error: `Image not found: ${filePath}`
      };
    }

    const tempPath = path.join(process.cwd(), '.codebuddy', 'temp', `ocr_region_${Date.now()}.png`);
    await this.vfs.ensureDir(path.dirname(tempPath));

    try {
      // Crop the region using ImageMagick
      this.execSyncImpl(
        `convert "${resolvedPath}" -crop ${region.width}x${region.height}+${region.x}+${region.y} "${tempPath}"`
      );

      const result = await this.extractText(tempPath, options);

      // Clean up temp file
      if (await this.vfs.exists(tempPath)) {
        await this.vfs.remove(tempPath);
      }

      return result;
    } catch (error) {
      if (await this.vfs.exists(tempPath)) {
        await this.vfs.remove(tempPath);
      }
      return {
        success: false,
        error: `Region extraction failed: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Format OCR output for display
   */
  private formatOutput(result: OCRResult, filePath: string): string {
    const lines = [
      `🔍 OCR: ${path.basename(filePath)}`
    ];

    if (result.confidence !== undefined) {
      lines.push(`   Confidence: ${result.confidence}%`);
    }
    if (result.language) {
      lines.push(`   Language: ${result.language}`);
    }
    if (result.processingTime) {
      lines.push(`   Processing time: ${result.processingTime}ms`);
    }

    lines.push('');
    lines.push('--- Extracted Text ---');
    lines.push(result.text || '[No text detected]');

    return lines.join('\n');
  }

  /**
   * Run Windows-native OCR using Windows.Media.Ocr WinRT API via PowerShell wrapper
   */
  private async runWindowsNativeOCR(imagePath: string): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const scriptPath = path.join(__dirname, 'win-ocr.ps1');

      const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -ImagePath "${imagePath}"`;
      const { stdout } = await execAsync(cmd, { timeout: 15000 });

      const parsed = JSON.parse(stdout.trim());
      if (parsed.success) {
        const result: OCRResult = {
          text: parsed.text,
          blocks: parsed.blocks,
          processingTime: Date.now() - startTime
        };
        return {
          success: true,
          output: this.formatOutput(result, imagePath),
          data: result
        };
      } else {
        return { success: false, error: parsed.error || 'Unknown Windows OCR error' };
      }
    } catch (err) {
      return { success: false, error: `Windows-native OCR failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Run local Tesseract.js (WebAssembly) OCR inside Node process
   */
  private async runTesseractJS(imagePath: string, options: OCROptions): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { createWorker } = await this.loadTesseractJs();
      const worker = await createWorker(options.language || 'eng');
      
      const { data } = await worker.recognize(imagePath);
      await worker.terminate();

      const blocks: OCRBlock[] = ((data as any).words || []).map((w: any) => ({
        text: w.text,
        confidence: w.confidence,
        boundingBox: w.bbox ? {
          x: w.bbox.x0,
          y: w.bbox.y0,
          width: w.bbox.x1 - w.bbox.x0,
          height: w.bbox.y1 - w.bbox.y0
        } : undefined
      }));

      const result: OCRResult = {
        text: data.text ?? '',
        confidence: data.confidence,
        language: options.language || 'eng',
        blocks,
        processingTime: Date.now() - startTime
      };

      return {
        success: true,
        output: this.formatOutput(result, imagePath),
        data: result
      };
    } catch (err) {
      return { success: false, error: `Tesseract.js failed: ${getErrorMessage(err)}` };
    }
  }

  /**
   * Check if file is a supported image format
   */
  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }
}
