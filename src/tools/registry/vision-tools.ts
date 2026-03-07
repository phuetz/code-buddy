/**
 * Vision and Image Tool Adapters
 *
 * ITool-compliant adapters for OCR and Image Processing operations.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { OcrTool } from '../vision/ocr-tool.js';
import { ImageProcessorTool } from '../vision/image-processor.js';
import * as path from 'path';

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
// Factory Function
// ============================================================================

export function createVisionTools(): ITool[] {
  return [
    new OcrExtractTool(),
    new ImageAnalyzeTool(),
  ];
}
