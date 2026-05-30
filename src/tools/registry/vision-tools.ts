/**
 * Vision and Image Tool Adapters
 *
 * ITool-compliant adapters for OCR and Image Processing operations.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType, IToolExecutionContext } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import { OcrTool } from '../vision/ocr-tool.js';
import { ImageProcessorTool } from '../vision/image-processor.js';
import {
  analyzeVisionImage,
  type VisionAnalysisOptions,
} from '../vision/vision-analysis.js';
import { captureCameraSnapshot } from '../../companion/camera.js';
import { BrowserExecuteTool } from './misc-tools.js';

// ============================================================================
// VisionAnalyzeTool (Hermes vision_analyze parity)
// ============================================================================

export class VisionAnalyzeTool implements ITool {
  readonly name = 'vision_analyze';
  readonly description = 'Analyze a local image with real metadata, color, and optional local OCR evidence.';

  constructor(private readonly options: VisionAnalysisOptions = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await analyzeVisionImage(requiredString(input, 'image_path'), {
        ...this.options,
        rootDir: this.options.rootDir ?? context?.cwd,
        includeOcr: input.include_ocr === true,
        ocrLanguage: optionalString(input, 'ocr_language') ?? 'eng',
        source: 'image',
      });
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Absolute or workspace-relative path to the image file to inspect.',
          },
          include_ocr: {
            type: 'boolean',
            description: 'Attempt local OCR and include the result or OCR error in the report. Default false.',
          },
          ocr_language: {
            type: 'string',
            description: 'OCR language code when include_ocr is true. Default eng.',
          },
        },
        required: ['image_path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.image_path !== 'string' || !data.image_path.trim()) {
      return { valid: false, errors: ['image_path is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['vision', 'image', 'analyze', 'metadata', 'ocr', 'hermes'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// BrowserVisionTool (Hermes browser_vision parity)
// ============================================================================

export class BrowserVisionTool implements ITool {
  readonly name = 'browser_vision';
  readonly description = 'Capture the active browser page and analyze the screenshot with local vision evidence.';

  private readonly browser = new BrowserExecuteTool();

  constructor(private readonly options: VisionAnalysisOptions = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const rootDir = path.resolve(this.options.rootDir ?? context?.cwd ?? process.cwd());
      const url = optionalString(input, 'url');
      const launched = await this.browser.execute({
        action: 'launch',
        headless: input.headless !== false,
      });
      if (!launched.success) return launched;

      if (url) {
        const navigated = await this.browser.execute({
          action: 'navigate',
          url,
          waitUntil: optionalString(input, 'wait_until') ?? 'domcontentloaded',
          timeout: typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined,
        });
        if (!navigated.success) return navigated;
      }

      const screenshotDir = path.join(rootDir, '.codebuddy', 'browser-vision');
      await fs.mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(
        screenshotDir,
        `browser-vision-${sanitizeFilename(this.options.createId?.() ?? String(Date.now()))}.png`,
      );

      const screenshot = await this.browser.execute({
        action: 'screenshot',
        fullPage: input.full_page === true,
        format: 'png',
        outputPath: screenshotPath,
      });
      if (!screenshot.success) return screenshot;

      const analysis = await analyzeVisionImage(screenshotPath, {
        ...this.options,
        rootDir,
        includeOcr: input.include_ocr === true,
        ocrLanguage: optionalString(input, 'ocr_language') ?? 'eng',
        source: 'browser_screenshot',
        sourceUrl: url,
        reportPrefix: 'browser-vision',
      });

      let snapshot: string | undefined;
      if (input.include_snapshot !== false) {
        const snap = await this.browser.execute({
          action: 'snapshot',
          interactiveOnly: input.interactive_only === true,
          maxElements: typeof input.max_elements === 'number' ? input.max_elements : 80,
        });
        if (snap.success) {
          snapshot = snap.output;
        }
      }

      const result = {
        kind: 'browser_vision_result',
        ok: true,
        url,
        screenshotPath,
        analysis,
        ...(snapshot ? { snapshot } : {}),
      };

      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Optional URL to navigate before capture. Supports file:, data:, http:, and https: through the browser tool.',
          },
          full_page: {
            type: 'boolean',
            description: 'Capture the full page instead of the viewport. Default false.',
          },
          include_snapshot: {
            type: 'boolean',
            description: 'Include an accessibility snapshot alongside image evidence. Default true.',
          },
          include_ocr: {
            type: 'boolean',
            description: 'Attempt local OCR on the screenshot. Default false.',
          },
          ocr_language: {
            type: 'string',
            description: 'OCR language code when include_ocr is true. Default eng.',
          },
          headless: {
            type: 'boolean',
            description: 'Run the Playwright browser headless. Default true.',
          },
          wait_until: {
            type: 'string',
            enum: ['load', 'domcontentloaded', 'networkidle'],
            description: 'Navigation completion condition when url is provided. Default domcontentloaded.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Navigation timeout in milliseconds.',
          },
          max_elements: {
            type: 'number',
            description: 'Maximum elements to include in the optional snapshot.',
          },
          interactive_only: {
            type: 'boolean',
            description: 'Limit the optional snapshot to interactive elements only. Default false.',
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'vision', 'screenshot', 'analyze', 'playwright', 'hermes'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean { return true; }

  async dispose(): Promise<void> {
    await this.browser.execute({ action: 'close' }).catch(() => undefined);
    await this.browser.dispose?.();
  }
}

// ============================================================================
// OcrExtractTool
// ============================================================================

export class OcrExtractTool implements ITool {
  readonly name = 'ocr_extract';
  readonly description = 'Extract text from an image file using Tesseract OCR.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const imagePath = input.image_path as string;
    const language = input.language as string || 'eng';

    try {
      const ocr = OcrTool.getInstance();
      const text = await ocr.extractText(imagePath, language);
      return { success: true, output: text || '[No text found in image]' };
    } catch (error) {
      return { success: false, error: `OCR extraction failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Absolute or relative path to the image file',
          },
          language: {
            type: 'string',
            description: 'Language code for OCR (default: "eng")',
            default: 'eng',
          },
        },
        required: ['image_path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    if (typeof data?.image_path !== 'string' || data.image_path.trim() === '') {
      return { valid: false, errors: ['image_path is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'vision' as ToolCategoryType,
      keywords: ['ocr', 'text', 'extract', 'image', 'read', 'vision'],
      priority: 6,
      modifiesFiles: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ImageAnalyzeTool
// ============================================================================

export class ImageAnalyzeTool implements ITool {
  readonly name = 'image_analyze';
  readonly description = 'Analyze an image to get dimensions, format, and metadata.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const imagePath = input.image_path as string;

    try {
      const processor = ImageProcessorTool.getInstance();
      const analysis = await processor.analyze(imagePath);
      return { success: true, output: JSON.stringify(analysis, null, 2) };
    } catch (error) {
      return { success: false, error: `Image analysis failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Path to the image file',
          },
        },
        required: ['image_path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown>;
    if (typeof data?.image_path !== 'string') {
      return { valid: false, errors: ['image_path is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'vision' as ToolCategoryType,
      keywords: ['image', 'analyze', 'metadata', 'dimensions', 'format'],
      priority: 6,
      modifiesFiles: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// CameraSnapshotTool
// ============================================================================

export class CameraSnapshotTool implements ITool {
  readonly name = 'camera_snapshot';
  readonly description = 'Capture one local webcam frame to an image file for Buddy companion vision. Requires ffmpeg and OS camera permission.';

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const result = await captureCameraSnapshot({
      cwd: context?.cwd,
      outputPath: input.output_path as string | undefined,
      device: input.device as string | undefined,
      timeoutMs: input.timeout_ms as number | undefined,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Camera snapshot failed',
        output: result.command,
      };
    }

    return {
      success: true,
      output: JSON.stringify({
        path: result.path,
        command: result.command,
        percept_id: result.perceptId,
        percept_store: result.perceptPath,
        note: 'Use image analysis, OCR, or a multimodal model turn to inspect this frame.',
      }, null, 2),
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          output_path: {
            type: 'string',
            description: 'Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace.',
          },
          device: {
            type: 'string',
            description: 'Optional ffmpeg camera device. Windows example: video=Integrated Camera; macOS example: 0; Linux example: /dev/video0.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Capture timeout in milliseconds (default: 10000).',
            minimum: 1000,
            maximum: 60000,
          },
        },
        required: [],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const data = input as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return { valid: true };
    if (data.output_path !== undefined && typeof data.output_path !== 'string') {
      return { valid: false, errors: ['output_path must be a string'] };
    }
    if (data.device !== undefined && typeof data.device !== 'string') {
      return { valid: false, errors: ['device must be a string'] };
    }
    if (data.timeout_ms !== undefined && typeof data.timeout_ms !== 'number') {
      return { valid: false, errors: ['timeout_ms must be a number'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['camera', 'webcam', 'snapshot', 'photo', 'vision', 'see', 'look', 'companion'],
      priority: 7,
      modifiesFiles: true,
      requiresConfirmation: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createVisionTools(options: VisionAnalysisOptions = {}): ITool[] {
  return [
    new VisionAnalyzeTool(options),
    new BrowserVisionTool(options),
    new OcrExtractTool(),
    new ImageAnalyzeTool(),
    new CameraSnapshotTool(),
  ];
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = optionalString(data, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeFilename(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || String(Date.now());
}
