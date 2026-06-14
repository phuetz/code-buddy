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
  type VisionAnalysisResult,
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

      const screenshot = await this.captureScreenshotWithRetry(input, screenshotPath);
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

  private async captureScreenshotWithRetry(
    input: Record<string, unknown>,
    screenshotPath: string
  ): Promise<ToolResult> {
    const fullPage = input.full_page === true;
    const baseInput = {
      action: 'screenshot',
      fullPage,
      format: 'png',
      outputPath: screenshotPath,
    };
    const first = await this.browser.execute(baseInput);
    if (first.success) return first;

    await delay(150);
    const second = await this.browser.execute(baseInput);
    if (second.success) return second;

    if (!fullPage) {
      await delay(150);
      const fullPageRetry = await this.browser.execute({
        ...baseInput,
        fullPage: true,
      });
      if (fullPageRetry.success) return fullPageRetry;

      return combineScreenshotFailures(first, second, fullPageRetry);
    }

    return combineScreenshotFailures(first, second);
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
// CameraAnalyzeTool — capture a webcam frame AND describe it with a vision model
// ============================================================================

export interface CameraAnalyzeRuntime {
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to companion captureCameraSnapshot. */
  captureSnapshot?: typeof captureCameraSnapshot;
  /** Injected for tests; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_CAMERA_VISION_MODEL = 'gemma4:12b';
const CAMERA_VISION_TIMEOUT_MS = 180_000;

export class CameraAnalyzeTool implements ITool {
  readonly name = 'camera_analyze';
  readonly description = 'Capture one local webcam frame and return a natural-language description from a local multimodal vision model (default Ollama gemma4:12b). Requires ffmpeg, OS camera permission, and a reachable local vision model.';

  constructor(
    private readonly options: VisionAnalysisOptions = {},
    private readonly runtime: CameraAnalyzeRuntime = {},
  ) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const cwd = this.options.rootDir ?? context?.cwd;
    const prompt = optionalString(input, 'prompt') ?? 'Describe what you see.';
    const model = optionalString(input, 'model') ?? DEFAULT_CAMERA_VISION_MODEL;
    const device = optionalString(input, 'device');
    const outputPath = optionalString(input, 'output_path');
    const includeOcr = input.include_ocr === true;

    // (1) Capture a frame from the local webcam.
    const captureSnapshot = this.runtime.captureSnapshot ?? captureCameraSnapshot;
    const snapshot = await captureSnapshot({
      cwd,
      ...(outputPath ? { outputPath } : {}),
      ...(device ? { device } : {}),
      timeoutMs: typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined,
    });

    if (!snapshot.success || !snapshot.path) {
      return {
        success: false,
        error: snapshot.error || 'Camera snapshot failed before analysis',
        output: snapshot.command,
      };
    }

    // (2) base64 the captured PNG into a data URL.
    let dataUrl: string;
    try {
      const bytes = await fs.readFile(snapshot.path);
      dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    } catch (error) {
      return {
        success: false,
        error: `Failed to read captured frame ${snapshot.path}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // (3) Make a REAL vision completion against the local Ollama /v1 endpoint.
    let description: string;
    try {
      description = await this.describeImage(model, prompt, dataUrl);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: `Captured frame saved to ${snapshot.path}, but the vision model could not describe it.`,
      };
    }

    // (4) Optionally add local metadata/OCR evidence.
    let ocr: VisionAnalysisResult['ocr'] | undefined;
    if (includeOcr) {
      try {
        const analysis = await analyzeVisionImage(snapshot.path, {
          ...this.options,
          rootDir: cwd,
          includeOcr: true,
          ocrLanguage: optionalString(input, 'ocr_language') ?? 'eng',
          source: 'image',
        });
        ocr = analysis.ocr;
      } catch {
        // OCR is best-effort evidence; never fail the description on OCR errors.
      }
    }

    // (5) Return the description text as the primary output.
    const data = {
      imagePath: snapshot.path,
      description,
      model,
      ...(ocr ? { ocr } : {}),
    };

    return {
      success: true,
      output: description,
      data,
    };
  }

  private async describeImage(model: string, prompt: string, dataUrl: string): Promise<string> {
    const fetchImpl = this.runtime.fetch ?? fetch;
    const endpoint = resolveOllamaChatEndpoint(this.runtime.env ?? process.env);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CAMERA_VISION_TIMEOUT_MS);

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
      // Read the body INSIDE the try so the abort timeout also covers a server
      // that sends headers then stalls the body (otherwise response.text() hangs).
      text = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (timedOut) {
        throw new Error(
          `Vision model ${model} timed out after ${CAMERA_VISION_TIMEOUT_MS}ms at ${endpoint}. ` +
            'A cold local model load can be slow; retry once the model is warm.',
        );
      }
      throw new Error(
        `Vision model unreachable at ${endpoint} (model ${model}): ${reason}. ` +
          'Start Ollama (ollama serve) and pull a multimodal model, or set OLLAMA_HOST.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Vision model returned HTTP ${response.status} from ${endpoint}: ${text.slice(0, 500)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Vision model returned non-JSON response from ${endpoint}: ${text.slice(0, 300)}`);
    }

    const description = extractCompletionText(parsed);
    if (!description) {
      throw new Error(`Vision model ${model} returned an empty description.`);
    }
    return description;
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'What to ask the vision model about the frame. Default "Describe what you see."',
          },
          device: {
            type: 'string',
            description: 'Optional ffmpeg camera device. Linux example: /dev/video0; Windows: video=Integrated Camera; macOS: 0.',
          },
          model: {
            type: 'string',
            description: 'Local multimodal model id served by Ollama. Default gemma4:12b.',
          },
          include_ocr: {
            type: 'boolean',
            description: 'Also attach local OCR text evidence from the captured frame. Default false.',
          },
          ocr_language: {
            type: 'string',
            description: 'OCR language code when include_ocr is true. Default eng.',
          },
          output_path: {
            type: 'string',
            description: 'Optional output image path. Defaults to .codebuddy/camera/camera-<timestamp>.png in the active workspace.',
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
    if (input === undefined || input === null) return { valid: true };
    if (typeof input !== 'object') return { valid: false, errors: ['Input must be an object'] };
    const data = input as Record<string, unknown>;
    if (data.prompt !== undefined && typeof data.prompt !== 'string') {
      return { valid: false, errors: ['prompt must be a string'] };
    }
    if (data.device !== undefined && typeof data.device !== 'string') {
      return { valid: false, errors: ['device must be a string'] };
    }
    if (data.model !== undefined && typeof data.model !== 'string') {
      return { valid: false, errors: ['model must be a string'] };
    }
    if (data.output_path !== undefined && typeof data.output_path !== 'string') {
      return { valid: false, errors: ['output_path must be a string'] };
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
      keywords: ['camera', 'webcam', 'see', 'vision', 'describe', 'look', 'photo', 'companion', 'eyes', 'analyze'],
      priority: 7,
      modifiesFiles: true,
      requiresConfirmation: true,
      makesNetworkRequests: true,
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
    new CameraAnalyzeTool(options),
  ];
}

/**
 * Resolve the Ollama OpenAI-compatible chat endpoint, honoring OLLAMA_HOST.
 * OLLAMA_HOST is typically `host:port` with no scheme and no /v1 path.
 */
export function resolveOllamaChatEndpoint(env: NodeJS.ProcessEnv): string {
  const raw = (env.OLLAMA_HOST ?? '').trim();
  if (!raw) return 'http://localhost:11434/v1/chat/completions';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const base = withScheme.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${base}/v1/chat/completions`;
}

/**
 * Extract assistant text from an OpenAI-compatible chat completion. The
 * `content` field may be a plain string or an array of typed parts.
 */
export function extractCompletionText(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const choices = (response as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object') return undefined;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return undefined;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') return content.trim() || undefined;
  if (Array.isArray(content)) {
    const parts = content
      .map(part => (part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined))
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    return parts.join('\n').trim() || undefined;
  }
  return undefined;
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

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function combineScreenshotFailures(...results: ToolResult[]): ToolResult {
  const errors = results
    .map(result => result.error || result.output)
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0);
  return {
    success: false,
    error: `Browser screenshot failed after retries: ${errors.join(' | ') || 'unknown error'}`,
  };
}
