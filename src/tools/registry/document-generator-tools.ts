/**
 * Document Generator Tool Adapters
 *
 * ITool-compliant adapters for PPTX, DOCX, XLSX, and PDF document generation.
 * Wraps document-generator.ts to conform to the FormalToolRegistry interface.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { executeGenerateDocument } from '../document-generator.js';

// ============================================================================
// GenerateDocumentExecuteTool
// ============================================================================

/**
 * GenerateDocumentExecuteTool — ITool adapter for the generate_document tool.
 * Generates PPTX, DOCX, XLSX, or PDF documents from markdown content.
 */
export class GenerateDocumentExecuteTool implements ITool {
  readonly name = 'generate_document';
  readonly description =
    'Generate professional documents: PowerPoint (PPTX), Word (DOCX), Excel (XLSX), or PDF from markdown content.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeGenerateDocument({
      type: input.type as 'pptx' | 'docx' | 'xlsx' | 'pdf',
      title: input.title as string,
      content: input.content as string,
      outputPath: input.outputPath as string,
      theme: input.theme as 'professional' | 'minimal' | 'dark' | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Document format: pptx, docx, xlsx, or pdf',
          },
          title: {
            type: 'string',
            description: 'Document title',
          },
          content: {
            type: 'string',
            description: 'Markdown content for the document',
          },
          outputPath: {
            type: 'string',
            description: 'Output file path',
          },
          theme: {
            type: 'string',
            description: 'Visual theme: professional, minimal, or dark',
          },
          pageSize: {
            type: 'string',
            description: 'Page size: A4 or letter',
          },
          orientation: {
            type: 'string',
            description: 'Orientation: portrait or landscape',
          },
        },
        required: ['type', 'title', 'content', 'outputPath'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    const errors: string[] = [];

    if (!['pptx', 'docx', 'xlsx', 'pdf'].includes(data.type as string)) {
      errors.push('type must be one of: pptx, docx, xlsx, pdf');
    }

    if (typeof data.title !== 'string' || data.title.trim() === '') {
      errors.push('title must be a non-empty string');
    }

    if (typeof data.content !== 'string' || data.content.trim() === '') {
      errors.push('content must be a non-empty string');
    }

    if (typeof data.outputPath !== 'string' || data.outputPath.trim() === '') {
      errors.push('outputPath must be a non-empty string');
    }

    if (data.theme !== undefined && !['professional', 'minimal', 'dark'].includes(data.theme as string)) {
      errors.push('theme must be one of: professional, minimal, dark');
    }

    if (data.pageSize !== undefined && !['A4', 'letter'].includes(data.pageSize as string)) {
      errors.push('pageSize must be one of: A4, letter');
    }

    if (data.orientation !== undefined && !['portrait', 'landscape'].includes(data.orientation as string)) {
      errors.push('orientation must be one of: portrait, landscape');
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'document' as ToolCategoryType,
      keywords: [
        'document', 'generate', 'pptx', 'powerpoint', 'presentation', 'slides',
        'docx', 'word', 'xlsx', 'excel', 'spreadsheet', 'pdf', 'report',
        'export', 'create', 'professional',
      ],
      priority: 7,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all document generator tool instances.
 */
export function createDocumentGeneratorTools(): ITool[] {
  return [new GenerateDocumentExecuteTool()];
}

/**
 * Reset document generator tool instances (for testing — tools are stateless).
 */
export function resetDocumentGeneratorInstances(): void {
  // No shared state to reset
}
